'use strict';

// Tests first for user rules (SPEC M3: corrections applied first on the next run) and the questions
// that produce them. Invented names.

const test = require('node:test');
const assert = require('node:assert/strict');
const { groupCatalog } = require('../src/group');
const { normalize } = require('../src/user-rules');

let nextId = 0;
function file(name, type = 'bounces', extra = {}) {
    nextId += 1;
    return { fileId: `r${nextId}`, name, type, ext: name.split('.').pop().toLowerCase(), sourceContainerId: extra.folder || null, modifiedAt: '2024-01-01T00:00:00.000Z', ...extra };
}
const songOf = (result, name) => result.songs.find((song) => song.files.some((member) => member.name === name));
const sameSong = (result, ...names) => new Set(names.map((name) => songOf(result, name)?.proposalId)).size === 1;

test('rules keep only known roles and lists of two or more file names', () => {
    const rules = normalize({ prefixes: { Quill: 'band', X: 'nonsense' }, together: [['a.wav'], ['a.wav', 'b.wav']], names: [{ files: ['a.wav'], name: 'Song A' }] });
    assert.deepEqual(rules.prefixes, { quill: 'band' });
    assert.deepEqual(rules.together, [['a.wav', 'b.wav']]);
    assert.equal(rules.names[0].name, 'Song A');
});

test('"Quill is a band": its files group by title within it, even with only one or two files', () => {
    const files = [file('Quill - Paper Moons v2.wav'), file('Paper Moons (mix).wav')];
    const without = groupCatalog(files);
    const withRule = groupCatalog(files, { userRules: { prefixes: { quill: 'band' } } });
    assert.ok(!sameSong(without, 'Quill - Paper Moons v2.wav', 'Paper Moons (mix).wav'));
    assert.ok(sameSong(withRule, 'Quill - Paper Moons v2.wav', 'Paper Moons (mix).wav'));
});

test('"Dawn Patrol is a series": dated entries without a name stay apart, like Morning 5', () => {
    const files = [file('Dawn Patrol - Friday April 21.wav'), file('Dawn Patrol - Friday April 28.wav'), file('Dawn Patrol - March 3 - Kelp Forest.wav'), file('March 9 - Kelp Forest.wav')];
    const result = groupCatalog(files, { userRules: { prefixes: { 'dawn patrol': 'series' } } });
    assert.ok(!sameSong(result, 'Dawn Patrol - Friday April 21.wav', 'Dawn Patrol - Friday April 28.wav'));
    assert.ok(sameSong(result, 'Dawn Patrol - March 3 - Kelp Forest.wav', 'March 9 - Kelp Forest.wav'), 'a name after the date wins');
});

test('"Lx is a sample pack": its files are one sample-pack entry; "Zqt is course"; "Theo is a collaborator"', () => {
    const files = [file('Lx - Boom.wav', 'bounces', { folder: 'A' }), file('Lx - Whoosh Long.wav', 'bounces', { folder: 'B' }), file('Lx - Rain.wav', 'bounces', { folder: 'C' }), file('Zqt - Intro Lesson.wav'), file('Glass Theo.wav'), file('Glass.wav')];
    const result = groupCatalog(files, { userRules: { prefixes: { lx: 'pack', zqt: 'course', theo: 'collaborator' } } });
    assert.ok(sameSong(result, 'Lx - Boom.wav', 'Lx - Whoosh Long.wav', 'Lx - Rain.wav'));
    assert.equal(songOf(result, 'Lx - Boom.wav').kind, 'sample-pack');
    assert.equal(songOf(result, 'Zqt - Intro Lesson.wav').kind, 'course');
    assert.ok(sameSong(result, 'Glass Theo.wav', 'Glass.wav'));
});

test('marks as rules: together joins and is sure, apart splits back to exact names, remove takes a file out, names rename', () => {
    const files = [file('Harbor Lights.wav'), file('Harbor Lights v2.wav'), file('Harbour Light Vocal Idea.wav'), file('Sky Final.wav'), file('Sky.wav'), file('Sky Night.wav'), file('Kelp.wav'), file('Kelp v2.wav')];
    const result = groupCatalog(files, {
        userRules: {
            together: [['Harbor Lights.wav', 'Harbour Light Vocal Idea.wav']],
            apart: [['Sky Final.wav', 'Sky.wav']],
            remove: [{ file: 'Kelp v2.wav', from: ['Kelp.wav'] }],
            names: [{ files: ['Harbor Lights.wav', 'Harbor Lights v2.wav'], name: 'Harbor Lights (Final Title)' }]
        }
    });
    const harbor = songOf(result, 'Harbour Light Vocal Idea.wav');
    assert.ok(sameSong(result, 'Harbor Lights.wav', 'Harbor Lights v2.wav', 'Harbour Light Vocal Idea.wav'));
    assert.equal(harbor.band, 'sure');
    assert.equal(harbor.songName, 'Harbor Lights (Final Title)');
    assert.ok(!sameSong(result, 'Sky Final.wav', 'Sky.wav'), 'a wrong merge the producer marked is undone');
    assert.ok(!sameSong(result, 'Kelp.wav', 'Kelp v2.wav'));
});

test('questions: the prefixes that shape the most files, with a guess, never dates or answered ones', () => {
    const files = [
        ...['One', 'Two', 'Three', 'Four'].map((title) => file(`Quill - ${title}.wav`)),
        ...['Alpha', 'Beta', 'Gamma'].map((title) => file(`March 12 - ${title}.wav`)),
        ...['A', 'B', 'C'].map((title) => file(`Marlow - Song ${title}.wav`))
    ];
    const result = groupCatalog(files, { userRules: { prefixes: { marlow: 'band' } } });
    const asked = result.context.questions.map((question) => question.prefix);
    assert.ok(asked.includes('quill'));
    assert.ok(!asked.includes('march 12'), 'a date is not a prefix');
    assert.ok(!asked.includes('marlow'), 'already answered');
    assert.ok(result.context.questions.every((question) => question.guess && question.examples.length));
});
