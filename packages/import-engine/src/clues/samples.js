'use strict';

// Shared samples (SPEC step 4): projects that share two or more rare samples may be versions of one
// song. A sample is rare when at most 3 projects use it; anything more common is the producer's
// library (their own drum hits and loops reused everywhere) and counts for nothing.

const MIN_SHARED = 2;
const RARE_MAX_PROJECTS = 3;

function sharedSampleLinks(projects) {
    const usage = new Map();
    for (const project of projects) for (const sample of new Set(project.samples)) usage.set(sample, (usage.get(sample) || 0) + 1);
    const own = (project) => new Set(project.samples.filter((sample) => (usage.get(sample) || 0) <= RARE_MAX_PROJECTS));
    const index = new Map();
    const owned = projects.map((project) => ({ project, samples: own(project) }));
    for (const { project, samples } of owned) for (const sample of samples) {
        if (!index.has(sample)) index.set(sample, []);
        index.get(sample).push(project.fileId);
    }
    const pairs = new Map();
    for (const fileIds of index.values()) {
        if (fileIds.length < 2) continue;
        for (let i = 0; i < fileIds.length; i += 1) for (let j = i + 1; j < fileIds.length; j += 1) {
            const key = [fileIds[i], fileIds[j]].sort().join('|');
            pairs.set(key, (pairs.get(key) || 0) + 1);
        }
    }
    return [...pairs.entries()]
        .filter(([, count]) => count >= MIN_SHARED)
        .map(([key, count]) => ({ clue: 'sharedSamples', fileIds: key.split('|'), weight: 0.7, text: `These projects use ${count} rare samples in common (sounds used in many projects left out).` }));
}

module.exports = { sharedSampleLinks };
