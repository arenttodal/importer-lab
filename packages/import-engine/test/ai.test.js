'use strict';

// M4, the AI pass. No network here: a fake client stands in for the model and records exactly what
// would have been sent. Names are invented.

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildItems } = require('../src/ai/items');
const { chunkItems, estimateTokens } = require('../src/ai/chunks');
const { runAiPass, validAnswers } = require('../src/ai/pass');
const { costOf, worstCase } = require('../src/ai/pricing');

let next = 0;
function file(name, extra = {}) {
    next += 1;
    return {
        fileId: `f${next}`,
        name,
        type: extra.type || 'bounces',
        ext: name.split('.').pop(),
        sizeBytes: 4200000,
        createdAt: '2025-03-01T10:00:00.000Z',
        modifiedAt: '2025-03-02T10:00:00.000Z',
        durationMs: 183000,
        path: `/Users/someone/Music/Private Folder/${extra.folder || 'Songs'}/${name}`,
        sourceRelativePath: `${extra.folder || 'Songs'}/${name}`,
        ...extra
    };
}

function song(name, band, files, extra = {}) {
    return { proposalId: `p-${name}`, songName: name, displayName: name, canonicalIdentity: name.toLowerCase(), band, kind: 'song', files, reasons: [], possibleMatches: [], decidedBy: 'rules', ...extra };
}

function catalog() {
    return [
        song('Harbour Lights', 'sure', [file('Harbour Lights.wav'), file('Harbour Lights.als', { type: 'projects' })]),
        song('Harbour Lights Bass', 'unclear', [file('Harbour Lights Bass.wav', { type: 'stems' })], { canonicalIdentity: 'harbour lights bass' }),
        song('Copper Field', 'sure', [file('Copper Field.wav')]),
        song('Morning 5 - March 3', 'unclear', [file('Morning 5 - March 3.wav', { folder: 'Jams' })], { canonicalIdentity: '' }),
        song('Midnight Copper', 'unsure', [file('Midnight Copper.wav')])
    ];
}

// A fake model: answers from a table, records each request, and reports usage.
function fakeClient(answerFor, usage = { input_tokens: 2000, output_tokens: 300 }) {
    const requests = [];
    return {
        requests,
        async ask(request) {
            requests.push(request);
            const items = JSON.parse(request.user.slice(request.user.indexOf('{'))).items;
            return { text: JSON.stringify({ answers: items.map((item) => answerFor(item, request.model)) }), usage, stopReason: 'end_turn' };
        }
    };
}

test('privacy: no path, no path separator, no audio and only the allowed fields go to the model', async () => {
    const songs = catalog();
    songs[1].files[0].audio = Buffer.alloc(4096, 7).toString('base64');
    songs[1].files[0].name = 'Harbour Lights Bass\\take "12 inch".wav';
    songs[0].files[0].name = 'Harbour Lights 7" edit.wav';
    songs[1].reasons.push({ clue: 'folder', weight: 0.3, text: 'Same folder “Songs/Old”' });
    const client = fakeClient((item) => ({ item: item.id, decision: 'not-sure', candidate: '', sure: false, reason: 'unclear' }));
    await runAiPass(songs, { client, model: 'claude-haiku-5-5', maxCostUsd: 1 });
    assert.equal(client.requests.length, 1);
    const sent = client.requests[0].system + client.requests[0].user;
    assert.ok(!/[\\/]/.test(client.requests[0].user), 'no path separator in the payload');
    assert.ok(!sent.includes('Users') && !sent.includes('Private Folder') && !sent.includes('someone'), 'no part of an absolute path');
    assert.ok(!/[A-Za-z0-9+=]{100,}/.test(sent), 'no audio data or other long blobs');
    const payload = JSON.parse(client.requests[0].user.slice(client.requests[0].user.indexOf('{')));
    for (const item of payload.items) {
        assert.deepEqual(Object.keys(item).sort(), ['candidates', 'clues', 'files', 'id', 'shownAs']);
        assert.match(item.id, /^i[0-9a-f]{10}$/, 'an opaque id');
        for (const entry of item.files) assert.deepEqual(Object.keys(entry).sort(), ['created', 'ext', 'folderDepth', 'lengthSec', 'modified', 'name', 'siblings', 'sizeKb', 'type']);
        for (const candidate of item.candidates) assert.deepEqual(Object.keys(candidate).sort(), ['dates', 'files', 'id', 'name', 'types']);
    }
});

test('only unclear songs are asked about; sure and unsure songs only appear as candidates', () => {
    const items = buildItems(catalog());
    assert.deepEqual(items.map((item) => item.song.songName).sort(), ['Harbour Lights Bass', 'Morning 5 - March 3']);
    const bass = items.find((item) => item.song.songName === 'Harbour Lights Bass');
    assert.equal(bass.payload.candidates[0].name, 'Harbour Lights', 'the song sharing its words is the first candidate');
    const jam = items.find((item) => item.song.songName.startsWith('Morning 5'));
    assert.ok(!jam.payload.candidates.some((candidate) => candidate.name.startsWith('Morning 5')), 'a category prefix alone is no reason to offer a candidate');
});

test('chunks stay under the budget and keep items that share samples together', () => {
    const songs = [];
    for (let index = 0; index < 60; index += 1) songs.push(song(`Idea ${index} Glasswing${index}`, 'unclear', [file(`Idea ${index} Glasswing${index}.wav`)]));
    // Items 0 and 59 share samples (a clue link): they must land in the same chunk.
    songs[0].possibleMatches.push({ proposalId: songs[59].proposalId, songName: songs[59].songName, reason: 'Uses the same samples', weight: 0.7 });
    const items = buildItems(songs);
    const budget = 2000;
    const chunks = chunkItems(items, { budget });
    assert.ok(chunks.length > 1);
    for (const chunk of chunks) assert.ok(chunk.reduce((sum, item) => sum + estimateTokens(item.payload), 0) <= budget || chunk.length === 1);
    const chunkOf = (name) => chunks.findIndex((chunk) => chunk.some((item) => item.song.songName === name));
    assert.equal(chunkOf(songs[0].songName), chunkOf(songs[59].songName));
});

test('the gate: a "same song" answer across different names is a suggestion, never a merge, and never sure', async () => {
    const songs = catalog();
    const client = fakeClient((item) => (item.shownAs === 'Harbour Lights Bass' ? { item: item.id, decision: 'same-song', candidate: item.candidates[0].id, sure: true, reason: 'A stem of the song.' } : { item: item.id, decision: 'not-sure', candidate: '', sure: false, reason: '?' }));
    const stats = await runAiPass(songs, { client, model: 'claude-haiku-5-5', maxCostUsd: 1 });
    const bass = songs.find((entry) => entry.songName === 'Harbour Lights Bass');
    assert.equal(songs.length, 5, 'nothing merged');
    assert.equal(bass.possibleMatches[0].songName, 'Harbour Lights');
    assert.match(bass.possibleMatches[0].reason, /^AI \(claude-haiku-5-5\)/);
    assert.equal(bass.band, 'unsure', 'moves to "to check", with the suggestion');
    assert.equal(bass.decidedBy, 'ai');
    assert.ok(!songs.some((entry) => entry.decidedBy === 'ai' && entry.band === 'sure'));
    assert.deepEqual([stats.suggested, stats.merged, stats.notSure], [1, 0, 1]);
    assert.equal(songs.find((entry) => entry.songName.startsWith('Morning 5')).band, 'unclear', '"not sure" changes nothing');
});

test('the gate: a "same song" answer merges only when the names have the same identity (the merge rule)', async () => {
    const songs = catalog();
    songs[1].canonicalIdentity = 'harbour lights';
    const client = fakeClient((item) => (item.shownAs === 'Harbour Lights Bass' ? { item: item.id, decision: 'same-song', candidate: item.candidates[0].id, sure: true, reason: 'Same title.' } : { item: item.id, decision: 'own-song', candidate: '', sure: false, reason: 'A jam.' }));
    const stats = await runAiPass(songs, { client, model: 'claude-haiku-5-5', maxCostUsd: 1 });
    assert.equal(stats.merged, 1);
    assert.equal(songs.length, 4);
    assert.equal(songs.find((entry) => entry.songName === 'Harbour Lights').files.length, 3);
});

test('answers that do not fit are dropped: unknown items, unknown decisions, candidates not offered', () => {
    const items = buildItems(catalog());
    const bass = items.find((item) => item.song.songName === 'Harbour Lights Bass');
    const text = JSON.stringify({
        answers: [
            { item: bass.payload.id, decision: 'same-song', candidate: 'c-made-up', sure: true, reason: 'x' },
            { item: 'i-unknown', decision: 'own-song', candidate: '', sure: true, reason: 'x' },
            { item: bass.payload.id, decision: 'merge-everything', candidate: '', sure: true, reason: 'x' }
        ]
    });
    assert.equal(validAnswers(text, items).size, 0);
    assert.equal(validAnswers('not json', items).size, 0);
});

test('the cost cap: the pass stops before any call that could pass the cap; the rest stays unclear', async () => {
    const songs = [];
    for (let index = 0; index < 400; index += 1) songs.push(song(`Sketch ${index} Ember${index}`, 'unclear', [file(`Sketch ${index} Ember${index}.wav`)]));
    const client = fakeClient((item) => ({ item: item.id, decision: 'own-song', candidate: '', sure: true, reason: 'Own title.' }), { input_tokens: 25000, output_tokens: 6000 });
    const cap = 0.004;
    const stats = await runAiPass(songs, { client, model: 'claude-haiku-5-5', maxCostUsd: cap });
    assert.ok(stats.capped);
    assert.ok(stats.costUsd <= cap, `spent ${stats.costUsd}, cap ${cap}`);
    assert.ok(stats.skippedByCap > 0);
    assert.ok(songs.some((entry) => entry.band === 'unclear'));
    const none = await runAiPass(catalog(), { client: fakeClient(() => assert.fail('no call')), model: 'claude-haiku-5-5', maxCostUsd: 0 });
    assert.deepEqual([none.costUsd, none.calls.length, none.capped], [0, 0, true]);
});

test('the meter: cost from the usage the service reports, and a worst case above it', () => {
    assert.equal(costOf('claude-haiku-5-5', { input_tokens: 1e6, output_tokens: 0 }), 0.1);
    assert.equal(costOf('claude-haiku-5-5', { input_tokens: 0, output_tokens: 1e6 }), 0.5);
    assert.ok(worstCase('claude-haiku-5-5', 1000, 1000) >= costOf('claude-haiku-5-5', { input_tokens: 1000, output_tokens: 1000 }));
    assert.throws(() => costOf('some-unpriced-model', {}), /No price is known/);
});

test('the cache: a re-run with the same unclear songs costs nothing and gives the same answers', async () => {
    const cache = new Map();
    const answer = (item) => ({ item: item.id, decision: 'own-song', candidate: '', sure: true, reason: 'Own title.' });
    const first = await runAiPass(catalog(), { client: fakeClient(answer), cache, model: 'claude-haiku-5-5', maxCostUsd: 1 });
    const songs = catalog();
    const second = await runAiPass(songs, { client: fakeClient(() => assert.fail('no call on a re-run')), cache, model: 'claude-haiku-5-5', maxCostUsd: 1 });
    assert.ok(first.costUsd > 0);
    assert.deepEqual([second.costUsd, second.calls.length, second.fromCache, second.ownSong], [0, 0, 2, 2]);
});

test('the larger model re-answers a chunk only when the small one is unsure on more than 25% of it', async () => {
    const unsure = (item, model) => ({ item: item.id, decision: model === 'claude-haiku-5-5' ? 'not-sure' : 'own-song', candidate: '', sure: model !== 'claude-haiku-5-5', reason: 'r' });
    const escalated = await runAiPass(catalog(), { client: fakeClient(unsure), model: 'claude-haiku-5-5', largeModel: 'claude-sonnet-5-5', maxCostUsd: 1 });
    assert.deepEqual(escalated.calls.map((call) => call.model), ['claude-haiku-5-5', 'claude-sonnet-5-5']);
    assert.equal(escalated.ownSong, 2);
    const sure = (item) => ({ item: item.id, decision: 'own-song', candidate: '', sure: true, reason: 'r' });
    const plain = await runAiPass(catalog(), { client: fakeClient(sure), model: 'claude-haiku-5-5', largeModel: 'claude-sonnet-5-5', maxCostUsd: 1 });
    assert.deepEqual(plain.calls.map((call) => call.model), ['claude-haiku-5-5']);
});

test('a failed call is logged and changes nothing; the scan goes on', async () => {
    const songs = catalog();
    const client = { async ask() { throw new Error('offline'); } };
    const stats = await runAiPass(songs, { client, model: 'claude-haiku-5-5', maxCostUsd: 1 });
    assert.deepEqual(stats.errors, ['offline']);
    assert.equal(songs.filter((entry) => entry.band === 'unclear').length, 2);
});
