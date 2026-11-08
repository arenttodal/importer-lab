'use strict';

// Starts a scan in a worker thread. Used by the Electron main process and by scripts/scan-cli.js.

const path = require('node:path');
const { Worker } = require('node:worker_threads');

// fromScratch: ignore stored results from earlier scans (every file is read again); the new results
// are still stored for the next scan.
function startScan({ request, dataDir, excludePaths = [], fromScratch = false, onProgress = () => {} }) {
    const worker = new Worker(path.join(__dirname, 'scan-worker.js'), { workerData: { request, dataDir, excludePaths, fromScratch } });
    const promise = new Promise((resolve, reject) => {
        let settled = false;
        worker.on('message', (message) => {
            if (message.type === 'progress') return onProgress(message.progress);
            settled = true;
            worker.terminate();
            if (message.type === 'done') resolve({ cancelled: false, ...message.result });
            else if (message.type === 'cancelled') resolve({ cancelled: true });
            else {
                const error = new Error(message.message);
                error.code = message.code;
                reject(error);
            }
        });
        worker.on('error', (error) => {
            settled = true;
            reject(error);
        });
        worker.on('exit', (code) => {
            if (!settled) reject(new Error(`Scan worker stopped unexpectedly (exit code ${code})`));
        });
    });
    return { promise, cancel: () => worker.postMessage('cancel') };
}

module.exports = { startScan };
