'use strict';

// Logic Pro package reader: a .logicx is a folder, read with directory listings only (no file is
// opened). Gives the audio files it uses (Media/Audio Files), the bounces stored inside it, the
// number of alternatives, and when the project was last saved.

const fs = require('node:fs');
const path = require('node:path');

function list(folder) {
    try {
        return fs.readdirSync(folder, { withFileTypes: true }).filter((entry) => !entry.name.startsWith('.'));
    } catch {
        return [];
    }
}

function readLogicPackage(packagePath) {
    const alternatives = list(path.join(packagePath, 'Alternatives')).filter((entry) => entry.isDirectory());
    if (!alternatives.length) return null;
    let savedAtMs = 0;
    for (const alternative of alternatives) {
        try {
            savedAtMs = Math.max(savedAtMs, fs.statSync(path.join(packagePath, 'Alternatives', alternative.name, 'ProjectData')).mtimeMs);
        } catch {
            /* an alternative without project data */
        }
    }
    const audio = list(path.join(packagePath, 'Media', 'Audio Files'))
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name.toLowerCase());
    const bounces = list(path.join(packagePath, 'Bounces'))
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name);
    return { reader: 'logic', samples: audio.sort(), bounces: bounces.sort(), alternatives: alternatives.length, savedAtMs };
}

module.exports = { readLogicPackage };
