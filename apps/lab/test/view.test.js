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

test('songs: every grouped file is in one song, with plain reasons; kinds and bands come from the engine', async (t) => {
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
        assert.ok(song.reasons.length > 0, song.name);
        assert.ok(['sure', 'unsure', 'unclear'].includes(song.band));
        assert.ok(['song', 'template', 'course', 'sample-pack', 'stem-set'].includes(song.kind));
    }
    const skyId = view.files.find((file) => file.name === 'SKY.wav').fileId;
    const sky = view.songs.find((song) => song.fileIds.includes(skyId));
    assert.ok(sky.fileIds.length >= 9, 'Sky gathers its bounces, projects, stems and the SKY FINAL mix');
    assert.equal(sky.facts.bpm, 122);
});
