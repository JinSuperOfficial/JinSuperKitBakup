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
});
