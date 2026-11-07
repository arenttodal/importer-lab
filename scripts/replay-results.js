'use strict';

// Replays a "Send results to the team" file through today's grouper and the lab engine, using
// names and types only (the file holds no paths). Prints counts; with --cases, prints the
// findings families. Keep real results in private/ (git-ignored); never commit the output.
// Usage: npm run replay -- <results.json> [--rules <rules.json>] [--cases] [--no-edits] [--multi-clue]

const fs = require('node:fs');
const { runBaseline } = require('../packages/import-engine/src/adapters/baseline');
const { groupCatalog } = require('../packages/import-engine/src/group');

function filesFromResults(results) {
    let id = 0;
    return results.songs.flatMap((song) =>
        song.files.map((member) => {
            id += 1;
            return {
                fileId: member.fileId || `r${id}`,
                name: member.name,
                type: member.type,
                ext: (member.name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase(),
                sourceContainerId: member.folderId || null,
                modifiedAt: member.modifiedAt || null,
                sizeBytes: member.sizeBytes || 0,
                cloudPlaceholder: Boolean(member.cloud),
                todaySong: song.name
            };
        })
    );
}

function replay(results, options = {}) {
    const files = filesFromResults(results);
    const baseline = runBaseline(files.map((member) => ({ ...member, path: member.fileId, sourceRelativePath: member.name })), { preserveSourceIdentity: true });
    const engine = groupCatalog(files, options);
    return { files, baseline, engine };
}

function summary({ files, baseline, engine }) {
    const count = (predicate) => engine.songs.filter(predicate).length;
    const kinds = {};
    for (const song of engine.songs) kinds[song.kind] = (kinds[song.kind] || 0) + 1;
    return {
        files: files.length,
        todaysImporterSongs: baseline.groups.length,
        engineSongs: count((song) => song.kind === 'song'),
        bands: { sure: count((song) => song.kind === 'song' && song.band === 'sure'), unsure: count((song) => song.kind === 'song' && song.band === 'unsure'), unclear: count((song) => song.kind === 'song' && song.band === 'unclear') },
        otherKinds: kinds,
        possibleMatches: engine.songs.reduce((sum, song) => sum + song.possibleMatches.length, 0) / 2,
        learned: { namespaces: engine.context.namespaces.length, contributors: engine.context.contributors }
    };
}

module.exports = { replay, summary, filesFromResults };

if (require.main === module) {
    const args = process.argv.slice(2);
    const resultsFile = args.find((arg) => !arg.startsWith('--') && args[args.indexOf(arg) - 1] !== '--rules');
    if (!resultsFile) throw new Error('Usage: npm run replay -- <results.json> [--rules <rules.json>] [--cases]');
    const rulesIndex = args.indexOf('--rules');
    const rules = rulesIndex >= 0 ? JSON.parse(fs.readFileSync(args[rulesIndex + 1], 'utf8')) : {};
    const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
    const run = replay(results, { ...rules, groupEdits: !args.includes('--no-edits'), mergeRule: args.includes('--multi-clue') ? 'multi-clue' : 'exact-identity-only' });
    console.log(JSON.stringify(summary(run), null, 2));
}
