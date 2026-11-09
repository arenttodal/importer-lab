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

// dev.13: "Not a song" — a stem of another song, a sample, or something else. Never hidden: listed.
test('not a song: a sample joins the sample pack in its folder; something else goes to the Not songs list', () => {
    const files = [
        file('Glass Tide.wav', 'bounces', { folder: 'B' }),
        file('Glass Tide Project', 'projects', { folder: 'P' }),
        file('Nv - Kick 1.wav', 'bounces', { folder: 'S' }),
        file('Nv - Kick 2.wav', 'bounces', { folder: 'S' }),
        file('Nv - Snare 1.wav', 'bounces', { folder: 'S' }),
        file('Nv - Clap 1.wav', 'bounces', { folder: 'S' }),
        file('Nv - Boom - Dark Power.wav', 'bounces', { folder: 'S' }),
        file('Phone Memo 3.m4a', 'bounces', { folder: 'B' })
    ];
    const before = groupCatalog(files);
    assert.equal(songOf(before, 'Nv - Boom - Dark Power.wav').kind, 'song');
    const result = groupCatalog(files, { userRules: { notSongs: [{ files: ['Nv - Boom - Dark Power.wav'], reason: 'sample' }, { files: ['Phone Memo 3.m4a'], reason: 'other' }] } });
    const pack = songOf(result, 'Nv - Boom - Dark Power.wav');
    assert.equal(pack.kind, 'sample-pack');
    assert.ok(pack.files.some((member) => member.name === 'Nv - Kick 1.wav'), 'joins the pack already in its folder');
    assert.ok(!songOf(result, 'Phone Memo 3.m4a'));
    assert.deepEqual(result.notSongs.map((member) => member.name), ['Phone Memo 3.m4a']);
    assert.ok(songOf(result, 'Glass Tide.wav').kind === 'song', 'nothing else changes');
});

test('not a song: a stem of another song joins that song as a stem', () => {
    const files = [file('Glass Tide.wav', 'bounces', { folder: 'B' }), file('Glass Tide Project', 'projects', { folder: 'P' }), file('Tide Vox Raw.wav', 'bounces', { folder: 'B' })];
    const result = groupCatalog(files, { userRules: { together: [['Tide Vox Raw.wav', 'Glass Tide.wav', 'Glass Tide Project']], stems: ['Tide Vox Raw.wav'] } });
    const song = songOf(result, 'Tide Vox Raw.wav');
    assert.equal(song, songOf(result, 'Glass Tide.wav'));
    assert.ok(song.files.find((member) => member.name === 'Tide Vox Raw.wav').stemPart, 'counted with the stems');
});

test('sample questions: files beside a sample pack are asked about once, as a list to tick', () => {
    const files = [
        file('Nv - Kick 1.wav', 'bounces', { folder: 'S' }),
        file('Nv - Kick 2.wav', 'bounces', { folder: 'S' }),
        file('Nv - Snare 1.wav', 'bounces', { folder: 'S' }),
        file('Nv - Clap 1.wav', 'bounces', { folder: 'S' }),
        file('Nv - Boom - Dark Power.wav', 'bounces', { folder: 'S' }),
        file('Glass Tide.wav', 'bounces', { folder: 'B' })
    ];
    const result = groupCatalog(files);
    const questions = result.context.sampleQuestions;
    assert.equal(questions.length, 1);
    assert.deepEqual(questions[0].files, ['Nv - Boom - Dark Power.wav']);
    assert.match(questions[0].id, /^f[0-9a-f]{12}$/);
    assert.ok(questions[0].pack, 'names the pack beside them');
    const again = groupCatalog(files, { userRules: { skippedQuestions: [questions[0].id] } });
    assert.equal(again.context.sampleQuestions.length, 0, 'answered or skipped: not asked again');
});

test('sample questions: never for a big mixed folder, never for a song with a project', () => {
    const files = [file('Nv - Kick 1.wav', 'bounces', { folder: 'S' }), file('Nv - Kick 2.wav', 'bounces', { folder: 'S' }), file('Nv - Snare 1.wav', 'bounces', { folder: 'S' }), file('Nv - Clap 1.wav', 'bounces', { folder: 'S' }), file('Nv - Night Drive.wav', 'bounces', { folder: 'S' }), file('Nv - Night Drive Project', 'projects', { folder: 'S' })];
    for (let index = 0; index < 12; index += 1) files.push(file(`Idea ${index} Glasswing${index}.wav`, 'bounces', { folder: 'S' }));
    assert.equal(groupCatalog(files).context.sampleQuestions.length, 0);
});
