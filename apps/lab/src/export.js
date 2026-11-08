'use strict';

// "Send results to the team": one JSON file with names, counts, marks and timings.
// No paths, no audio, no file contents. Written to the lab data folder, then shown in Finder.
// Version 2 adds, per file, what the engine's clues use — size, modified time, length and an
// opaque folder id (a hash; never a folder name) — and the engine's songs, so the team can replay
// a catalog exactly. Today's song for each file is kept for before/after comparison.

const fs = require('node:fs');
const { summarize } = require('./check');
const path = require('node:path');
const crypto = require('node:crypto');

// A folder id that is stable within one export but means nothing outside it.
function opaqueFolder(sourceRelativePath, salt) {
    const folder = sourceRelativePath.split('/').slice(0, -1).join('/');
    return crypto.createHash('sha256').update(`${salt}\u0000${folder}`).digest('hex').slice(0, 12);
}

function buildResults({ view, labels, app }) {
    const filesById = new Map(view.files.map((file) => [file.fileId, file]));
    const salt = crypto.randomUUID();
    const todayOf = new Map();
    for (const group of view.baselines.preserve.groups) for (const id of group.fileIds) todayOf.set(id, group.songName);
    const fileEntry = (id) => {
        const file = filesById.get(id);
        return {
            fileId: file.fileId,
            name: file.name,
            type: file.type,
            cloud: file.cloudPlaceholder || undefined,
            sizeBytes: file.sizeBytes,
            modifiedAt: file.modifiedAt,
            durationMs: file.durationMs || undefined,
            folderId: opaqueFolder(file.sourceRelativePath, salt),
            versionLabel: file.versionLabel || undefined,
            stemPart: file.stemPart || undefined,
            today: todayOf.get(file.fileId)
        };
    };
    return {
        format: 'importer-lab-results',
        version: 2,
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
            reusedFromLastScan: view.notes.reusedFromStore,
            projectsRead: view.notes.projectsRead,
            timings: view.notes.timings || {},
            fromScratch: Boolean(view.notes.fromScratch),
            clueCounts: view.notes.clueCounts || {},
            readers: view.notes.readers || {},
            // The AI pass: counts, cost and one line per call (models, tokens, dollars). No key.
            ai: view.notes.ai || null,
            aiCostUsd: view.stats.aiCostUsd || 0,
            engineVersion: view.engineVersion,
            policyVersion: view.policyVersion
        },
        songs: view.songs.map((song) => ({
            name: song.name,
            kind: song.kind,
            band: song.band,
            confidence: song.confidence,
            unsure: song.unsure,
            counts: song.counts,
            versions: song.versions.map((version) => version.label),
            possibleMatches: song.possibleMatches.map((match) => match.songName),
            files: song.fileIds.map(fileEntry)
        })),
        otherFiles: view.files.filter((file) => file.type === 'unknown').map((file) => fileEntry(file.fileId)),
        todaysImporter: {
            keepPrefixes: view.baselines.preserve.stats,
            stripPrefixes: view.baselines.strip.stats
        },
        marks: labels.marks,
        check: checkSummary(labels.marks, view.scanId)
    };
}

// Answers from "Check songs" (a weighted random sample) across this catalog's scans, with the
// confidence they give; thisScan counts the answers given on the exported scan.
function checkSummary(marks, scanId) {
    return { ...summarize(marks), thisScan: marks.filter((mark) => mark.check && mark.scanId === scanId).length };
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
