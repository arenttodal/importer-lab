'use strict';

// Runs one scan off the main thread so the interface never freezes.
// The guard is installed before anything else is loaded.

const { workerData, parentPort } = require('node:worker_threads');
const { installFsGuard } = require('./fs-guard');

installFsGuard({ allowedRoots: [workerData.dataDir] });

const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { scanCatalog, createClaudeClient } = require('../../../packages/import-engine/src');
const { openStore } = require('./store');

// AI answers are cached per item in the data folder, so a re-run costs nothing.
const AI_CACHE = path.join(workerData.dataDir, 'ai-cache.json');
const AI_CACHE_LIMIT = 50000;

function loadAiCache() {
    try {
        return new Map(Object.entries(JSON.parse(fs.readFileSync(AI_CACHE, 'utf8'))));
    } catch {
        return new Map();
    }
}

function saveAiCache(cache) {
    const entries = [...cache].slice(-AI_CACHE_LIMIT);
    fs.writeFileSync(AI_CACHE, JSON.stringify(Object.fromEntries(entries)));
}

let cancelled = false;
parentPort.on('message', (message) => {
    if (message === 'cancel') cancelled = true;
});

async function run() {
    const startedAt = Date.now();
    const store = openStore(path.join(workerData.dataDir, 'evidence.sqlite'));
    let storeLookupMs = 0;
    const ai = workerData.aiKey ? { client: createClaudeClient({ apiKey: workerData.aiKey }), cache: loadAiCache() } : null;
    try {
        const result = await scanCatalog(workerData.request, {
            previous: (item) => {
                if (workerData.fromScratch) return null;
                const lookupStart = Date.now();
                try {
                    return store.lookup(item);
                } finally {
                    storeLookupMs += Date.now() - lookupStart;
                }
            },
            onProgress: (progress) => parentPort.postMessage({ type: 'progress', progress }),
            isCancelled: () => cancelled,
            excludePaths: workerData.excludePaths || [],
            ai
        });
        if (ai) saveAiCache(ai.cache);
        if (result.cancelled) return { type: 'cancelled' };
        const scanId = crypto.randomUUID();
        const saveStart = Date.now();
        store.saveScan(scanId, result.records, result.catalog.stats);
        // The engine's own steps include the store lookups made during the crawl.
        Object.assign(result.notes.timings, { storeLookupMs, storeSaveMs: Date.now() - saveStart, totalMs: Date.now() - startedAt });
        result.notes.fromScratch = Boolean(workerData.fromScratch);
        const { records, ...withoutRecords } = result;
        return { type: 'done', result: { scanId, ...withoutRecords } };
    } finally {
        store.close();
    }
}

// The final message is sent after the store is closed; the parent then ends this worker.
run()
    .catch((error) => ({ type: 'error', message: error.message, code: error.code || null }))
    .then((message) => parentPort.postMessage(message));
