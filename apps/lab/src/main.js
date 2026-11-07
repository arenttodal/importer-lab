'use strict';

// Importer Lab — Electron main process. Read-only: the file-system guard is installed before
// anything else, the renderer never sees an absolute path, and the window cannot reach the network.
// Runs with no environment variables; IMPORTER_LAB_DATA only overrides the data folder for tests.

const { app, BrowserWindow, ipcMain, dialog, protocol, net, session, shell, Menu } = require('electron');
const path = require('node:path');

const DATA_DIR = process.env.IMPORTER_LAB_DATA ? path.resolve(process.env.IMPORTER_LAB_DATA) : path.join(app.getPath('userData'), 'lab-data');

const { installFsGuard } = require('./fs-guard');
installFsGuard({ allowedRoots: [DATA_DIR] });

const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { startScan } = require('./run-scan');
const { toRendererView } = require('./view');
const { loadSettings, saveSettings } = require('./settings');
const { listFolders, publicFolders } = require('./folders');
const labels = require('./labels');
const { buildResults, writeResults } = require('./export');
const { PINNED_COMMIT, ENGINE_VERSION } = require('../../../packages/import-engine/src');

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const APP_PUBLIC_DIR = path.join(__dirname, '..', '..', '..', 'vendor', 'the-library', 'public');
const PRIVACY_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders';

fs.mkdirSync(DATA_DIR, { recursive: true });

protocol.registerSchemesAsPrivileged([{ scheme: 'lab', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let settings = loadSettings(DATA_DIR);
let window = null;
let currentScan = null;
let last = null; // { view, catalogId, scanId }
let blockedRequests = 0;

function isInside(child, parent) {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function folders() {
    return listFolders(settings);
}

function updateSettings(changes) {
    settings = { ...settings, ...changes };
    saveSettings(DATA_DIR, settings);
    return settings;
}

function addFolder(folderPath) {
    let realPath;
    try {
        realPath = fs.realpathSync(folderPath);
        if (!fs.statSync(realPath).isDirectory()) return;
    } catch {
        return;
    }
    if (isInside(realPath, DATA_DIR)) return;
    const addedFolders = settings.addedFolders.includes(realPath) ? settings.addedFolders : [...settings.addedFolders, realPath];
    updateSettings({ addedFolders, checked: { ...settings.checked, [realPath]: true } });
}

// Ticked folders, minus any folder already inside another ticked one (no file is read twice).
function chosenRoots() {
    const ticked = folders().filter((folder) => folder.checked);
    return ticked.filter((folder) => !ticked.some((other) => other !== folder && isInside(folder.path, other.path)));
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

function appInfo() {
    return {
        labVersion: app.getVersion(),
        engineVersion: ENGINE_VERSION,
        pinnedCommit: PINNED_COMMIT,
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome,
        sqlite: process.versions.sqlite,
        platform: process.platform
    };
}

function publicSettings() {
    return { showLabTools: settings.showLabTools, scanOptions: settings.scanOptions };
}

function startScanning() {
    if (currentScan) throw new Error('A scan is already running');
    const roots = chosenRoots();
    if (roots.length === 0) throw new Error('Tick at least one folder');
    const request = {
        roots: roots.map((root) => root.path),
        options: {
            followSymlinks: false,
            includeCloudPlaceholders: settings.scanOptions.includeCloudPlaceholders === 'skip' ? 'skip' : 'list',
            ai: { enabled: false, maxCostUsd: 0, model: '' },
            mergeRule: settings.scanOptions.mergeRule === 'multi-clue' ? 'multi-clue' : 'exact-identity-only',
            identityPolicyVersion: `app-${PINNED_COMMIT.slice(0, 8)}`
        }
    };
    const catalogId = labels.catalogId(request.roots);
    currentScan = startScan({
        request,
        dataDir: DATA_DIR,
        excludePaths: [DATA_DIR, app.getPath('userData')],
        onProgress: (progress) => send('lab:scan-progress', progress)
    });
    currentScan.promise
        .then((result) => {
            if (result.cancelled) return send('lab:scan-cancelled', null);
            const view = toRendererView(result, roots);
            last = { view, catalogId, scanId: result.scanId };
            send('lab:scan-done', { view, marks: labels.loadLabels(DATA_DIR, catalogId).marks });
        })
        .catch((error) => send('lab:scan-failed', error.message))
        .finally(() => {
            currentScan = null;
        });
    return true;
}

function markContext() {
    if (!last) throw new Error('Scan first');
    return { scanId: last.scanId, engineVersion: ENGINE_VERSION };
}

function registerIpc() {
    ipcMain.handle('lab:get-info', () => ({ ...appInfo(), blockedRequests }));
    ipcMain.handle('lab:get-settings', () => publicSettings());
    ipcMain.handle('lab:set-setting', (_event, key, value) => {
        if (key === 'showLabTools') updateSettings({ showLabTools: value === true });
        else if (key === 'mergeRule') updateSettings({ scanOptions: { ...settings.scanOptions, mergeRule: value === 'multi-clue' ? 'multi-clue' : 'exact-identity-only' } });
        else if (key === 'includeCloudPlaceholders') updateSettings({ scanOptions: { ...settings.scanOptions, includeCloudPlaceholders: value === 'skip' ? 'skip' : 'list' } });
        else throw new Error(`Unknown setting: ${key}`);
        buildMenu();
        return publicSettings();
    });

    ipcMain.handle('lab:list-folders', () => publicFolders(folders()));
    ipcMain.handle('lab:set-folder-checked', (_event, id, checked) => {
        const folder = folders().find((candidate) => candidate.id === id);
        if (folder) updateSettings({ checked: { ...settings.checked, [folder.path]: checked === true } });
        return publicFolders(folders());
    });
    ipcMain.handle('lab:add-folders', async () => {
        const choice = await dialog.showOpenDialog(window, { title: 'Add a folder or drive', buttonLabel: 'Add', properties: ['openDirectory', 'multiSelections'] });
        for (const folderPath of choice.canceled ? [] : choice.filePaths) addFolder(folderPath);
        return publicFolders(folders());
    });
    // Paths of dropped folders come from the preload (webUtils.getPathForFile); the page never sees them.
    ipcMain.handle('lab:add-dropped', (_event, paths) => {
        for (const folderPath of Array.isArray(paths) ? paths : []) if (typeof folderPath === 'string') addFolder(folderPath);
        return publicFolders(folders());
    });
    ipcMain.handle('lab:remove-folder', (_event, id) => {
        const folder = folders().find((candidate) => candidate.id === id && candidate.kind === 'added');
        if (folder) updateSettings({ addedFolders: settings.addedFolders.filter((added) => added !== folder.path) });
        return publicFolders(folders());
    });
    ipcMain.handle('lab:needs-permission-notice', () => !settings.permissionExplained && chosenRoots().some((root) => root.protected));
    ipcMain.handle('lab:permission-explained', () => {
        updateSettings({ permissionExplained: true });
        return true;
    });
    ipcMain.handle('lab:open-privacy-settings', () => (process.platform === 'darwin' ? shell.openExternal(PRIVACY_SETTINGS_URL) : false));

    ipcMain.handle('lab:start-scan', () => startScanning());
    ipcMain.handle('lab:cancel-scan', () => {
        if (currentScan) currentScan.cancel();
        return true;
    });

    ipcMain.handle('lab:add-mark', (_event, input) => {
        const context = markContext();
        return labels.addMark(DATA_DIR, last.catalogId, input, context);
    });
    ipcMain.handle('lab:update-mark', (_event, markId, changes) => {
        markContext();
        return labels.updateMark(DATA_DIR, last.catalogId, markId, changes);
    });
    ipcMain.handle('lab:remove-mark', (_event, markId) => {
        markContext();
        labels.removeMark(DATA_DIR, last.catalogId, markId);
        return true;
    });

    ipcMain.handle('lab:export-results', () => {
        if (!last) throw new Error('Scan first');
        const file = writeResults(DATA_DIR, buildResults({ view: last.view, labels: labels.loadLabels(DATA_DIR, last.catalogId), app: appInfo() }));
        shell.showItemInFolder(file);
        return { fileName: path.basename(file) };
    });
}

// The Lab menu (compare, options, metrics, logs) exists only when switched on in Settings.
function buildMenu() {
    const openLab = (section) => () => send('lab:open-lab', section);
    const template = [
        ...(process.platform === 'darwin'
            ? [
                  {
                      role: 'appMenu',
                      submenu: [
                          { role: 'about' },
                          { type: 'separator' },
                          { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => send('lab:open-settings') },
                          { type: 'separator' },
                          { role: 'hide' },
                          { role: 'hideOthers' },
                          { role: 'unhide' },
                          { type: 'separator' },
                          { role: 'quit' }
                      ]
                  }
              ]
            : [{ label: 'File', submenu: [{ label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => send('lab:open-settings') }, { role: 'quit' }] }]),
        { role: 'editMenu' },
        ...(settings.showLabTools
            ? [
                  {
                      label: 'Lab',
                      submenu: [
                          { label: "Compare with today's importer", click: openLab('compare') },
                          { label: 'Scan options', click: openLab('options') },
                          { label: 'Metrics', click: openLab('metrics') },
                          { label: 'Logs', click: openLab('logs') }
                      ]
                  }
              ]
            : []),
        { role: 'windowMenu' }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
    window = new BrowserWindow({
        width: 1180,
        height: 820,
        minWidth: 900,
        minHeight: 600,
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
    registerIpc();
    buildMenu();
    createWindow();
});

app.on('window-all-closed', () => app.quit());
