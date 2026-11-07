'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { scanCatalog } = require('../src');
const { makeCatalog, scanRequest } = require('./helpers');

test('request validation: AI off in M1, symlinks never followed, placeholders skip or list', async () => {
    await assert.rejects(scanCatalog(scanRequest([])), /at least one folder/);
    await assert.rejects(scanCatalog(scanRequest(['/tmp'], { followSymlinks: true })), /followSymlinks/);
    await assert.rejects(scanCatalog(scanRequest(['/tmp'], { ai: { enabled: true, maxCostUsd: 1, model: 'x' } })), /M4/);
    await assert.rejects(scanCatalog(scanRequest(['/tmp'], { includeCloudPlaceholders: 'download' })), /includeCloudPlaceholders/);
});

test('every ground-truth file of the synthetic catalog is in the catalog and in the baseline', async (t) => {
    const { root, truth } = makeCatalog(t);
    const result = await scanCatalog(scanRequest([root]));
    const byRelative = new Map(result.catalog.unassigned.map((file) => [file.sourceRelativePath, file]));
    const grouped = new Set(result.catalog.baseline.groups.flatMap((group) => group.fileIds));
    for (const [song, paths] of Object.entries(truth)) {
        for (const relative of paths) {
            const file = byRelative.get(`catalog-a/${relative}`);
            assert.ok(file, `${song}: ${relative} missing from the catalog`);
            assert.ok(grouped.has(file.fileId), `${song}: ${relative} missing from the baseline`);
        }
    }
});

test('catalog follows contract 1.0.0 and the baseline runs in both modes', async (t) => {
    const { root } = makeCatalog(t);
    const result = await scanCatalog(scanRequest([root]));
    assert.equal(result.catalog.contractVersion, '1.0.0');
    assert.equal(result.catalog.stats.files, result.catalog.unassigned.length);
    assert.equal(result.catalog.stats.cappedAt, null);
    assert.ok(result.catalog.baseline.groups.length > 0);
    assert.ok(result.baselineStripNamespaces.groups.length > 0);
    assert.notDeepEqual(result.catalog.baseline.groups, result.baselineStripNamespaces.groups);
    for (const file of result.catalog.unassigned) {
        assert.ok(['bounces', 'stems', 'projects', 'videos', 'unknown'].includes(file.type));
        assert.equal(typeof file.needsReview, 'boolean');
    }
});

test('placeholders are listed by default and dropped with "skip"', async (t) => {
    const { root } = makeCatalog(t);
    const listed = await scanCatalog(scanRequest([root]));
    const flagged = listed.catalog.unassigned.filter((file) => file.cloudPlaceholder).map((file) => file.name).sort();
    assert.deepEqual(flagged, ['Glass House.als', 'Glass House_bip.wav']);
    const skipped = await scanCatalog(scanRequest([root], { includeCloudPlaceholders: 'skip' }));
    assert.equal(skipped.catalog.stats.placeholdersSkipped, 2);
    assert.ok(!skipped.catalog.unassigned.some((file) => file.name.startsWith('Glass House')));
});

test('a scan never opens or reads a file — metadata only (so placeholders never download)', async (t) => {
    const { root } = makeCatalog(t);
    const spies = [
        t.mock.method(fs, 'open'),
        t.mock.method(fs, 'openSync'),
        t.mock.method(fs, 'readFile'),
        t.mock.method(fs, 'readFileSync'),
        t.mock.method(fs, 'createReadStream'),
        t.mock.method(fs.promises, 'open'),
        t.mock.method(fs.promises, 'readFile')
    ];
    await scanCatalog(scanRequest([root]));
    for (const spy of spies) assert.equal(spy.mock.callCount(), 0);
});

test('unchanged files are reused from the store on a re-scan', async (t) => {
    const { root } = makeCatalog(t);
    const first = await scanCatalog(scanRequest([root]));
    const stored = new Map(first.records.map(({ item, derived }) => [item.path, { size: item.size, mtimeMs: item.mtimeMs, derived }]));
    const second = await scanCatalog(scanRequest([root]), { previous: (item) => stored.get(item.path) || null });
    assert.equal(second.notes.reusedFromStore, first.records.length);
    assert.deepEqual(second.catalog.baseline.groups, first.catalog.baseline.groups);
});
