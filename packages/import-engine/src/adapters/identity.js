'use strict';

// Adapter around electron/import-canonical-identity.js: the only name the app allows to merge songs
// (IMP-FN-007-R14). Stems are read as dependents and videos keep their title words, as the
// review wizard does before grouping (library-import-session.cjs -> hybrid-grouper.js).

const { requireApp } = require('./vendor');

const { canonicalSongIdentity, preClean } = requireApp('electron/import-canonical-identity.js');

function fileIdentity(file) {
    const video = file.type === 'videos';
    return canonicalSongIdentity(file.name, { dependent: file.type === 'stems', video }) || preClean(file.name, { video }).toLowerCase();
}

module.exports = { fileIdentity };
