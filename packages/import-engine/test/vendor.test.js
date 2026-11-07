'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { PINNED_COMMIT, VENDOR_ROOT } = require('../src/adapters/vendor');

test('the submodule is checked out at the pinned commit', () => {
    const head = execFileSync('git', ['-C', VENDOR_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    assert.equal(head, PINNED_COMMIT);
});

test('loading the engine never loads Electron, inbox-router or auto-merge-engine', () => {
    require('../src');
    const loaded = Object.keys(require.cache).map((file) => path.basename(file));
    for (const forbidden of ['inbox-router.js', 'auto-merge-engine.js', 'library-import-session.cjs', 'client-diagnostics-native.cjs']) {
        assert.ok(!loaded.includes(forbidden), `${forbidden} must not be loaded`);
    }
    assert.ok(!Object.keys(require.cache).some((file) => /node_modules[\\/]electron[\\/]/.test(file)));
});

test('the main app modules are loaded from the submodule, not copied', () => {
    require('../src');
    const appModules = Object.keys(require.cache).filter((file) => file.includes(`${path.sep}electron${path.sep}`) && file.startsWith(VENDOR_ROOT));
    const names = appModules.map((file) => path.basename(file));
    for (const expected of ['catchall-classifier.js', 'hybrid-grouper.js', 'external-folder-import.js', 'import-canonical-identity.js']) {
        assert.ok(names.includes(expected), `${expected} should come from vendor/the-library`);
    }
});
