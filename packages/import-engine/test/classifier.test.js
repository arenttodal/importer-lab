'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyItem } = require('../src/adapters/classifier');

function file(name, sourceCategory = null) {
    const extension = name.slice(name.lastIndexOf('.')).toLowerCase();
    return { path: `/x/${name}`, type: 'file', extension, size: 10, mtimeMs: 0, sourceCategory };
}

test('the app classifier result is mapped to plural contract types', () => {
    assert.equal(classifyItem(file('Sky.als')).type, 'projects');
    assert.equal(classifyItem(file('Sky Kick.wav')).type, 'stems');
    assert.equal(classifyItem(file('Sky master.wav')).type, 'bounces');
    assert.equal(classifyItem(file('Sky teaser.mp4')).type, 'videos');
    assert.equal(classifyItem(file('notes.txt')).type, 'unknown');
});

test('a Stems folder makes audio a stem with full confidence (IMP-FN-023)', () => {
    const result = classifyItem(file('Sky.wav', 'stem'));
    assert.deepEqual([result.type, result.confidence], ['stems', 1]);
});

test('a project folder with an .als inside is a project', () => {
    const result = classifyItem({ path: '/x/Sky Project', type: 'folder', extension: '', folderContents: [{ name: 'Sky.als', extension: '.als', isDir: false }] });
    assert.equal(result.type, 'projects');
});
