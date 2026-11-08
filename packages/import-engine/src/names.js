'use strict';

// Name policy (policy/names-v1.json): turns a file name into a song title, a version label and,
// for stems, the stem part. It starts from the main app's own preClean() and canonical identity
// (adapters), then sets aside the words the policy lists — stage, render, edit, version, format,
// technical and marker words, category prefixes, learned namespaces and contributors — instead of
// letting them split one song into several (docs/FINDINGS.md rows 2–6, 12–17, 21–26).
// Every word set aside is recorded with its rule, so reasons can be shown in plain words.

const policy = require('../policy/names-v1.json');
const { requireApp } = require('./adapters/vendor');
const { isGenericTitle } = require('./adapters/auto-merge');

const { preClean } = requireApp('electron/import-canonical-identity.js');
const { STEM_TOKENS } = requireApp('electron/catchall-classifier.js');

const set = (list) => new Set(list);
const FORMAT = set(policy.formatWords);
const TECH = policy.techPatterns.map((pattern) => new RegExp(pattern));
const TECH_FOLLOWERS = set(policy.techFollowers);
const STAGE = set(policy.stageWords);
const RENDER = set(policy.renderWords);
const RENDER_PATTERNS = policy.renderPatterns.map((pattern) => new RegExp(pattern));
const EDIT = set(policy.editWords);
const EDIT_PATTERNS = policy.editPatterns.map((pattern) => new RegExp(pattern));
const VERSION_PATTERNS = policy.versionPatterns.map((pattern) => new RegExp(pattern));
const VERSION_WORDS = set(policy.versionWords);
const STEM_MARKERS = set(policy.stemMarkers);
const BASE_STEM_WORDS = set([...policy.stemWords, ...STEM_TOKENS]);
// A stem word with a mix-process suffix is a stem word too ("PianoCLN", "PianoFX", "VoxWet").
const STEM_WORDS = {
    has: (token) => BASE_STEM_WORDS.has(token) || policy.stemProcessSuffixes.some((suffix) => token.length > suffix.length + 2 && token.endsWith(suffix) && BASE_STEM_WORDS.has(token.slice(0, -suffix.length)))
};
const STEM_SECONDARY = set(policy.stemSecondaryWords);
const MONTHS = set(policy.months);
const WEEKDAYS = set(policy.weekdays);
const CONTRIBUTOR_PATTERNS = set(policy.contributorPatterns);
const PHRASES = [
    ...policy.markerPhrases.map((phrase) => [phrase, 'marker']),
    ...policy.stagePhrases.map((phrase) => [phrase, 'stage']),
    ...policy.renderPhrases.map((phrase) => [phrase, 'render'])
]
    .map(([phrase, rule]) => ({ words: phrase.split(' '), rule }))
    .sort((a, b) => b.words.length - a.words.length);
const CATEGORIES = policy.categoryPrefixes.map((prefix) => prefix.split(' ')).sort((a, b) => b.length - a.length);

const isNumber = (token) => /^\d+$/.test(token);
// A bare number is a take (1–30) or a tempo (60–200); other numbers ("Sky Night 537") are part of the title.
const isTakeOrTempo = (token) => isNumber(token) && ((Number(token) >= 1 && Number(token) <= 30) || (Number(token) >= 60 && Number(token) <= 200));
const isYear = (token) => isNumber(token) && Number(token) >= 1900 && Number(token) <= 2099;
const isDayNumber = (token) => /^\d{1,2}(st|nd|rd|th)?$/.test(token) && parseInt(token, 10) >= 1 && parseInt(token, 10) <= 31;
const matchesAny = (patterns, token) => patterns.some((pattern) => pattern.test(token));

// ── Tokens ──

function splitToken(token) {
    if (FORMAT.has(token)) return [token];
    const glued = token.match(/^([a-z]{2,})(\d+(?:\.\d+)*)$/);
    if (glued && !TECH_FOLLOWERS.has(glued[1])) return [glued[1], glued[2]];
    return [token];
}

function tokenize(text) {
    return text
        .toLowerCase()
        .normalize('NFKC')
        .replace(/_/g, ' ')
        .replace(/([a-z])\.(?=[a-z])/g, '$1 ') // jog.wav -> jog wav
        .replace(/[()[\]{},;:!?"'’#&+~]/g, ' ')
        .split(/\s+/)
        .map((token) => token.replace(/^[.\-]+(?=\D)|[.\-]+$/g, ''))
        .filter(Boolean)
        .flatMap(splitToken);
}

// " - " separates name segments; a hyphen inside a word ("lo-fi") does not.
function segmentsOf(name) {
    return name
        .split(/\s+-+\s*|\s*-+\s+/)
        .map(tokenize)
        .filter((tokens) => tokens.length > 0);
}

function startsWith(tokens, prefix) {
    return prefix.length <= tokens.length && prefix.every((word, index) => tokens[index] === word);
}

// ── Word classes ──

function wordRule(token, options) {
    if (FORMAT.has(token)) return 'format';
    if (matchesAny(TECH, token)) return 'tech';
    if (STAGE.has(token)) return 'stage';
    if (RENDER.has(token) || matchesAny(RENDER_PATTERNS, token)) return 'render';
    if (options.groupEdits !== false && (EDIT.has(token) || matchesAny(EDIT_PATTERNS, token))) return 'edit';
    if (matchesAny(VERSION_PATTERNS, token)) return 'version';
    return null;
}

function phraseAt(tokens, index) {
    return PHRASES.find((phrase) => startsWith(tokens.slice(index), phrase.words)) || null;
}

function isStemSegment(tokens) {
    const words = tokens.filter((token) => !isNumber(token) && !STEM_MARKERS.has(token));
    return words.length > 0 && words.every((token) => STEM_WORDS.has(token)) && words.some((token) => !STEM_SECONDARY.has(token));
}

// A later segment holds a version label, not more title, when it starts with a stage, edit or
// version word ("- Final Master 1.1", "- WIP 1", "- 128 Loop"), when every word in it is one the
// policy sets aside ("- Reverse"), or when it starts with an instrument and carries a stage or
// version word ("- Orch Adds 1.4"). "- Guitar Jam W Pedals" or "- Alt Rock Bey" stay title.
// Words that only come off the end of a title ("Theo Adds Combined"); at the start of a segment they
// begin a title ("- Combined Patterns - Waltzes").
const TRAILING_ONLY = set(policy.trailingOnlyWords || []);

function isLabelSegment(tokens, options) {
    const first = tokens[0];
    if (TRAILING_ONLY.has(first)) return false;
    const rule = wordRule(first, options);
    if (['stage', 'edit', 'version', 'tech', 'format'].includes(rule)) return true;
    const phrase = phraseAt(tokens, 0);
    if (phrase && phrase.rule === 'stage') return true;
    if (isNumber(first) || VERSION_WORDS.has(first) || STEM_MARKERS.has(first)) return true;
    const removable = (token) => Boolean(wordRule(token, options)) || isNumber(token) || STEM_WORDS.has(token);
    if (tokens.every(removable)) return true;
    if (STEM_WORDS.has(first)) return tokens.some((token) => ['stage', 'version'].includes(wordRule(token, options)));
    return false;
}

// A title too weak to identify a song on its own: empty, generic, or only weekday/time words.
function isWeakTitle(tokens) {
    if (tokens.length === 0) return true;
    if (tokens.length === 1 && tokens[0].length <= 2) return true;
    if (tokens.every((token) => WEEKDAYS.has(token) || isNumber(token))) return true;
    return isGenericTitle(tokens.join(' '));
}

// A date phrase at the end: "april 21", "21 april", "aug 7 2023". A month alone is not a date.
function trailingDateLength(tokens) {
    const n = tokens.length;
    const last = tokens[n - 1];
    const prev = tokens[n - 2];
    const before = tokens[n - 3];
    if (n >= 3 && isYear(last) && MONTHS.has(before) && isDayNumber(prev)) return 3;
    if (n >= 3 && isYear(last) && isDayNumber(before) && MONTHS.has(prev)) return 3;
    if (n >= 2 && MONTHS.has(prev) && isDayNumber(last)) return 2;
    if (n >= 2 && isDayNumber(prev) && MONTHS.has(last)) return 2;
    return 0;
}

// ── Analysis ──

function createNameContext({ namespaces = [], contributors = [], courseNamespaces = [] } = {}) {
    return {
        namespaces: new Set(namespaces.map((namespace) => namespace.toLowerCase())),
        contributors: new Set(contributors.map((name) => name.toLowerCase())),
        courseNamespaces: new Set(courseNamespaces.map((namespace) => namespace.toLowerCase()))
    };
}

function analyseName(file, ctx, options = {}) {
    const removed = [];
    const setAside = (rule, words) => {
        if (words.length) removed.push({ rule, words: words.join(' ') });
    };
    const video = file.type === 'videos';
    let segments = segmentsOf(preClean(file.name, { video }));

    // Marker phrases ("project pd") anywhere.
    segments = segments
        .map((tokens) => {
            const kept = [];
            for (let index = 0; index < tokens.length; index += 1) {
                const phrase = phraseAt(tokens, index);
                if (phrase && phrase.rule === 'marker') {
                    setAside('marker', phrase.words);
                    index += phrase.words.length - 1;
                } else kept.push(tokens[index]);
            }
            return kept;
        })
        .filter((tokens) => tokens.length);

    // 1. Category prefix ("Beat Idea -", "Morning 5 -"), as a segment or at the start of one.
    let category = null;
    if (segments.length) {
        const prefix = CATEGORIES.find((words) => startsWith(segments[0], words) && (segments[0].length > words.length || segments.length > 1));
        if (prefix) {
            category = prefix.join(' ');
            setAside('category', prefix);
            segments[0] = segments[0].slice(prefix.length);
            if (!segments[0].length) segments.shift();
        }
    }

    // Learned contributor names come off before the segments are read ("- Theo Cello Adds 1").
    // The first segment of a longer name is a prefix ("ARN x FRED -"): names in it stay.
    segments = segments
        .map((tokens, index) => {
            if (tokens.length < 2 || (index === 0 && segments.length > 1)) return tokens;
            const kept = tokens.filter((token) => !ctx.contributors.has(token));
            if (kept.length < tokens.length) setAside('contributor', tokens.filter((token) => ctx.contributors.has(token)));
            return kept;
        })
        .filter((tokens) => tokens.length);

    // 2. Namespace (client, collaborator, series): learned from the catalog, or an "A X B" collaboration
//    prefix (the app's own convention, e.g. "ARN X JOSH -"). Only when a title remains after it.
    let namespace = null;
    const collaboration = segments.length > 1 && segments[0].length >= 3 && segments[0].filter((token, index) => index % 2 === 1).every((token) => token === 'x');
    if (segments.length > 1 && (ctx.namespaces.has(segments[0].join(' ')) || collaboration)) {
        namespace = segments[0].join(' ');
    } else if (segments.length) {
        const words = segments[0];
        for (let size = Math.min(3, words.length - 1); size >= 1; size -= 1) {
            if (ctx.namespaces.has(words.slice(0, size).join(' '))) {
                namespace = words.slice(0, size).join(' ');
                break;
            }
        }
    }
    let namespaceSegments = segments;
    if (namespace) {
        const size = namespace.split(' ').length;
        namespaceSegments = segments[0].length === size ? segments.slice(1) : [segments[0].slice(size), ...segments.slice(1)];
    }

    // 3. Stem part: a trailing segment of stem words, or the words after "Stems".
    function takeStemPart(list) {
        let stemPart = null;
        const out = list.map((tokens) => [...tokens]);
        if (out.length > 1 && isStemSegment(out[out.length - 1])) {
            stemPart = out.pop().filter((token) => !STEM_MARKERS.has(token) && !isNumber(token)).join(' ');
            // "… Arn Stems - Hits": the marker before the part is not title.
            const last = out[out.length - 1];
            while (last.length > 1 && STEM_MARKERS.has(last[last.length - 1])) last.pop();
        }
        for (let s = 0; s < out.length && !stemPart; s += 1) {
            const at = out[s].findIndex((token, index) => STEM_MARKERS.has(token) && (s > 0 || index > 0));
            if (at >= 0) {
                const after = out[s].slice(at + 1).filter((token) => !isNumber(token));
                stemPart = after.join(' ') || 'stems';
                out[s] = out[s].slice(0, at);
                out.splice(s + 1);
            }
        }
        if (!stemPart && file.type === 'stems' && out.length) {
            const last = out[out.length - 1];
            let cut = last.length;
            // Trailing numbers ("Kick 2") come off only before any stem word; a date's day stays.
            while (cut > 1 && isNumber(last[cut - 1])) cut -= 1;
            const numbersEnd = cut;
            while (cut > 1 && STEM_WORDS.has(last[cut - 1])) cut -= 1;
            if (cut === numbersEnd) cut = last.length;
            if (cut < last.length && last.slice(cut).some((token) => STEM_WORDS.has(token) && !STEM_SECONDARY.has(token))) {
                stemPart = last.slice(cut).filter((token) => !isNumber(token)).join(' ');
                out[out.length - 1] = last.slice(0, cut);
            }
        }
        return { stemPart, segments: out.filter((tokens) => tokens.length) };
    }

    // 4. Title = segments up to the first label segment; the rest is the version label.
    function titleOf(list) {
        let titleTokens = [];
        let label = [];
        list.forEach((tokens, index) => {
            if (label.length || (index > 0 && isLabelSegment(tokens, options))) label.push(...tokens);
            else titleTokens.push(...tokens);
        });
        // A version token after the title has begun ends it: "Glass Track Remake V2 New Piano" is
        // "Glass Track Remake" in version "V2 New Piano" (the stage word "remake" comes off later).
        const at = titleTokens.findIndex((token, index) => index > 0 && matchesAny(VERSION_PATTERNS, token));
        if (at > 0 && !isWeakTitle(titleTokens.slice(0, at))) {
            label = [...titleTokens.slice(at), ...label];
            titleTokens = titleTokens.slice(0, at);
        }
        return { titleTokens, label };
    }

    let stem = takeStemPart(namespaceSegments);
    let { titleTokens, label } = titleOf(stem.segments);
    if (namespace && reduceTitle([...titleTokens], ctx, options, () => {}).length === 0) {
        // The "namespace" was the song's own title ("Nimbus - WIP 1 - MASTER").
        namespace = null;
        stem = takeStemPart(segments);
        ({ titleTokens, label } = titleOf(stem.segments));
    } else if (namespace) {
        setAside('namespace', namespace.split(' '));
    }
    if (label.length) setAside(labelRule(label, options), label);
    if (stem.stemPart) setAside('stem', stem.stemPart.split(' '));

    // 5–6. Clean the title: repeats, contributors, trailing stage/render/edit/version words, dates.
    // Idea words count the same in plural ("Piano Ideas" is "Piano Idea"); other plurals only suggest.
    const title = reduceTitle(titleTokens, ctx, options, setAside, namespace).map((token) => policy.pluralSameAs[token] || token);
    const generic = title.length > 0 && isGenericTitle(title.join(' '));
    // A title that names a day ("friday april 21") only identifies a song within its series.
    const dateLength = trailingDateLength(title);
    const dateKeyed = title.length > 0 && (title.every((token) => WEEKDAYS.has(token) || isNumber(token) || MONTHS.has(token)) || (dateLength > 0 && isWeakTitle(title.slice(0, -dateLength))));
    return {
        title: title.join(' '),
        namespace,
        category,
        stemPart: stem.stemPart,
        isStemName: Boolean(stem.stemPart),
        label: removed.filter((step) => !['namespace', 'category', 'stem', 'format', 'tech', 'marker', 'repeat'].includes(step.rule)).map((step) => step.words).join(' '),
        generic,
        dateKeyed,
        weak: isWeakTitle(title),
        // Bare numbers set aside (take or tempo): they only join a song whose plain title also exists.
        bareNumber: removed.filter((step) => step.rule === 'version' && step.words.split(' ').every(isNumber)).map((step) => step.words).reverse().join(' '),
        removed
    };
}

function labelRule(tokens, options) {
    const rules = tokens.map((token) => wordRule(token, options)).filter(Boolean);
    return rules[0] || (tokens.some(isNumber) ? 'version' : 'descriptor');
}

function reduceTitle(input, ctx, options, setAside, namespace = null) {
    let tokens = input.filter((token) => {
        const rule = FORMAT.has(token) ? 'format' : matchesAny(TECH, token) ? 'tech' : null;
        if (rule) setAside(rule, [token]);
        return !rule;
    });
    // A number followed by "bpm"/"kbps" is a technical spec.
    tokens = tokens.filter((token, index) => {
        const spec = isNumber(token) && TECH_FOLLOWERS.has(tokens[index + 1]);
        if (spec) setAside('tech', [token]);
        return !spec && !(TECH_FOLLOWERS.has(token) && isNumber(tokens[index - 1]));
    });
    // Repeated words ("lumen lumen"), and the namespace repeated as the first title word.
    tokens = tokens.filter((token, index) => {
        const repeat = index > 0 && token === tokens[index - 1] && !isNumber(token);
        if (repeat) setAside('repeat', [token]);
        return !repeat;
    });
    if (namespace && tokens.length > 1 && tokens[0] === namespace) {
        setAside('repeat', [tokens[0]]);
        tokens = tokens.slice(1);
    }
    // Contributors: learned names, and "for/feat/w <name>".
    tokens = tokens.filter((token, index) => {
        const learned = ctx.contributors.has(token) && tokens.length > 1;
        const patterned = index > 0 && CONTRIBUTOR_PATTERNS.has(tokens[index - 1]) && index === tokens.length - 1 && !STEM_WORDS.has(token);
        if (learned || patterned) setAside('contributor', [token]);
        return !(learned || patterned);
    });
    tokens = tokens.filter((token, index) => !(CONTRIBUTOR_PATTERNS.has(token) && index === tokens.length - 1));

    // Phrases anywhere in the title ("radio edit", "pitch up", "bass only").
    for (let index = 0; index < tokens.length; index += 1) {
        const phrase = phraseAt(tokens, index);
        if (phrase) {
            setAside(phrase.rule, phrase.words);
            tokens.splice(index, phrase.words.length);
            index -= 1;
        }
    }

    // Trailing words, repeated until nothing more comes off.
    for (let changed = true; changed && tokens.length > 1; ) {
        changed = false;
        const last = tokens[tokens.length - 1];
        const rest = tokens.slice(0, -1);
        const rule = wordRule(last, options);
        if (rule) {
            setAside(rule, [last]);
            tokens = rest;
            changed = true;
            continue;
        }
        if (VERSION_WORDS.has(tokens[tokens.length - 2]) && isNumber(last)) {
            setAside('version', tokens.slice(-2));
            tokens = tokens.slice(0, -2);
            changed = true;
            continue;
        }
        const dateLength = trailingDateLength(tokens);
        if (dateLength && !isWeakTitle(tokens.slice(0, -dateLength))) {
            setAside('date', tokens.slice(-dateLength));
            tokens = tokens.slice(0, -dateLength);
            changed = true;
            continue;
        }
        // Bare numbers: take or tempo. Years, dates, and numbers that a weak title needs stay.
        if (isTakeOrTempo(last) && !dateLength && !isWeakTitle(rest)) {
            setAside('version', [last]);
            tokens = rest;
            changed = true;
        }
    }
    if (tokens.length === 1 && wordRule(tokens[0], options) && !isGenericTitle(tokens[0])) {
        setAside(wordRule(tokens[0], options), tokens);
        tokens = [];
    }
    return tokens;
}

module.exports = { analyseName, createNameContext, tokenize, segmentsOf, isWeakTitle, POLICY_VERSION: policy.version, policy };
