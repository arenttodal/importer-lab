'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadExistingSongs } = require('../src/existing-songs');
const { tempDir } = require('./helpers');

function snapshot(t, content) {
    const file = path.join(tempDir(t, 'lab-snapshot-'), 'songs.json');
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
    return file;
}

const ROW = { id: '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f', song_name: 'Sky', display_name: 'Sky', has_bounce: true };

test("reads the app's page shape and a plain list, de-duplicated by id", (t) => {
    assert.deepEqual(loadExistingSongs(snapshot(t, { success: true, data: [ROW, ROW] })).map((song) => song.songName), ['Sky']);
    assert.equal(loadExistingSongs(snapshot(t, [ROW]))[0].hasBounce, true);
});

test('an empty snapshot fails loudly (lessons_learned.md:1224)', (t) => {
    assert.throws(() => loadExistingSongs(snapshot(t, { success: true, data: [] })), /holds no songs/);
    assert.throws(() => loadExistingSongs(snapshot(t, [])), /holds no songs/);
});

test('a malformed snapshot fails loudly', (t) => {
    assert.throws(() => loadExistingSongs(snapshot(t, '{nope')), /could not be read/);
    assert.throws(() => loadExistingSongs(snapshot(t, { trackGroups: 'x' })), /not a list/);
    assert.throws(() => loadExistingSongs(snapshot(t, [{ id: 'not-a-uuid', song_name: 'Sky' }])), /valid id/);
});
