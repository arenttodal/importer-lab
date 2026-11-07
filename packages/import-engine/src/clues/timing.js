'use strict';

// Timing (SPEC step 4): a bounce saved up to 30 minutes after a project was saved, with a length
// within 5% (or 2 seconds) of the project's arrangement, was probably bounced from that project.

const WINDOW_MS = 30 * 60 * 1000;

function timingLinks(projects, bounces) {
    const sorted = projects.filter((project) => project.savedAtMs && project.lengthSec).sort((a, b) => a.savedAtMs - b.savedAtMs);
    const links = [];
    for (const bounce of bounces) {
        if (!bounce.mtimeMs || !bounce.durationMs) continue;
        for (const project of sorted) {
            const gap = bounce.mtimeMs - project.savedAtMs;
            if (gap < 0) break;
            if (gap > WINDOW_MS) continue;
            const lengthMs = project.lengthSec * 1000;
            if (Math.abs(bounce.durationMs - lengthMs) <= Math.max(2000, lengthMs * 0.05)) {
                links.push({ clue: 'timing', fileIds: [project.fileId, bounce.fileId], weight: 0.6, text: `Bounced ${Math.round(gap / 60000)} min after the project was saved, with the same length.` });
            }
        }
    }
    return links;
}

module.exports = { timingLinks };
