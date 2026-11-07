'use strict';

// Adapter around electron/hybrid-grouper.js (IMP-FN-019): today's grouping, run read-only as the
// comparison baseline. Adapter 2 in the brief: the grouper's console.log output is captured.

const { requireApp } = require('./vendor');

const { hybridGroupFiles } = requireApp('electron/hybrid-grouper.js');

const GROUPED_TYPES = ['bounces', 'stems', 'projects', 'videos'];

// Same entry shape the import review wizard builds (library-import-session.cjs, before
// hybridGroupFiles). The automatic-import path also marks folder projects (auto-import-result-groups.js);
// the wizard does not, so isFolderProject is only set in the non-preserving mode.
function toGrouperEntry(file, preserveSourceIdentity) {
    const entry = {
        id: file.fileId,
        name: file.name,
        path: file.path,
        size: file.sizeBytes,
        mtime: new Date(file.modifiedAt || 0),
        type: file.type,
        sourceRelativePath: file.sourceRelativePath,
        sourceContainerId: file.sourceContainerId
    };
    if (!preserveSourceIdentity && file.isFolder && file.type === 'projects') entry.isFolderProject = true;
    return entry;
}

function runBaseline(files, { preserveSourceIdentity, existingGroups = [] }) {
    const entries = files.filter((file) => GROUPED_TYPES.includes(file.type)).map((file) => toGrouperEntry(file, preserveSourceIdentity));
    const idByPath = new Map(entries.map((entry) => [entry.path, entry.id]));

    const log = [];
    const originalLog = console.log;
    console.log = (...args) => log.push(args.join(' '));
    let out;
    try {
        out = hybridGroupFiles(entries, { existingGroups, hierarchyCatalog: null, preserveSourceIdentity });
    } finally {
        console.log = originalLog;
    }

    const groups = Object.entries(out.groups).map(([songName, group]) => ({
        songName,
        fileIds: GROUPED_TYPES.flatMap((type) => (group[type] || []).map((entry) => entry.id))
    }));

    // reviewItems carry absolute paths in the app; the lab keeps only the file id.
    const reviewItems = out.reviewItems.map((item) => ({
        fileId: idByPath.get(item.file.path) || null,
        type: item.type,
        suggestedGroup: item.suggestedGroup,
        displayName: item.displayName,
        isNew: item.isNew,
        confidence: item.confidence,
        extractionMethod: item.extractionMethod
    }));

    return {
        groups,
        reviewItems,
        tier3Candidates: out.tier3Candidates,
        stats: { tier3Count: 0, ...out.stats },
        log
    };
}

module.exports = { runBaseline };
