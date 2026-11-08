'use strict';

// Chunks for the AI pass: each under the token budget (SPEC: under 100,000), and items that are
// candidates of each other (shared samples, timing, same words) stay in the same chunk, so the
// model sees them side by side.

const CHUNK_TOKENS = 30000;
const HARD_LIMIT_TOKENS = 100000;

// A cautious estimate: about 3 characters per token for short names and JSON.
const estimateTokens = (value) => Math.ceil(JSON.stringify(value).length / 3);

function clusters(items) {
    const parent = items.map((_, index) => index);
    const find = (index) => (parent[index] === index ? index : (parent[index] = find(parent[index])));
    const indexOfSong = new Map(items.map((item, index) => [item.song.proposalId, index]));
    items.forEach((item, index) => {
        for (const candidate of item.candidates) {
            const other = indexOfSong.get(candidate.proposalId);
            if (other !== undefined) parent[find(other)] = find(index);
        }
    });
    const groups = new Map();
    items.forEach((item, index) => {
        const root = find(index);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(item);
    });
    return [...groups.values()];
}

function chunkItems(items, { budget = CHUNK_TOKENS } = {}) {
    const chunks = [];
    let current = [];
    let tokens = 0;
    const close = () => {
        if (current.length) chunks.push(current);
        current = [];
        tokens = 0;
    };
    for (const group of clusters(items)) {
        const size = group.reduce((sum, item) => sum + estimateTokens(item.payload), 0);
        if (tokens + size > budget) close();
        if (size > budget) {
            // A cluster too big for one chunk is split; it never passes the hard limit.
            for (const item of group) {
                const one = estimateTokens(item.payload);
                if (tokens + one > budget) close();
                current.push(item);
                tokens += one;
            }
            continue;
        }
        current.push(...group);
        tokens += size;
    }
    close();
    return chunks;
}

module.exports = { chunkItems, estimateTokens, CHUNK_TOKENS, HARD_LIMIT_TOKENS };
