'use strict';

// Synthetic catalog generator. Deterministic: the same call always writes the same tree, bytes and
// dates. Safe to commit (the generator, not its output). Usage:
//   node fixtures/synthetic/generate.js <target-folder> [--no-deep]
//
// What it writes:
// - Fake Ableton .als files: real gzipped XML with tempo, track names, sample references and
//   clip ends (arrangement length). Never 0 bytes (the app treats 0-byte projects as placeholders).
// - A Logic .logicx bundle laid out as a folder (Alternatives, Resources, Media, Bounces).
// - Small real WAV bounces and stems, renamed versions, copies across folders, stems mixed with
//   bounces, a deep folder beyond walkFolder's depth cap, a dotfile and a symlink (both skipped).
// - Cloud placeholder stand-ins: sparse files with a size but no allocated blocks.
// - truth.json next to the catalog: which files belong to which song (for metrics in M3).

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const BASE_TIME = Date.UTC(2024, 2, 1, 12, 0, 0);
const MINUTE = 60 * 1000;

function escapeXml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function abletonXml({ tempo, tracks, samples, lengthBeats }) {
    const trackXml = tracks
        .map((name, index) => {
            const sample = samples[index % samples.length];
            return [
                `\t\t\t<AudioTrack Id="${index + 1}">`,
                `\t\t\t\t<Name><EffectiveName Value="${escapeXml(name)}" /><UserName Value="${escapeXml(name)}" /></Name>`,
                '\t\t\t\t<DeviceChain><MainSequencer><Sample><ArrangerAutomation><Events>',
                `\t\t\t\t\t<AudioClip Id="${index}" Time="0"><CurrentStart Value="0" /><CurrentEnd Value="${lengthBeats}" />`,
                `\t\t\t\t\t\t<SampleRef><FileRef><RelativePathType Value="3" /><RelativePath Value="Samples/Imported/${escapeXml(path.basename(sample))}" /><Path Value="${escapeXml(sample)}" /></FileRef></SampleRef>`,
                '\t\t\t\t\t</AudioClip>',
                '\t\t\t\t</Events></ArrangerAutomation></Sample></MainSequencer></DeviceChain>',
                '\t\t\t</AudioTrack>'
            ].join('\n');
        })
        .join('\n');
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Ableton MajorVersion="5" MinorVersion="12.0_12049" SchemaChangeCount="3" Creator="Ableton Live 12.0.5" Revision="synthetic">',
        '\t<LiveSet>',
        '\t\t<Tracks>',
        trackXml,
        '\t\t</Tracks>',
        '\t\t<MasterTrack><DeviceChain><Mixer><Tempo><Manual Value="' + tempo + '" /></Tempo></Mixer></DeviceChain></MasterTrack>',
        '\t</LiveSet>',
        '</Ableton>',
        ''
    ].join('\n');
}

function alsBytes(spec) {
    return zlib.gzipSync(Buffer.from(abletonXml(spec), 'utf8'), { level: 9, mtime: 0 });
}

// 8-bit mono PCM at 1 kHz: tiny but a real, valid WAV of the requested length.
function wavBytes(seconds, pitch) {
    const sampleRate = 1000;
    const count = Math.max(1, Math.round(seconds * sampleRate));
    const buffer = Buffer.alloc(44 + count);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + count, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate, 28);
    buffer.writeUInt16LE(1, 32);
    buffer.writeUInt16LE(8, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(count, 40);
    for (let index = 0; index < count; index += 1) {
        buffer[44 + index] = 128 + Math.round(60 * Math.sin((2 * Math.PI * pitch * index) / sampleRate));
    }
    return buffer;
}

function generateCatalog(targetDir, { deep = true } = {}) {
    const root = path.resolve(targetDir);
    fs.mkdirSync(root, { recursive: true });
    const truth = {};
    const written = [];

    function write(relativePath, bytes, minutesAfterBase, song) {
        const fullPath = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, bytes);
        const time = new Date(BASE_TIME + minutesAfterBase * MINUTE);
        fs.utimesSync(fullPath, time, time);
        written.push(relativePath);
        if (song) (truth[song] = truth[song] || []).push(relativePath);
    }

    function project(folder, alsName, spec, minutes, song, { asWholeFolder = true } = {}) {
        write(path.join(folder, alsName), alsBytes(spec), minutes, asWholeFolder ? null : song);
        write(path.join(folder, 'Ableton Project Info', 'Project8_1.cfg'), Buffer.from('synthetic project info\n'), minutes, null);
        for (const sample of spec.samples.slice(0, 2)) {
            write(path.join(folder, 'Samples', 'Imported', path.basename(sample)), wavBytes(0.2, 220), minutes - 5, null);
        }
        if (asWholeFolder) (truth[song] = truth[song] || []).push(folder);
    }

    function sparse(relativePath, size, minutesAfterBase, song) {
        const fullPath = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        const fd = fs.openSync(fullPath, 'w');
        fs.ftruncateSync(fd, size);
        fs.closeSync(fd);
        const time = new Date(BASE_TIME + minutesAfterBase * MINUTE);
        fs.utimesSync(fullPath, time, time);
        written.push(relativePath);
        (truth[song] = truth[song] || []).push(relativePath);
    }

    const drumKit = ['/Users/producer/Samples/Kits/808 Kick.wav', '/Users/producer/Samples/Kits/Clap Tight.wav'];
    const skySamples = ['/Users/producer/Music/Sky/sky pad.wav', '/Users/producer/Music/Sky/sky vox chop.wav', ...drumKit];

    // Sky: projects, versions, a collaborator-prefixed final, stems, a duplicate copy, a renamed copy.
    project('Projects/Sky Project', 'Sky.als', { tempo: 122, tracks: ['Kick', 'Pad', 'Vox Chop', 'Bass'], samples: skySamples, lengthBeats: 384 }, 0, 'Sky');
    project('Projects/Sky v2 Project', 'SKY V2.als', { tempo: 122, tracks: ['Kick', 'Pad', 'Vox Chop', 'Bass', 'Lead'], samples: skySamples, lengthBeats: 400 }, 3000, 'Sky');
    write('Bounces/SKY.wav', wavBytes(3.0, 440), 20, 'Sky');
    write('Bounces/SKY v2.wav', wavBytes(3.1, 445), 3010, 'Sky');
    write('Bounces/SKY master.wav', wavBytes(3.1, 450), 4000, 'Sky');
    write('Bounces/MG X JC - SKY FINAL.wav', wavBytes(3.2, 455), 5000, 'Sky');
    write('Stems/Sky Stems/Sky Kick.wav', wavBytes(1.0, 60), 3020, 'Sky');
    write('Stems/Sky Stems/Sky Bass.wav', wavBytes(1.0, 80), 3020, 'Sky');
    write('Stems/Sky Stems/Sky Pad.wav', wavBytes(1.0, 300), 3020, 'Sky');
    write('Downloads/SKY master.wav', wavBytes(3.1, 450), 4000, 'Sky');
    write('Desktop/old stuff/sky_mixdown_2023.wav', wavBytes(3.0, 440), 20, 'Sky');

    // The three-Sky case: Red Sky and Kareal Sky are different songs from Sky.
    project('Projects/Red Sky 116BPM Project', 'Red Sky 116BPM.als', { tempo: 116, tracks: ['Drums', 'Keys'], samples: drumKit, lengthBeats: 256 }, 6000, 'Red Sky');
    write('Bounces/Red Sky 116BPM.wav', wavBytes(2.2, 330), 6015, 'Red Sky');
    project('Projects/Kareal Sky Project', 'Kareal Sky.als', { tempo: 98, tracks: ['Guitar', 'Vocal'], samples: ['/Users/producer/Music/Kareal/gtr take 3.wav'], lengthBeats: 320 }, 7000, 'Kareal Sky');
    write('Bounces/Kareal Sky.wav', wavBytes(2.6, 290), 7012, 'Kareal Sky');

    // Generic titles: two different songs that today's importer merges.
    project('Projects/Untitled 14 Project', 'Untitled 14.als', { tempo: 90, tracks: ['Rhodes'], samples: ['/Users/producer/Samples/rhodes loop.wav'], lengthBeats: 64 }, 8000, 'Untitled 14');
    project('Projects/Untitled 37 Project', 'Untitled 37.als', { tempo: 140, tracks: ['Reese'], samples: ['/Users/producer/Samples/reese.wav'], lengthBeats: 128 }, 9000, 'Untitled 37');

    // Collaborator/category prefix: stems must follow the bounce.
    write('Bounces/Beat Idea - Aug Song.wav', wavBytes(2.0, 500), 10000, 'Aug Song');
    write('Stems/Beat Idea - Aug Song Drums.wav', wavBytes(1.0, 70), 10005, 'Aug Song');
    write('Stems/Beat Idea - Aug Song Bass.wav', wavBytes(1.0, 90), 10005, 'Aug Song');

    // A Logic project as a bundle (read as a folder in M2).
    write('Projects/Night Drive.logicx/Alternatives/000/ProjectData', Buffer.from('synthetic logic project data\n'), 11000, null);
    write('Projects/Night Drive.logicx/Resources/ProjectInformation.plist', Buffer.from('<plist><dict/></plist>\n'), 11000, null);
    write('Projects/Night Drive.logicx/Media/Audio Files/Night Drive Bass#01.wav', wavBytes(0.5, 100), 10990, null);
    write('Projects/Night Drive.logicx/Bounces/Night Drive v3.wav', wavBytes(2.4, 610), 11030, null);
    (truth['Night Drive'] = truth['Night Drive'] || []).push('Projects/Night Drive.logicx');
    write('Bounces/Night Drive v1.wav', wavBytes(2.3, 600), 10500, 'Night Drive');
    write('Bounces/Night Drive v3 (final).wav', wavBytes(2.4, 610), 11030, 'Night Drive');
    write('Downloads/Night Drive v3 (final) copy.wav', wavBytes(2.4, 610), 11030, 'Night Drive');

    // Stems mixed with bounces in one folder.
    write('Mixed/Northbound_v2 (mix by lil wave).wav', wavBytes(2.8, 700), 12000, 'Northbound');
    write('Mixed/Northbound Drums.wav', wavBytes(1.0, 75), 11990, 'Northbound');
    write('Mixed/Northbound Bass.wav', wavBytes(1.0, 95), 11990, 'Northbound');
    write('Mixed/Northbound Lead.wav', wavBytes(1.0, 800), 11990, 'Northbound');

    // A loose project file next to its bounce, plus non-audio files.
    write('Desktop/old stuff/Paper Lanterns Jan 28.als', alsBytes({ tempo: 104, tracks: ['Piano', 'Strings'], samples: ['/Users/producer/Samples/felt piano.wav'], lengthBeats: 192 }), 13000, 'Paper Lanterns');
    write('Desktop/old stuff/Paper Lanterns Jan 28.wav', wavBytes(1.9, 260), 13020, 'Paper Lanterns');
    write('Desktop/old stuff/notes.txt', Buffer.from('mix notes: more low end\n'), 13030, null);
    write('Desktop/old stuff/cover.png', Buffer.from('not really a png'), 13030, null);

    // Cloud placeholder stand-ins: sizes without allocated blocks. Never opened by the lab.
    sparse('Cloud/Glass House_bip.wav', 3 * 1024 * 1024, 14000, 'Glass House');
    sparse('Cloud/Glass House.als', 256 * 1024, 13990, 'Glass House');

    // Skipped by the app's walker rules: a dotfile, and a symlink (never followed).
    write('Bounces/.DS_Store', Buffer.from('synthetic'), 0, null);
    try {
        fs.symlinkSync(path.join(root, 'Bounces', 'SKY.wav'), path.join(root, 'Bounces', 'SKY alias.wav'));
    } catch {
        /* symlinks unavailable: nothing to skip */
    }

    if (deep) {
        // Deeper than walkFolder's DEPTH_HARD_CAP (10): today's walker never sees it, the lab's crawler does.
        const deepFolder = path.join('Archive', '2019', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j');
        write(path.join(deepFolder, 'Deep Song.wav'), wavBytes(1.5, 520), 15000, 'Deep Song');
    }

    fs.writeFileSync(path.join(root, '..', `${path.basename(root)}.truth.json`), JSON.stringify({ songs: truth }, null, 2) + '\n');
    return { root, truth, written };
}

module.exports = { generateCatalog, alsBytes, wavBytes, abletonXml };

if (require.main === module) {
    const target = process.argv[2];
    if (!target) {
        console.error('Usage: node fixtures/synthetic/generate.js <target-folder> [--no-deep]');
        process.exit(1);
    }
    const result = generateCatalog(path.join(target, 'catalog-a'), { deep: !process.argv.includes('--no-deep') });
    console.log(`Wrote ${result.written.length} files to ${result.root}`);
    console.log(`Ground truth: ${Object.keys(result.truth).length} songs in ${result.root}.truth.json`);
}
