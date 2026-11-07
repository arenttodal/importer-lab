'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateCatalog } = require('../../../fixtures/synthetic/generate');

function makeCatalog(t, options) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-catalog-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return generateCatalog(path.join(dir, 'catalog-a'), options);
}

function scanRequest(roots, overrides = {}) {
    return {
        roots,
        options: {
            followSymlinks: false,
            includeCloudPlaceholders: 'list',
            ai: { enabled: false, maxCostUsd: 0, model: '' },
            mergeRule: 'exact-identity-only',
            identityPolicyVersion: 'app-f5af21c7',
            ...overrides
        }
    };
}

module.exports = { makeCatalog, scanRequest };
