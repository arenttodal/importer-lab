'use strict';

// Lab settings, kept in the lab data folder as settings.json. Folder paths stay in the main process.

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
    version: 1,
    showLabTools: false,
    permissionExplained: false,
    addedFolders: [], // absolute paths the user added or dropped
    checked: {}, // absolute path -> boolean
    scanOptions: { mergeRule: 'exact-identity-only', includeCloudPlaceholders: 'list' }
};

function loadSettings(dataDir) {
    try {
        const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));
        return { ...DEFAULTS, ...saved, scanOptions: { ...DEFAULTS.scanOptions, ...saved.scanOptions } };
    } catch {
        return structuredClone(DEFAULTS);
    }
}

function saveSettings(dataDir, settings) {
    fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify(settings, null, 2));
}

module.exports = { loadSettings, saveSettings, DEFAULTS };
