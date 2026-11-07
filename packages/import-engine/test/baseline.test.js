'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runBaseline } = require('../src/adapters/baseline');

function files(spec) {
    return spec.map(([name, type], index) => ({ fileId: `f${index}`, name, path: `/music/${name}`, type, sizeBytes: 1, modifiedAt: '2024-01-01T00:00:00.000Z', sourceRelativePath: `music/${name}` }));
}

function groupOf(result, fileId) {
    return result.groups.find((group) => group.fileIds.includes(fileId)).songName;
}

// The brief measured these on today's grouper; the baseline must reproduce them faithfully.
const CASES = files([
    ['Untitled 14.als', 'projects'],
    ['Untitled 37.als', 'projects'],
    ['SKY.wav', 'bounces'],
    ['SKY v2.wav', 'bounces'],
    ['SKY master.wav', 'bounces'],
    ['SKY V2.als', 'projects'],
    ['MG X JC - SKY FINAL.wav', 'bounces'],
    ['Kareal Sky.wav', 'bounces'],
    ['Red Sky 116BPM.wav', 'bounces']
]);

test('baseline reproduces today\'s Untitled false merge', () => {
    const result = runBaseline(CASES, { preserveSourceIdentity: true });
    assert.equal(groupOf(result, 'f0'), groupOf(result, 'f1'));
});

test('baseline reproduces today\'s Sky Final false split', () => {
    const result = runBaseline(CASES, { preserveSourceIdentity: true });
    assert.notEqual(groupOf(result, 'f6'), groupOf(result, 'f2'));
    assert.equal(groupOf(result, 'f2'), groupOf(result, 'f3'));
    assert.equal(groupOf(result, 'f3'), groupOf(result, 'f5'));
});

test('the three-Sky case holds in both modes', () => {
    for (const preserveSourceIdentity of [true, false]) {
        const result = runBaseline(CASES, { preserveSourceIdentity });
        const names = new Set([groupOf(result, 'f2'), groupOf(result, 'f7'), groupOf(result, 'f8')]);
        assert.equal(names.size, 3);
    }
});

test('every grouped file appears exactly once; unknown files are not grouped', () => {
    const input = [...CASES, ...files([['notes.txt', 'unknown']]).map((f) => ({ ...f, fileId: 'u1' }))];
    const result = runBaseline(input, { preserveSourceIdentity: true });
    const ids = result.groups.flatMap((group) => group.fileIds).sort();
    assert.deepEqual(ids, CASES.map((f) => f.fileId).sort());
});

test('grouper logging is captured, and no absolute path is kept in review items', (t) => {
    const logged = t.mock.method(console, 'log');
    const result = runBaseline(files([['zq1 ambient thing.wav', 'bounces'], ['xk zz.wav', 'bounces']]), { preserveSourceIdentity: false });
    assert.equal(logged.mock.callCount(), 0);
    assert.ok(result.log.some((line) => line.startsWith('[Hybrid Grouper]')));
    assert.ok(!JSON.stringify(result.reviewItems).includes('/music/'));
});
