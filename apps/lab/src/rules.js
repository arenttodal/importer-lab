'use strict';

// The producer's rules (SPEC M3): answers to "What is <prefix>?" saved in rules.json in the data
// folder, plus every mark turned into a rule on the next scan. Names only, never paths.
//
//   right        → together (these files stay one song)
//   merge        → together (both songs' files)
//   split        → apart (back to the app's exact names)
//   wrong-song   → remove (the file leaves that song)
//   rename       → names (the song is shown under the new name)
//
// Answers to the AI's questions: "same song" is saved as a merge mark; "different songs" as a notSame
// pair; "what is …?" as a prefix answer. Every answered or skipped question id is kept, so it is not
// asked again.
//
// Marks made before marks carried file names are resolved from the saved scan they were made on.

const fs = require('node:fs');
const path = require('node:path');

const ROLES = ['band', 'series', 'course', 'pack', 'collaborator', 'word'];

function rulesPath(dataDir) {
    return path.join(dataDir, 'rules.json');
}

function loadRules(dataDir) {
    try {
        const saved = JSON.parse(fs.readFileSync(rulesPath(dataDir), 'utf8'));
        return { format: 'importer-lab-rules', version: 1, prefixes: saved.prefixes || {}, useMarks: saved.useMarks !== false, notSame: saved.notSame || [], skippedQuestions: saved.skippedQuestions || [] };
    } catch {
        return { format: 'importer-lab-rules', version: 1, prefixes: {}, useMarks: true, notSame: [], skippedQuestions: [] };
    }
}

function saveRules(dataDir, rules) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(rulesPath(dataDir), JSON.stringify(rules, null, 2));
}

// answers: { prefix: role | null } — null forgets the answer.
function answerPrefixes(dataDir, answers) {
    const rules = loadRules(dataDir);
    for (const [prefix, role] of Object.entries(answers || {})) {
        const key = String(prefix).toLowerCase().trim().slice(0, 100);
        if (!key) continue;
        if (role === null) delete rules.prefixes[key];
        else if (ROLES.includes(role)) rules.prefixes[key] = role;
    }
    saveRules(dataDir, rules);
    return rules;
}

function setUseMarks(dataDir, useMarks) {
    const rules = loadRules(dataDir);
    rules.useMarks = useMarks === true;
    saveRules(dataDir, rules);
    return rules;
}

// Records the producer's answer to one AI question (the question as the scan produced it).
// answer: 'same' | 'different' | 'skip' | a prefix role (for "what is …?").
function answerAiQuestion(dataDir, question, answer) {
    const rules = loadRules(dataDir);
    const names = (list) => (Array.isArray(list) ? list.slice(0, 2000).map((name) => String(name).slice(0, 500)) : []);
    if (answer === 'different' && question.kind === 'same-song') rules.notSame.push({ a: names(question.songFiles), b: names(question.otherFiles) });
    if (question.kind === 'what-is' && ROLES.includes(answer)) rules.prefixes[String(question.word).toLowerCase().trim().slice(0, 100)] = answer;
    if (!rules.skippedQuestions.includes(question.id)) rules.skippedQuestions.push(String(question.id).slice(0, 40));
    saveRules(dataDir, rules);
    return rules;
}

// Ask the skipped and answered AI questions again (answers already saved stay).
function forgetAiQuestions(dataDir) {
    const rules = loadRules(dataDir);
    rules.skippedQuestions = [];
    saveRules(dataDir, rules);
    return rules;
}

// filesOf(scanId, songName) → file names, for marks without fileNames (older builds).
function rulesFromMarks(marks, filesOf = () => null) {
    const together = [];
    const apart = [];
    const remove = [];
    const names = [];
    const filesFor = (mark, songName) => (songName === mark.songName && mark.fileNames && mark.fileNames.length ? mark.fileNames : filesOf(mark.scanId, songName)) || [];
    for (const mark of marks) {
        if (mark.target === 'file' && mark.kind === 'wrong-song') {
            const from = filesFor(mark, mark.songName).filter((name) => name !== mark.fileName);
            if (mark.fileName && from.length) remove.push({ file: mark.fileName, from });
            continue;
        }
        const own = filesFor(mark, mark.songName);
        if (mark.kind === 'right' && own.length >= 2) together.push(own);
        if (mark.kind === 'split' && own.length >= 2) apart.push(own);
        if (mark.kind === 'rename' && mark.newName && own.length) names.push({ files: own, name: mark.newName });
        if (mark.kind === 'merge' && mark.mergeWithSongName) {
            const other = mark.mergeWithFileNames && mark.mergeWithFileNames.length ? mark.mergeWithFileNames : filesOf(mark.scanId, mark.mergeWithSongName) || [];
            if (own.length && other.length) together.push([...new Set([...own, ...other])]);
        }
    }
    return { together, apart, remove, names };
}

// What the engine gets: prefix answers plus, when switched on, the rules from every mark.
function buildUserRules(dataDir, marks, filesOf) {
    const saved = loadRules(dataDir);
    return { prefixes: saved.prefixes, notSame: saved.notSame, skippedQuestions: saved.skippedQuestions, ...(saved.useMarks ? rulesFromMarks(marks, filesOf) : { together: [], apart: [], remove: [], names: [] }) };
}

module.exports = { loadRules, saveRules, answerPrefixes, setUseMarks, rulesFromMarks, buildUserRules, answerAiQuestion, forgetAiQuestions, ROLES };
