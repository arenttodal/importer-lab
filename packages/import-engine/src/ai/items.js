'use strict';

// What the AI pass may see (SPEC step 7, non-negotiable 7): for each unclear song an opaque id,
// file names, types, extensions, sizes, dates, lengths, folder depth, sibling names and clue texts,
// plus a few candidate songs by name. Never a path, never audio, never account data.
// Ids are hashes of the engine's own proposal ids, so they say nothing and stay the same between
// runs (the cache relies on that).

const crypto = require('node:crypto');
const { tokenize, policy } = require('../names');

const MAX_CANDIDATES = 8;
const MAX_SIBLINGS = 12;
const MAX_TEXT = 200;
const CATEGORY_WORDS = new Set(policy.categoryPrefixes.flatMap((prefix) => prefix.split(' ')));

const opaque = (prefix, proposalId) => prefix + crypto.createHash('sha256').update(String(proposalId)).digest('hex').slice(0, 10);

// Every string that leaves the machine goes through this: no path separators, no long blobs.
function clean(text) {
    // Double quotes become single ones, so the JSON sent carries no escape backslashes either.
    return String(text == null ? '' : text)
        .toWellFormed()
        .replace(/[\\/]+/g, ' ')
        .replace(/"/g, "'")
        .replace(/[\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_TEXT);
}

const day = (iso) => (iso ? String(iso).slice(0, 10) : null);
const folderOf = (file) => String(file.sourceRelativePath || '').split('/').slice(0, -1).join('/');
const depthOf = (file) => Math.max(0, String(file.sourceRelativePath || '').split('/').length - 1);

function lengthOf(file) {
    if (file.durationMs) return Math.round(file.durationMs / 1000);
    if (file.project && file.project.lengthSec) return Math.round(file.project.lengthSec);
    return null;
}

function describeFile(file, siblings) {
    return {
        name: clean(file.name),
        type: file.type,
        ext: clean(file.ext),
        sizeKb: Math.round((file.sizeBytes || 0) / 1024),
        created: day(file.createdAt),
        modified: day(file.modifiedAt),
        lengthSec: lengthOf(file),
        folderDepth: depthOf(file),
        siblings: siblings.slice(0, MAX_SIBLINGS).map(clean)
    };
}

function describeCandidate(song) {
    const dates = song.files.map((file) => day(file.modifiedAt)).filter(Boolean).sort();
    return {
        id: opaque('c', song.proposalId),
        name: clean(song.displayName || song.songName),
        files: song.files.length,
        types: [...new Set(song.files.map((file) => file.type))].sort(),
        dates: dates.length ? `${dates[0]} to ${dates[dates.length - 1]}` : null
    };
}

// Words that say something about which song it is (not category prefixes, not common words).
function songWords(text, common) {
    return new Set(tokenize(String(text)).filter((token) => token.length >= 3 && !/^\d+$/.test(token) && !CATEGORY_WORDS.has(token) && !common.has(token)));
}

// Words in more than 2% of song names (at least 5) say nothing about identity.
function commonWords(songs) {
    const counts = new Map();
    for (const song of songs) for (const token of new Set(tokenize(song.songName))) counts.set(token, (counts.get(token) || 0) + 1);
    const limit = Math.max(5, songs.length * 0.02);
    return new Set([...counts].filter(([, count]) => count > limit).map(([token]) => token));
}

// The unclear songs, each with its own candidates: songs it already has a clue to, songs sharing a
// rare word, songs in the same folder.
function buildItems(allSongs) {
    const songs = allSongs.filter((song) => song.kind === 'song');
    const common = commonWords(songs);
    const filesByFolder = new Map();
    const songsByFolder = new Map();
    for (const song of songs) {
        for (const file of song.files) {
            const folder = folderOf(file);
            if (!filesByFolder.has(folder)) filesByFolder.set(folder, []);
            filesByFolder.get(folder).push(file);
            if (!songsByFolder.has(folder)) songsByFolder.set(folder, new Set());
            songsByFolder.get(folder).add(song);
        }
    }
    const byWord = new Map();
    for (const song of songs) {
        for (const word of songWords(song.songName, common)) {
            if (!byWord.has(word)) byWord.set(word, []);
            byWord.get(word).push(song);
        }
    }
    const byId = new Map(songs.map((song) => [song.proposalId, song]));

    const items = [];
    for (const song of songs.filter((candidate) => candidate.band === 'unclear')) {
        const score = new Map();
        const add = (other, points) => {
            if (!other || other === song) return;
            score.set(other, (score.get(other) || 0) + points);
        };
        for (const match of song.possibleMatches || []) add(byId.get(match.proposalId), 3);
        for (const word of songWords(song.songName, common)) for (const other of byWord.get(word) || []) add(other, 1);
        for (const file of song.files) for (const other of songsByFolder.get(folderOf(file)) || []) add(other, 0.5);
        const candidates = [...score]
            .filter(([, points]) => points >= 1)
            .sort((a, b) => b[1] - a[1] || a[0].songName.localeCompare(b[0].songName))
            .slice(0, MAX_CANDIDATES)
            .map(([other]) => other);
        const own = new Set(song.files.map((file) => file.fileId));
        items.push({
            song,
            candidates,
            payload: {
                id: opaque('i', song.proposalId),
                shownAs: clean(song.displayName || song.songName),
                files: song.files.map((file) => describeFile(file, (filesByFolder.get(folderOf(file)) || []).filter((other) => !own.has(other.fileId)).map((other) => other.name))),
                clues: (song.reasons || []).filter((reason) => reason.clue !== 'ai').map((reason) => clean(reason.text)),
                candidates: candidates.map(describeCandidate)
            }
        });
    }
    return items;
}

module.exports = { buildItems, clean, opaque };
