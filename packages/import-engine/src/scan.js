'use strict';

// M1 pipeline: crawl -> classify -> baseline. Produces a ProposedCatalog (contract 1.0.0).
// Clues, scoring and bands (M2) are not built yet, so `songs` is empty and every file is
// `unassigned`; the catalog screen shows the baseline result.

const { CONTRACT_VERSION } = require('@importer-lab/contract');
const { crawl } = require('./crawl');
const { classifyItem } = require('./adapters/classifier');
const { runBaseline } = require('./adapters/baseline');
const { isPlaceholderCandidate, confirmPlaceholders } = require('./placeholder');

const ENGINE_VERSION = '0.1.0-m1';
const POLICY_VERSION = 'none-m1';
const PROGRESS_EVERY = 250;

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

async function scanCatalog(request, hooks = {}) {
    validateRequest(request);
    const { previous = () => null, onProgress = () => {}, isCancelled = () => false, excludePaths = [], userRules = [] } = hooks;
    const startedAt = Date.now();
    const counters = {};
    const items = [];
    let reused = 0;

    onProgress({ phase: 'crawl', files: 0, folders: 0 });
    for await (const item of crawl(request.roots, { counters, isCancelled, excludePaths })) {
        const stored = previous(item);
        item.stored = sameContent(stored, item) ? stored.derived : null;
        if (item.stored) reused += 1;
        items.push(item);
        if (items.length % PROGRESS_EVERY === 0) {
            onProgress({ phase: 'crawl', files: items.length, folders: counters.folders });
        }
    }
    if (isCancelled()) return { cancelled: true };

    onProgress({ phase: 'placeholders', files: items.length, folders: counters.folders });
    const unchecked = items.filter((item) => !item.stored && item.type === 'file' && isPlaceholderCandidate(item)).map((item) => item.path);
    const confirmed = await confirmPlaceholders(unchecked);

    const includePlaceholders = request.options.includeCloudPlaceholders === 'list';
    const files = [];
    const records = [];
    let placeholdersFound = 0;
    for (const item of items) {
        const derived = item.stored || { cloudPlaceholder: confirmed.has(item.path) };
        records.push({ item, derived });
        if (derived.cloudPlaceholder) placeholdersFound += 1;
        if (derived.cloudPlaceholder && !includePlaceholders) continue;
        files.push(toProposedFile(item, classifyItem(item, userRules), derived.cloudPlaceholder));
    }
    if (isCancelled()) return { cancelled: true };

    onProgress({ phase: 'baseline', files: files.length, folders: counters.folders });
    const existingGroups = request.existingSongs || [];
    const baseline = runBaseline(files, { preserveSourceIdentity: true, existingGroups });
    const baselineStripNamespaces = runBaseline(files, { preserveSourceIdentity: false, existingGroups });

    const typeCounts = {};
    for (const file of files) typeCounts[file.type] = (typeCounts[file.type] || 0) + 1;

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
    onProgress({ phase: 'done', files: files.length, folders: counters.folders });

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
