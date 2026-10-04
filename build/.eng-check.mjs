/** 临时：英语页播放链路核验（用页面真实的选择器 + 网络计时条目）。跑完即删。 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const BROWSER = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILE = path.join(process.env.TEMP || '.', 'dsh-eng3-' + Date.now());
const CDP_PORT = 9353;
const child = spawn(BROWSER, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required',
  '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + PROFILE, '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let version = null;
for (let i = 0; i < 60 && !version; i++) { await sleep(300); try { version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); } catch { /* wait */ } }
const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') logs.push('[' + m.params.type + '] ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  if (m.method === 'Runtime.exceptionThrown') logs.push('[EXCEPTION] ' + (m.params.exceptionDetails.exception?.description || '').split('\n')[0]);
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) logs.push('[HTTP ' + m.params.response.status + '] ' + m.params.response.url);
};
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((r) => pending.set(i, (m) => r(m.result ?? m.error))); };
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return 'ERR: ' + String(r.exceptionDetails.exception?.description || '').split('\n')[0];
  return r && r.result ? r.result.value : undefined;
};
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');

await send('Page.navigate', { url: 'http://127.0.0.1:8788/811/english.html' });
await sleep(2600);

console.log('=== 点第一行播放 ===');
console.log('  点击前 lbl  =', await evaluate("(document.querySelector('.t-state .lbl')||{}).textContent"));
await evaluate("document.querySelector('.track .play').click()");
await sleep(3000);

console.log('  行播标记    =', await evaluate("document.querySelectorAll('.track.playing').length"));
console.log('  行状态文字  =', await evaluate("(document.querySelector('.t-state .lbl')||{}).textContent"));
console.log('  正在播放标题=', await evaluate("(document.getElementById('npTitle')||{}).textContent"));
console.log('  副标题      =', await evaluate("(document.getElementById('npSub')||{}).textContent"));
console.log('  时间        =', await evaluate("document.getElementById('tCur').textContent + ' / ' + document.getElementById('tDur').textContent"));
console.log('  播放键 aria =', await evaluate("document.getElementById('toggle').getAttribute('aria-label') + ' pressed=' + document.getElementById('toggle').getAttribute('aria-pressed')"));
console.log('  mp3 请求    =', await evaluate("(function(){var r=performance.getEntriesByType('resource').filter(function(e){return /\\.mp3$/.test(e.name)});return r.length? (r[0].name.split('/').slice(-2).join('/')+' 大小='+Math.round(r[0].transferSize||0)+'B 耗时='+Math.round(r[0].duration)+'ms') : '(没有 mp3 请求)';})()"));

console.log('\n=== 下一首 ===');
await evaluate("document.getElementById('next').click()");
await sleep(2500);
console.log('  第二首请求  =', await evaluate("(function(){var r=performance.getEntriesByType('resource').filter(function(e){return /\\.mp3$/.test(e.name)});return r.length>1? r[r.length-1].name.split('/').slice(-2).join('/') : '(还是第一首)';})()"));
console.log('  行状态      =', await evaluate("document.querySelectorAll('.track.playing').length + ' 行 playing'"));

console.log('\n=== 搜索真的过滤了吗 ===');
await evaluate("(function(){var q=document.getElementById('q');q.value='U3';q.dispatchEvent(new Event('input',{bubbles:true}));return 1})()");
await sleep(400);
console.log('  搜 U3       =', await evaluate("document.querySelectorAll('.unit').length + ' 单元 / ' + document.querySelectorAll('.track').length + ' 行（U3 应有 5 行）'"));
await evaluate("(function(){var q=document.getElementById('q');q.value='understanding';q.dispatchEvent(new Event('input',{bubbles:true}));return 1})()");
await sleep(400);
console.log('  搜 understanding =', await evaluate("document.querySelectorAll('.track').length + ' 行'"));
await evaluate("(function(){var q=document.getElementById('q');q.value='';q.dispatchEvent(new Event('input',{bubbles:true}));return 1})()");
await sleep(300);

console.log('\n=== 键盘 ===');
await evaluate("document.body.focus()");
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
await sleep(800);
console.log('  空格后      =', await evaluate("document.getElementById('toggle').getAttribute('aria-label')"));

console.log('\n=== 报错 / 失败请求 ===');
console.log(logs.length ? logs.slice(0, 10).join('\n') : '(无)');

ws.close(); child.kill(); await sleep(300);
try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(0);
