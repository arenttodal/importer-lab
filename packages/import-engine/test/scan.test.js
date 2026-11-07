'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { scanCatalog } = require('../src');

function allFiles(catalog) {
    return [...catalog.unassigned, ...catalog.songs.flatMap((song) => song.files)];
}
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
    const byRelative = new Map(allFiles(result.catalog).map((file) => [file.sourceRelativePath, file]));
    const grouped = new Set(result.catalog.baseline.groups.flatMap((group) => group.fileIds));
    for (const [song, paths] of Object.entries(truth)) {
        for (const relative of paths) {
            const file = byRelative.get(`catalog-a/${relative}`);
            assert.ok(file, `${song}: ${relative} missing from the catalog`);
            assert.ok(grouped.has(file.fileId), `${song}: ${relative} missing from the baseline`);
        }
    }
});

test('catalog follows contract 1.1.0 and the baseline runs in both modes', async (t) => {
    const { root } = makeCatalog(t);
    const result = await scanCatalog(scanRequest([root]));
    assert.equal(result.catalog.contractVersion, '1.1.0');
    assert.equal(result.catalog.stats.files, allFiles(result.catalog).length);
    assert.ok(result.catalog.baselineStripPrefixes.groups.length > 0);
    assert.equal(result.catalog.stats.cappedAt, null);
    assert.ok(result.catalog.baseline.groups.length > 0);
    assert.ok(result.baselineStripNamespaces.groups.length > 0);
    assert.notDeepEqual(result.catalog.baseline.groups, result.baselineStripNamespaces.groups);
    for (const file of allFiles(result.catalog)) {
        assert.ok(['bounces', 'stems', 'projects', 'videos', 'unknown'].includes(file.type));
        assert.equal(typeof file.needsReview, 'boolean');
    }
});

test('placeholders are listed by default and dropped with "skip"', async (t) => {
    const { root } = makeCatalog(t);
    const listed = await scanCatalog(scanRequest([root]));
    const flagged = allFiles(listed.catalog).filter((file) => file.cloudPlaceholder).map((file) => file.name).sort();
    assert.deepEqual(flagged, ['Glass House.als', 'Glass House_bip.wav']);
    const skipped = await scanCatalog(scanRequest([root], { includeCloudPlaceholders: 'skip' }));
    assert.equal(skipped.catalog.stats.placeholdersSkipped, 2);
    assert.ok(!allFiles(skipped.catalog).some((file) => file.name.startsWith('Glass House')));
});

test('a scan never opens a cloud placeholder (so nothing downloads); local files are read for clues', async (t) => {
    const { root } = makeCatalog(t);
    const opened = [];
    const record = (target) => opened.push(String(target));
    const spies = [
        t.mock.method(fs, 'openSync', function (target, ...rest) {
            record(target);
            return spies[0].mock.original.call(this, target, ...rest);
        }),
        t.mock.method(fs, 'readFileSync', function (target, ...rest) {
            record(target);
            return spies[1].mock.original.call(this, target, ...rest);
        }),
        t.mock.method(fs, 'createReadStream', function (target, ...rest) {
            record(target);
            return spies[2].mock.original.call(this, target, ...rest);
        })
    ];
    await scanCatalog(scanRequest([root]));
    assert.ok(!opened.some((target) => target.includes(`${require('node:path').sep}Cloud${require('node:path').sep}`)), 'no placeholder was opened');
    assert.ok(opened.some((target) => target.endsWith('.als')), 'local projects are read');
    assert.ok(opened.some((target) => target.endsWith('.wav')), 'local audio headers are read');
});

test('unchanged files are reused from the store on a re-scan', async (t) => {
    const { root } = makeCatalog(t);
    const first = await scanCatalog(scanRequest([root]));
    const stored = new Map(first.records.map(({ item, derived }) => [item.path, { size: item.size, mtimeMs: item.mtimeMs, derived }]));
    const second = await scanCatalog(scanRequest([root]), { previous: (item) => stored.get(item.path) || null });
    assert.equal(second.notes.reusedFromStore, first.records.length);
    assert.deepEqual(second.catalog.baseline.groups, first.catalog.baseline.groups);
});

test('progress reports live type counts and songs as they are recognised', async (t) => {
    const { root } = makeCatalog(t);
    const events = [];
    const result = await scanCatalog(scanRequest([root]), { onProgress: (event) => events.push(event) });
    const done = events.at(-1);
    assert.equal(done.phase, 'done');
    const engineSongs = result.catalog.songs.filter((song) => song.kind === 'song');
    assert.equal(done.songsFound, engineSongs.length);
    assert.equal(done.typeCounts.bounces, result.notes.typeCounts.bounces);
    const announced = events.flatMap((event) => event.newSongs || []);
    assert.equal(new Set(announced).size, announced.length, 'each song is announced once');
    for (const song of engineSongs) assert.ok(announced.includes(song.songName), `${song.songName} announced`);
});

test('every grouped file carries the app\'s canonical identity', async (t) => {
    const { root } = makeCatalog(t);
    const result = await scanCatalog(scanRequest([root]));
    const byName = new Map(allFiles(result.catalog).map((file) => [file.name, file]));
    assert.equal(byName.get('SKY master.wav').canonicalIdentity, 'sky');
    assert.equal(byName.get('Sky Kick.wav').canonicalIdentity, 'sky');
    assert.equal(byName.get('notes.txt').canonicalIdentity, null);
});

test('M2: the synthetic catalog becomes the expected songs, with project facts and duplicates', async (t) => {
    const { root } = makeCatalog(t);
    const result = await scanCatalog(scanRequest([root]));
    const songOf = (name) => result.catalog.songs.find((song) => song.files.some((file) => file.name === name));
    assert.equal(songOf('MG X JC - SKY FINAL.wav').proposalId, songOf('SKY.wav').proposalId, 'must-pass 2');
    assert.notEqual(songOf('Untitled 14 Project').proposalId, songOf('Untitled 37 Project').proposalId, 'must-pass 1');
    assert.equal(songOf('Beat Idea - Aug Song Drums.wav').proposalId, songOf('Beat Idea - Aug Song.wav').proposalId, 'must-pass 3');
    assert.equal(new Set(['SKY.wav', 'Red Sky 116BPM.wav', 'Kareal Sky.wav'].map((name) => songOf(name).proposalId)).size, 3, 'must-pass 4');
    assert.equal(songOf('SKY.wav').facts.bpm, 122, 'tempo read from the Ableton project');
    assert.ok(result.catalog.duplicates.some((set) => set.copies.length >= 1), 'the copied SKY master is a duplicate');
    assert.ok(result.notes.projectsRead >= 5);
});
