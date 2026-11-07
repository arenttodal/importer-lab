'use strict';

// Adapter around electron/external-folder-import.js (walkFolder's per-folder rules).
// The lab's crawler supplies the unbounded recursion; what counts as one item comes from the app.

const { requireApp } = require('./vendor');

const { isSkippableName, extensionOf, findProjectFolderForPath } = requireApp('electron/external-folder-import.js');

// MIRROR of SOURCE_CATEGORY_BY_FOLDER + sourceCategoryForFolder (IMP-FN-023) in
// electron/external-folder-import.js, which are not exported at the pin.
// Parity with the real walkFolder is asserted in test/crawl.test.js.
// Patch P1 in docs/PATCHES.md exports them; delete this mirror when the pin moves past it.
const SOURCE_CATEGORY_BY_FOLDER = new Map([
    ['bounces', 'bounce'],
    ['stems', 'stem'],
    ['projects', 'project']
]);

function sourceCategoryForFolder(name, inheritedCategory = null) {
    return SOURCE_CATEGORY_BY_FOLDER.get(String(name || '').toLowerCase()) || inheritedCategory;
}

// Returns walkFolder's atomic project candidate for this folder (a DAW bundle such as .logicx,
// or a genuine project wrapper such as an Ableton project folder), or null for an ordinary folder.
async function projectCandidateForFolder(folderPath) {
    return findProjectFolderForPath(folderPath, { maxAncestors: 1 });
}

module.exports = { isSkippableName, extensionOf, sourceCategoryForFolder, projectCandidateForFolder };
