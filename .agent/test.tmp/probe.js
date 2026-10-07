<script>
(function(){
  function run(){
    var p = document.getElementById('panel');
    var ws = document.querySelector('.workspace');
    var st = document.getElementById('stage');
    var app = document.querySelector('.app');
    var tv = document.getElementById('tableView');
    var cs = getComputedStyle(p);
    var L = [];
    L.push('innerW=' + innerWidth + ' innerH=' + innerHeight + ' dpr=' + devicePixelRatio);
    L.push('m880=' + matchMedia('(max-width:880px)').matches + ' m560=' + matchMedia('(max-width:560px)').matches);
    L.push('app.h=' + app.offsetHeight + ' ws.h=' + ws.offsetHeight + ' ws.ch=' + ws.clientHeight
      + ' ws.ov=' + getComputedStyle(ws).overflow);
    L.push('stage.h=' + st.offsetHeight + ' tv.h=' + tv.offsetHeight);
    L.push('collapsed=' + ws.classList.contains('panel-collapsed'));
    L.push('panel h=' + cs.height + ' offH=' + p.offsetHeight + ' ch=' + p.clientHeight
      + ' sh=' + p.scrollHeight + ' ovY=' + cs.overflowY + ' flex=' + cs.flex + ' minH=' + cs.minHeight);
    L.push('可滚=' + (p.scrollHeight > p.clientHeight + 1));
    var d = document.createElement('div');
    d.id = '__probe';
    d.style.cssText = 'position:fixed;z-index:99999;left:0;right:0;top:0;max-height:46vh;overflow:auto;'
      + 'background:#000;color:#0f0;font:12px/1.5 ui-monospace,monospace;padding:6px 8px;white-space:pre-wrap;word-break:break-all';
    d.textContent = L.join('\n');
    document.body.appendChild(d);
  }
  if (document.readyState === 'complete') setTimeout(run, 400);
  else addEventListener('load', function(){ setTimeout(run, 400); });
})();
</script>
