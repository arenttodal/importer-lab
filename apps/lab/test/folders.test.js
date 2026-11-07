'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { listFolders, publicFolders, isProtected } = require('../src/folders');
const { DEFAULTS } = require('../src/settings');
const { tempDir } = require('./helpers');

function fakeHome(t) {
    const home = tempDir(t, 'lab-home-');
    for (const name of ['Music', 'Desktop', 'Documents']) fs.mkdirSync(path.join(home, name));
    return home;
}

test('suggests Music, Desktop and Documents; only Music is ticked by default', (t) => {
    const home = fakeHome(t);
    const folders = listFolders(structuredClone(DEFAULTS), { home, platform: 'test' });
    assert.deepEqual(folders.map((folder) => [folder.name, folder.kind, folder.checked]), [
        ['Music', 'suggested', true],
        ['Desktop', 'suggested', false],
        ['Documents', 'suggested', false]
    ]);
});

test('folders that do not exist are not suggested; added folders are listed and ticked by settings', (t) => {
    const home = tempDir(t, 'lab-home-');
    fs.mkdirSync(path.join(home, 'Music'));
    const added = tempDir(t, 'lab-added-');
    const settings = { ...structuredClone(DEFAULTS), addedFolders: [added], checked: { [added]: true, [path.join(home, 'Music')]: false } };
    const folders = listFolders(settings, { home, platform: 'test' });
    assert.deepEqual(folders.map((folder) => [folder.kind, folder.checked]), [
        ['suggested', false],
        ['added', true]
    ]);
});

test('Desktop, Documents, Downloads, iCloud Drive and drives are protected by macOS; Music is not', () => {
    const home = '/Users/someone';
    assert.equal(isProtected('/Users/someone/Desktop/old stuff', home), true);
    assert.equal(isProtected('/Users/someone/Documents', home), true);
    assert.equal(isProtected('/Users/someone/Library/Mobile Documents/com~apple~CloudDocs', home), true);
    assert.equal(isProtected('/Volumes/Archive', home), true);
    assert.equal(isProtected('/Users/someone/Music', home), false);
    assert.equal(isProtected('/Users/someone/Desktopper', home), false);
});

test('the renderer gets folder names, never paths', (t) => {
    const home = fakeHome(t);
    const json = JSON.stringify(publicFolders(listFolders(structuredClone(DEFAULTS), { home, platform: 'test' })));
    assert.ok(!json.includes(home));
    assert.ok(!json.includes('"path"'));
});
