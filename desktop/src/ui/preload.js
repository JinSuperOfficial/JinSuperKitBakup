'use strict';
/**
 * ui/preload.js —— topbar 与设置面板共用的桥
 * contextIsolation 开着，网页那边只拿得到这三个方法。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jsd', {
  getState: () => ipcRenderer.invoke('app:getState'),
  action: (name, payload) => ipcRenderer.invoke('app:action', name, payload),
  onState: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on('app:state', handler);
    return () => ipcRenderer.removeListener('app:state', handler);
  },
  /* 「云端同步」下载/上传的进度（设置面板里那行小字） */
  onSyncProgress: (cb) => {
    const handler = (_e, p) => cb(p);
    ipcRenderer.on('sync:progress', handler);
    return () => ipcRenderer.removeListener('sync:progress', handler);
  },
});
