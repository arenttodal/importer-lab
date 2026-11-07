'use strict';

// The guard patches this test process's fs, so each case installs and uninstalls it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installFsGuard, uninstallFsGuard, isWriteFlag } = require('../src/fs-guard');
const { tempDir, snapshotTree } = require('./helpers');

function setup(t) {
    t.after(uninstallFsGuard); // registered first so it runs before the temp folders are removed
    const scanned = tempDir(t, 'lab-scanned-');
    const data = tempDir(t, 'lab-data-');
    fs.writeFileSync(path.join(scanned, 'Sky.wav'), 'audio');
    fs.mkdirSync(path.join(scanned, 'Stems'));
    const before = snapshotTree(scanned);
    const guard = installFsGuard({ allowedRoots: [data] });
    return { scanned, data, before, guard, file: path.join(scanned, 'Sky.wav') };
}

const BLOCKED_SYNC = [
    ['writeFileSync', (s, f) => fs.writeFileSync(f, 'x')],
    ['appendFileSync', (s, f) => fs.appendFileSync(f, 'x')],
    ['renameSync', (s, f) => fs.renameSync(f, path.join(s, 'Sky renamed.wav'))],
    ['unlinkSync', (s, f) => fs.unlinkSync(f)],
    ['rmSync', (s) => fs.rmSync(path.join(s, 'Stems'), { recursive: true })],
    ['rmdirSync', (s) => fs.rmdirSync(path.join(s, 'Stems'))],
    ['mkdirSync', (s) => fs.mkdirSync(path.join(s, 'New'))],
    ['copyFileSync', (s, f) => fs.copyFileSync(f, path.join(s, 'copy.wav'))],
    ['cpSync', (s, f) => fs.cpSync(f, path.join(s, 'cp.wav'))],
    ['symlinkSync', (s, f) => fs.symlinkSync(f, path.join(s, 'alias.wav'))],
    ['linkSync', (s, f) => fs.linkSync(f, path.join(s, 'hard.wav'))],
    ['truncateSync', (s, f) => fs.truncateSync(f, 0)],
    ['chmodSync', (s, f) => fs.chmodSync(f, 0o777)],
    ['utimesSync', (s, f) => fs.utimesSync(f, new Date(0), new Date(0))],
    ['openSync for writing', (s, f) => fs.openSync(f, 'r+')],
    ['openSync with numeric flags', (s, f) => fs.openSync(f, fs.constants.O_WRONLY)],
    ['createWriteStream', (s, f) => fs.createWriteStream(f)],
    ['writeFile (callback)', (s, f) => fs.writeFile(f, 'x', () => {})],
    ['rename (callback)', (s, f) => fs.rename(f, path.join(s, 'b.wav'), () => {})],
    ['unlink (callback)', (s, f) => fs.unlink(f, () => {})]
];

for (const [name, attempt] of BLOCKED_SYNC) {
    test(`blocked in a scanned folder: ${name}`, (t) => {
        const { scanned, file, before, guard } = setup(t);
        assert.throws(() => attempt(scanned, file), { code: 'E_LAB_READ_ONLY' });
        assert.ok(guard.violations.length > 0);
        assert.deepEqual(snapshotTree(scanned), before);
    });
}

const BLOCKED_PROMISES = [
    ['promises.writeFile', (s, f) => fs.promises.writeFile(f, 'x')],
    ['promises.rename', (s, f) => fs.promises.rename(f, path.join(s, 'b.wav'))],
    ['promises.unlink', (s, f) => fs.promises.unlink(f)],
    ['promises.rm', (s) => fs.promises.rm(path.join(s, 'Stems'), { recursive: true })],
    ['promises.open for appending', (s, f) => fs.promises.open(f, 'a')],
    ['fs/promises module', (s, f) => require('node:fs/promises').writeFile(f, 'x')]
];

for (const [name, attempt] of BLOCKED_PROMISES) {
    test(`blocked in a scanned folder: ${name}`, async (t) => {
        const { scanned, file, before } = setup(t);
        await assert.rejects(attempt(scanned, file), { code: 'E_LAB_READ_ONLY' });
        assert.deepEqual(snapshotTree(scanned), before);
    });
}

test('moving a file out of a scanned folder into the data folder is blocked too', (t) => {
    const { data, file, scanned, before } = setup(t);
    assert.throws(() => fs.renameSync(file, path.join(data, 'stolen.wav')), { code: 'E_LAB_READ_ONLY' });
    assert.deepEqual(snapshotTree(scanned), before);
});

test('reading is allowed everywhere; writing is allowed inside the data folder', async (t) => {
    const { data, file } = setup(t);
    assert.equal(fs.readFileSync(file, 'utf8'), 'audio');
    const handle = fs.openSync(file, 'r');
    fs.closeSync(handle);
    fs.mkdirSync(path.join(data, 'cache'));
    fs.writeFileSync(path.join(data, 'cache', 'x.json'), '{}');
    await fs.promises.writeFile(path.join(data, 'y.json'), '{}');
    fs.renameSync(path.join(data, 'y.json'), path.join(data, 'z.json'));
    fs.rmSync(path.join(data, 'cache'), { recursive: true });
    assert.deepEqual(fs.readdirSync(data), ['z.json']);
});

test('a lookalike sibling of the data folder is not inside it', (t) => {
    const { data } = setup(t);
    assert.throws(() => fs.writeFileSync(`${data}-evil`, 'x'), { code: 'E_LAB_READ_ONLY' });
});

test('write flags are recognised', () => {
    for (const flags of ['w', 'wx', 'a', 'a+', 'r+', 'w+', fs.constants.O_RDWR, fs.constants.O_CREAT]) assert.equal(isWriteFlag(flags), true);
    for (const flags of ['r', undefined, fs.constants.O_RDONLY]) assert.equal(isWriteFlag(flags), false);
});
