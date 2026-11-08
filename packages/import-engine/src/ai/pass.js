'use strict';

// Step 7, the AI pass (optional). Only unclear songs are asked about. Every answer passes the same
// gate as the rest of the engine before it changes anything:
//   - "same song" merges only when it passes the merge rule (equal canonical identity, IMP-FN-016-R19);
//     otherwise it becomes the song's first suggestion, for review. AI is never identity evidence, so
//     an AI answer never makes a song sure.
//   - "own song", when the model is sure, moves the song from unclear to "to check".
//   - "not sure" changes nothing.
// A small model answers first; a larger one re-answers a chunk only when the small one was unsure on
// more than 25% of it. A cost meter stops before any call that could pass the cap. Answers are
// cached per item, so a re-run costs nothing.

const crypto = require('node:crypto');
const { buildItems } = require('./items');
const { chunkItems, estimateTokens, HARD_LIMIT_TOKENS } = require('./chunks');
const { SYSTEM, SCHEMA, PROMPT_VERSION, userMessage, maxTokensFor } = require('./prompt');
const { costOf, worstCase, priceOf } = require('./pricing');

const ESCALATE_SHARE = 0.25;
const MAX_SUGGESTIONS = 3;
const DECISIONS = new Set(['same-song', 'own-song', 'not-sure']);

const cacheKey = (item, models) => crypto.createHash('sha256').update(JSON.stringify([PROMPT_VERSION, models.small, models.large || '', item.payload])).digest('hex');

// Answers that do not fit the question are dropped (IMP-FN-016-R14): unknown item, unknown
// decision, or a candidate the item was not offered.
function validAnswers(text, chunk) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return new Map();
    }
    const byId = new Map(chunk.map((item) => [item.payload.id, item]));
    const answers = new Map();
    for (const answer of Array.isArray(parsed.answers) ? parsed.answers : []) {
        const item = byId.get(answer && answer.item);
        if (!item || answers.has(item.payload.id) || !DECISIONS.has(answer.decision)) continue;
        const candidate = answer.decision === 'same-song' ? item.payload.candidates.find((entry) => entry.id === answer.candidate) : null;
        if (answer.decision === 'same-song' && !candidate) continue;
        answers.set(item.payload.id, { decision: answer.decision, candidate: candidate ? candidate.id : '', sure: answer.sure === true, reason: String(answer.reason || '').slice(0, 300) });
    }
    return answers;
}

const unsureShare = (answers, chunk) => chunk.filter((item) => !answers.has(item.payload.id) || !answers.get(item.payload.id).sure).length / chunk.length;

async function runAiPass(songs, { client, cache = new Map(), model, largeModel = null, maxCostUsd, onProgress = () => {}, isCancelled = () => false } = {}) {
    priceOf(model);
    if (largeModel) priceOf(largeModel);
    const models = { small: model, large: largeModel && largeModel !== model ? largeModel : null };
    const stats = { asked: 0, fromCache: 0, answered: 0, merged: 0, suggested: 0, ownSong: 0, notSure: 0, dropped: 0, skippedByCap: 0, calls: [], costUsd: 0, capped: false, errors: [], model, largeModel: models.large };
    const items = buildItems(songs);
    stats.asked = items.length;
    const answers = new Map(); // item id -> { answer, by }
    const toAsk = [];
    for (const item of items) {
        const cached = cache.get(cacheKey(item, models));
        if (cached) {
            answers.set(item.payload.id, cached);
            stats.fromCache += 1;
        } else toAsk.push(item);
    }
    const report = () => onProgress({ aiItems: items.length, aiDone: answers.size, aiCostUsd: Math.round(stats.costUsd * 10000) / 10000 });
    report();

    async function ask(chunk, useModel) {
        const user = userMessage(chunk.map((item) => item.payload));
        const inputTokens = estimateTokens(SYSTEM) + estimateTokens(user);
        if (inputTokens > HARD_LIMIT_TOKENS) throw new Error('A chunk passed the 100,000-token limit');
        const maxTokens = maxTokensFor(chunk.length);
        if (stats.costUsd + worstCase(useModel, inputTokens, maxTokens) > maxCostUsd) {
            stats.capped = true;
            return null;
        }
        const startedAt = Date.now();
        const response = await client.ask({ model: useModel, system: SYSTEM, user, schema: SCHEMA, maxTokens });
        const cost = costOf(useModel, response.usage || {});
        stats.costUsd += cost;
        stats.calls.push({
            at: new Date(startedAt).toISOString(),
            model: useModel,
            items: chunk.length,
            inputTokens: response.usage?.input_tokens || 0,
            outputTokens: response.usage?.output_tokens || 0,
            cacheReadTokens: response.usage?.cache_read_input_tokens || 0,
            cacheWriteTokens: response.usage?.cache_creation_input_tokens || 0,
            costUsd: Math.round(cost * 1e6) / 1e6,
            durationMs: Date.now() - startedAt,
            stopReason: response.stopReason || null
        });
        return validAnswers(response.stopReason === 'refusal' ? '' : response.text, chunk);
    }

    for (const chunk of chunkItems(toAsk)) {
        if (isCancelled()) break;
        let result;
        let by = models.small;
        try {
            result = await ask(chunk, models.small);
            if (result && models.large && unsureShare(result, chunk) > ESCALATE_SHARE) {
                const larger = await ask(chunk, models.large);
                if (larger) {
                    result = larger;
                    by = models.large;
                }
            }
        } catch (error) {
            stats.errors.push(client.describeError ? client.describeError(error) : error.message);
            continue;
        }
        if (!result) {
            stats.skippedByCap += chunk.length;
            continue;
        }
        for (const item of chunk) {
            const answer = result.get(item.payload.id);
            if (!answer) {
                stats.dropped += 1;
                continue;
            }
            const entry = { ...answer, by };
            answers.set(item.payload.id, entry);
            cache.set(cacheKey(item, models), entry);
        }
        report();
    }

    applyAnswers(songs, items, answers, stats);
    stats.costUsd = Math.round(stats.costUsd * 1e6) / 1e6;
    return stats;
}

function applyAnswers(songs, items, answers, stats) {
    const merged = new Set();
    for (const item of items) {
        const answer = answers.get(item.payload.id);
        if (!answer) continue;
        stats.answered += 1;
        const song = item.song;
        const label = `AI (${answer.by})`;
        if (answer.decision === 'not-sure') {
            stats.notSure += 1;
            song.reasons.push({ clue: 'ai', weight: 0, text: `${label} could not tell: ${answer.reason}` });
            continue;
        }
        if (answer.decision === 'own-song') {
            stats.ownSong += 1;
            song.reasons.push({ clue: 'ai', weight: answer.sure ? 0.5 : 0.2, text: `${label}: a song of its own. ${answer.reason}` });
            if (answer.sure) {
                song.band = 'unsure';
                song.precheck = false;
                song.decidedBy = 'ai';
            }
            continue;
        }
        // item.candidates and item.payload.candidates are in the same order.
        const target = item.candidates[item.payload.candidates.findIndex((candidate) => candidate.id === answer.candidate)];
        if (!target || merged.has(target) || merged.has(song)) continue;
        const passesMergeRule = Boolean(song.canonicalIdentity) && song.canonicalIdentity === target.canonicalIdentity;
        if (passesMergeRule && answer.sure) {
            stats.merged += 1;
            target.files.push(...song.files);
            target.reasons.push({ clue: 'ai', weight: 0.5, text: `${label}: “${song.songName}” is the same song (same name). ${answer.reason}` });
            target.decidedBy = 'ai';
            merged.add(song);
            continue;
        }
        stats.suggested += 1;
        const weight = answer.sure ? 0.9 : 0.6;
        song.possibleMatches = [{ proposalId: target.proposalId, songName: target.songName, reason: `${label}: ${answer.reason}`, weight }, ...(song.possibleMatches || []).filter((match) => match.proposalId !== target.proposalId)].slice(0, MAX_SUGGESTIONS);
        song.reasons.push({ clue: 'ai', weight, text: `${label}: may be the same song as “${target.songName}”. ${answer.reason}` });
        if (answer.sure) {
            song.band = 'unsure';
            song.precheck = false;
            song.decidedBy = 'ai';
        }
    }
    if (merged.size) {
        const keep = songs.filter((song) => !merged.has(song));
        songs.length = 0;
        songs.push(...keep);
    }
}

module.exports = { runAiPass, validAnswers, ESCALATE_SHARE };
