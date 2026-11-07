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

// One-shot sounds ("STORM - CLAPS", "Kick 2", "Hip Hop Kit"): a short name with a one-shot word.
const ONE_SHOT_WORDS = new Set(KINDS.oneShotWords);

function isOneShotName(entry) {
    if (!AUDIO_EXTS.has(entry.file.ext)) return false;
    const words = `${entry.analysis.title} ${entry.analysis.stemPart || ''}`.split(' ').filter((word) => word && !/^\d+$/.test(word));
    return words.length > 0 && words.length <= KINDS.oneShotMaxWords && words.some((word) => ONE_SHOT_WORDS.has(word));
}

// A pack-like folder holds several one-shot sounds and no project: its one-shots are a sample
// pack, never a song (and never the mix of an export batch).
function packFolders(entries) {
    const byFolder = new Map();
    for (const entry of entries) {
        const folder = entry.file.sourceContainerId;
        if (!folder) continue;
        if (!byFolder.has(folder)) byFolder.set(folder, { oneShots: 0, projects: 0 });
        const stats = byFolder.get(folder);
        if (entry.file.type === 'projects') stats.projects += 1;
        else if (isOneShotName(entry)) stats.oneShots += 1;
    }
    return new Set([...byFolder].filter(([, stats]) => stats.projects === 0 && stats.oneShots >= KINDS.packFolderMinFiles).map(([folder]) => folder));
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
// there, when the numbered files share a folder ("Sketch 1", "Sketch 2"), or when one file's numbers
// contain the other's ("… 80 Project" and "… 80 1"). Numbered files in different folders with no
// plain title and no shared number ("Sky Night 21", "Sky Night 41") stay apart: precision first, and
// similar names alone never merge. Without folder information nothing is split.
function numberSet(text) {
    return new Set(String(text || '').split(' ').filter(Boolean));
}

function numbersContain(a, b) {
    const [small, large] = numberSet(a).size <= numberSet(b).size ? [numberSet(a), numberSet(b)] : [numberSet(b), numberSet(a)];
    return small.size > 0 && [...small].every((number) => large.has(number));
}

function commonNumbers(numbers) {
    const sets = [...numbers].map(numberSet);
    return [...sets[0]].filter((number) => sets.every((set) => set.has(number))).join(' ');
}

function splitByNumber(entries) {
    if (entries.some((entry) => !entry.analysis.bareNumber || !entry.file.sourceContainerId)) return [{ numberKey: '', entries }];
    const parts = [];
    for (const entry of entries) {
        const touching = parts.filter((part) => [...part.numbers].some((number) => numbersContain(number, entry.analysis.bareNumber)) || part.folders.has(entry.file.sourceContainerId));
        const merged = { numbers: new Set([entry.analysis.bareNumber]), folders: new Set([entry.file.sourceContainerId]), entries: [entry] };
        for (const part of touching) {
            part.numbers.forEach((number) => merged.numbers.add(number));
            part.folders.forEach((folder) => merged.folders.add(folder));
            merged.entries.unshift(...part.entries);
            parts.splice(parts.indexOf(part), 1);
        }
        parts.push(merged);
    }
    return parts.map((part) => ({ numberKey: commonNumbers(part.numbers), entries: part.entries }));
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
    const { mergeRule = 'exact-identity-only', groupEdits = true, courseNamespaces = [], declinedCoursePrefixes = [], links = [], existingSongs = [] } = options;
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
    const packs = packFolders(entries);
    for (const entry of entries) entry.packOneShot = packs.has(entry.file.sourceContainerId) && isOneShotName(entry);

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

    attachExportBatches(groups, links);
    const looseStems = settleLoneStems(groups);
    const songs = groups.map((group) => buildSong(group, { mergeRule, links }));
    makeNamesUnique(songs);
    proposeSimilarNames(songs);
    applyClueLinks(songs, links, mergeRule);
    matchExistingSongs(songs, existingSongs);
    const courseSuggestions = detectCoursePrefixes(files, { contributors, known: courseNamespaces, declined: declinedCoursePrefixes });
    return { songs, looseStems, context: { namespaces, contributors, courseSuggestions, policyVersion: namePolicy.version, scoringVersion: scoring.version } };
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

// A stem set of one stem is a lone stem. After the exact name and the export batch, it may join a
// song in the same folder whose title begins or ends its own ("Glasshouse" for "Glasshouse Choir
// Take"); otherwise it is a loose stem for review, never an entry of its own.
function settleLoneStems(groups) {
    const loose = [];
    const songsInFolder = new Map();
    for (const group of groups) {
        if (group.stemOnly || !group.key.startsWith('title:')) continue;
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
        const near = [...(songsInFolder.get(stem.file.sourceContainerId) || [])].filter((candidate) => {
            const other = candidate.entries[0].analysis.title;
            const sameNamespace = candidate.entries.some((entry) => entry.analysis.namespace === stem.analysis.namespace);
            return sameNamespace && other && (title.startsWith(`${other} `) || title.endsWith(` ${other}`) || other.startsWith(`${title} `));
        });
        groups.splice(index, 1);
        if (near.length === 1) near[0].stems.push({ ...stem, viaFolder: true });
        else loose.push({ ...stem.file, stemPart: stem.analysis.stemPart || null, reason: near.length > 1 ? 'Several songs in its folder have a similar name; choose one in review.' : 'A stem with no song of the same name in its folder or export batch.' });
    }
    return loose;
}

// ── Display names (IMP-FN-007-R14) ──
// The canonical identity is for comparison only. A song is shown under the producer's own, most
// complete title with only the noise taken out: formats, specs, the backup marker, version, stage,
// render and edit words, takes and tempos, repeats and stem parts. Series, dates, categories,
// clients and contributors stay ("Morning 5 - Monday Nov 27", not "Nov 27").
const NOISE_RULES = new Set(['format', 'tech', 'marker', 'version', 'stage', 'render', 'edit', 'repeat', 'descriptor', 'stem']);
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
    return segments
        .filter((tokens) => tokens.length)
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
    if (KINDS.samplePackWords.some((word) => tokens.has(word)) || KINDS.samplePackPhrases.some((phrase) => text.includes(phrase))) return 'sample-pack';
    return 'song';
}

function kindOf(group) {
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

function buildSong(group, { mergeRule }) {
    const anchors = group.entries;
    const all = [...anchors, ...group.stems];
    const first = anchors[0] || group.stems[0];
    const title = [first.analysis.title, group.numberKey].filter(Boolean).join(' ');
    const namespace = anchors.map((entry) => entry.analysis.namespace).find(Boolean) || null;
    const songName = displayNameFor(group, titleCase(title || first.file.name.replace(/\.[^.]+$/, '')));
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
            if ((a._namespace || '') !== (b._namespace || '')) continue;
            const similar = similarReason(a._title, b._title);
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
