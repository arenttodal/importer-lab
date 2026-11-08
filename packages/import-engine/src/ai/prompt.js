'use strict';

// The instruction and answer format for the AI pass. Starts from the main app's import review
// (IMP-FN-016-R4/R5): different songs stay separate, category prefixes are not identity, dates in
// names are when the file was made, and when unsure keep them apart.

const { policy } = require('../names');

const PROMPT_VERSION = 'lab-ai-1';

const titleCase = (text) => text.replace(/\b\w/g, (letter) => letter.toUpperCase());

const SYSTEM = `You help sort a music producer's files into songs. Each item is a group of files that the importer could not place with confidence. For each item, decide one of:
- "same-song": the item is the same song as one of its candidates; give that candidate's id.
- "own-song": the item is a song of its own, not any of its candidates.
- "not-sure": you cannot tell.

Rules:
- Different songs stay separate. When in doubt, answer "not-sure": a missed merge is easy to fix, a wrong merge is not.
- These category prefixes say what kind of file it is, not which song: ${policy.categoryPrefixes.map(titleCase).join(', ')}. Two files that share only such a prefix are not the same song.
- A date written in a name is when the file was made, not part of the song's title. Two files with different dates and no other shared title are different songs.
- Version words (final, master, mix, edit, bounce, stems, instrumental, a version number) do not make a different song.
- A collaborator, client or series prefix is not the song's title.
- Set "sure" to true only when the names leave little doubt.
- Answer every item exactly once. Give the reason in one short sentence.`;

const SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['answers'],
    properties: {
        answers: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['item', 'decision', 'candidate', 'sure', 'reason'],
                properties: {
                    item: { type: 'string' },
                    decision: { type: 'string', enum: ['same-song', 'own-song', 'not-sure'] },
                    candidate: { type: 'string', description: 'The candidate id for same-song, otherwise an empty string' },
                    sure: { type: 'boolean' },
                    reason: { type: 'string' }
                }
            }
        }
    }
};

function userMessage(payloads) {
    return `Items to sort (JSON):\n${JSON.stringify({ items: payloads })}`;
}

// Room for a short answer per item plus the model's thinking.
const maxTokensFor = (count) => 4000 + count * 150;

module.exports = { SYSTEM, SCHEMA, PROMPT_VERSION, userMessage, maxTokensFor };
