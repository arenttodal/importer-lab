'use strict';

// Importer Lab — Electron main process. Read-only: the file-system guard is installed before
// anything else, the renderer never sees an absolute path, and the window cannot reach the network.

const { app, BrowserWindow, ipcMain, dialog, protocol, net, session } = require('electron');
const path = require('node:path');

const DATA_DIR = process.env.IMPORTER_LAB_DATA ? path.resolve(process.env.IMPORTER_LAB_DATA) : path.join(app.getPath('userData'), 'lab-data');

const { installFsGuard } = require('./fs-guard');
installFsGuard({ allowedRoots: [DATA_DIR] });

const fs = require('node:fs');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { startScan } = require('./run-scan');
const { toRendererView } = require('./view');
const { PINNED_COMMIT, ENGINE_VERSION } = require('@importer-lab/import-engine');

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const APP_PUBLIC_DIR = path.join(__dirname, '..', '..', '..', 'vendor', 'the-library', 'public');

fs.mkdirSync(DATA_DIR, { recursive: true });

protocol.registerSchemesAsPrivileged([{ scheme: 'lab', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const roots = new Map(); // id -> { id, name, path }; paths stay in this process
let window = null;
let currentScan = null;
let blockedRequests = 0;

function isInside(child, parent) {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function listRoots() {
    return [...roots.values()].map(({ id, name }) => ({ id, name }));
}

function addRoot(folderPath) {
    const realPath = fs.realpathSync(folderPath);
    if (isInside(realPath, DATA_DIR)) throw new Error('That folder is inside the lab data folder');
    const id = crypto.createHash('sha256').update(realPath).digest('hex').slice(0, 12);
    roots.set(id, { id, name: path.basename(realPath) || realPath, path: realPath });
}

// lab://app/lab/... serves the lab's own renderer; every other path serves the main app's
// public/ folder from the pinned submodule, so the app's stylesheets load unchanged.
function serveFile(request) {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    const isLabFile = pathname.startsWith('/lab/');
    const base = isLabFile ? RENDERER_DIR : APP_PUBLIC_DIR;
    const target = path.resolve(base, `.${isLabFile ? pathname.slice(4) : pathname}`);
    if (!isInside(target, base)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(target).toString());
}

function send(channel, payload) {
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
}

function registerIpc() {
    ipcMain.handle('lab:list-folders', () => listRoots());

    ipcMain.handle('lab:add-folders', async () => {
        const choice = await dialog.showOpenDialog(window, { title: 'Choose folders to scan (read-only)', properties: ['openDirectory', 'multiSelections'] });
        for (const folderPath of choice.canceled ? [] : choice.filePaths) addRoot(folderPath);
        return listRoots();
    });

    ipcMain.handle('lab:remove-folder', (_event, id) => {
        roots.delete(id);
        return listRoots();
    });

    ipcMain.handle('lab:start-scan', (_event, options) => {
        if (currentScan) throw new Error('A scan is already running');
        if (roots.size === 0) throw new Error('Choose at least one folder');
        const scannedRoots = [...roots.values()];
        const request = {
            roots: scannedRoots.map((root) => root.path),
            options: {
                followSymlinks: false,
                includeCloudPlaceholders: options.includeCloudPlaceholders === 'skip' ? 'skip' : 'list',
                ai: { enabled: false, maxCostUsd: Number(options.maxCostUsd) || 0, model: '' },
                mergeRule: options.mergeRule === 'multi-clue' ? 'multi-clue' : 'exact-identity-only',
                identityPolicyVersion: `app-${PINNED_COMMIT.slice(0, 8)}`
            }
        };
        currentScan = startScan({
            request,
            dataDir: DATA_DIR,
            excludePaths: [DATA_DIR, app.getPath('userData')],
            onProgress: (progress) => send('lab:scan-progress', progress)
        });
        currentScan.promise
            .then((result) => send(result.cancelled ? 'lab:scan-cancelled' : 'lab:scan-done', result.cancelled ? null : toRendererView(result, scannedRoots)))
            .catch((error) => send('lab:scan-failed', error.message))
            .finally(() => {
                currentScan = null;
            });
        return true;
    });

    ipcMain.handle('lab:cancel-scan', () => {
        if (currentScan) currentScan.cancel();
        return true;
    });

    ipcMain.handle('lab:get-info', () => ({
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome,
        sqlite: process.versions.sqlite,
        pinnedCommit: PINNED_COMMIT,
        engineVersion: ENGINE_VERSION,
        blockedRequests
    }));
}

function createWindow() {
    window = new BrowserWindow({
        width: 1280,
        height: 840,
        title: 'Importer Lab',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false
        }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.loadURL('lab://app/lab/index.html');
}

app.whenReady().then(() => {
    // No network: the lab makes no calls until the optional AI pass (M4).
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => {
        blockedRequests += 1;
        callback({ cancel: true });
    });
    protocol.handle('lab', serveFile);
    for (const folderPath of (process.env.IMPORTER_LAB_ROOTS || '').split(path.delimiter).filter(Boolean)) addRoot(folderPath);
    registerIpc();
    createWindow();
});

app.on('window-all-closed', () => app.quit());
