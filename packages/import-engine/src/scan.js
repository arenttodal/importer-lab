'use strict';

// M1 pipeline: crawl -> classify -> baseline. Produces a ProposedCatalog (contract 1.0.0).
// Clues, scoring and bands (M2) are not built yet, so `songs` is empty and every file is
// `unassigned`; the catalog screen shows the baseline result.

const { CONTRACT_VERSION } = require('../../contract');
const { crawl } = require('./crawl');
const { classifyItem } = require('./adapters/classifier');
const { runBaseline } = require('./adapters/baseline');
const { fileIdentity } = require('./adapters/identity');
const { isPlaceholderCandidate, confirmPlaceholders } = require('./placeholder');

const ENGINE_VERSION = '0.1.0-m1';
const POLICY_VERSION = 'none-m1';
const PROGRESS_EVERY = 250;
// While crawling, today's importer is re-run on the files found so far, so songs can appear live.
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
        // Type corrections come with the wizard's file rows in M2 (session adapter).
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

async function scanCatalog(request, hooks = {}) {
    validateRequest(request);
    const { previous = () => null, onProgress = () => {}, isCancelled = () => false, excludePaths = [], userRules = [] } = hooks;
    const startedAt = Date.now();
    const counters = {};
    const entries = []; // { item, classification }
    const previewSongs = new Set();
    let nextPreviewAt = PREVIEW_MIN_FILES;
    let reused = 0;

    // Song names today's importer finds in the files so far; only new names are reported.
    function preview() {
        const files = entries.map(({ item, classification }) => toProposedFile(item, classification, false));
        const newSongs = runBaseline(files, { preserveSourceIdentity: true }).groups.map((group) => group.songName).filter((name) => !previewSongs.has(name));
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

    progress('placeholders', { newSongs: preview() });
    const unchecked = entries.filter(({ item }) => !item.stored && item.type === 'file' && isPlaceholderCandidate(item)).map(({ item }) => item.path);
    const confirmed = await confirmPlaceholders(unchecked);

    const includePlaceholders = request.options.includeCloudPlaceholders === 'list';
    const files = [];
    const records = [];
    let placeholdersFound = 0;
    for (const { item, classification } of entries) {
        const derived = item.stored || { cloudPlaceholder: confirmed.has(item.path) };
        records.push({ item, derived });
        if (derived.cloudPlaceholder) placeholdersFound += 1;
        if (derived.cloudPlaceholder && !includePlaceholders) continue;
        const file = toProposedFile(item, classification, derived.cloudPlaceholder);
        if (file.type !== 'unknown') file.canonicalIdentity = fileIdentity(file);
        files.push(file);
    }
    if (isCancelled()) return { cancelled: true };

    progress('baseline');
    const existingGroups = request.existingSongs || [];
    const baseline = runBaseline(files, { preserveSourceIdentity: true, existingGroups });
    const baselineStripNamespaces = runBaseline(files, { preserveSourceIdentity: false, existingGroups });

    const typeCounts = countTypes(files);

    const catalog = {
        contractVersion: CONTRACT_VERSION,
        engineVersion: ENGINE_VERSION,
        policyVersion: POLICY_VERSION,
        songs: [],
        unassigned: files,
        duplicates: [],
        baseline: withoutLog(baseline),
        stats: {
            files: files.length,
            songs: 0,
            autoMatchedShare: 0,
            durationMs: Date.now() - startedAt,
            aiCostUsd: 0,
            cappedAt: null,
            placeholdersSkipped: includePlaceholders ? 0 : placeholdersFound
        }
    };
    const finalSongs = baseline.groups.map((group) => group.songName);
    progress('done', { files: files.length, typeCounts, songsFound: finalSongs.length, newSongs: finalSongs.filter((name) => !previewSongs.has(name)) });

    return {
        cancelled: false,
        catalog,
        baselineStripNamespaces: withoutLog(baselineStripNamespaces),
        notes: {
            ...counters,
            typeCounts,
            placeholdersFound,
            reusedFromStore: reused,
            baselineLog: baseline.log
        },
        records
    };
}

module.exports = { scanCatalog, validateRequest, sameContent, ENGINE_VERSION, POLICY_VERSION };
