'use strict';

// Grouping, bands and kinds (SPEC steps 4–6). Pure: works on file descriptors, reads nothing.
// Input files need fileId, name and type; folder (sourceContainerId), dates, durations and clue
// links make the answer stronger when they exist.
//
// Merge rule (docs/DECISIONS.md D33): under "exact-identity-only" a song is "sure" only when its
// bounces, projects and videos share the main app's canonical identity. Songs that the lab's name
// policy put together are proposed as one song in the "unsure" band, for review. Under
// "multi-clue" they become sure at 0.95 or more from two or more clue types with no close rival.

const crypto = require('node:crypto');
const scoring = require('../policy/scoring-v1.json');
const { analyseName, createNameContext, tokenize, segmentsOf, policy: namePolicy } = require('./names');
const { fileIdentity } = require('./adapters/identity');
const { isGenericTitle } = require('./adapters/auto-merge');
const { requireApp } = require('./adapters/vendor');
const { detectCoursePrefixes } = require('./course');
const userRules = require('./user-rules');
const { suggestQuestions } = require('./questions');

const { discoverNamespaces } = requireApp('electron/hybrid-grouper.js');
const { preClean, canonicalSongIdentity } = requireApp('electron/import-canonical-identity.js');
const { jaroWinkler } = requireApp('electron/catchall-classifier.js');

const ANCHOR_TYPES = new Set(['bounces', 'projects', 'videos']);
const AUDIO_EXTS = new Set(['wav', 'mp3', 'aif', 'aiff', 'flac', 'm4a', 'ogg', 'wma', 'aac']);
const CATEGORY_SET = new Set(namePolicy.categoryPrefixes);
const KINDS = namePolicy.kinds;

const RULE_TEXT = {
    stage: 'mix and master stage words',
    render: 'render words (pitched, reversed, instrumental, wet or dry)',
    edit: 'edit words (short, long, track, piece)',
    version: 'version and take numbers',
    date: 'dates',
    contributor: 'contributor names',
    category: 'category prefixes',
    namespace: 'client or collaborator prefixes',
    marker: 'the Producer Dashboard backup marker',
    format: 'file-format words',
    tech: 'technical specs',
    repeat: 'repeated words',
    descriptor: 'descriptive tails after a stage word'
};

function hash(text) {
    return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function titleCase(text) {
    return text.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

// ── Learning from the catalog ──

// A prefix shared by many files is a client, band or series, unless it holds a stem marker or a
// version number: "Kelp Banger 3.4.1 Shorter Stems -" is a stem export, not a client.
function learnNamespaces(files, courseNamespaces) {
    const exportPrefix = (prefix) => prefix.split(' ').some((word) => namePolicy.stemMarkers.includes(word) || /^v?\d+(\.\d+)+$/.test(word) || /^v\d+$/.test(word));
    const learned = discoverNamespaces(files.map((member) => preClean(member.name)))
        .map(([prefix]) => prefix)
        .filter((prefix) => !CATEGORY_SET.has(prefix) && !exportPrefix(prefix));
    return [...new Set([...learned, ...courseNamespaces.map((namespace) => namespace.toLowerCase())])];
}

// A contributor is a name seen in an explicit pattern — "<name> adds", "<name> mix", "for <name>",
// "feat <name>", "ft <name>", "w <name>" — in at least two different files. Learning from
// insertions alone ("Sky Structure" vs "Sky") would merge different songs, so it is not used.
const MIX_WORDS = new Set(['club', 'radio', 'dub', 'extended', 'final', 'rough', 'quick', 'main', 'full', 'stem', 'stereo', 'mono', 'new', 'old', 'alt', 'demo', 'rework', 'remix', 'edit', 'instrumental', 'vocal', 'vocals', 'acapella', 'live', 'studio', 'test']);

function learnContributors(files) {
    const blocked = new Set([...namePolicy.stemWords, ...namePolicy.stageWords, ...namePolicy.renderWords, ...namePolicy.editWords, ...namePolicy.months, ...namePolicy.weekdays, ...namePolicy.categoryPrefixes.flatMap((prefix) => prefix.split(' ')), ...namePolicy.formatWords, 'the', 'a', 'and', 'of', 'to', 'in', 'my', 'image', 'idea']);
    const plain = (token) => token && token.length >= 2 && !/\d/.test(token) && !blocked.has(token);
    const seen = new Map();
    for (const member of files) {
        const tokens = tokenize(preClean(member.name));
        const names = new Set();
        tokens.forEach((token, index) => {
            if (['adds', 'add'].includes(tokens[index + 1]) && plain(token)) names.add(token);
            if (['for', 'feat', 'ft', 'w'].includes(tokens[index - 1]) && plain(token) && index === tokens.length - 1) names.add(token);
            // "(JOSH MIX V4)": a name right before "mix" (not a mix word itself) mixed this version.
            if (tokens[index + 1] === 'mix' && plain(token) && !MIX_WORDS.has(token)) names.add(token);
        });
        for (const name of names) seen.set(name, (seen.get(name) || 0) + 1);
    }
    return [...seen.entries()].filter(([, count]) => count >= 2).map(([name]) => name).sort();
}

// Parts named after instruments ("Ocarina", "Croatian") become stems when they sit beside
// siblings that are stems: same name except the last segment, three or more files.
function applySiblingStems(entries) {
    const buckets = new Map();
    for (const entry of entries) {
        const segments = segmentsOf(preClean(entry.file.name));
        if (segments.length < 3) continue;
        const key = segments.slice(0, -1).map((tokens) => tokens.join(' ')).join(' - ');
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push({ entry, last: segments[segments.length - 1].join(' ') });
    }
    for (const members of buckets.values()) {
        if (members.length < 3) continue;
        const stems = members.filter((member) => member.entry.analysis.isStemName);
        if (stems.length / members.length < 0.4) continue;
        const title = stems[0].entry.analysis.title;
        for (const member of members) {
            if (member.entry.analysis.isStemName || !AUDIO_EXTS.has(member.entry.file.ext)) continue;
            // "… - MASTER", "… - Final": the mix among its stems, not a stem.
            if (member.last.split(' ').every((word) => namePolicy.stageWords.includes(word))) continue;
            member.entry.analysis = { ...member.entry.analysis, title, isStemName: true, stemPart: member.last, removed: [...member.entry.analysis.removed, { rule: 'stem', words: member.last }] };
            member.entry.siblingStem = true;
        }
    }
}

// ── Grouping ──

function isStemEntry(entry) {
    return AUDIO_EXTS.has(entry.file.ext) && entry.analysis.isStemName && entry.analysis.title !== '';
}

// One-shot sounds ("STORM - CLAPS", "Kick 2", "Hip Hop Kit"): a short name with a one-shot word.
const ONE_SHOT_WORDS = new Set(KINDS.oneShotWords);

function isOneShotName(entry) {
    if (!AUDIO_EXTS.has(entry.file.ext)) return false;
    // A part of a stem export ("… Stems - New Kick") is a stem, not a one-shot.
    if (tokenize(entry.file.name).some((word) => namePolicy.stemMarkers.includes(word))) return false;
    const words = `${entry.analysis.title} ${entry.analysis.stemPart || ''}`.split(' ').filter((word) => word && !/^\d+$/.test(word));
    return words.length > 0 && words.length <= KINDS.oneShotMaxWords && words.some((word) => ONE_SHOT_WORDS.has(word));
}

// A pack-like folder holds several one-shot sounds and no project: its one-shots are a sample
// pack, never a song (and never the mix of an export batch).
// A numbered sample: the last part of the name is only a number ("Lx - Signature - Broken Cello - 1").
function isNumberedSample(entry) {
    if (!AUDIO_EXTS.has(entry.file.ext)) return false;
    const segments = segmentsOf(preClean(entry.file.name));
    return segments.length >= 2 && segments[segments.length - 1].length === 1 && /^\d{1,3}$/.test(segments[segments.length - 1][0]);
}

function packFolders(entries) {
    const byFolder = new Map();
    for (const entry of entries) {
        const folder = entry.file.sourceContainerId;
        if (!folder) continue;
        if (!byFolder.has(folder)) byFolder.set(folder, { oneShots: 0, numbered: 0, audio: 0, projects: 0 });
        const stats = byFolder.get(folder);
        if (entry.file.type === 'projects') stats.projects += 1;
        else if (AUDIO_EXTS.has(entry.file.ext)) {
            stats.audio += 1;
            if (isOneShotName(entry)) stats.oneShots += 1;
            else if (isNumberedSample(entry)) stats.numbered += 1;
        }
    }
    // Four or more one-shots; or one-shots and numbered samples making up half the folder's audio.
    const packLike = (stats) => stats.projects === 0 && (stats.oneShots >= KINDS.packFolderMinFiles || (stats.oneShots + stats.numbered >= KINDS.packFolderMinFiles && (stats.oneShots + stats.numbered) * 2 >= stats.audio));
    return new Set([...byFolder].filter(([, stats]) => packLike(stats)).map(([folder]) => folder));
}

function bucketKey(entry) {
    const { analysis, file } = entry;
    // A weak title ("Untitled 14", "Night 376") only joins the same name in the same folder.
    if (analysis.weak && !analysis.generic) return analysis.title ? `weak:${analysis.category || ''}|${analysis.title}|${file.sourceContainerId || file.fileId}` : `weak:${file.fileId}`;
    if (analysis.generic) return `generic:${analysis.title}:${file.sourceContainerId || file.fileId}`;
    // A day-named title is only unique within its series ("Jam - Friday May 19" is not "Morning 5 - Friday May 19").
    if (analysis.dateKeyed) return `title:${analysis.category || ''}|${analysis.title}`;
    return `title:${analysis.title}`;
}

// A bare number ("Sky 122", "Sky 2") is a take or tempo label when the plain title ("Sky") is also
// there, when the numbered files share a folder ("Sketch 1", "Sketch 2"), when one file's numbers
// contain the other's ("… 80 Project" and "… 80 1"), or when both are takes (30 or under). Numbered files in different folders with no
// plain title and no shared number ("Sky Night 21", "Sky Night 41") stay apart: precision first, and
// similar names alone never merge. Without folder information nothing is split.
function numberSet(text) {
    return new Set(String(text || '').split(' ').filter(Boolean));
}

function numbersContain(a, b) {
    const [small, large] = numberSet(a).size <= numberSet(b).size ? [numberSet(a), numberSet(b)] : [numberSet(b), numberSet(a)];
    return small.size > 0 && [...small].every((number) => large.has(number));
}

// Single-digit takes ("Sample 1", "Sample 3") are versions wherever they are; larger numbers in
// different folders ("Sky Night 1" and "Sky Night 21", tempos) are not. Such a join is checked, never sure.
function bothTakes(a, b) {
    return [...numberSet(a), ...numberSet(b)].every((number) => Number(number) >= 1 && Number(number) <= 9);
}

function commonNumbers(numbers) {
    const sets = [...numbers].map(numberSet);
    return [...sets[0]].filter((number) => sets.every((set) => set.has(number))).join(' ');
}

function splitByNumber(entries) {
    if (entries.some((entry) => !entry.analysis.bareNumber || !entry.file.sourceContainerId)) return [{ numberKey: '', entries }];
    const parts = [];
    for (const entry of entries) {
        const touching = parts.filter((part) => [...part.numbers].some((number) => numbersContain(number, entry.analysis.bareNumber) || bothTakes(number, entry.analysis.bareNumber)) || part.folders.has(entry.file.sourceContainerId));
        const merged = { numbers: new Set([entry.analysis.bareNumber]), folders: new Set([entry.file.sourceContainerId]), entries: [entry], takeJoin: false };
        for (const part of touching) {
            if (!part.folders.has(entry.file.sourceContainerId) && ![...part.numbers].some((number) => numbersContain(number, entry.analysis.bareNumber))) merged.takeJoin = true;
            if (part.takeJoin) merged.takeJoin = true;
            part.numbers.forEach((number) => merged.numbers.add(number));
            part.folders.forEach((folder) => merged.folders.add(folder));
            merged.entries.unshift(...part.entries);
            parts.splice(parts.indexOf(part), 1);
        }
        parts.push(merged);
    }
    return parts.map((part) => ({ numberKey: commonNumbers(part.numbers), entries: part.entries, takeJoin: part.takeJoin }));
}

// Different clients or collaborators under one title stay apart; files without a prefix join the
// only prefixed group when there is exactly one.
function splitByNamespace(entries) {
    const named = new Map();
    for (const entry of entries) {
        const namespace = entry.analysis.namespace;
        if (!namespace) continue;
        if (!named.has(namespace)) named.set(namespace, []);
        named.get(namespace).push(entry);
    }
    // Course material keeps its kind: unprefixed files never join a course-prefixed group ("ZQT -
    // Nimbus Demo" stays course; "Nimbus - WIP 1" files stay the song). The pair goes to review.
    if (named.size === 1 && [...named.values()][0].every((entry) => entry.course) && entries.some((entry) => !entry.analysis.namespace)) {
        const twin = `course-twin:${[...named.keys()][0]}:${entries[0].analysis.title}`;
        return [
            { entries: [...named.values()][0], namespaceConflict: false, courseTwin: twin, courseSide: true },
            { entries: entries.filter((entry) => !entry.analysis.namespace), namespaceConflict: false, courseTwin: twin }
        ];
    }
    // A dated session ("Morning 5 - March 11 - Tension") joins a client's or band's song of the same name
    // ("Marlow - Tension") only as a suggestion: the name alone, once the date is set aside, is not enough.
    if (named.size === 1 && entries.some((entry) => !entry.analysis.namespace && entry.analysis.dateSession)) {
        const twin = `name-twin:${[...named.keys()][0]}:${entries[0].analysis.title}`;
        const sessions = entries.filter((entry) => !entry.analysis.namespace && entry.analysis.dateSession);
        return [
            { entries: entries.filter((entry) => !sessions.includes(entry)), namespaceConflict: false, courseTwin: twin },
            { entries: sessions, namespaceConflict: false, courseTwin: twin }
        ];
    }
    if (named.size <= 1) return [{ entries, namespaceConflict: false }];
    const unprefixed = entries.filter((entry) => !entry.analysis.namespace);
    const parts = [...named.values()].map((group) => ({ entries: group, namespaceConflict: true }));
    if (unprefixed.length) parts.push({ entries: unprefixed, namespaceConflict: true });
    return parts;
}

function groupCatalog(files, options = {}) {
    const { mergeRule = 'exact-identity-only', groupEdits = true, declinedCoursePrefixes = [], links = [], existingSongs = [] } = options;
    // The producer's rules come first: answers about prefixes and corrections from marks.
    const rules = userRules.normalize(options.userRules);
    const courseNamespaces = [...new Set([...(options.courseNamespaces || []), ...userRules.prefixesWith(rules, 'course')])];
    const seriesPrefixes = userRules.prefixesWith(rules, 'series');
    const notPrefixes = new Set([...userRules.prefixesWith(rules, 'word'), ...seriesPrefixes, ...userRules.prefixesWith(rules, 'pack'), ...userRules.prefixesWith(rules, 'collaborator')]);
    const nameOptions = { groupEdits };
    const namespaces = [...new Set([...learnNamespaces(files, courseNamespaces), ...userRules.prefixesWith(rules, 'band')])].filter((prefix) => !notPrefixes.has(prefix));

    const contributors = [...new Set([...learnContributors(files), ...userRules.prefixesWith(rules, 'collaborator')])];
    const ctx = createNameContext({ namespaces, contributors, courseNamespaces, seriesPrefixes });
    const courseSet = new Set(courseNamespaces.map((namespace) => namespace.toLowerCase()));
    const entries = files.map((member) => {
        const analysis = analyseName(member, ctx, nameOptions);
        return { file: member, analysis, course: Boolean(analysis.namespace && courseSet.has(analysis.namespace)) };
    });
    applySiblingStems(entries);
    const packs = packFolders(entries);
    const packPrefixes = userRules.prefixesWith(rules, 'pack');
    for (const entry of entries) {
        const first = (segmentsOf(preClean(entry.file.name))[0] || []).join(' ');
        entry.userPack = packPrefixes.find((prefix) => first === prefix || first.startsWith(`${prefix} `)) || null;
        entry.packOneShot = Boolean(entry.userPack) || (packs.has(entry.file.sourceContainerId) && (isOneShotName(entry) || isNumberedSample(entry)));
    }

    // Anchors (and stems that carry no part name) form the songs.
    const buckets = new Map();
    for (const entry of entries.filter((candidate) => !isStemEntry(candidate))) {
        const key = bucketKey(entry);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(entry);
    }
    const groups = [];
    for (const [key, bucketEntries] of buckets) {
        for (const numbered of splitByNumber(bucketEntries)) {
            for (const part of splitByNamespace(numbered.entries)) groups.push({ key, numberKey: numbered.numberKey, takeJoin: numbered.takeJoin, entries: part.entries, stems: [], namespaceConflict: part.namespaceConflict, courseTwin: part.courseTwin, courseSide: part.courseSide, review: part.courseSide ? 'Course material with the same title as a song: a course demo of that song? Kept apart; please decide.' : undefined });
        }
    }

    mergeVersionTails(groups);

    // Stems attach to the song with their title; otherwise they form a stem set of their own.
    const byTitle = new Map();
    for (const group of groups) {
        const title = group.entries[0].analysis.title;
        if (!group.key.startsWith('title:')) continue;
        if (!byTitle.has(title)) byTitle.set(title, []);
        byTitle.get(title).push(group);
    }
    // Weak and generic titles are scoped to their folder; their stems join only there.
    const folderScoped = new Map(groups.filter((group) => group.key.startsWith('generic:') || (group.key.startsWith('weak:') && group.key.includes('|'))).map((group) => [group.key, group]));
    const stemOnly = new Map();
    for (const entry of entries.filter(isStemEntry)) {
        const weakMatch = (entry.analysis.weak || entry.analysis.generic) && folderScoped.get(bucketKey(entry));
        if (weakMatch) {
            weakMatch.stems.push(entry);
            continue;
        }
        const candidates = (byTitle.get(entry.analysis.title) || []).filter((group) => group.numberKey === '' || !entry.analysis.bareNumber || numbersContain(group.numberKey, entry.analysis.bareNumber));
        const sameNamespace = (member) => member.analysis.namespace === entry.analysis.namespace;
        const sameFolder = (member) => member.file.sourceContainerId && member.file.sourceContainerId === entry.file.sourceContainerId;
        const match =
            (candidates.length > 1 && candidates.find((group) => group.entries.some((member) => sameFolder(member) && sameNamespace(member)))) ||
            candidates.find((group) => (group.numberKey === entry.analysis.bareNumber || numbersContain(group.numberKey, entry.analysis.bareNumber)) && group.entries.some(sameNamespace)) ||
            (candidates.length === 1 ? candidates[0] : null);
        if (match) match.stems.push(entry);
        else {
            const key = `stems:${entry.analysis.title}`;
            if (!stemOnly.has(key)) stemOnly.set(key, { key, entries: [], stems: [], namespaceConflict: false, stemOnly: true });
            stemOnly.get(key).stems.push(entry);
        }
    }
    groups.push(...stemOnly.values());
    attachStemSets(groups);

    attachExportBatches(groups, links);
    const looseStems = settleLoneStems(groups);
    applyUserFileRules(groups, rules);
    consolidatePacks(groups);
    const songs = groups.map((group) => buildSong(group, { mergeRule, links, rules }));
    // The live song list while scanning needs names only.
    if (options.preview) return { songs, looseStems, context: { namespaces, contributors, courseSuggestions: [] } };
    makeNamesUnique(songs);
    proposeSimilarNames(songs);
    linkCourseTwins(songs, groups);
    applyClueLinks(songs, links, mergeRule);
    matchExistingSongs(songs, existingSongs);
    const courseSuggestions = detectCoursePrefixes(files, { contributors, known: courseNamespaces, declined: declinedCoursePrefixes });
    const questions = suggestQuestions(files, { namespaces, courseSuggestions, songs, answered: [...Object.keys(rules.prefixes), ...courseNamespaces, ...declinedCoursePrefixes] });
    return { songs, looseStems, context: { namespaces, contributors, courseSuggestions, questions, policyVersion: namePolicy.version, scoringVersion: scoring.version } };
}

// Export batches found by the clue readers (same folder, format and length, saved together): the
// bounce with the plainest name is the mix, every other audio file in the batch becomes a stem of
// the mix's song, whatever it is called (FINDINGS row 21).
function attachExportBatches(groups, links) {
    const groupOfFile = new Map();
    const entryOfFile = new Map();
    for (const group of groups) {
        for (const entry of [...group.entries, ...group.stems]) {
            groupOfFile.set(entry.file.fileId, group);
            entryOfFile.set(entry.file.fileId, entry);
        }
    }
    for (const link of links.filter((candidate) => candidate.clue === 'exportBatch')) {
        const members = link.fileIds.map((id) => entryOfFile.get(id)).filter(Boolean);
        const mixes = members.filter((entry) => entry.file.type === 'bounces' && !isStemEntry(entry) && !entry.packOneShot && entry.analysis.title).sort((a, b) => a.analysis.title.length - b.analysis.title.length);
        if (!mixes.length) continue;
        const mix = mixes[0];
        const mixGroup = groupOfFile.get(mix.file.fileId);
        for (const entry of members) {
            if (entry === mix || entry.file.type === 'projects') continue;
            const from = groupOfFile.get(entry.file.fileId);
            from.entries = from.entries.filter((candidate) => candidate !== entry);
            from.stems = from.stems.filter((candidate) => candidate !== entry);
            const stemPart = entry.analysis.stemPart || entry.analysis.title;
            mixGroup.stems.push({ ...entry, viaBatch: true, analysis: { ...entry.analysis, stemPart, isStemName: true } });
            groupOfFile.set(entry.file.fileId, mixGroup);
        }
    }
    for (let index = groups.length - 1; index >= 0; index -= 1) if (!groups[index].entries.length && !groups[index].stems.length) groups.splice(index, 1);
}

// A title that is another song's title plus a version tail ("… Post Haze 1 Reversed Riff
// Enhanced" after "… Post Haze"; "… Brass Files SAMPLE 1" after "… Brass Files") is a version of
// that song when they share a folder and a prefix, and only one song fits. Checked, never sure.
function mergeVersionTails(groups) {
    const songs = groups.filter((group) => group.key.startsWith('title:') && group.entries.length);
    const folders = (group) => new Set(group.entries.map((entry) => entry.file.sourceContainerId).filter(Boolean));
    for (const longer of [...songs].sort((a, b) => b.entries[0].analysis.title.length - a.entries[0].analysis.title.length)) {
        if (!groups.includes(longer)) continue;
        const title = longer.entries[0].analysis.title;
        const fits = songs.filter((shorter) => {
            if (shorter === longer || !groups.includes(shorter)) return false;
            const base = shorter.entries[0].analysis.title;
            if (!base || base.split(' ').length < 2 || !title.startsWith(`${base} `)) return false;
            const tail = title.slice(base.length + 1).split(' ');
            const startsAsVersion = /^\d/.test(tail[0]) || ['sample', 'samples', 'v'].includes(tail[0]);
            // A tail that names a day is another session, not a version ("27" → "27 dec 28";
            // "Thursday October" → "Thursday October 12").
            const months = namePolicy.months;
            const isDay = (word) => /^\d{1,2}$/.test(word || '');
            const baseWords = base.split(' ');
            const gluedDate = /^\d{1,2}([a-z]+)$/.exec(tail[0]);
            const datedTail = (gluedDate && months.includes(gluedDate[1])) || (isDay(tail[0]) && months.includes(tail[1])) || months.includes(tail[0]) || (isDay(tail[0]) && months.includes(baseWords[baseWords.length - 1])) || (isDay(baseWords[baseWords.length - 1]) && months.includes(tail[0]));
            if (datedTail) return false;
            const sameNamespace = (shorter.entries[0].analysis.namespace || '') === (longer.entries[0].analysis.namespace || '');
            const shareFolder = [...folders(longer)].some((folder) => folders(shorter).has(folder));
            return startsAsVersion && sameNamespace && shareFolder;
        });
        if (fits.length !== 1) continue;
        fits[0].entries.push(...longer.entries.map((entry) => ({ ...entry, analysis: { ...entry.analysis, title: fits[0].entries[0].analysis.title, label: [title.slice(fits[0].entries[0].analysis.title.length + 1), entry.analysis.label].filter(Boolean).join(' ') } })));
        fits[0].tailJoin = true;
        groups.splice(groups.indexOf(longer), 1);
    }
}

// A stem set joins the one song of its series with the same date ("Morning 5 - Thursday Nov 2" for
// "... Nov 2 Piano pt 2 vox"), or the one song whose title begins or extends its own by stem,
// render, process and number words only ("Rising Tide" for "Rising Tide just strings").
// "Sky Structure" never reaches "Sky": "structure" is none of those words.
const EXTRA_OK = new Set(['just', 'only', 'pt', 'part', 'take', 'and', 'with', 'w', 'sample', 'samples']);

function isExtraWord(word) {
    return /^\d+$/.test(word) || EXTRA_OK.has(word) || namePolicy.stemWords.includes(word) || namePolicy.stemSecondaryWords.includes(word) || namePolicy.renderWords.includes(word);
}

function dateOf(title) {
    const words = title.split(' ');
    for (let index = 0; index < words.length; index += 1) {
        if (!namePolicy.months.includes(words[index])) continue;
        const day = [words[index - 1], words[index + 1]].find((word) => /^\d{1,2}$/.test(word || ''));
        if (day) return `${words[index]} ${day}`;
    }
    return null;
}

function attachStemSets(groups) {
    const songs = groups.filter((group) => !group.stemOnly && group.key.startsWith('title:') && group.entries.length);
    for (let index = groups.length - 1; index >= 0; index -= 1) {
        const set = groups[index];
        if (!set.stemOnly || set.stems.some((stem) => stem.packOneShot)) continue;
        const first = set.stems[0].analysis;
        const title = first.title;
        // A stem set without a category may join a song of any series ("Song Idea - Kelp Banger").
        const same = (group) => (group.entries[0].analysis.namespace || '') === (first.namespace || '') && (!first.category || (group.entries[0].analysis.category || '') === first.category);
        const date = dateOf(title);
        let candidates = date ? songs.filter((group) => same(group) && dateOf(group.entries[0].analysis.title) === date) : [];
        if (candidates.length !== 1) {
            candidates = songs.filter((group) => {
                if (!same(group)) return false;
                const other = group.entries[0].analysis.title;
                const [shorter, longer] = other.length <= title.length ? [other, title] : [title, other];
                return shorter && longer.startsWith(`${shorter} `) && longer.slice(shorter.length + 1).split(' ').every(isExtraWord);
            });
        }
        if (candidates.length !== 1) continue;
        candidates[0].stems.push(...set.stems.map((stem) => ({ ...stem, viaTitle: true })));
        groups.splice(index, 1);
    }
}

// A part word ("vox", "piano", "strings only") makes a file a stem only when the rest of its song
// exists: a bounce, an instrumental or other stems from the same session. A single stem tries, in
// order, a song in its folder whose title begins or ends its own, then the one song with the same
// title (or that title plus part words) in any series ("Saturday night lantern heaven vox" →
// "Jam - Saturday Night - Lantern Heaven"). Otherwise it is an idea of its own and becomes a song.
// Only a stem that fits several songs equally is left for review as a loose stem.
function settleLoneStems(groups) {
    const loose = [];
    const songsInFolder = new Map();
    const songs = groups.filter((group) => !group.stemOnly && group.key.startsWith('title:') && group.entries.length);
    for (const group of songs) {
        for (const entry of group.entries) {
            const folder = entry.file.sourceContainerId;
            if (!folder) continue;
            if (!songsInFolder.has(folder)) songsInFolder.set(folder, new Set());
            songsInFolder.get(folder).add(group);
        }
    }
    for (let index = groups.length - 1; index >= 0; index -= 1) {
        const group = groups[index];
        if (!group.stemOnly || group.entries.length || group.stems.length !== 1) continue;
        const stem = group.stems[0];
        // One-shots and stems named as templates, course or sample-pack material keep that kind.
        if (stem.packOneShot || fileKind(stem) !== 'song') continue;
        const title = stem.analysis.title;
        const sameNamespace = (candidate) => candidate.entries.some((entry) => (entry.analysis.namespace || '') === (stem.analysis.namespace || ''));
        let near = [...(songsInFolder.get(stem.file.sourceContainerId) || [])].filter((candidate) => {
            const other = candidate.entries[0].analysis.title;
            return sameNamespace(candidate) && other && (title.startsWith(`${other} `) || title.endsWith(` ${other}`) || other.startsWith(`${title} `));
        });
        let via = 'viaFolder';
        if (near.length === 0) {
            near = songs.filter((candidate) => {
                const other = candidate.entries[0].analysis.title;
                if (!other || !sameNamespace(candidate)) return false;
                if (stem.analysis.category && (candidate.entries[0].analysis.category || '') !== stem.analysis.category) return false;
                if (other === title) return true;
                const [shorter, longer] = other.length <= title.length ? [other, title] : [title, other];
                return longer.startsWith(`${shorter} `) && longer.slice(shorter.length + 1).split(' ').every(isExtraWord) && shorter.split(' ').length >= 2;
            });
            via = 'viaTitle';
        }
        if (near.length === 1) {
            groups.splice(index, 1);
            near[0].stems.push({ ...stem, [via]: true });
        } else if (near.length > 1) {
            groups.splice(index, 1);
            loose.push({ ...stem.file, stemPart: stem.analysis.stemPart || null, reason: 'Several songs have this name; choose one in review.' });
        } else {
            // Nothing else from this song exists: an idea of its own (for example a voice memo with vocals).
            group.stemOnly = false;
            group.standaloneIdea = true;
            group.entries = [{ ...stem, analysis: { ...stem.analysis, isStemName: false } }];
            group.stems = [];
        }
    }
    return loose;
}

// ── Sample packs: one pack, one entry ──
// Sample-pack groups merge when they share a prefix and a folder ("Storm - Claps", "Storm - Kick" …), or a
// distinctive word spelled almost the same ("Nyckelharpa", "Nyckelharp"; "Gargoyle") with a prefix or a
// folder in common. Other entries with the pack's prefix in its folder of one-shots, or with its
// distinctive word, go to review: part of the pack, or a song? The lab does not guess.
const PACK_GENERIC = new Set(KINDS.packGenericWords);

function packInfo(group) {
    const all = [...group.entries, ...group.stems];
    const first = all[0];
    const prefixRaw = segmentsOf(preClean(first.file.name))[0] || [];
    const prefix = first.analysis.namespace || (segmentsOf(preClean(first.file.name)).length > 1 ? prefixRaw.join(' ') : '');
    const folders = new Set(all.map((entry) => entry.file.sourceContainerId).filter(Boolean));
    const words = new Set(all.flatMap((entry) => tokenize(preClean(entry.file.name))).filter((word) => word.length >= 5 && !/\d/.test(word) && !PACK_GENERIC.has(word) && word !== prefix));
    return { prefix, folders, words };
}

function shareWord(a, b) {
    for (const x of a.words) for (const y of b.words) if (x === y || (Math.abs(x.length - y.length) <= 2 && jaroWinkler(x, y) >= 0.92)) return true;
    return false;
}

function shareFolder(a, b) {
    return [...a.folders].some((folder) => b.folders.has(folder));
}

function packName(groupsInPack) {
    const all = groupsInPack.flatMap((group) => [...group.entries, ...group.stems]);
    const segments = all.map((entry) => segmentsOf(preClean(entry.file.name)).map((tokens) => tokens.join(' ')));
    const prefixes = new Set(segments.map((list) => (list.length > 1 ? list[0] : '')));
    if (prefixes.size === 1 && [...prefixes][0]) {
        const prefix = [...prefixes][0];
        const second = new Map();
        for (const list of segments) if (list.length > 2) second.set(list[1], (second.get(list[1]) || 0) + 1);
        const [top, count] = [...second.entries()].sort((a, b) => b[1] - a[1])[0] || [];
        return titleCase(top && count * 2 >= all.length ? `${prefix} - ${top}` : prefix);
    }
    // No shared prefix: the words every member's name has ("Gargoyle Patches").
    const lists = groupsInPack.map((group) => tokenize(preClean([...group.entries, ...group.stems][0].file.name)));
    const shared = lists[0].filter((word) => lists.every((list) => list.includes(word)) && !/\d/.test(word));
    return shared.length ? titleCase(shared.join(' ')) : null;
}

function consolidatePacks(groups) {
    const packs = groups.filter((group) => kindOf(group) === 'sample-pack').map((group) => ({ group, info: packInfo(group) }));
    const parent = packs.map((_, index) => index);
    const find = (index) => (parent[index] === index ? index : (parent[index] = find(parent[index])));
    for (let i = 0; i < packs.length; i += 1) {
        for (let j = i + 1; j < packs.length; j += 1) {
            const a = packs[i].info;
            const b = packs[j].info;
            const samePrefix = a.prefix && a.prefix === b.prefix;
            // "Ev - …" and "EV PERC ROLLS - …" in one folder: prefixes that start with the same word.
            const sameFirstWord = a.prefix && b.prefix && a.prefix.split(' ')[0] === b.prefix.split(' ')[0];
            const sameUserPack = packs[i].group.entries.concat(packs[i].group.stems).some((entry) => entry.userPack && packs[j].group.entries.concat(packs[j].group.stems).some((other) => other.userPack === entry.userPack));
            if (sameUserPack || ((samePrefix || sameFirstWord) && shareFolder(a, b)) || (shareWord(a, b) && (samePrefix || shareFolder(a, b)))) parent[find(i)] = find(j);
        }
    }
    const byRoot = new Map();
    packs.forEach((pack, index) => {
        if (!byRoot.has(find(index))) byRoot.set(find(index), []);
        byRoot.get(find(index)).push(pack);
    });
    const merged = [];
    for (const members of byRoot.values()) {
        const target = members[0].group;
        target.forcedKind = 'sample-pack';
        if (members.length > 1) {
            const name = packName(members.map((member) => member.group));
            const strip = (text) => (name && text.toLowerCase().startsWith(`${name.toLowerCase()} - `) ? text.slice(name.length + 3) : text);
            target.packContents = members.map((member) => strip(displayNameFor(member.group, ''))).filter(Boolean);
            target.packName = name;
            for (const member of members.slice(1)) {
                target.entries.push(...member.group.entries);
                target.stems.push(...member.group.stems);
                groups.splice(groups.indexOf(member.group), 1);
            }
        }
        merged.push({ group: target, info: packInfo(target), oneShots: [...target.entries, ...target.stems].some((entry) => entry.packOneShot) });
    }
    // Neighbours of a pack go to review.
    for (const group of groups) {
        if (group.forcedKind === 'sample-pack') continue;
        const info = packInfo(group);
        // In a folder of one-shots with the pack's prefix, or sharing the pack's distinctive word.
        const pack = merged.find((candidate) => info.prefix && info.prefix === candidate.info.prefix && ((candidate.oneShots && shareFolder(info, candidate.info)) || shareWord(info, candidate.info)));
        if (pack) group.review = `Beside the sample pack “${pack.group.packName || displayNameFor(pack.group, '')}”: part of the pack, or a song of its own? Please decide.`;
    }
}

// ── The producer's corrections, applied first (user rules from marks) ──
// apart: a group holding two or more of these files falls back to the app's exact names;
// remove: a file leaves the song it was marked wrong in; together: these files are one song.
function applyUserFileRules(groups, rules) {
    const members = (group) => [...group.entries, ...group.stems];
    const names = (group) => new Set(members(group).map((entry) => entry.file.name));
    for (const list of rules.apart) {
        for (const group of [...groups]) {
            const own = names(group);
            if (list.filter((name) => own.has(name)).length < 2) continue;
            const byIdentity = new Map();
            for (const entry of members(group)) {
                const identity = fileIdentity(entry.file) || entry.file.fileId;
                if (!byIdentity.has(identity)) byIdentity.set(identity, []);
                byIdentity.get(identity).push(entry);
            }
            if (byIdentity.size < 2) continue;
            groups.splice(groups.indexOf(group), 1);
            for (const [identity, part] of byIdentity) {
                const anchors = part.filter((entry) => !isStemEntry(entry));
                groups.push({ key: `user-apart:${identity}`, entries: anchors.length ? anchors : part, stems: anchors.length ? part.filter((entry) => isStemEntry(entry)) : [], namespaceConflict: false, userSplit: true });
            }
        }
    }
    for (const rule of rules.remove) {
        for (const group of [...groups]) {
            const own = names(group);
            if (!own.has(rule.file) || !rule.from.some((name) => name !== rule.file && own.has(name))) continue;
            const leaving = members(group).filter((entry) => entry.file.name === rule.file);
            group.entries = group.entries.filter((entry) => !leaving.includes(entry));
            group.stems = group.stems.filter((entry) => !leaving.includes(entry));
            groups.push({ key: `user-remove:${rule.file}`, entries: leaving.map((entry) => ({ ...entry, analysis: { ...entry.analysis, isStemName: false } })), stems: [], namespaceConflict: false, userSplit: true });
            if (!group.entries.length && !group.stems.length) groups.splice(groups.indexOf(group), 1);
        }
    }
    for (const list of rules.together) {
        const wanted = new Set(list);
        const holding = groups.filter((group) => members(group).some((entry) => wanted.has(entry.file.name)));
        if (holding.length < 1) continue;
        const target = holding.find((group) => group.entries.length) || holding[0];
        for (const group of holding) {
            if (group === target) continue;
            target.entries.push(...group.entries);
            target.stems.push(...group.stems);
            if (group.stemOnly && !target.stemOnly) target.stemOnly = false;
            groups.splice(groups.indexOf(group), 1);
        }
        if (target.stemOnly && target.entries.length) target.stemOnly = false;
        target.userJoined = true;
    }
}

// ── Display names (IMP-FN-007-R14) ──
// The canonical identity is for comparison only. A song is shown under the producer's own, most
// complete title with only the noise taken out: formats, specs, the backup marker, version, stage,
// render and edit words, takes and tempos, repeats, stem parts and contributors named inside a
// version ("… Theo Adds"). Series, dates, categories and clients stay ("Morning 5 - Monday Nov 27",
// not "Nov 27").
const NOISE_RULES = new Set(['format', 'tech', 'marker', 'version', 'stage', 'render', 'edit', 'repeat', 'descriptor', 'stem', 'contributor']);
// When the full clean leaves one word, a lighter clean keeps the producer's fuller title.
const LIGHT_NOISE_RULES = new Set(['format', 'tech', 'marker', 'version', 'stage']);

function cleanDisplayName(entry, keepNumbers = [], rules = NOISE_RULES) {
    const noise = new Map();
    for (const step of entry.analysis.removed) {
        if (!NOISE_RULES.has(step.rule)) continue;
        // Takes and tempos are noise even inside a segment kept by the lighter clean.
        const words = step.words.split(' ').filter(Boolean).filter((word) => rules.has(step.rule) || /^\d+$/.test(word));
        for (const word of words) noise.set(word, (noise.get(word) || 0) + 1);
    }
    // Numbers that tell this song from its namesakes ("Sky Night 21") stay in the name.
    for (const number of keepNumbers) if (noise.get(number)) noise.set(number, noise.get(number) - 1);
    const segments = segmentsOf(preClean(entry.file.name, { video: entry.file.type === 'videos' })).map((tokens) => [...tokens]);
    for (let s = segments.length - 1; s >= 0; s -= 1) {
        for (let t = segments[s].length - 1; t >= 0; t -= 1) {
            const token = segments[s][t];
            if (!noise.get(token)) continue;
            noise.set(token, noise.get(token) - 1);
            segments[s].splice(t, 1);
        }
    }
    // A contributor's pattern word left at the end ("… For", "… Feat") goes with the name.
    for (const tokens of segments) while (tokens.length > 1 && ['for', 'feat', 'ft', 'w', 'with'].includes(tokens[tokens.length - 1])) tokens.pop();
    return segments
        .filter((tokens) => tokens.length && !(tokens.length === 1 && ['for', 'feat', 'ft', 'w', 'with'].includes(tokens[0])))
        .map((tokens) => titleCase(tokens.join(' ')))
        .join(' - ');
}

function wordCount(text) {
    return text.split(/[\s-]+/).filter(Boolean).length;
}

function bestName(source, keepNumbers, rules) {
    const counts = new Map();
    for (const entry of source) {
        const name = cleanDisplayName(entry, keepNumbers, rules);
        if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => wordCount(b[0]) - wordCount(a[0]) || b[1] - a[1] || a[0].localeCompare(b[0]));
    return ranked[0]?.[0] || '';
}

// A set of stems is shown under the name its files share ("Storm - Vln" for "Storm - Vln - Violin 1", …).
function sharedName(source) {
    const lists = source.map((entry) => segmentsOf(preClean(entry.file.name)).map((tokens) => tokens.join(' ')));
    const shared = [];
    for (let index = 0; lists.every((list) => index < list.length - 1 && list[index] === lists[0][index]); index += 1) shared.push(lists[0][index]);
    return shared.map(titleCase).join(' - ');
}

function displayNameFor(group, fallback) {
    const source = group.entries.length ? group.entries : group.stems;
    const keepNumbers = [...numberSet(group.numberKey)];
    if (group.packName) return group.packName;
    // A standalone idea keeps its part words ("Kelp Piano Vox").
    if (group.standaloneIdea) return bestName(source, keepNumbers, LIGHT_NOISE_RULES) || fallback;
    // One-shots keep their sound's name ("Big Snare").
    if (source.every((entry) => entry.packOneShot)) return bestName(source, keepNumbers, new Set([...NOISE_RULES].filter((rule) => rule !== 'stem'))) || fallback;
    if (group.stemOnly && source.length > 1 && new Set(source.map((entry) => preClean(entry.file.name))).size > 1) {
        const shared = sharedName(source);
        if (wordCount(shared) > 1) return shared;
    }
    const full = bestName(source, keepNumbers, NOISE_RULES);
    if (wordCount(full) > 1 && !isGenericTitle(full.toLowerCase())) return full;
    const light = bestName(source, keepNumbers, LIGHT_NOISE_RULES);
    return (wordCount(light) > wordCount(full) ? light : full) || fallback;
}

function folderName(song) {
    const parents = song.files.map((member) => String(member.sourceRelativePath || '').split('/').slice(-2, -1)[0]).filter(Boolean);
    const counts = new Map();
    for (const parent of parents) counts.set(parent, (counts.get(parent) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function monthOf(song) {
    const newest = song.files.map((member) => member.modifiedAt).filter(Boolean).sort().pop();
    if (!newest) return null;
    const date = new Date(newest);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// Two songs never share a display name: the folder, then the month, then a number tells them apart.
function makeNamesUnique(songs) {
    const byName = new Map();
    for (const song of songs) {
        const key = song.displayName.toLowerCase();
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push(song);
    }
    const taken = new Set(songs.map((song) => song.displayName.toLowerCase()));
    for (const same of byName.values()) {
        if (same.length < 2) continue;
        for (const song of same) {
            const options = [folderName(song), monthOf(song)].filter(Boolean).map((extra) => `${song.displayName} (${extra})`);
            const free = options.find((option) => !taken.has(option.toLowerCase()) && same.filter((other) => other !== song).every((other) => ![folderName(other), monthOf(other)].filter(Boolean).map((extra) => `${other.displayName} (${extra})`.toLowerCase()).includes(option.toLowerCase())));
            let name = free;
            for (let index = 2; !name; index += 1) if (!taken.has(`${song.displayName} (${index})`.toLowerCase())) name = `${song.displayName} (${index})`;
            taken.add(name.toLowerCase());
            song.uniqueName = name;
        }
    }
    for (const song of songs) {
        if (song.uniqueName) song.displayName = song.uniqueName;
        delete song.uniqueName;
        song.songName = song.displayName;
    }
}

// ── Songs ──

// The kind of most of a song's files decides its kind: one course demo of a composition does
// not hide the composition.
function fileKind(entry) {
    const tokens = new Set(tokenize(entry.file.name));
    const text = [...tokens].join(' ');
    if (KINDS.templateWords.some((word) => tokens.has(word))) return 'template';
    if (KINDS.courseWords.some((word) => tokens.has(word)) || entry.course) return 'course';
    // A jam or idea word outranks pack words ("Synth Jam - Testing Out Pulsar Patches" is a jam).
    if (KINDS.ideaWords.some((word) => tokens.has(word))) return 'song';
    if (KINDS.samplePackWords.some((word) => tokens.has(word)) || KINDS.samplePackPhrases.some((phrase) => text.includes(phrase))) return 'sample-pack';
    return 'song';
}

function kindOf(group) {
    if (group.forcedKind) return group.forcedKind;
    const all = [...group.entries, ...group.stems];
    if (all.every((entry) => entry.packOneShot)) return 'sample-pack';
    const counts = {};
    for (const entry of all) counts[fileKind(entry)] = (counts[fileKind(entry)] || 0) + 1;
    const [topKind, topCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (topKind !== 'song' && topCount * 2 > all.length) return topKind;
    // A family of numbered or note-named sounds with no project: one-shots or drones.
    const notes = new Set(KINDS.noteTokens);
    const family = group.entries.filter((entry) => entry.file.type !== 'projects');
    const labelled = family.filter((entry) => {
        const words = entry.analysis.label.split(' ').filter(Boolean);
        return words.length > 0 && words.every((word) => /^\d+$/.test(word) || notes.has(word));
    });
    if (group.entries.length >= KINDS.samplePackFamilyMin && !group.entries.some((entry) => entry.file.type === 'projects') && labelled.length >= KINDS.samplePackFamilyMin) return 'sample-pack';
    if (group.stemOnly) return 'stem-set';
    return 'song';
}

function nameRuleReasons(group) {
    const used = new Map();
    for (const entry of [...group.entries, ...group.stems]) {
        for (const step of entry.analysis.removed) {
            if (step.rule === 'stem') continue;
            if (!used.has(step.rule)) used.set(step.rule, new Set());
            used.get(step.rule).add(step.words);
        }
    }
    return used;
}

function buildSong(group, { mergeRule, rules = userRules.emptyRules() }) {
    const anchors = group.entries;
    const all = [...anchors, ...group.stems];
    const first = anchors[0] || group.stems[0];
    const title = [first.analysis.title, group.numberKey].filter(Boolean).join(' ');
    const namespace = anchors.map((entry) => entry.analysis.namespace).find(Boolean) || null;
    const memberNames = new Set(all.map((entry) => entry.file.name));
    const renamed = rules.names.find((rule) => rule.files.length && rule.files.filter((name) => memberNames.has(name)).length * 2 >= rule.files.length);
    const songName = renamed ? renamed.name : displayNameFor(group, titleCase(title || first.file.name.replace(/\.[^.]+$/, '')));
    const weights = scoring.weights;
    const reasons = [];
    const clueTypes = new Set();

    // Identity: do the anchors share the main app's canonical identity?
    const appIdentities = new Set(anchors.map((entry) => fileIdentity(entry.file)).filter(Boolean));
    const exact = anchors.length > 0 && appIdentities.size === 1 && !first.analysis.generic && !first.analysis.weak;
    let identityConfidence = 0;
    if (anchors.length <= 1 && !group.stems.length) {
        identityConfidence = first.analysis.weak ? 0.3 : weights.exactIdentity;
        reasons.push({ clue: 'canonical-name', weight: identityConfidence, text: first.analysis.weak ? 'The name holds no song title once version and stage words are set aside, so this needs a check.' : `One file named “${songName}”.` });
    } else if (exact) {
        identityConfidence = weights.exactIdentity;
        reasons.push({ clue: 'canonical-name', weight: identityConfidence, text: `The bounces and projects have the same name in the app's own name cleaning: “${[...appIdentities][0]}”.` });
    } else if (anchors.length) {
        const rules = nameRuleReasons({ entries: anchors, stems: [] });
        const ruleWeights = [...rules.keys()].map((rule) => weights.nameRules[rule] ?? 0.8);
        identityConfidence = ruleWeights.length ? Math.min(...ruleWeights) : 0.8;
        const examples = [...rules.entries()]
            .filter(([rule]) => RULE_TEXT[rule])
            .map(([rule, words]) => `${RULE_TEXT[rule]} (${[...words].slice(0, 3).map((word) => `“${word}”`).join(', ')})`);
        reasons.push({ clue: 'canonical-name', weight: identityConfidence, text: `The same title “${title}” once ${examples.join('; ') || 'small differences'} are set aside.` });
    }
    clueTypes.add('canonical-name');

    if (group.stems.length) {
        const batch = group.stems.some((stem) => stem.viaBatch);
        reasons.push({ clue: 'stem-set', weight: batch ? weights.exportBatch : 0.85, text: batch ? `${group.stems.length} stems were exported together with a mix of this song.` : `${group.stems.length} stem${group.stems.length === 1 ? ' is' : 's are'} named after this song.` });
        if (batch) clueTypes.add('stem-set');
    }

    const folders = new Set(anchors.map((entry) => entry.file.sourceContainerId).filter(Boolean));
    let otherConfidence = 1;
    if (anchors.length > 1 && folders.size === 1 && anchors.every((entry) => entry.file.sourceContainerId)) {
        reasons.push({ clue: 'folder', weight: weights.folder, text: 'All these files are in the same folder.' });
        clueTypes.add('folder');
        otherConfidence *= 1 - weights.folder;
    }
    if (group.namespaceConflict) reasons.push({ clue: 'canonical-name', weight: 0, text: 'Another client or collaborator prefix uses the same title, so they are kept apart for a check.' });
    if (group.stemOnly) reasons.push({ clue: 'stem-set', weight: 0, text: 'Stems with no bounce or project of the same name: shown as a stem set, not as a song.' });
    if (group.packContents) reasons.push({ clue: 'canonical-name', weight: 0, text: `One sample pack: ${group.packContents.join(', ')}.` });
    if (group.review) reasons.push({ clue: 'canonical-name', weight: 0, text: group.review });
    if (group.standaloneIdea) reasons.push({ clue: 'canonical-name', weight: 0, text: 'Named like a part (vox, piano, strings…), but nothing else from this song exists, so it is an idea of its own.' });

    const confidence = anchors.length ? 1 - (1 - identityConfidence) * otherConfidence : 0.3;
    const bands = scoring.bands;
    let band;
    if (group.userJoined) reasons.push({ clue: 'canonical-name', weight: 1, text: 'You said these files are one song (your marks, kept as a rule).' });
    if (group.userSplit) reasons.push({ clue: 'canonical-name', weight: 1, text: 'Kept apart because you marked a wrong merge here (a rule from your marks).' });
    if (group.tailJoin) reasons.push({ clue: 'canonical-name', weight: 0, text: 'One name is the other plus a version tail (a number or "sample"): joined as versions, please check.' });
    if (group.takeJoin) reasons.push({ clue: 'canonical-name', weight: 0, text: 'Takes with different numbers in different folders: joined as versions, please check.' });
    if (group.userJoined && !group.review) band = 'sure';
    else if (group.stemOnly || first.analysis.weak || group.review) band = 'unclear';
    else if (group.takeJoin || group.tailJoin) band = 'unsure';
    else if (first.analysis.generic) band = anchors.length > 1 ? 'unsure' : 'sure';
    else if (group.namespaceConflict) band = 'unsure';
    else if (exact || (anchors.length <= 1 && !group.stems.some((stem) => stem.viaBatch))) band = 'sure';
    else if (mergeRule === 'multi-clue' && confidence >= bands.sure && clueTypes.size >= bands.minClueTypes) band = 'sure';
    else band = confidence >= bands.unsure ? 'unsure' : 'unclear';

    const ownNumbers = numberSet(group.numberKey);
    const labelOf = (entry) => titleCase((entry.analysis.label || '').split(' ').filter((word) => !ownNumbers.has(word)).join(' '));
    const files = all.map((entry) => ({ ...entry.file, versionLabel: labelOf(entry) || null, stemPart: entry.analysis.stemPart || null }));
    const versions = groupVersions(anchors, labelOf);
    const bounces = anchors.filter((entry) => entry.file.type === 'bounces').sort((a, b) => String(b.file.modifiedAt).localeCompare(String(a.file.modifiedAt)));
    const latestId = bounces[0]?.file.fileId || null;
    for (const member of files) member.latest = member.fileId === latestId;

    return {
        proposalId: hash(`${group.key}${group.numberKey ? `#${group.numberKey}` : ''}|${namespace || ''}|${group.stemOnly ? 'stems' : ''}|${anchors.map((entry) => entry.analysis.namespace || '').sort().join(',')}`),
        songName,
        displayName: songName,
        canonicalIdentity: title,
        namespace,
        kind: kindOf(group),
        band,
        confidence: Math.round(confidence * 1000) / 1000,
        precheck: band === 'unsure' && confidence >= bands.precheck,
        reasons,
        files,
        versions,
        stemSets: stemSets(group.stems, anchors, latestId),
        possibleMatches: [],
        review: Boolean(group.review),
        facts: {},
        decidedBy: 'rules',
        isAnchor: anchors.some((entry) => entry.file.type === 'bounces' || entry.file.type === 'projects'),
        _title: title,
        _namespace: namespace,
        _dateKeyed: Boolean(first.analysis.dateKeyed)
    };
}

function groupVersions(anchors, labelOf) {
    const versions = new Map();
    for (const entry of anchors) {
        const label = labelOf(entry) || 'Main';
        if (!versions.has(label)) versions.set(label, []);
        versions.get(label).push(entry.file.fileId);
    }
    return [...versions.entries()].map(([label, fileIds]) => ({ label, fileIds }));
}

function stemSets(stems, anchors, latestId) {
    const sets = new Map();
    for (const stem of stems) {
        const label = titleCase(stem.analysis.label || '') || 'Stems';
        if (!sets.has(label)) sets.set(label, []);
        sets.get(label).push({ ...stem.file, stemPart: stem.analysis.stemPart });
    }
    return [...sets.entries()].map(([label, files]) => {
        const sameLabel = anchors.find((entry) => (titleCase(entry.analysis.label || '') || 'Stems') === label && entry.file.type === 'bounces');
        return { label, matchesFileId: sameLabel?.file.fileId || latestId || undefined, files };
    });
}

// Similar names are only ever proposed for review (IMP-FN-007-R14; FINDINGS row 18). Titles that
// name a day ("Tuesday Oct 10") are never proposed against each other: different dates in a series
// are different sessions by design.
function proposeSimilarNames(songs) {
    const candidates = songs.filter((song) => song.kind === 'song' && song._title && song._title.length >= scoring.similarNames.minLength && !song._dateKeyed);
    for (let i = 0; i < candidates.length; i += 1) {
        for (let j = i + 1; j < candidates.length; j += 1) {
            const a = candidates[i];
            const b = candidates[j];
            // Under different prefixes only a word-by-word misspelling is suggested ("Sailin Slow Driftin
            // Home" for "Sailing Sloww Drifting Home": possibly the vocal of the same song).
            const similar = (a._namespace || '') === (b._namespace || '') ? similarReason(a._title, b._title) || wordByWordReason(a._title, b._title) : wordByWordReason(a._title, b._title);
            if (!similar) continue;
            addMatch(a, b, similar.reason, similar.weight);
        }
    }
}

function similarReason(a, b) {
    if (a === b) return null;
    // Titles that differ only in their numbers ("Lantern 164", "Lantern 156") are different songs.
    const withoutNumbers = (title) => title.replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
    if (/\d/.test(a + b) && withoutNumbers(a) === withoutNumbers(b)) return null;
    if (a + 's' === b || b + 's' === a) return { reason: 'Names differ only by a plural "s".', weight: 0.9 };
    const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
    if (longer.startsWith(`${shorter} `) && longer.split(' ').length === shorter.split(' ').length + 1) return { reason: `“${longer}” is “${shorter}” plus one word.`, weight: 0.75 };
    if (Math.abs(a.length - b.length) <= 2 && jaroWinkler(a, b) >= scoring.similarNames.jaroWinkler && !isGenericTitle(a)) return { reason: 'Names are spelled almost the same.', weight: 0.85 };
    return null;
}

// Same number of words (three or more, after up to two leading prefix words), each pair spelled
// almost the same, at least one different.
function wordByWordReason(a, b) {
    let left = a.split(' ');
    let right = b.split(' ');
    // A prefix the catalog has not learned ("Quill sailin slow …") may lead the longer title.
    if (Math.abs(left.length - right.length) <= 2) [left, right] = left.length > right.length ? [left.slice(left.length - right.length), right] : [left, right.slice(right.length - left.length)];
    if (left.join(' ') === right.join(' ') || left.length < 3 || left.length !== right.length) return null;
    const close = left.every((word, index) => word === right[index] || (word.length >= 3 && right[index].length >= 3 && !/\d/.test(word + right[index]) && jaroWinkler(word, right[index]) >= 0.88));
    return close ? { reason: 'The words are spelled almost the same, one by one.', weight: 0.7 } : null;
}

function linkCourseTwins(songs, groups) {
    const byTwin = new Map();
    groups.forEach((group, index) => {
        if (!group.courseTwin) return;
        if (!byTwin.has(group.courseTwin)) byTwin.set(group.courseTwin, []);
        byTwin.get(group.courseTwin).push(songs[index]);
    });
    for (const [twin, pair] of byTwin) {
        if (pair.length !== 2) continue;
        const reason = twin.startsWith('course-twin:') ? 'Course material with the same title: perhaps a course demo of this song.' : 'The same name: a dated session of this song?';
        addMatch(pair[0], pair[1], reason, 0.8);
    }
}

function addMatch(a, b, reason, weight) {
    const existing = a.possibleMatches.find((match) => match.proposalId === b.proposalId);
    if (existing) {
        if (weight > existing.weight) Object.assign(existing, { reason, weight });
        const other = b.possibleMatches.find((match) => match.proposalId === a.proposalId);
        if (other && weight > other.weight) Object.assign(other, { reason, weight });
        return;
    }
    a.possibleMatches.push({ proposalId: b.proposalId, songName: b.songName, reason, weight });
    b.possibleMatches.push({ proposalId: a.proposalId, songName: a.songName, reason, weight });
}

// Links from the clue readers (shared samples, timing, duplicates) between different songs. Each song
// then keeps its three strongest suggestions.
const MAX_SUGGESTIONS = 3;

function applyClueLinks(songs, links, mergeRule) {
    const songOfFile = new Map();
    for (const song of songs) for (const member of song.files) songOfFile.set(member.fileId, song);
    for (const link of links.filter((candidate) => candidate.clue !== 'exportBatch')) {
        const a = songOfFile.get(link.fileIds[0]);
        const b = songOfFile.get(link.fileIds[1]);
        if (!a || !b) continue;
        if (a === b) {
            if (!a.reasons.some((reason) => reason.clue === link.clue)) a.reasons.push({ clue: link.clue, weight: link.weight, text: link.text });
            continue;
        }
        addMatch(a, b, link.text, link.weight);
    }
    for (const song of songs) {
        song.possibleMatches = song.possibleMatches.sort((x, y) => y.weight - x.weight || x.songName.localeCompare(y.songName)).slice(0, MAX_SUGGESTIONS);
        delete song._title;
        delete song._namespace;
        delete song._dateKeyed;
    }
    return mergeRule;
}

// Songs already in the Library: exact canonical identity only (IMP-FN-007-R14), never fuzzy.
function matchExistingSongs(songs, existingSongs) {
    if (!existingSongs.length) return;
    const byIdentity = new Map();
    for (const existing of existingSongs) {
        const identity = canonicalSongIdentity(existing.displayName || existing.songName);
        if (!identity) continue;
        if (!byIdentity.has(identity)) byIdentity.set(identity, []);
        byIdentity.get(identity).push(existing);
    }
    for (const song of songs.filter((candidate) => candidate.kind === 'song')) {
        const matches = byIdentity.get(canonicalSongIdentity(song.canonicalIdentity || song.songName)) || [];
        if (matches.length === 1) {
            song.existingSongId = matches[0].id;
            song.reasons.push({ clue: 'canonical-name', weight: 0, text: `Already in your Library as “${matches[0].displayName || matches[0].songName}”.` });
        } else if (matches.length > 1) {
            song.reasons.push({ clue: 'canonical-name', weight: 0, text: `${matches.length} songs in your Library have this name; choose one in review.` });
        }
    }
}

module.exports = { groupCatalog };
