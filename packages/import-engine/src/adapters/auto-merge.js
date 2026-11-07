'use strict';

// Adapter 11: the pure parts of electron/auto-merge-engine.js (isGenericTitle, normalizeTitleCore,
// inspectAudioBuffer, sha256) without its IPC registration and the modules that need Electron, the
// Library's folders or third-party packages the lab does not ship (unzipper, fs-extra via
// local-track-group-join). Those dependencies are replaced with inert stubs in the require cache
// before the module loads; the stubs throw if anything ever calls them.

const path = require('node:path');
const { VENDOR_ROOT } = require('./vendor');

const ELECTRON_DIR = path.join(VENDOR_ROOT, 'electron');

function refuse(name) {
    return () => {
        throw new Error(`${name} is not available in the read-only lab`);
    };
}

const STUBS = {
    'local-track-group-join.js': { joinLocalTrackGroups: refuse('joinLocalTrackGroups'), planJoin: refuse('planJoin'), collisionProjection: refuse('collisionProjection') },
    'client-diagnostics-native.cjs': { withNativeClientDiagnostics: refuse('withNativeClientDiagnostics') },
    'library-import-availability.cjs': { assertPathAvailable: refuse('assertPathAvailable') }
};

function loadAutoMerge() {
    const target = path.join(ELECTRON_DIR, 'auto-merge-engine.js');
    if (require.cache[target]) return require.cache[target].exports;
    const installed = [];
    for (const [file, exports] of Object.entries(STUBS)) {
        const filename = path.join(ELECTRON_DIR, file);
        if (require.cache[filename]) continue; // the real module is already loaded elsewhere; leave it
        require.cache[filename] = { id: filename, filename, loaded: true, exports, children: [], paths: [] };
        installed.push(filename);
    }
    try {
        return require(target);
    } finally {
        // Remove the stubs so no other module ever receives them.
        for (const filename of installed) delete require.cache[filename];
    }
}

const autoMerge = loadAutoMerge();

module.exports = {
    isGenericTitle: autoMerge.isGenericTitle,
    normalizeTitleCore: autoMerge.normalizeTitleCore,
    inspectAudioBuffer: autoMerge.inspectAudioBuffer,
    sha256: autoMerge.sha256
};
