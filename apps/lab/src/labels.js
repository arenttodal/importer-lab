'use strict';

// "This is wrong" marks, one file per catalog in the lab data folder: labels/<catalogId>.json.
// Names, opaque ids and marks only — never paths or file contents (SPEC section 7).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// 'right' is the answer "Right" in the 30-song check: the song is correct as shown.
const KINDS = new Set(['wrong-song', 'split', 'merge', 'right']);

function catalogId(rootPaths) {
    return crypto.createHash('sha256').update([...rootPaths].sort().join('\u0000')).digest('hex').slice(0, 12);
}

function labelsPath(dataDir, id) {
    return path.join(dataDir, 'labels', `${id}.json`);
}

function loadLabels(dataDir, id) {
    try {
        return JSON.parse(fs.readFileSync(labelsPath(dataDir, id), 'utf8'));
    } catch {
        return { format: 'importer-lab-labels', version: 1, catalogId: id, marks: [] };
    }
}

function saveLabels(dataDir, labels) {
    fs.mkdirSync(path.join(dataDir, 'labels'), { recursive: true });
    fs.writeFileSync(labelsPath(dataDir, labels.catalogId), JSON.stringify(labels, null, 2));
}

function cleanMark(input, context) {
    if (!KINDS.has(input.kind)) throw new Error(`Unknown mark: ${input.kind}`);
    if (input.target !== 'song' && input.target !== 'file') throw new Error('A mark is on a song or a file');
    const text = (value) => (value == null ? null : String(value).slice(0, 500));
    return {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        kind: input.kind,
        target: input.target,
        songName: text(input.songName),
        fileId: input.target === 'file' ? text(input.fileId) : null,
        fileName: input.target === 'file' ? text(input.fileName) : null,
        fileType: input.target === 'file' ? text(input.fileType) : null,
        mergeWithSongName: input.kind === 'merge' ? text(input.mergeWithSongName) : null,
        // Answers from "Check 30 songs" (a random sample) are flagged, with the song's band and kind.
        check: input.check === true,
        songBand: input.check === true ? text(input.songBand) : null,
        songKind: input.check === true ? text(input.songKind) : null,
        scanId: context.scanId,
        engineVersion: context.engineVersion
    };
}

function addMark(dataDir, id, input, context) {
    const labels = loadLabels(dataDir, id);
    const mark = cleanMark(input, context);
    labels.marks.push(mark);
    saveLabels(dataDir, labels);
    return mark;
}

function updateMark(dataDir, id, markId, changes) {
    const labels = loadLabels(dataDir, id);
    const mark = labels.marks.find((candidate) => candidate.id === markId);
    if (!mark) throw new Error('Mark not found');
    if (changes.mergeWithSongName !== undefined && mark.kind === 'merge') mark.mergeWithSongName = String(changes.mergeWithSongName).slice(0, 500);
    saveLabels(dataDir, labels);
    return mark;
}

function removeMark(dataDir, id, markId) {
    const labels = loadLabels(dataDir, id);
    labels.marks = labels.marks.filter((mark) => mark.id !== markId);
    saveLabels(dataDir, labels);
}

module.exports = { catalogId, loadLabels, addMark, updateMark, removeMark };
