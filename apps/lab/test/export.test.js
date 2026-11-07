'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scanCatalog } = require('../../../packages/import-engine/src');
const { toRendererView } = require('../src/view');
const { buildResults, writeResults } = require('../src/export');
const { installFsGuard, uninstallFsGuard } = require('../src/fs-guard');
const { generateCatalog } = require('../../../fixtures/synthetic/generate');
const { tempDir } = require('./helpers');

async function results(t) {
    const parent = tempDir(t, 'lab-export-');
    const { root } = generateCatalog(path.join(parent, 'catalog-a'));
    const result = await scanCatalog({
        roots: [root],
        options: { followSymlinks: false, includeCloudPlaceholders: 'list', ai: { enabled: false, maxCostUsd: 0, model: '' }, mergeRule: 'exact-identity-only', identityPolicyVersion: 'x' }
    });
    const view = toRendererView({ scanId: 's1', ...result }, [{ id: 'r', name: 'catalog-a', path: root }]);
    const marks = [{ id: 'm1', kind: 'split', target: 'song', songName: 'Sky', fileId: null, fileName: null }];
    return { parent, view, json: JSON.stringify(buildResults({ view, labels: { marks }, app: { labVersion: 'test' } })) };
}

test('the results file has names, counts, marks and timings', async (t) => {
    const { view, json } = await results(t);
    const parsed = JSON.parse(json);
    assert.equal(parsed.format, 'importer-lab-results');
    assert.equal(parsed.songs.length, view.songs.length);
    assert.ok(parsed.songs.find((song) => song.name === 'Sky').files.some((file) => file.name === 'SKY.wav'));
    assert.equal(parsed.marks.length, 1);
    assert.equal(typeof parsed.scan.durationMs, 'number');
});

test('the results file has no paths and no audio', async (t) => {
    const { parent, view, json } = await results(t);
    assert.ok(!json.includes(parent), 'no absolute path');
    for (const file of view.files) assert.ok(!json.includes(file.sourceRelativePath), `no folder path: ${file.sourceRelativePath}`);
    assert.ok(!/"(path|sourceRelativePath|data|bytes|audio)"/.test(json));
    assert.ok(json.length < 20000, 'names and counts only');
});

test('the results file is written inside the lab data folder', async (t) => {
    t.after(uninstallFsGuard); // registered first so it runs before the temp folders are removed
    const { view } = await results(t);
    const data = tempDir(t, 'lab-data-');
    installFsGuard({ allowedRoots: [data] });
    const file = writeResults(data, buildResults({ view, labels: { marks: [] }, app: {} }));
    assert.equal(path.dirname(file), path.join(data, 'exports'));
    assert.match(path.basename(file), /^Importer Lab results \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.json$/);
    assert.ok(fs.existsSync(file));
});
