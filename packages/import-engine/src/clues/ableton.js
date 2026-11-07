'use strict';

// Ableton Live set reader (.als = gzipped XML): tempo, track names, sample references and the
// arrangement length (the furthest clip end). Reads one file the caller has checked is not a
// cloud placeholder. Sample paths are reduced to file names (plus the stored size): full paths never
// leave this module.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const MAX_COMPRESSED_BYTES = 64 * 1024 * 1024;

function decodeXmlText(value) {
    return value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function readAbleton(filePath) {
    let xml;
    try {
        const stat = fs.statSync(filePath);
        if (stat.size > MAX_COMPRESSED_BYTES) return null;
        xml = zlib.gunzipSync(fs.readFileSync(filePath)).toString('utf8');
    } catch {
        return null;
    }
    if (!/<Ableton\b/.test(xml)) return null;

    const tempo = Number(xml.match(/<Tempo>[\s\S]*?<Manual Value="([\d.]+)"/)?.[1]) || null;
    const tracksBlock = xml.match(/<Tracks>([\s\S]*?)<\/Tracks>/)?.[1] || '';
    const tracks = [...tracksBlock.matchAll(/<EffectiveName Value="([^"]*)"/g)].map((match) => decodeXmlText(match[1]));
    const samples = new Set();
    for (const ref of xml.matchAll(/<FileRef>([\s\S]*?)<\/FileRef>/g)) {
        const full = ref[1].match(/<Path Value="([^"]+)"/)?.[1] || ref[1].match(/<RelativePath Value="([^"]+)"/)?.[1];
        if (!full) continue;
        // Name plus the size Ableton stored: recordings called "1-Audio 0001.wav" in two projects
        // are different sounds unless their sizes match too.
        const size = ref[1].match(/<OriginalFileSize Value="(\d+)"/)?.[1];
        const name = path.basename(decodeXmlText(full).replace(/\\/g, '/')).toLowerCase();
        samples.add(size ? `${name}|${size}` : name);
    }
    const ends = [...xml.matchAll(/<CurrentEnd Value="([\d.]+)"/g)].map((match) => Number(match[1]));
    const lengthBeats = ends.length ? Math.max(...ends) : null;
    return {
        reader: 'ableton',
        tempo,
        tracks,
        samples: [...samples],
        lengthBeats,
        lengthSec: tempo && lengthBeats ? (lengthBeats * 60) / tempo : null
    };
}

module.exports = { readAbleton };
