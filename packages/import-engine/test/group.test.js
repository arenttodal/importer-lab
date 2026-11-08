'use strict';

// Tests first for grouping, bands and kinds. Names are invented and follow the patterns in
// docs/FINDINGS.md. Files carry only what the engine needs: name, type and (sometimes) a folder.

const test = require('node:test');
const assert = require('node:assert/strict');
const { groupCatalog } = require('../src/group');

let nextId = 0;
function file(name, type = 'bounces', extra = {}) {
    nextId += 1;
    return { fileId: `f${nextId}`, name, type, ext: name.split('.').pop().toLowerCase(), sourceContainerId: extra.folder || null, modifiedAt: extra.modifiedAt || '2024-01-01T00:00:00.000Z', ...extra };
}

function songOf(result, fileName) {
    return result.songs.find((song) => song.files.some((member) => member.name === fileName));
}

function sameSong(result, ...names) {
    const songs = new Set(names.map((name) => songOf(result, name)?.proposalId));
    return songs.size === 1 && !songs.has(undefined);
}

test('must-pass 1: "Untitled N" projects stay separate (row 1)', () => {
    const result = groupCatalog([file('Untitled 14.als', 'projects'), file('Untitled 37.als', 'projects'), file('Untitled 14.wav')]);
    assert.ok(!sameSong(result, 'Untitled 14.als', 'Untitled 37.als'));
    assert.ok(!sameSong(result, 'Untitled 14.als', 'Untitled 14.wav'), 'a generic title never merges on the name alone');
});

test('generic titles may group when another clue (the same folder) agrees, but never as sure', () => {
    const result = groupCatalog([file('Untitled 14.als', 'projects', { folder: 'A' }), file('Untitled 14.wav', 'bounces', { folder: 'A' })]);
    assert.ok(sameSong(result, 'Untitled 14.als', 'Untitled 14.wav'));
    assert.notEqual(songOf(result, 'Untitled 14.als').band, 'sure');
});

test('must-pass 2: "MG X JC - SKY FINAL" joins Sky (row 2)', () => {
    const result = groupCatalog([file('SKY.wav'), file('SKY v2.wav'), file('SKY master.wav'), file('SKY V2.als', 'projects'), file('MG X JC - SKY FINAL.wav')]);
    assert.ok(sameSong(result, 'SKY.wav', 'SKY v2.wav', 'SKY V2.als', 'MG X JC - SKY FINAL.wav'));
});

test('must-pass 3: stems follow their bounce when a prefix is set aside (row 3)', () => {
    const result = groupCatalog([file('Beat Idea - Aug Song.wav'), file('Beat Idea - Aug Song Drums.wav', 'stems'), file('Beat Idea - Aug Song Bass.wav', 'stems')]);
    assert.ok(sameSong(result, 'Beat Idea - Aug Song.wav', 'Beat Idea - Aug Song Drums.wav', 'Beat Idea - Aug Song Bass.wav'));
    const song = songOf(result, 'Beat Idea - Aug Song.wav');
    assert.equal(song.stemSets.flatMap((set) => set.files).length, 2);
});

test('must-pass 4 and guardrails: three Skys and Sky Structure stay apart', () => {
    const result = groupCatalog([file('SKY.wav'), file('Red Sky 116bpm.wav'), file('Ide Kareal Sky.als', 'projects'), file('Sky Structure.wav')]);
    const ids = ['SKY.wav', 'Red Sky 116bpm.wav', 'Ide Kareal Sky.als', 'Sky Structure.wav'].map((name) => songOf(result, name).proposalId);
    assert.equal(new Set(ids).size, 4);
});

test('guardrails: each Morning 5 day is its own song; live sets of different years stay apart (row 26)', () => {
    const result = groupCatalog([
        file('Morning 5 - Friday April 21.wav'),
        file('Morning 5 - Friday April 28.wav'),
        file('Morning 5 - Friday June 16.wav'),
        file('AURORA LIVE SET - ASCENT 2023.wav'),
        file('AURORA LIVE SET - ASCENT 2024.wav')
    ]);
    assert.equal(new Set(result.songs.map((song) => song.proposalId)).size, 5);
});

test('guardrail: similar names alone never merge; they are proposed for review (row 18)', () => {
    const result = groupCatalog([file('MARLOW - Pinwheel MIX V1.1.wav'), file('MARLOW - Pinwheels Instr.wav'), file('Hollow Dune.wav'), file('Hollow Dunes.wav')]);
    assert.ok(!sameSong(result, 'MARLOW - Pinwheel MIX V1.1.wav', 'MARLOW - Pinwheels Instr.wav'));
    const pinwheel = songOf(result, 'MARLOW - Pinwheel MIX V1.1.wav');
    assert.ok(pinwheel.possibleMatches.some((match) => match.proposalId === songOf(result, 'MARLOW - Pinwheels Instr.wav').proposalId));
});

test('row 21: orchestral stems attach to their song as a stem set and never become songs', () => {
    const names = ['Whooshes', 'Transitions', 'Textures', 'String Shorts', 'String Long', 'LOWS', 'Choirs', 'PIANO'];
    const result = groupCatalog([
        file('Sync - Glasshouse - Orch Adds 1.4.wav'),
        ...names.map((part) => file(`Sync - Glasshouse - Final -  ${part}.wav`, part === 'PIANO' ? 'stems' : 'bounces'))
    ]);
    const songs = result.songs.filter((song) => song.kind === 'song');
    assert.equal(songs.length, 1);
    assert.equal(songs[0].stemSets.flatMap((set) => set.files).length, names.length);
});

test('row 21: stems with no bounce form a stem set, not songs', () => {
    const result = groupCatalog([file('Nightjar - WIP 1 - - Brass.wav', 'stems'), file('Nightjar - WIP 1 - - Choirs.wav')]);
    assert.equal(result.songs.filter((song) => song.kind === 'song').length, 0);
    assert.equal(result.songs.filter((song) => song.kind === 'stem-set').length, 1);
});

test('siblings: parts named after instruments become stems when most siblings are stems', () => {
    const parts = ['Bass Flute', 'Bass Flute Wet', 'Viola', 'Viola Wet', 'Ocarina', 'Croatian', 'Croatian Wet', 'Overtone'];
    const result = groupCatalog([file('JC - Comet Run - Instrument Recordings 1 Project', 'projects'), ...parts.map((part) => file(`JC - Comet Run - Instrument Recordings -  ${part}.wav`))]);
    assert.equal(result.songs.filter((song) => song.kind === 'song').length, 1);
});

test('rows 22 and 23: stage, render and take words are versions within one song', () => {
    const names = [
        'Corvid - The Lantern .1.1.wav',
        'Corvid - The Lantern v2.wav',
        'Corvid - The Lantern - Export 1.1.mp3',
        'Corvid - The Lantern - Final Master.wav',
        'Corvid - The Lantern - Final Touches - Done.wav',
        'Corvid - The Lantern - Master V1 - Rich Long.wav',
        'Corvid - The Lantern - Remastered - FINAL.wav'
    ];
    const result = groupCatalog(names.map((name) => file(name)));
    assert.ok(sameSong(result, ...names));
    const song = songOf(result, names[0]);
    assert.ok(song.versions.length >= 5);
    assert.equal(song.band, 'unsure', 'a merge made by the name policy is proposed for review under exact-identity-only');
});

test('row 13: edits group as versions, and the setting switches it off', () => {
    const names = ['ATLAS Intro Short 1.1.wav', 'ATLAS Intro Long 1.3.wav', 'ATLAS - Intro v2.wav', 'ATLAS Intro Track 1.wav'];
    const files = () => [...names.map((name) => file(name)), file('ATLAS - Backing Chords v1.wav'), file('ATLAS - Theme.wav')];
    assert.ok(sameSong(groupCatalog(files()), ...names));
    assert.ok(!sameSong(groupCatalog(files(), { groupEdits: false }), names[0], names[1]));
});

test('row 17: contributor names are learned from explicit patterns in two or more files', () => {
    const result = groupCatalog([
        file('HARBOR - CELLO ADDS Project', 'projects'),
        file('HARBOR - THEO CELLO ADDS 1 Project', 'projects'),
        file('QUILL - Take It Over - Theo Adds Project', 'projects'),
        file('QUILL - Take It Over.wav'),
        file('QUILL - Moonrise - Theo Adds 2.wav'),
        file('HARBOR - Lantern Song.wav'),
        file('QUILL - Other Song.wav')
    ]);
    assert.ok(sameSong(result, 'HARBOR - CELLO ADDS Project', 'HARBOR - THEO CELLO ADDS 1 Project'));
    assert.ok(result.context.contributors.includes('theo'));
    assert.ok(!result.context.contributors.includes('cello'));
});

test('guardrail: a word is never learned as a contributor just because removing it matches another title', () => {
    const result = groupCatalog([file('Sky.wav'), file('Sky Structure.wav'), file('Sky Structure 2.wav'), file('Glass Structure.wav')]);
    assert.ok(!result.context.contributors.includes('structure'));
    assert.ok(!sameSong(result, 'Sky.wav', 'Sky Structure.wav'));
});

test('row 19: templates, course material and sample-pack content are their own kinds', () => {
    const drones = Array.from({ length: 6 }, (_, index) => file(`Ev - Nyckelharpa - Drones - ${index + 1} - E.wav`));
    const result = groupCatalog(
        [
            file('TEMPLATE - 2024 ORCHESTRA REVAMPED Project', 'projects'),
            file('Orchestral Template - 1 Project', 'projects'),
            file('Tutorial - Recording Textures Project', 'projects'),
            file('Engine 1 - Depth Project', 'projects'),
            file('STORM - DRUMKIT.wav'),
            file('Synthy Presets.wav'),
            ...drones,
            file('Real Song.wav')
        ],
        { courseNamespaces: ['engine 1'] }
    );
    const kindOf = (name) => songOf(result, name).kind;
    assert.equal(kindOf('TEMPLATE - 2024 ORCHESTRA REVAMPED Project'), 'template');
    assert.equal(kindOf('Orchestral Template - 1 Project'), 'template');
    assert.equal(kindOf('Tutorial - Recording Textures Project'), 'course');
    assert.equal(kindOf('Engine 1 - Depth Project'), 'course');
    assert.equal(kindOf('STORM - DRUMKIT.wav'), 'sample-pack');
    assert.equal(kindOf('Synthy Presets.wav'), 'sample-pack');
    assert.equal(kindOf('Ev - Nyckelharpa - Drones - 1 - E.wav'), 'sample-pack');
    assert.equal(kindOf('Real Song.wav'), 'song');
});

test('bands: an exact app identity across files is sure; a lone clean name is sure; an empty name is unclear', () => {
    const result = groupCatalog([file('Paper Boats.wav'), file('Paper Boats.als', 'projects'), file('Lonely One.wav'), file('Morning 5 - Bass Only.wav')]);
    assert.equal(songOf(result, 'Paper Boats.wav').band, 'sure');
    assert.equal(songOf(result, 'Lonely One.wav').band, 'sure');
    assert.equal(songOf(result, 'Morning 5 - Bass Only.wav').band, 'unclear');
});

test('multi-clue rule: a strong second clue makes a name-policy merge sure; exact-identity-only keeps it unsure', () => {
    const files = () => [file('Corvid - The Lantern - Final Master.wav', 'bounces', { folder: 'X' }), file('Corvid - The Lantern - Export 1.1.wav', 'bounces', { folder: 'X' })];
    assert.equal(groupCatalog(files()).songs[0].band, 'unsure');
    assert.equal(groupCatalog(files(), { mergeRule: 'multi-clue' }).songs[0].band, 'sure');
});

test('every song lists plain reasons; proposal ids are stable across runs', () => {
    const files = [file('Corvid - The Lantern - Final Master.wav'), file('Corvid - The Lantern v2.wav')];
    const first = groupCatalog(files);
    const second = groupCatalog(files.map((member) => ({ ...member })));
    assert.deepEqual(first.songs.map((song) => song.proposalId), second.songs.map((song) => song.proposalId));
    assert.ok(first.songs[0].reasons.length > 0);
    assert.ok(first.songs[0].reasons.every((reason) => typeof reason.text === 'string' && reason.text.length > 10));
});

test('guardrail: the same day in two series stays two songs', () => {
    const result = groupCatalog([file('Jam - Friday May 19.wav'), file('Morning 5 - Friday May 19.wav'), file('Morning 5 - Friday May 19 Pitched.wav')]);
    assert.ok(!sameSong(result, 'Jam - Friday May 19.wav', 'Morning 5 - Friday May 19.wav'));
    assert.ok(sameSong(result, 'Morning 5 - Friday May 19.wav', 'Morning 5 - Friday May 19 Pitched.wav'));
});

test('guardrail: a descriptive segment that starts with an instrument is title, not a version label', () => {
    const result = groupCatalog([file('Tuesday - Filmed - Guitar Jam W Pedals.wav'), file('Tuesday - Filmed - Piano Jazz Improv 130.wav'), file('Tuesday - Other.wav'), file('Tuesday - Third.wav')]);
    assert.ok(!sameSong(result, 'Tuesday - Filmed - Guitar Jam W Pedals.wav', 'Tuesday - Filmed - Piano Jazz Improv 130.wav'));
});

test('guardrail: a two-letter title never gathers different pieces', () => {
    const result = groupCatalog([file('JAM - LA - Blooper Looping Video Practice.wav'), file('JAM - LA - Piano Jam.wav')]);
    assert.ok(!sameSong(result, 'JAM - LA - Blooper Looping Video Practice.wav', 'JAM - LA - Piano Jam.wav'));
});

test('"Alt Rock" is a title, not an alternate version', () => {
    const result = groupCatalog([file('Song Ideas - Alt Rock Bey.wav'), file('Song Ideas - Alt Rock Bey 122.wav'), file('Song Ideas - Indie Pop.wav')]);
    assert.equal(songOf(result, 'Song Ideas - Alt Rock Bey.wav').canonicalIdentity, 'alt rock bey');
    assert.equal(songOf(result, 'Song Ideas - Alt Rock Bey.wav').songName, 'Song Ideas - Alt Rock Bey');
    assert.ok(!sameSong(result, 'Song Ideas - Alt Rock Bey.wav', 'Song Ideas - Indie Pop.wav'));
});

test('row 21: an export batch makes stems of parts whose names give no clue', () => {
    const files = [file('Glasshouse - Final.wav'), file('Glasshouse - Final - Ocarina.wav'), file('Glasshouse - Final - Croatian.wav'), file('Glasshouse - Final - Moog.wav')];
    const result = groupCatalog(files, { links: [{ clue: 'exportBatch', fileIds: files.map((member) => member.fileId), weight: 0.9, text: 'Exported together.' }] });
    const songs = result.songs.filter((song) => song.kind === 'song');
    assert.equal(songs.length, 1);
    assert.equal(songs[0].stemSets.flatMap((set) => set.files).length, 3);
    assert.ok(songs[0].reasons.some((reason) => /exported together/i.test(reason.text)));
});

test('existing songs: an exact canonical match links to the Library song; a similar name does not', () => {
    const existing = [{ id: '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f', songName: 'Paper Boats', displayName: 'Paper Boats' }];
    const result = groupCatalog([file('Paper Boats v2.wav'), file('Paper Boat.wav')], { existingSongs: existing });
    assert.equal(songOf(result, 'Paper Boats v2.wav').existingSongId, existing[0].id);
    assert.equal(songOf(result, 'Paper Boat.wav').existingSongId, undefined);
});

test('guardrail: a bare number joins a song only when the plain title is also there', () => {
    const apart = groupCatalog([file('Sky Night 21.wav', 'bounces', { folder: 'A' }), file('Sky Night 21 v2.wav', 'bounces', { folder: 'A' }), file('Sky Night 21 Bass.wav', 'stems', { folder: 'A' }), file('Sky Night 41.wav', 'bounces', { folder: 'B' })]);
    assert.ok(!sameSong(apart, 'Sky Night 21.wav', 'Sky Night 41.wav'), 'different numbers with no plain title stay apart');
    assert.ok(sameSong(apart, 'Sky Night 21.wav', 'Sky Night 21 v2.wav', 'Sky Night 21 Bass.wav'));
    assert.equal(songOf(apart, 'Sky Night 21.wav').songName, 'Sky Night 21');
    const joined = groupCatalog([file('Harbor Lights.wav'), file('Harbor Lights 2.wav'), file('Harbor Lights 122.wav')]);
    assert.ok(sameSong(joined, 'Harbor Lights.wav', 'Harbor Lights 2.wav', 'Harbor Lights 122.wav'), 'a take or tempo number joins the plain title');
});

test('guardrail: numbers that are neither a take nor a tempo stay part of the title', () => {
    const result = groupCatalog([file('Harbor Lights.wav'), file('Harbor Lights 537.wav')]);
    assert.ok(!sameSong(result, 'Harbor Lights.wav', 'Harbor Lights 537.wav'));
});

test('weak titles join the same name in the same folder only, with their stems', () => {
    const result = groupCatalog([
        file('Idea Night 376.wav', 'bounces', { folder: 'A' }),
        file('Idea Night 376 master.wav', 'bounces', { folder: 'A' }),
        file('Idea Night 376 Drums.wav', 'stems', { folder: 'A' }),
        file('Idea Night 376.wav', 'bounces', { folder: 'B' })
    ]);
    const inA = result.songs.find((song) => song.files.some((member) => member.sourceContainerId === 'A'));
    assert.equal(inA.files.length, 3);
    assert.notEqual(inA.band, 'sure');
    assert.equal(result.songs.filter((song) => song.kind === 'stem-set').length, 0);
});

test('numbered takes in one folder stay one song; without folder information nothing is split', () => {
    const takes = groupCatalog([file('Glass Sketch 1.wav', 'bounces', { folder: 'A' }), file('Glass Sketch 2.wav', 'bounces', { folder: 'A' }), file('Glass Sketch 2 Bass.wav', 'stems', { folder: 'A' })]);
    assert.ok(sameSong(takes, 'Glass Sketch 1.wav', 'Glass Sketch 2.wav', 'Glass Sketch 2 Bass.wav'));
    const unknown = groupCatalog([file('Glass Sketch 1.wav'), file('Glass Sketch 2.wav')]);
    assert.ok(sameSong(unknown, 'Glass Sketch 1.wav', 'Glass Sketch 2.wav'));
});

test('numbered files join when one file\'s numbers contain the other\'s', () => {
    const result = groupCatalog([
        file('Nimbus - Copper Loop 80 Project', 'projects', { folder: 'P' }),
        file('Nimbus - Copper Loop 80 1.wav', 'bounces', { folder: 'B' }),
        file('Nimbus - Copper Loop 80 1.wav', 'bounces', { folder: 'C' }),
        file('Nimbus - Copper Loop 72.wav', 'bounces', { folder: 'D' })
    ]);
    assert.ok(sameSong(result, 'Nimbus - Copper Loop 80 Project', 'Nimbus - Copper Loop 80 1.wav'));
    const project = songOf(result, 'Nimbus - Copper Loop 80 Project');
    assert.ok(!project.files.some((member) => member.name === 'Nimbus - Copper Loop 72.wav'), 'a different number in another folder stays apart');
});

test('suggestions: different dates in a series are never suggested; each song keeps its 3 strongest', () => {
    const dated = groupCatalog([file('Tuesday Oct 10.wav'), file('Tuesday 17 Oct.wav'), file('Tuesday Oct 24.wav')]);
    assert.equal(dated.songs.reduce((sum, song) => sum + song.possibleMatches.length, 0), 0);
    const many = groupCatalog(['Copper Field', 'Copper Fields', 'Copper Field Dawn', 'Copper Field Dusk', 'Copper Field Rain', 'Copper Field Snow'].map((name) => file(`${name}.wav`)));
    const base = songOf(many, 'Copper Field.wav');
    assert.equal(base.possibleMatches.length, 3);
    assert.equal(base.possibleMatches[0].songName, 'Copper Fields', 'the plural (strongest) comes first');
    assert.ok(base.possibleMatches.every((match, index, list) => index === 0 || list[index - 1].weight >= match.weight));
});

test('display names: the producer\'s own fullest title with only the noise removed; never shared', () => {
    const result = groupCatalog([
        file('Morning 5 - Monday Nov 27.wav'),
        file('Morning 5 - Monday Nov 27 Pitched.wav'),
        file('NIMBUS - Glasshouse - Final Master 1.1.wav'),
        file('Glasshouse v2 320kbps.mp3'),
        file('NIMBUS - Other Cue.wav'),
        file('NIMBUS - Third Cue.wav'),
        file('KESTREL RUN Project PD', 'projects'),
        file('KESTREL RUN v1.wav'),
        file('QUILL - Running Demo 2.2.wav'),
        file('QUILL - Other Song.wav'),
        file('MARLOW - Running Demo 2.1.wav'),
        file('MARLOW - Third Song.wav'),
        file('Untitled 14.wav', 'bounces', { folder: 'A', sourceRelativePath: 'Album/Untitled 14.wav' }),
        file('Untitled 14.wav', 'bounces', { folder: 'B', sourceRelativePath: 'Live Takes/Untitled 14.wav' })
    ]);
    assert.equal(songOf(result, 'Morning 5 - Monday Nov 27 Pitched.wav').songName, 'Morning 5 - Monday Nov 27', 'series and date stay; render word goes');
    assert.equal(songOf(result, 'Glasshouse v2 320kbps.mp3').songName, 'Nimbus - Glasshouse', 'a one-word title takes the fuller title');
    assert.equal(songOf(result, 'KESTREL RUN v1.wav').songName, 'Kestrel Run', 'version words and the backup marker go');
    const names = result.songs.map((song) => song.songName.toLowerCase());
    assert.equal(new Set(names).size, names.length, 'two songs never share a display name');
    assert.ok(names.includes('quill - running') && names.includes('marlow - running'), 'two clients\' songs keep their client');
    assert.ok(names.includes('untitled 14 (album)') && names.includes('untitled 14 (live takes)'), 'the folder tells namesakes apart');
    assert.equal(songOf(result, 'Morning 5 - Monday Nov 27.wav').canonicalIdentity !== songOf(result, 'Morning 5 - Monday Nov 27.wav').songName, true);
});

test('display names: a one-word clean falls back to the fuller title', () => {
    const result = groupCatalog([file('Guitar Loop - 135 Somber Loop.wav')]);
    assert.equal(result.songs[0].songName, 'Guitar Loop - Somber Loop');
});

test('sample packs: one-shots in a pack-like folder are a sample pack, never a song or a mix', () => {
    const folder = { folder: 'PACK' };
    const result = groupCatalog([
        file('STORM -  CLAPS.wav', 'bounces', folder),
        file('STORM -  Big Snare.wav', 'bounces', folder),
        file('STORM -  HIP HOP KIT.wav', 'bounces', folder),
        file('STORM -  BASSES.wav', 'bounces', folder),
        file('STORM -  SFX 2.wav', 'bounces', folder),
        file('STORM -  KICK.wav', 'bounces', folder),
        file('STORM -  Kick 2.wav', 'bounces', folder),
        file('Kick Drum Anthem.wav', 'bounces', { folder: 'SONGS' })
    ], { links: [{ clue: 'exportBatch', fileIds: ['f-none'] }] });
    for (const name of ['STORM -  CLAPS.wav', 'STORM -  BASSES.wav', 'STORM -  KICK.wav', 'STORM -  SFX 2.wav']) assert.equal(songOf(result, name).kind, 'sample-pack', name);
    assert.equal(songOf(result, 'Kick Drum Anthem.wav').kind, 'song', 'a song title with a one-shot word outside a pack folder stays a song');
});

test('sample packs: an export batch never takes a one-shot as its mix', () => {
    const folder = { folder: 'PACK' };
    const files = ['CLAPS', 'Big Snare', 'HIP HOP KIT', 'BASSES', 'SFX 2'].map((part) => file(`STORM -  ${part}.wav`, 'bounces', folder));
    const result = groupCatalog(files, { links: [{ clue: 'exportBatch', fileIds: files.map((member) => member.fileId) }] });
    assert.ok(result.songs.every((song) => song.kind !== 'song'), result.songs.map((song) => `${song.songName}:${song.kind}`).join(', '));
});

test('lone stems: a part-word file is a stem only when the rest of its song exists; otherwise it is an idea of its own', () => {
    const result = groupCatalog([
        file('Copper Field.wav', 'bounces', { folder: 'A' }),
        file('Copper Field Choir Take Vox.wav', 'stems', { folder: 'A' }),
        file('Sky.wav', 'bounces', { folder: 'B' }),
        file('Sky Structure Piano.wav', 'stems', { folder: 'C' }),
        file('Jam - Saturday Night - Lantern Heaven.wav', 'bounces', { folder: 'D' }),
        file('Saturday night lantern heaven vox.m4a', 'stems', { folder: 'E' }),
        file('Kelp piano 121 vox.m4a', 'stems', { folder: 'F' }),
        file('Harbor - Dec 3 2 - Splits - Mic 1 Vox.wav', 'stems', { folder: 'G' }),
        file('Harbor - Dec 3 2 - Splits - Live Piano.wav', 'stems', { folder: 'G' })
    ]);
    assert.ok(sameSong(result, 'Copper Field.wav', 'Copper Field Choir Take Vox.wav'), 'joins a song in its folder');
    assert.ok(!sameSong(result, 'Sky.wav', 'Sky Structure Piano.wav'), 'never joins a shorter, different title');
    assert.ok(sameSong(result, 'Jam - Saturday Night - Lantern Heaven.wav', 'Saturday night lantern heaven vox.m4a'), 'joins the one song with its title in another series');
    const idea = songOf(result, 'Kelp piano 121 vox.m4a');
    assert.equal(idea.kind, 'song', 'nothing else from this song exists: an idea of its own');
    assert.match(idea.songName, /Vox/);
    assert.ok(sameSong(result, 'Harbor - Dec 3 2 - Splits - Mic 1 Vox.wav', 'Harbor - Dec 3 2 - Splits - Live Piano.wav'), '"Splits" means stems: one recording');
    assert.equal(result.looseStems.length, 0);
});

test('suggestions: titles that differ only by number are never suggested; one-shot stems in a pack stay in the pack', () => {
    const numbered = groupCatalog([file('Lantern 164.wav', 'bounces', { folder: 'A' }), file('Lantern 156.wav', 'bounces', { folder: 'B' }), file('Lantern 167.wav', 'bounces', { folder: 'C' })]);
    assert.equal(numbered.songs.reduce((sum, song) => sum + song.possibleMatches.length, 0), 0);
    const folder = { folder: 'PACK' };
    const pack = groupCatalog(['CLAPS', 'HIP HOP KIT', 'BASSES', 'SFX 2', 'KICK'].map((part) => file(`STORM -  ${part}.wav`, 'bounces', folder)).concat([file('STORM -  Big Snare.wav', 'stems', folder)]));
    assert.equal(pack.looseStems.length, 0);
    assert.equal(songOf(pack, 'STORM -  Big Snare.wav').kind, 'sample-pack');
});

test('suggestions: a word-by-word misspelling is suggested across prefixes, never joined', () => {
    const result = groupCatalog([
        file("QUILL - Sailin' slow, driftin' home VOCALS.wav", 'stems'),
        file('QUILL - Other Song.wav'),
        file('QUILL - Third Song.wav'),
        file('marlow - Sailing Sloww Drifting Home.wav'),
        file('marlow - Fourth Song.wav'),
        file('marlow - Fifth Song.wav')
    ]);
    const vocal = songOf(result, "QUILL - Sailin' slow, driftin' home VOCALS.wav");
    const other = songOf(result, 'marlow - Sailing Sloww Drifting Home.wav');
    assert.notEqual(vocal.proposalId, other.proposalId, 'never joined');
    assert.ok(vocal.possibleMatches.some((match) => match.proposalId === other.proposalId), 'suggested for review');
});

test('sample packs: one pack, one entry with its contents; neighbours go to review; a jam outranks patches', () => {
    const pack = { folder: 'PACK' };
    const result = groupCatalog([
        ...['CLAPS', 'BASSES', 'HIP HOP KIT', 'KICK', 'Kick 2', 'SFX 2'].map((part) => file(`STORM -  ${part}.wav`, 'bounces', pack)),
        file('STORM -  ORCHESTRA.wav', 'bounces', pack),
        file('Lx - Nyckelharpa - Drones - 1 - E.wav', 'bounces', { folder: 'D1' }),
        file('Lx - Nyckelharpa - Drones - 2 - B.wav', 'bounces', { folder: 'D1' }),
        file('Lx - Nyckelharpa - Drones - 3 - E.wav', 'bounces', { folder: 'D1' }),
        file('Lx - Nyckelharpa - Drones - 4 - A.wav', 'bounces', { folder: 'D1' }),
        file('Lx - Nyckelharpa - Drones - 5 - E.wav', 'bounces', { folder: 'D1' }),
        file('Lx - Nyckelharp Textures - Assembled - 1.wav', 'bounces', { folder: 'D2' }),
        file('Lx - Nyckelharp Textures - Assembled - 2.wav', 'bounces', { folder: 'D2' }),
        file('Lx - Nyckelharp Textures - Assembled - 3.wav', 'bounces', { folder: 'D2' }),
        file('Lx - Nyckelharp Textures - Assembled - 4.wav', 'bounces', { folder: 'D2' }),
        file('Lx - Nyckelharp Textures - Assembled - 5.wav', 'bounces', { folder: 'D2' }),
        file('Synth Jam - Testing Out Pulsar Patches.wav')
    ]);
    const storm = songOf(result, 'STORM -  CLAPS.wav');
    assert.equal(storm.kind, 'sample-pack');
    assert.equal(storm.songName, 'Storm');
    assert.ok(sameSong(result, 'STORM -  CLAPS.wav', 'STORM -  BASSES.wav', 'STORM -  KICK.wav', 'STORM -  SFX 2.wav'), 'one entry');
    assert.ok(storm.reasons.some((reason) => /Basses/.test(reason.text) && /Claps/.test(reason.text)), 'contents listed');
    const orchestra = songOf(result, 'STORM -  ORCHESTRA.wav');
    assert.ok(orchestra.review && orchestra.band === 'unclear', 'a neighbour of the pack goes to review, not into the pack');
    assert.ok(sameSong(result, 'Lx - Nyckelharpa - Drones - 1 - E.wav', 'Lx - Nyckelharp Textures - Assembled - 1.wav'), 'a pack word spelled almost the same joins across folders');
    assert.equal(songOf(result, 'Synth Jam - Testing Out Pulsar Patches.wav').kind, 'song');
});

test('course material keeps its kind: a course demo never joins the song; the pair is suggested and reviewed', () => {
    const result = groupCatalog(
        [
            file('ZQT - Nimbus Demo wip1.1.wav'),
            file('ZQT - Nimbus FX Project', 'projects'),
            file('ZQT - Harp Demo.wav'),
            file('Nimbus - WIP 1 - - MASTER.wav'),
            file('Nimbus - WIP 1 - UNMASTER - - MASTER.wav'),
            file('Nimbus - WIP 1 - - Strings.wav', 'stems')
        ],
        { courseNamespaces: ['zqt'] }
    );
    const demo = songOf(result, 'ZQT - Nimbus Demo wip1.1.wav');
    const song = songOf(result, 'Nimbus - WIP 1 - - MASTER.wav');
    assert.notEqual(demo.proposalId, song.proposalId);
    assert.equal(demo.kind, 'course');
    assert.equal(songOf(result, 'ZQT - Nimbus FX Project').kind, 'course', 'same prefix, same kind');
    assert.equal(song.kind, 'song');
    assert.ok(!/zqt/i.test(song.songName), 'the song is not named after the course');
    assert.ok(demo.review);
    assert.ok(song.possibleMatches.some((match) => match.proposalId === demo.proposalId));
});

test('takes join across folders; tempos do not; "Ideas" counts as "Idea", other plurals are only suggested', () => {
    const result = groupCatalog([
        file('Cracked Glass Stretch Sample 1.wav', 'bounces', { folder: 'A' }),
        file('Cracked Glass Stretch Sample 3.wav', 'bounces', { folder: 'B' }),
        file('Drive Glass 53.wav', 'bounces', { folder: 'C' }),
        file('Drive Glass 73.wav', 'bounces', { folder: 'D' }),
        file('Sky Night 1.wav', 'bounces', { folder: 'E' }),
        file('Sky Night 21.wav', 'bounces', { folder: 'F' }),
        file('MARLOW - Coraline Piano Ideas.wav'),
        file('MARLOW - Coraline Piano Idea 1.4 W Image.wav'),
        file('MARLOW - Pinwheel.wav'),
        file('MARLOW - Pinwheels.wav')
    ]);
    assert.ok(sameSong(result, 'Cracked Glass Stretch Sample 1.wav', 'Cracked Glass Stretch Sample 3.wav'));
    assert.equal(songOf(result, 'Cracked Glass Stretch Sample 1.wav').band, 'unsure', 'a take join across folders is checked, never sure');
    assert.ok(!sameSong(result, 'Sky Night 1.wav', 'Sky Night 21.wav'), 'only single-digit takes join across folders');
    assert.ok(!sameSong(result, 'Drive Glass 53.wav', 'Drive Glass 73.wav'), 'tempos in different folders stay apart (row 27)');
    assert.ok(sameSong(result, 'MARLOW - Coraline Piano Ideas.wav', 'MARLOW - Coraline Piano Idea 1.4 W Image.wav'));
    assert.ok(!sameSong(result, 'MARLOW - Pinwheel.wav', 'MARLOW - Pinwheels.wav'), 'row 18: other plurals are only suggested');
});
