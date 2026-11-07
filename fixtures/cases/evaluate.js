'use strict';

// Runs a findings case through today's grouper and through the lab engine, and checks its
// expectations. Shared by the test suite and scripts/findings-report.js.

const { runBaseline } = require('../../packages/import-engine/src/adapters/baseline');
const { groupCatalog } = require('../../packages/import-engine/src/group');

function caseFiles(testCase) {
    return testCase.files.map(([name, type], index) => ({
        fileId: `c${index}`,
        name,
        type,
        ext: (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase(),
        path: `/case/${index}`,
        sourceRelativePath: name,
        modifiedAt: '2024-01-01T00:00:00.000Z'
    }));
}

function todaysGrouping(files) {
    const baseline = runBaseline(files, { preserveSourceIdentity: true });
    const songOf = new Map();
    for (const group of baseline.groups) for (const id of group.fileIds) songOf.set(id, group.songName);
    return { songCount: baseline.groups.length, songOf, kindOf: () => 'song', proposals: () => false };
}

function engineGrouping(files, options) {
    const result = groupCatalog(files, options);
    const songOf = new Map();
    const kind = new Map();
    for (const song of result.songs) {
        for (const member of song.files) {
            songOf.set(member.fileId, song.proposalId);
            kind.set(member.fileId, song.kind);
        }
    }
    const byId = new Map(result.songs.map((song) => [song.proposalId, song]));
    return {
        songCount: result.songs.filter((song) => song.kind === 'song').length,
        songOf,
        kindOf: (fileId) => kind.get(fileId),
        proposals: (a, b) => byId.get(songOf.get(a))?.possibleMatches.some((match) => match.proposalId === songOf.get(b)) || false
    };
}

function check(testCase, files, grouping) {
    const idOf = new Map(files.map((member) => [member.name, member.fileId]));
    const failures = [];
    for (const names of testCase.together || []) {
        const songs = new Set(names.map((name) => grouping.songOf.get(idOf.get(name))));
        if (songs.size !== 1) failures.push(`split into ${songs.size}: ${names.join(' | ')}`);
    }
    for (const names of testCase.apart || []) {
        const songs = new Set(names.map((name) => grouping.songOf.get(idOf.get(name))));
        if (songs.size !== names.length) failures.push(`merged: ${names.join(' | ')}`);
    }
    for (const [a, b] of testCase.proposals || []) {
        if (!grouping.proposals(idOf.get(a), idOf.get(b))) failures.push(`not proposed: ${a} ~ ${b}`);
    }
    for (const [name, kind] of Object.entries(testCase.kinds || {})) {
        if (grouping.kindOf(idOf.get(name)) !== kind) failures.push(`kind of ${name} is ${grouping.kindOf(idOf.get(name))}, expected ${kind}`);
    }
    if (testCase.songs !== undefined && grouping.songCount !== testCase.songs) failures.push(`${grouping.songCount} songs, expected ${testCase.songs}`);
    return failures;
}

function evaluateCase(testCase, rules = {}) {
    const files = caseFiles(testCase);
    const today = todaysGrouping(files);
    const engine = engineGrouping(files, { ...rules, ...(testCase.options || {}) });
    return {
        row: testCase.row,
        files: files.length,
        today: { songs: today.songCount, failures: check({ ...testCase, proposals: [], kinds: {} }, files, today) },
        engine: { songs: engine.songCount, failures: check(testCase, files, engine) }
    };
}

module.exports = { evaluateCase };
