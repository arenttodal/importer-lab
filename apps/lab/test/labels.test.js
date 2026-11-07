'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const labels = require('../src/labels');
const { installFsGuard, uninstallFsGuard } = require('../src/fs-guard');
const { tempDir } = require('./helpers');

const CONTEXT = { scanId: 'scan-1', engineVersion: 'test' };

function setup(t) {
    t.after(uninstallFsGuard);
    const data = tempDir(t, 'lab-labels-');
    installFsGuard({ allowedRoots: [data] });
    return data;
}

test('the catalog id does not depend on folder order and hides the paths', () => {
    const id = labels.catalogId(['/Users/a/Music', '/Volumes/Archive']);
    assert.equal(id, labels.catalogId(['/Volumes/Archive', '/Users/a/Music']));
    assert.match(id, /^[0-9a-f]{12}$/);
});

test('song and file marks are saved, updated and undone in labels/<catalog>.json', (t) => {
    const data = setup(t);
    const split = labels.addMark(data, 'cat1', { kind: 'split', target: 'song', songName: 'Sky' }, CONTEXT);
    const merge = labels.addMark(data, 'cat1', { kind: 'merge', target: 'song', songName: 'Sky Final' }, CONTEXT);
    labels.updateMark(data, 'cat1', merge.id, { mergeWithSongName: 'Sky' });
    labels.addMark(data, 'cat1', { kind: 'wrong-song', target: 'file', songName: 'Sky', fileId: 'abc', fileName: 'Kareal Sky.wav', fileType: 'bounces', path: '/secret/Kareal Sky.wav' }, CONTEXT);
    labels.removeMark(data, 'cat1', split.id);

    const saved = JSON.parse(fs.readFileSync(path.join(data, 'labels', 'cat1.json'), 'utf8'));
    assert.deepEqual(saved.marks.map((mark) => [mark.kind, mark.target, mark.songName, mark.mergeWithSongName, mark.fileName]), [
        ['merge', 'song', 'Sky Final', 'Sky', null],
        ['wrong-song', 'file', 'Sky', null, 'Kareal Sky.wav']
    ]);
    assert.ok(!JSON.stringify(saved).includes('/secret/'), 'unknown fields such as paths are dropped');
});

test('unknown mark kinds are refused', (t) => {
    const data = setup(t);
    assert.throws(() => labels.addMark(data, 'cat1', { kind: 'delete-file', target: 'file' }, CONTEXT), /Unknown mark/);
});
