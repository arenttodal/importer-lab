'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { drawSample, lowerBound, summarize, CHECK_SIZES } = require('../src/check');

function songs() {
    const list = [];
    for (let i = 0; i < 500; i += 1) list.push({ key: `s${i}`, kind: 'song', band: 'sure', fileIds: ['a'] });
    for (let i = 0; i < 300; i += 1) list.push({ key: `m${i}`, kind: 'song', band: 'sure', fileIds: ['a', 'b'] });
    for (let i = 0; i < 80; i += 1) list.push({ key: `u${i}`, kind: 'song', band: 'unsure', fileIds: ['a', 'b'] });
    for (let i = 0; i < 15; i += 1) list.push({ key: `c${i}`, kind: 'song', band: 'unclear', fileIds: ['a'] });
    list.push({ key: 'pack', kind: 'sample-pack', band: 'sure', fileIds: ['a'] });
    return list;
}

test('check sample: weighted toward songs to check and unclear songs, with weights back to the catalog', () => {
    const sample = drawSample(songs(), { size: 50 });
    assert.equal(sample.length, 50);
    const count = (stratum) => sample.filter((pick) => pick.stratum === stratum).length;
    assert.equal(count('unsure'), 20);
    assert.equal(count('unclear'), 10);
    assert.equal(count('sure-multi'), 13);
    assert.equal(count('sure-single'), 7);
    assert.ok(!sample.some((pick) => pick.key === 'pack'), 'only songs');
    const unsure = sample.find((pick) => pick.stratum === 'unsure');
    const single = sample.find((pick) => pick.stratum === 'sure-single');
    assert.ok(single.weight > 1 && unsure.weight < 1, 'over-sampled strata weigh less');
});

test('check sample: a small stratum gives its share to the others; checked songs are not drawn again', () => {
    const list = songs().filter((song) => song.band !== 'unclear');
    const sample = drawSample(list, { size: 50, exclude: ['u0', 'u1'] });
    assert.equal(sample.length, 50);
    assert.ok(!sample.some((pick) => pick.key === 'u0' || pick.key === 'u1'));
});

test('check sample: a short check of 10 or 20 keeps the weighting', () => {
    const short = drawSample(songs(), { size: 10 });
    assert.equal(short.length, 10);
    const count = (sample, stratum) => sample.filter((pick) => pick.stratum === stratum).length;
    assert.deepEqual(['unsure', 'unclear', 'sure-multi', 'sure-single'].map((name) => count(short, name)), [4, 2, 3, 1]);
    const standard = drawSample(songs(), { size: 20 });
    assert.deepEqual(['unsure', 'unclear', 'sure-multi', 'sure-single'].map((name) => count(standard, name)), [8, 4, 5, 3]);
    assert.deepEqual(CHECK_SIZES, [10, 20, 50]);
    assert.throws(() => drawSample(songs(), { size: 7 }), /10, 20 or 50/);
});

test('confidence: 27 of 27 right means at least 89% at 95% confidence; 0 answers means none', () => {
    assert.equal(Math.floor(lowerBound(27, 27) * 100), 89);
    assert.equal(Math.floor(lowerBound(100, 100) * 1000), 970);
    assert.ok(lowerBound(45, 50) < 0.9 && lowerBound(45, 50) > 0.8);
    assert.equal(lowerBound(0, 0), null);
});

test('summary: counts, the bound, the weighted share and the strata', () => {
    const marks = [
        { kind: 'right', check: true, stratum: 'unsure', sampleWeight: 0.5 },
        { kind: 'split', check: true, stratum: 'unsure', sampleWeight: 0.5 },
        { kind: 'right', check: true, stratum: 'sure-single', sampleWeight: 3 },
        { kind: 'split', target: 'song' }
    ];
    const summary = summarize(marks);
    assert.equal(summary.answered, 3);
    assert.equal(summary.right, 2);
    assert.equal(summary.split, 1);
    assert.equal(summary.weightedRightShare, 0.875);
    assert.equal(summary.byStratum.unsure, 2);
    assert.equal(summary.target, 100);
});

test('summary per engine version, to compare builds', () => {
    const marks = [
        { kind: 'right', check: true, engineVersion: 'a' },
        { kind: 'split', check: true, engineVersion: 'a' },
        { kind: 'right', check: true, engineVersion: 'b' }
    ];
    const summary = summarize(marks);
    assert.deepEqual([summary.byEngineVersion.a.answered, summary.byEngineVersion.a.right, summary.byEngineVersion.b.right], [2, 1, 1]);
});
