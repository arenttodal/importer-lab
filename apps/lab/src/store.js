'use strict';

// Incremental evidence store (SPEC step 1): device-local SQLite through Node's built-in node:sqlite.
// Lives only in the lab data folder. Keeps (device, inode, size, modified) per item plus what was
// derived from it, so a re-scan can skip unchanged files. Lookup is by (device, inode) first and
// falls back to path, because the Dropbox File Provider churns inodes.

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { assertWritable } = require('./fs-guard');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY,
    dev TEXT NOT NULL,
    ino TEXT NOT NULL,
    size INTEGER NOT NULL,
    mtime_ms REAL NOT NULL,
    derived TEXT NOT NULL,
    last_scan_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS files_dev_ino ON files (dev, ino);
CREATE TABLE IF NOT EXISTS scans (
    id TEXT PRIMARY KEY,
    finished_at TEXT NOT NULL,
    stats TEXT NOT NULL
);
`;

function toRecord(row) {
    return row ? { path: row.path, size: row.size, mtimeMs: row.mtime_ms, derived: JSON.parse(row.derived) } : null;
}

function openStore(dbPath) {
    assertWritable(dbPath);
    const db = new DatabaseSync(path.resolve(dbPath));
    db.exec(SCHEMA);
    const byInode = db.prepare('SELECT * FROM files WHERE dev = ? AND ino = ?');
    const byPath = db.prepare('SELECT * FROM files WHERE path = ?');
    const upsert = db.prepare(
        `INSERT INTO files (path, dev, ino, size, mtime_ms, derived, last_scan_id) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (path) DO UPDATE SET dev = excluded.dev, ino = excluded.ino, size = excluded.size,
         mtime_ms = excluded.mtime_ms, derived = excluded.derived, last_scan_id = excluded.last_scan_id`
    );
    const insertScan = db.prepare('INSERT INTO scans (id, finished_at, stats) VALUES (?, ?, ?)');

    return {
        // Returns the stored record for this item, or null. The engine decides whether it is unchanged.
        lookup(item) {
            const sameInode = toRecord(byInode.get(item.dev, item.ino));
            if (sameInode && sameInode.size === item.size && sameInode.mtimeMs === item.mtimeMs) return sameInode;
            return toRecord(byPath.get(item.path));
        },

        saveScan(scanId, records, stats) {
            db.exec('BEGIN');
            try {
                for (const { item, derived } of records) {
                    upsert.run(item.path, item.dev, item.ino, item.size, item.mtimeMs, JSON.stringify(derived), scanId);
                }
                insertScan.run(scanId, new Date().toISOString(), JSON.stringify(stats));
                db.exec('COMMIT');
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        },

        countFiles() {
            return db.prepare('SELECT COUNT(*) AS count FROM files').get().count;
        },

        close() {
            db.close();
        }
    };
}

module.exports = { openStore };
