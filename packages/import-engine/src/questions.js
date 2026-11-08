'use strict';

// "Teach the importer": a few questions after a scan, about the prefixes that shape the most files.
// "What is Quill?" → band · series · course · sample pack · collaborator · just a word. Each
// question carries the engine's own best guess, so skipping it changes nothing. Answers become
// user rules (user-rules.js), applied first on the next scan.

const { preClean } = require('./adapters/vendor').requireApp('electron/import-canonical-identity.js');
const { segmentsOf, policy } = require('./names');

const MAX_QUESTIONS = 8;
const MIN_FILES = 3;
const CATEGORY = new Set(policy.categoryPrefixes);
const MONTHS = new Set(policy.months);

function prefixOf(name) {
    const segments = segmentsOf(preClean(name));
    return segments.length > 1 ? segments[0].join(' ') : null;
}

function hasDate(name) {
    const words = segmentsOf(preClean(name)).flat();
    return words.some((word, index) => MONTHS.has(word) && /^\d{1,3}$/.test(words[index + 1] || words[index - 1] || ''));
}

// songs: the engine's songs (kind, displayName, files); answered: prefixes with a rule already.
function suggestQuestions(files, { namespaces = [], courseSuggestions = [], songs = [], answered = [] } = {}) {
    const skip = new Set(answered.map((prefix) => prefix.toLowerCase()));
    const kindOfFile = new Map();
    const songOfFile = new Map();
    for (const song of songs) for (const member of song.files) {
        kindOfFile.set(member.fileId, song.kind);
        songOfFile.set(member.fileId, song.displayName || song.songName);
    }
    const byPrefix = new Map();
    for (const member of files) {
        const prefix = prefixOf(member.name);
        if (!prefix) continue;
        // Dates ("March 12") and version numbers are never prefixes worth a question.
        const words = prefix.split(' ');
        const isDate = words.some((word) => MONTHS.has(word)) && words.some((word) => /^\d{1,3}$/.test(word));
        if (!prefix || CATEGORY.has(prefix) || skip.has(prefix) || /\d+\.\d+/.test(prefix) || isDate) continue;
        if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
        byPrefix.get(prefix).push(member);
    }
    const course = new Set(courseSuggestions.map((entry) => entry.prefix));
    const learned = new Set(namespaces);
    const questions = [];
    for (const [prefix, members] of byPrefix) {
        if (members.length < MIN_FILES) continue;
        const packShare = members.filter((member) => kindOfFile.get(member.fileId) === 'sample-pack').length / members.length;
        const dateShare = members.filter((member) => hasDate(member.name)).length / members.length;
        let guess = 'word';
        if (course.has(prefix)) guess = 'course';
        else if (packShare > 0.5) guess = 'pack';
        else if (dateShare > 0.5) guess = 'series';
        else if (learned.has(prefix)) guess = 'band';
        const examples = [...new Set(members.map((member) => songOfFile.get(member.fileId)).filter(Boolean))].slice(0, 3);
        questions.push({ prefix, files: members.length, guess, examples });
    }
    return questions.sort((a, b) => b.files - a.files || a.prefix.localeCompare(b.prefix)).slice(0, MAX_QUESTIONS);
}

module.exports = { suggestQuestions, MAX_QUESTIONS };
