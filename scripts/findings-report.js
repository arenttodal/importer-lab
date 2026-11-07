'use strict';

// Before/after for every findings row.
// - Anonymised cases (fixtures/cases/findings-cases.json): today's grouper vs the engine.
// - Optional real families: --real <results.json> --families <families.json> [--rules <rules.json>]
//   counts, inside a full-catalog replay, how many songs each family's files fall into today and
//   in the engine. Real names stay in private/; print to the terminal only.

const fs = require('node:fs');
const { cases, rules } = require('../fixtures/cases/findings-cases.json');
const { evaluateCase } = require('../fixtures/cases/evaluate');
const { replay } = require('./replay-results');

function anonymisedTable() {
    return cases.map((testCase) => {
        const result = evaluateCase(testCase, rules);
        return {
            row: result.row,
            files: result.files,
            todaySongs: result.today.songs,
            todayPasses: result.today.failures.length === 0,
            engineSongs: result.engine.songs,
            enginePasses: result.engine.failures.length === 0,
            engineFailures: result.engine.failures
        };
    });
}

function realTable(resultsFile, familiesFile, rulesFile) {
    const run = replay(JSON.parse(fs.readFileSync(resultsFile, 'utf8')), rulesFile ? JSON.parse(fs.readFileSync(rulesFile, 'utf8')) : {});
    const todayOf = new Map();
    for (const group of run.baseline.groups) for (const id of group.fileIds) todayOf.set(id, group.songName);
    const engineOf = new Map();
    for (const song of run.engine.songs) for (const member of song.files) engineOf.set(member.fileId, song);
    const families = JSON.parse(fs.readFileSync(familiesFile, 'utf8'));
    return families.map((family) => {
        const pattern = new RegExp(family.match, 'i');
        const files = run.files.filter((member) => pattern.test(member.name));
        const engineSongs = new Set(files.map((member) => engineOf.get(member.fileId)).filter((song) => song && song.kind === 'song').map((song) => song.proposalId));
        const otherKinds = {};
        for (const member of files) {
            const song = engineOf.get(member.fileId);
            if (song && song.kind !== 'song') otherKinds[song.kind] = (otherKinds[song.kind] || 0) + 1;
        }
        return { row: family.row, family: family.label, files: files.length, todaySongs: new Set(files.map((member) => todayOf.get(member.fileId))).size, engineSongs: engineSongs.size, otherKinds };
    });
}

module.exports = { anonymisedTable, realTable };

if (require.main === module) {
    const args = process.argv.slice(2);
    const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
    console.log('Anonymised cases (row: today songs -> engine songs; passes)');
    for (const line of anonymisedTable()) {
        console.log(`  ${String(line.row).padEnd(10)} ${String(line.files).padStart(3)} files: ${line.todaySongs} -> ${line.engineSongs}   today ${line.todayPasses ? 'pass' : 'FAIL'}, engine ${line.enginePasses ? 'pass' : 'FAIL ' + line.engineFailures.join('; ')}`);
    }
    if (value('--real')) {
        console.log('\nReal families (row, family: files, today songs -> engine songs [other kinds])');
        for (const line of realTable(value('--real'), value('--families'), value('--rules'))) {
            const kinds = Object.entries(line.otherKinds).map(([kind, count]) => `${count} ${kind}`).join(', ');
            console.log(`  ${String(line.row).padEnd(4)} ${line.family.padEnd(34)} ${String(line.files).padStart(3)} files: ${line.todaySongs} -> ${line.engineSongs}${kinds ? ` [${kinds}]` : ''}`);
        }
    }
}
