'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const history = require('../src/history');
const { installFsGuard, uninstallFsGuard } = require('../src/fs-guard');
const { tempDir } = require('./helpers');

function view(songs, folders = ['Music']) {
    return { scanId: crypto.randomUUID(), roots: folders.map((name) => ({ id: name, name })), songs: Array.from({ length: songs }, (_, i) => ({ name: `Song ${i}` })), stats: { files: songs * 2 } };
}

function setup(t) {
    t.after(uninstallFsGuard); // registered first so it runs before the temp folder is removed
    const data = tempDir(t, 'lab-history-');
    installFsGuard({ allowedRoots: [data] });
    return data;
}

test('scans are saved, listed newest first, reopened and deleted', async (t) => {
    const data = setup(t);
    const first = history.saveScan(data, { view: view(3), catalogId: 'cat1' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = history.saveScan(data, { view: view(5, ['Music', 'Archive']), catalogId: 'cat2' });

    const list = history.listScans(data);
    assert.deepEqual(list.map((scan) => [scan.scanId, scan.songs, scan.folders.join(',')]), [
        [second.scanId, 5, 'Music,Archive'],
        [first.scanId, 3, 'Music']
    ]);
    const reopened = history.openScan(data, first.scanId);
    assert.equal(reopened.catalogId, 'cat1');
    assert.equal(reopened.view.songs.length, 3);

    history.deleteScan(data, first.scanId);
    assert.deepEqual(history.listScans(data).map((scan) => scan.scanId), [second.scanId]);
});

test('an empty history is an empty list; a damaged file is skipped', (t) => {
    const data = setup(t);
    assert.deepEqual(history.listScans(data), []);
    history.saveScan(data, { view: view(1), catalogId: 'c' });
    fs.writeFileSync(path.join(data, 'scans', `${crypto.randomUUID()}.json`), '{not json');
    assert.equal(history.listScans(data).length, 1);
});

test('scan ids cannot reach outside the scans folder', (t) => {
    const data = setup(t);
    assert.throws(() => history.openScan(data, '../settings'), /Unknown scan/);
    assert.throws(() => history.deleteScan(data, '../../etc/passwd'), /Unknown scan/);
});
