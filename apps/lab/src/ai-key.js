'use strict';

// The AI key, in the main process only. The renderer learns whether a key is set and where it came
// from, never the key. The key never ships inside the app (SPEC section 7):
//   1. ANTHROPIC_API_KEY in the environment (scripts and development);
//   2. an untracked .env file: the repository's (development only) or one in the lab data folder;
//   3. a key the producer saved in Settings, encrypted with the macOS keychain (safeStorage) in the
//      lab data folder.

const fs = require('node:fs');
const path = require('node:path');

const KEY_FILE = 'ai-key.bin';

function parseEnv(text) {
    for (const line of String(text).split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?ANTHROPIC_API_KEY\s*=\s*(.*?)\s*$/);
        if (match) return match[1].replace(/^(['"])(.*)\1$/, '$2') || null;
    }
    return null;
}

function readEnvFile(file) {
    try {
        return parseEnv(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

// devRoot: the repository folder, read only when the app is not packaged.
function findKey({ dataDir, devRoot = null, safeStorage = null, env = process.env }) {
    if (env.ANTHROPIC_API_KEY) return { key: env.ANTHROPIC_API_KEY, source: 'environment' };
    const fromDev = devRoot ? readEnvFile(path.join(devRoot, '.env')) : null;
    if (fromDev) return { key: fromDev, source: '.env file' };
    const fromData = readEnvFile(path.join(dataDir, '.env'));
    if (fromData) return { key: fromData, source: '.env file' };
    try {
        const sealed = fs.readFileSync(path.join(dataDir, KEY_FILE));
        if (safeStorage && safeStorage.isEncryptionAvailable()) return { key: safeStorage.decryptString(sealed), source: 'Settings' };
    } catch {
        /* no saved key */
    }
    return { key: null, source: null };
}

function checkKey(key) {
    const text = String(key || '').trim();
    if (text.length < 20 || text.length > 400 || /\s/.test(text)) throw new Error('That does not look like an API key');
    return text;
}

function saveKey(dataDir, key, safeStorage) {
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) throw new Error('This Mac cannot store the key safely; put it in a .env file instead');
    fs.writeFileSync(path.join(dataDir, KEY_FILE), safeStorage.encryptString(checkKey(key)));
}

function removeKey(dataDir) {
    fs.rmSync(path.join(dataDir, KEY_FILE), { force: true });
}

// What the renderer may know.
function keyStatus(found) {
    return { hasKey: Boolean(found.key), source: found.source };
}

module.exports = { parseEnv, findKey, saveKey, removeKey, keyStatus, KEY_FILE };
