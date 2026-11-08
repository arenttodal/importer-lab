'use strict';

// M3 adversarial set (docs/INTEGRATION_BRIEF.md §6.3): the AMG-FN-001 negatives the engine must never
// merge, on invented names. The main app's six import test files run unchanged from the pinned
// submodule (`npm test` includes them; fixtures/adversarial/README.md).

const test = require('node:test');
const assert = require('node:assert/strict');
const { groupCatalog } = require('../src/group');
const { sharedSampleLinks } = require('../src/clues/samples');

let nextId = 0;
function file(name, type = 'bounces', extra = {}) {
    nextId += 1;
    return { fileId: `a${nextId}`, name, type, ext: name.split('.').pop().toLowerCase(), sourceContainerId: extra.folder || null, modifiedAt: '2024-01-01T00:00:00.000Z', ...extra };
}
const songOf = (result, name) => result.songs.find((song) => song.files.some((member) => member.name === name));
const sameSong = (result, a, b) => songOf(result, a).proposalId === songOf(result, b).proposalId;

test('repeated silence: byte-identical audio in two different songs is suggested, never merged', () => {
    const files = [file('Harbor Lights.wav'), file('Copper Field.wav')];
    const result = groupCatalog(files, { links: [{ clue: 'duplicate', fileIds: [files[0].fileId, files[1].fileId], weight: 0.99, text: 'The same audio.' }] });
    assert.ok(!sameSong(result, 'Harbor Lights.wav', 'Copper Field.wav'));
});

test('samples reused across songs: the producer\'s library sounds link nothing', () => {
    const projects = ['Kelp', 'Glass', 'Dune', 'Sky'].map((title) => ({ fileId: title, samples: ['my kick.wav|100', 'my snare.wav|200', `${title} vox.wav|300`] }));
    assert.deepEqual(sharedSampleLinks(projects), []);
});

test('copied project templates: two projects with the same samples are only suggested', () => {
    const files = [file('Kelp Forest Project', 'projects'), file('Glass Harbor Project', 'projects')];
    const links = sharedSampleLinks([
        { fileId: files[0].fileId, samples: ['template pad.wav|1', 'template choir.wav|2'] },
        { fileId: files[1].fileId, samples: ['template pad.wav|1', 'template choir.wav|2'] }
    ]);
    const result = groupCatalog(files, { links });
    assert.ok(!sameSong(result, 'Kelp Forest Project', 'Glass Harbor Project'));
    assert.ok(songOf(result, 'Kelp Forest Project').possibleMatches.length === 1);
});

test('different songs with the same title under two clients stay apart', () => {
    const result = groupCatalog([file('QUILL - Intro.wav'), file('QUILL - Outro Theme.wav'), file('MARLOW - Intro.wav'), file('MARLOW - Pinwheel.wav')]);
    assert.ok(!sameSong(result, 'QUILL - Intro.wav', 'MARLOW - Intro.wav'));
});

test('intentionally separate versions: years stay apart, and a version the producer kept apart stays apart', () => {
    const years = groupCatalog([file('AURORA LIVE SET - ASCENT 2023.wav'), file('AURORA LIVE SET - ASCENT 2024.wav')]);
    assert.ok(!sameSong(years, 'AURORA LIVE SET - ASCENT 2023.wav', 'AURORA LIVE SET - ASCENT 2024.wav'));
    const kept = groupCatalog([file('Kelp Forest.wav'), file('Kelp Forest (Remix).wav')], { userRules: { apart: [['Kelp Forest.wav', 'Kelp Forest (Remix).wav']] } });
    assert.ok(!sameSong(kept, 'Kelp Forest.wav', 'Kelp Forest (Remix).wav'));
});
