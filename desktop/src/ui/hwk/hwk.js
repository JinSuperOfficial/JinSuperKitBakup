/* ui/hwk/hwk.js —— 作业编辑器：先写本地，再谈上云
 * ---------------------------------------------------------------
 * 这个窗口不加载站点（断网也能用），所以它只跟主进程打交道：
 *   hwk.action('list'|'read'|'save'|'snapshot'|'sync'|'flush'|'close'…)
 * 「保存到本地」写 userData/hwk；「同步到云端」先在本机出快照再上传，
 * 上传失败会自动进队列，下次点一下就好。
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var state = null;
  var current = { date: '', id: '', title: '' };
  var dirty = false;

  function act(name, payload) {
    return window.hwk.action(name, payload);
  }

  function setStatus(text, kind) {
    var el = $('status');
    el.textContent = text || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function idFromDate(date) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
    return m ? 'n' + m[1].slice(2) + m[2] + m[3] : '';
  }

  /* ── 科目行 ── */
  function subjectRow(name, text) {
    var row = document.createElement('div');
    row.className = 'subj';

    var n = document.createElement('input');
    n.type = 'text';
    n.value = name || '';
    n.setAttribute('aria-label', '科目名');
    n.addEventListener('input', markDirty);

    var t = document.createElement('textarea');
    t.rows = 2;
    t.value = text || '';
    t.placeholder = '这一科的作业内容';
    t.setAttribute('aria-label', (name || '科目') + '的内容');
    t.addEventListener('input', markDirty);

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.title = '删掉这一科';
    del.setAttribute('aria-label', '删掉这一科');
    del.textContent = '×';
    del.addEventListener('click', function () { row.remove(); markDirty(); });

    row.appendChild(n);
    row.appendChild(t);
    row.appendChild(del);
    return row;
  }

  function addSubject(name, text) {
    $('subjects').appendChild(subjectRow(name, text));
  }

  function collect() {
    var subjects = [];
    Array.prototype.forEach.call($('subjects').querySelectorAll('.subj'), function (row) {
      var inputs = row.querySelectorAll('input, textarea');
      var name = inputs[0].value.trim();
      var text = inputs[1].value;
      if (!name || !text.trim()) return;
      subjects.push({ name: name, text: text });
    });
    return {
      date: $('date').value,
      title: $('title').value.trim(),
      subjects: subjects,
      notes: $('notes').value,
    };
  }

  function markDirty() {
    dirty = true;
    setStatus('改过了 · 还没保存到本地', '');
  }

  /* ── 渲染 ── */
  function renderDays() {
    var list = $('days');
    list.textContent = '';
    var dirtyIds = (state && state.dirty) || [];
    $('count').textContent = state ? state.records.length + ' 天' + (dirtyIds.length ? ' · ' + dirtyIds.length + ' 天待同步' : '') : '';
    (state && state.records ? state.records : []).forEach(function (r) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      if (r.id === current.id) b.className = 'on';

      var t = document.createElement('b');
      t.textContent = (r.date || r.id) + (dirtyIds.indexOf(r.id) >= 0 ? ' · 待同步' : '');
      if (dirtyIds.indexOf(r.id) >= 0) t.className = 'dirty';
      var s = document.createElement('em');
      s.textContent = r.title || '(没有标题)';
      b.appendChild(t);
      b.appendChild(s);
      b.addEventListener('click', function () { loadDay(r.id); });
      li.appendChild(b);
      list.appendChild(li);
    });
  }

  function fill(form) {
    $('date').value = form.date || todayStr();
    $('title').value = form.title || '';
    $('notes').value = form.notes || '';
    $('subjects').textContent = '';
    var subs = (form.subjects && form.subjects.length) ? form.subjects : ((state && state.defaultSubjects) || []).map(function (n) { return { name: n, text: '' }; });
    subs.forEach(function (s) { addSubject(s.name, s.text); });
    $('hintId').textContent = 'id：' + (form.id || idFromDate($('date').value) || '（按日期生成）');
    dirty = false;
  }

  function blank() {
    current = { date: todayStr(), id: '', title: '' };
    fill({ date: todayStr(), subjects: [], notes: '' });
    setStatus('新的一天 · 还没保存', '');
    renderDays();
  }

  function loadDay(id) {
    act('read', { id: id }).then(function (res) {
      if (!res || res.error || !res.form) { setStatus('读不到这一天：' + id, 'bad'); return; }
      current = { date: res.form.date, id: res.id, title: res.form.title };
      fill(res.form);
      setStatus('已载入 ' + (res.form.date || res.id), '');
      renderDays();
    }).catch(function (e) { setStatus('读失败：' + e.message, 'bad'); });
  }

  /* ── 动作 ── */
  function saveLocal() {
    var input = collect();
    if (!input.date) { setStatus('先选日期', 'bad'); return Promise.resolve(); }
    $('btnSave').disabled = true;
    return act('save', { input: input }).then(function (res) {
      $('btnSave').disabled = false;
      if (res && res.error) { setStatus('保存失败：' + res.error, 'bad'); return; }
      if (res && res.notes && res.notes.length) setStatus(res.notes.join('；'), '');
      if (res && res.state) { state = res.state; }
      current = { date: input.date, id: (res && res.record && res.record.id) || idFromDate(input.date), title: (res && res.record && res.record.title) || '' };
      dirty = false;
      setStatus('已保存到本地 · 未同步', 'ok');
      renderDays();
    }).catch(function (e) { $('btnSave').disabled = false; setStatus('保存失败：' + e.message, 'bad'); });
  }

  function syncCloud() {
    $('btnSync').disabled = true;
    setStatus('正在同步…', '');
    act('sync').then(function (res) {
      $('btnSync').disabled = false;
      if (res && res.state) state = res.state;
      if (res && res.ok) {
        setStatus('已上传到云端收件箱（' + (res.uploaded ? res.uploaded.count : 0) + ' 个文件）· 家里 pull 一下就有了', 'ok');
      } else if (res && res.queued) {
        setStatus('现在连不上云端，已放进本机队列（' + res.queued.files.length + ' 个文件），联网后点这里再试', 'bad');
      } else {
        setStatus('同步没成功：' + ((res && (res.error || res.reason)) || '未知原因'), 'bad');
      }
      renderDays();
    }).catch(function (e) { $('btnSync').disabled = false; setStatus('同步失败：' + e.message, 'bad'); });
  }

  function flush() {
    act('flush').then(function (res) {
      if (res && res.state) state = res.state;
      if (res && res.ok && res.done && res.done.length) setStatus('队列已传完（' + res.done.length + ' 份）', 'ok');
      renderDays();
    }).catch(function () {});
  }

  /* ── 绑定 ── */
  $('date').addEventListener('change', function () {
    markDirty();
    $('hintId').textContent = 'id：' + idFromDate($('date').value);
    if (!current.id) current.date = $('date').value;
  });
  $('title').addEventListener('input', markDirty);
  $('notes').addEventListener('input', markDirty);
  $('btnAddSubject').addEventListener('click', function () { addSubject('', ''); markDirty(); });
  $('btnSave').addEventListener('click', saveLocal);
  $('btnSync').addEventListener('click', syncCloud);
  $('btnData').addEventListener('click', function () { act('openDataDir'); });
  $('btnClose').addEventListener('click', function () { act('close'); });

  document.addEventListener('keydown', function (e) {
    var mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveLocal(); }
    if (mod && e.key === 'Enter') { e.preventDefault(); syncCloud(); }
  });

  /* ── 启动 ── */
  act('list').then(function (res) {
    state = res || { records: [], dirty: [], defaultSubjects: [] };
    $('today').textContent = state.today || todayStr();
    var quick = $('quick');
    quick.textContent = '';
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = '新建今天这份';
    b.addEventListener('click', blank);
    quick.appendChild(b);
    if (state.records && state.records[0]) {
      var b2 = document.createElement('button');
      b2.type = 'button';
      b2.textContent = '接着改最近一天（' + state.records[0].date + '）';
      b2.addEventListener('click', function () { loadDay(state.records[0].id); });
      quick.appendChild(b2);
    }
    var b3 = document.createElement('button');
    b3.type = 'button';
    b3.textContent = state.dirty && state.dirty.length ? ('重试队列（' + state.dirty.length + ' 天待同步）') : '看看队列';
    b3.addEventListener('click', flush);
    quick.appendChild(b3);
    renderDays();
    if (state.records && state.records.length && state.records[0]) loadDay(state.records[0].id);
    else blank();
  }).catch(function (e) {
    setStatus('打不开本机数据：' + e.message, 'bad');
    blank();
  });
})();
