'use strict';

// Adapter around electron/catchall-classifier.js (IMP-FN-021, IMP-FN-033).
// inbox-router.js is deliberately NOT used: routeItemsToInboxes() moves files (CONFLICTS K4).

const { requireApp } = require('./vendor');

const { classify } = requireApp('electron/catchall-classifier.js');

// The classifier speaks singular; the contract and tracks.file_type speak plural.
const PLURAL_TYPE = { bounce: 'bounces', stem: 'stems', project: 'projects', video: 'videos' };

function classifyItem(item, userRules = []) {
    const result = classify({
        path: item.path,
        type: item.type,
        extension: item.extension,
        size: item.size,
        mtimeMs: item.mtimeMs,
        sourceCategory: item.sourceCategory || undefined,
        folderContents: item.folderContents || undefined,
        userRules
    });
    return {
        type: PLURAL_TYPE[result.classification] || 'unknown',
        confidence: result.confidence,
        reason: result.reason
    };
}

module.exports = { classifyItem };
