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
//
// Rules hold file names only: no paths, no contents.

const ROLES = ['band', 'series', 'course', 'pack', 'collaborator', 'word'];

function emptyRules() {
    return { prefixes: {}, together: [], apart: [], remove: [], names: [] };
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
    return clean;
}

function prefixesWith(rules, role) {
    return Object.entries(rules.prefixes).filter(([, value]) => value === role).map(([prefix]) => prefix);
}

module.exports = { ROLES, emptyRules, normalize, prefixesWith };
