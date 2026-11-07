'use strict';

// File-system guard (non-negotiable 1, Adapter 12). Wraps every Node fs API that can create,
// change, move or delete a file. Writes are allowed only inside the allowed roots (the lab's data
// folder); anything else throws E_LAB_READ_ONLY before touching the disk.
//
// Install it first, in every process and worker thread, before loading any other module:
// modules that destructure fs functions at load time would otherwise keep the unguarded ones.
// SQLite (node:sqlite) writes through native code, so the store checks its own path instead.

const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const WRITE_FLAGS = fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND;

// name -> which arguments are paths that must be inside an allowed root
const CALLBACK_AND_SYNC = {
    writeFile: [0],
    appendFile: [0],
    mkdir: [0],
    mkdtemp: [0],
    rm: [0],
    rmdir: [0],
    unlink: [0],
    rename: [0, 1],
    copyFile: [1],
    cp: [1],
    symlink: [1],
    link: [1],
    truncate: [0],
    chmod: [0],
    lchmod: [0],
    chown: [0],
    lchown: [0],
    utimes: [0],
    lutimes: [0]
};

const PROMISES = { ...CALLBACK_AND_SYNC };

let installed = null;

function toPath(value) {
    if (value instanceof URL) return fileURLToPath(value);
    if (Buffer.isBuffer(value)) return value.toString();
    return String(value);
}

function isInside(child, parent) {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isWriteFlag(flags) {
    if (flags === undefined || flags === null) return false;
    if (typeof flags === 'number') return (flags & WRITE_FLAGS) !== 0;
    return /[wa+]/.test(String(flags));
}

function readOnlyError(operation, target) {
    const error = new Error(`Importer Lab is read-only: ${operation} blocked outside the lab data folder (${target})`);
    error.code = 'E_LAB_READ_ONLY';
    return error;
}

function check(operation, target) {
    const resolved = path.resolve(toPath(target));
    if (installed.allowedRoots.some((root) => isInside(resolved, root))) return;
    installed.violations.push({ operation, path: resolved });
    throw readOnlyError(operation, resolved);
}

function wrap(owner, name, pathArgs, { promise = false, openFlagsArg = null } = {}) {
    const original = owner[name];
    if (typeof original !== 'function') return;
    installed.originals.push([owner, name, original]);
    owner[name] = function guarded(...args) {
        try {
            if (openFlagsArg !== null) {
                if (isWriteFlag(args[openFlagsArg])) check(name, args[0]);
            } else {
                for (const index of pathArgs) check(name, args[index]);
            }
        } catch (error) {
            if (promise) return Promise.reject(error);
            throw error;
        }
        return original.apply(this, args);
    };
}

function installFsGuard({ allowedRoots }) {
    if (installed) throw new Error('File-system guard is already installed');
    if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) throw new Error('The guard needs the lab data folder');
    installed = { allowedRoots: allowedRoots.map((root) => path.resolve(root)), violations: [], originals: [] };

    for (const [name, pathArgs] of Object.entries(CALLBACK_AND_SYNC)) {
        wrap(fs, name, pathArgs);
        wrap(fs, `${name}Sync`, pathArgs);
    }
    for (const [name, pathArgs] of Object.entries(PROMISES)) wrap(fs.promises, name, pathArgs, { promise: true });

    wrap(fs, 'open', [], { openFlagsArg: 1 });
    wrap(fs, 'openSync', [], { openFlagsArg: 1 });
    wrap(fs.promises, 'open', [], { promise: true, openFlagsArg: 1 });
    wrap(fs, 'createWriteStream', [0]);

    return { allowedRoots: installed.allowedRoots, violations: installed.violations };
}

// For tests only.
function uninstallFsGuard() {
    if (!installed) return;
    for (const [owner, name, original] of installed.originals.reverse()) owner[name] = original;
    installed = null;
}

function assertWritable(target) {
    if (!installed) throw new Error('File-system guard is not installed');
    check('write', target);
}

module.exports = { installFsGuard, uninstallFsGuard, assertWritable, isWriteFlag };
