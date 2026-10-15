'use strict';
/**
 * desktop/test/modes.test.cjs —— 「811 套装」两个快捷方式共用一个 exe
 * ---------------------------------------------------------------
 * 这两个快捷方式只差一个参数，所以参数解析必须稳：认得出、认不出回默认。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { MODES, DEFAULT_MODE, isMode, getMode, modeFromArgv, modeFromSecondInstance } = require('../src/modes');

test('两种模式都在表里，且都有快捷方式名', () => {
  assert.deepEqual(Object.keys(MODES).sort(), ['browse', 'homework']);
  assert.equal(MODES.browse.shortcut, '班级百宝箱.lnk');
  assert.equal(MODES.homework.shortcut, '作业编辑器.lnk');
  assert.equal(DEFAULT_MODE, 'browse');
});

test('--app=homework / --app homework 都认', () => {
  assert.equal(modeFromArgv(['electron', '.', '--app=homework']), 'homework');
  assert.equal(modeFromArgv(['JinSuper.exe', '--app', 'homework']), 'homework');
  assert.equal(modeFromArgv(['JinSuper.exe', '--app=browse']), 'browse');
});

test('没给 / 给错参数一律回默认（不能因为一个笔误开成别的东西）', () => {
  assert.equal(modeFromArgv([]), 'browse');
  assert.equal(modeFromArgv(['JinSuper.exe']), 'browse');
  assert.equal(modeFromArgv(['JinSuper.exe', '--app=nope']), 'browse');
  assert.equal(modeFromArgv(['JinSuper.exe', '--app']), 'browse');
  assert.equal(getMode('nope').id, 'browse');
  assert.equal(isMode('homework'), true);
  assert.equal(isMode('__proto__'), false, '别被原型链上的键骗了');
});

test('第二个实例的 argv 也能看出该开哪个窗口', () => {
  assert.equal(modeFromSecondInstance(['JinSuper.exe', '--app=homework']), 'homework');
});

test('main.js 真的按这个参数分派（不是只写在模块里）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(src, /modeFromArgv\(process\.argv\)/);
  assert.match(src, /APP_MODE === 'homework'/);
  assert.match(src, /second-instance/);
  assert.match(src, /openModeWindow\(modeFromArgv\(argv\)\)/);
});

test('安装脚本给两个快捷方式都带了 --app=homework 与图标', () => {
  const nsh = fs.readFileSync(path.resolve(__dirname, '..', 'build', 'installer.nsh'), 'utf8');
  assert.match(nsh, /班级百宝箱\.lnk/);
  assert.match(nsh, /作业编辑器\.lnk/);
  assert.match(nsh, /--app=homework/);
  assert.match(nsh, /\$DESKTOP/);
  assert.match(nsh, /\$SMPROGRAMS/);
  /* NSIS 3 靠 BOM 认 Unicode，没有它中文快捷方式名就是乱码 */
  const raw = fs.readFileSync(path.resolve(__dirname, '..', 'build', 'installer.nsh'));
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'installer.nsh 得是 UTF-8 with BOM');
});

test('打包配置：811 套装的名字、两个图标、同步实现都进了包', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
  const b = pkg.build;
  assert.equal(b.nsis.artifactName, 'JinSuper-811-Setup-${version}.exe');
  assert.match(b.nsis.uninstallDisplayName, /811 套装/);
  assert.equal(b.nsis.createDesktopShortcut, false, '快捷方式由 installer.nsh 自己建');
  assert.equal(b.nsis.createStartMenuShortcut, false);
  assert.equal(b.nsis.include, 'build/installer.nsh');
  const extra = b.extraResources.map((e) => e.to);
  assert.ok(extra.includes('sync/lib'), '同步实现要随包走（桌面版按同一份代码跑）');
  assert.ok(extra.includes('.'), 'sync-config.json / 两个图标放进 resources 根');
});
