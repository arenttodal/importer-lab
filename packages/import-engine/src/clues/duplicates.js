'use strict';

// Exact duplicates (FINDINGS row 10): the same content under any name, found with SHA-256 from
// the main app's own hashing (import-content-identity.js). Only files that share a size with
// another file are looked at, and of those only files whose first and last 64 KB also match are
// read in full (stems exported together often share a size but not their content). The oldest copy
// is the one to keep. Nothing is ever deleted.

const fs = require('node:fs');
const crypto = require('node:crypto');
const { requireApp } = require('../adapters/vendor');

const { hashFileSha256 } = requireApp('electron/import-content-identity.js');

// Real audio is never this small; tiny files (tests, stubs) would all look identical.
const MIN_BYTES = 1024;
const EDGE_BYTES = 64 * 1024;

// A quick fingerprint of the first and last 64 KB: a pre-check only; the app's hash decides.
function edgeFingerprint(filePath, size) {
    let handle;
    try {
        handle = fs.openSync(filePath, 'r');
        const length = Math.min(EDGE_BYTES, size);
        const head = Buffer.alloc(length);
        const tail = Buffer.alloc(length);
        fs.readSync(handle, head, 0, length, 0);
        fs.readSync(handle, tail, 0, length, Math.max(0, size - length));
        return crypto.createHash('sha256').update(head).update(tail).digest('hex');
    } catch {
        return null;
    } finally {
        if (handle !== undefined) fs.closeSync(handle);
    }
}

async function findDuplicates(files) {
    const bySize = new Map();
    for (const member of files) {
        if (!member.sizeBytes || member.sizeBytes < MIN_BYTES) continue;
        if (!bySize.has(member.sizeBytes)) bySize.set(member.sizeBytes, []);
        bySize.get(member.sizeBytes).push(member);
    }
    const byHash = new Map();
    let hashed = 0;
    let checked = 0;
    const candidates = [];
    for (const sameSize of bySize.values()) {
        if (sameSize.length < 2) continue;
        const byEdges = new Map();
        for (const member of sameSize) {
            const edges = edgeFingerprint(member.path, member.sizeBytes);
            checked += 1;
            if (!edges) continue;
            if (!byEdges.has(edges)) byEdges.set(edges, []);
            byEdges.get(edges).push(member);
        }
        for (const group of byEdges.values()) if (group.length >= 2) candidates.push(group);
    }
    for (const sameEdges of candidates) {
        for (const member of sameEdges) {
            const sha256 = member.sha256 || (await hashFileSha256(member.path).catch(() => null));
            if (!member.sha256 && sha256) hashed += 1;
            if (!sha256) continue;
            member.sha256 = sha256;
            if (!byHash.has(sha256)) byHash.set(sha256, []);
            byHash.get(sha256).push(member);
        }
    }
    const duplicates = [];
    for (const [sha256, copies] of byHash) {
        if (copies.length < 2) continue;
        copies.sort((a, b) => String(a.modifiedAt).localeCompare(String(b.modifiedAt)) || a.fileId.localeCompare(b.fileId));
        duplicates.push({ sha256, keepFileId: copies[0].fileId, copies: copies.slice(1).map((member) => member.fileId) });
    }
    return { duplicates, hashed, checked };
}

module.exports = { findDuplicates };
