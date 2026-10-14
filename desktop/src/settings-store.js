'use strict';
/**
 * src/settings-store.js —— 应用设置落盘（userData/settings.json）
 * 只有一份；读写都过 origins.normalizeSettings，坏字段一律回落默认值。
 */

const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_SETTINGS, normalizeSettings } = require('./origins');

let cachedPath = null;
let cache = null;

function file() {
  if (cachedPath) return cachedPath;
  // 只在真要读写时才碰 electron，方便别处单独 require 这个模块
  const { app } = require('electron');
  cachedPath = path.join(app.getPath('userData'), 'settings.json');
  return cachedPath;
}

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(file(), 'utf8');
    cache = normalizeSettings(JSON.parse(raw));
  } catch {
    cache = { ...DEFAULT_SETTINGS };
  }
  return cache;
}

function save(patch) {
  const next = normalizeSettings({ ...load(), ...(patch || {}) });
  cache = next;
  try {
    const target = file();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, target);
  } catch (err) {
    console.error('[settings] 写入失败：', err && err.message);
  }
  return next;
}

function reset() {
  cache = { ...DEFAULT_SETTINGS };
  return save({});
}

module.exports = { load, save, reset, file };
