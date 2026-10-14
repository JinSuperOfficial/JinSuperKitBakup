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

  document.addEventListener('click', function (e) {
    var origin = e.target.closest('[data-origin]');
    if (origin) return act('setOrigin', { id: origin.dataset.origin });

    var zoom = e.target.closest('[data-zoom]');
    if (zoom) return act('zoom', { delta: Number(zoom.dataset.zoom) });
    if (e.target.closest('[data-zoom-reset]')) return act('zoom', { value: 1 });

    var el = e.target.closest('[data-act]');
    if (el) act(el.dataset.act);
  });

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
})();
