'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv, findKey, saveKey, removeKey, keyStatus, KEY_FILE } = require('../src/ai-key');
const { tempDir } = require('./helpers');

const KEY = 'sk-test-0123456789abcdefghij';
// Stands in for Electron's safeStorage (the macOS keychain).
const fakeSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from(text.split('').reverse().join('')),
    decryptString: (buffer) => buffer.toString().split('').reverse().join('')
};

test('.env: the key line is read, with or without quotes or export', () => {
    assert.equal(parseEnv(`# comment\nOTHER=1\nANTHROPIC_API_KEY=${KEY}\n`), KEY);
    assert.equal(parseEnv(`export ANTHROPIC_API_KEY="${KEY}"`), KEY);
    assert.equal(parseEnv('OTHER=1'), null);
});

test('the key is found in the environment, a .env file, or Settings, in that order; the renderer only learns where', (t) => {
    const data = tempDir(t, 'lab-key-');
    assert.deepEqual(findKey({ dataDir: data, env: {} }), { key: null, source: null });
    saveKey(data, KEY, fakeSafeStorage);
    assert.ok(!fs.readFileSync(path.join(data, KEY_FILE)).toString().includes(KEY), 'not stored in plain text');
    assert.deepEqual(findKey({ dataDir: data, env: {}, safeStorage: fakeSafeStorage }), { key: KEY, source: 'Settings' });
    fs.writeFileSync(path.join(data, '.env'), `ANTHROPIC_API_KEY=${KEY}x`);
    assert.equal(findKey({ dataDir: data, env: {}, safeStorage: fakeSafeStorage }).source, '.env file');
    assert.equal(findKey({ dataDir: data, env: { ANTHROPIC_API_KEY: 'from-env' } }).source, 'environment');
    const status = keyStatus(findKey({ dataDir: data, env: {}, safeStorage: fakeSafeStorage }));
    assert.deepEqual(status, { hasKey: true, source: '.env file' });
    fs.rmSync(path.join(data, '.env'));
    removeKey(data);
    assert.equal(findKey({ dataDir: data, env: {}, safeStorage: fakeSafeStorage }).key, null);
});

test('a key is refused when it cannot be stored safely or does not look like a key', (t) => {
    const data = tempDir(t, 'lab-key-');
    assert.throws(() => saveKey(data, KEY, { isEncryptionAvailable: () => false }), /cannot store the key safely/);
    assert.throws(() => saveKey(data, 'short', fakeSafeStorage), /does not look like an API key/);
});
