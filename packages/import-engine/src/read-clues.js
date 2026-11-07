'use strict';

// SPEC step 4: reads the clues that need file contents or folder listings, for files that are not
// cloud placeholders, and turns them into links between files. Results are cached per file in the
// store (`derived`), so an unchanged file is never read twice.

const fs = require('node:fs');
const path = require('node:path');
const { readAbleton } = require('./clues/ableton');
const { readLogicPackage } = require('./clues/logic');
const { readAudioDuration } = require('./clues/audio-header');
const { findExportBatches } = require('./clues/batches');
const { sharedSampleLinks } = require('./clues/samples');
const { timingLinks } = require('./clues/timing');
const { findDuplicates } = require('./clues/duplicates');
const { isPlaceholderCandidate } = require('./placeholder');

const HEADER_FORMATS = new Set(['wav', 'aif', 'aiff']);
// Bump when a reader changes what it stores, so cached results from older builds are read again.
const CLUES_VERSION = 2;

function lstatOrNull(filePath) {
    try {
        return fs.lstatSync(filePath);
    } catch {
        return null;
    }
}

// The .als inside an Ableton project folder: the one named like the folder, else the newest.
function alsInFolder(item) {
    const candidates = (item.folderContents || []).filter((entry) => !entry.isDir && entry.extension === '.als').map((entry) => entry.name);
    if (!candidates.length) return null;
    const folder = item.name.toLowerCase().replace(/\s+project$/, '');
    const named = candidates.find((name) => name.toLowerCase().replace(/\.als$/, '') === folder);
    if (named) return path.join(item.path, named);
    let newest = null;
    for (const name of candidates) {
        const stat = lstatOrNull(path.join(item.path, name));
        if (stat && (!newest || stat.mtimeMs > newest.mtimeMs)) newest = { name, mtimeMs: stat.mtimeMs };
    }
    return newest ? path.join(item.path, newest.name) : null;
}

function readable(filePath) {
    const stat = lstatOrNull(filePath);
    return stat && stat.isFile() && !isPlaceholderCandidate(stat) ? stat : null;
}

// Reads what each file can tell, filling `derived` (cached) and returning project facts.
function readFileClues(file, item, derived) {
    if (derived.cloudPlaceholder || derived.cluesRead === CLUES_VERSION) return derived;
    const next = { ...derived, cluesRead: CLUES_VERSION };
    if (file.ext === 'als' && item.type === 'file') {
        next.project = readAbleton(item.path);
        next.project = next.project && { ...next.project, savedAtMs: item.mtimeMs };
    } else if (file.ext === 'logicx' || (item.type === 'folder' && item.extension === '.logicx')) {
        next.project = readLogicPackage(item.path);
    } else if (item.type === 'folder') {
        const als = alsInFolder(item);
        const stat = als && readable(als);
        if (stat) {
            const facts = readAbleton(als);
            next.project = facts && { ...facts, savedAtMs: stat.mtimeMs };
        }
    } else if (HEADER_FORMATS.has(file.ext) && item.size > 0) {
        next.durationMs = readAudioDuration(item.path);
    }
    return next;
}

async function readClues(entries, { onProgress = () => {} } = {}) {
    let read = 0;
    let opened = 0;
    let started = Date.now();
    const timings = {};
    for (const entry of entries) {
        const before = entry.derived;
        entry.derived = readFileClues(entry.file, entry.item, entry.derived);
        if (entry.derived !== before) opened += 1;
        if (entry.derived.project) entry.file.project = entry.derived.project;
        if (entry.derived.durationMs) entry.file.durationMs = entry.derived.durationMs;
        read += 1;
        if (read % 250 === 0) onProgress(read);
    }

    timings.readFilesMs = Date.now() - started;
    started = Date.now();
    const local = entries.filter((entry) => !entry.derived.cloudPlaceholder);
    const audio = local.filter((entry) => ['bounces', 'stems'].includes(entry.file.type)).map((entry) => entry.file);
    const projects = local.filter((entry) => entry.derived.project).map((entry) => ({ fileId: entry.file.fileId, ...entry.derived.project }));
    const links = [];

    for (const batch of findExportBatches(audio.map((member) => ({ ...member, mtimeMs: Date.parse(member.modifiedAt) })))) {
        links.push({ clue: 'exportBatch', fileIds: batch.fileIds, weight: 0.9, text: 'Exported together: same folder and format, the same length within 50 ms, saved within minutes.' });
    }
    links.push(...sharedSampleLinks(projects.filter((project) => project.samples && project.samples.length)));
    links.push(...timingLinks(projects.map((project) => ({ ...project, lengthSec: project.lengthSec })), audio.filter((member) => member.type === 'bounces').map((member) => ({ fileId: member.fileId, mtimeMs: Date.parse(member.modifiedAt), durationMs: member.durationMs }))));

    timings.linksMs = Date.now() - started;
    started = Date.now();
    for (const entry of local) if (entry.derived.sha256) entry.file.sha256 = entry.derived.sha256;
    const { duplicates, hashed, checked } = await findDuplicates(audio);
    timings.duplicatesMs = Date.now() - started;
    for (const entry of local) if (entry.file.sha256) entry.derived = { ...entry.derived, sha256: entry.file.sha256 };
    for (const duplicate of duplicates) {
        for (const copy of duplicate.copies) links.push({ clue: 'duplicate', fileIds: [duplicate.keepFileId, copy], weight: 0.99, text: 'The same audio, byte for byte, under another name or folder.' });
    }
    return { links, duplicates, projectsRead: projects.length, timings, counts: { filesOpened: opened, filesNotOpened: entries.length - opened, sameSizeFilesChecked: checked, filesHashedInFull: hashed } };
}

module.exports = { readClues };
