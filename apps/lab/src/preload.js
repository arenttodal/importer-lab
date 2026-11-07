'use strict';

// The only bridge between the screens and the main process. No file paths cross it.

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel) {
    return (callback) => ipcRenderer.on(channel, (_event, payload) => callback(payload));
}

contextBridge.exposeInMainWorld('labAPI', {
    getInfo: () => ipcRenderer.invoke('lab:get-info'),
    listFolders: () => ipcRenderer.invoke('lab:list-folders'),
    addFolders: () => ipcRenderer.invoke('lab:add-folders'),
    removeFolder: (id) => ipcRenderer.invoke('lab:remove-folder', id),
    startScan: (options) => ipcRenderer.invoke('lab:start-scan', options),
    cancelScan: () => ipcRenderer.invoke('lab:cancel-scan'),
    onScanProgress: subscribe('lab:scan-progress'),
    onScanDone: subscribe('lab:scan-done'),
    onScanCancelled: subscribe('lab:scan-cancelled'),
    onScanFailed: subscribe('lab:scan-failed')
});
