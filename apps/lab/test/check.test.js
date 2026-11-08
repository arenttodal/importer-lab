'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { drawSample, lowerBound, summarize } = require('../src/check');

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
