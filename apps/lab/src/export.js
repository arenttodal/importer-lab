'use strict';

// "Send results to the team": one JSON file with names, counts, marks and timings.
// No paths, no audio, no file contents. Written to the lab data folder, then shown in Finder.

const fs = require('node:fs');
const path = require('node:path');

function buildResults({ view, labels, app }) {
    const filesById = new Map(view.files.map((file) => [file.fileId, file]));
    return {
        format: 'importer-lab-results',
        version: 1,
        exportedAt: new Date().toISOString(),
        app,
        scan: {
            scanId: view.scanId,
            durationMs: view.stats.durationMs,
            folders: view.roots.map((root) => root.name),
            foldersRead: view.notes.folders,
            foldersUnreadable: view.notes.unreadableFolders,
            files: view.stats.files,
            typeCounts: view.notes.typeCounts,
            cloudPlaceholders: view.notes.placeholdersFound,
            reusedFromLastScan: view.notes.reusedFromStore
        },
        songs: view.songs.map((song) => ({
            name: song.name,
            unsure: song.unsure,
            counts: song.counts,
            files: song.fileIds.map((id) => ({ name: filesById.get(id).name, type: filesById.get(id).type, cloud: filesById.get(id).cloudPlaceholder || undefined }))
        })),
        todaysImporter: {
            keepPrefixes: view.baselines.preserve.stats,
            stripPrefixes: view.baselines.strip.stats
        },
        marks: labels.marks
    };
}

function exportFileName(date = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    return `Importer Lab results ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}.json`;
}

function writeResults(dataDir, results) {
    const folder = path.join(dataDir, 'exports');
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, exportFileName());
    fs.writeFileSync(file, JSON.stringify(results, null, 2));
    return file;
}

module.exports = { buildResults, writeResults, exportFileName };
