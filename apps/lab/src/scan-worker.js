'use strict';

// Runs one scan off the main thread so the interface never freezes.
// The guard is installed before anything else is loaded.

const { workerData, parentPort } = require('node:worker_threads');
const { installFsGuard } = require('./fs-guard');

installFsGuard({ allowedRoots: [workerData.dataDir] });

const path = require('node:path');
const crypto = require('node:crypto');
const { scanCatalog } = require('../../../packages/import-engine/src');
const { openStore } = require('./store');

let cancelled = false;
parentPort.on('message', (message) => {
    if (message === 'cancel') cancelled = true;
});

async function run() {
    const startedAt = Date.now();
    const store = openStore(path.join(workerData.dataDir, 'evidence.sqlite'));
    let storeLookupMs = 0;
    try {
        const result = await scanCatalog(workerData.request, {
            previous: (item) => {
                const lookupStart = Date.now();
                try {
                    return store.lookup(item);
                } finally {
                    storeLookupMs += Date.now() - lookupStart;
                }
            },
            onProgress: (progress) => parentPort.postMessage({ type: 'progress', progress }),
            isCancelled: () => cancelled,
            excludePaths: workerData.excludePaths || []
        });
        if (result.cancelled) return { type: 'cancelled' };
        const scanId = crypto.randomUUID();
        const saveStart = Date.now();
        store.saveScan(scanId, result.records, result.catalog.stats);
        // The engine's own steps include the store lookups made during the crawl.
        Object.assign(result.notes.timings, { storeLookupMs, storeSaveMs: Date.now() - saveStart, totalMs: Date.now() - startedAt });
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
