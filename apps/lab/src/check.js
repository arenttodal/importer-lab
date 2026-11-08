'use strict';

// "Check songs": a weighted random sample and the confidence it gives.
// Wrong merges hide in songs to check, unclear songs and songs with several files, so the sample is
// drawn mostly from those. Each answer keeps its stratum and weight (the stratum's share of the
// catalog over its share of the sample), so a weighted accuracy for the whole catalog can be
// computed, next to the plain count.

const crypto = require('node:crypto');

const SESSION_SIZE = 50;
const TARGET_MARKS = 100;
// Share of the sample drawn from each stratum; unused share goes to the others.
const SHARES = { unsure: 0.4, unclear: 0.2, 'sure-multi': 0.25, 'sure-single': 0.15 };

function stratumOf(song) {
    if (song.band === 'unsure') return 'unsure';
    if (song.band === 'unclear') return 'unclear';
    return song.fileIds.length > 1 ? 'sure-multi' : 'sure-single';
}

function shuffle(items, random = (size) => crypto.randomInt(size)) {
    const pool = [...items];
    for (let index = pool.length - 1; index > 0; index -= 1) {
        const other = random(index + 1);
        [pool[index], pool[other]] = [pool[other], pool[index]];
    }
    return pool;
}

// songs: renderer songs (key, band, fileIds, kind). Already-checked keys are left out.
function drawSample(songs, { size = SESSION_SIZE, exclude = [], random } = {}) {
    const skip = new Set(exclude);
    const candidates = songs.filter((song) => song.kind === 'song' && !skip.has(song.key));
    const byStratum = {};
    for (const name of Object.keys(SHARES)) byStratum[name] = shuffle(candidates.filter((song) => stratumOf(song) === name), random);
    const total = Math.min(size, candidates.length);
    const quota = {};
    let left = total;
    for (const name of Object.keys(SHARES)) {
        quota[name] = Math.min(byStratum[name].length, Math.floor(total * SHARES[name]));
        left -= quota[name];
    }
    // The remainder goes one each to the largest fractions of a share, then to any stratum with songs left.
    const byFraction = Object.keys(SHARES).sort((a, b) => ((total * SHARES[b]) % 1) - ((total * SHARES[a]) % 1));
    for (const name of byFraction) {
        if (left > 0 && quota[name] < byStratum[name].length) {
            quota[name] += 1;
            left -= 1;
        }
    }
    for (const name of Object.keys(SHARES)) {
        const extra = Math.min(left, byStratum[name].length - quota[name]);
        quota[name] += extra;
        left -= extra;
    }
    const picked = [];
    for (const name of Object.keys(SHARES)) {
        const population = candidates.filter((song) => stratumOf(song) === name).length;
        const weight = quota[name] ? population / candidates.length / (quota[name] / total) : 0;
        for (const song of byStratum[name].slice(0, quota[name])) picked.push({ key: song.key, stratum: name, weight: Math.round(weight * 1000) / 1000 });
    }
    return shuffle(picked, random);
}

// Exact one-sided lower bound (Clopper-Pearson) for a proportion: the smallest p for which seeing
// `right` or more out of `answered` still has at least a 5% chance.
function lowerBound(right, answered, confidence = 0.95) {
    if (!answered) return null;
    if (right === 0) return 0;
    const alpha = 1 - confidence;
    const tail = (p) => {
        let sum = 0;
        let term = Math.pow(1 - p, answered);
        for (let k = 0; k <= answered; k += 1) {
            if (k >= right) sum += term;
            term = term * ((answered - k) / (k + 1)) * (p / (1 - p || 1e-12));
        }
        return sum;
    };
    let low = 0;
    let high = right / answered;
    for (let step = 0; step < 60; step += 1) {
        const mid = (low + high) / 2;
        if (tail(mid) < alpha) low = mid;
        else high = mid;
    }
    return high;
}

// Summary of the check answers (marks with check: true).
function summarize(marks) {
    const answers = marks.filter((mark) => mark.check);
    const count = (kind) => answers.filter((mark) => mark.kind === kind).length;
    const right = count('right');
    const answered = answers.length;
    const weighted = answers.filter((mark) => typeof mark.sampleWeight === 'number' && mark.sampleWeight > 0);
    const weightSum = weighted.reduce((sum, mark) => sum + mark.sampleWeight, 0);
    const weightedRight = weighted.filter((mark) => mark.kind === 'right').reduce((sum, mark) => sum + mark.sampleWeight, 0);
    const bound = lowerBound(right, answered);
    return {
        answered,
        right,
        wrong: count('wrong-song'),
        split: count('split'),
        merge: count('merge'),
        target: TARGET_MARKS,
        lowerBound95: bound === null ? null : Math.floor(bound * 1000) / 1000,
        weightedRightShare: weightSum ? Math.round((weightedRight / weightSum) * 1000) / 1000 : null,
        byStratum: Object.fromEntries(Object.keys(SHARES).map((name) => [name, answers.filter((mark) => mark.stratum === name).length])),
        // The same answers per engine version, to compare builds.
        byEngineVersion: Object.fromEntries(
            [...new Set(answers.map((mark) => mark.engineVersion || 'unknown'))].map((version) => {
                const mine = answers.filter((mark) => (mark.engineVersion || 'unknown') === version);
                const right = mine.filter((mark) => mark.kind === 'right').length;
                return [version, { answered: mine.length, right, lowerBound95: Math.floor((lowerBound(right, mine.length) || 0) * 1000) / 1000 }];
            })
        )
    };
}

module.exports = { drawSample, lowerBound, summarize, stratumOf, SESSION_SIZE, TARGET_MARKS };
