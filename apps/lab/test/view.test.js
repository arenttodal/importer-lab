'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { scanCatalog } = require('@importer-lab/import-engine');
const { toRendererView } = require('../src/view');
const { generateCatalog } = require('../../../fixtures/synthetic/generate');
const { tempDir } = require('./helpers');

test('no absolute path reaches the renderer (IMP-FN-032-R3)', async (t) => {
    const parent = tempDir(t, 'lab-view-');
    const { root } = generateCatalog(path.join(parent, 'catalog-a'));
    const result = await scanCatalog({
        roots: [root],
        options: { followSymlinks: false, includeCloudPlaceholders: 'list', ai: { enabled: false, maxCostUsd: 0, model: '' }, mergeRule: 'exact-identity-only', identityPolicyVersion: 'x' }
    });
    const view = toRendererView({ scanId: 's', ...result }, [{ id: 'r1', name: 'catalog-a', path: root }]);
    const json = JSON.stringify(view);
    assert.ok(!json.includes(parent), 'the scanned folder location must not appear');
    assert.ok(!json.includes('"path"'));
    assert.equal(view.files.length, result.catalog.stats.files);
    assert.ok(view.files.every((file) => file.sourceRelativePath.startsWith('catalog-a/')));
});
