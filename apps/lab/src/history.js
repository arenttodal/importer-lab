'use strict';

// Previous scans, so a producer can reopen or delete results without scanning again.
// One file per scan in the lab data folder: scans/<scanId>.json, holding the renderer view
// (names, relative folders, counts — no absolute paths) and the catalog id its marks belong to.

const fs = require('node:fs');
const path = require('node:path');

const SCAN_ID = /^[0-9a-f-]{36}$/;

function scansFolder(dataDir) {
    return path.join(dataDir, 'scans');
}

function scanFile(dataDir, scanId) {
    if (!SCAN_ID.test(String(scanId))) throw new Error('Unknown scan');
    return path.join(scansFolder(dataDir), `${scanId}.json`);
}

function saveScan(dataDir, { view, catalogId }) {
    fs.mkdirSync(scansFolder(dataDir), { recursive: true });
    const record = {
        format: 'importer-lab-scan',
        version: 1,
        scanId: view.scanId,
        finishedAt: new Date().toISOString(),
        catalogId,
        folders: view.roots.map((root) => root.name),
        songs: view.songs.length,
        files: view.stats.files,
        view
    };
    fs.writeFileSync(scanFile(dataDir, view.scanId), JSON.stringify(record));
    return summary(record);
}

function summary(record) {
    return { scanId: record.scanId, finishedAt: record.finishedAt, folders: record.folders, songs: record.songs, files: record.files };
}

// Newest first. Unreadable files are skipped rather than breaking the list.
function listScans(dataDir) {
    let names = [];
    try {
        names = fs.readdirSync(scansFolder(dataDir)).filter((name) => name.endsWith('.json'));
    } catch {
        return [];
    }
    const scans = [];
    for (const name of names) {
        try {
            scans.push(summary(JSON.parse(fs.readFileSync(path.join(scansFolder(dataDir), name), 'utf8'))));
        } catch {
            /* skip a damaged file */
        }
    }
    return scans.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
}

function openScan(dataDir, scanId) {
    return JSON.parse(fs.readFileSync(scanFile(dataDir, scanId), 'utf8'));
}

function deleteScan(dataDir, scanId) {
    fs.rmSync(scanFile(dataDir, scanId), { force: true });
}

module.exports = { saveScan, listScans, openScan, deleteScan };
