'use strict';

// Runs one scan off the main thread so the interface never freezes.
// The guard is installed before anything else is loaded.

const { workerData, parentPort } = require('node:worker_threads');
const { installFsGuard } = require('./fs-guard');

installFsGuard({ allowedRoots: [workerData.dataDir] });

const path = require('node:path');
const crypto = require('node:crypto');
const { scanCatalog } = require('@importer-lab/import-engine');
const { openStore } = require('./store');

let cancelled = false;
parentPort.on('message', (message) => {
    if (message === 'cancel') cancelled = true;
});

async function run() {
    const store = openStore(path.join(workerData.dataDir, 'evidence.sqlite'));
    try {
        const result = await scanCatalog(workerData.request, {
            previous: (item) => store.lookup(item),
            onProgress: (progress) => parentPort.postMessage({ type: 'progress', progress }),
            isCancelled: () => cancelled,
            excludePaths: workerData.excludePaths || []
        });
        if (result.cancelled) return { type: 'cancelled' };
        const scanId = crypto.randomUUID();
        store.saveScan(scanId, result.records, result.catalog.stats);
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
