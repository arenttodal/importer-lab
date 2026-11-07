'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { crawl } = require('../src/crawl');
const { requireApp } = require('../src/adapters/vendor');
const { makeCatalog } = require('./helpers');

const { walkFolder } = requireApp('electron/external-folder-import.js');

async function collect(roots, options) {
    const items = [];
    for await (const item of crawl(roots, options)) items.push(item);
    return items;
}

function comparable(rootPath, candidate) {
    return JSON.stringify({
        path: path.relative(rootPath, candidate.path),
        type: candidate.type,
        extension: candidate.extension,
        sourceCategory: candidate.sourceCategory || null,
        folderContents: candidate.folderContents
            ? [...candidate.folderContents].map((entry) => `${entry.name}|${entry.extension}|${entry.isDir}`).sort()
            : null
    });
}

test('within walkFolder caps, the crawler yields exactly what the app walker yields', async (t) => {
    const { root } = makeCatalog(t, { deep: false });
    const realRoot = fs.realpathSync(root);
    const walked = await walkFolder(realRoot, { depth: 10, fileCap: 100000 });
    const crawled = await collect([root]);
    assert.equal(walked.truncated, false);
    assert.deepEqual(crawled.map((item) => comparable(realRoot, item)).sort(), walked.candidates.map((c) => comparable(realRoot, c)).sort());
});

test('there is no depth limit: a file 12 folders deep is found (walkFolder stops at 10)', async (t) => {
    const { root } = makeCatalog(t);
    const realRoot = fs.realpathSync(root);
    const crawled = await collect([root]);
    assert.ok(crawled.some((item) => item.name === 'Deep Song.wav'));
    const walked = await walkFolder(realRoot, { depth: 10, fileCap: 100000 });
    assert.ok(!walked.candidates.some((c) => path.basename(c.path) === 'Deep Song.wav'));
});

test('DAW project folders stay one item; symlinks and dotfiles are skipped', async (t) => {
    const { root } = makeCatalog(t);
    const counters = {};
    const crawled = await collect([root], { counters });
    const names = crawled.map((item) => item.name);
    assert.ok(names.includes('Sky Project'));
    assert.ok(names.includes('Night Drive.logicx'));
    assert.ok(!names.includes('Sky.als'), 'the .als inside a project folder is part of the folder item');
    assert.ok(!names.includes('ProjectData'));
    assert.ok(!names.includes('.DS_Store'));
    assert.ok(!names.includes('SKY alias.wav'));
    assert.equal(counters.symlinksSkipped, 1);
});

test('a root that is itself a project folder is one item (walkFolder root atomicity)', async (t) => {
    const { root } = makeCatalog(t);
    const crawled = await collect([path.join(root, 'Projects', 'Sky Project')]);
    assert.equal(crawled.length, 1);
    assert.equal(crawled[0].type, 'folder');
    assert.equal(crawled[0].sourceRelativePath, 'Sky Project');
});

test('sourceRelativePath starts at the root folder name; ids are stable across runs', async (t) => {
    const { root } = makeCatalog(t);
    const first = await collect([root]);
    const second = await collect([root]);
    const sky = first.find((item) => item.name === 'SKY.wav');
    assert.equal(sky.sourceRelativePath, 'catalog-a/Bounces/SKY.wav');
    assert.equal(sky.sourceCategory, 'bounce');
    assert.deepEqual(first.map((item) => item.fileId), second.map((item) => item.fileId));
});

test('excluded folders (the lab data folder) are not crawled', async (t) => {
    const { root } = makeCatalog(t);
    const counters = {};
    const crawled = await collect([root], { counters, excludePaths: [path.join(fs.realpathSync(root), 'Downloads')] });
    assert.ok(!crawled.some((item) => item.sourceRelativePath.startsWith('catalog-a/Downloads/')));
    assert.equal(counters.excludedFolders, 1);
});

test('cancel stops the crawl', async (t) => {
    const { root } = makeCatalog(t);
    const crawled = await collect([root], { isCancelled: () => true });
    assert.deepEqual(crawled, []);
});
