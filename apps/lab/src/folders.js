'use strict';

// Where music usually lives: suggested home folders, mounted drives, and folders the user added.
// macOS asks for permission the first time an app reads these protected places (TCC).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SUGGESTED = ['Music', 'Desktop', 'Documents'];

function folderId(folderPath) {
    return crypto.createHash('sha256').update(folderPath).digest('hex').slice(0, 12);
}

function isDirectory(folderPath) {
    try {
        return fs.statSync(folderPath).isDirectory();
    } catch {
        return false;
    }
}

function isInside(child, parent) {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

// Mounted drives: real folders in /Volumes (the startup disk appears there as a symlink to /).
function mountedDrives(platform = process.platform) {
    const bases = platform === 'darwin' ? ['/Volumes'] : platform === 'linux' ? [path.join('/media', os.userInfo().username)] : [];
    const drives = [];
    for (const base of bases) {
        let entries = [];
        try {
            entries = fs.readdirSync(base, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.')) drives.push(path.join(base, entry.name));
        }
    }
    return drives;
}

function protectedPlaces(home = os.homedir()) {
    return [
        path.join(home, 'Desktop'),
        path.join(home, 'Documents'),
        path.join(home, 'Downloads'),
        path.join(home, 'Library', 'Mobile Documents'),
        '/Volumes'
    ];
}

function isProtected(folderPath, home = os.homedir()) {
    return protectedPlaces(home).some((place) => isInside(folderPath, place));
}

// Every folder the user can tick. Music is ticked by default; everything else starts unticked.
function listFolders(settings, { home = os.homedir(), platform = process.platform } = {}) {
    const folders = [];
    const seen = new Set();
    function add(folderPath, kind) {
        if (seen.has(folderPath) || !isDirectory(folderPath)) return;
        seen.add(folderPath);
        const fallback = kind === 'suggested' && path.basename(folderPath) === 'Music';
        folders.push({
            id: folderId(folderPath),
            name: path.basename(folderPath) || folderPath,
            kind,
            checked: settings.checked[folderPath] ?? fallback,
            protected: isProtected(folderPath, home),
            path: folderPath
        });
    }
    for (const name of SUGGESTED) add(path.join(home, name), 'suggested');
    for (const drive of mountedDrives(platform)) add(drive, 'drive');
    for (const added of settings.addedFolders) add(added, 'added');
    return folders;
}

// What the renderer may see: no paths.
function publicFolders(folders) {
    return folders.map(({ path: _path, ...rest }) => rest);
}

module.exports = { listFolders, publicFolders, isProtected, mountedDrives, folderId };
