'use strict';

// Headless lab scan: the same worker, guard and store as the Electron app, printed to the terminal.
// Usage: npm run scan -- <folder> [<folder> ...] [--skip-placeholders] [--groups] [--from-scratch] [--ai[=<cap in dollars>]]
// --ai runs the AI pass with the key from ANTHROPIC_API_KEY or the repository's untracked .env file.
// Writes only to the lab data folder (IMPORTER_LAB_DATA, default ./lab-data, git-ignored).

const path = require('node:path');

const DATA_DIR = path.resolve(process.env.IMPORTER_LAB_DATA || path.join(__dirname, '..', 'lab-data'));
require('../apps/lab/src/fs-guard').installFsGuard({ allowedRoots: [DATA_DIR] });

const fs = require('node:fs');
const { startScan } = require('../apps/lab/src/run-scan');
const { toRendererView } = require('../apps/lab/src/view');
const { findKey } = require('../apps/lab/src/ai-key');

async function main() {
    const args = process.argv.slice(2);
    const folders = args.filter((arg) => !arg.startsWith('--'));
    if (folders.length === 0) throw new Error('Usage: npm run scan -- <folder> [<folder> ...] [--skip-placeholders] [--groups] [--from-scratch] [--ai[=<cap>]]');
    const aiArg = args.find((arg) => arg === '--ai' || arg.startsWith('--ai='));
    const aiKey = aiArg ? findKey({ dataDir: DATA_DIR, devRoot: path.join(__dirname, '..') }).key : null;
    if (aiArg && !aiKey) throw new Error('--ai needs ANTHROPIC_API_KEY in the environment or in the untracked .env file');
    fs.mkdirSync(DATA_DIR, { recursive: true });

    const roots = folders.map((folder) => ({ id: folder, name: path.basename(path.resolve(folder)), path: path.resolve(folder) }));
    const request = {
        roots: roots.map((root) => root.path),
        options: {
            followSymlinks: false,
            includeCloudPlaceholders: args.includes('--skip-placeholders') ? 'skip' : 'list',
            ai: aiArg
                ? { enabled: true, maxCostUsd: aiArg.includes('=') ? Number(aiArg.split('=')[1]) : 0.5, model: 'claude-haiku-5-5', largeModel: 'claude-sonnet-5-5' }
                : { enabled: false, maxCostUsd: 0, model: '' },
            mergeRule: 'exact-identity-only',
            identityPolicyVersion: 'app-pinned'
        }
    };

    let lastShown = 0;
    const result = await startScan({
        request,
        dataDir: DATA_DIR,
        excludePaths: [DATA_DIR],
        fromScratch: args.includes('--from-scratch'),
        aiKey,
        onProgress: (progress) => {
            if (progress.phase !== 'crawl' || progress.files - lastShown >= 1000) {
                lastShown = progress.files;
                process.stderr.write(`  ${progress.phase}: ${progress.files} files, ${progress.folders} folders\n`);
            }
        }
    }).promise;

    const view = toRendererView(result, roots);
    const { stats, notes, baselines } = view;
    console.log(`\nScanned ${roots.map((root) => root.name).join(', ')} in ${(stats.durationMs / 1000).toFixed(1)} s`);
    console.log(`  files            ${stats.files}  (${Object.entries(notes.typeCounts).map(([type, count]) => `${count} ${type}`).join(', ')})`);
    console.log(`  folders read     ${notes.folders}  (unreadable ${notes.unreadableFolders}, symlinks skipped ${notes.symlinksSkipped})`);
    console.log(`  placeholders     ${notes.placeholdersFound} found, ${stats.placeholdersSkipped} left out`);
    console.log(`  reused           ${notes.reusedFromStore} unchanged files from the last scan`);
    if (notes.timings) console.log(`  timings (ms)     ${Object.entries(notes.timings).map(([key, ms]) => `${key.replace(/Ms$/, "")} ${ms}`).join(", ")}`);
    if (notes.clueCounts) console.log(`  clue files       ${JSON.stringify(notes.clueCounts)}`);
    if (notes.readers) console.log(`  readers          ${JSON.stringify(notes.readers)}`);
    console.log(`  today's importer ${baselines.preserve.groups.length} songs keeping prefixes, ${baselines.strip.groups.length} songs stripping prefixes`);
    if (notes.ai) {
        const ai = notes.ai;
        console.log(`  AI pass          $${ai.costUsd} for ${ai.calls.length} calls${ai.capped ? ' (stopped at the cap)' : ''}; asked ${ai.asked}, answered ${ai.answered} (${ai.fromCache} from earlier answers)`);
        console.log(`                   ${ai.suggested} suggestions, ${ai.ownSong} own song, ${ai.notSure} not sure, ${ai.merged} merged; ${ai.errors.length} errors${ai.errors.length ? `: ${ai.errors.join('; ')}` : ''}`);
    }
    console.log(`  ambiguous        ${baselines.preserve.tier3Count} / ${baselines.strip.tier3Count} singletons`);

    if (args.includes('--groups')) {
        const names = new Map(view.files.map((file) => [file.fileId, file.sourceRelativePath]));
        for (const [mode, baseline] of Object.entries(baselines)) {
            console.log(`\nToday's importer (${mode === 'preserve' ? 'keep collaborator prefixes' : 'strip learned prefixes'}):`);
            for (const group of [...baseline.groups].sort((a, b) => a.songName.localeCompare(b.songName))) {
                console.log(`  ${group.songName}`);
                for (const id of group.fileIds) console.log(`      ${names.get(id)}`);
            }
        }
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
