'use strict';

// Streaming crawler (SPEC step 1). No depth limit, no file cap, symlinks never followed.
// Reads directory listings and file metadata only — never file contents.
// What counts as one item (skipped names, DAW project folders kept whole) comes from the app's
// walkFolder rules through adapters/walker.js.

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { isSkippableName, extensionOf, sourceCategoryForFolder, projectCandidateForFolder } = require('./adapters/walker');

function shortHash(value) {
    return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function isInside(child, parent) {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function lstatOrNull(fullPath) {
    try {
        return await fs.lstat(fullPath, { bigint: true });
    } catch {
        return null;
    }
}

function makeItem(root, fullPath, stat, fields) {
    const relative = path.relative(root.rootPath, fullPath).split(path.sep).join('/');
    const dev = stat ? String(stat.dev) : '0';
    return {
        fileId: shortHash(`${dev}\u0000${fullPath}`),
        path: fullPath,
        rootId: root.rootId,
        sourceRelativePath: relative ? `${root.rootName}/${relative}` : root.rootName,
        sourceContainerId: shortHash(`container\u0000${path.dirname(fullPath)}`),
        name: path.basename(fullPath),
        dev,
        ino: stat ? String(stat.ino) : '0',
        size: stat && fields.type === 'file' ? Number(stat.size) : 0,
        blocks: stat ? Number(stat.blocks) : 0,
        mtimeMs: stat ? Number(stat.mtimeMs) : 0,
        birthtimeMs: stat ? Number(stat.birthtimeMs) : 0,
        sourceCategory: null,
        folderContents: null,
        ...fields
    };
}

async function projectItem(root, candidate, sourceCategory) {
    const stat = await lstatOrNull(candidate.path);
    return makeItem(root, candidate.path, stat, {
        type: 'folder',
        extension: candidate.extension || '',
        sourceCategory,
        folderContents: candidate.folderContents || null
    });
}

async function describeRoot(rootInput) {
    const rootPath = await fs.realpath(rootInput);
    const stat = await fs.stat(rootPath);
    if (!stat.isDirectory()) throw new Error(`Not a folder: ${path.basename(rootInput)}`);
    return { rootPath, rootName: path.basename(rootPath) || rootPath, rootId: shortHash(`root\u0000${rootPath}`) };
}

// Yields one item per file or atomic project folder. `counters` is updated as it goes.
async function* crawl(roots, { counters = {}, isCancelled = () => false, excludePaths = [] } = {}) {
    counters.folders = counters.folders || 0;
    counters.symlinksSkipped = counters.symlinksSkipped || 0;
    counters.unreadableFolders = counters.unreadableFolders || 0;
    counters.excludedFolders = counters.excludedFolders || 0;

    for (const rootInput of roots) {
        const root = await describeRoot(rootInput);
        const rootCategory = sourceCategoryForFolder(root.rootName);

        const rootProject = await projectCandidateForFolder(root.rootPath);
        if (rootProject) {
            yield await projectItem(root, rootProject, rootCategory);
            continue;
        }

        const stack = [{ folder: root.rootPath, category: rootCategory }];
        while (stack.length > 0) {
            if (isCancelled()) return;
            const { folder, category } = stack.pop();
            counters.folders += 1;

            let entries;
            try {
                entries = await fs.readdir(folder, { withFileTypes: true });
            } catch {
                counters.unreadableFolders += 1;
                continue;
            }
            entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

            const subfolders = [];
            for (const entry of entries) {
                if (isSkippableName(entry.name)) continue;
                const fullPath = path.join(folder, entry.name);
                if (entry.isSymbolicLink()) {
                    counters.symlinksSkipped += 1;
                    continue;
                }
                if (entry.isDirectory()) {
                    if (excludePaths.some((excluded) => isInside(fullPath, excluded))) {
                        counters.excludedFolders += 1;
                        continue;
                    }
                    const childCategory = sourceCategoryForFolder(entry.name, category);
                    const project = await projectCandidateForFolder(fullPath);
                    if (project) yield await projectItem(root, project, childCategory);
                    else subfolders.push({ folder: fullPath, category: childCategory });
                    continue;
                }
                if (!entry.isFile()) continue;
                const stat = await lstatOrNull(fullPath);
                if (!stat || !stat.isFile()) continue;
                yield makeItem(root, fullPath, stat, {
                    type: 'file',
                    extension: extensionOf(entry.name),
                    sourceCategory: category
                });
            }
            // Reverse so the alphabetically first folder is visited first.
            for (let index = subfolders.length - 1; index >= 0; index -= 1) stack.push(subfolders[index]);
        }
    }
}

module.exports = { crawl, describeRoot, shortHash };
