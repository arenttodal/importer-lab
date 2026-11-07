'use strict';

// Cloud placeholder detector (Adapter 9). The app's check is size === 0 only, which cannot tell an
// empty file from an undownloaded one. Node's fs.Stats has no st_flags, so:
//   1. A file with bytes but no allocated blocks is a candidate (dataless File Provider / iCloud /
//      Dropbox online-only files report their full size with zero blocks).
//   2. On macOS the candidate is confirmed with `stat -f %Sf`, which prints "dataless" for
//      File Provider placeholders and "compressed" for transparently compressed local files.
// A 0-byte file is never a placeholder. When unsure, a candidate stays a placeholder, so its
// contents are never read (reading would trigger a download).

const { execFile } = require('node:child_process');

const MAC_STAT = '/usr/bin/stat';
const BATCH_SIZE = 200;

function isPlaceholderCandidate(stat) {
    return stat.size > 0 && stat.blocks === 0;
}

function runStatFlags(paths) {
    return new Promise((resolve) => {
        execFile(MAC_STAT, ['-f', '%Sf', '--', ...paths], { maxBuffer: 1024 * 1024 }, (error, stdout) => {
            resolve(error ? null : stdout.split('\n'));
        });
    });
}

// Returns the subset of candidate paths that are placeholders.
async function confirmPlaceholders(candidatePaths, platform = process.platform) {
    if (platform !== 'darwin') return new Set(candidatePaths);
    const placeholders = new Set();
    for (let start = 0; start < candidatePaths.length; start += BATCH_SIZE) {
        const batch = candidatePaths.slice(start, start + BATCH_SIZE);
        const lines = await runStatFlags(batch);
        batch.forEach((filePath, index) => {
            const flags = lines ? lines[index] || '' : '';
            if (!lines || !flags.includes('compressed') || flags.includes('dataless')) placeholders.add(filePath);
        });
    }
    return placeholders;
}

module.exports = { isPlaceholderCandidate, confirmPlaceholders };
