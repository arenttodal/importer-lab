'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CONTRACT_VERSION, FILE_TYPES, BANDS, CLUES } = require('..');

const types = fs.readFileSync(path.join(__dirname, '..', 'index.d.ts'), 'utf8');

function unionMembers(source, pattern) {
    const match = source.match(pattern);
    assert.ok(match, `pattern not found: ${pattern}`);
    return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

test('contract version is 1.0.0 in code, types and package.json', () => {
    assert.equal(CONTRACT_VERSION, '1.0.0');
    assert.match(types, /contractVersion: "1\.0\.0"/);
    assert.equal(require('../package.json').version, '1.0.0');
});

test('runtime constants match the type unions', () => {
    assert.deepEqual([...FILE_TYPES], unionMembers(types, /export type FileType = ([^;]+);/));
    assert.deepEqual([...BANDS], unionMembers(types, /band: ([^;]+);/));
    assert.deepEqual([...CLUES], unionMembers(types, /clue:\s*([^;]+);/));
});

test('file types are plural, matching tracks.file_type', () => {
    for (const type of ['bounce', 'stem', 'project', 'video', 'other']) assert.ok(!FILE_TYPES.includes(type));
});
