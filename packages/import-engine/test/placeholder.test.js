'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isPlaceholderCandidate, confirmPlaceholders } = require('../src/placeholder');
const { makeCatalog } = require('./helpers');

test('a sparse file (size, no blocks) is a candidate; empty and real files are not', (t) => {
    const { root } = makeCatalog(t);
    assert.equal(isPlaceholderCandidate(fs.statSync(path.join(root, 'Cloud', 'Glass House_bip.wav'))), true);
    assert.equal(isPlaceholderCandidate(fs.statSync(path.join(root, 'Bounces', 'SKY.wav'))), false);
    const empty = path.join(root, '..', 'empty.wav');
    fs.writeFileSync(empty, '');
    assert.equal(isPlaceholderCandidate(fs.statSync(empty)), false, 'a 0-byte file is empty, not a placeholder');
});

test('off macOS every candidate stays a placeholder (never read when unsure)', async () => {
    const result = await confirmPlaceholders(['/a.wav', '/b.wav'], 'linux');
    assert.deepEqual([...result].sort(), ['/a.wav', '/b.wav']);
});

test('on macOS, stat flags decide', { skip: process.platform !== 'darwin' }, async (t) => {
    const { root } = makeCatalog(t);
    const file = path.join(root, 'Cloud', 'Glass House_bip.wav');
    const result = await confirmPlaceholders([file]);
    assert.ok(result.has(file), 'a sparse file without the "compressed" flag stays a placeholder');
});
