'use strict';

// Exact duplicates (FINDINGS row 10): the same content under any name, found with SHA-256 from
// the main app's own hashing (import-content-identity.js). Only files that share a size with
// another file are read; the oldest copy is the one to keep. Nothing is ever deleted.

const { requireApp } = require('../adapters/vendor');

const { hashFileSha256 } = requireApp('electron/import-content-identity.js');

// Real audio is never this small; tiny files (tests, stubs) would all look identical.
const MIN_BYTES = 1024;

async function findDuplicates(files) {
    const bySize = new Map();
    for (const member of files) {
        if (!member.sizeBytes || member.sizeBytes < MIN_BYTES) continue;
        if (!bySize.has(member.sizeBytes)) bySize.set(member.sizeBytes, []);
        bySize.get(member.sizeBytes).push(member);
    }
    const byHash = new Map();
    let hashed = 0;
    for (const sameSize of bySize.values()) {
        if (sameSize.length < 2) continue;
        for (const member of sameSize) {
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
    return { duplicates, hashed };
}

module.exports = { findDuplicates };
