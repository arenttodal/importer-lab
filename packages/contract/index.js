'use strict';

// Runtime constants for contract v1.1.0. Types are in index.d.ts.

const CONTRACT_VERSION = '1.3.0';

const FILE_TYPES = Object.freeze(['bounces', 'stems', 'projects', 'videos', 'unknown']);

const BANDS = Object.freeze(['sure', 'unsure', 'unclear']);

const CLUES = Object.freeze([
    'canonical-name',
    'folder',
    'timing',
    'project-contents',
    'shared-samples',
    'duplicate',
    'stem-set',
    'ai',
    'user-rule'
]);

const SONG_KINDS = Object.freeze(['song', 'template', 'course', 'sample-pack', 'stem-set']);

module.exports = { CONTRACT_VERSION, FILE_TYPES, BANDS, CLUES, SONG_KINDS };
