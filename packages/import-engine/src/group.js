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

function learnNamespaces(files, courseNamespaces) {
    const learned = discoverNamespaces(files.map((member) => preClean(member.name)))
        .map(([prefix]) => prefix)
        .filter((prefix) => !CATEGORY_SET.has(prefix));
    return [...new Set([...learned, ...courseNamespaces.map((namespace) => namespace.toLowerCase())])];
}

// A contributor is a name seen in an explicit pattern — "<name> adds", "for <name>",
// "feat <name>", "ft <name>", "w <name>" — in at least two different files. Learning from
// insertions alone ("Sky Structure" vs "Sky") would merge different songs, so it is not used.
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
            member.entry.analysis = { ...member.entry.analysis, title, isStemName: true, stemPart: member.last, removed: [...member.entry.analysis.removed, { rule: 'stem', words: member.last }] };
            member.entry.siblingStem = true;
        }
    }
}

// ── Grouping ──

function isStemEntry(entry) {
    return AUDIO_EXTS.has(entry.file.ext) && entry.analysis.isStemName && entry.analysis.title !== '';
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
// there, or when the numbered files share a folder ("Sketch 1", "Sketch 2"). Numbered files in
// different folders with no plain title ("Sky Night 21", "Sky Night 41") stay apart: precision
// first, and similar names alone never merge. Without folder information nothing is split.
function splitByNumber(entries) {
    if (entries.some((entry) => !entry.analysis.bareNumber || !entry.file.sourceContainerId)) return [{ numberKey: '', entries }];
    const parts = [];
    for (const entry of entries) {
        const touching = parts.filter((part) => part.numbers.has(entry.analysis.bareNumber) || part.folders.has(entry.file.sourceContainerId));
        const merged = { numbers: new Set([entry.analysis.bareNumber]), folders: new Set([entry.file.sourceContainerId]), entries: [entry] };
        for (const part of touching) {
            part.numbers.forEach((number) => merged.numbers.add(number));
            part.folders.forEach((folder) => merged.folders.add(folder));
            merged.entries.unshift(...part.entries);
            parts.splice(parts.indexOf(part), 1);
        }
        parts.push(merged);
    }
    return parts.map((part) => ({ numberKey: part.numbers.size === 1 ? [...part.numbers][0] : '', entries: part.entries }));
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
    if (named.size <= 1) return [{ entries, namespaceConflict: false }];
    const unprefixed = entries.filter((entry) => !entry.analysis.namespace);
    const parts = [...named.values()].map((group) => ({ entries: group, namespaceConflict: true }));
    if (unprefixed.length) parts.push({ entries: unprefixed, namespaceConflict: true });
    return parts;
}

function groupCatalog(files, options = {}) {
    const { mergeRule = 'exact-identity-only', groupEdits = true, courseNamespaces = [], links = [], existingSongs = [] } = options;
    const nameOptions = { groupEdits };
    const namespaces = learnNamespaces(files, courseNamespaces);

    let ctx = createNameContext({ namespaces, courseNamespaces });
    const contributors = learnContributors(files);
    ctx = createNameContext({ namespaces, contributors, courseNamespaces });
    const courseSet = new Set(courseNamespaces.map((namespace) => namespace.toLowerCase()));
    const entries = files.map((member) => {
        const analysis = analyseName(member, ctx, nameOptions);
        return { file: member, analysis, course: Boolean(analysis.namespace && courseSet.has(analysis.namespace)) };
    });
    applySiblingStems(entries);

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
            for (const part of splitByNamespace(numbered.entries)) groups.push({ key, numberKey: numbered.numberKey, entries: part.entries, stems: [], namespaceConflict: part.namespaceConflict });
        }
    }

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
        const candidates = (byTitle.get(entry.analysis.title) || []).filter((group) => group.numberKey === '' || !entry.analysis.bareNumber || group.numberKey === entry.analysis.bareNumber);
        const sameNamespace = (member) => member.analysis.namespace === entry.analysis.namespace;
        const sameFolder = (member) => member.file.sourceContainerId && member.file.sourceContainerId === entry.file.sourceContainerId;
        const match =
            (candidates.length > 1 && candidates.find((group) => group.entries.some((member) => sameFolder(member) && sameNamespace(member)))) ||
            candidates.find((group) => group.numberKey === entry.analysis.bareNumber && group.entries.some(sameNamespace)) ||
            (candidates.length === 1 ? candidates[0] : null);
        if (match) match.stems.push(entry);
        else {
            const key = `stems:${entry.analysis.title}`;
            if (!stemOnly.has(key)) stemOnly.set(key, { key, entries: [], stems: [], namespaceConflict: false, stemOnly: true });
            stemOnly.get(key).stems.push(entry);
        }
    }
    groups.push(...stemOnly.values());

    attachExportBatches(groups, links);
    const songs = groups.map((group) => buildSong(group, { mergeRule, links }));
    proposeSimilarNames(songs);
    applyClueLinks(songs, links, mergeRule);
    matchExistingSongs(songs, existingSongs);
    return { songs, context: { namespaces, contributors, policyVersion: namePolicy.version, scoringVersion: scoring.version } };
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
        const mixes = members.filter((entry) => entry.file.type === 'bounces' && !isStemEntry(entry) && entry.analysis.title).sort((a, b) => a.analysis.title.length - b.analysis.title.length);
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

// ── Songs ──

// The kind of most of a song's files decides its kind: one course demo of a composition does
// not hide the composition.
function fileKind(entry) {
    const tokens = new Set(tokenize(entry.file.name));
    const text = [...tokens].join(' ');
    if (KINDS.templateWords.some((word) => tokens.has(word))) return 'template';
    if (KINDS.courseWords.some((word) => tokens.has(word)) || entry.course) return 'course';
    if (KINDS.samplePackWords.some((word) => tokens.has(word)) || KINDS.samplePackPhrases.some((phrase) => text.includes(phrase))) return 'sample-pack';
    return 'song';
}

function kindOf(group) {
    const all = [...group.entries, ...group.stems];
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

function buildSong(group, { mergeRule }) {
    const anchors = group.entries;
    const all = [...anchors, ...group.stems];
    const first = anchors[0] || group.stems[0];
    const title = [first.analysis.title, group.numberKey].filter(Boolean).join(' ');
    const namespace = anchors.map((entry) => entry.analysis.namespace).find(Boolean) || null;
    // A weak title ("340") keeps its category so the name still says what it is ("Song Idea 340").
    const shownTitle = first.analysis.weak && first.analysis.category && title ? `${first.analysis.category} ${title}` : title;
    const songName = titleCase(shownTitle || first.file.name.replace(/\.[^.]+$/, ''));
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

    const confidence = anchors.length ? 1 - (1 - identityConfidence) * otherConfidence : 0.3;
    const bands = scoring.bands;
    let band;
    if (group.stemOnly || first.analysis.weak) band = 'unclear';
    else if (first.analysis.generic) band = anchors.length > 1 ? 'unsure' : 'sure';
    else if (group.namespaceConflict) band = 'unsure';
    else if (exact || (anchors.length <= 1 && !group.stems.some((stem) => stem.viaBatch))) band = 'sure';
    else if (mergeRule === 'multi-clue' && confidence >= bands.sure && clueTypes.size >= bands.minClueTypes) band = 'sure';
    else band = confidence >= bands.unsure ? 'unsure' : 'unclear';

    const files = all.map((entry) => ({ ...entry.file, versionLabel: titleCase(entry.analysis.label || '') || null, stemPart: entry.analysis.stemPart || null }));
    const versions = groupVersions(anchors);
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
        facts: {},
        decidedBy: 'rules',
        isAnchor: anchors.some((entry) => entry.file.type === 'bounces' || entry.file.type === 'projects'),
        _title: title,
        _namespace: namespace
    };
}

function groupVersions(anchors) {
    const versions = new Map();
    for (const entry of anchors) {
        const label = titleCase(entry.analysis.label || '') || 'Main';
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

// Similar names are only ever proposed for review (IMP-FN-007-R14; FINDINGS row 18).
function proposeSimilarNames(songs) {
    const candidates = songs.filter((song) => song.kind === 'song' && song._title && song._title.length >= scoring.similarNames.minLength);
    for (let i = 0; i < candidates.length; i += 1) {
        for (let j = i + 1; j < candidates.length; j += 1) {
            const a = candidates[i];
            const b = candidates[j];
            if ((a._namespace || '') !== (b._namespace || '')) continue;
            const reason = similarReason(a._title, b._title);
            if (!reason) continue;
            a.possibleMatches.push({ proposalId: b.proposalId, songName: b.songName, reason });
            b.possibleMatches.push({ proposalId: a.proposalId, songName: a.songName, reason });
        }
    }
}

function similarReason(a, b) {
    if (a === b) return null;
    if (a + 's' === b || b + 's' === a) return 'Names differ only by a plural "s".';
    const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
    if (longer.startsWith(`${shorter} `) && longer.split(' ').length === shorter.split(' ').length + 1) return `“${longer}” is “${shorter}” plus one word.`;
    if (Math.abs(a.length - b.length) <= 2 && jaroWinkler(a, b) >= scoring.similarNames.jaroWinkler && !isGenericTitle(a)) return 'Names are spelled almost the same.';
    return null;
}

// Links from the clue readers (shared samples, timing, duplicates) between different songs.
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
        if (!a.possibleMatches.some((match) => match.proposalId === b.proposalId)) {
            a.possibleMatches.push({ proposalId: b.proposalId, songName: b.songName, reason: link.text });
            b.possibleMatches.push({ proposalId: a.proposalId, songName: a.songName, reason: link.text });
        }
    }
    for (const song of songs) {
        delete song._title;
        delete song._namespace;
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
        const matches = byIdentity.get(canonicalSongIdentity(song.songName)) || [];
        if (matches.length === 1) {
            song.existingSongId = matches[0].id;
            song.reasons.push({ clue: 'canonical-name', weight: 0, text: `Already in your Library as “${matches[0].displayName || matches[0].songName}”.` });
        } else if (matches.length > 1) {
            song.reasons.push({ clue: 'canonical-name', weight: 0, text: `${matches.length} songs in your Library have this name; choose one in review.` });
        }
    }
}

module.exports = { groupCatalog };
