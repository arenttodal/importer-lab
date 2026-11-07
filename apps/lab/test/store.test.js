'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { installFsGuard, uninstallFsGuard } = require('../src/fs-guard');
const { openStore } = require('../src/store');
const { tempDir } = require('./helpers');

function item(overrides) {
    return { path: '/music/Sky.wav', dev: '1', ino: '100', size: 10, mtimeMs: 1000, ...overrides };
}

function setup(t) {
    t.after(uninstallFsGuard); // registered first so it runs before the temp folder is removed
    const data = tempDir(t, 'lab-store-');
    installFsGuard({ allowedRoots: [data] });
    const store = openStore(path.join(data, 'evidence.sqlite'));
    t.after(() => store.close());
    store.saveScan('scan-1', [{ item: item(), derived: { cloudPlaceholder: false } }], { files: 1 });
    return store;
}

test('the store refuses a database outside the lab data folder', (t) => {
    t.after(uninstallFsGuard);
    const data = tempDir(t, 'lab-store-');
    const elsewhere = tempDir(t, 'elsewhere-');
    installFsGuard({ allowedRoots: [data] });
    assert.throws(() => openStore(path.join(elsewhere, 'x.sqlite')), { code: 'E_LAB_READ_ONLY' });
});

test('found by device and inode, even after a rename', (t) => {
    const store = setup(t);
    const found = store.lookup(item({ path: '/music/Sky renamed.wav' }));
    assert.deepEqual(found.derived, { cloudPlaceholder: false });
    assert.equal(found.size, 10);
});

test('found by path when the inode churned (Dropbox File Provider)', (t) => {
    const store = setup(t);
    const found = store.lookup(item({ ino: '999' }));
    assert.equal(found.path, '/music/Sky.wav');
});

test('a changed file is returned with its old size and time, so the engine can tell it changed', (t) => {
    const store = setup(t);
    const found = store.lookup(item({ size: 11 }));
    assert.equal(found.size, 10);
});

test('an unknown file returns null', (t) => {
    const store = setup(t);
    assert.equal(store.lookup(item({ path: '/music/Other.wav', ino: '5' })), null);
});

test('re-saving updates in place', (t) => {
    const store = setup(t);
    store.saveScan('scan-2', [{ item: item({ mtimeMs: 2000 }), derived: { cloudPlaceholder: true } }], { files: 1 });
    assert.equal(store.countFiles(), 1);
    assert.deepEqual(store.lookup(item({ mtimeMs: 2000 })).derived, { cloudPlaceholder: true });
});
