'use strict';
/**
 * desktop/test/installer.test.cjs —— 安装包配置的几条硬规矩
 * ---------------------------------------------------------------
 * 「装到哪、怎么升级」是这份配置的地基，改坏了不会报错，只会**装出第二份**：
 *
 *   1. `build/installer.nsh` 必须是 UTF-8 **带 BOM** —— NSIS 3 靠 BOM 认 Unicode，
 *      少了 BOM 中文快捷方式名（班级百宝箱.lnk / 作业编辑器.lnk）就成乱码，
 *      而且不报错。注意：有些编辑器/工具写回文件时会把 BOM 吃掉。
 *   2. 不许再出现 `menuCategory` —— electron-builder 把它当 MENU_FILENAME 拼进
 *      **「给所有用户」安装的默认路径**（`$PROGRAMFILES\811 套装\JinSuper`），
 *      和用户目录那份并存；开始菜单目录由 installer.nsh 自己建。
 *   3. 必须强制「只给当前用户装」（customInstallMode → $isForceCurrentInstall）：
 *      否则安装程序会弹「给谁装」那一页，还会读注册表记住上一次的选择 ——
 *      机器上只要有过一份「所有用户」的旧版，新版就默认跟进 Program Files。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, '..');
const nsh = fs.readFileSync(path.join(dir, 'build', 'installer.nsh'));
const nshText = nsh.toString('utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const nsis = pkg.build.nsis;

test('installer.nsh 带 UTF-8 BOM（NSIS 认 Unicode 全靠它）', () => {
  assert.deepEqual([...nsh.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test('强制「只给当前用户装」，安装程序不再弹模式选择页', () => {
  assert.match(
    nshText,
    /!macro\s+customInstallMode[\s\S]*?StrCpy\s+\$isForceCurrentInstall\s+"1"[\s\S]*?!macroend/i,
  );
});

test('不再用 menuCategory（它会把「811 套装」拼进 Program Files 的默认路径）', () => {
  assert.equal(nsis.menuCategory, undefined);
  assert.ok(!/menuCategory/.test(nshText));
});

test('两个快捷方式自己建：默认的桌面 / 开始菜单快捷方式都关掉', () => {
  assert.equal(nsis.createDesktopShortcut, false);
  assert.equal(nsis.createStartMenuShortcut, false);
  assert.match(nshText, /班级百宝箱\.lnk/);
  assert.match(nshText, /作业编辑器\.lnk/);
  assert.match(nshText, /--app=homework/);
});

test('perMachine 保持 false、卸载不清 userData', () => {
  assert.equal(nsis.perMachine, false);
  assert.equal(nsis.deleteAppDataOnUninstall, false);
  assert.equal(nsis.include, 'build/installer.nsh');
});
