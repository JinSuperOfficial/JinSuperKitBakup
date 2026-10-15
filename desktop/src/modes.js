'use strict';
/**
 * src/modes.js —— 桌面版的两种「模式」（纯逻辑，可单测）
 * ---------------------------------------------------------------
 * 「811 套装」装完会有两个快捷方式，它们是**同一个 exe** 的两种模式：
 *
 *   班级百宝箱  →  JinSuper.exe                  浏览站点（现在的窗口形态）
 *   作业编辑器  →  JinSuper.exe --app=homework   离线录作业
 *
 * 为什么用参数而不是做成两个 exe：
 *   · 一份代码、一次打包，两个快捷方式不会各带一套 Electron（省一半体积）；
 *   · 作业编辑器要能在**断网**的学校机器上跑，它必须不依赖站点，所以它是
 *     一个独立的小窗口 + 本地存储，和浏览窗口互不影响；
 *   · 单实例锁仍然保留：两个快捷方式点开的是同一个进程里的两个窗口，
 *     设置文件只有一个人在写，不会互相覆盖。
 */

const MODES = {
  browse: {
    id: 'browse',
    title: 'JinSuper 百宝箱',
    shortcut: '班级百宝箱.lnk',
    width: 1180,
    height: 800,
  },
  homework: {
    id: 'homework',
    title: '作业编辑器',
    shortcut: '作业编辑器.lnk',
    width: 940,
    height: 720,
  },
};

const DEFAULT_MODE = 'browse';

/** 这个模式认不认（认不出就回默认） */
function isMode(id) {
  return Object.prototype.hasOwnProperty.call(MODES, String(id || ''));
}

function getMode(id) {
  return MODES[isMode(id) ? String(id) : DEFAULT_MODE];
}

/**
 * 从命令行参数里取模式：`--app=homework` / `--app homework` 都认。
 * @param {string[]} argv
 * @returns {'browse'|'homework'}
 */
function modeFromArgv(argv) {
  const list = Array.isArray(argv) ? argv.map(String) : [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const eq = a.indexOf('--app=');
    if (eq === 0) {
      const v = a.slice('--app='.length).trim();
      if (isMode(v)) return v;
      continue;
    }
    if (a === '--app' && list[i + 1] && isMode(list[i + 1])) return String(list[i + 1]).trim();
  }
  return DEFAULT_MODE;
}

/** 给「第二个实例」用：从它的 argv 里看出该开哪个窗口 */
function modeFromSecondInstance(argv) {
  return modeFromArgv(argv);
}

module.exports = { MODES, DEFAULT_MODE, isMode, getMode, modeFromArgv, modeFromSecondInstance };
