'use strict';

// What the renderer may see. Absolute paths never leave the main process (IMP-FN-032-R3):
// files are shown by sourceRelativePath, roots by folder name and an opaque id.
// Songs are the engine's (bands, kinds, versions, stem sets, reasons, possible matches); today's
// importer travels alongside in both modes for the Lab's comparison.

const TYPE_NAMES = {
    bounces: ['bounce', 'bounces'],
    stems: ['stem', 'stems'],
    projects: ['project', 'projects'],
    videos: ['video', 'videos']
};

function plural(count, type) {
    const [one, many] = TYPE_NAMES[type] || ['file', 'files'];
    return `${count} ${count === 1 ? one : many}`;
}

function rendererFile(file) {
    return {
        fileId: file.fileId,
        name: file.name,
        sourceRelativePath: file.sourceRelativePath,
        type: file.type,
        ext: file.ext,
        sizeBytes: file.sizeBytes,
        modifiedAt: file.modifiedAt,
        durationMs: file.durationMs || null,
        confidence: file.confidence,
        classifierReason: file.classifierReason,
        canonicalIdentity: file.canonicalIdentity,
        versionLabel: file.versionLabel || null,
        stemPart: file.stemPart || null,
        latest: Boolean(file.latest),
        needsReview: file.needsReview,
        cloudPlaceholder: file.cloudPlaceholder
    };
}

function rendererBaseline(baseline) {
    return { groups: baseline.groups, stats: baseline.stats, tier3Count: baseline.tier3Candidates.length };
}

function rendererSong(song) {
    const counts = {};
    for (const file of song.files) counts[file.stemPart ? 'stems' : file.type] = (counts[file.stemPart ? 'stems' : file.type] || 0) + 1;
    return {
        key: song.proposalId,
        name: song.songName,
        kind: song.kind,
        band: song.band,
        confidence: song.confidence,
        precheck: song.precheck,
        unsure: song.band !== 'sure',
        namespace: song.namespace,
        counts,
        countsLine: ['bounces', 'projects', 'stems', 'videos'].filter((type) => counts[type]).map((type) => plural(counts[type], type)).join(' · '),
        fileIds: song.files.map((file) => file.fileId),
        versions: song.versions,
        stemSets: song.stemSets.map((set) => ({ label: set.label, matchesFileId: set.matchesFileId || null, fileIds: set.files.map((file) => file.fileId) })),
        reasons: song.reasons.map((reason) => reason.text),
        possibleMatches: song.possibleMatches,
        facts: song.facts || {},
        existingSongId: song.existingSongId || null
    };
}

function toRendererView(result, roots) {
    const { catalog } = result;
    const files = [...catalog.unassigned, ...catalog.songs.flatMap((song) => song.files)];
    return {
        scanId: result.scanId,
        roots: roots.map((root) => ({ id: root.id, name: root.name })),
        contractVersion: catalog.contractVersion,
        engineVersion: catalog.engineVersion,
        policyVersion: catalog.policyVersion,
        stats: catalog.stats,
        notes: {
            folders: result.notes.folders,
            symlinksSkipped: result.notes.symlinksSkipped,
            unreadableFolders: result.notes.unreadableFolders,
            typeCounts: result.notes.typeCounts,
            placeholdersFound: result.notes.placeholdersFound,
            reusedFromStore: result.notes.reusedFromStore,
            projectsRead: result.notes.projectsRead || 0,
            links: result.notes.links || 0,
            contributors: result.notes.learned?.contributors || [],
            baselineLog: result.notes.baselineLog
        },
        files: files.map(rendererFile),
        songs: catalog.songs.map(rendererSong),
        duplicates: catalog.duplicates.length,
        otherFiles: catalog.unassigned.length,
        baselines: {
            preserve: rendererBaseline(catalog.baseline),
            strip: rendererBaseline(catalog.baselineStripPrefixes || result.baselineStripNamespaces)
        }
    };
}

module.exports = { toRendererView };
