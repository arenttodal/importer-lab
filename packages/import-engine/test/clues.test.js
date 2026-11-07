'use strict';

// Tests first for the clue readers, on the synthetic catalog's real files.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { readAbleton } = require('../src/clues/ableton');
const { readLogicPackage } = require('../src/clues/logic');
const { readAudioDuration } = require('../src/clues/audio-header');
const { findExportBatches } = require('../src/clues/batches');
const { sharedSampleLinks } = require('../src/clues/samples');
const { timingLinks } = require('../src/clues/timing');
const { findDuplicates } = require('../src/clues/duplicates');
const { alsBytes, wavBytes } = require('../../../fixtures/synthetic/generate');
const { makeCatalog } = require('./helpers');

function tempFile(t, name, bytes) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-clue-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, name);
    fs.writeFileSync(file, bytes);
    return file;
}

test('Ableton reader: tempo, track names, sample references and arrangement length', (t) => {
    const file = tempFile(t, 'Sky.als', alsBytes({ tempo: 122, tracks: ['Kick', 'Pad'], samples: ['/Users/p/Samples/808 Kick.wav', '/Users/p/Music/sky pad.wav'], lengthBeats: 384 }));
    const facts = readAbleton(file);
    assert.equal(facts.tempo, 122);
    assert.deepEqual(facts.tracks, ['Kick', 'Pad']);
    assert.deepEqual(facts.samples.sort(), ['808 kick.wav', 'sky pad.wav']);
    assert.equal(facts.lengthBeats, 384);
    assert.equal(Math.round(facts.lengthSec), Math.round((384 * 60) / 122));
});

test('Ableton reader: a damaged or non-Ableton file gives no facts instead of failing the scan', (t) => {
    assert.equal(readAbleton(tempFile(t, 'broken.als', Buffer.from('not gzip'))), null);
});

test('Logic reader: a .logicx package is read as a folder (names and dates only)', (t) => {
    const { root } = makeCatalog(t);
    const facts = readLogicPackage(path.join(root, 'Projects', 'Night Drive.logicx'));
    assert.deepEqual(facts.samples, ['night drive bass#01.wav']);
    assert.deepEqual(facts.bounces, ['Night Drive v3.wav']);
    assert.equal(facts.alternatives, 1);
    assert.ok(facts.savedAtMs > 0);
});

test('audio header: WAV length without reading the audio', (t) => {
    const file = tempFile(t, 'a.wav', wavBytes(2.5, 440));
    assert.equal(readAudioDuration(file), 2500);
    assert.equal(readAudioDuration(tempFile(t, 'b.wav', Buffer.from('nonsense'))), null);
});

test('export batches: same folder and format, lengths within 50 ms, exported within minutes', () => {
    const at = (minutes) => Date.UTC(2024, 0, 1, 12, minutes);
    const files = [
        { fileId: 'mix', sourceContainerId: 'F', ext: 'wav', durationMs: 180000, mtimeMs: at(0) },
        { fileId: 's1', sourceContainerId: 'F', ext: 'wav', durationMs: 180020, mtimeMs: at(1) },
        { fileId: 's2', sourceContainerId: 'F', ext: 'wav', durationMs: 179990, mtimeMs: at(2) },
        { fileId: 'other-length', sourceContainerId: 'F', ext: 'wav', durationMs: 150000, mtimeMs: at(1) },
        { fileId: 'other-folder', sourceContainerId: 'G', ext: 'wav', durationMs: 180000, mtimeMs: at(1) },
        { fileId: 'later', sourceContainerId: 'F', ext: 'wav', durationMs: 180000, mtimeMs: at(240) }
    ];
    const batches = findExportBatches(files);
    assert.deepEqual(batches.map((batch) => batch.fileIds.sort()), [['mix', 's1', 's2']]);
});

test('shared samples: projects sharing two or more samples are linked; library sounds are ignored', () => {
    const projects = [
        { fileId: 'p1', samples: ['sky pad.wav', 'vox chop.wav', '808 kick.wav'] },
        { fileId: 'p2', samples: ['sky pad.wav', 'vox chop.wav', '808 kick.wav'] },
        { fileId: 'p3', samples: ['808 kick.wav', 'other.wav'] },
        ...Array.from({ length: 30 }, (_, index) => ({ fileId: `x${index}`, samples: ['808 kick.wav', `unique ${index}.wav`] }))
    ];
    const links = sharedSampleLinks(projects);
    assert.deepEqual(links.map((link) => link.fileIds.sort()), [['p1', 'p2']]);
    assert.match(links[0].text, /2 rare samples/);
});

test("timing: a bounce saved shortly after a project, with the arrangement's length", () => {
    const projects = [{ fileId: 'p', savedAtMs: Date.UTC(2024, 0, 1, 12, 0), lengthSec: 180 }];
    const bounces = [
        { fileId: 'b-match', mtimeMs: Date.UTC(2024, 0, 1, 12, 5), durationMs: 181000 },
        { fileId: 'b-too-late', mtimeMs: Date.UTC(2024, 0, 2, 12, 0), durationMs: 180000 },
        { fileId: 'b-wrong-length', mtimeMs: Date.UTC(2024, 0, 1, 12, 5), durationMs: 90000 }
    ];
    assert.deepEqual(timingLinks(projects, bounces).map((link) => link.fileIds), [['p', 'b-match']]);
});

test('duplicates: identical content under different names is found; only same-size files are hashed', async (t) => {
    const a = tempFile(t, 'Sky master.wav', wavBytes(1, 440));
    const b = tempFile(t, 'Sky FINAL copy.wav', wavBytes(1, 440));
    const c = tempFile(t, 'Other.wav', wavBytes(1.5, 440));
    const files = [a, b, c].map((filePath, index) => ({ fileId: `d${index}`, path: filePath, sizeBytes: fs.statSync(filePath).size, modifiedAt: `2024-01-0${index + 1}T00:00:00Z` }));
    const { duplicates, hashed } = await findDuplicates(files);
    assert.equal(duplicates.length, 1);
    assert.deepEqual([duplicates[0].keepFileId, duplicates[0].copies], ['d0', ['d1']]);
    assert.equal(hashed, 2, 'the file with a unique size is never read');
});

test('shared samples: a sample in four or more projects is the producer\'s library, not a link', () => {
    const projects = [
        { fileId: 'p1', samples: ['my kick.wav', 'my snare.wav'] },
        { fileId: 'p2', samples: ['my kick.wav', 'my snare.wav'] },
        { fileId: 'p3', samples: ['my kick.wav', 'my snare.wav'] },
        { fileId: 'p4', samples: ['my kick.wav', 'my snare.wav'] }
    ];
    assert.deepEqual(sharedSampleLinks(projects), []);
});

test('ableton: samples are told apart by name and stored size, so same-named recordings do not link', (t) => {
    const set = (refs) => zlib.gzipSync(`<?xml version="1.0"?><Ableton><LiveSet><Tracks></Tracks>${refs.map(([name, size]) => `<FileRef><RelativePath Value="Samples/Recorded/${name}"/><OriginalFileSize Value="${size}"/></FileRef>`).join('')}</LiveSet></Ableton>`);
    const a = readAbleton(tempFile(t, 'A.als', set([['1-Audio 0001.wav', 1000], ['2-Audio 0001.wav', 2000]])));
    const b = readAbleton(tempFile(t, 'B.als', set([['1-Audio 0001.wav', 3000], ['2-Audio 0001.wav', 4000]])));
    assert.deepEqual(sharedSampleLinks([{ fileId: 'a', samples: a.samples }, { fileId: 'b', samples: b.samples }]), []);
});

test('duplicates: same-size files with different content are told apart by a quick edge check, not a full read', async (t) => {
    const a = tempFile(t, 'Glass Drums.wav', wavBytes(1, 440));
    const b = tempFile(t, 'Glass Bass.wav', wavBytes(1, 220));
    const files = [a, b].map((filePath, index) => ({ fileId: `e${index}`, path: filePath, sizeBytes: fs.statSync(filePath).size, modifiedAt: '2024-01-01T00:00:00Z' }));
    assert.equal(files[0].sizeBytes, files[1].sizeBytes);
    const { duplicates, hashed, checked } = await findDuplicates(files);
    assert.deepEqual([duplicates.length, hashed, checked], [0, 0, 2]);
});
