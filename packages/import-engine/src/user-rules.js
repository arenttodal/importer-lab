'use strict';

// User rules (SPEC M3): the producer's answers and corrections, applied first on the next run.
//
//   prefixes: { "<prefix>": role }  — answers to "What is <prefix>?"
//     band        a band, artist or client: files with it group by title within it
//     series      a series of ideas (like "Morning 5"): set aside; a date alone keeps songs apart
//     course      course or tutorial material
//     pack        a sample pack: its files are one sample-pack entry
//     collaborator a person's name: set aside in titles
//     word        just part of a title: never a prefix
//   together: [[fileName, …]]     these files are one song ("Right", "Should be merged")
//   apart:    [[fileName, …]]     these files were wrongly put together ("Should be split")
//   remove:   [{ file, from: [fileName, …] }]  this file is not in that song ("In the wrong song")
//   names:    [{ files: [fileName, …], name }]  rename a song
//   stems:    [fileName, …]          these files are stems ("Not a song: a stem of …", with a together rule)
//   notSongs: [{ files: [fileName, …], reason: 'sample' | 'other' }]  not songs ("Not a song"): a sample
//             joins the sample pack in its folder; anything else is listed under "Not songs"
//   skippedQuestions: [id, …]        questions answered or skipped, not asked again
//
// Rules hold file names only: no paths, no contents.

const ROLES = ['band', 'series', 'course', 'pack', 'collaborator', 'word'];

function emptyRules() {
    return { prefixes: {}, together: [], apart: [], remove: [], names: [], stems: [], notSongs: [], skippedQuestions: [] };
}

function normalize(input) {
    const rules = input || {};
    const clean = emptyRules();
    for (const [prefix, role] of Object.entries(rules.prefixes || {})) if (ROLES.includes(role)) clean.prefixes[String(prefix).toLowerCase().trim()] = role;
    const names = (list) => (Array.isArray(list) ? list.map(String).filter(Boolean) : []);
    clean.together = (rules.together || []).map(names).filter((list) => list.length >= 2);
    clean.apart = (rules.apart || []).map(names).filter((list) => list.length >= 2);
    clean.remove = (rules.remove || []).filter((rule) => rule && rule.file).map((rule) => ({ file: String(rule.file), from: names(rule.from) }));
    clean.names = (rules.names || []).filter((rule) => rule && rule.name).map((rule) => ({ files: names(rule.files), name: String(rule.name).slice(0, 200) }));
    clean.stems = names(rules.stems);
    clean.notSongs = (rules.notSongs || []).filter((rule) => rule && ['sample', 'other'].includes(rule.reason)).map((rule) => ({ files: names(rule.files), reason: rule.reason })).filter((rule) => rule.files.length);
    clean.skippedQuestions = names(rules.skippedQuestions);
    return clean;
}

function prefixesWith(rules, role) {
    return Object.entries(rules.prefixes).filter(([, value]) => value === role).map(([prefix]) => prefix);
}

module.exports = { ROLES, emptyRules, normalize, prefixesWith };
