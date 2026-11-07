'use strict';

// Length of a WAV or AIFF file from its header (the first 64 KB), without decoding audio.
// Other formats return null. Only called for files that are not cloud placeholders.

const fs = require('node:fs');

const HEADER_BYTES = 64 * 1024;

function readHeader(filePath) {
    const fd = fs.openSync(filePath, 'r');
    try {
        const buffer = Buffer.alloc(HEADER_BYTES);
        const bytes = fs.readSync(fd, buffer, 0, HEADER_BYTES, 0);
        return buffer.subarray(0, bytes);
    } finally {
        fs.closeSync(fd);
    }
}

function wavDuration(buffer, fileSize) {
    let offset = 12;
    let byteRate = null;
    while (offset + 8 <= buffer.length) {
        const id = buffer.toString('ascii', offset, offset + 4);
        const size = buffer.readUInt32LE(offset + 4);
        if (id === 'fmt ') byteRate = buffer.readUInt32LE(offset + 16);
        if (id === 'data' && byteRate) {
            const dataBytes = Math.min(size, fileSize - offset - 8);
            return Math.round((dataBytes / byteRate) * 1000);
        }
        offset += 8 + size + (size % 2);
    }
    return null;
}

// AIFF sample rate is an 80-bit extended float.
function readExtended(buffer, offset) {
    const exponent = buffer.readUInt16BE(offset) & 0x7fff;
    const mantissa = buffer.readUInt32BE(offset + 2) * 2 ** 32 + buffer.readUInt32BE(offset + 6);
    return mantissa * 2 ** (exponent - 16383 - 63);
}

function aiffDuration(buffer) {
    let offset = 12;
    while (offset + 8 <= buffer.length) {
        const id = buffer.toString('ascii', offset, offset + 4);
        const size = buffer.readUInt32BE(offset + 4);
        if (id === 'COMM') {
            const frames = buffer.readUInt32BE(offset + 10);
            const rate = readExtended(buffer, offset + 16);
            return rate ? Math.round((frames / rate) * 1000) : null;
        }
        offset += 8 + size + (size % 2);
    }
    return null;
}

function readAudioDuration(filePath) {
    try {
        const buffer = readHeader(filePath);
        if (buffer.length < 12) return null;
        const riff = buffer.toString('ascii', 0, 4);
        const form = buffer.toString('ascii', 8, 12);
        if (riff === 'RIFF' && form === 'WAVE') return wavDuration(buffer, fs.statSync(filePath).size);
        if (riff === 'FORM' && (form === 'AIFF' || form === 'AIFC')) return aiffDuration(buffer);
        return null;
    } catch {
        return null;
    }
}

module.exports = { readAudioDuration };
