#!/usr/bin/env node
/**
 * build/test-android.mjs —— 安卓侧与仓库既有约定的**契约测试**（Node 侧）
 * ===========================================================
 * 为什么在 Node 里测安卓：
 *
 *   安卓那套 Kotlin 逻辑由 `./gradlew test` 覆盖（见 `npm run check:android`），
 *   但**跨端的一致性**它测不了 —— 那些约定的另一半住在仓库里：
 *   来源表住在 `desktop/src/origins.js`、保留字住在 `sync/lib/hwk-schema.mjs`、
 *   收件箱格式住在 `sync/lib/inbox.mjs`、tar 字节格式住在 `sync/lib/tar.mjs`。
 *
 *   两份实现（JS 一份、Kotlin 一份）最容易在这里悄悄走偏：
 *   各自都「自洽」，合起来却对不上 —— 表现就是「手机上录的作业，家里 apply 不开」
 *   或者「安卓能看，桌面一看是个空站」。所以这一套专钉**两边对齐**的事：
 *
 *   1. 来源表：id / host / 顺序，逐条比对 `desktop/src/origins.js`
 *   2. 保留字：`HwkStore.RESERVED` == `hwk-schema.mjs` 的 RESERVED == 页面的 INLINE_RESERVED
 *   3. 收件箱常量：目录名 / 清单名 / root 白名单
 *   4. 落盘位置：源码里必须写 `filesDir`，不许出现 `getExternalFilesDir`
 *   5. 四条命门的行为在源码里确实存在（`.php` 404 / Range 206 / 固定虚拟域名 / 先 stat 再写）
 *   6. **不能明文写死令牌**（不许出现 `token = "…"` 这种）
 *   7. 离线副本清单存在且体积 < 10MB
 *   8. `_manifest.json` 最后写
 *   9. tar 样本是最新的（`make-tar-fixtures.mjs --check`）
 *  10. gradle / manifest / CI / 测试登记这几处「文件在但没接线」的地方
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const ANDROID = path.join(ROOT, 'android');
const JAVA = path.join(ANDROID, 'app', 'src', 'main', 'java', 'xyz', 'rth1', 'jinsuper811');

const read = (p) => fs.readFileSync(p, 'utf8');
const exists = (p) => fs.existsSync(p);

/** 递归读一个目录下所有指定后缀的文件，返回 [{rel, text}] */
function readTree(dir, exts) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (exts.some((x) => e.name.endsWith(x))) {
        out.push({ rel: path.relative(ROOT, abs), text: read(abs) });
      }
    }
  };
  if (exists(dir)) walk(dir);
  return out;
}

const ktFiles = () => readTree(JAVA, ['.kt']);

/* ═══════════════════════════════════════════════
   1. 来源表与桌面版一致
   ═══════════════════════════════════════════════ */

test('安卓的来源表与 desktop/src/origins.js 逐条一致', async () => {
  const { ORIGINS, DEFAULT_ORIGIN } = await import('../desktop/src/origins.js');
  const kt = read(path.join(JAVA, 'Origins.kt'));

  /* 默认来源 */
  assert.match(
    kt,
    new RegExp(`DEFAULT_ORIGIN\\s*=\\s*"${DEFAULT_ORIGIN}"`),
    `安卓的 DEFAULT_ORIGIN 不是 "${DEFAULT_ORIGIN}"`,
  );

  /* 每个来源：id 与 host 都要在 Kotlin 里出现，且顺序一致 */
  let cursor = 0;
  for (const o of ORIGINS) {
    const idAt = kt.indexOf(`id = "${o.id}"`, cursor);
    assert.ok(idAt >= 0, `安卓的来源表里没有 id="${o.id}"（或顺序与桌面版不一致）`);
    cursor = idAt;
    assert.ok(
      kt.includes(`host = "${o.host}"`) || (o.id === 'local' && kt.includes('LOCAL_HOST')),
      `来源 ${o.id} 的 host 对不上（桌面版是 ${o.host}）`,
    );
  }

  /* 在线来源的 url 也要对得上 */
  for (const o of ORIGINS) {
    if (o.id === 'local') continue;
    assert.ok(kt.includes(`url = "${o.url}"`), `来源 ${o.id} 的 url 对不上（桌面版是 ${o.url}）`);
  }
});

test('本地来源用的是固定虚拟域名，不是 127.0.0.1 + 随机端口', () => {
  const kt = read(path.join(JAVA, 'Origins.kt'));
  assert.match(kt, /LOCAL_HOST\s*=\s*"appassets\.androidplatform\.net"/);
  assert.match(kt, /LOCAL_BASE\s*=\s*"https:\/\/\$LOCAL_HOST"/);
  /* 这条是「勾选状态不丢」的根：origin 一变，localStorage 就换了一套 */
  assert.ok(
    !/LOCAL_HOST\s*=\s*"127\.0\.0\.1"/.test(kt) && !/LOCAL_HOST\s*=\s*"localhost"/.test(kt),
    'LOCAL_HOST 不许是 127.0.0.1 / localhost（要固定成虚拟域，否则 localStorage 的 origin 会变）',
  );
  assert.ok(
    !/ServerSocket\s*\(/.test(ktFiles().map((f) => f.text).join('\n')),
    '源码里出现了 ServerSocket —— 明确不许手写本地 HTTP 服务（用 shouldInterceptRequest + 固定 origin）',
  );
  assert.ok(
    !/\.port\s*=\s*0|randomPort|availablePort/i.test(ktFiles().map((f) => f.text).join('\n')),
    '源码里出现了「随机端口」的痕迹 —— 那会让勾选状态每次冷启动都清空',
  );
});

/* ═══════════════════════════════════════════════
   2. 保留字三处对齐
   ═══════════════════════════════════════════════ */

test('保留字在安卓 / hwk-schema.mjs / 作业页三处一致', async () => {
  const { RESERVED } = await import('../sync/lib/hwk-schema.mjs');
  const kt = read(path.join(JAVA, 'HwkStore.kt'));

  const m = kt.match(/val RESERVED\s*=\s*setOf\(([\s\S]*?)\)/);
  assert.ok(m, 'HwkStore.kt 里找不到 RESERVED');
  const kotlinSet = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  const jsSet = [...RESERVED];

  assert.deepEqual(
    [...kotlinSet].sort(),
    [...jsSet].sort(),
    `保留字不一致：\n  Kotlin: ${kotlinSet.join(', ')}\n  JS    : ${jsSet.join(', ')}\n` +
      '多一个就多一行假科目，少一个就被吞掉',
  );

  /* 页面的 INLINE_RESERVED 也要在同一套上（三处共用一条规则） */
  const page = read(path.join(ROOT, 'jinsuper.rth1.xyz', 'class', 'homework.html'));
  const pm = page.match(/INLINE_RESERVED\s*=\s*(?:new Set\()?\[([\s\S]*?)\]/);
  assert.ok(pm, '作业页里找不到 INLINE_RESERVED');
  const pageSet = [...pm[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((x) => x[1] || x[2]);
  assert.deepEqual(
    [...pageSet].sort(),
    [...jsSet].sort(),
    `作业页的 INLINE_RESERVED 与 hwk-schema.mjs 的 RESERVED 不一致：\n` +
      `  页面: ${pageSet.join(', ')}\n  JS  : ${jsSet.join(', ')}`,
  );
});

/* ═══════════════════════════════════════════════
   3. 收件箱常量
   ═══════════════════════════════════════════════ */

test('收件箱常量与 sync/lib/config.mjs 一致', async () => {
  const { INBOX_DIR, INBOX_MANIFEST, INBOX_ROOTS } = await import('../sync/lib/config.mjs');
  const kt = read(path.join(JAVA, 'sync', 'Inbox.kt'));

  assert.match(kt, new RegExp(`INBOX_DIR\\s*=\\s*"${INBOX_DIR}"`), `INBOX_DIR 应为 "${INBOX_DIR}"`);
  assert.match(
    kt,
    new RegExp(`INBOX_MANIFEST\\s*=\\s*"${INBOX_MANIFEST}"`),
    `INBOX_MANIFEST 应为 "${INBOX_MANIFEST}"`,
  );
  const m = kt.match(/INBOX_ROOTS\s*=\s*listOf\(([^)]*)\)/);
  assert.ok(m, 'Inbox.kt 里找不到 INBOX_ROOTS');
  const roots = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(roots, [...INBOX_ROOTS], `root 白名单不一致：安卓 ${roots.join(',')} / JS ${INBOX_ROOTS.join(',')}`);
});

test('收件箱的包名与清单名拼法与 inbox.mjs 一致', async () => {
  const { INBOX_MANIFEST } = await import('../sync/lib/config.mjs');
  const kt = read(path.join(JAVA, 'sync', 'Inbox.kt'));
  /* `<dir>/<root>.tar.gz` */
  assert.match(kt, /"\$dir\/\$realRoot\.tar\.gz"/, '包名必须是 `$dir/$root.tar.gz`');
  /* `<dir>/_manifest.json` */
  assert.match(
    kt,
    new RegExp(`"\\$dir/\\$INBOX_MANIFEST"`),
    `清单必须是 \`$dir/${INBOX_MANIFEST}\``,
  );
});

test('★ _manifest.json 在源码里是最后写的', () => {
  const kt = read(path.join(JAVA, 'sync', 'Inbox.kt'));
  const body = kt.slice(kt.indexOf('fun pushInbox'));
  const atTar = body.indexOf('t.put(key, tarball');
  const atManifest = body.indexOf('INBOX_MANIFEST');
  assert.ok(atTar >= 0, '找不到「先传 tar.gz」那一步');
  assert.ok(atManifest > atTar, '★ 清单必须写在 tar.gz 之后 —— 家里只认有清单的时间戳');
});

/* ═══════════════════════════════════════════════
   4. 落盘位置
   ═══════════════════════════════════════════════ */

test('★ 作业数据落在 filesDir，不是外部存储', () => {
  const files = ktFiles();
  const all = files.map((f) => f.text).join('\n');
  assert.ok(
    !/getExternalFilesDir/.test(all),
    '源码里出现 getExternalFilesDir —— 外部存储会被清理、也会被别的应用看见，作业必须放 filesDir',
  );
  assert.match(
    read(path.join(JAVA, 'JinSuperApp.kt')),
    /fun hwkDir\([^)]*\)\s*:\s*File\s*=\s*File\([^)]*\.filesDir,\s*"hwk"\)/,
    'hwkDir 必须拼在 filesDir 下',
  );
  assert.match(
    read(path.join(JAVA, 'HwkStore.kt')),
    /recordFile\(id:\s*String\)\s*=\s*File\(dir,\s*nameFor\(id\)\)/,
    '记录文件必须写进构造时给的那个 dir',
  );
});

/* ═══════════════════════════════════════════════
   5. 四条命门在源码里确实存在
   ═══════════════════════════════════════════════ */

test('★ `.php` 一律回 404', () => {
  const kt = read(path.join(JAVA, 'SiteAssets.kt'));
  assert.match(
    kt,
    /endsWith\("\.php"\)/,
    'SiteAssets 里找不到 `.php` 判定',
  );
  assert.match(
    kt,
    /\.php[\s\S]{0,200}notFound\s*=\s*true/,
    '`.php` 必须被判成 notFound（阅读器靠这个 404 才会回落去取 .md）',
  );
  /* 页面那边的证据：阅读器真的先试 raw.php */
  const page = read(path.join(ROOT, 'jinsuper.rth1.xyz', 'p', 'docs.html'));
  assert.ok(page.includes('raw.php'), '阅读器里没有 raw.php —— 这条回落链的前提变了');
});

test('★ Range 支持（206 + Content-Range + Accept-Ranges）', () => {
  const kt = read(path.join(JAVA, 'LocalContentHandler.kt'));
  assert.match(kt, /Accept-Ranges/, '响应头里必须有 Accept-Ranges（不广告的话 WebView 不会发 Range 请求）');
  assert.match(kt, /Content-Range/, '必须回 Content-Range');
  assert.match(kt, /206/, '必须能回 206 Partial Content');
  assert.match(kt, /shouldInterceptRequest|fun intercept/, '必须在 shouldInterceptRequest 里接管');

  const range = read(path.join(JAVA, 'RangeHeader.kt'));
  assert.match(range, /bytes=/, 'RangeHeader 里要认 `bytes=` 前缀');
  assert.match(range, /Span/, 'RangeHeader 要返回闭区间（Span）');
});

test('★ 虚拟域名从 appassets.androidplatform.net 起', () => {
  const kt = read(path.join(JAVA, 'LocalContentHandler.kt'));
  assert.match(kt, /Origins\.LOCAL_HOST|appassets\.androidplatform\.net/, '本地请求判定要用固定的虚拟域');
  assert.match(kt, /Uri\.parse\(url\)\.host/, '要按 host 判定，别按前缀字符串比（会被伪造路径骗过）');
});

test('★ Gitee 写路径：put 之前先 stat，已存在带 sha', () => {
  const kt = read(path.join(JAVA, 'sync', 'GiteeTransport.kt'));
  const putBody = kt.slice(kt.indexOf('override fun put'));
  assert.ok(
    putBody.indexOf('stat(key, branch)') >= 0 &&
      putBody.indexOf('stat(key, branch)') < putBody.indexOf('PUT'),
    '★ put 里必须先调 transport 的 stat 再决定 POST / PUT —— 写成 api.stat(...) 就是学校上传挂掉的老毛病',
  );
  assert.match(putBody, /"PUT"/, '已存在要用 PUT');
  assert.match(putBody, /"POST"/, '新文件要用 POST');
  assert.match(putBody, /body\["sha"\]/, 'PUT 的 body 里要带 sha');
  assert.ok(
    !/api\.stat\(/.test(kt),
    '★ 出现 `api.stat(` —— 这正是 project.md §15.2 记的那个 TypeError，必须写成 transport.stat(...)',
  );
});

/* ═══════════════════════════════════════════════
   6. 令牌不许明文写死在源码里
   ═══════════════════════════════════════════════ */

test('★ 源码里没有明文令牌', () => {
  const all = ktFiles().map((f) => `${f.rel}\n${f.text}`).join('\n');
  /* Gitee 的私人令牌是 32 位十六进制 / 或者一长串字母数字 */
  const suspects = [...all.matchAll(/token\s*=\s*"([^"]{12,})"/gi)].map((m) => m[1]);
  assert.deepEqual(
    suspects,
    [],
    `源码里写死了 token：${suspects.join(', ')} —— 令牌只能打包时注入 assets/sync-config.json`,
  );
  /* 也不许从 BuildConfig 读（那会诱导人往 CI 里塞令牌） */
  assert.ok(
    !/BuildConfig\.\w*TOKEN/i.test(all),
    '不许从 BuildConfig 读令牌（令牌只有两个来源：包内 assets + 本机设置）',
  );
});

test('.gitignore 挡住了令牌与离线副本生成物', () => {
  const gi = read(path.join(ROOT, '.gitignore'));
  for (const pat of [
    'android/app/src/main/assets/sync-config.json',
    'android/app/src/main/assets/site/',
    'android/app/src/main/assets/hwk-ui/',
    'keystore.properties',          // 口令不许落进任何会被提交的文件
  ]) {
    assert.ok(gi.includes(pat), `.gitignore 里缺 ${pat}`);
  }
});

test('★ keystore 要进备份仓库，但别的 jks 仍被挡', () => {
  const gi = read(path.join(ROOT, '.gitignore'));
  assert.ok(
    /!android\/keystore\/jinsuper\.jks/.test(gi),
    '★ .gitignore 里要把 android/keystore/jinsuper.jks 例外出来 —— ' +
      '备份仓库是按 .gitignore 过滤的，漏了这条签名就丢在本地、`部署.cmd bakup` 带不走。' +
      '（安全的是口令，不是这个文件。）',
  );
  assert.ok(/\*\.jks/.test(gi), '.gitignore 里应该还有一条 `*.jks` 挡掉别的 keystore');

  /* 口令不许出现在任何被提交的文件里。
     ⚠️ 只认「看起来像真口令的值」：文档里写的是 `'…'` / `JINS_KEYSTORE_PASSWORD` 这种
     占位符，别把省略号也当成口令（第一版正则写成 `\S+` 就误报了自己写的 README）。 */
  for (const rel of ['android/gradle.properties', 'android/app/build.gradle.kts', 'android/README.md']) {
    const text = read(path.join(ROOT, rel));
    const hits = [...text.matchAll(/(JINS_KEYSTORE_PASSWORD|jins\.keystorePassword|JINS_KEY_PASSWORD|jins\.keyPassword)\s*[=:]\s*(\S+)/g)]
      .map((m) => m[2])
      /* 占位符不算：纯省略号 / 尖括号 / 中文提示 / 反引号包裹 */
      .filter((v) => /[0-9A-Za-z]/.test(v) && !/^['"`]?(…|\.\.\.|<.*>)$/.test(v));
    assert.deepEqual(
      hits,
      [],
      `${rel} 里像是写死了 keystore 口令：${hits.join(', ')} —— ` +
        '口令只能从环境变量 / 用户级 gradle.properties 读，绝不进仓库',
    );
  }
});

/* ═══════════════════════════════════════════════
   7. 离线副本
   ═══════════════════════════════════════════════ */

test('★ 离线副本已同步且体积在 10MB 以内', () => {
  const script = path.join(ANDROID, 'tools', 'sync-site-assets.mjs');
  assert.ok(exists(script), '缺 android/tools/sync-site-assets.mjs');
  /* --check 会：比对每个文件是否与源头一致 + 报体积超限 */
  const out = execFileSync('node', [script, '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /离线副本是最新的/, `离线副本没同步：\n${out}`);
  const m = out.match(/site ([\d.]+)MB/);
  assert.ok(m, `读不出体积：${out}`);
  assert.ok(parseFloat(m[1]) <= 10, `离线副本 ${m[1]}MB 超过 10MB 上限`);
});

test('离线副本不含听力音频与 docs-md.js（那是 36MB 的坑）', () => {
  const dir = path.join(ANDROID, 'app', 'src', 'main', 'assets', 'site');
  assert.ok(exists(dir), '离线副本目录不存在 —— 先跑 node android/tools/sync-site-assets.mjs');
  const walk = (d, acc = []) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs, acc);
      else acc.push(path.relative(dir, abs));
    }
    return acc;
  };
  const files = walk(dir);
  assert.ok(
    !files.some((f) => f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.wav')),
    '离线副本里混进了音频 —— 听力音频不进包（<audio> 直接引线上地址）',
  );
  assert.ok(!files.includes('docs-md.js'), '离线副本里混进了 docs-md.js（1.45MB，阅读器不在离线链路里）');
  assert.ok(files.includes('class/homework.html'), '离线副本里必须有作业页（核心链路）');
  assert.ok(files.includes('class/data/hwk/index.json'), '离线副本里必须有作业目录（否则页面拿不到「今天」）');
});

/* ═══════════════════════════════════════════════
   8. tar 样本
   ═══════════════════════════════════════════════ */

test('★ tar 跨端样本是最新的（Node 侧真产物）', () => {
  const out = execFileSync('node', [path.join(ANDROID, 'tools', 'make-tar-fixtures.mjs'), '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.match(out, /tar 样本是最新的/, `tar 样本过期：\n${out}`);
});

test('tar 样本与 sync/lib/tar.mjs 的当前实现一致', async () => {
  const { packTar } = await import('../sync/lib/tar.mjs');
  const fixtures = JSON.parse(
    read(path.join(ANDROID, 'app', 'src', 'test', 'resources', 'tar-fixtures.json')),
  );
  assert.ok(fixtures.cases.length >= 5, '样本组数太少，覆盖不到边界（空文件 / 中文名 / 长路径 / 块边界）');

  for (const c of fixtures.cases) {
    const entries = Object.entries(c.files).map(([name, body]) => ({
      name,
      data: Buffer.from(body, 'utf8'),
      mtime: fixtures.mtime,
    }));
    const tar = packTar(entries);
    assert.equal(
      tar.toString('base64'),
      c.tarBase64,
      `样本 ${c.id} 与当前 tar.mjs 的产物不一致 —— 跑 node android/tools/make-tar-fixtures.mjs 重新生成`,
    );
  }
});

/* ═══════════════════════════════════════════════
   9. 工程接线（文件在但没接线 = 永远不跑）
   ═══════════════════════════════════════════════ */

test('gradle wrapper 是完整的（jar 在、校验和在、没被 gitignore 吃掉）', () => {
  const jar = path.join(ANDROID, 'gradle', 'wrapper', 'gradle-wrapper.jar');
  assert.ok(exists(jar), '缺 gradle-wrapper.jar —— CI 上 ./gradlew 起不来');
  assert.ok(fs.statSync(jar).size > 20000, 'gradle-wrapper.jar 太小，可能是个占位文件');

  const props = read(path.join(ANDROID, 'gradle', 'wrapper', 'gradle-wrapper.properties'));
  assert.match(props, /distributionUrl=.*gradle-[\d.]+-bin\.zip/, 'distributionUrl 不对');
  assert.match(
    props,
    /distributionSha256Sum=[0-9a-f]{64}/,
    '缺 distributionSha256Sum —— 少了它 CI 上会悄悄换一份 Gradle 二进制',
  );

  const gi = read(path.join(ROOT, '.gitignore'));
  assert.ok(
    /!android\/gradle\/wrapper\/gradle-wrapper\.jar/.test(gi),
    '.gitignore 里要把 gradle-wrapper.jar 例外出来，否则它进不了备份',
  );
});

test('AndroidManifest 有三个 activity-alias 且各自带 jsd.mode', () => {
  const xml = read(path.join(ANDROID, 'app', 'src', 'main', 'AndroidManifest.xml'));
  const aliases = [...xml.matchAll(/<activity-alias[\s\S]*?<\/activity-alias>/g)].map((m) => m[0]);
  assert.equal(aliases.length, 3, `activity-alias 应该 3 个（看 / 录 / 设置），实际 ${aliases.length}`);

  const modes = new Set();
  for (const a of aliases) {
    const name = a.match(/android:name="([^"]+)"/)[1];
    const mode = a.match(/android:name="jsd\.mode"[\s\S]*?android:value="([^"]+)"/);
    assert.ok(mode, `${name} 没有 jsd.mode 的 meta-data（点图标启动全靠它）`);
    modes.add(mode[1]);
    assert.match(a, /android\.intent\.category\.LAUNCHER/, `${name} 没有 LAUNCHER（桌面上不会出现图标）`);
    assert.match(a, /android:targetActivity="\.MainActivity"/, `${name} 的 targetActivity 必须指向 MainActivity`);
  }
  assert.deepEqual([...modes].sort(), ['edit', 'sync', 'view'], '三个 alias 的 mode 应该是 view / edit / sync');

  /* mode 的读法必须走 componentName + metaData，不能读 intent extra */
  const activity = read(path.join(JAVA, 'MainActivity.kt'));
  assert.match(
    activity,
    /getActivityInfo\(componentName,\s*PackageManager\.GET_META_DATA\)/,
    '★ MainActivity 必须用 componentName 反查 alias 的 meta-data —— 从桌面图标启动没有 intent extra',
  );
});

test('密码门在壳层，且密码常量对得上 README', () => {
  const gate = read(path.join(JAVA, 'PasswordGate.kt'));
  const m = gate.match(/EDIT_PASSWORD\s*=\s*"([^"]+)"/);
  assert.ok(m, '找不到 EDIT_PASSWORD 常量');
  const readme = read(path.join(ANDROID, 'README.md'));
  assert.ok(
    readme.includes(m[1]),
    `README 里没写密码 "${m[1]}" —— 排障表要能告诉人怎么改`,
  );
  /* 密码不许出现在网页里 */
  const ui = read(path.join(ROOT, 'desktop', 'src', 'ui', 'hwk', 'hwk.js'));
  assert.ok(!ui.includes(m[1]), '密码出现在了网页 JS 里 —— 页面代码在 WebView 里能被读出来');
});

test('package.json 里登记了 check:android 与 test-responsive', () => {
  const pkg = JSON.parse(read(path.join(ROOT, 'package.json')));
  assert.ok(pkg.scripts['check:android'], '缺 npm run check:android');
  assert.ok(
    pkg.scripts['check'].includes('build/test-responsive.mjs'),
    '★ build/test-responsive.mjs 没加进 npm run check —— 只加文件不改 package.json = 测试永远不跑',
  );
  assert.ok(
    pkg.scripts['check'].includes('build/test-android.mjs'),
    '★ build/test-android.mjs 没加进 npm run check',
  );
  assert.ok(
    pkg.scripts['check:android'].includes('testDebugUnitTest'),
    'check:android 要跑 ./gradlew testDebugUnitTest',
  );
});

test('AGENTS.md 登记了新的测试文件', () => {
  const agents = read(path.join(ROOT, 'AGENTS.md'));
  assert.ok(agents.includes('test-responsive'), 'AGENTS.md 没提 test-responsive');
  assert.ok(agents.includes('test-android'), 'AGENTS.md 没提 test-android');
  assert.ok(agents.includes('android/'), 'AGENTS.md 没有「移动端」那一节');
});

test('CI 工作流在，且会跑测试 + 还原签名', () => {
  const wf = path.join(ROOT, '.github', 'workflows', 'android.yml');
  assert.ok(exists(wf), '缺 .github/workflows/android.yml');
  const yml = read(wf);
  assert.match(yml, /gradlew/, 'CI 里要跑 ./gradlew');
  assert.match(yml, /testDebugUnitTest/, 'CI 里要跑单元测试');
  assert.match(yml, /assembleRelease/, 'CI 里要打 release 包');
  assert.match(yml, /JINS_KEYSTORE/, 'CI 里要能从 Secrets 还原签名的 keystore');
  assert.match(yml, /sync-site-assets/, 'CI 里要先同步离线副本');
});

test('README 与 PROJECT 都写了移动端那一节', () => {
  const readme = read(path.join(ANDROID, 'README.md'));
  for (const must of ['排障', '密码', '签名', '离线副本', '令牌']) {
    assert.ok(readme.includes(must), `android/README.md 缺少「${must}」相关内容`);
  }
  const project = read(path.join(ROOT, 'project.md'));
  assert.ok(/移动端|Android/.test(project), 'project.md 没有移动端那一节');
});

/* ═══════════════════════════════════════════════
   10. 源码卫生（这几条都是本项目踩过的坑）
   ═══════════════════════════════════════════════ */

test('★ .gradle.kts 顶上不许用块注释（会让整个脚本编译成空脚本）', () => {
  for (const rel of ['android/settings.gradle.kts', 'android/build.gradle.kts', 'android/app/build.gradle.kts']) {
    const text = read(path.join(ROOT, rel));
    /* 去掉行注释后，第一处非空内容不许是 `/*` */
    const firstLine = text
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('//'));
    assert.ok(
      !firstLine.startsWith('/*'),
      `${rel}：顶上用了块注释 —— Kotlin 脚本编译器会把它编译成空脚本（不报错），` +
        'plugin / 依赖全都不生效。改成 `//` 行注释（settings.gradle.kts 上栽过一次）',
    );
  }
});

test('★ Kotlin 注释里不许出现「斜杠 + 星号」的嵌套（会让括号配不平）', () => {
  for (const { rel, text } of ktFiles()) {
    /* 只查注释块内部的 `/*`；字符串里的不管 */
    let i = 0;
    let line = 1;
    while (i < text.length) {
      if (text[i] === '\n') line++;
      if (text.startsWith('//', i)) {
        const j = text.indexOf('\n', i);
        i = j < 0 ? text.length : j;
        continue;
      }
      if (text.startsWith('/*', i)) {
        const close = text.indexOf('*/', i + 2);
        assert.ok(close > 0, `${rel}：注释从第 ${line} 行开始没闭合（Unclosed comment）`);
        const inner = text.slice(i + 2, close);
        assert.ok(
          !inner.includes('/*'),
          `${rel}：第 ${line} 行起的注释里又出现了「斜杠+星号」—— 会嵌套开一层，` +
            '整个文件的括号就配不平（报的行号在文件末尾，跟真正写错的地方差得远）',
        );
        i = close + 2;
        continue;
      }
      i++;
    }
  }
});

test('XML 注释里不许出现连续两个减号', () => {
  const dirs = [
    path.join(ANDROID, 'app', 'src', 'main', 'res'),
  ];
  for (const dir of dirs) {
    for (const { rel, text } of readTree(dir, ['.xml'])) {
      for (const m of text.matchAll(/<!--([\s\S]*?)-->/g)) {
        assert.ok(
          !m[1].includes('--'),
          `${rel}：XML 注释里出现连续两个减号（那是 XML 语法错误，aapt 会直接拦下）`,
        );
      }
    }
  }
});

test('WebView 的四条配置常量都在（少一条线上就出问题）', () => {
  const kt = read(path.join(JAVA, 'ui', 'WebScreen.kt'));
  assert.match(kt, /domStorageEnabled\s*=\s*true/, 'domStorageEnabled=true 不配 = 勾选状态写不进去');
  assert.match(kt, /javaScriptEnabled\s*=\s*true/, 'javaScriptEnabled=true 不配 = 页面空白');
  assert.match(kt, /databaseEnabled\s*=\s*true/, 'databaseEnabled=true 不配 = 老 WebView 上 localStorage 不可用');
  assert.match(
    kt,
    /mixedContentMode\s*=\s*WebSettings\.MIXED_CONTENT_COMPATIBILITY_MODE/,
    'mixedContentMode 要设成 COMPATIBILITY（否则个别镜像的 http 图会是一片灰框）',
  );
  assert.match(kt, /cacheMode\s*=\s*WebSettings\.LOAD_DEFAULT/, '缓存策略要显式写成 LOAD_DEFAULT');
  assert.match(kt, /allowFileAccess\s*=\s*false/, '不许走 file://（清单是 fetch 出来的，会被 CORS 拦）');
});

test('清缓存不会顺手清掉 localStorage（勾选状态就在那儿）', () => {
  const kt = read(path.join(JAVA, 'ui', 'SyncSettingsScreen.kt'));
  const body = kt.slice(kt.indexOf('private fun clearWebCache'));
  assert.ok(
    !/deleteAllData/.test(body),
    '★ 清缓存里调了 WebStorage.deleteAllData() —— 那会把 localStorage 里的勾选状态一起抹掉',
  );
  assert.match(body, /clearCache\(true\)/, '清缓存应该只做 clearCache(true)');
});
