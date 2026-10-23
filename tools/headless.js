/**
 * 无头浏览器测试环境（不弹任何窗口）
 *  - 用本地 HTTP 静态服务托管 app/（localStorage 需要正常 origin）
 *  - 用系统 Edge / Chrome 的 --headless=new 打开页面，CDP 驱动
 * 用法：
 *   const { launch, connect } = require('./headless');
 *   const env = await launch(PORT, path.join(__dirname,'..','app'));
 *   const conn = await connect(PORT);
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function findBrowser() {
  const cands = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  throw new Error('未找到 Edge / Chrome');
}

function serve(root) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.normalize(path.join(root, p));
    if (!file.startsWith(path.normalize(root))) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      res.end(buf);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function launch(debugPort, appDir) {
  const server = await serve(appDir);
  const httpPort = server.address().port;
  const url = `http://127.0.0.1:${httpPort}/index.html`;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tms-headless-'));
  const bin = findBrowser();
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
    '--disable-sync',
    '--no-service-autorun',
    '--disable-features=msEdgeSyncConfirmationDialog,msImplicitSignin,msEdgeSidebarV2,msEdgeIdentityPage',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--window-size=1500,1000',
    `--user-data-dir=${userData}`,
    `--remote-debugging-port=${debugPort}`,
    url
  ];
  const child = spawn(bin, args, { stdio: 'ignore', windowsHide: true });
  child.__server = server;
  child.__url = url;
  child.__userData = userData;
  const kill0 = child.kill.bind(child);
  child.kill = function () {
    try { server.close(); } catch (e) {}
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } catch (e) {}
    try { kill0(); } catch (e) {}
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch (e) {}
    return true;
  };

  // 等页面真正跑起来（TMS 已挂载）再返回，避免调用方第一句就 ReferenceError
  await waitAppReady(debugPort);
  return { child, url, httpPort };
}

function probeTMS(wsUrl) {
  return new Promise((resolve) => {
    let done = false;
    let sock;
    const finish = (v) => { if (done) return; done = true; try { sock && sock.close(); } catch (e) {} resolve(v); };
    try {
      sock = new WebSocket(wsUrl);
    } catch (e) { return resolve(false); }
    sock.onerror = () => finish(false);
    sock.onopen = () => {
      sock.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'typeof TMS', returnByValue: true } }));
    };
    sock.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data);
        if (m.id === 1) finish(!!(m.result && m.result.result && m.result.result.value === 'object'));
      } catch (err) { finish(false); }
    };
    setTimeout(() => finish(false), 2500);
  });
}

async function waitAppReady(port, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 25000);
  while (Date.now() < deadline) {
    try {
      const p = await pageTarget(port, 2);
      if (p && /index\.html/.test(p.url || '')) {
        if (await probeTMS(p.webSocketDebuggerUrl)) return true;
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

function get(u) {
  return new Promise((res, rej) => {
    http.get(u, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res(b)); }).on('error', rej);
  });
}

async function pageTarget(port, tries) {
  tries = tries || 40;
  for (let i = 0; i < tries; i++) {
    try {
      const s = await get(`http://127.0.0.1:${port}/json/list`);
      const list = JSON.parse(s).filter(t => t.type === 'page');
      const app = list.filter(t => /index\.html/.test(t.url || ''))[0] || list[0];
      if (app) return app;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 300));
  }
  return null;
}

async function connect(port) {
  const page = await pageTarget(port);
  if (!page) throw new Error('无头浏览器未就绪');
  return new Promise((res, rej) => {
    const sock = new WebSocket(page.webSocketDebuggerUrl);
    let id = 0; const pend = new Map();
    sock.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
    sock.onerror = rej;
    sock.onopen = async () => {
      const send = (method, params = {}) => {
        const mid = ++id;
        return new Promise((r, j) => {
          pend.set(mid, m => m.error ? j(new Error(method + ': ' + JSON.stringify(m.error))) : r(m.result));
          sock.send(JSON.stringify({ id: mid, method, params }));
        });
      };
      // 等页面脚本执行完（TMS 挂载完成）再交还控制权，避免第一句就 ReferenceError
      for (let i = 0; i < 100; i++) {
        try {
          const r = await send('Runtime.evaluate', { expression: 'typeof TMS', returnByValue: true });
          if (r.result && r.result.value === 'object') break;
        } catch (e) {}
        await new Promise(r2 => setTimeout(r2, 150));
      }
      res({
        send,
        close() { try { sock.close(); } catch (e) {} }
      });
    };
  });
}

module.exports = { launch, connect, pageTarget, get, waitAppReady };
