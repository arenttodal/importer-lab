'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../src/rules');
const { installFsGuard, uninstallFsGuard } = require('../src/fs-guard');
const { tempDir } = require('./helpers');

function setup(t) {
    t.after(uninstallFsGuard);
    const data = tempDir(t, 'lab-rules-');
    installFsGuard({ allowedRoots: [data] });
    return data;
}

test('prefix answers are saved in the data folder; null forgets one; unknown roles are refused', (t) => {
    const data = setup(t);
    rules.answerPrefixes(data, { Quill: 'band', 'Morning 5': 'series', Bad: 'weird' });
    rules.answerPrefixes(data, { 'morning 5': null });
    assert.deepEqual(rules.loadRules(data).prefixes, { quill: 'band' });
});

test('every mark becomes a rule; marks without file names are resolved from their scan', () => {
    const marks = [
        { kind: 'right', target: 'song', songName: 'Sky', fileNames: ['Sky.wav', 'Sky v2.wav'] },
        { kind: 'merge', target: 'song', songName: 'Glass', fileNames: ['Glass.wav'], mergeWithSongName: 'Glass Idea', scanId: 's1' },
        { kind: 'split', target: 'song', songName: 'Kelp', scanId: 's1' },
        { kind: 'wrong-song', target: 'file', songName: 'Sky', fileName: 'Sky Structure.wav', fileNames: ['Sky.wav', 'Sky Structure.wav'] },
        { kind: 'rename', target: 'song', songName: 'Glass', fileNames: ['Glass.wav'], newName: 'Glasshouse' }
    ];
    const lookup = (scanId, songName) => ({ 'Glass Idea': ['Glass Idea 1.wav'], Kelp: ['Kelp.wav', 'Kelp Forest.wav'] })[songName] || null;
    const built = rules.rulesFromMarks(marks, lookup);
    assert.deepEqual(built.together, [['Sky.wav', 'Sky v2.wav'], ['Glass.wav', 'Glass Idea 1.wav']]);
    assert.deepEqual(built.apart, [['Kelp.wav', 'Kelp Forest.wav']]);
    assert.deepEqual(built.remove, [{ file: 'Sky Structure.wav', from: ['Sky.wav'] }]);
    assert.deepEqual(built.names, [{ files: ['Glass.wav'], name: 'Glasshouse' }]);
});

test('rules from marks can be switched off; prefix answers stay', (t) => {
    const data = setup(t);
    rules.answerPrefixes(data, { quill: 'band' });
    rules.setUseMarks(data, false);
    const built = rules.buildUserRules(data, [{ kind: 'right', target: 'song', songName: 'A', fileNames: ['a.wav', 'b.wav'] }]);
    assert.deepEqual(built, { prefixes: { quill: 'band' }, notSame: [], skippedQuestions: [], together: [], apart: [], remove: [], names: [], stems: [], notSongs: [] });
});

test('answers to the AI\'s questions: "different songs" and "what is" become rules; every answered or skipped id is kept', (t) => {
    const data = setup(t);
    const same = { id: 'q111111111111', kind: 'same-song', songFiles: ['Harbour Lights Bass.wav'], otherFiles: ['Harbour Lights.wav'] };
    const what = { id: 'q222222222222', kind: 'what-is', word: 'ev' };
    rules.answerAiQuestion(data, same, 'different');
    rules.answerAiQuestion(data, what, 'band');
    rules.answerAiQuestion(data, { id: 'q333333333333', kind: 'what-is', word: 'zz' }, 'skip');
    const built = rules.buildUserRules(data, []);
    assert.deepEqual(built.notSame, [{ a: ['Harbour Lights Bass.wav'], b: ['Harbour Lights.wav'] }]);
    assert.equal(built.prefixes.ev, 'band');
    assert.equal(built.prefixes.zz, undefined, 'skipping saves no answer');
    assert.deepEqual(built.skippedQuestions, ['q111111111111', 'q222222222222', 'q333333333333']);
    rules.forgetAiQuestions(data);
    assert.deepEqual(rules.buildUserRules(data, []).skippedQuestions, []);
    assert.equal(rules.buildUserRules(data, []).notSame.length, 1, 'answers stay');
});

test('"Not a song" marks: a stem joins its song; a sample or anything else becomes a not-song rule; sample answers too', (t) => {
    const data = setup(t);
    const marks = [
        { kind: 'not-song', notSongReason: 'stem', target: 'song', songName: 'Tide Vox', fileNames: ['Tide Vox.wav'], stemOfSongName: 'Glass Tide', stemOfFileNames: ['Glass Tide.wav', 'Glass Tide Project'] },
        { kind: 'not-song', notSongReason: 'sample', target: 'song', songName: 'Nv - Boom', fileNames: ['Nv - Boom.wav'] },
        { kind: 'not-song', notSongReason: 'other', target: 'file', songName: 'Memo', fileName: 'Phone Memo 3.m4a' }
    ];
    const built = rules.buildUserRules(data, marks);
    assert.deepEqual(built.together, [['Tide Vox.wav', 'Glass Tide.wav', 'Glass Tide Project']]);
    assert.deepEqual(built.stems, ['Tide Vox.wav']);
    assert.deepEqual(built.notSongs, [{ files: ['Nv - Boom.wav'], reason: 'sample' }, { files: ['Phone Memo 3.m4a'], reason: 'other' }]);
    rules.answerSampleQuestion(data, { id: 'f111111111111', files: ['Kit - Thud.wav', 'Kit - Night Drive.wav'] }, ['Kit - Thud.wav', 'Not offered.wav']);
    const after = rules.buildUserRules(data, []);
    assert.deepEqual(after.notSongs, [{ files: ['Kit - Thud.wav'], reason: 'sample' }], 'only files the question offered');
    assert.deepEqual(after.skippedQuestions, ['f111111111111']);
});
