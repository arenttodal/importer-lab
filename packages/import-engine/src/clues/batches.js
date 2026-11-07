'use strict';

// Export batches (FINDINGS row 21): stems and their mix are exported together — same folder, same
// format, the same length within 50 ms, saved within a few minutes of each other.

const LENGTH_TOLERANCE_MS = 50;
const TIME_WINDOW_MS = 10 * 60 * 1000;
const MIN_BATCH = 3;

function findExportBatches(files) {
    const pools = new Map();
    for (const member of files) {
        if (!member.sourceContainerId || !member.durationMs || !member.mtimeMs) continue;
        const key = `${member.sourceContainerId}|${member.ext}`;
        if (!pools.has(key)) pools.set(key, []);
        pools.get(key).push(member);
    }
    const batches = [];
    for (const pool of pools.values()) {
        pool.sort((a, b) => a.durationMs - b.durationMs);
        let run = [];
        const flush = () => {
            // Within one length, split by time: exports minutes apart, not hours.
            run.sort((a, b) => a.mtimeMs - b.mtimeMs);
            let current = [];
            for (const member of run) {
                if (current.length && member.mtimeMs - current[current.length - 1].mtimeMs > TIME_WINDOW_MS) {
                    if (current.length >= MIN_BATCH) batches.push({ fileIds: current.map((item) => item.fileId), durationMs: current[0].durationMs });
                    current = [];
                }
                current.push(member);
            }
            if (current.length >= MIN_BATCH) batches.push({ fileIds: current.map((item) => item.fileId), durationMs: current[0].durationMs });
        };
        for (const member of pool) {
            if (run.length && member.durationMs - run[0].durationMs > LENGTH_TOLERANCE_MS) {
                flush();
                run = [];
            }
            run.push(member);
        }
        flush();
    }
    return batches;
}

module.exports = { findExportBatches };
