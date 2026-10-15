/* ui/settings/settings.js —— 设置面板：读 state 画，点一下送回主进程 */
(function () {
  'use strict';

  var opts = document.getElementById('opts');
  var scrim = document.getElementById('scrim');
  var autoFallback = document.getElementById('autoFallback');
  var offlineFallback = document.getElementById('offlineFallback');
  var zoomVal = document.getElementById('zoomVal');
  var curUrl = document.getElementById('curUrl');
  var ver = document.getElementById('ver');

  var builtFor = null;

  function act(name, payload) {
    return window.jsd.action(name, payload).catch(function () {});
  }

  function isCloud(id) {
    return id !== 'local';
  }

  function buildOpts(state) {
    opts.textContent = '';
    (state.origins || []).forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'opt';
      b.dataset.origin = o.id;

      var radio = document.createElement('span');
      radio.className = 'radio';

      var main = document.createElement('span');
      main.className = 'opt-main';
      var name = document.createElement('b');
      name.textContent = o.label;
      var host = document.createElement('em');
      host.textContent = isCloud(o.id) ? o.url : 'http://127.0.0.1（本地快照）';
      var desc = document.createElement('i');
      desc.textContent = o.desc;
      main.appendChild(name);
      main.appendChild(host);
      main.appendChild(desc);

      b.appendChild(radio);
      b.appendChild(main);

      if (o.id === state.settings.originId) {
        var tag = document.createElement('span');
        tag.className = 'opt-tag';
        tag.textContent = state.mode === 'error' ? '打不开' : '当前';
        b.appendChild(tag);
      }
      opts.appendChild(b);
    });
  }

  function render(state) {
    if (!state) return;
    var sig = (state.origins || []).map(function (o) {
      return o.id;
    }).join(',') + '|' + state.settings.originId + '|' + state.mode;
    if (sig !== builtFor) {
      builtFor = sig;
      buildOpts(state);
    }
    Array.prototype.forEach.call(opts.querySelectorAll('[data-origin]'), function (el) {
      el.classList.toggle('on', el.dataset.origin === state.settings.originId);
    });

    autoFallback.checked = !!state.settings.autoFallback;
    offlineFallback.checked = !!state.settings.offlineFallback;
    zoomVal.textContent = Math.round((state.settings.zoom || 1) * 100) + '%';
    curUrl.textContent = state.url || '—';
    ver.textContent = 'JinSuper 百宝箱 ' + state.version + '（Electron 桌面版）';
  }

  /* ── 云端同步：状态、按钮、访问方式（含备案那一项） ── */
  var syncUi = {
    channel: document.getElementById('syncChannel'),
    cloud: document.getElementById('syncCloud'),
    local: document.getElementById('syncLocal'),
    diff: document.getElementById('syncDiff'),
    msg: document.getElementById('syncMsg'),
    repo: document.getElementById('syncRepo'),
    token: document.getElementById('syncToken'),
    base: document.getElementById('syncBase'),
    access: document.getElementById('syncAccess'),
    accessHint: document.getElementById('syncAccessHint'),
    beian: document.getElementById('beianBox'),
  };
  var syncState = null;
  var accessBuilt = false;

  function syncSay(text, kind) {
    syncUi.msg.textContent = text || '';
    syncUi.msg.className = 'hint' + (kind === 'bad' ? ' bad' : kind === 'ok' ? ' ok' : '');
  }

  function fmtDiff(s) {
    if (!s || !s.ready) return '';
    if (!s.cloud) return '云端还没有镜像 —— 家里先跑一次「部署.cmd sync push」。';
    if (!s.diff) return '云端 ' + s.cloud.count + ' 个文件 · 本机 ' + s.local.count + ' 个文件。';
    if (!s.diff.changed) return '本机已是最新（云端 ' + s.cloud.count + ' 个文件）。';
    return '要更新 ' + s.diff.toDownload + ' 个文件' + (s.diff.extra ? '，清理 ' + s.diff.extra + ' 个' : '') + '。';
  }

  function buildAccess(s) {
    var items = [
      { id: 'gitee', label: 'Gitee（免备案，默认）', desc: '学校实测可达；镜像挂在 Gitee 仓库里，不需要备案。' },
      { id: 'custom', label: '自定义域名 / 对象存储（需 ICP 备案）', desc: '用自己的域名或国内对象存储加速，必须先办 ICP 备案。' },
    ];
    syncUi.access.textContent = '';
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'opt';
      b.dataset.syncAccess = it.id;
      var radio = document.createElement('span');
      radio.className = 'radio';
      var main = document.createElement('span');
      main.className = 'opt-main';
      var name = document.createElement('b');
      name.textContent = it.label;
      var desc = document.createElement('i');
      desc.textContent = it.desc;
      main.appendChild(name);
      main.appendChild(desc);
      b.appendChild(radio);
      b.appendChild(main);
      syncUi.access.appendChild(b);
    });
    accessBuilt = true;
  }

  function renderSync(s) {
    syncState = s;
    if (!s) { syncUi.channel.textContent = '读不到同步状态'; return; }
    syncUi.channel.textContent = s.ready || s.cloud || s.local ? (s.channel || '') : (s.channel || '');
    if (s.problems && s.problems.length) {
      syncUi.channel.textContent = '还没配好：' + s.problems.join('；');
    } else if (s.error) {
      syncUi.channel.textContent = (s.channel || '') + ' · ' + s.error;
    }
    syncUi.cloud.textContent = s.cloud ? (s.cloud.version || '未标注版本') + ' · ' + s.cloud.count + ' 个文件 · ' + (s.cloud.builtAt || '').slice(0, 19) : '还没有';
    syncUi.local.textContent = s.local.count + ' 个文件';
    syncUi.diff.textContent = fmtDiff(s);
    if (s.queue && s.queue.length) syncSay('本机队列里还有 ' + s.queue.length + ' 份没传上去（点了「重试队列」就传）');
    if (!syncUi.repo.value && s.settings && (s.settings.owner || s.settings.repo)) {
      syncUi.repo.value = (s.settings.owner ? s.settings.owner + '/' : '') + (s.settings.repo || '');
    }
    if (syncUi.base && !syncUi.base.value && s.settings) syncUi.base.value = s.settings.publicBase || '';
    if (!accessBuilt) buildAccess(s);
    var usingCustom = !!(s.settings && s.settings.publicBase);
    Array.prototype.forEach.call(syncUi.access.querySelectorAll('[data-sync-access]'), function (el) {
      el.classList.toggle('on', usingCustom ? el.dataset.syncAccess === 'custom' : el.dataset.syncAccess === 'gitee');
    });
    syncUi.beian.hidden = !usingCustom;
    syncUi.accessHint.textContent = usingCustom
      ? '你选了自定义域名：上线前必须先办 ICP 备案（下面有办理说明和入口）。'
      : 'Gitee 走的是国内域名，不需要备案。只有把镜像挂到自己的域名 / 国内对象存储自定义域名上才要办 ICP 备案。';
  }

  function refreshSync() {
    return act('syncState').then(renderSync).catch(function (e) {
      syncSay('读同步状态失败：' + e.message, 'bad');
    });
  }

  function saveSyncSettings(patch) {
    var repoVal = (syncUi.repo.value || '').trim();
    var body = patch || {};
    if (!patch) {
      var parts = repoVal.split('/');
      body = {
        owner: parts.length > 1 ? parts[0] : '',
        repo: parts.length > 1 ? parts[1] : repoVal,
        token: (syncUi.token.value || '').trim(),
        publicBase: (syncUi.base.value || '').trim(),
      };
    }
    return act('syncSaveSettings', body).then(function (res) {
      if (res && res.state) renderSync(res.state);
      syncSay(res && res.ok ? '设置已保存' : '保存失败', res && res.ok ? 'ok' : 'bad');
    });
  }

  document.addEventListener('click', function (e) {
    var origin = e.target.closest('[data-origin]');
    if (origin) return act('setOrigin', { id: origin.dataset.origin });

    var zoom = e.target.closest('[data-zoom]');
    if (zoom) return act('zoom', { delta: Number(zoom.dataset.zoom) });
    if (e.target.closest('[data-zoom-reset]')) return act('zoom', { value: 1 });

    var access = e.target.closest('[data-sync-access]');
    if (access) return saveSyncSettings({ publicBase: access.dataset.syncAccess === 'gitee' ? '' : (syncUi.base.value || 'https://') });

    var syncBtn = e.target.closest('[data-sync]');
    if (syncBtn) {
      var what = syncBtn.dataset.sync;
      syncBtn.disabled = true;
      syncSay('正在处理…');
      var p;
      if (what === 'check') p = refreshSync();
      else if (what === 'save') p = saveSyncSettings();
      else if (what === 'openBeian') p = act('openUrl', { url: 'https://beian.miit.gov.cn/' }).then(function (r) {
        syncSay(r && r.ok ? '已用系统浏览器打开备案入口' : '打不开备案入口', r && r.ok ? 'ok' : 'bad');
      });
      else p = act('sync' + what.charAt(0).toUpperCase() + what.slice(1)).then(function (res) {
        if (res && res.state) renderSync(res.state);
        if (res && res.ok === false && !res.canceled) syncSay(res.error || res.reason || '没成功', 'bad');
        else if (res && res.downloaded !== undefined) syncSay('更新了 ' + res.downloaded + ' 个文件（云端 ' + (res.version || '') + '）', 'ok');
        else if (res && res.uploaded) syncSay('已上传 ' + res.uploaded.count + ' 个文件到云端收件箱', 'ok');
        else if (res && res.done) syncSay('队列已传完（' + res.done.length + ' 份）', 'ok');
        else if (!res || res.canceled) syncSay('');
      });
      return Promise.resolve(p).catch(function (err) {
        syncSay('失败了：' + (err && err.message ? err.message : err), 'bad');
      }).then(function () { syncBtn.disabled = false; });
    }

    var el = e.target.closest('[data-act]');
    if (el) act(el.dataset.act);
  });

  /* 上传进度（主进程推过来的） */
  if (window.jsd.onSyncProgress) {
    window.jsd.onSyncProgress(function (p) {
      if (!p) return;
      if (p.phase === 'download') syncSay('正在下载 ' + p.done + '/' + p.total + '：' + (p.rel || ''));
      else if (p.phase === 'seed') syncSay('第一次更新：先把随包副本复制出来 ' + p.done + '/' + p.total);
      else if (p.phase === 'upload') syncSay('正在上传 ' + p.done + '/' + p.total);
    });
  }

  scrim.addEventListener('click', function () {
    act('closeSettings');
  });

  autoFallback.addEventListener('change', function () {
    act('setSetting', { key: 'autoFallback', value: autoFallback.checked });
  });
  offlineFallback.addEventListener('change', function () {
    act('setSetting', { key: 'offlineFallback', value: offlineFallback.checked });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') act('closeSettings');
  });

  window.jsd.onState(render);
  window.jsd.getState().then(render);
  refreshSync();
})();
