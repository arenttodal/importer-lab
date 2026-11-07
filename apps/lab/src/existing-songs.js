'use strict';

// Adapter 8: the songs already in a Library, from a snapshot file (an export of the app's
// /api/track-groups pages, or a plain list). Fails loudly when the list is empty or malformed:
// the app once matched every import against an empty list because a bad read fell back to []
// (lessons_learned.md:1224, IMP-FN-027-R22).

const fs = require('node:fs');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rowsOf(parsed) {
    if (Array.isArray(parsed)) return parsed;
    for (const key of ['data', 'songs', 'trackGroups', 'track_groups']) if (Array.isArray(parsed?.[key])) return parsed[key];
    throw new Error('The existing-songs snapshot is not a list of songs.');
}

function loadExistingSongs(filePath) {
    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        throw new Error(`The existing-songs snapshot could not be read: ${error.message}`);
    }
    const byId = new Map();
    for (const row of rowsOf(parsed)) {
        const id = String(row?.id || '');
        const songName = String(row?.song_name ?? row?.songName ?? '').trim();
        if (!UUID.test(id) || !songName) throw new Error('The existing-songs snapshot has a song without a valid id or name.');
        byId.set(id, {
            id,
            songName,
            displayName: String(row.display_name ?? row.displayName ?? ''),
            dropboxFolderPath: row.dropbox_folder_path ?? row.dropboxFolderPath ?? null,
            hasBounce: Boolean(row.has_bounce ?? row.hasBounce),
            hasStems: Boolean(row.has_stems ?? row.hasStems),
            hasProject: Boolean(row.has_project ?? row.hasProject ?? row.has_project_file)
        });
    }
    if (byId.size === 0) throw new Error('The existing-songs snapshot holds no songs. If your Library has songs, export it again; the lab will not match against an empty list.');
    return [...byId.values()];
}

module.exports = { loadExistingSongs };
