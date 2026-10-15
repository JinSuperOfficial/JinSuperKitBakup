'use strict';
/**
 * ui/hwk-preload.js —— 作业编辑器窗口的桥
 * contextIsolation 开着，界面只拿得到这两个方法。
 * 作业编辑器不加载站点，所以它不需要 topbar 那套导航接口。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hwk', {
  getState: () => ipcRenderer.invoke('hwk:action', 'list', null),
  action: (name, payload) => ipcRenderer.invoke('hwk:action', name, payload),
});
