'use strict';

// What the renderer may see. Absolute paths never leave the main process (IMP-FN-032-R3):
// files are shown by sourceRelativePath, roots by folder name and an opaque id.
//
// Songs (until M2): today's importer's groups (keep-prefixes mode). A song is "unsure" when the
// grouping itself is in doubt: today's importer flagged it for review, its files do not all clean to
// the same name, or today's importer's two modes disagree about which files belong to it.
// (A guessed file type is shown on the file, not as doubt about the song.)
// M2 replaces this with the engine's bands (sure / unsure / unclear) and clue-based reasons.

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
        confidence: file.confidence,
        classifierReason: file.classifierReason,
        canonicalIdentity: file.canonicalIdentity,
        needsReview: file.needsReview,
        cloudPlaceholder: file.cloudPlaceholder
    };
}

function rendererBaseline(baseline) {
    return { groups: baseline.groups, stats: baseline.stats, tier3Count: baseline.tier3Candidates.length };
}

// Stems are read by today's grouper as dependents of a bounce, with a pattern it does not export,
// so names are compared on bounces, projects and videos only (stems only when there is nothing else).
function anchorIdentities(files) {
    const anchors = files.filter((file) => file.type !== 'stems');
    return [...new Set((anchors.length ? anchors : files).map((file) => file.canonicalIdentity).filter(Boolean))];
}

// True when the strip-prefixes mode splits these files up or adds other files to them.
function modesDisagree(fileIds, stripGroupByFile) {
    const stripGroups = new Set(fileIds.map((id) => stripGroupByFile.get(id)));
    if (stripGroups.size !== 1) return true;
    const [stripGroup] = stripGroups;
    return stripGroup.fileIds.length !== fileIds.length;
}

function songReasons(files, ambiguous, disagree) {
    const identities = anchorIdentities(files);
    const reasons = [];
    if (files.length === 1) {
        reasons.push(`Only one file has this name (“${identities[0] || files[0].name}”).`);
    } else if (identities.length === 1) {
        reasons.push(`The bounces and projects have the same name once version words, dates and mix notes are set aside: “${identities[0]}”.`);
    } else {
        reasons.push(`These files do not all have the same name (${identities.map((identity) => `“${identity}”`).join(', ')}), so this needs a check.`);
    }
    const stems = files.filter((file) => file.type === 'stems').length;
    if (stems && stems < files.length) reasons.push(`${stems === 1 ? 'The stem is' : `The ${stems} stems are`} named after this song.`);
    if (disagree) reasons.push("Today's importer groups these files differently when it ignores name prefixes such as collaborator names, so this needs a check.");
    if (ambiguous) reasons.push("The song name could not be told apart from the rest of the file name, so this needs a check.");
    const guessed = files.filter((file) => file.needsReview);
    if (guessed.length) reasons.push(`The type of ${guessed.length === 1 ? 'one file is' : `${guessed.length} files is`} a guess from the name alone.`);
    const cloud = files.filter((file) => file.cloudPlaceholder);
    if (cloud.length) reasons.push(`${cloud.length === 1 ? 'One file is' : `${cloud.length} files are`} online-only in the cloud: listed, never opened or downloaded.`);
    return reasons;
}

function buildSongs(files, baseline, stripBaseline) {
    const filesById = new Map(files.map((file) => [file.fileId, file]));
    const stripGroupByFile = new Map(stripBaseline.groups.flatMap((group) => group.fileIds.map((id) => [id, group])));
    const reviewIds = new Set(baseline.reviewItems.map((item) => item.fileId));
    return baseline.groups.map((group) => {
        const songFiles = group.fileIds.map((id) => filesById.get(id));
        const ambiguous = songFiles.some((file) => reviewIds.has(file.fileId));
        const identities = anchorIdentities(songFiles);
        const disagree = modesDisagree(group.fileIds, stripGroupByFile);
        const counts = {};
        for (const file of songFiles) counts[file.type] = (counts[file.type] || 0) + 1;
        return {
            key: group.songName,
            name: group.songName,
            unsure: ambiguous || identities.length > 1 || disagree,
            counts,
            countsLine: ['bounces', 'projects', 'stems', 'videos'].filter((type) => counts[type]).map((type) => plural(counts[type], type)).join(' · '),
            fileIds: group.fileIds,
            reasons: songReasons(songFiles, ambiguous, disagree)
        };
    });
}

function toRendererView(result, roots) {
    const { catalog } = result;
    const files = [...catalog.unassigned, ...catalog.songs.flatMap((song) => song.files)];
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
            reusedFromStore: result.notes.reusedFromStore,
            baselineLog: result.notes.baselineLog
        },
        files: files.map(rendererFile),
        songs: buildSongs(files, catalog.baseline, result.baselineStripNamespaces),
        otherFiles: files.filter((file) => file.type === 'unknown').length,
        baselines: {
            preserve: rendererBaseline(catalog.baseline),
            strip: rendererBaseline(result.baselineStripNamespaces)
        }
    };
}

module.exports = { toRendererView, buildSongs };
