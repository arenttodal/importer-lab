'use strict';

// The engine pipeline (SPEC section 5), steps 1–6 and 8:
//   crawl -> classify -> (placeholders) -> baseline (today's importer, both modes)
//   -> read clues (non-placeholders only) -> group, score, band -> ProposedCatalog (contract 1.1.0).
// Step 7 (the AI pass) arrives in M4.

const { CONTRACT_VERSION } = require('../../contract');
const { crawl } = require('./crawl');
const { classifyItem } = require('./adapters/classifier');
const { runBaseline } = require('./adapters/baseline');
const { fileIdentity } = require('./adapters/identity');
const { isPlaceholderCandidate, confirmPlaceholders } = require('./placeholder');
const { groupCatalog } = require('./group');
const { readClues } = require('./read-clues');
const { POLICY_VERSION: NAME_POLICY_VERSION } = require('./names');
const scoring = require('../policy/scoring-v1.json');

const ENGINE_VERSION = '0.2.1-m2';
const POLICY_VERSION = `${NAME_POLICY_VERSION}+${scoring.version}`;
const PROGRESS_EVERY = 250;
// While crawling, the engine groups the files found so far, so songs appear as they are found.
const PREVIEW_MIN_FILES = 200;
const PREVIEW_GROWTH = 1.5;

function validateRequest(request) {
    if (!request || !Array.isArray(request.roots) || request.roots.length === 0) throw new Error('Choose at least one folder to scan');
    const options = request.options || {};
    if (options.followSymlinks !== false) throw new Error('followSymlinks must be false in contract v1');
    if (!['skip', 'list'].includes(options.includeCloudPlaceholders)) throw new Error('includeCloudPlaceholders must be "skip" or "list"');
    if (options.ai && options.ai.enabled) throw new Error('The AI pass is not built yet (milestone M4); switch AI off');
    if (!['exact-identity-only', 'multi-clue'].includes(options.mergeRule)) throw new Error('mergeRule must be "exact-identity-only" or "multi-clue"');
}

// A stored record can be reused when the content is unchanged: same size and modified time.
// The store finds the record by (device, inode) first, then by path (inode churn fallback).
function sameContent(stored, item) {
    return Boolean(stored) && stored.size === item.size && stored.mtimeMs === item.mtimeMs;
}

function toProposedFile(item, classification, cloudPlaceholder) {
    return {
        fileId: item.fileId,
        path: item.path,
        sourceRelativePath: item.sourceRelativePath,
        sourceContainerId: item.sourceContainerId,
        isFolder: item.type === 'folder',
        name: item.name,
        type: classification.type,
        ext: item.extension.replace(/^\./, ''),
        sizeBytes: item.size,
        createdAt: item.birthtimeMs ? new Date(item.birthtimeMs).toISOString() : undefined,
        modifiedAt: new Date(item.mtimeMs).toISOString(),
        confidence: classification.confidence,
        classifierReason: classification.reason,
        canonicalIdentity: null,
        reasons: [],
        cloudPlaceholder,
        // The import review wizard's rule (library-import-session.cjs:1767).
        needsReview: classification.confidence < 0.8 || classification.type === 'unknown',
        // Type corrections come with the wizard's file rows (session adapter).
        allowedTypes: []
    };
}

function withoutLog(baseline) {
    const { log, ...result } = baseline;
    return result;
}

function countTypes(files) {
    const counts = {};
    for (const file of files) counts[file.type] = (counts[file.type] || 0) + 1;
    return counts;
}

function groupingOptions(request, links = []) {
    const options = request.options;
    return {
        mergeRule: options.mergeRule,
        groupEdits: options.groupEdits !== false,
        courseNamespaces: options.catalogRules?.courseNamespaces || [],
        declinedCoursePrefixes: options.catalogRules?.declinedCoursePrefixes || [],
        links
    };
}

// Facts from the projects in a song (contract: bpm is an integer, as track_groups.bpm).
function songFacts(song) {
    const project = song.files.map((member) => member.project).find((facts) => facts && (facts.tempo || facts.lengthSec));
    if (!project) return {};
    return { bpm: project.tempo ? Math.round(project.tempo) : undefined, lengthSec: project.lengthSec ? Math.round(project.lengthSec) : undefined };
}

async function scanCatalog(request, hooks = {}) {
    validateRequest(request);
    const { previous = () => null, onProgress = () => {}, isCancelled = () => false, excludePaths = [], userRules = [] } = hooks;
    const startedAt = Date.now();
    const counters = {};
    const entries = []; // { item, classification }
    const previewSongs = new Set();
    let nextPreviewAt = PREVIEW_MIN_FILES;
    let reused = 0;
    // Time per step (ms), reported in Metrics and the results file.
    const timings = { crawlMs: 0, previewGroupingMs: 0, placeholdersMs: 0, readFilesMs: 0, linksMs: 0, duplicatesMs: 0, baselineMs: 0, groupingMs: 0 };
    let stepStart = Date.now();
    const endStep = (step) => {
        timings[step] += Date.now() - stepStart;
        stepStart = Date.now();
    };

    // Song names the engine finds in the files so far (names only); only new names are reported.
    function preview() {
        const previewStart = Date.now();
        try {
            return previewNames();
        } finally {
            timings.previewGroupingMs += Date.now() - previewStart;
            stepStart += Date.now() - previewStart;
        }
    }

    function previewNames() {
        const files = entries.map(({ item, classification }) => toProposedFile(item, classification, false)).filter((file) => file.type !== 'unknown');
        const names = groupCatalog(files, groupingOptions(request)).songs.filter((song) => song.kind === 'song').map((song) => song.songName);
        const newSongs = names.filter((name) => !previewSongs.has(name));
        for (const name of newSongs) previewSongs.add(name);
        return newSongs;
    }

    function progress(phase, extra = {}) {
        const files = entries.map((entry) => entry.classification);
        onProgress({ phase, files: entries.length, folders: counters.folders || 0, typeCounts: countTypes(files), songsFound: previewSongs.size, ...extra });
    }

    progress('crawl');
    for await (const item of crawl(request.roots, { counters, isCancelled, excludePaths })) {
        const stored = previous(item);
        item.stored = sameContent(stored, item) ? stored.derived : null;
        if (item.stored) reused += 1;
        entries.push({ item, classification: classifyItem(item, userRules) });
        if (entries.length >= nextPreviewAt) {
            nextPreviewAt = Math.ceil(entries.length * PREVIEW_GROWTH);
            progress('crawl', { newSongs: preview() });
        } else if (entries.length % PROGRESS_EVERY === 0) {
            progress('crawl');
        }
    }
    if (isCancelled()) return { cancelled: true };
    endStep('crawlMs');

    progress('placeholders', { newSongs: preview() });
    const unchecked = entries.filter(({ item }) => !item.stored && item.type === 'file' && isPlaceholderCandidate(item)).map(({ item }) => item.path);
    const confirmed = await confirmPlaceholders(unchecked);

    const includePlaceholders = request.options.includeCloudPlaceholders === 'list';
    const kept = [];
    let placeholdersFound = 0;
    for (const { item, classification } of entries) {
        const derived = item.stored || { cloudPlaceholder: confirmed.has(item.path) };
        if (derived.cloudPlaceholder) placeholdersFound += 1;
        const file = toProposedFile(item, classification, derived.cloudPlaceholder);
        if (file.type !== 'unknown') file.canonicalIdentity = fileIdentity(file);
        kept.push({ item, file, derived, included: !(derived.cloudPlaceholder && !includePlaceholders) });
    }
    if (isCancelled()) return { cancelled: true };
    endStep('placeholdersMs');

    progress('clues');
    const included = kept.filter((entry) => entry.included);
    const grouped = included.filter((entry) => entry.file.type !== 'unknown');
    const clues = await readClues(grouped, { onProgress: (read) => progress('clues', { projectsRead: read }) });
    if (isCancelled()) return { cancelled: true };
    Object.assign(timings, clues.timings);
    stepStart = Date.now();

    progress('baseline');
    const files = included.map((entry) => entry.file);
    const existingGroups = request.existingSongs || [];
    const baseline = runBaseline(files, { preserveSourceIdentity: true, existingGroups });
    const baselineStripPrefixes = runBaseline(files, { preserveSourceIdentity: false, existingGroups });

    endStep('baselineMs');

    progress('grouping');
    const engine = groupCatalog(files.filter((file) => file.type !== 'unknown'), { ...groupingOptions(request, clues.links), existingSongs: existingGroups });
    for (const song of engine.songs) song.facts = songFacts(song);
    endStep('groupingMs');
    const realSongs = engine.songs.filter((song) => song.kind === 'song');
    const groupedFiles = realSongs.reduce((sum, song) => sum + song.files.length, 0);
    const sureFiles = realSongs.filter((song) => song.band === 'sure').reduce((sum, song) => sum + song.files.length, 0);
    const typeCounts = countTypes(files);

    const catalog = {
        contractVersion: CONTRACT_VERSION,
        engineVersion: ENGINE_VERSION,
        policyVersion: POLICY_VERSION,
        songs: engine.songs,
        unassigned: files.filter((file) => file.type === 'unknown'),
        looseStems: engine.looseStems,
        duplicates: clues.duplicates,
        baseline: withoutLog(baseline),
        baselineStripPrefixes: withoutLog(baselineStripPrefixes),
        stats: {
            files: files.length,
            songs: realSongs.length,
            autoMatchedShare: groupedFiles ? Math.round((sureFiles / groupedFiles) * 1000) / 1000 : 0,
            durationMs: Date.now() - startedAt,
            aiCostUsd: 0,
            cappedAt: null,
            placeholdersSkipped: includePlaceholders ? 0 : placeholdersFound
        }
    };
    const finalSongs = realSongs.map((song) => song.songName);
    progress('done', { files: files.length, typeCounts, songsFound: finalSongs.length, newSongs: finalSongs.filter((name) => !previewSongs.has(name)) });

    return {
        cancelled: false,
        catalog,
        baselineStripNamespaces: catalog.baselineStripPrefixes,
        notes: {
            ...counters,
            typeCounts,
            placeholdersFound,
            reusedFromStore: reused,
            projectsRead: clues.projectsRead,
            links: clues.links.length,
            timings,
            clueCounts: clues.counts,
            learned: engine.context,
            courseSuggestions: engine.context.courseSuggestions || [],
            baselineLog: baseline.log
        },
        records: kept.map(({ item, derived }) => ({ item, derived }))
    };
}

module.exports = { scanCatalog, validateRequest, sameContent, ENGINE_VERSION, POLICY_VERSION };
