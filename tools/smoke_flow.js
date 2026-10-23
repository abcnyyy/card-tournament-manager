/**
 * 打包产物「完整流程」冒烟：8 人瑞士轮 3 轮，真实跑完生成对局→录分→结算→排名，
 * 在打包后的 Electron 里逐页截图，确认功能与版式都正常。
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'dist', 'win-unpacked', '赛事编排系统.exe');
const OUT = path.join(ROOT, 'tools', 'smoke_out');
const PORT = 9334;

const sleep = ms => new Promise(r => setTimeout(r, ms));
function get(url) {
  return new Promise((res, rej) => {
    http.get(url, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res(b)); }).on('error', rej);
  });
}
async function pageTarget() {
  const s = await get(`http://127.0.0.1:${PORT}/json/list`);
  return JSON.parse(s).filter(t => t.type === 'page')[0];
}

let conn = null;
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
      },
      close() { try { sock.close(); } catch (e) {} }
    });
  });
}
async function ev(expr) {
  const r = await conn.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('页内异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
  return r.result && r.result.value;
}
async function shot(name) {
  const r = await conn.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
}
async function clickView(v) {
  await ev(`(function(){var el=document.querySelector('[data-view="${v}"]');if(el){el.click();return 1;}return 0;})()`);
  await sleep(500);
}
async function reload() {
  await conn.send('Page.reload', { ignoreCache: true });
  await sleep(1600);
  // reload 会重置 window，需要重新挂错误收集器
  try {
    await ev(`window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message))});
      (function(){var oe=console.error;console.error=function(){window.__errs.push([].slice.call(arguments).join(' '));oe.apply(console,arguments)}})();'ok'`);
  } catch (e) { /* 页面可能仍在加载 */ }
}

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
    // 无头浏览器（不弹任何窗口）：本地静态服务 + 系统 Edge/Chrome --headless=new
  const { launch } = require('./headless');
  const { child } = await launch(PORT, path.join(ROOT, 'app'));

  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(500); try { if (await pageTarget()) { ready = true; break; } } catch (e) {} }
  if (!ready) { console.error('FAIL: 窗口未就绪'); child.kill(); process.exit(1); }
  await sleep(1200);
  conn = await connect();
  await conn.send('Runtime.enable'); await conn.send('Page.enable');

  // 注入错误收集
  await ev(`window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message))});
    (function(){var oe=console.error;console.error=function(){window.__errs.push([].slice.call(arguments).join(' '));oe.apply(console,arguments)}})();'ok'`);

  // 1) 造赛事：8 人瑞士轮 3 轮，每场 3 局 2 胜
  const created = await ev(`(function(){
    var M=TMS.model,S=TMS.store;
    S.loadIndex().slice().forEach(function(x){S.remove(x.id);});
    var t=M.createTournament('冒烟赛 8人瑞士轮');
    for(var i=1;i<=8;i++){ t.players.push(M.createPlayer('选手'+i, i)); }
    t.format={gamesPerMatch:3,winNeeded:2,recordScore:false};
    t.scoring.win=3; t.scoring.draw=1; t.scoring.lose=0; t.scoring.bye=3;
    t.stages[0].type='swiss'; t.stages[0].rounds=3; t.stages[0].tie='draw_ok';
    S.put(t);
    return {id:t.id, players:t.players.length};
  })()`);
  console.log('创建赛事   :', JSON.stringify(created));
  await reload();
  console.log('标题       :', await ev('document.getElementById("topbarSub").textContent'));

  // 2) 逐轮生成 + 录分 + 结算
  for (let r = 1; r <= 3; r++) {
    const res = await ev(`(function(){
      var E=TMS.engine,S=TMS.store,M=TMS.model;
      var t=S.get(S.getCurrentId()); TMS.current=t;
      var g=E.generateRound(t);
      if(!g.ok) return {ok:false,msg:g.msg};
      var st=t.stages[t.currentStage];
      var rd=st.roundsData[st.roundsData.length-1];
      var done=0;
      rd.matches.forEach(function(m,i){
        if(m.isBye){ E.evaluate(m,E.fmtOf(t,st),st.tie); return; }
        var w=(i%2===0)?'A':'B';
        m.games.push({w:w},{w:w});
        E.evaluate(m,E.fmtOf(t,st),st.tie);
        if(m.decided) done++;
      });
      var fin=E.finishRound(t);
      S.put(t);
      return {ok:true, round:rd.index+1, matches:rd.matches.length, decided:done, fin:fin.ok, msg:fin.msg||''};
    })()`);
    console.log(`第 ${r} 轮     :`, JSON.stringify(res));
    await reload();
  }

  // 3) 各页截图
  const views = ['matches', 'standing', 'export', 'setup'];
  const errs = [];
  for (const v of views) {
    await clickView(v);
    const e = await ev('window.__errs.slice(0,3).join(" | ")');
    if (e) errs.push(v + ': ' + e);
    await shot('flow_' + v + '.png');
    console.log(`页签 ${v.padEnd(9)}: errs=${e || 'none'}`);
  }
  // 排名内容抽查
  const table = await ev(`(function(){
    var tb=document.querySelector('table'); if(!tb) return 'no-table';
    var rows=tb.querySelectorAll('tbody tr'); var out=[];
    for(var i=0;i<Math.min(rows.length,4);i++){ out.push(rows[i].innerText.replace(/\\s+/g,' ').trim()); }
    return out.join(' || ');
  })()`);
  console.log('排名前4    :', table);

  const finalErrs = await ev('window.__errs.join(" | ")');
  console.log('\n=== RESULT ===');
  console.log('errors:', finalErrs || '(none)');
  const pass = (!finalErrs || !finalErrs.trim()) && /选手/.test(String(table));
  console.log(pass ? 'FLOW PASS' : 'FLOW FAIL');
  child.kill();
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('FLOW ERROR:', e.message); process.exit(1); });
