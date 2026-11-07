'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

function tempDir(t, prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

// Everything that would reveal a write, rename or delete: names, kinds, sizes, modified times,
// modes, inodes, link targets and content hashes. Access times are left out (reading updates them).
function snapshotTree(root) {
    const entries = [];
    function visit(folder) {
        for (const name of fs.readdirSync(folder).sort()) {
            const full = path.join(folder, name);
            const stat = fs.lstatSync(full);
            const entry = { path: path.relative(root, full), size: stat.size, mtimeMs: stat.mtimeMs, mode: stat.mode, ino: stat.ino, blocks: stat.blocks };
            if (stat.isSymbolicLink()) entry.link = fs.readlinkSync(full);
            else if (stat.isDirectory()) entry.dir = true;
            else if (stat.blocks > 0) entry.sha256 = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
            entries.push(entry);
            if (stat.isDirectory()) visit(full);
        }
    }
    visit(root);
    return entries;
}

module.exports = { tempDir, snapshotTree };
