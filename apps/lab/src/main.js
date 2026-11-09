'use strict';

// Importer Lab — Electron main process. Read-only: the file-system guard is installed before
// anything else, the renderer never sees an absolute path, and the window cannot reach the network.
// The only network call is the optional AI pass, made by the scan worker (M4).
// Runs with no environment variables; IMPORTER_LAB_DATA only overrides the data folder for tests.

const { app, BrowserWindow, ipcMain, dialog, protocol, net, session, shell, Menu, safeStorage } = require('electron');
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
const check = require('./check');
const rulesStore = require('./rules');
const history = require('./history');
const { buildResults, writeResults } = require('./export');
const { loadExistingSongs } = require('./existing-songs');
const { PINNED_COMMIT, ENGINE_VERSION, AI_MODELS } = require('../../../packages/import-engine/src');
const aiKey = require('./ai-key');

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

// The repository's .env is read only in development; a packaged app never looks outside its data folder.
function findAiKey() {
    return aiKey.findKey({ dataDir: DATA_DIR, devRoot: app.isPackaged ? null : path.join(__dirname, '..', '..', '..'), safeStorage });
}

function publicSettings() {
    const snapshot = settings.existingSongsSnapshot;
    return {
        showLabTools: settings.showLabTools,
        scanOptions: settings.scanOptions,
        ai: { ...settings.ai, models: AI_MODELS, key: aiKey.keyStatus(findAiKey()) },
        existingSongs: snapshot ? { count: snapshot.count, loadedAt: snapshot.loadedAt } : null
    };
}

// The snapshot is re-read on every scan; if it has become empty or unreadable the scan stops
// with that message rather than matching against nothing.
function existingSongsForScan() {
    const snapshot = settings.existingSongsSnapshot;
    return snapshot ? loadExistingSongs(snapshot.path) : [];
}

// A new scan replaces one still running: the old one is cancelled and finishes first.
// The producer's rules: prefix answers, plus every mark (from every catalog's labels) as a rule.
function userRulesForScan() {
    const marks = [];
    try {
        for (const name of fs.readdirSync(path.join(DATA_DIR, 'labels'))) {
            if (name.endsWith('.json')) marks.push(...labels.loadLabels(DATA_DIR, name.replace(/\.json$/, '')).marks);
        }
    } catch {
        /* no labels yet */
    }
    const views = new Map();
    const filesOf = (scanId, songName) => {
        if (!scanId) return null;
        if (!views.has(scanId)) {
            try {
                views.set(scanId, history.openScan(DATA_DIR, scanId).view);
            } catch {
                views.set(scanId, null);
            }
        }
        const view = views.get(scanId);
        const song = view && view.songs.find((candidate) => candidate.name === songName);
        if (!song) return null;
        const byId = new Map(view.files.map((file) => [file.fileId, file.name]));
        return song.fileIds.map((id) => byId.get(id)).filter(Boolean);
    };
    return rulesStore.buildUserRules(DATA_DIR, marks, filesOf);
}

async function startScanning({ fromScratch = false } = {}) {
    if (currentScan) {
        currentScan.cancel();
        await currentScan.promise.catch(() => {});
    }
    const roots = chosenRoots();
    if (roots.length === 0) throw new Error('Tick at least one folder');
    const request = {
        roots: roots.map((root) => root.path),
        options: {
            followSymlinks: false,
            includeCloudPlaceholders: settings.scanOptions.includeCloudPlaceholders === 'skip' ? 'skip' : 'list',
            ai: settings.ai.enabled
                ? { enabled: true, maxCostUsd: settings.ai.maxCostUsd, model: settings.ai.model, ...(settings.ai.largeModel ? { largeModel: settings.ai.largeModel } : {}) }
                : { enabled: false, maxCostUsd: 0, model: '' },
            mergeRule: settings.scanOptions.mergeRule === 'multi-clue' ? 'multi-clue' : 'exact-identity-only',
            identityPolicyVersion: `app-${PINNED_COMMIT.slice(0, 8)}`,
            groupEdits: settings.scanOptions.groupEdits !== false,
            catalogRules: { courseNamespaces: settings.scanOptions.courseNamespaces || [], declinedCoursePrefixes: settings.scanOptions.declinedCoursePrefixes || [] }
        },
        existingSongs: existingSongsForScan()
    };
    request.options.userRules = userRulesForScan();
    const key = settings.ai.enabled ? findAiKey().key : null;
    if (settings.ai.enabled && !key) throw new Error('The AI pass is on but there is no AI key. Add one in Lab → Options, or switch AI off.');
    const catalogId = labels.catalogId(request.roots);
    const scan = startScan({
        request,
        dataDir: DATA_DIR,
        excludePaths: [DATA_DIR, app.getPath('userData')],
        fromScratch,
        aiKey: key,
        onProgress: (progress) => send('lab:scan-progress', progress)
    });
    currentScan = scan;
    scan.promise
        .then((result) => {
            if (result.cancelled) return send('lab:scan-cancelled', null);
            const view = toRendererView(result, roots);
            last = { view, catalogId, scanId: result.scanId };
            history.saveScan(DATA_DIR, { view, catalogId });
            send('lab:scan-done', { view, marks: labels.loadLabels(DATA_DIR, catalogId).marks });
        })
        .catch((error) => send('lab:scan-failed', error.message))
        .finally(() => {
            if (currentScan === scan) currentScan = null;
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
        else if (key === 'groupEdits') updateSettings({ scanOptions: { ...settings.scanOptions, groupEdits: value === true } });
        else if (key === 'courseNamespaces')
            updateSettings({ scanOptions: { ...settings.scanOptions, courseNamespaces: String(value).split(',').map((item) => item.trim().toLowerCase()).filter(Boolean).slice(0, 50) } });
        else if (key === 'declinedCoursePrefixes')
            updateSettings({ scanOptions: { ...settings.scanOptions, declinedCoursePrefixes: (Array.isArray(value) ? value : []).map((item) => String(item).trim().toLowerCase()).filter(Boolean).slice(0, 100) } });
        else if (key === 'aiEnabled') updateSettings({ ai: { ...settings.ai, enabled: value === true } });
        else if (key === 'aiMaxCostUsd') {
            const cap = Number(value);
            if (!(Number.isFinite(cap) && cap >= 0 && cap <= 20)) throw new Error('The cost cap is between $0 and $20 per run');
            updateSettings({ ai: { ...settings.ai, maxCostUsd: Math.round(cap * 100) / 100 } });
        } else if (key === 'aiModel' && AI_MODELS.includes(value)) updateSettings({ ai: { ...settings.ai, model: value } });
        else if (key === 'aiLargeModel' && (value === '' || AI_MODELS.includes(value))) updateSettings({ ai: { ...settings.ai, largeModel: value } });
        else throw new Error(`Unknown setting: ${key}`);
        buildMenu();
        return publicSettings();
    });

    // The AI key: saved encrypted in the data folder; the renderer only learns whether one is set.
    ipcMain.handle('lab:save-ai-key', (_event, key) => {
        aiKey.saveKey(DATA_DIR, key, safeStorage);
        return publicSettings();
    });
    ipcMain.handle('lab:remove-ai-key', () => {
        aiKey.removeKey(DATA_DIR);
        return publicSettings();
    });

    ipcMain.handle('lab:load-existing-songs', async () => {
        const choice = await dialog.showOpenDialog(window, { title: 'Choose an existing-songs snapshot (.json)', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
        if (choice.canceled || !choice.filePaths[0]) return publicSettings();
        const songs = loadExistingSongs(choice.filePaths[0]); // throws loudly when empty or malformed
        updateSettings({ existingSongsSnapshot: { path: choice.filePaths[0], count: songs.length, loadedAt: new Date().toISOString() } });
        return publicSettings();
    });
    ipcMain.handle('lab:clear-existing-songs', () => {
        updateSettings({ existingSongsSnapshot: null });
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

    ipcMain.handle('lab:start-scan', (_event, options = {}) => startScanning({ fromScratch: options?.fromScratch === true }));
    ipcMain.handle('lab:list-scans', () => history.listScans(DATA_DIR));
    ipcMain.handle('lab:open-scan', (_event, scanId) => {
        const record = history.openScan(DATA_DIR, scanId);
        last = { view: record.view, catalogId: record.catalogId, scanId: record.scanId };
        return { view: record.view, marks: labels.loadLabels(DATA_DIR, record.catalogId).marks };
    });
    ipcMain.handle('lab:delete-scan', (_event, scanId) => {
        history.deleteScan(DATA_DIR, scanId);
        if (last && last.scanId === scanId) last = null;
        return history.listScans(DATA_DIR);
    });
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

    // "Check songs": a weighted sample of songs not checked yet, and the confidence so far.
    ipcMain.handle('lab:check-sample', (_event, size) => {
        if (!last) throw new Error('Scan first');
        const checked = new Set(labels.loadLabels(DATA_DIR, last.catalogId).marks.filter((mark) => mark.check).map((mark) => mark.songName));
        const exclude = last.view.songs.filter((song) => checked.has(song.name)).map((song) => song.key);
        return check.drawSample(last.view.songs, { exclude, size: check.CHECK_SIZES.includes(size) ? size : check.SESSION_SIZE });
    });

    // "Your corrections": marks from every catalog that change the result, each with Undo.
    ipcMain.handle('lab:list-corrections', () => labels.listCorrections(DATA_DIR));
    ipcMain.handle('lab:remove-correction', (_event, catalogId, markId) => {
        if (!/^[0-9a-z-]{1,64}$/i.test(String(catalogId))) throw new Error('Unknown catalog');
        labels.removeMark(DATA_DIR, String(catalogId), String(markId));
        return true;
    });
    ipcMain.handle('lab:check-summary', () => (last ? check.summarize(labels.loadLabels(DATA_DIR, last.catalogId).marks) : check.summarize([])));

    // Teach the importer: prefix answers and the rules from marks.
    ipcMain.handle('lab:get-rules', () => {
        const saved = rulesStore.loadRules(DATA_DIR);
        const fromMarks = userRulesForScan();
        return {
            prefixes: saved.prefixes,
            useMarks: saved.useMarks,
            fromMarks: { together: fromMarks.together.length, apart: fromMarks.apart.length, remove: fromMarks.remove.length, names: fromMarks.names.length },
            aiAnswers: { notSame: saved.notSame.length, answered: saved.skippedQuestions.length }
        };
    });
    // Answers to the AI's questions: { questionId: 'same' | 'different' | 'skip' | role }.
    ipcMain.handle('lab:answer-ai-questions', (_event, answers) => {
        if (!last) throw new Error('Scan first');
        const questions = (last.view.notes.ai && last.view.notes.ai.questions) || [];
        for (const [id, answer] of Object.entries(answers || {})) {
            const question = questions.find((candidate) => candidate.id === id);
            if (!question) continue;
            if (answer === 'same' && question.kind === 'same-song') {
                const mark = labels.addMark(DATA_DIR, last.catalogId, { kind: 'merge', target: 'song', songName: question.songName, fileNames: question.songFiles }, markContext());
                labels.updateMark(DATA_DIR, last.catalogId, mark.id, { mergeWithSongName: question.otherName, mergeWithFileNames: question.otherFiles });
            }
            rulesStore.answerAiQuestion(DATA_DIR, question, String(answer));
        }
        return labels.loadLabels(DATA_DIR, last.catalogId).marks;
    });
    ipcMain.handle('lab:forget-ai-questions', () => {
        rulesStore.forgetAiQuestions(DATA_DIR);
        return true;
    });
    ipcMain.handle('lab:answer-prefixes', (_event, answers) => rulesStore.answerPrefixes(DATA_DIR, answers).prefixes);
    ipcMain.handle('lab:set-use-marks', (_event, useMarks) => rulesStore.setUseMarks(DATA_DIR, useMarks).useMarks);

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
            : []),
        {
            label: 'File',
            submenu: [
                { label: 'New Scan', accelerator: 'CmdOrCtrl+N', click: () => send('lab:new-scan') },
                { label: 'Open Previous Results…', accelerator: 'CmdOrCtrl+O', click: () => send('lab:open-previous') },
                ...(process.platform === 'darwin'
                    ? [{ type: 'separator' }, { role: 'close' }]
                    : [{ type: 'separator' }, { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => send('lab:open-settings') }, { role: 'quit' }])
            ]
        },
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
    // The window never reaches the network. The optional AI pass runs in the scan worker (Node), not here.
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
