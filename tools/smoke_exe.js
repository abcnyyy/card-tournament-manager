/**
 * 打包产物冒烟验证：启动 dist/win-unpacked 里的真实 EXE，
 * 通过 CDP 检查页面是否渲染、是否有 JS 报错，并逐页签切换截图。
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'dist', 'win-unpacked', '卡牌赛事编排.exe');
const OUT = path.join(ROOT, 'tools', 'smoke_out');
const PORT = 9333;

function get(url) {
  return new Promise((res, rej) => {
    http.get(url, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res(b)); }).on('error', rej);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function listTargets() {
  const s = await get(`http://127.0.0.1:${PORT}/json/list`);
  return JSON.parse(s).filter(t => t.type === 'page');
}

let ws = null;
function cdp() {
  if (ws) return Promise.resolve(ws);
  return new Promise(async (res, rej) => {
    const targets = await listTargets();
    const page = targets[0];
    if (!page) return rej(new Error('no page target'));
    // 用 node 内置 WebSocket (Node 22+)
    const sock = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0;
    const pend = new Map();
    sock.onmessage = e => {
      const m = JSON.parse(e.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    };
    sock.onerror = rej;
    sock.onopen = () => {
      ws = {
        raw: sock,
        send(method, params = {}) {
          const mid = ++id;
          return new Promise((r, j) => {
            pend.set(mid, m => m.error ? j(new Error(method + ': ' + JSON.stringify(m.error))) : r(m.result));
            sock.send(JSON.stringify({ id: mid, method, params }));
          });
        }
      };
      res(ws);
    };
  });
}

async function evaluate(expr) {
  const c = await cdp();
  const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result && r.result.value;
}

async function shot(name) {
  const c = await cdp();
  const r = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
}

(async () => {
  if (!fs.existsSync(EXE)) { console.error('EXE not found:', EXE); process.exit(1); }
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;   // 本机注入了此变量会让 Electron 退化成 Node
  const child = spawn(EXE, [
    '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${PORT}`, '--force-device-scale-factor=1'
  ], { env, detached: false });

  child.stdout.on('data', d => process.stdout.write('[out] ' + d));
  child.stderr.on('data', d => process.stdout.write('[err] ' + d));

  let ok = false;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try { const t = await listTargets(); if (t.length) { ok = true; break; } } catch (e) { /* wait */ }
  }
  if (!ok) { console.error('FAIL: CDP 未就绪'); child.kill(); process.exit(1); }
  await sleep(1500);

  const c = await cdp();
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  await c.send('Log.enable').catch(() => {});

  // 收集 console error / pageerror
  await evaluate(`window.__errs=[];window.addEventListener('error',e=>window.__errs.push(String(e.message)));
    (function(){const oe=console.error;console.error=function(){window.__errs.push([].slice.call(arguments).join(' '));oe.apply(console,arguments);};})();'ok'`);

  const title = await evaluate('document.title');
  const appLen = await evaluate('(document.getElementById("app")||document.body).innerHTML.length');
  const hasNav = await evaluate('document.querySelectorAll("[data-view]").length');
  console.log('title      :', title);
  console.log('app htmlLen:', appLen);
  console.log('nav items  :', hasNav);

  // 造一个示例赛事，方便逐页签看版式
  await evaluate(`(function(){
    try{
      var list = S.list(); if(!list.length){ return 'no-list'; }
      return 'list:'+list.length;
    }catch(e){ return 'ERR:'+e.message; }
  })()`).then(v => console.log('storage    :', v));

  // 逐个页签切换并截图
  const views = await evaluate(`(function(){
    var ns=document.querySelectorAll('[data-view]');var a=[];
    for(var i=0;i<ns.length;i++){a.push(ns[i].getAttribute('data-view'));}
    return a;
  })()`);
  console.log('views      :', JSON.stringify(views));

  for (const v of (views || [])) {
    await evaluate(`(function(){var el=document.querySelector('[data-view="'+${JSON.stringify(v)}+'"]');if(el){el.click();return 1;}return 0;})()`);
    await sleep(400);
    const err = await evaluate('window.__errs.slice(0,3).join(" | ")');
    const len = await evaluate('(document.getElementById("app")||document.body).innerHTML.length');
    console.log(`  view ${v.padEnd(10)} htmlLen=${len} errs=${err || 'none'}`);
    await shot('view_' + v + '.png');
  }

  const errs = await evaluate('window.__errs.join(" | ")');
  console.log('\n=== RESULT ===');
  console.log('errors     :', errs || '(none)');
  const pass = appLen > 2000 && (!errs || errs.trim() === '');
  console.log(pass ? 'SMOKE PASS' : 'SMOKE FAIL');
  child.kill();
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('SMOKE ERROR:', e); process.exit(1); });
