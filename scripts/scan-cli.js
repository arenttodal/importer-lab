'use strict';

// Headless lab scan: the same worker, guard and store as the Electron app, printed to the terminal.
// Usage: npm run scan -- <folder> [<folder> ...] [--skip-placeholders] [--groups]
// Writes only to the lab data folder (IMPORTER_LAB_DATA, default ./lab-data, git-ignored).

const path = require('node:path');

const DATA_DIR = path.resolve(process.env.IMPORTER_LAB_DATA || path.join(__dirname, '..', 'lab-data'));
require('../apps/lab/src/fs-guard').installFsGuard({ allowedRoots: [DATA_DIR] });

const fs = require('node:fs');
const { startScan } = require('../apps/lab/src/run-scan');
const { toRendererView } = require('../apps/lab/src/view');

async function main() {
    const args = process.argv.slice(2);
    const folders = args.filter((arg) => !arg.startsWith('--'));
    if (folders.length === 0) throw new Error('Usage: npm run scan -- <folder> [<folder> ...] [--skip-placeholders] [--groups]');
    fs.mkdirSync(DATA_DIR, { recursive: true });

    const roots = folders.map((folder) => ({ id: folder, name: path.basename(path.resolve(folder)), path: path.resolve(folder) }));
    const request = {
        roots: roots.map((root) => root.path),
        options: {
            followSymlinks: false,
            includeCloudPlaceholders: args.includes('--skip-placeholders') ? 'skip' : 'list',
            ai: { enabled: false, maxCostUsd: 0, model: '' },
            mergeRule: 'exact-identity-only',
            identityPolicyVersion: 'app-pinned'
        }
    };

    let lastShown = 0;
    const result = await startScan({
        request,
        dataDir: DATA_DIR,
        excludePaths: [DATA_DIR],
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
    console.log(`  today's importer ${baselines.preserve.groups.length} songs keeping prefixes, ${baselines.strip.groups.length} songs stripping prefixes`);
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
