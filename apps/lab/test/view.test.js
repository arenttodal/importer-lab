'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { scanCatalog } = require('../../../packages/import-engine/src');
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

test('songs: every grouped file is in one song, with plain reasons; unsure songs say why', async (t) => {
    const parent = tempDir(t, 'lab-view-');
    const { root } = generateCatalog(path.join(parent, 'catalog-a'));
    const result = await scanCatalog({
        roots: [root],
        options: { followSymlinks: false, includeCloudPlaceholders: 'list', ai: { enabled: false, maxCostUsd: 0, model: '' }, mergeRule: 'exact-identity-only', identityPolicyVersion: 'x' }
    });
    const view = toRendererView({ scanId: 's', ...result }, [{ id: 'r1', name: 'catalog-a', path: root }]);
    const grouped = view.songs.flatMap((song) => song.fileIds);
    assert.equal(new Set(grouped).size, grouped.length);
    assert.equal(grouped.length + view.otherFiles, view.files.length);
    for (const song of view.songs) {
        assert.ok(song.reasons.length > 0);
        if (song.unsure) assert.ok(song.reasons.some((reason) => /check/.test(reason)), `${song.name}: ${song.reasons}`);
    }
    const sky = view.songs.find((song) => song.name === 'Sky');
    assert.match(sky.reasons[0], /same name .*“sky”/);
    assert.match(sky.reasons[1], /3 stems are named after this song/);
    assert.equal(sky.unsure, true, 'the strip-prefixes mode splits Sky');
    assert.match(sky.reasons.join(' '), /groups these files differently/);
    assert.equal(sky.countsLine, '4 bounces · 2 projects · 3 stems');
});
