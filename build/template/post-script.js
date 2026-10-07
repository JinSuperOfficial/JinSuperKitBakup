/* ═══════════════════════════════════════════════════
   文章页的小增强（选项卡 / 代码组 / 复制按钮 / 剧透 / 目录高亮）
   ---------------------------------------------------
   这一份被两处共用，**不要再抄第二遍**：
     · 构建期的静态文章页 `/p/post/*.html`（build/build.mjs 注入）
     · 控制台烘的归档稿 `/p/archive/*.html`（console/lib/render.mjs）

   只做「让静态页面用起来像阅读器」这几件事，不引入任何库。
   脚本挂了页面照样能读：没有它时代码组全都摊开、剧透直接打开
   （见 post-chrome.css 里 html:not(.has-js) 那几条）。
   ═══════════════════════════════════════════════════ */
(function(){
  'use strict';
  var root = document.getElementById('post');
  if (!root) return;

  /* ── 选项卡 ::: tabs ── */
  root.querySelectorAll('.tabs-tabs-wrapper').forEach(function(box){
    var btns = box.querySelectorAll('.tabs-tab-button');
    var panes = box.querySelectorAll('.tabs-tab-content');
    function activate(i){
      btns.forEach(function(b, j){
        var on = j === i;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      });
      panes.forEach(function(p, j){ p.classList.toggle('active', j === i); });
    }
    btns.forEach(function(b, i){
      b.addEventListener('click', function(){ activate(i); });
      b.addEventListener('keydown', function(e){
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        var next = (i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length;
        activate(next);
        if (btns[next]) btns[next].focus();
      });
    });
  });

  /* ── 代码组 ::: code-group：标签按钮按真实面板数生成 ── */
  root.querySelectorAll('.code-group').forEach(function(group){
    var tabs = group.querySelector('.cg-tabs');
    var panels = group.querySelectorAll('.cg-panel');
    if (!tabs || panels.length < 2) return;
    function activate(i){
      panels.forEach(function(p, j){ p.hidden = j !== i; });
      tabs.querySelectorAll('.cg-tab').forEach(function(b, j){
        b.classList.toggle('is-active', j === i);
        b.setAttribute('aria-selected', j === i ? 'true' : 'false');
      });
    }
    panels.forEach(function(panel, i){
      var label = panel.getAttribute('data-label') || panel.getAttribute('data-lang') || ('代码 ' + (i + 1));
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cg-tab' + (i === 0 ? ' is-active' : '');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      btn.textContent = label;
      btn.addEventListener('click', function(){ activate(i); });
      tabs.appendChild(btn);
    });
    activate(0);
  });

  /* ── 复制代码：每个代码块（含代码组里的面板）各给一个按钮 ── */
  root.querySelectorAll('pre > code').forEach(function(code){
    var pre = code.parentNode;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'md-copy';
    btn.textContent = '复制';
    btn.addEventListener('click', function(){
      var text = code.innerText;
      var done = function(ok){
        btn.textContent = ok ? '已复制' : '复制失败';
        setTimeout(function(){ btn.textContent = '复制'; }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(function(){ done(true); }, function(){ done(false); });
        return;
      }
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        done(ok);
      } catch (e) { done(false); }
    });
    pre.appendChild(btn);
  });

  /* ── 剧透块 >! ── */
  root.querySelectorAll('.md-spoiler').forEach(function(box){
    var head = box.querySelector('.md-spoiler-head');
    if (!head) return;
    function set(open){
      box.setAttribute('data-open', open ? 'true' : 'false');
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    set(box.getAttribute('data-open') === 'true');
    head.addEventListener('click', function(){ set(box.getAttribute('data-open') !== 'true'); });
  });

  /* ── 侧栏目录：滚动时高亮当前小节（目录是生成期写好的，
        没有目录时这一整块就不存在，脚本什么都不用做） ── */
  var toc = document.getElementById('ptoc');
  var tocList = document.getElementById('ptocList');
  if (toc && tocList && tocList.children.length){
    var links = Array.prototype.slice.call(tocList.querySelectorAll('a'));
    var barH = document.querySelector('.top');
    barH = barH ? barH.offsetHeight : 52;
    function onScroll(){
      var line = barH + 24;
      var current = null;
      for (var i = 0; i < links.length; i++){
        var target = document.getElementById(links[i].dataset.target);
        if (!target) continue;
        if (target.getBoundingClientRect().top <= line) current = links[i];
        else break;
      }
      links.forEach(function(a){ a.classList.toggle('active', a === current); });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();
  }

  /* ── 顶栏副标题：把「第几篇 / 共几篇」这类位置感补上（纯装饰） ── */
  var meta = document.querySelector('meta[name="x-post-index"]');
  if (meta){
    var sub = document.getElementById('brandSub');
    if (sub) sub.textContent = meta.getAttribute('content');
  }
})();
