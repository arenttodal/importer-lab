'use strict';

// Course and series prefixes found in the catalog itself, so a producer never has to type them.
// Only ever a suggestion: the lab asks "Looks like course material: … Confirm?" and the manual
// setting stays as an override. A prefix is the first segment of a name ("ZQT - Harp Demo").
//
// Signals (any one, for a prefix with at least three files):
//   1. a course word in the prefix, or in most of its names (tutorial, lesson, module, voice over…);
//   2. an upper-case code that is a prefix on its own and appears in at least one other prefix,
//      with five or more files between them ("ZQT", "ZQT Demo"); ordinary catalog words in
//      capitals ("JAM") never count;
//   3. a prefix ending in a number whose files are all projects ("Engine 1": lesson projects).
// Category prefixes (Morning 5, Beat Idea…), learned contributors and "A x B" collaborations are
// never suggested.

const { preClean } = require('./adapters/vendor').requireApp('electron/import-canonical-identity.js');
const { tokenize, segmentsOf, policy } = require('./names');

const MIN_FILES = 3;
const CODE_MIN_FILES = 5;
const COURSE_WORDS = new Set(policy.kinds.courseSignalWords);
const CATEGORY = new Set(policy.categoryPrefixes);
// Upper-case words that are ordinary catalog words ("JAM", "WIP", "VOX") are never course codes.
const ORDINARY = new Set([...policy.categoryPrefixes.flatMap((prefix) => prefix.split(' ')), ...policy.stageWords, ...policy.renderWords, ...policy.editWords, ...policy.stemWords, ...policy.formatWords, ...policy.months, ...policy.weekdays]);

function firstSegment(name) {
    const raw = String(name).split(/\s+-+\s*|\s*-+\s+/)[0].trim();
    const tokens = segmentsOf(preClean(name))[0] || [];
    return { raw, prefix: tokens.join(' ') };
}

function hasCourseWord(text) {
    const tokens = tokenize(text);
    return tokens.some((token) => COURSE_WORDS.has(token)) || tokens.join(' ').includes('voice over');
}

function detectCoursePrefixes(files, { contributors = [], known = [], declined = [] } = {}) {
    const skip = new Set([...known, ...declined].map((prefix) => prefix.toLowerCase()));
    const byPrefix = new Map();
    for (const member of files) {
        if (!/\s-+\s*|\s*-+\s/.test(member.name)) continue;
        const { raw, prefix } = firstSegment(member.name);
        if (!prefix) continue;
        if (!byPrefix.has(prefix)) byPrefix.set(prefix, { prefix, raws: new Set(), files: [] });
        byPrefix.get(prefix).raws.add(raw);
        byPrefix.get(prefix).files.push(member);
    }
    const eligible = [...byPrefix.values()].filter((entry) => {
        const tokens = entry.prefix.split(' ');
        return entry.files.length >= MIN_FILES && !CATEGORY.has(entry.prefix) && !tokens.includes('x') && !tokens.some((token) => contributors.includes(token));
    });

    // Upper-case codes and the prefixes they appear in.
    const codePrefixes = new Map();
    for (const entry of eligible) {
        for (const raw of entry.raws) {
            for (const word of raw.split(/\s+/)) {
                if (!/^[A-Z]{2,4}$/.test(word)) continue;
                const code = word.toLowerCase();
                if (ORDINARY.has(code)) continue;
                if (!codePrefixes.has(code)) codePrefixes.set(code, new Set());
                codePrefixes.get(code).add(entry);
            }
        }
    }

    const found = new Map();
    const add = (entry, signal) => {
        if (skip.has(entry.prefix) || found.has(entry.prefix)) return;
        found.set(entry.prefix, { prefix: entry.prefix, files: entry.files.length, signal });
    };
    for (const entry of eligible) {
        const named = entry.files.filter((member) => hasCourseWord(member.name)).length;
        if (hasCourseWord(entry.prefix) || named * 2 > entry.files.length) add(entry, 'course words');
    }
    for (const [code, entries] of codePrefixes) {
        const total = [...entries].reduce((sum, entry) => sum + entry.files.length, 0);
        const standsAlone = [...entries].some((entry) => entry.prefix === code);
        if (standsAlone && entries.size >= 2 && total >= CODE_MIN_FILES) for (const entry of entries) add(entry, 'a course code used in several prefixes');
    }
    for (const entry of eligible) {
        if (/\s\d+$/.test(entry.prefix) && entry.files.every((member) => member.type === 'projects')) add(entry, 'a numbered series of projects');
    }
    return [...found.values()].sort((a, b) => b.files - a.files || a.prefix.localeCompare(b.prefix));
}

module.exports = { detectCoursePrefixes };
