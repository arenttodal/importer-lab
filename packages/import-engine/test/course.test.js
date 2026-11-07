'use strict';

// Tests first for course-prefix detection (a suggestion the producer confirms). Invented names.

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectCoursePrefixes } = require('../src/course');

let nextId = 0;
const file = (name, type = 'bounces') => ({ fileId: `c${(nextId += 1)}`, name, type });

const catalog = [
    file('ZQT - Harp Demo Project', 'projects'),
    file('ZQT - Harp Demo.wav'),
    file('ZQT - Free Taster Project', 'projects'),
    file('ZQT Demo - Night Forest Project', 'projects'),
    file('ZQT Demo - Night Forest.wav'),
    file('ZQT Demo - Ghost 1.2.wav'),
    file('Engine 2 - Overtones Project', 'projects'),
    file('Engine 2 - Depth Project', 'projects'),
    file('Engine 2 - Limits Project', 'projects'),
    file('Lesson Notes - Woodwinds Project', 'projects'),
    file('Tutorial - Recording Textures Project', 'projects'),
    file('Tutorial - Burning Ideas Project', 'projects'),
    file('Tutorial - Woodwinds Project', 'projects'),
    file('Morning 5 - Friday April 21.wav'),
    file('Morning 5 - Friday April 28.wav'),
    file('Morning 5 - Friday June 16.wav'),
    file('QUILL - Take It Over.wav'),
    file('QUILL - Unshakeable.wav'),
    file('QUILL - Unshakeable v2.wav'),
    file('ARN x FRED - What Is.wav'),
    file('ARN x FRED - What Is v2.wav'),
    file('ARN x FRED - Other.wav')
];

test('course prefixes: course words, a shared course code and a numbered series of projects are suggested', () => {
    const found = detectCoursePrefixes(catalog).map((entry) => entry.prefix).sort();
    assert.deepEqual(found, ['engine 2', 'tutorial', 'zqt', 'zqt demo']);
});

test('course prefixes: series of songs, clients and collaborations are never suggested', () => {
    const found = new Set(detectCoursePrefixes(catalog).map((entry) => entry.prefix));
    for (const prefix of ['morning 5', 'quill', 'arn x fred']) assert.ok(!found.has(prefix), prefix);
});

test('course prefixes: confirmed or declined prefixes are not asked again', () => {
    const found = detectCoursePrefixes(catalog, { known: ['tutorial'], declined: ['engine 2'] }).map((entry) => entry.prefix);
    assert.ok(!found.includes('tutorial') && !found.includes('engine 2'));
});

test('course prefixes: an ordinary word in capitals is not a course code', () => {
    const jams = ['GUITAR JAM - One.wav', 'GUITAR JAM - Two.wav', 'GUITAR JAM - Three.wav', 'PUSH JAM - Four.wav', 'PUSH JAM - Five.wav', 'PUSH JAM - Six.wav'].map((name) => file(name));
    assert.deepEqual(detectCoursePrefixes(jams), []);
});

test('course prefixes: a capitalised word that is never a prefix on its own is not a course code', () => {
    const push = ['PUSH JAM - One.wav', 'PUSH JAM - Two.wav', 'PUSH JAM - Three.wav', 'PUSH JAM TEST - Four.wav', 'PUSH JAM TEST - Five.wav', 'PUSH JAM TEST - Six.wav'].map((name) => file(name));
    assert.deepEqual(detectCoursePrefixes(push), []);
});
