'use strict';

// The only place that knows where the main app lives. Every main-app module is loaded through
// requireApp() so the pin is visible in one file. Never copy a main-app file into this repo.

const path = require('node:path');

const PINNED_COMMIT = 'f5af21c7fbdda17ca03b88a5642e5dab27b94788';

const VENDOR_ROOT = process.env.IMPORTER_LAB_VENDOR || path.resolve(__dirname, '../../../../vendor/the-library');

function requireApp(relativePath) {
    return require(path.join(VENDOR_ROOT, relativePath));
}

module.exports = { PINNED_COMMIT, VENDOR_ROOT, requireApp };
