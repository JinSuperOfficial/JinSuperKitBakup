/* ═══════════════════════════════════════════════════
   发布控制台 · 前端
   ---------------------------------------------------
   零依赖：一个文件里装完视图、编辑器、队列。
   分节：#0 小工具 / #1 编辑器 / #2 写作 / #3 管理 / #4 归档 / #5 素材 /
        #6 设置 / #7 拖拽队列 / #8 启动与路由
   ═══════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ═══════════ #0 小工具 ═══════════ */

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  async function api(method, path, body) {
    const init = { method, headers: {} };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(path, init);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
    if (!res.ok) {
      const err = new Error((data && data.error) || ('HTTP ' + res.status));
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    return data;
  }

  function toast(msg, kind) {
    const t = el('div', 'toast' + (kind ? ' ' + kind : ''), msg);
    $('toasts').appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 200);
    }, kind === 'bad' ? 5200 : 2600);
  }

  /** 二次确认（设置里能关掉） */
  let CONFIRM_DANGER = true;
  function confirmBox(title, body) {
    if (!CONFIRM_DANGER) return Promise.resolve(true);
    return new Promise((resolve) => {
      const modal = $('modal');
      $('modalTitle').textContent = title;
      $('modalBody').textContent = body || '';
      modal.hidden = false;
      const done = (v) => {
        modal.hidden = true;
        $('modalOk').removeEventListener('click', okFn);
        $('modalCancel').removeEventListener('click', noFn);
        document.removeEventListener('keydown', keyFn);
        resolve(v);
      };
      const okFn = () => done(true);
      const noFn = () => done(false);
      const keyFn = (e) => { if (e.key === 'Escape') done(false); };
      $('modalOk').addEventListener('click', okFn);
      $('modalCancel').addEventListener('click', noFn);
      document.addEventListener('keydown', keyFn);
      $('modalOk').focus();
    });
  }

  const fmtBytes = (n) => {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  };
  const fmtTime = (ms) => {
    const d = new Date(Number(ms) || 0);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  const STATUS_TEXT = {
    published: '已发布',
    archived: '已归档',
    draft: '草稿',
    unpublished: '未发布',
    'orphan-archive': '产物无登记',
  };
  function badge(a) {
    const key = a.status === 'unpublished' && a.draft ? 'draft' : a.status;
    const cls = a.status === 'orphan-archive' ? 'orphan' : key;
    return `<span class="badge ${cls}">${STATUS_TEXT[key] || a.status}</span>`;
  }

  /* 全局状态 */
  const S = {
    state: null,      /* /api/state 结果 */
    groups: [],
    articles: [],
    stats: {},
    archive: { archived: [] },
    queue: [],
    dirty: false,
    currentPath: null,
    mode: 'split',
  };

  /* ═══════════ #1 编辑器（行号 + 高亮 + Tab 缩进） ═══════════ */

  const MD = {
    init() {
      const ta = $('ed');
      const hl = $('hl');
      const lines = $('lines');

      const render = () => {
        /* 逐行：先转义，再在转义后的文本上着色。
           着色只插入我们自己的 <span>，不会再引入未转义的尖括号。 */
        hl.innerHTML = marked2html(ta.value.split('\n'));

        const n = ta.value.split('\n').length;
        if (lines.childElementCount !== n) {
          const frag = document.createDocumentFragment();
          for (let i = 1; i <= n; i++) frag.appendChild(el('span', null, String(i)));
          lines.replaceChildren(frag);
        }
      };

      /* 逐行：先转义，再着色（标记本身是安全的 span） */
      function marked2html(linesArr) {
        return linesArr.map((line) => {
          let s = esc(line);
          s = s.replace(/^(\s*)(#{1,6})(\s+)/, (m, a, b, c) => `${a}<span class="t-h">${b}</span>${c}`);
          s = s.replace(/^(\s*(?:```|~~~).*)$/, (m, a) => `<span class="t-fence">${a}</span>`);
          s = s.replace(/^(\s*)(&gt;.*)$/, (m, a, b) => `${a}<span class="t-quote">${b}</span>`);
          s = s.replace(/(`+[^`]*`+)/g, (m) => `<span class="t-code">${m}</span>`);
          s = s.replace(/(\$\$[^$]*\$\$|\$[^$\n]+\$)/g, (m) => `<span class="t-math">${m}</span>`);
          s = s.replace(/(\*\*[^*]+\*\*|__[^_]+__)/g, (m) => `<span class="t-strong">${m}</span>`);
          s = s.replace(/(!?\[[^\]]*\]\([^)]*\))/g, (m) => `<span class="t-link">${m}</span>`);
          s = s.replace(/(&lt;\/?[a-zA-Z][^&]*?&gt;)/g, (m) => `<span class="t-tag">${m}</span>`);
          return s;
        }).join('\n');
      }

      const syncScroll = () => {
        hl.scrollTop = ta.scrollTop;
        hl.scrollLeft = ta.scrollLeft;
        lines.scrollTop = ta.scrollTop;
      };

      /* 编辑器是这里才建出来的，所以 input 必须在这一刻绑 ——
         提前到 initWrite 里绑的话，事件触发时 MD_CUR 还是 null，
         预览就永远不刷新（这个坑真踩过）。 */
      ta.addEventListener('input', () => {
        render();
        onEdit();
      });
      ta.addEventListener('scroll', syncScroll, { passive: true });
      ta.addEventListener('keydown', (e) => onEditorKey(e, ta, render));

      /* 拖滚动条也会触发 scroll，够用 */
      render();

      return {
        get value() { return ta.value; },
        set value(v) {
          ta.value = v == null ? '' : String(v);
          render();
          syncScroll();
        },
        focus() { ta.focus(); },
        render,
        /** 在光标处插入（保留选区） */
        insert(before, after, placeholder) {
          const s = ta.selectionStart, en = ta.selectionEnd;
          const v = ta.value;
          const sel = v.slice(s, en) || placeholder || '';
          ta.value = v.slice(0, s) + before + sel + (after || '') + v.slice(en);
          const caret = s + before.length + sel.length;
          ta.setSelectionRange(caret, caret);
          render();
          ta.focus();
          onEdit();
        },
        wrapLine(prefix) {
          const s = ta.selectionStart, en = ta.selectionEnd;
          const v = ta.value;
          const ls = v.lastIndexOf('\n', s - 1) + 1;
          const le = v.indexOf('\n', en) === -1 ? v.length : v.indexOf('\n', en);
          const block = v.slice(ls, le);
          const out = block.split('\n').map((l) => prefix + l).join('\n');
          ta.value = v.slice(0, ls) + out + v.slice(le);
          ta.setSelectionRange(ls, ls + out.length);
          render();
          ta.focus();
          onEdit();
        },
      };
    },
  };

  /** 编辑动作的统一出口：脏标记 + 草稿 + 重新预览。 */
  function onEdit() {
    markDirty();
    scheduleAutosave();
    schedulePreview();
  }

  /** 编辑器按键：Tab 缩进 / 常用快捷键 */
  function onEditorKey(e, ta, render) {
    const meta = e.metaKey || e.ctrlKey;

    if (e.key === 'Tab') {
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
      if (s !== en && v.slice(s, en).includes('\n')) {
        /* 多行：整块缩进 / 反缩进 */
        const ls = v.lastIndexOf('\n', s - 1) + 1;
        const block = v.slice(ls, en);
        const out = block.split('\n').map((l) => (e.shiftKey ? l.replace(/^ {1,2}/, '') : '  ' + l)).join('\n');
        ta.value = v.slice(0, ls) + out + v.slice(en);
        ta.setSelectionRange(ls, ls + out.length);
      } else if (e.shiftKey) {
        const ls = v.lastIndexOf('\n', s - 1) + 1;
        const seg = v.slice(ls, s);
        const trimmed = seg.replace(/ {1,2}$/, '');
        ta.value = v.slice(0, ls) + trimmed + v.slice(s);
        ta.setSelectionRange(ls + trimmed.length, ls + trimmed.length);
      } else {
        ta.value = v.slice(0, s) + '  ' + v.slice(en);
        ta.setSelectionRange(s + 2, s + 2);
      }
      render();
      onEdit();
      return;
    }

    if (!meta) return;
    const k = e.key.toLowerCase();
    const map = {
      b: () => MD_CUR.insert('**', '**', '粗体'),
      i: () => MD_CUR.insert('*', '*', '斜体'),
      k: () => MD_CUR.insert('[', '](https://)', '链接文字'),
      e: () => MD_CUR.insert('$', '$', 'x^2'),
      '/': () => MD_CUR.insert('\n| 列 1 | 列 2 |\n| --- | --- |\n|  |  |\n', '', ''),
    };
    if (map[k]) { e.preventDefault(); map[k](); return; }
    if (k === 's') { e.preventDefault(); saveArticle({ publish: false }); }
  }

  let MD_CUR = null;   /* 编辑器实例，onEditorKey 里用 */

  /* ═══════════ #2 写作 ═══════════ */

  let autosaveTimer = null;
  function scheduleAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    const ms = (S.state && S.state.settings.autosaveMs) || 1500;
    autosaveTimer = setTimeout(() => {
      /* 本地草稿先落 localStorage：不落盘也能防丢 */
      try {
        localStorage.setItem('console.draft.' + ($('writePath').value || 'untitled'), MD_CUR.value);
        localStorage.setItem('console.draft.at', String(Date.now()));
      } catch { /* 隐私模式下写不了，不影响主流程 */ }
      updateSaveState();
    }, ms);
  }

  function markDirty() {
    S.dirty = true;
    updateSaveState();
  }
  function updateSaveState() {
    const n = $('saveState');
    if (!S.dirty) { n.textContent = '已保存'; n.className = 'save-state saved'; return; }
    n.textContent = '未保存';
    n.className = 'save-state dirty';
  }

  let previewTimer = null;
  function schedulePreview() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(runPreview, 220);
  }
  async function runPreview() {
    const content = MD_CUR.value;
    try {
      const t0 = performance.now();
      const r = await api('POST', '/api/preview', { content });
      $('preview').innerHTML = r.html;
      $('pvMeta').textContent = '预览 · ' + content.length + ' 字符';
      $('pvMs').textContent = Math.round(performance.now() - t0) + ' ms';
      /* 代码组的标签行由页面脚本生成，预览里补一下 */
      initPreviewWidgets();
    } catch (e) {
      $('preview').innerHTML = '<p style="color:var(--danger)">渲染失败：' + esc(e.message) + '</p>';
    }
  }

  /** 预览里的代码组 / 选项卡：跟阅读器一样，打开第一个面板 */
  function initPreviewWidgets() {
    const root = $('preview');
    root.querySelectorAll('.code-group').forEach((g) => {
      const tabs = g.querySelector('.cg-tabs');
      const panels = [...g.querySelectorAll('.cg-panel')];
      if (!tabs) return;
      if (panels.length <= 1) { g.setAttribute('data-single', 'true'); return; }
      tabs.replaceChildren();
      panels.forEach((p, i) => {
        const b = el('button', 'cg-tab' + (i === 0 ? ' is-active' : ''), p.dataset.label || '代码');
        b.type = 'button';
        b.addEventListener('click', () => {
          tabs.querySelectorAll('.cg-tab').forEach((x) => x.classList.remove('is-active'));
          b.classList.add('is-active');
          panels.forEach((q, j) => { q.hidden = j !== i; });
        });
        tabs.appendChild(b);
        p.hidden = i !== 0;
      });
    });
  }

  async function openArticle(path, { quiet } = {}) {
    if (S.dirty && !quiet) {
      const go = await confirmBox('还没保存', '当前这篇改了没保存，确定切走吗？');
      if (!go) return;
    }
    try {
      const r = await api('GET', '/api/editor?path=' + encodeURIComponent(path));
      MD_CUR.value = r.content;
      S.currentPath = r.path;
      $('writePath').value = r.path;
      $('writeGroup').value = r.group || '';
      S.dirty = false;
      updateSaveState();
      runPreview();
      setView('write');
      toast('打开了 ' + r.path);
    } catch (e) {
      toast('打不开：' + e.message, 'bad');
    }
  }

  async function saveArticle({ publish }) {
    const path = $('writePath').value.trim();
    if (!path) { toast('先填目标路径，例如 idea/新文章.md', 'bad'); return; }
    try {
      const r = await api('PUT', '/api/article', {
        path,
        content: MD_CUR.value,
        title: ($('writePath').value.split('/').pop() || '').replace(/\.[^.]+$/, ''),
        group: $('writeGroup').value || '未分组',
        publish: !!publish,
      });
      S.currentPath = r.path;
      S.dirty = false;
      updateSaveState();
      try { localStorage.removeItem('console.draft.' + path); } catch { /* 无所谓 */ }
      toast(publish ? '已保存并登记进 sk.json：' + r.path : '已保存：' + r.path, 'ok');
      /* 登记状态变了，刷新统计 */
      await refreshState();
      if (publish) renderManage();
    } catch (e) {
      toast('保存失败：' + e.message, 'bad');
    }
  }

  function initWrite() {
    MD_CUR = MD.init();

    $('btnWriteSave').addEventListener('click', () => saveArticle({ publish: false }));
    $('btnWritePublish').addEventListener('click', () => saveArticle({ publish: true }));
    $('btnWriteLoad').addEventListener('click', () => {
      const p = $('writePath').value.trim();
      if (p) openArticle(p, { quiet: true });
    });
    $('writePath').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnWriteLoad').click(); });

    /* 编辑器的 input 事件在 MD.init 里已经接了（走 onEdit），这里不再重复绑。 */

    /* 工具栏 */
    $('toolbar').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-md]');
      if (!btn) return;
      const act = btn.dataset.md;
      const acts = {
        bold: () => MD_CUR.insert('**', '**', '粗体'),
        italic: () => MD_CUR.insert('*', '*', '斜体'),
        strike: () => MD_CUR.insert('~~', '~~', '删除线'),
        code: () => MD_CUR.insert('`', '`', 'code'),
        h2: () => MD_CUR.wrapLine('## '),
        quote: () => MD_CUR.wrapLine('> '),
        ul: () => MD_CUR.wrapLine('- '),
        task: () => MD_CUR.wrapLine('- [ ] '),
        link: () => MD_CUR.insert('[', '](https://)', '链接文字'),
        image: () => MD_CUR.insert('![', '](/p/asset/图片.png)', '图片说明'),
        codeblock: () => MD_CUR.insert('\n```js\n', '\n```\n', 'const a = 1;'),
        math: () => MD_CUR.insert('\n$$\n', '\n$$\n', 'E = mc^2'),
        table: () => MD_CUR.insert('\n| 列 1 | 列 2 |\n| --- | --- |\n|  ', '  |  |\n', ''),
        alert: () => MD_CUR.insert('\n> [!NOTE] 小提示\n> ', '\n', '内容'),
        tabs: () => MD_CUR.insert('\n::: tabs\n@tab:active 第一个\n', '\n@tab 第二个\n\n:::\n', '面板一'),
        codegroup: () => MD_CUR.insert('\n::: code-group\n```js [JavaScript]\n', '\n```\n```python [Python]\nprint(1)\n```\n:::\n', 'const a = 1'),
        spoiler: () => MD_CUR.insert('\n>! ', '\n', '这里是要折起来的内容'),
      };
      (acts[act] || (() => {}))();
    });

    /* 布局切换 */
    document.querySelectorAll('.tool[data-mode]').forEach((b) => {
      b.addEventListener('click', () => setMode(b.dataset.mode));
    });

    /* 分栏拖动 */
    const splitter = $('splitter');
    const work = $('work');
    let dragging = false;
    const onMove = (e) => {
      if (!dragging) return;
      const box = work.getBoundingClientRect();
      const x = (e.touches ? e.touches[0].clientX : e.clientX) - box.left;
      const pct = Math.min(82, Math.max(18, (x / box.width) * 100));
      $('ed').style.flex = '0 0 ' + pct + '%';
    };
    splitter.addEventListener('mousedown', () => { dragging = true; document.body.style.cursor = 'col-resize'; });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', () => { dragging = false; document.body.style.cursor = ''; });
    splitter.addEventListener('keydown', (e) => {
      const cur = parseFloat($('ed').style.flex?.match(/([\d.]+)%/)?.[1] || '50');
      if (e.key === 'ArrowLeft') { e.preventDefault(); $('ed').style.flex = '0 0 ' + Math.max(18, cur - 4) + '%'; }
      if (e.key === 'ArrowRight') { e.preventDefault(); $('ed').style.flex = '0 0 ' + Math.min(82, cur + 4) + '%'; }
    });

    /* 打开时先把 localStorage 里的草稿捞出来（免得白写） */
    try {
      const last = localStorage.getItem('console.draft.' + ($('writePath').value || 'untitled'));
      if (last && !MD_CUR.value) {
        MD_CUR.value = last;
        markDirty();
      }
    } catch { /* 忽略 */ }
  }

  function setMode(mode) {
    S.mode = mode;
    $('work').dataset.mode = mode;
    document.querySelectorAll('.tool[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  }

  /* ═══════════ #3 管理文章 ═══════════ */

  const selected = new Set();
  let collapsed = {};

  async function renderManage() {
    const q = ($('manageQuery').value || '').trim().toLowerCase();
    const sort = $('manageSort').value;
    const filter = $('manageFilter').value;

    let list = S.articles.filter((a) => a.kind === 'md' || a.kind === 'text');
    if (filter === 'draft') list = list.filter((a) => a.draft && a.status === 'unpublished');
    else if (filter) list = list.filter((a) => a.status === filter);
    if (q) list = list.filter((a) => (a.title + ' ' + a.path).toLowerCase().includes(q));

    const bySort = {
      mtime: (a, b) => b.mtime - a.mtime,
      name: (a, b) => String(a.title).localeCompare(String(b.title), 'zh'),
      status: (a, b) => String(a.status).localeCompare(String(b.status)) || b.mtime - a.mtime,
    };
    list.sort(bySort[sort] || bySort.mtime);

    /* 分组：登记过的按 sk.json 的分组，没登记的归到「未登记」 */
    const groups = new Map();
    for (const a of list) {
      const g = a.group || '未登记（磁盘上有，sk.json 里没有）';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(a);
    }

    const body = $('manageBody');
    body.replaceChildren();
    if (!list.length) { $('manageEmpty').hidden = false; return; }
    $('manageEmpty').hidden = true;

    for (const [gname, items] of groups) {
      const tr = el('tr', 'group-row');
      const td = el('td');
      td.colSpan = 7;
      const btn = el('button');
      btn.type = 'button';
      btn.innerHTML = `<span aria-hidden="true">${collapsed[gname] ? '▸' : '▾'}</span> ${esc(gname)} <em class="mono">${items.length}</em>`;
      btn.addEventListener('click', () => {
        collapsed[gname] = !collapsed[gname];
        try { localStorage.setItem('console.collapsed', JSON.stringify(collapsed)); } catch { /* 忽略 */ }
        renderManage();
      });
      td.appendChild(btn);
      tr.appendChild(td);
      body.appendChild(tr);
      if (collapsed[gname]) continue;

      for (const a of items) {
        const r = el('tr');
        r.dataset.path = a.path;

        const c1 = el('td', 'c-check');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = selected.has(a.path);
        cb.setAttribute('aria-label', '选择 ' + a.title);
        cb.addEventListener('change', () => {
          if (cb.checked) selected.add(a.path); else selected.delete(a.path);
          updateBulk();
        });
        c1.appendChild(cb);
        r.appendChild(c1);

        const t = el('td');
        t.innerHTML = `<span class="t-title">${esc(a.title)}</span>${a.isArchive ? ' <span class="badge archived">产物</span>' : ''}`;
        r.appendChild(t);

        const p = el('td');
        p.innerHTML = `<span class="t-path">${esc(a.path)}</span>`;
        r.appendChild(p);

        const s = el('td', 'c-status');
        s.innerHTML = badge(a);
        r.appendChild(s);

        const tm = el('td', 'c-time');
        tm.innerHTML = `<span class="t-time">${fmtTime(a.mtime)}</span>`;
        r.appendChild(tm);

        const sz = el('td', 'c-size');
        sz.innerHTML = `<span class="t-size">${fmtBytes(a.bytes)}</span>`;
        r.appendChild(sz);

        const ac = el('td', 'c-act');
        const box = el('div', 'row-actions');
        const mk = (label, fn, cls) => {
          const b = el('button', cls || null, label);
          b.type = 'button';
          b.addEventListener('click', fn);
          box.appendChild(b);
        };
        mk('编辑', () => openArticle(a.path));
        mk('重命名', () => renameArticle(a));
        mk('分组', () => moveDialog(a));
        if (a.status === 'published') mk('归档', () => archiveOne(a.path));
        if (a.status === 'archived') mk('取消归档', () => unarchiveOne(a));
        mk('删除', () => deleteArticle(a), 'danger');
        ac.appendChild(box);
        r.appendChild(ac);

        body.appendChild(r);
      }
    }

    $('checkAll').checked = false;
    updateBulk();
  }

  function selectedMd() { return [...selected]; }

  function updateBulk() {
    const bar = $('bulkBar');
    const n = selected.size;
    bar.hidden = n === 0;
    $('bulkCount').textContent = '已选 ' + n + ' 篇';
  }

  async function renameArticle(a) {
    const to = prompt('新文件名（含后缀）', a.path.split('/').pop());
    if (!to || to === a.path.split('/').pop()) return;
    try {
      const r = await api('POST', '/api/article/rename', { path: a.path, to });
      toast('已改名为 ' + r.path, 'ok');
      await refreshState();
      renderManage();
    } catch (e) { toast('改名失败：' + e.message, 'bad'); }
  }

  async function moveDialog(a) {
    const g = prompt('移到哪个分组？（填新名字就是新建分组）', a.group || '未分组');
    if (!g) return;
    try {
      await api('POST', '/api/article/move', { path: a.path, group: g });
      toast('已移到「' + g + '」', 'ok');
      await refreshState();
      renderManage();
    } catch (e) { toast('移动失败：' + e.message, 'bad'); }
  }

  async function deleteArticle(a) {
    const go = await confirmBox('删除这篇文章？',
      a.path + '\n\n文件会从磁盘上删掉，登记也一并撤销。这个动作不能撤销。');
    if (!go) return;
    try {
      await api('POST', '/api/article/delete', { path: a.path });
      selected.delete(a.path);
      toast('已删除 ' + a.path, 'ok');
      await refreshState();
      renderManage();
    } catch (e) { toast('删除失败：' + e.message, 'bad'); }
  }

  async function archiveOne(path) {
    try {
      const r = await api('POST', '/api/archive', { paths: [path] });
      toast('已归档 → ' + (r.archived[0] ? r.archived[0].output : ''), 'ok');
      await refreshState();
      renderManage();
      renderArchive();
    } catch (e) { toast('归档失败：' + e.message, 'bad'); }
  }

  async function unarchiveOne(a) {
    const go = await confirmBox('取消归档？',
      (a.archivedPath || a.path) + '\n\n产物会删掉，原文从留底目录搬回 /p，登记还原。');
    if (!go) return;
    try {
      const r = await api('POST', '/api/unarchive', { path: a.path });
      toast('已取消归档，原文回到 ' + (r.restored || '?'), 'ok');
      await refreshState();
      renderManage();
      renderArchive();
    } catch (e) { toast('取消失败：' + e.message, 'bad'); }
  }

  function initManage() {
    $('btnManageRefresh').addEventListener('click', async () => { await refreshState(); renderManage(); toast('已刷新'); });
    $('btnManageNew').addEventListener('click', async () => {
      const p = prompt('新文章的路径（相对 /p/）', '笔记/新想法.md');
      if (!p) return;
      try {
        const r = await api('POST', '/api/article/new', { path: p });
        toast('建好了：' + r.path, 'ok');
        await refreshState();
        await openArticle(r.path);
      } catch (e) { toast('新建失败：' + e.message, 'bad'); }
    });
    $('manageQuery').addEventListener('input', renderManage);
    $('manageSort').addEventListener('change', renderManage);
    $('manageFilter').addEventListener('change', renderManage);
    $('checkAll').addEventListener('change', (e) => {
      const on = e.target.checked;
      selected.clear();
      if (on) {
        S.articles.filter((a) => a.kind === 'md' || a.kind === 'text').forEach((a) => selected.add(a.path));
      }
      renderManage();
    });

    $('bulkClear').addEventListener('click', () => { selected.clear(); renderManage(); });

    $('bulkArchive').addEventListener('click', async () => {
      const paths = selectedMd().filter((p) => !p.startsWith('archive/'));
      if (!paths.length) { toast('选中的里面没有可归档的 .md', 'bad'); return; }
      const go = await confirmBox('归档这 ' + paths.length + ' 篇？',
        paths.join('\n') + '\n\n原文会移到项目根的留底目录，/p 下不再保留；产物写进 /p/archive/ 并登记进 sk.json。');
      if (!go) return;
      try {
        const r = await api('POST', '/api/archive', { paths });
        toast('归档完成：' + r.archived.length + ' 篇', 'ok');
        selected.clear();
        await refreshState();
        renderManage();
        renderArchive();
      } catch (e) { toast('归档失败：' + e.message, 'bad'); }
    });

    $('bulkUnarchive').addEventListener('click', async () => {
      const paths = selectedMd();
      if (!paths.length) return;
      const go = await confirmBox('取消归档这 ' + paths.length + ' 篇？', paths.join('\n'));
      if (!go) return;
      let ok = 0;
      for (const p of paths) {
        try { await api('POST', '/api/unarchive', { path: p }); ok++; } catch (e) { toast(p + '：' + e.message, 'bad'); }
      }
      toast('已取销归档 ' + ok + ' 篇', 'ok');
      selected.clear();
      await refreshState();
      renderManage();
      renderArchive();
    });

    $('bulkMove').addEventListener('click', async () => {
      const g = $('bulkGroup').value;
      if (!g) { toast('先在右边选一个分组', 'bad'); return; }
      const paths = selectedMd();
      let ok = 0;
      for (const p of paths) {
        try { await api('POST', '/api/article/move', { path: p, group: g }); ok++; }
        catch (e) { toast(p + '：' + e.message, 'bad'); }
      }
      toast('已移动 ' + ok + ' 篇到「' + g + '」', 'ok');
      await refreshState();
      renderManage();
    });

    $('bulkDelete').addEventListener('click', async () => {
      const paths = selectedMd();
      const go = await confirmBox('删除这 ' + paths.length + ' 篇？', paths.join('\n') + '\n\n文件会从磁盘删掉，不能撤销。');
      if (!go) return;
      let ok = 0;
      for (const p of paths) {
        try { await api('POST', '/api/article/delete', { path: p }); ok++; } catch (e) { toast(p + '：' + e.message, 'bad'); }
      }
      toast('已删除 ' + ok + ' 篇', 'ok');
      selected.clear();
      await refreshState();
      renderManage();
    });
  }

  /* ═══════════ #4 归档与预渲染 ═══════════ */

  const archSelected = new Set();

  function renderArchive() {
    const can = S.articles.filter((a) => a.kind === 'md' && a.status === 'published');
    const arch = S.archive.archived || [];

    $('canCount').textContent = String(can.length);
    $('archCount').textContent = String(arch.length);
    $('archSize').textContent = '产物 ' + fmtBytes(arch.reduce((n, a) => n + a.bytes, 0)) +
      ' · 会被一起上传到站点';

    const cl = $('canList');
    cl.replaceChildren();
    if (!can.length) cl.appendChild(el('li', null, '没有可归档的 .md（未发布的文章先「发布」再归档）'));
    for (const a of can) {
      const li = el('li', archSelected.has(a.path) ? 'on' : null);
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = archSelected.has(a.path);
      cb.setAttribute('aria-label', '选择 ' + a.title);
      cb.addEventListener('change', () => {
        if (cb.checked) archSelected.add(a.path); else archSelected.delete(a.path);
        li.classList.toggle('on', cb.checked);
      });
      li.appendChild(cb);
      const body = el('div', 'a-body');
      body.innerHTML = `<span class="a-title">${esc(a.title)}</span>` +
        `<span class="a-meta">${esc(a.path)} · ${fmtBytes(a.bytes)} · ${fmtTime(a.mtime)}</span>`;
      li.appendChild(body);
      li.addEventListener('click', (e) => { if (e.target !== cb) cb.click(); });
      cl.appendChild(li);
    }

    const al = $('archList');
    al.replaceChildren();
    if (!arch.length) al.appendChild(el('li', null, '还没有归档产物。勾左边的文章 → 「归档选中」。'));
    for (const a of arch) {
      const li = el('li', archSelected.has(a.path) ? 'on' : null);
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = archSelected.has(a.path);
      cb.setAttribute('aria-label', '选择 ' + a.title);
      cb.addEventListener('change', () => {
        if (cb.checked) archSelected.add(a.path); else archSelected.delete(a.path);
        li.classList.toggle('on', cb.checked);
      });
      li.appendChild(cb);

      const body = el('div', 'a-body');
      body.innerHTML =
        `<span class="a-title">${esc(a.title)}${a.registered ? '' : ' <span class="badge orphan">未登记</span>'}</span>` +
        `<span class="a-meta">${esc(a.path)} · ${fmtBytes(a.bytes)} · 版本 ${a.versions}</span>` +
        `<span class="a-meta">原文留底：${esc(a.originalRel || '（元数据缺失）')}${a.originalExists ? '' : ' ⚠ 不在了'}</span>`;
      li.appendChild(body);

      const acts = el('div', 'a-acts');
      const mk = (label, fn, cls) => {
        const b = el('button', cls || null, label); b.type = 'button';
        b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
        acts.appendChild(b);
      };
      mk('预览', () => window.open('/' + a.path, '_blank', 'noopener'));
      mk('回滚', () => rollbackOne(a));
      mk('取消归档', () => unarchiveOne(a), 'danger');
      li.appendChild(acts);

      al.appendChild(li);
    }
  }

  async function rollbackOne(a) {
    const go = await confirmBox('回滚到上一版？', a.path + '\n\n当前这一版会先存进 .versions，所以还能再回滚回来。');
    if (!go) return;
    try {
      const r = await api('POST', '/api/archive/rollback', { path: a.path });
      toast('已回滚到 ' + r.restoredFrom, 'ok');
      await refreshState();
      renderArchive();
    } catch (e) { toast('回滚失败：' + e.message, 'bad'); }
  }

  function initArchive() {
    $('btnArchiveRefresh').addEventListener('click', async () => { await refreshState(); renderArchive(); toast('已刷新'); });

    $('btnArchiveGo').addEventListener('click', async () => {
      const paths = [...archSelected].filter((p) => !p.startsWith('archive/'));
      if (!paths.length) { toast('先勾左边的文章', 'bad'); return; }
      const go = await confirmBox('归档这 ' + paths.length + ' 篇？',
        paths.join('\n') + '\n\n原文移到留底目录、产物写进 /p/archive/ 并登记 sk.json。');
      if (!go) return;
      try {
        const r = await api('POST', '/api/archive', { paths });
        toast('归档完成：' + r.archived.length + ' 篇', 'ok');
        archSelected.clear();
        await refreshState();
        renderArchive();
        renderManage();
      } catch (e) { toast('归档失败：' + e.message, 'bad'); }
    });

    $('btnUnarchiveGo').addEventListener('click', async () => {
      const paths = [...archSelected];
      if (!paths.length) { toast('先勾右边的产物', 'bad'); return; }
      const go = await confirmBox('取消归档这 ' + paths.length + ' 篇？', paths.join('\n'));
      if (!go) return;
      let ok = 0;
      for (const p of paths) {
        try { await api('POST', '/api/unarchive', { path: p }); ok++; } catch (e) { toast(p + '：' + e.message, 'bad'); }
      }
      toast('已取销 ' + ok + ' 篇', 'ok');
      archSelected.clear();
      await refreshState();
      renderArchive();
      renderManage();
    });

    $('btnRebuild').addEventListener('click', async () => {
      const paths = [...archSelected].filter((p) => p.startsWith('archive/'));
      if (!paths.length) { toast('「重新构建」只作用于右边勾选的已归档产物', 'bad'); return; }
      try {
        const r = await api('POST', '/api/archive/rebuild', { paths });
        toast('重新构建了 ' + r.rebuilt.length + ' 篇', 'ok');
        await refreshState();
        renderArchive();
      } catch (e) { toast('重建失败：' + e.message, 'bad'); }
    });
  }

  /* ═══════════ #5 素材库 ═══════════ */

  function renderAssets() {
    const q = ($('assetQuery').value || '').trim().toLowerCase();
    const kind = $('assetFilter').value;
    let list = S.articles.filter((a) => ['image', 'pdf', 'audio', 'video'].includes(a.kind));
    if (kind) list = list.filter((a) => a.kind === kind);
    if (q) list = list.filter((a) => a.path.toLowerCase().includes(q));

    const grid = $('assetGrid');
    grid.replaceChildren();
    $('assetEmpty').hidden = list.length > 0;
    if (!list.length) return;

    for (const a of list) {
      const card = el('div', 'asset');
      const thumb = el('div', 'asset-thumb');
      const url = a.href;
      if (a.kind === 'image') {
        const img = el('img');
        img.src = url; img.loading = 'lazy'; img.alt = a.title;
        thumb.appendChild(img);
      } else if (a.kind === 'audio') {
        const au = el('audio'); au.controls = true; au.preload = 'none'; au.src = url;
        thumb.appendChild(au);
      } else {
        thumb.innerHTML = a.kind === 'pdf'
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l5 5v13H6z"/><path d="M14 3v6h6"/><path d="M9 14h6M9 17h4"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/></svg>';
      }
      card.appendChild(thumb);

      const body = el('div', 'asset-body');
      body.innerHTML = `<span class="asset-name">${esc(a.path.split('/').pop())}</span>` +
        `<span class="asset-meta">${esc(a.path)} · ${fmtBytes(a.bytes)}</span>`;
      card.appendChild(body);

      const acts = el('div', 'asset-acts');
      const mk = (label, fn, cls) => {
        const b = el('button', cls || null, label); b.type = 'button';
        b.addEventListener('click', fn);
        acts.appendChild(b);
      };
      mk('打开', () => window.open(url, '_blank', 'noopener'));
      mk('复制路径', async () => {
        try { await navigator.clipboard.writeText(a.path); toast('已复制 ' + a.path, 'ok'); }
        catch { prompt('手动复制：', a.path); }
      });
      mk('删除', async () => {
        const go = await confirmBox('删除这个素材？', a.path + '\n\n文件会从磁盘删掉，不能撤销。');
        if (!go) return;
        try {
          await api('POST', '/api/article/delete', { path: a.path });
          toast('已删除 ' + a.path, 'ok');
          await refreshState();
          renderAssets();
        } catch (e) { toast('删除失败：' + e.message, 'bad'); }
      }, 'danger');
      card.appendChild(acts);

      grid.appendChild(card);
    }
  }

  function initAssets() {
    $('btnAssetsRefresh').addEventListener('click', async () => { await refreshState(); renderAssets(); toast('已刷新'); });
    $('assetQuery').addEventListener('input', renderAssets);
    $('assetFilter').addEventListener('change', renderAssets);

    $('btnAssetsPick').addEventListener('click', () => $('assetPicker').click());
    $('assetPicker').addEventListener('change', async (e) => {
      const files = [...e.target.files];
      if (!files.length) return;
      await enqueueFiles(files);
      e.target.value = '';
    });
  }

  /* ═══════════ #6 设置 ═══════════ */

  function renderSettings() {
    const s = S.state.settings;
    const form = $('settingsForm');
    form.replaceChildren();

    const group = (title, rows) => {
      const g = el('section', 'set-group');
      g.appendChild(el('h2', null, title));
      rows.forEach((r) => g.appendChild(r));
      return g;
    };
    const row = (label, node, hint) => {
      const r = el('div', 'set-row');
      const l = el('label', null, label);
      r.appendChild(l);
      const box = el('div', 'len');
      box.appendChild(node);
      r.appendChild(box);
      if (hint) r.title = hint;
      return r;
    };
    const input = (name, type) => {
      const i = el('input', 'input');
      i.type = type || 'text';
      i.dataset.setting = name;
      i.value = s[name];
      return i;
    };

    form.appendChild(group('外观', [
      (() => {
        const sel = el('select', 'input');
        sel.dataset.setting = 'uiTheme';
        [['dark', '深色（推荐）'], ['light', '浅色']].forEach(([v, t]) => {
          const o = el('option', null, t); o.value = v; sel.appendChild(o);
        });
        sel.value = s.uiTheme === 'light' ? 'light' : 'dark';
        return row('控制台主题', sel, '只影响控制台自己；归档产物用的主题在「路径」那一组');
      })(),
      (() => {
        const r = el('input'); r.type = 'range'; r.min = '11'; r.max = '22'; r.step = '1';
        r.dataset.setting = 'editorFontSize'; r.value = s.editorFontSize;
        const out = el('em', 'mono', s.editorFontSize + 'px');
        r.addEventListener('input', () => { out.textContent = r.value + 'px'; });
        const wrap = el('div', 'len'); wrap.appendChild(r); wrap.appendChild(out);
        const rr = el('div', 'set-row');
        rr.appendChild(el('label', null, '编辑器字号'));
        rr.appendChild(wrap);
        return rr;
      })(),
      (() => {
        const r = el('input'); r.type = 'range'; r.min = '400'; r.max = '6000'; r.step = '100';
        r.dataset.setting = 'autosaveMs'; r.value = s.autosaveMs;
        const out = el('em', 'mono', s.autosaveMs + ' ms');
        r.addEventListener('input', () => { out.textContent = r.value + ' ms'; });
        const wrap = el('div', 'len'); wrap.appendChild(r); wrap.appendChild(out);
        const rr = el('div', 'set-row');
        rr.appendChild(el('label', null, '自动保存间隔'));
        rr.appendChild(wrap);
        return rr;
      })(),
      (() => {
        const cb = el('input'); cb.type = 'checkbox'; cb.dataset.setting = 'confirmDanger';
        cb.checked = !!s.confirmDanger;
        return row('危险操作二次确认', cb);
      })(),
    ]));

    form.appendChild(group('路径', [
      row('归档产物的主题', (() => {
        const sel = el('select', 'input');
        sel.dataset.setting = 'theme';
        [['obsidian', '曜石（默认）'], ['cloud', '云舞者'], ['linen', '暖米'], ['ink', '水墨'],
         ['forest', '森林'], ['ocean', '深海'], ['rose', '玫瑰'], ['sepia', '羊皮纸'],
         ['midnight', '午夜'], ['paper', '纸张'], ['amber', '琥珀'], ['moss', '苔藓']].forEach(([v, t]) => {
          const o = el('option', null, t); o.value = v; sel.appendChild(o);
        });
        sel.value = s.theme;
        sel.dataset.setting = 'theme';
        return sel;
      })(), '归档 HTML 的 data-theme，和阅读器 12 套主题一致'),
      row('归档输出目录', input('archiveDir'), '站点绝对路径，默认 p/archive'),
      row('原文留底目录', input('paraDir'), '项目工作空间相对路径，默认 para（站点之外，不会被上传）'),
      row('sk.json 路径', input('skPath'), '文档站清单，默认 sk.json'),
    ]));

    const hint = el('p', 'set-hint',
      '路径改完点右上角「保存设置」。归档目录必须在 /p 下（产物要跟着站点上传），' +
      '留底目录必须在项目根里（站点之外，prep-deploy 不会碰它）。');
    form.appendChild(hint);

    const env = $('envInfo');
    env.replaceChildren();
    const add = (k, v) => { env.appendChild(el('dt', null, k)); env.appendChild(el('dd', null, String(v))); };
    add('工作空间', S.state.paths.workspaceRoot);
    add('站点根', S.state.paths.siteRoot);
    add('文章目录', S.state.paths.pDir);
    add('留底目录', S.state.paths.paraDir);
    add('归档目录', S.state.paths.archiveDir);
    add('预渲染核心', S.state.core.ok ? S.state.core.file : '⚠ ' + S.state.core.error);
  }

  async function saveSettings() {
    const form = $('settingsForm');
    const settings = {};
    form.querySelectorAll('[data-setting]').forEach((n) => {
      const key = n.dataset.setting;
      if (n.type === 'checkbox') settings[key] = n.checked;
      else if (n.type === 'range') settings[key] = Number(n.value);
      else settings[key] = n.value;
    });

    try {
      S.state = await api('PUT', '/api/settings', { settings });
      applyTheme(S.state.settings.uiTheme);
      CONFIRM_DANGER = !!S.state.settings.confirmDanger;
      $('settingsNote').hidden = false;
      $('settingsNote').textContent = '已保存 · ' + new Date().toLocaleTimeString();
      toast('设置已保存', 'ok');
      renderSettings();
    } catch (e) {
      toast('保存失败：' + e.message, 'bad');
    }
  }

  function applyTheme(uiTheme) {
    document.documentElement.dataset.theme = uiTheme === 'light' ? 'light' : 'dark';
  }

  function initSettings() {
    $('btnSettingsSave').addEventListener('click', saveSettings);
  }

  /* ═══════════ #7 拖拽入队 ═══════════ */

  const TEXT_EXT = ['.md', '.markdown', '.mdown', '.txt'];
  const KNOWN_EXT = TEXT_EXT.concat(['.html', '.htm', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
    '.pdf', '.mp3', '.wav', '.ogg', '.m4a', '.mp4', '.webm', '.mov']);

  function fileKind(name) {
    const ext = ('.' + String(name).split('.').pop()).toLowerCase();
    if (TEXT_EXT.includes(ext)) return 'text';
    if (ext === '.html' || ext === '.htm') return 'html';
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) return 'image';
    if (ext === '.pdf') return 'pdf';
    if (['.mp3', '.wav', '.ogg', '.m4a'].includes(ext)) return 'audio';
    if (['.mp4', '.webm', '.mov'].includes(ext)) return 'video';
    return null;
  }

  function readAsBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const s = String(fr.result || '');
        resolve(s.slice(s.indexOf(',') + 1));
      };
      fr.onerror = () => reject(new Error('读文件失败：' + file.name));
      fr.readAsDataURL(file);
    });
  }

  /** 拖入或选择文件 → 组队列（先读内容、判类型、预判重名） */
  async function enqueueFiles(files) {
    const unknown = [];
    const items = [];

    for (const f of files) {
      const kind = fileKind(f.name);
      if (!kind) { unknown.push(f.name); continue; }
      const item = {
        file: f,
        name: f.name,
        kind,
        bytes: f.size,
        target: (kind === 'image' || kind === 'pdf' || kind === 'audio' || kind === 'video' ? 'asset/' : '') + f.name,
        title: f.name.replace(/\.[^.]+$/, ''),
        group: '未分组',
        text: null,
        conflict: 'rename',
        archive: false,
        publish: kind === 'text',
        htmlMode: 'page',
      };
      if (kind === 'text' || kind === 'html') {
        try { item.text = await f.text(); } catch { item.text = ''; }
        if (kind === 'html' && item.text) {
          const m = /<title[^>]*>([^<]{1,80})<\/title>/i.exec(item.text);
          if (m) item.title = m[1].trim();
        }
      }
      items.push(item);
    }

    /* 重名预判交给后端（它才知道盘上有什么） */
    try {
      const r = await api('POST', '/api/queue', {
        files: items.map((i) => ({ name: i.name, targetDir: i.target.includes('/') ? i.target.split('/')[0] : '', bytes: i.bytes })),
      });
      r.items.forEach((info, idx) => {
        if (!items[idx]) return;
        items[idx].preview = info;
        if (info.conflict) items[idx].conflict = 'rename';
      });
    } catch { /* 预判失败不影响入队 */ }

    S.queue.push(...items);
    renderQueue();
    openQueue();
    if (unknown.length) toast('这些类型不认识，没入队：' + unknown.join('、'), 'bad');
    if (items.length) toast('入队 ' + items.length + ' 个文件', 'ok');
  }

  function openQueue() {
    $('queueDrawer').classList.add('on');
    $('queueDrawer').setAttribute('aria-hidden', 'false');
    $('scrim').hidden = false;
  }
  function closeQueue() {
    $('queueDrawer').classList.remove('on');
    $('queueDrawer').setAttribute('aria-hidden', 'true');
    $('scrim').hidden = true;
  }

  function renderQueue() {
    const list = $('queueList');
    $('queueCount').textContent = String(S.queue.length);
    list.replaceChildren();
    if (!S.queue.length) {
      list.appendChild(el('p', 'empty', '队列是空的。把文件拖进窗口就会进来。'));
      return;
    }

    S.queue.forEach((it, idx) => {
      const card = el('div', 'qitem');
      card.dataset.idx = String(idx);

      const head = el('div', 'qitem-head');
      head.appendChild(el('b', null, it.name));
      const kindName = { text: '文本', html: 'HTML', image: '图片', pdf: 'PDF', audio: '音频', video: '视频' }[it.kind] || it.kind;
      head.appendChild(el('span', 'badge unpublished', kindName + ' · ' + fmtBytes(it.bytes)));
      if (it.preview && it.preview.conflict) {
        const c = el('span', 'qconflict', '⚠ 已存在同名文件');
        head.appendChild(c);
      }
      card.appendChild(head);

      const grid = el('div', 'qgrid');
      const f1 = el('label', 'field');
      f1.appendChild(el('span', null, '目标路径（相对 /p/）'));
      const inp = el('input', 'input mono');
      inp.value = it.target;
      inp.addEventListener('input', () => { it.target = inp.value; });
      f1.appendChild(inp);
      grid.appendChild(f1);

      const f2 = el('label', 'field');
      f2.appendChild(el('span', null, '标题'));
      const t = el('input', 'input');
      t.value = it.title;
      t.addEventListener('input', () => { it.title = t.value; });
      f2.appendChild(t);
      grid.appendChild(f2);

      const f3 = el('label', 'field');
      f3.appendChild(el('span', null, '分组'));
      const gsel = el('select', 'input');
      ['未分组'].concat(S.groups).forEach((g) => { const o = el('option', null, g); o.value = g; gsel.appendChild(o); });
      gsel.value = it.group;
      gsel.addEventListener('change', () => { it.group = gsel.value; });
      f3.appendChild(gsel);
      grid.appendChild(f3);

      if (it.preview && it.preview.conflict) {
        const f4 = el('label', 'field');
        f4.appendChild(el('span', null, '重名怎么办'));
        const csel = el('select', 'input');
        [['rename', '自动改名'], ['overwrite', '覆盖'], ['skip', '跳过']].forEach(([v, tx]) => {
          const o = el('option', null, tx); o.value = v; csel.appendChild(o);
        });
        csel.value = it.conflict;
        csel.addEventListener('change', () => { it.conflict = csel.value; });
        f4.appendChild(csel);
        grid.appendChild(f4);
      }
      card.appendChild(grid);

      const row = el('div', 'qrow');
      if (it.kind === 'text' || it.kind === 'html') {
        const l1 = el('label');
        const cb1 = el('input'); cb1.type = 'checkbox'; cb1.checked = it.publish;
        cb1.addEventListener('change', () => { it.publish = cb1.checked; });
        l1.appendChild(cb1); l1.appendChild(document.createTextNode('发布到 sk.json'));
        row.appendChild(l1);
      }
      const l2 = el('label');
      const cb2 = el('input'); cb2.type = 'checkbox'; cb2.checked = it.archive;
      cb2.addEventListener('change', () => { it.archive = cb2.checked; });
      l2.appendChild(cb2); l2.appendChild(document.createTextNode('同时归档（预渲染）'));
      row.appendChild(l2);

      if (it.kind === 'html') {
        const l3 = el('label');
        l3.appendChild(document.createTextNode('HTML 处理：'));
        const hsel = el('select', 'input');
        [['page', '当独立页面上传'], ['extract', '提取正文转 Markdown'], ['asset', '只当素材']].forEach(([v, tx]) => {
          const o = el('option', null, tx); o.value = v; hsel.appendChild(o);
        });
        hsel.value = it.htmlMode;
        hsel.addEventListener('change', () => { it.htmlMode = hsel.value; });
        l3.appendChild(hsel);
        row.appendChild(l3);
      }

      const spacer = el('span'); spacer.style.flex = '1';
      row.appendChild(spacer);

      const bp = el('button', 'btn primary', '发布这一个'); bp.type = 'button';
      bp.addEventListener('click', () => publishQueue([idx]));
      const bd = el('button', 'btn ghost', '移除'); bd.type = 'button';
      bd.addEventListener('click', () => { S.queue.splice(idx, 1); renderQueue(); });
      row.appendChild(bp); row.appendChild(bd);

      card.appendChild(row);
      list.appendChild(card);
    });
  }

  /** HTML → 保守的 Markdown 提取（不追求完美，界面里也提示了要人眼过一遍） */
  function htmlToMarkdown(html) {
    let s = String(html);
    s = s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<\/(p|div|section|article|li|h[1-6])>/gi, '\n\n');
    s = s.replace(/<h1[^>]*>/gi, '\n# ').replace(/<h2[^>]*>/gi, '\n## ')
      .replace(/<h3[^>]*>/gi, '\n### ').replace(/<h4[^>]*>/gi, '\n#### ')
      .replace(/<h5[^>]*>/gi, '\n##### ').replace(/<h6[^>]*>/gi, '\n###### ');
    s = s.replace(/<li[^>]*>/gi, '- ');
    s = s.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
    s = s.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
    s = s.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');
    s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
    s = s.replace(/<[^>]+>/g, '');
    s = s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    return s.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  async function publishQueue(indexes) {
    const picks = indexes.map((i) => S.queue[i]).filter(Boolean);
    if (!picks.length) return;

    const items = [];
    for (const it of picks) {
      const base = { name: it.name, target: it.target, title: it.title, group: it.group, conflict: it.conflict };
      if (it.kind === 'text') {
        items.push({ ...base, text: it.text, publish: it.publish, archive: it.archive });
      } else if (it.kind === 'html') {
        if (it.htmlMode === 'extract') {
          const md = htmlToMarkdown(it.text || '');
          items.push({ ...base, name: it.name.replace(/\.html?$/i, '.md'), target: it.target.replace(/\.html?$/i, '.md'), text: md, publish: it.publish, archive: it.archive });
        } else if (it.htmlMode === 'asset') {
          items.push({ ...base, dataBase64: await readAsBase64(it.file), publish: false, archive: false });
        } else {
          items.push({ ...base, dataBase64: await readAsBase64(it.file), publish: it.publish, archive: it.archive });
        }
      } else {
        items.push({ ...base, dataBase64: await readAsBase64(it.file), publish: false, archive: it.archive });
      }
    }

    try {
      const r = await api('POST', '/api/publish-drop', { items });
      const okN = r.results.filter((x) => x.ok).length;
      const bad = r.results.filter((x) => !x.ok);
      toast('发布完成：成功 ' + okN + ' 个' + (bad.length ? '，跳过/失败 ' + bad.length + ' 个' : ''), bad.length ? 'bad' : 'ok');
      bad.forEach((b) => toast((b.name || '') + '：' + (b.reason || '失败'), 'bad'));

      /* 移除已成功的；失败的留着让人改 */
      const doneSet = new Set();
      for (const idx of indexes) {
        const it = S.queue[idx];
        const hit = r.results.find((x) => x.name === it.name && x.ok);
        if (hit) doneSet.add(idx);
      }
      S.queue = S.queue.filter((_, i) => !doneSet.has(i));
      renderQueue();
      if (!S.queue.length) closeQueue();
      await refreshState();
      renderManage();
      renderArchive();
      renderAssets();
    } catch (e) {
      toast('发布失败：' + e.message, 'bad');
    }
  }

  function initDrop() {
    const veil = $('dropVeil');
    let depth = 0;

    window.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      depth++;
      veil.hidden = false;
    });
    window.addEventListener('dragover', (e) => {
      if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault();
    });
    window.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) veil.hidden = true;
    });
    window.addEventListener('drop', async (e) => {
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault();
      depth = 0;
      veil.hidden = true;
      await enqueueFiles([...e.dataTransfer.files]);
    });

    $('btnQueueClose').addEventListener('click', closeQueue);
    $('scrim').addEventListener('click', closeQueue);
    $('btnQueueClear').addEventListener('click', () => { S.queue = []; renderQueue(); closeQueue(); });
    $('btnQueuePublishAll').addEventListener('click', () => publishQueue(S.queue.map((_, i) => i)));
  }

  /* ═══════════ #9 文档清单（sk.json） ═══════════ */

  const MFS = { data: null, mode: 'table', dirty: false, picked: new Set() };

  function manifestHeader() {
    const d = MFS.data;
    if (!d) return;
    $('manifestSub').textContent = `${d.file} · ${d.stats.groups} 组 / ${d.stats.entries} 条 · 约定：路径相对 /p`;
    $('manifestStats').innerHTML =
      `<div class="stat"><b>${d.stats.groups}</b><span>分组</span></div>` +
      `<div class="stat"><b>${d.stats.entries}</b><span>条目</span></div>` +
      `<div class="stat ${d.stats.problems ? 's-draft' : 's-pub'}"><b>${d.stats.problems}</b><span>问题</span></div>` +
      `<div class="stat"><b>${d.stats.unregistered}</b><span>未登记</span></div>`;
  }

  function renderManifest() {
    const d = MFS.data;
    if (!d) return;
    manifestHeader();
    renderManifestTable(d);
    renderManifestProblems(d);
    renderManifestUnregistered(d);
    if (document.activeElement !== $('manifestRaw')) $('manifestRaw').value = d.raw;
    $('manifestRaw').disabled = false;
  }

  function renderManifestTable(d) {
    const body = $('manifestBody');
    body.replaceChildren();
    let rows = 0;

    d.groups.forEach((g, gi) => {
      const head = el('tr', 'mf-group');
      const td = el('td');
      td.colSpan = 4;
      const wrap = el('div', 'mf-group-head');
      const name = el('input', 'input mono');
      name.value = g.name;
      name.title = '分组名';
      name.addEventListener('change', () => op('renameGroup', { group: g.name, to: name.value.trim() }));
      wrap.appendChild(name);
      wrap.appendChild(el('em', 'mono', `${g.items.length} 条`));
      const up = el('button', 'btn ghost', '↑');
      up.title = '上移分组';
      up.disabled = gi === 0;
      up.addEventListener('click', () => {
        const order = d.groups.map((x) => x.name);
        [order[gi - 1], order[gi]] = [order[gi], order[gi - 1]];
        op('reorderGroups', { order });
      });
      const del = el('button', 'btn ghost danger', '删分组');
      del.addEventListener('click', async () => {
        const okd = await confirmBox('删掉分组？', `「${g.name}」和它下面的 ${g.items.length} 条登记都会消失（文件不动）。`);
        if (!okd) return;
        for (const it of g.items) await op('remove', { group: g.name, title: it.title }, { silent: true, tolerant: true });
        try {
          MFS.data = await api('POST', '/api/manifest/fix', { kinds: ['empty-group'] });
          renderManifest();
          toast('分组已删除', 'ok');
        } catch (e) { toast('删分组失败：' + e.message, 'bad'); }
      });
      wrap.appendChild(up);
      wrap.appendChild(del);
      td.appendChild(wrap);
      head.appendChild(td);
      body.appendChild(head);

      g.items.forEach((it, ii) => {
        rows++;
        const tr = el('tr');
        const c1 = el('td');
        const title = el('input', 'input');
        title.value = it.title;
        title.addEventListener('change', () => op('rename', { group: g.name, title: it.title, to: title.value.trim() }));
        c1.appendChild(title);
        tr.appendChild(c1);

        const c2 = el('td');
        const p = el('input', 'input mono');
        p.value = it.path;
        p.setAttribute('list', 'manifestPathHints');
        p.addEventListener('change', () => op('repath', { group: g.name, title: it.title, to: p.value.trim() }));
        c2.appendChild(p);
        tr.appendChild(c2);

        const c3 = el('td');
        c3.appendChild(existsBadge(it));
        tr.appendChild(c3);

        const c4 = el('td');
        const acts = el('div', 'row-acts');
        const mk = (label, title2, fn, cls) => {
          const b = el('button', 'btn ghost' + (cls ? ' ' + cls : ''), label);
          b.title = title2;
          b.addEventListener('click', fn);
          acts.appendChild(b);
        };
        mk('↑', '上移', () => {
          const order = g.items.map((x) => x.title);
          if (ii === 0) return;
          [order[ii - 1], order[ii]] = [order[ii], order[ii - 1]];
          op('reorderItems', { group: g.name, order });
        });
        mk('↓', '下移', () => {
          const order = g.items.map((x) => x.title);
          if (ii === g.items.length - 1) return;
          [order[ii + 1], order[ii]] = [order[ii], order[ii + 1]];
          op('reorderItems', { group: g.name, order });
        });
        mk('换组', '移动到其它分组', async () => {
          const to = prompt('移到哪个分组？（写新名字就是新建）', d.groups[0] ? d.groups[0].name : '未分组');
          if (!to) return;
          op('moveGroup', { group: g.name, title: it.title, to: to.trim() });
        });
        mk('删', '从清单里移除（文件不动）', () => op('remove', { group: g.name, title: it.title }), 'danger');
        c4.appendChild(acts);
        tr.appendChild(c4);
        body.appendChild(tr);
      });
    });

    /* 新条目一行：分组 + 标题 + 路径 */
    const addRow = el('tr', 'mf-add');
    const ac1 = el('td');
    const addTitle = el('input', 'input');
    addTitle.placeholder = '新条目标题';
    const addGroup = el('input', 'input mono');
    addGroup.placeholder = '分组';
    addGroup.value = d.groups[0] ? d.groups[0].name : '未分组';
    ac1.appendChild(addGroup);
    ac1.appendChild(addTitle);
    addRow.appendChild(ac1);
    const ac2 = el('td');
    const addPath = el('input', 'input mono');
    addPath.placeholder = 'idea/新文章.md';
    addPath.setAttribute('list', 'manifestPathHints');
    ac2.appendChild(addPath);
    addRow.appendChild(ac2);
    const ac3 = el('td');
    ac3.appendChild(el('span', 'hint', '手填或从下拉里挑'));
    addRow.appendChild(ac3);
    const ac4 = el('td');
    const addBtn = el('button', 'btn primary', '加条目');
    addBtn.addEventListener('click', async () => {
      if (!addTitle.value.trim() || !addPath.value.trim()) { toast('标题和路径都得填', 'bad'); return; }
      const okd = await op('add', { group: addGroup.value.trim() || '未分组', title: addTitle.value.trim(), path: addPath.value.trim() });
      if (okd) { addTitle.value = ''; addPath.value = ''; }
    });
    ac4.appendChild(addBtn);
    addRow.appendChild(ac4);
    body.appendChild(addRow);

    $('manifestEmpty').hidden = rows > 0;
  }

  function existsBadge(it) {
    if (!it.exists) return el('span', 'badge orphan', '文件不在');
    if (!it.href) return el('span', 'badge archived', '站点外');
    return el('span', 'badge published', it.kind || 'ok');
  }

  function renderManifestProblems(d) {
    const box = $('manifestProblems');
    box.replaceChildren();
    $('manifestProblemCount').textContent = String(d.problems.length);
    if (!d.problems.length) {
      box.appendChild(el('p', 'hint', '没有发现问题。'));
      return;
    }
    d.problems.forEach((p) => {
      const item = el('div', 'problem ' + (p.level === 'error' ? 'err' : p.level === 'warn' ? 'warn' : 'info'));
      const body = el('div', 'p-body');
      body.appendChild(el('span', 'p-title', p.message));
      if (p.kind) body.appendChild(el('span', 'p-meta', p.kind));
      item.appendChild(body);
      if (p.fixable) {
        const b = el('button', 'btn', '修复');
        b.addEventListener('click', () => fixProblem(p));
        item.appendChild(b);
      }
      box.appendChild(item);
    });
  }

  async function fixProblem(p) {
    const body = { kinds: [p.kind] };
    if (p.kind === 'unregistered' || p.kind === 'orphan-archive') {
      const paths = p.paths || [];
      const okd = await confirmBox('登记这些文件？', `${paths.length} 个文件会登记到「未分组」，之后可以在表格里改标题与分组。`);
      if (!okd) return;
      body.paths = paths;
      body.group = '未分组';
    } else if (['missing-file', 'archive-missing', 'duplicate-path', 'outside-p'].includes(p.kind)) {
      const paths = p.path ? [p.path] : (p.items || []).map((x) => x.path);
      const okd = await confirmBox('移除这些登记？', `会从 sk.json 里删掉：${paths.join('、')}（只动清单，不删文件）`);
      if (!okd) return;
      body.paths = paths;
    }
    try {
      const r = await api('POST', '/api/manifest/fix', body);
      MFS.data = r;
      renderManifest();
      (r.report || []).forEach((line) => toast(line, 'ok'));
      if (!r.report || !r.report.length) toast('没什么可改的', 'bad');
    } catch (e) { toast('修复失败：' + e.message, 'bad'); }
  }

  function renderManifestUnregistered(d) {
    const box = $('manifestUnregistered');
    box.replaceChildren();
    $('manifestUnregCount').textContent = String(d.unregistered.length);
    if (!d.unregistered.length) {
      box.appendChild(el('p', 'hint', '/p 下的文件都在清单里。'));
      return;
    }
    d.unregistered.forEach((a) => {
      const item = el('div', 'problem info');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = MFS.picked.has(a.path);
      cb.addEventListener('change', () => {
        if (cb.checked) MFS.picked.add(a.path); else MFS.picked.delete(a.path);
      });
      item.appendChild(cb);
      const body = el('div', 'p-body');
      body.appendChild(el('span', 'p-title', a.title || a.path));
      body.appendChild(el('span', 'p-meta', `${a.path} · ${a.kind} · ${fmtBytes(a.bytes)}`));
      item.appendChild(body);
      box.appendChild(item);
    });
    const bar = el('div', 'row-acts');
    const bin = el('button', 'btn primary', '登记选中的');
    bin.addEventListener('click', async () => {
      const paths = [...MFS.picked];
      if (!paths.length) { toast('先勾几个文件', 'bad'); return; }
      try {
        const r = await api('POST', '/api/manifest/fix', { kinds: ['unregistered'], paths, group: '未分组' });
        MFS.data = r;
        MFS.picked.clear();
        renderManifest();
        (r.report || []).forEach((line) => toast(line, 'ok'));
      } catch (e) { toast('登记失败：' + e.message, 'bad'); }
    });
    const only = el('button', 'btn', '全选');
    only.addEventListener('click', () => { d.unregistered.forEach((a) => MFS.picked.add(a.path)); renderManifest(); });
    bar.appendChild(bin);
    bar.appendChild(only);
    box.appendChild(bar);
  }

  async function refreshManifest() {
    try {
      MFS.data = await api('GET', '/api/manifest');
      MFS.dirty = false;
      renderManifest();
      fillManifestHints();
    } catch (e) { toast('读不到清单：' + e.message, 'bad'); }
  }

  function fillManifestHints() {
    let dl = $('manifestPathHints');
    if (!dl) {
      dl = el('datalist');
      dl.id = 'manifestPathHints';
      document.body.appendChild(dl);
    }
    dl.replaceChildren();
    (S.articles || []).filter((a) => a.kind === 'md' || a.kind === 'html').slice(0, 300).forEach((a) => {
      const o = el('option');
      o.value = a.path;
      dl.appendChild(o);
    });
  }

  async function op(kind, payload, { silent = false, refresh = true, tolerant = false } = {}) {
    try {
      const r = await api('POST', '/api/manifest/entry', { op: kind, ...payload });
      MFS.data = r;
      renderManifest();
      if (!silent) toast('已改：' + kind, 'ok');
      return true;
    } catch (e) {
      if (tolerant) return false;
      toast('改动失败：' + e.message, 'bad');
      await refreshManifest();
      return false;
    }
  }

  function setManifestMode(mode) {
    MFS.mode = mode === 'source' ? 'source' : 'table';
    $('manifestTableWrap').hidden = MFS.mode !== 'table';
    $('manifestSrcWrap').classList.toggle('on', MFS.mode === 'source');
    $('manifestSide').hidden = MFS.mode !== 'table';
    $('btnManifestSave').hidden = MFS.mode !== 'source';
    document.querySelectorAll('#manifestMode .seg-btn').forEach((b) => {
      b.classList.toggle('on', b.dataset.mode === MFS.mode);
    });
    if (MFS.mode === 'source' && MFS.data) $('manifestRaw').value = MFS.data.raw;
  }

  function initManifest() {
    document.querySelectorAll('#manifestMode .seg-btn').forEach((b) => {
      b.addEventListener('click', () => setManifestMode(b.dataset.mode));
    });
    $('btnManifestReload').addEventListener('click', () => refreshManifest().then(() => toast('已重新加载', 'ok')));
    $('btnManifestScan').addEventListener('click', async () => {
      try {
        const r = await api('POST', '/api/manifest/scan');
        MFS.data = await api('GET', '/api/manifest');
        renderManifest();
        toast(r.ok ? '扫描完成：没问题' : `扫描完成：${r.problems.length} 条`, r.ok ? 'ok' : 'bad');
      } catch (e) { toast('扫描失败：' + e.message, 'bad'); }
    });
    $('btnManifestSave').addEventListener('click', saveManifestRaw);
    $('manifestRaw').addEventListener('input', () => {
      const raw = $('manifestRaw').value;
      $('manifestRaw').classList.add('dirty');
      try {
        JSON.parse(raw);
        $('manifestErr').hidden = true;
        $('btnManifestSave').disabled = false;
      } catch (e) {
        $('manifestErr').hidden = false;
        $('manifestErr').textContent = 'JSON 语法错误：' + e.message;
        $('btnManifestSave').disabled = true;
      }
    });
    $('manifestRaw').addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveManifestRaw(); }
    });
  }

  async function saveManifestRaw() {
    try {
      const r = await api('PUT', '/api/manifest', { raw: $('manifestRaw').value });
      MFS.data = r;
      renderManifest();
      toast(r.backup ? `已保存（旧版备份 ${r.backup}）` : '已保存', 'ok');
    } catch (e) { toast('保存失败：' + e.message, 'bad'); }
  }

  /* ═══════════ #10 发布与部署 ═══════════ */

  const JOB = { id: null, timer: null, offset: 0, steps: [], running: false, pipelines: [] };

  async function refreshDeploy() {
    try {
      const r = await api('GET', '/api/jobs');
      JOB.pipelines = r.pipelines || [];
      renderDeployStats(r);
      renderDeployHistory(r.jobs || []);
      if (r.current && r.current.state === 'running' && !JOB.running) {
        JOB.id = r.current.id;
        JOB.offset = 0;
        JOB.running = true;
        $('deployLog').textContent = '';
        startPolling();
      }
      $('btnDeployStop').hidden = !JOB.running;
      $('btnDeployFull').disabled = JOB.running;
    } catch (e) { toast('读不到作业状态：' + e.message, 'bad'); }
  }

  function renderDeployStats(r) {
    const st = (S.state && S.state.stats) || {};
    const cur = r.current;
    $('deployStats').innerHTML =
      `<div class="stat"><b>${st.total || 0}</b><span>文章</span></div>` +
      `<div class="stat"><b>${st.draft || 0}</b><span>草稿</span></div>` +
      `<div class="stat ${r.busy ? 's-draft' : 's-pub'}"><b>${r.busy ? '跑着' : '空闲'}</b><span>作业状态</span></div>` +
      `<div class="stat"><b>${(r.jobs || []).length}</b><span>历史作业</span></div>`;
    if (cur) $('deployMeta').textContent = `${cur.label} · ${cur.state}`;
  }

  function renderDeployHistory(jobs) {
    const box = $('deployHistory');
    box.replaceChildren();
    if (!jobs.length) { box.appendChild(el('p', 'hint', '还没有跑过作业。')); return; }
    jobs.slice(0, 10).forEach((j) => {
      const row = el('div', 'hist-row');
      const st = j.state === 'done' ? 'published' : j.state === 'running' ? 'archived' : j.state === 'unknown' ? 'draft' : 'orphan';
      row.appendChild(el('span', 'badge ' + st, j.state));
      row.appendChild(el('span', null, j.label));
      row.appendChild(el('span', 'mono', j.startedAt ? fmtTime(j.startedAt) : ''));
      const open = el('button', 'btn ghost', '看日志');
      open.addEventListener('click', () => {
        JOB.id = j.id;
        JOB.offset = 0;
        JOB.running = j.state === 'running';
        $('deployLog').textContent = '';
        $('deploySteps').replaceChildren();
        startPolling();
      });
      row.appendChild(open);
      box.appendChild(row);
    });
  }

  function startJob(pipeline) {
    const flags = {
      noBuild: $('flagNoBuild').checked,
      noCheck: $('flagNoCheck').checked,
      noGh: $('flagNoGh').checked,
    };
    api('POST', '/api/jobs', { pipeline, flags })
      .then((r) => {
        JOB.id = r.id;
        JOB.offset = 0;
        JOB.steps = [];
        JOB.running = true;
        $('deployLog').textContent = '';
        $('deploySteps').replaceChildren();
        $('btnDeployStop').hidden = false;
        $('btnDeployFull').disabled = true;
        startPolling();
        toast('作业已开始：' + pipeline, 'ok');
      })
      .catch((e) => toast('起不来：' + e.message, 'bad'));
  }

  function startPolling() {
    if (JOB.timer) clearInterval(JOB.timer);
    pollJob();
    JOB.timer = setInterval(pollJob, 500);
  }

  async function pollJob() {
    if (!JOB.id) return;
    try {
      const r = await api('GET', `/api/jobs/one?id=${encodeURIComponent(JOB.id)}&offset=${JOB.offset}`);
      JOB.offset = r.log.nextOffset;
      if (r.log.chunk) {
        const pre = $('deployLog');
        const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 30;
        pre.textContent += r.log.chunk;
        if (atBottom) pre.scrollTop = pre.scrollHeight;
      }
      JOB.steps = r.job.steps || [];
      renderJobSteps(r.job);
      const running = r.job.state === 'running';
      if (JOB.running && !running) {
        JOB.running = false;
        $('btnDeployStop').hidden = true;
        $('btnDeployFull').disabled = false;
        toast(r.job.state === 'done' ? '作业完成' : `作业结束：${r.job.state}`, r.job.state === 'done' ? 'ok' : 'bad');
        refreshState().then(() => { fillManifestHints(); });
        refreshDeploy();
      }
      if (!running && JOB.timer) { clearInterval(JOB.timer); JOB.timer = null; }
    } catch (e) {
      if (JOB.timer) { clearInterval(JOB.timer); JOB.timer = null; }
      JOB.running = false;
      $('btnDeployStop').hidden = true;
      $('btnDeployFull').disabled = false;
      toast('读日志失败：' + e.message, 'bad');
    }
  }

  const JOB_MARK = { pending: '·', start: '▶', ok: '✓', fail: '✗', skipped: '－', stopped: '■' };

  function renderJobSteps(job) {
    const box = $('deploySteps');
    if (!job.steps || !job.steps.length) {
      box.replaceChildren(el('li', null, '（还在准备…）'));
      return;
    }
    box.replaceChildren();
    job.steps.forEach((s) => {
      const li = el('li', 'st-' + (s.state || 'pending'));
      li.appendChild(el('span', 'mark', JOB_MARK[s.state] || '·'));
      li.appendChild(el('span', null, s.label || s.id));
      if (s.ms) li.appendChild(el('span', 'ms', (s.ms / 1000).toFixed(1) + 's'));
      box.appendChild(li);
    });
    const done = job.steps.filter((s) => ['ok', 'fail', 'skipped', 'stopped'].includes(s.state)).length;
    $('deployMeta').textContent = `${job.label} · ${job.state} · ${done}/${job.steps.length}${job.ms ? ' · ' + (job.ms / 1000).toFixed(1) + 's' : ''}`;
  }

  function initDeploy() {
    $('btnDeployRefresh').addEventListener('click', () => refreshDeploy().then(() => toast('已刷新', 'ok')));
    $('btnDeployFull').addEventListener('click', async () => {
      const okd = await confirmBox('一键部署并推送？', '构建 → 自检 → 组装 dist → 传热铁盒（两个站） → 推 GitHub。');
      if (okd) startJob('full');
    });
    document.querySelectorAll('#panel-deploy [data-job]').forEach((b) => {
      b.addEventListener('click', () => startJob(b.dataset.job));
    });
    $('btnDeployDiff').addEventListener('click', () => startJob('diff'));
    $('btnDeployStop').addEventListener('click', async () => {
      if (!JOB.id) return;
      const okd = await confirmBox('中止这个作业？', '会先给管线发一次 Ctrl+C，1 秒后还没停就强杀进程树。');
      if (!okd) return;
      try { await api('POST', '/api/jobs/stop', { id: JOB.id }); toast('已请求中止', 'ok'); }
      catch (e) { toast('中止失败：' + e.message, 'bad'); }
    });
    $('btnDeployClearLog').addEventListener('click', () => { $('deployLog').textContent = ''; });
    $('btnPublishAll').addEventListener('click', async () => {
      const items = queueItemsForPublish();
      const okd = await confirmBox(
        '发布队列 + 部署？',
        items.length
          ? `${items.length} 个待发布文件会先写进 /p，然后查清单，最后构建并部署到两个热铁盒站 + GitHub。`
          : '队列是空的：只会查清单，然后构建并部署到两个热铁盒站 + GitHub。',
      );
      if (!okd) return;
      try {
        const r = await api('POST', '/api/publish-all', { items });
        renderPublishPhases(r.phases || []);
        if (r.stopped) { toast('清单有错误，已拦下部署', 'bad'); return; }
        if (r.jobId) {
          JOB.id = r.jobId;
          JOB.offset = 0;
          JOB.running = true;
          $('deployLog').textContent = '';
          $('deploySteps').replaceChildren();
          $('btnDeployStop').hidden = false;
          startPolling();
          toast('已开始构建部署', 'ok');
        }
      } catch (e) { toast('失败：' + e.message, 'bad'); }
    });
  }

  function renderPublishPhases(phases) {
    const box = $('publishPhases');
    box.replaceChildren();
    phases.forEach((p) => {
      const row = el('div', 'hist-row');
      const st = p.state === 'ok' ? 'published' : p.state === 'fail' ? 'orphan' : p.state === 'running' ? 'archived' : 'draft';
      row.appendChild(el('span', 'badge ' + st, p.state));
      row.appendChild(el('span', null, p.name));
      row.appendChild(el('span', 'mono', p.detail || ''));
      box.appendChild(row);
    });
  }

  /** 队列里勾了「发布」的那些（没勾的只入队不登记） */
  function queueItemsForPublish() {
    return (S.queue || []).map((it) => ({
      name: it.name,
      target: it.target,
      title: it.title,
      group: it.group,
      text: it.text,
      dataBase64: it.dataBase64,
      publish: it.publish !== false,
      archive: !!it.archive,
      conflict: it.conflict,
    }));
  }

  /* ═══════════ #11 同步与合并 ═══════════ */

  const CL = { scan: null, picked: new Set(), domain: null };

  async function refreshCloudDomains() {
    try {
      const r = await api('GET', '/api/state');
      const rth = await api('GET', '/api/cloud/domains');
      const sel = $('cloudDomain');
      sel.replaceChildren();
      (rth.domains || []).forEach((d) => { const o = el('option', null, d); o.value = d; sel.appendChild(o); });
      if (rth.domains && rth.domains.length) sel.value = rth.domains.find((d) => d.startsWith('www.')) || rth.domains[0];
      const csel = $('cmpDomain');
      csel.replaceChildren();
      (rth.domains || []).forEach((d) => { const o = el('option', null, d); o.value = d; csel.appendChild(o); });
      if (rth.domains && rth.domains.length) csel.value = csel.options[0].value;
    } catch (e) { /* 域名拿不到不致命 */ }
  }

  function renderCloud(r) {
    CL.scan = r;
    const c = r.counts || {};
    $('cloudStats').innerHTML =
      `<div class="stat"><b>${c.local || 0}</b><span>本地文件</span></div>` +
      `<div class="stat"><b>${c.base || 0}</b><span>dist（上次部署）</span></div>` +
      `<div class="stat"><b>${c.cloud || 0}</b><span>云端文件</span></div>` +
      `<div class="stat s-arch"><b>${c['cloud-changed'] || 0}</b><span>云端更新</span></div>` +
      `<div class="stat s-draft"><b>${c.conflict || 0}</b><span>两边都改</span></div>` +
      `<div class="stat s-draft"><b>${(c['cloud-only'] || 0) + (c['local-deleted'] || 0)}</b><span>云端独有/本地已删</span></div>`;

    const lim = $('cloudLimits');
    lim.replaceChildren();
    (r.limits || []).forEach((t) => lim.appendChild(el('li', null, t)));
    (r.notes || []).forEach((t) => lim.appendChild(el('li', null, '· ' + t)));

    const body = $('cloudBody');
    body.replaceChildren();
    const diffs = r.diffs || [];
    $('cloudEmpty').hidden = diffs.length > 0;
    $('cloudEmpty').textContent = diffs.length ? '' : '没有差异：本地 / dist / 云端三方一致。';

    diffs.forEach((d) => {
      const tr = el('tr');
      const cc = el('td', 'c-check');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = CL.picked.has(d.path);
      cb.addEventListener('change', () => {
        if (cb.checked) CL.picked.add(d.path); else CL.picked.delete(d.path);
        renderCloudActions();
      });
      cc.appendChild(cb);
      tr.appendChild(cc);

      const cp = el('td', 't-path');
      cp.textContent = d.path;
      tr.appendChild(cp);

      const cs = el('td', 'c-status');
      cs.appendChild(el('span', 'badge ' + d.status, CLOUD_STATUS_TEXT[d.status] || d.status));
      tr.appendChild(cs);

      const cz = el('td', 't-size');
      cz.textContent = `${d.localBytes == null ? '—' : fmtBytes(d.localBytes)} / ${d.cloudBytes == null ? '—' : fmtBytes(d.cloudBytes)}`;
      tr.appendChild(cz);

      const ca = el('td', 'c-act');
      const acts = el('div', 'row-acts');
      const bdiff = el('button', 'btn ghost', '看差异');
      bdiff.addEventListener('click', () => showDiff(d.path));
      const bpull = el('button', 'btn', '取回云端');
      bpull.disabled = d.cloudBytes == null;
      bpull.addEventListener('click', () => pullPaths([d.path]));
      acts.appendChild(bdiff);
      acts.appendChild(bpull);
      ca.appendChild(acts);
      tr.appendChild(ca);
      body.appendChild(tr);
    });

    $('cloudActions').hidden = !diffs.length;
    renderCloudActions();
  }

  function renderCloudActions() {
    $('cloudPicked').textContent = `已选 ${CL.picked.size} 个`;
  }

  async function doScan() {
    const source = $('cloudSource').value;
    const domain = $('cloudDomain').value;
    if (source === 'retinbox') toast('热铁盒没有列目录接口，会逐个探测，可能要十几秒…', 'ok');
    else toast('正在跟 GitHub 比对…', 'ok');
    try {
      const r = await api('POST', '/api/cloud/scan', { source, domain });
      CL.picked.clear();
      renderCloud(r);
      toast(`比对完成：${(r.diffs || []).length} 处差异`, 'ok');
    } catch (e) { toast('比对失败：' + e.message, 'bad'); }
  }

  async function showDiff(path) {
    const box = $('cloudDiff');
    box.replaceChildren(el('p', 'hint', '正在取差异…'));
    try {
      const r = await api('POST', '/api/cloud/diff', { source: $('cloudSource').value, domain: $('cloudDomain').value, path });
      box.replaceChildren();
      box.appendChild(el('p', 'hint', `${r.path} · ${r.summary}`));
      if (r.hunks && r.hunks.length) {
        const wrap = el('div', 'diff');
        r.hunks.slice(0, 400).forEach((h) => {
          const line = el('div', 'diff-line ' + (h.type === 'add' ? 'add' : 'del'));
          line.appendChild(el('span', 'ln', String(h.line)));
          line.appendChild(el('span', null, (h.type === 'add' ? '+ ' : '- ') + h.text));
          wrap.appendChild(line);
        });
        box.appendChild(wrap);
      }
    } catch (e) { box.replaceChildren(el('p', 'hint', '取差异失败：' + e.message)); }
  }

  async function pullPaths(paths, force = false) {
    if (!paths.length) { toast('先选几个文件', 'bad'); return; }
    const okd = await confirmBox(
      `取回 ${paths.length} 个文件的云端版本？`,
      '本地已有的会先备份到 console/backups/<时间戳>/，然后被云端内容覆盖。',
    );
    if (!okd) return;
    try {
      const r = await api('POST', '/api/cloud/pull', {
        source: $('cloudSource').value, domain: $('cloudDomain').value, paths, force,
      });
      const fails = (r.results || []).filter((x) => !x.ok);
      toast(`取回 ${r.pulled} 个${fails.length ? `，${fails.length} 个没取成` : ''}`, fails.length ? 'bad' : 'ok');
      fails.slice(0, 5).forEach((f) => toast(`${f.path}：${f.reason}`, 'bad'));
      CL.picked.clear();
      await refreshState();
      await doScan();
    } catch (e) { toast('取回失败：' + e.message, 'bad'); }
  }

  async function doPrecheck() {
    const box = $('precheckBody');
    box.replaceChildren(el('p', 'hint', '正在预检…（会比对 + 查域名，十秒左右）'));
    try {
      const r = await api('POST', '/api/cloud/precheck', { source: $('cloudSource').value, domain: $('cloudDomain').value });
      box.replaceChildren();
      const card = (title, list, kind) => {
        const b = el('div', 'problem ' + (kind || 'info'));
        const body = el('div', 'p-body');
        body.appendChild(el('span', 'p-title', title));
        if (list && list.length) body.appendChild(el('span', 'p-meta', list.slice(0, 12).join('、') + (list.length > 12 ? ` …共 ${list.length} 个` : '')));
        b.appendChild(body);
        return b;
      };
      box.appendChild(card(`会覆盖云端改动：${r.overwrite.length}`, r.overwrite.map((x) => x.path), r.overwrite.length ? 'warn' : null));
      box.appendChild(card(`发布可能删掉云端：${r.deleteOnCloud.length}`, r.deleteOnCloud.map((x) => x.path), r.deleteOnCloud.length ? 'err' : null));
      box.appendChild(card(`清单问题：${r.manifest.problems.length}（错误 ${r.manifest.errors}）`,
        r.manifest.problems.map((p) => p.kind), r.manifest.errors ? 'err' : null));
      (r.domains || []).forEach((d) => {
        box.appendChild(card(
          `域名 ${d.domain}：${d.ok ? 'HTTP ' + d.status : d.reason}`,
          [], d.ok ? null : 'err',
        ));
      });
      box.appendChild(el('p', 'hint', `基准：dist（${r.base.files} 个文件${r.base.at ? ' · ' + r.base.at.slice(0, 16).replace('T', ' ') : ''}）· 本地 ${r.siteFiles} 个文件`));
    } catch (e) { box.replaceChildren(el('p', 'hint', '预检失败：' + e.message)); }
  }

  function initCloud() {
    $('btnCloudScan').addEventListener('click', doScan);
    $('btnPrecheck').addEventListener('click', doPrecheck);
    $('btnCloudPullPicked').addEventListener('click', () => pullPaths([...CL.picked]));
    $('btnCloudPullOnly').addEventListener('click', () => {
      const r = CL.scan;
      if (!r) return;
      pullPaths(r.diffs.filter((d) => d.status === 'cloud-only' || d.status === 'local-deleted').map((d) => d.path));
    });
    $('btnCloudPullChanged').addEventListener('click', () => {
      const r = CL.scan;
      if (!r) return;
      pullPaths(r.diffs.filter((d) => d.status === 'cloud-changed' || d.status === 'conflict').map((d) => d.path));
    });
    $('btnCloudClear').addEventListener('click', () => { CL.picked.clear(); renderCloud(CL.scan || { counts: {}, diffs: [] }); });
    $('cloudCheckAll').addEventListener('change', (e) => {
      if (!CL.scan) return;
      CL.picked.clear();
      if (e.target.checked) CL.scan.diffs.forEach((d) => { if (d.cloudBytes != null) CL.picked.add(d.path); });
      renderCloud(CL.scan);
    });
    $('cloudSource').addEventListener('change', () => {
      const isGithub = $('cloudSource').value === 'github';
      $('cloudDomain').disabled = isGithub;
    });
    $('cloudDomain').disabled = true;
  }

  /* ═══════════ #12 检查（死链 / 资源） ═══════════ */

  async function runLinkCheck(scope) {
    try {
      const r = await api('POST', '/api/links/scan', { scope });
      const c = r.checked || {};
      $('checkStats').innerHTML =
        `<div class="stat"><b>${c.files || 0}</b><span>检查文件</span></div>` +
        `<div class="stat"><b>${c.links || 0}</b><span>链接</span></div>` +
        `<div class="stat"><b>${c.images || 0}</b><span>图片</span></div>` +
        `<div class="stat ${r.problems.length ? 's-draft' : 's-pub'}"><b>${r.problems.length}</b><span>问题</span></div>`;
      const body = $('checkBody');
      body.replaceChildren();
      $('checkEmpty').hidden = r.problems.length > 0;
      $('checkEmpty').textContent = r.problems.length ? '' : '没有发现问题。';
      r.problems.forEach((p) => {
        const tr = el('tr');
        tr.appendChild(el('td', 't-path', `${p.file}:${p.line || '?'}`));
        const cs = el('td');
        cs.appendChild(el('span', 'badge ' + (p.kind === 'image' ? 'draft' : 'orphan'), p.kind === 'image' ? '图片' : p.kind === 'card' ? '卡片' : '链接'));
        tr.appendChild(cs);
        tr.appendChild(el('td', 't-path', p.href));
        tr.appendChild(el('td', null, p.reason));
        body.appendChild(tr);
      });
      toast(r.problems.length ? `发现 ${r.problems.length} 处问题` : '没有发现问题', r.problems.length ? 'bad' : 'ok');
    } catch (e) { toast('检查失败：' + e.message, 'bad'); }
  }

  function initCheck() {
    $('btnCheckScopeP').addEventListener('click', () => runLinkCheck('p'));
    $('btnCheckScopeAll').addEventListener('click', () => runLinkCheck('all'));
    $('btnCheckRun').addEventListener('click', () => { setView('deploy'); startJob('check'); });
  }

  /* ═══════════ #13 本地 / 线上对照 ═══════════ */

  function cmpFillDocs() {
    const sel = $('cmpDoc');
    const cur = sel.value;
    sel.replaceChildren();
    (S.articles || []).filter((a) => a.kind === 'md' || a.kind === 'html').forEach((a) => {
      const o = el('option', null, `${a.title || a.path}（${a.path}）`);
      o.value = a.path;
      sel.appendChild(o);
    });
    if (cur) sel.value = cur;
  }

  function cmpLoad() {
    const path = $('cmpDoc').value;
    if (!path) { toast('清单里还没有文章', 'bad'); return; }
    const hash = '#' + encodeURIComponent(path);
    const localUrl = location.origin + '/p/docs.html' + hash;
    const domain = $('cmpDomain').value;
    const cloudUrl = domain ? `https://${domain}/p/docs.html${hash}` : '';
    $('cmpLocal').src = localUrl;
    $('cmpLocalUrl').textContent = localUrl.replace(location.origin, '');
    if (cloudUrl) {
      $('cmpCloud').src = cloudUrl;
      $('cmpCloudUrl').textContent = cloudUrl.replace('https://', '');
    }
    $('cmpMeta').textContent = `文档：${path} · 线上域名：${domain || '（rth-sites.json 没配域名）'}`;
    const note = $('cmpNote');
    note.hidden = false;
    note.textContent = '提示：线上那份是「已经发上去的版本」。改了还没部署，两边就会不一样 —— 这正是这个面板要看的。';
  }

  function initCompare() {
    $('btnCmpReload').addEventListener('click', cmpLoad);
    $('btnCmpTabs').addEventListener('click', () => {
      const path = $('cmpDoc').value;
      if (!path) return;
      const hash = '#' + encodeURIComponent(path);
      window.open(location.origin + '/p/docs.html' + hash, '_blank', 'noopener');
      const domain = $('cmpDomain').value;
      if (domain) window.open(`https://${domain}/p/docs.html${hash}`, '_blank', 'noopener');
    });
    $('cmpDoc').addEventListener('change', cmpLoad);
    $('cmpDomain').addEventListener('change', cmpLoad);
  }

  const CLOUD_STATUS_TEXT = {
    same: '一致',
    'cloud-changed': '云端更新',
    'local-changed': '本地更新',
    'cloud-only': '云端独有',
    'local-new': '本地新增',
    'local-deleted': '本地已删',
    conflict: '两边都改',
  };

  /* ═══════════ #8 启动 / 路由 / 刷新 ═══════════ */

  const VIEWS = ['write', 'manage', 'manifest', 'archive', 'assets', 'deploy', 'cloud', 'check', 'compare', 'settings'];

  function setView(name, { focusTab } = {}) {
    if (!VIEWS.includes(name)) name = 'write';
    if (location.hash.slice(1) !== name) {
      try { history.replaceState(null, '', '#' + name); } catch { /* 忽略 */ }
    }
    VIEWS.forEach((v) => {
      const panel = $('panel-' + v);
      const tab = $('tab-' + v);
      const on = v === name;
      panel.hidden = !on;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
    });
    if (focusTab) $('tab-' + name).focus();
    if (name === 'manage') renderManage();
    if (name === 'manifest') { refreshManifest(); fillManifestHints(); }
    if (name === 'archive') renderArchive();
    if (name === 'assets') renderAssets();
    if (name === 'deploy') refreshDeploy();
    if (name === 'cloud') { refreshCloudDomains(); if (CL.scan) renderCloud(CL.scan); }
    if (name === 'compare') { refreshCloudDomains(); cmpFillDocs(); if ($('cmpDoc').value) cmpLoad(); }
    if (name === 'settings') renderSettings();
    if (name === 'write' && MD_CUR) MD_CUR.focus();
  }

  function initNav() {
    const nav = $('nav');
    nav.addEventListener('click', (e) => {
      const b = e.target.closest('.nav-item');
      if (b) setView(b.dataset.view);
    });
    /* 键盘上下切换（roving tabindex） */
    nav.addEventListener('keydown', (e) => {
      const cur = document.activeElement && document.activeElement.classList.contains('nav-item')
        ? document.activeElement : null;
      if (!cur) return;
      const idx = VIEWS.indexOf(cur.dataset.view);
      let next = null;
      if (e.key === 'ArrowDown') next = (idx + 1) % VIEWS.length;
      else if (e.key === 'ArrowUp') next = (idx - 1 + VIEWS.length) % VIEWS.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = VIEWS.length - 1;
      if (next == null) return;
      e.preventDefault();
      setView(VIEWS[next], { focusTab: true });
    });
    window.addEventListener('hashchange', () => setView(location.hash.slice(1) || 'write'));

    $('selfCheck').addEventListener('click', async () => {
      try {
        const r = await api('GET', '/api/selfcheck');
        if (r.ok) toast('环境正常：核心就绪、sk.json 可读、登记都有对应文件', 'ok');
        else r.problems.forEach((p) => toast(p, 'bad'));
      } catch (e) { toast('自检失败：' + e.message, 'bad'); }
    });
  }

  async function refreshState() {
    S.state = await api('GET', '/api/state');
    S.groups = S.state.groups || [];
    S.stats = S.state.stats || {};
    document.documentElement.dataset.theme = S.state.settings.uiTheme === 'light' ? 'light' : 'dark';
    document.documentElement.style.setProperty('--editor-fs', S.state.settings.editorFontSize + 'px');
    CONFIRM_DANGER = !!S.state.settings.confirmDanger;

    const list = await api('GET', '/api/articles');
    S.articles = list.articles || [];
    S.stats = list.stats || S.stats;
    S.archive = await api('GET', '/api/archive');

    renderStats();
    fillGroupSelects();
    fillPathHints();
    updateBrandStat();
  }

  function renderStats() {
    const st = S.stats;
    $('stats').innerHTML =
      `<div class="stat"><b>${st.total || 0}</b><span>总篇数</span></div>` +
      `<div class="stat s-draft"><b>${st.draft || 0}</b><span>草稿</span></div>` +
      `<div class="stat s-pub"><b>${st.published || 0}</b><span>已发布</span></div>` +
      `<div class="stat s-arch"><b>${st.archived || 0}</b><span>已归档</span></div>` +
      `<div class="stat"><b>${st.unpublished || 0}</b><span>未发布</span></div>` +
      `<div class="stat"><b>${st.media || 0}</b><span>素材</span></div>` +
      `<div class="stat"><b>${fmtBytes(st.archivedBytes || 0)}</b><span>归档体积</span></div>`;
  }

  function fillGroupSelects() {
    const gsel = $('writeGroup');
    const cur = gsel.value;
    gsel.replaceChildren();
    const opt = el('option', null, '（不登记）'); opt.value = ''; gsel.appendChild(opt);
    S.groups.forEach((g) => { const o = el('option', null, g); o.value = g; gsel.appendChild(o); });
    gsel.value = S.groups.includes(cur) ? cur : (S.groups[0] || '');

    const bsel = $('bulkGroup');
    bsel.replaceChildren();
    S.groups.forEach((g) => { const o = el('option', null, g); o.value = g; bsel.appendChild(o); });
  }

  function fillPathHints() {
    const dl = $('pathHints');
    dl.replaceChildren();
    S.articles.filter((a) => a.kind === 'md').slice(0, 200).forEach((a) => {
      const o = el('option'); o.value = a.path; dl.appendChild(o);
    });
  }

  function updateBrandStat() {
    const st = S.stats;
    $('brandStat').textContent = `${st.total || 0} 篇 · ${st.draft || 0} 草稿 · ${st.archived || 0} 归档`;
  }

  async function boot() {
    try {
      collapsed = JSON.parse(localStorage.getItem('console.collapsed') || '{}') || {};
    } catch { collapsed = {}; }

    try {
      await refreshState();
    } catch (e) {
      toast('读不到状态：' + e.message, 'bad');
      return;
    }

    initNav();
    initWrite();
    initManage();
    initManifest();
    initArchive();
    initAssets();
    initDeploy();
    initCloud();
    initCheck();
    initCompare();
    initSettings();
    initDrop();

    /* 自检小灯 */
    try {
      const sc = await api('GET', '/api/selfcheck');
      $('selfDot').className = 'dot ' + (sc.ok ? 'ok' : 'bad');
      $('selfText').textContent = sc.ok ? '环境正常' : ('自检 ' + sc.problems.length + ' 项异常');
      $('selfCheck').title = sc.ok ? '核心就绪、sk.json 可读、登记都有对应文件' : sc.problems.join('\n');
    } catch { /* 忽略 */ }

    setView(location.hash.slice(1) || 'write');

    /* 离开前提醒没保存 */
    window.addEventListener('beforeunload', (e) => {
      if (!S.dirty) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
