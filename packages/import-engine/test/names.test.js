'use strict';

// Tests first for the name policy (lab-names-5). Names are invented; each case follows a pattern
// from docs/FINDINGS.md. `title` is the song identity the policy proposes; `label` collects the
// words it set aside as a version label; `stemPart` is the part named in a stem file.

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyseName, createNameContext } = require('../src/names');

const ctx = createNameContext({ namespaces: ['corvid', 'nightjar', 'sync', 'harbor', 'quill', 'atlas', 'jc', 'prophet loop'], contributors: ['theo'] });

function analyse(name, type = 'bounces', options = {}) {
    return analyseName({ name, type }, ctx, options);
}

test('row 1: a generic title keeps its number and is flagged generic', () => {
    assert.deepEqual([analyse('Untitled 14.als', 'projects').title, analyse('Untitled 14.als', 'projects').generic], ['untitled 14', true]);
    assert.equal(analyse('Untitled 37.als', 'projects').title, 'untitled 37');
    assert.equal(analyse('New Project 2.als', 'projects').generic, true);
});

test('row 2: "final" is a stage word, the collaborator prefix is a namespace', () => {
    const final = analyse('MG X JC - SKY FINAL.wav');
    assert.equal(final.title, 'sky');
    assert.equal(final.namespace, 'mg x jc');
    assert.match(final.label, /final/i);
});

test('row 3: stems keep the bounce title, with the category prefix set aside for every type', () => {
    assert.equal(analyse('Beat Idea - Aug Song.wav').title, 'aug song');
    const stem = analyse('Beat Idea - Aug Song Drums.wav', 'stems');
    assert.deepEqual([stem.title, stem.stemPart], ['aug song', 'drums']);
});

test('rows 5, 6 and 25: technical specs, "radio edit" and format words are noise', () => {
    assert.equal(analyse('Dune 320kbps.mp3').title, 'dune');
    assert.equal(analyse('Dune 24bit 48kHz.wav').title, 'dune');
    assert.equal(analyse('Dune Radio Edit.mp3').title, 'dune');
    assert.equal(analyse('KESTREL RUN.wav 101 BPM 2.wav').title, 'kestrel run');
});

test('row 14: "Project PD" (Producer Dashboard backup marker) is noise', () => {
    assert.equal(analyse('KESTREL RUN Project PD', 'projects').title, 'kestrel run');
    assert.equal(analyse('Beat Idea - Velvet Moss Project PD', 'projects').title, 'velvet moss');
    assert.equal(analyse('Beat Idea - Velvet Moss 1 Suno.wav').title, 'velvet moss');
});

test('row 15: category prefixes are set aside consistently', () => {
    assert.equal(analyse('Blooper Idea - Paper Moths.wav').title, 'paper moths');
    assert.equal(analyse('Blooper Idea - Paper Moths2.wav').title, 'paper moths');
    assert.equal(analyse('Idea - Paper Moths Project', 'projects').title, 'paper moths');
});

test('row 16: repeated words collapse, including a namespace repeated in the title', () => {
    assert.equal(analyse('Lumen - Lumen Engine Demos 2 Project', 'projects').title, 'lumen engine demos');
    assert.equal(analyse('Lumen Lumen Engine Demos.wav').title, 'lumen engine demos');
});

test('row 17: learned contributor names are set aside', () => {
    assert.equal(analyse('HARBOR - THEO CELLO ADDS 1 Project', 'projects').title, analyse('HARBOR - CELLO ADDS Project', 'projects').title);
    assert.equal(analyse('QUILL - Take It Over - Theo Adds Project', 'projects').title, 'take it over');
});

test('row 13: short and long edits are versions, unless edits are switched off', () => {
    for (const name of ['ATLAS Intro Short 1.2.wav', 'ATLAS Intro Long 1.3.wav', 'ATLAS - Intro v2.wav', 'ATLAS Intro Track 3.wav', 'ATLAS - Intro Piece Project']) {
        assert.equal(analyse(name).title, 'intro', name);
    }
    assert.equal(analyse('ATLAS Intro Short 1.2.wav', 'bounces', { groupEdits: false }).title, 'intro short');
});

test('row 21: orchestral and trailer stem names are stems, with or without the word "Stems"', () => {
    for (const [name, part] of [
        ['Sync - Glasshouse - Final -  Whooshes.wav', 'whooshes'],
        ['Sync - Glasshouse - Final -  String Shorts.wav', 'string shorts'],
        ['Sync - Glasshouse - Final -  LOWS.wav', 'lows'],
        ['Corvid - The Lantern - Final Master 1.1 - Stems Woodwinds.wav', 'woodwinds'],
        ['Nightjar - WIP 1 - UNMASTER - - Stereo Out.wav', 'stereo out']
    ]) {
        const result = analyse(name);
        assert.equal(result.stemPart, part, name);
        assert.equal(result.isStemName, true, name);
    }
    assert.equal(analyse('Sync - Glasshouse - Final -  Whooshes.wav').title, 'glasshouse');
    assert.equal(analyse('Nightjar - WIP 1 - UNMASTER - - Stereo Out.wav').title, 'nightjar');
});

test('rows 22 and 23: stage and render words become version labels of one title', () => {
    for (const name of [
        'Corvid - The Lantern .1.1.wav',
        'Corvid - The Lantern v2.wav',
        'Corvid - The Lantern - Export 1.1.mp3',
        'Corvid - The Lantern - Final Master.wav',
        'Corvid - The Lantern - Final Touches - Done.wav',
        'Corvid - The Lantern - Master V1 - Rich Long.wav',
        'Corvid - The Lantern - Master V2 - Final.wav',
        'Corvid - The Lantern - Post Revisit 1.2.wav',
        'Corvid - The Lantern - Remastered - FINAL.wav',
        'Corvid - The Lantern - Final Remaster w TGP- Done.wav'
    ]) {
        assert.equal(analyse(name).title, 'the lantern', name);
    }
    assert.equal(analyse('Nightjar - WIP 1 - - MASTER.wav').title, 'nightjar');
    assert.equal(analyse('Nightjar - WIP 1 - UNMASTER2 - - MASTER.wav').title, 'nightjar');
    assert.equal(analyse('Morning 5 - Tuesday 31 Oct Pitched.wav').title, analyse('Morning 5 - Tuesday 31 Oct.wav').title);
    assert.equal(analyse('Piano Morning Jams - Monday Fox Den Reverse.wav').title, analyse('Piano Morning Jams - Monday Fox Den pt 2.wav').title);
    assert.equal(analyse('Morning 5 - Thursday Nov 9 Bass Only.wav').title, analyse('Morning 5 - Thursday Nov 9 Instr Only.wav').title);
});

test('row 24: bare tempo and take numbers are version labels', () => {
    assert.equal(analyse('Riff Idea - Marble 121 og.wav').title, 'marble');
    assert.equal(analyse('Riff Idea - Marble 121 3rdup.wav').title, 'marble');
    assert.equal(analyse('Sample - Tin Snow Christmas 165.wav').title, 'tin snow christmas');
    assert.equal(analyse('Sample - Tin Snow Christmas2.wav').title, 'tin snow christmas');
    assert.equal(analyse('Prophet Loop - Ember Gate 2 - 128 Loop.wav').title, 'ember gate');
});

test('row 26 and guardrails: dates stay when the title would otherwise be only a weekday; years stay', () => {
    assert.notEqual(analyse('Morning 5 - Friday April 21.wav').title, analyse('Morning 5 - Friday April 28.wav').title);
    assert.equal(analyse('Morning 5 - Friday April 21.wav').title, 'friday april 21');
    assert.notEqual(analyse('AURORA LIVE SET - ASCENT 2023.wav').title, analyse('AURORA LIVE SET - ASCENT 2024.wav').title);
    assert.equal(analyse('Paper Lanterns Jan 28.wav').title, 'paper lanterns');
});

test('guardrail: the three Skys and Sky Structure keep different titles', () => {
    const titles = ['SKY.wav', 'Red Sky 116bpm.wav', 'Ide Kareal Sky.als', 'Sky Structure.wav'].map((name) => analyse(name).title);
    assert.equal(new Set(titles).size, 4, titles.join(' | '));
});

test('the policy records why each word was set aside', () => {
    const result = analyse('Corvid - The Lantern - Final Master 1.1 - Stems Woodwinds.wav');
    const rules = result.removed.map((step) => step.rule);
    assert.ok(rules.includes('namespace'));
    assert.ok(rules.includes('stage'));
    assert.ok(rules.includes('stem'));
});

test('row 17: a contributor name inside a collaboration prefix stays part of the prefix', () => {
    const result = analyse('THEO x FRED - What Is V1.3 WIP.wav');
    assert.deepEqual([result.namespace, result.title], ['theo x fred', 'what is']);
});

test('a month alone is not a date; a month with a day is', () => {
    assert.equal(analyse('Lantern Aug.wav').title, 'lantern aug');
    assert.equal(analyse('Lantern Aug 7.wav').title, 'lantern');
});

test('bare numbers: takes (1–30) and tempos (60–200) are set aside, other numbers stay', () => {
    assert.deepEqual([analyse('Silver Lights 2.wav').title, analyse('Silver Lights 2.wav').bareNumber], ['silver lights', '2']);
    assert.equal(analyse('Silver Lights 122.wav').title, 'silver lights');
    assert.deepEqual([analyse('Silver Lights 537.wav').title, analyse('Silver Lights 537.wav').bareNumber], ['silver lights 537', '']);
    assert.equal(analyse('Silver Lights v2.wav').bareNumber, '', 'a version word is not a bare number');
});

test('a category phrase at the end of a name describes the file; it is not title ("- Musicbed Idea 1.1")', () => {
    assert.equal(analyse('May 3 - Harbour Lights - Musicbed Idea 1.1.wav').title, 'harbour lights');
    assert.equal(analyse('May 3 - Harbour Lights - Musicbed 1.7 w live vln.wav').title, 'harbour lights');
    assert.equal(analyse('May 3 - Harbour Lights - Music Bed 2 Copy Project', 'projects').title, 'harbour lights');
    assert.equal(analyse('Morning 5 - May 3 - Harbour Lights.wav').title, 'harbour lights');
    assert.match(analyse('May 3 - Harbour Lights - Musicbed Idea 1.1.wav').label, /musicbed idea/);
    // Single-word categories at the end stay title: "Jam", "Sample" can be part of a name.
    assert.equal(analyse('Glass Tide - Jam.wav').title, 'glass tide jam');
    assert.equal(analyse('Copper Field - Sample.wav').title, 'copper field sample');
    // At the start it is still the category prefix.
    assert.deepEqual([analyse('Music Bed - Calm Water.wav').title, analyse('Music Bed - Calm Water.wav').category], ['calm water', 'music bed']);
});

test('when cleaning would leave nothing, the date stays the title ("Revisit May 3 WIP 2")', () => {
    const first = analyse('Beat Idea - Revisit May 3 WIP 1.0.wav');
    const second = analyse('Beat Idea - Revisit May 3 WIP 2.wav');
    assert.deepEqual([first.title, first.dateKeyed, first.weak], ['may 3', true, false]);
    assert.deepEqual([second.title, second.bareNumber], ['may 3', '2']);
    assert.equal(analyse('Beat Idea - Revisit May 3 Sample V1.wav').title, 'revisit may 3 sample', 'a name beside the date keeps it');
    assert.equal(analyse('Beat Idea - WIP 2.wav').title, '', 'no date: still empty');
});
