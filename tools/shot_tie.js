/**
 * 抓「排名依据」编辑区完整截图（含移除/添加按钮）
 * 用法：SMOKE_EXE=<exe路径> 时用打包版
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const ELEC = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const OUT = path.join(ROOT, 'tools', 'smoke_out');
const PORT = 9343;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function get(u) { return new Promise((res, rej) => { http.get(u, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res(b)); }).on('error', rej); }); }
async function pageTarget() { const s = await get(`http://127.0.0.1:${PORT}/json/list`); return JSON.parse(s).filter(t => t.type === 'page')[0]; }
let conn;
async function connect() {
  const page = await pageTarget();
  return new Promise((res, rej) => {
    const sock = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0; const pend = new Map();
    sock.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
    sock.onerror = rej;
    sock.onopen = () => res({
      send(method, params = {}) {
        const mid = ++id;
        return new Promise((r, j) => {
          pend.set(mid, m => m.error ? j(new Error(method + ': ' + JSON.stringify(m.error))) : r(m.result));
          sock.send(JSON.stringify({ id: mid, method, params }));
        });
      }
    });
  });
}
async function ev(expr) {
  const r = await conn.send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
  return r.result && r.result.value;
}
async function shot(n) {
  const r = await conn.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, n), Buffer.from(r.data, 'base64'));
}

(async () => {
  const env = Object.assign({}, process.env); delete env.ELECTRON_RUN_AS_NODE;
  const exe = process.env.SMOKE_EXE;
  const child = spawn(exe || ELEC, exe
    ? ['--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`]
    : ['.', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`], { cwd: ROOT, env });
  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(500); try { if (await pageTarget()) { ready = true; break; } } catch (e) {} }
  if (!ready) { child.kill(); process.exit(1); }
  await sleep(1200);
  conn = await connect();
  await conn.send('Runtime.enable'); await conn.send('Page.enable');

  await ev(`(function(){
    var M=TMS.model,S=TMS.store;
    S.loadIndex().slice().forEach(function(x){S.remove(x.id)});
    var t=M.createTournament('依据增删示例');
    for(var i=1;i<=6;i++) t.players.push(M.createPlayer('选手'+i,i));
    // 先删掉两个不常用依据，展示「可添加」下拉
    t.scoring.tieOrder=t.scoring.tieOrder.filter(function(k){return k!=='cumDiff'&&k!=='stagePoints'});
    S.put(t); return 1;
  })()`);
  await sleep(400);
  await ev('location.reload()');
  await sleep(1700);
  await ev(`(function(){var el=document.querySelector('[data-view="setup"]');if(el)el.click();return 1})()`);
  await sleep(600);
  // 放大视口，让整页可见
  await conn.send('Emulation.setDeviceMetricsOverride', { width: 1080, height: 2600, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  await ev(`(function(){
    var h=[].slice.call(document.querySelectorAll('h3,.card-title,h2'));
    for(var i=0;i<h.length;i++){ if(/排名依据/.test(h[i].textContent)){ h[i].scrollIntoView({block:'start'}); return 1; } }
    window.scrollTo(0, document.body.scrollHeight*0.55); return 2;
  })()`);
  await sleep(500);
  await shot('v14_tie_full.png');
  console.log('shot ok');
  child.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
