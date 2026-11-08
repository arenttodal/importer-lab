'use strict';

// Non-negotiable 1: scanning a folder must leave it exactly as it was. This runs the full lab scan
// path (worker thread + guard + SQLite store), twice, over the synthetic catalog, and fails on any
// write, rename or delete inside the scanned folder — whether or not the guard caught it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { startScan } = require('../src/run-scan');
const { generateCatalog } = require('../../../fixtures/synthetic/generate');
const { tempDir, snapshotTree } = require('./helpers');

function request(root) {
    return {
        roots: [root],
        options: { followSymlinks: false, includeCloudPlaceholders: 'list', ai: { enabled: false, maxCostUsd: 0, model: '' }, mergeRule: 'exact-identity-only', identityPolicyVersion: 'app-f5af21c7' }
    };
}

test('a full scan, run twice, changes nothing in the scanned folder', async (t) => {
    const { root } = generateCatalog(path.join(tempDir(t, 'lab-ro-'), 'catalog-a'));
    const dataDir = tempDir(t, 'lab-data-');
    const before = snapshotTree(root);

    const first = await startScan({ request: request(root), dataDir }).promise;
    const second = await startScan({ request: request(root), dataDir }).promise;

    assert.deepEqual(snapshotTree(root), before);
    assert.ok(first.catalog.stats.files > 30);
    assert.equal(second.notes.reusedFromStore, first.catalog.stats.files, 'the second scan reuses every unchanged file');
    assert.deepEqual(second.catalog.baseline.groups, first.catalog.baseline.groups);
    assert.deepEqual(fs.readdirSync(dataDir).filter((name) => !name.startsWith('evidence.sqlite')), []);
});

test('"Scan from scratch" reads every file again and still changes nothing in the scanned folder', async (t) => {
    const { root } = generateCatalog(path.join(tempDir(t, 'lab-ro-'), 'catalog-a'));
    const dataDir = tempDir(t, 'lab-data-');
    const before = snapshotTree(root);
    await startScan({ request: request(root), dataDir }).promise;
    const fresh = await startScan({ request: request(root), dataDir, fromScratch: true }).promise;
    assert.deepEqual(snapshotTree(root), before);
    assert.equal(fresh.notes.reusedFromStore, 0);
    assert.equal(fresh.notes.fromScratch, true);
    assert.ok(fresh.notes.clueCounts.filesOpened > 0);
});

test('the scan worker runs with the guard installed: a write into the scanned folder is blocked', async (t) => {
    const { root } = generateCatalog(path.join(tempDir(t, 'lab-ro-'), 'catalog-a'));
    const dataDir = tempDir(t, 'lab-data-');
    const before = snapshotTree(root);
    const code = `
        const { workerData, parentPort } = require('node:worker_threads');
        require(${JSON.stringify(path.join(__dirname, '..', 'src', 'fs-guard.js'))}).installFsGuard({ allowedRoots: [workerData.dataDir] });
        const fs = require('node:fs');
        const results = [];
        for (const attempt of [
            () => fs.writeFileSync(workerData.root + '/Bounces/SKY.wav', 'overwritten'),
            () => fs.renameSync(workerData.root + '/Bounces/SKY.wav', workerData.root + '/Bounces/SKY moved.wav'),
            () => fs.rmSync(workerData.root + '/Stems', { recursive: true })
        ]) {
            try { attempt(); results.push('written'); } catch (error) { results.push(error.code); }
        }
        parentPort.postMessage(results);
    `;
    const worker = new Worker(code, { eval: true, workerData: { root, dataDir } });
    const results = await new Promise((resolve, reject) => worker.on('message', resolve).on('error', reject));
    assert.deepEqual(results, ['E_LAB_READ_ONLY', 'E_LAB_READ_ONLY', 'E_LAB_READ_ONLY']);
    assert.deepEqual(snapshotTree(root), before);
});

test('a scan can be cancelled', async (t) => {
    const { root } = generateCatalog(path.join(tempDir(t, 'lab-ro-'), 'catalog-a'));
    const scan = startScan({ request: request(root), dataDir: tempDir(t, 'lab-data-') });
    scan.cancel();
    const result = await scan.promise;
    assert.equal(result.cancelled, true);
});
