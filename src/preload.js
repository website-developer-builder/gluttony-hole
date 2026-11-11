'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('gluttony', {
  // Electron 32+ removed File.path; this is the supported way to get a dropped file's real path.
  pathFor: (file) => {
    try { return webUtils.getPathForFile(file) || null; } catch { return null; }
  },
  devour: (paths) => ipcRenderer.invoke('devour', paths),
  moveBy: (dx, dy) => ipcRenderer.send('move-by', dx, dy),
  showMenu: () => ipcRenderer.send('show-menu'),
  onConfig: (cb) => ipcRenderer.on('config', (_e, cfg) => cb(cfg)),
});
