'use strict';
/**
 * ui/page-preload.js —— 页面视图（网页本体）的 preload
 * ---------------------------------------------------------------
 * 这里刻意什么都不做，只有一种例外：加载的是应用自带页面（file://，比如连不上时的
 * 错误页）时才把 jsd 桥暴露出去，好让那几个按钮能调主进程。
 *
 * 换句话说，线上网页（http/https）里永远没有 window.jsd —— 远端页面拿不到
 * 「退出应用」这类能力，注入 topbar 也不需要网页配合。
 */

const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('jsd', {
    getState: () => ipcRenderer.invoke('app:getState'),
    action: (name, payload) => ipcRenderer.invoke('app:action', name, payload),
  });
}
