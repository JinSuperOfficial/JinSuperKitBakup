#!/usr/bin/env node
/**
 * build/upload-release.mjs —— 把 release/ 里的两个安装包传到两个仓库的 Release 上
 * ---------------------------------------------------------------
 *   node build/upload-release.mjs                    # 版本号取自 package.json
 *   node build/upload-release.mjs --dry-run          # 只说要传什么
 *   node build/upload-release.mjs --bakup-tag v1.6.0 # 指定备份仓库的源码 tag
 *                                                    （不给就取本仓库最近的那个 tag）
 *
 * 两个去处（同一个文件，两处都能下）：
 *   JinSuper.github.io  → tag desktop-v<版本>   （用户最可能从这儿下）
 *   JinSuperKitBakup    → 跟源码 tag            （release 和源码快照同一个 tag）
 *
 * 依赖 gh CLI（已登录）。没有 gh 就把文件手动拖到 Releases 页面上，效果一样。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const root = path.resolve(appDir, '..');

const PAGES_REPO = 'JinSuperOfficial/JinSuper.github.io';
const BAKUP_REPO = 'JinSuperOfficial/JinSuperKitBakup';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const valueOf = (name) => {
  const eq = argv.find((a) => a.startsWith(name + '='));
  if (eq) return eq.slice(name.length + 1);
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[i + 1] : null;
};

const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
const version = pkg.version;

const files = [
  path.join(appDir, 'release', `JinSuper-${version}-portable.exe`),
  path.join(appDir, 'release', `JinSuper-Setup-${version}.exe`),
].filter((f) => fs.existsSync(f));

if (!files.length) {
  console.error(`release/ 里没有 ${version} 的安装包，先跑：npm run dist:win`);
  process.exit(1);
}

let bakupTag = valueOf('--bakup-tag');
if (!bakupTag) {
  try {
    bakupTag = execFileSync('git', ['-C', root, 'describe', '--tags', '--abbrev=0'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    bakupTag = `v${version}`;
  }
}

const targets = [
  { repo: PAGES_REPO, tag: `desktop-v${version}` },
  { repo: BAKUP_REPO, tag: bakupTag },
];

console.log(`版本 ${version}`);
for (const f of files) console.log(`  · ${path.relative(root, f)}（${(fs.statSync(f).size / 1048576).toFixed(1)} MB）`);
console.log('去处：');
for (const t of targets) console.log(`  · ${t.repo} @ ${t.tag}`);

if (DRY) {
  console.log('\n(--dry-run：什么都没传)');
  process.exit(0);
}

for (const t of targets) {
  for (const file of files) {
    console.log(`\n→ ${t.repo} @ ${t.tag} ← ${path.basename(file)}`);
    try {
      execFileSync(
        'gh',
        ['release', 'upload', t.tag, '--repo', t.repo, '--clobber', file],
        { stdio: 'inherit' },
      );
    } catch (err) {
      console.error(`  ✗ 传失败：${err.message}`);
      process.exitCode = 1;
    }
  }
}

console.log('\n完成。下载页：');
for (const t of targets) console.log(`  https://github.com/${t.repo}/releases/tag/${t.tag}`);
