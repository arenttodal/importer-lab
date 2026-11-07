'use strict';

// What the renderer may see. Absolute paths never leave the main process (IMP-FN-032-R3):
// files are shown by sourceRelativePath, roots by folder name and an opaque id.

function rendererFile(file) {
    return {
        fileId: file.fileId,
        name: file.name,
        sourceRelativePath: file.sourceRelativePath,
        type: file.type,
        ext: file.ext,
        sizeBytes: file.sizeBytes,
        modifiedAt: file.modifiedAt,
        confidence: file.confidence,
        classifierReason: file.classifierReason,
        needsReview: file.needsReview,
        cloudPlaceholder: file.cloudPlaceholder
    };
}

function rendererBaseline(baseline) {
    return { groups: baseline.groups, stats: baseline.stats, tier3Count: baseline.tier3Candidates.length };
}

function toRendererView(result, roots) {
    const { catalog } = result;
    return {
        scanId: result.scanId,
        roots: roots.map((root) => ({ id: root.id, name: root.name })),
        contractVersion: catalog.contractVersion,
        engineVersion: catalog.engineVersion,
        stats: catalog.stats,
        notes: {
            folders: result.notes.folders,
            symlinksSkipped: result.notes.symlinksSkipped,
            unreadableFolders: result.notes.unreadableFolders,
            typeCounts: result.notes.typeCounts,
            placeholdersFound: result.notes.placeholdersFound,
            reusedFromStore: result.notes.reusedFromStore
        },
        files: [...catalog.unassigned, ...catalog.songs.flatMap((song) => song.files)].map(rendererFile),
        baselines: {
            preserve: rendererBaseline(catalog.baseline),
            strip: rendererBaseline(result.baselineStripNamespaces)
        }
    };
}

module.exports = { toRendererView };
