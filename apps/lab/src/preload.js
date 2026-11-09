'use strict';

// The only bridge between the screens and the main process. No file paths reach the page:
// dropped folders are turned into paths here and sent straight to the main process.

const { contextBridge, ipcRenderer, webUtils } = require('electron');

function subscribe(channel) {
    return (callback) => ipcRenderer.on(channel, (_event, payload) => callback(payload));
}

contextBridge.exposeInMainWorld('labAPI', {
    getInfo: () => ipcRenderer.invoke('lab:get-info'),
    getSettings: () => ipcRenderer.invoke('lab:get-settings'),
    setSetting: (key, value) => ipcRenderer.invoke('lab:set-setting', key, value),
    saveAiKey: (key) => ipcRenderer.invoke('lab:save-ai-key', key),
    removeAiKey: () => ipcRenderer.invoke('lab:remove-ai-key'),
    answerAiQuestions: (answers) => ipcRenderer.invoke('lab:answer-ai-questions', answers),
    forgetAiQuestions: () => ipcRenderer.invoke('lab:forget-ai-questions'),
    answerSampleQuestions: (answers) => ipcRenderer.invoke('lab:answer-sample-questions', answers),
    loadExistingSongs: () => ipcRenderer.invoke('lab:load-existing-songs'),
    clearExistingSongs: () => ipcRenderer.invoke('lab:clear-existing-songs'),

    listFolders: () => ipcRenderer.invoke('lab:list-folders'),
    setFolderChecked: (id, checked) => ipcRenderer.invoke('lab:set-folder-checked', id, checked),
    addFolders: () => ipcRenderer.invoke('lab:add-folders'),
    addDropped: (files) => ipcRenderer.invoke('lab:add-dropped', [...files].map((file) => webUtils.getPathForFile(file)).filter(Boolean)),
    removeFolder: (id) => ipcRenderer.invoke('lab:remove-folder', id),
    needsPermissionNotice: () => ipcRenderer.invoke('lab:needs-permission-notice'),
    permissionExplained: () => ipcRenderer.invoke('lab:permission-explained'),
    openPrivacySettings: () => ipcRenderer.invoke('lab:open-privacy-settings'),

    startScan: (options) => ipcRenderer.invoke('lab:start-scan', { fromScratch: options?.fromScratch === true }),
    listScans: () => ipcRenderer.invoke('lab:list-scans'),
    openScan: (scanId) => ipcRenderer.invoke('lab:open-scan', scanId),
    deleteScan: (scanId) => ipcRenderer.invoke('lab:delete-scan', scanId),
    cancelScan: () => ipcRenderer.invoke('lab:cancel-scan'),
    onScanProgress: subscribe('lab:scan-progress'),
    onScanDone: subscribe('lab:scan-done'),
    onScanCancelled: subscribe('lab:scan-cancelled'),
    onScanFailed: subscribe('lab:scan-failed'),

    addMark: (mark) => ipcRenderer.invoke('lab:add-mark', mark),
    updateMark: (markId, changes) => ipcRenderer.invoke('lab:update-mark', markId, changes),
    removeMark: (markId) => ipcRenderer.invoke('lab:remove-mark', markId),
    exportResults: () => ipcRenderer.invoke('lab:export-results'),
    checkSample: (size) => ipcRenderer.invoke('lab:check-sample', size),
    listCorrections: () => ipcRenderer.invoke('lab:list-corrections'),
    removeCorrection: (catalogId, markId) => ipcRenderer.invoke('lab:remove-correction', catalogId, markId),
    checkSummary: () => ipcRenderer.invoke('lab:check-summary'),
    getRules: () => ipcRenderer.invoke('lab:get-rules'),
    answerPrefixes: (answers) => ipcRenderer.invoke('lab:answer-prefixes', answers),
    setUseMarks: (useMarks) => ipcRenderer.invoke('lab:set-use-marks', useMarks === true),

    onOpenSettings: subscribe('lab:open-settings'),
    onOpenLab: subscribe('lab:open-lab'),
    onNewScan: subscribe('lab:new-scan'),
    onOpenPrevious: subscribe('lab:open-previous')
});
