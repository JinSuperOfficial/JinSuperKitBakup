'use strict';
/**
 * src/lib-path.js —— 找到「共用实现」在哪
 * ---------------------------------------------------------------
 * 同步核心（`sync/lib/*.mjs`，ESM）和作业规则（`sync/lib/hwk-schema.mjs`）
 * 家里那侧由 CLI / 控制台直接 import。桌面版是 CJS，用动态 import() 加载
 * 同一份文件 —— **绝不复制一份**，不然两边会慢慢长歪。
 *
 * 开发时它在仓库里（<仓库>/sync/lib）；打包后由 electron-builder 的
 * extraResources 放到 resources/sync/lib（和内置离线副本 site/ 一个套路）。
 * 所以路径解析只有这一处，改目录结构只改这里。
 */

const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

/** electron 的 app；在纯 node 下跑测试时它是拿不到的（require('electron') 只会给出路径字符串） */
function electronApp() {
  try {
    const e = require('electron');
    return e && e.app ? e.app : null;
  } catch {
    return null;
  }
}

/** 同步核心所在的目录 */
function syncLibDir() {
  if (process.env.JSD_SYNC_LIB) return path.resolve(process.env.JSD_SYNC_LIB);
  const app = electronApp();
  if (app && app.isPackaged) return path.join(process.resourcesPath, 'sync', 'lib');
  return path.resolve(__dirname, '..', '..', 'sync', 'lib');
}

/** 同步配置：打包时由 build/make-sync-config.mjs 生成（令牌随包走，学校那台不用登录） */
function bundledConfigFile() {
  const app = electronApp();
  if (app && app.isPackaged) return path.join(process.resourcesPath, 'sync-config.json');
  return path.resolve(__dirname, '..', 'build', 'sync-config.json');
}

function syncLibDirExists() {
  try {
    return fs.statSync(syncLibDir()).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 加载 sync/lib 里的一个模块（ESM）。
 * @param {string} name 例如 'hwk-schema.mjs'
 */
function loadSyncLib(name) {
  return import(pathToFileURL(path.join(syncLibDir(), name)).href);
}

module.exports = { syncLibDir, syncLibDirExists, bundledConfigFile, loadSyncLib };
