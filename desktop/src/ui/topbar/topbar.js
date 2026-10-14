/* ui/topbar/topbar.js —— 只干两件事：把主进程推来的 state 画出来，把点击送回去 */
(function () {
  'use strict';

  var bar = document.getElementById('bar');
  var nav = document.getElementById('nav');
  var chip = document.getElementById('chip');
  var chipText = document.getElementById('chipText');
  var pageTitle = document.getElementById('pageTitle');
  var progress = document.getElementById('progress');
  var btnBack = document.getElementById('btnBack');
  var btnMax = document.getElementById('btnMax');
  var maxIcon = document.getElementById('maxIcon');
  var dragzone = document.getElementById('dragzone');

  var MAXIMIZE_RECT =
    '<rect x="6" y="6" width="12" height="12" rx="1.6"/>';
  var RESTORE_RECT =
    '<rect x="5.4" y="8.4" width="10.2" height="10.2" rx="1.5"/>' +
    '<path d="M8.6 8.4V6.9a1.5 1.5 0 0 1 1.5-1.5h6.4a1.5 1.5 0 0 1 1.5 1.5v6.4a1.5 1.5 0 0 1-1.5 1.5h-1.5"/>';

  function act(name, payload) {
    return window.jsd.action(name, payload).catch(function () {});
  }

  /** 当前地址算不算某个导航项的落地页 */
  function isActive(state, item) {
    var p = state.path || '';
    if (item.path === '/') return p === '/' || p === '/index.html' || p === '';
    if (item.path.slice(-1) === '/') return p.indexOf(item.path) === 0;
    return p === item.path;
  }

  function render(state) {
    if (!state) return;

    // 导航高亮 + 上一页可用性
    Array.prototype.forEach.call(nav.querySelectorAll('[data-nav]'), function (el) {
      var item = (state.nav || []).filter(function (n) {
        return n.id === el.dataset.nav;
      })[0];
      el.classList.toggle('on', !!item && isActive(state, item));
    });
    btnBack.disabled = !state.canGoBack;

    // 标题
    pageTitle.textContent = state.title || '';

    // 来源徽章
    chip.classList.toggle('local', state.mode === 'local');
    chip.classList.toggle('error', state.mode === 'error' || !!(state.error && state.mode === 'error'));
    var label = state.originLabel || '来源';
    var host = '';
    (state.origins || []).forEach(function (o) {
      if (o.id === state.originId) host = o.host;
    });
    chipText.textContent =
      state.mode === 'error' ? '打不开 · 设置' : state.mode === 'local' ? '离线副本' : label + ' · ' + host;

    // 最大化 / 还原图标
    maxIcon.innerHTML = state.maximized ? RESTORE_RECT : MAXIMIZE_RECT;
    btnMax.title = state.maximized ? '还原' : '最大化';

    progress.hidden = !state.loading;
  }

  bar.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act],[data-nav]');
    if (!el || el.disabled) return;
    if (el.dataset.nav) return act('goto', { id: el.dataset.nav });
    act(el.dataset.act);
  });

  // 双击标题栏 = 最大化 / 还原（无边框窗口得自己来）
  dragzone.addEventListener('dblclick', function () {
    act('maximize');
  });

  window.jsd.onState(render);
  window.jsd.getState().then(render);
})();
