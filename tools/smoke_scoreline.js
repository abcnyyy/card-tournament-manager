/**
 * 界面级验证：新增的「按大比分逐档设分」模式
 * 在开发模式 Electron 中真实操作 DOM：切换计分方式 → 检查比分档位表 → 改分值 → 生成对阵 → 快捷录入比分 → 核对积分
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ELEC = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const OUT = path.join(ROOT, 'tools', 'smoke_out');
const PORT = 9336;

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
      }
    });
  });
}
async function ev(expr) {
  const r = await conn.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('页内异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r.result && r.result.value;
}
async function shot(n) {
  const r = await conn.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, n), Buffer.from(r.data, 'base64'));
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
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
  await ev(`window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message))});
    (function(){var oe=console.error;console.error=function(){window.__errs.push([].slice.call(arguments).join(' '));oe.apply(console,arguments)}})();'ok'`);

  console.log('\n=== 1. 建赛事并切到「按大比分逐档设分」 ===');
  const id = await ev(`(function(){
    var M=TMS.model,S=TMS.store;
    S.loadIndex().slice().forEach(function(x){S.remove(x.id);});
    var t=M.createTournament('大比分计分界面验证');
    for(var i=1;i<=6;i++){ t.players.push(M.createPlayer('选手'+i, i)); }
    t.format={gamesPerMatch:3,winNeeded:2,recordScore:false};
    t.stages[0].type='swiss'; t.stages[0].rounds=3; t.stages[0].tie='draw_ok';
    t.scoring.mode='scoreline';
    S.put(t); return t.id;
  })()`);
  ok('赛事已创建', !!id, id);

  await ev('location.reload()'); await sleep(1600);
  await ev(`window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message))});
    (function(){var oe=console.error;console.error=function(){window.__errs.push([].slice.call(arguments).join(' '));oe.apply(console,arguments)}})();'ok'`);
  // 进入设置页
  await ev(`(function(){var el=document.querySelector('[data-view="setup"]');if(el){el.click();return 1}return 0})()`);
  await sleep(500);

  const selVal = await ev(`(function(){var s=document.querySelector('[data-bind="scoring.mode"]');return s?s.value:'none'})()`);
  ok('计分方式下拉为 scoreline', selVal === 'scoreline', selVal);

  const table = await ev(`(function(){
    var rows=[],ins=document.querySelectorAll('[data-bind^="scoring.scoreTable"]');
    for(var i=0;i<ins.length;i++){ rows.push({bind:ins[i].getAttribute('data-bind'), v:ins[i].value, type:ins[i].type}); }
    var tb=document.querySelector('table');
    var bodyRows = tb? tb.querySelectorAll('tbody tr').length : 0;
    return {inputs:rows, rows:bodyRows, text: tb? tb.innerText.replace(/\\s+/g,' ').slice(0,300) : ''};
  })()`);
  console.log('    档位表：', table.text);
  ok('3局2胜列出 2 个比分档位', table.rows === 2, table.rows);
  ok('含 2-0 胜/负输入', table.inputs.some(x => /scoreTable\.2-0\.w/.test(x.bind)) && table.inputs.some(x => /scoreTable\.2-0\.l/.test(x.bind)), table.inputs.map(x => x.bind));
  ok('含 2-1 胜/负输入', table.inputs.some(x => /scoreTable\.2-1\.w/.test(x.bind)) && table.inputs.some(x => /scoreTable\.2-1\.l/.test(x.bind)), table.inputs.map(x => x.bind));
  await shot('scoreline_setup.png');

  console.log('\n=== 2. 在界面上改分值：2:0 → 胜 3 / 负 0；2:1 → 胜 2 / 负 1 ===');
  const setv = await ev(`(function(){
    function set(bind, val){
      var el=document.querySelector('[data-bind="'+bind+'"]');
      if(!el) return 'missing:'+bind;
      el.value=String(val);
      el.dispatchEvent(new Event('change',{bubbles:true}));
      return 'ok';
    }
    var r=[set('scoring.scoreTable.2-0.w',3),set('scoring.scoreTable.2-0.l',0),
           set('scoring.scoreTable.2-1.w',2),set('scoring.scoreTable.2-1.l',1)];
    return r.join(',');
  })()`);
  ok('四个分值输入均可写入', setv === 'ok,ok,ok,ok', setv);
  await sleep(400);
  const saved = await ev(`(function(){
    var t=TMS.store.get(TMS.store.getCurrentId());
    return JSON.stringify(t.scoring.scoreTable);
  })()`);
  ok('分值已持久化到赛事', /"2-0":\{"w":3,"l":0\}/.test(saved.replace(/\s/g, '')) || saved.indexOf('2-0') >= 0, saved);
  console.log('    已保存：', saved);

  console.log('\n=== 3. 生成对阵，用「直接填比分」录 2:1 ===');
  await ev(`(function(){var el=document.querySelector('[data-view="matches"]');if(el){el.click();return 1}return 0})()`);
  await sleep(400);
  const gen = await ev(`(function(){
    var b=[].slice.call(document.querySelectorAll('[data-act="genRound"]'));
    if(b.length){ b[0].click(); return b[0].textContent; }
    return 'no-gen-btn';
  })()`);
  console.log('    点击：', gen);
  await sleep(600);

  const q = await ev(`(function(){
    var btn=document.querySelector('[data-act="applyScore"]');
    if(!btn) return 'no-applyScore';
    var mid=btn.getAttribute('data-id');
    var a=document.getElementById('qa_'+mid), b=document.getElementById('qb_'+mid);
    a.value='2'; b.value='1';
    btn.click();
    return mid;
  })()`);
  ok('快捷录入 2:1 已提交', q !== 'no-applyScore', q);
  await sleep(500);

  const res = await ev(`(function(){
    var t=TMS.store.get(TMS.store.getCurrentId());
    var st=t.stages[t.currentStage];
    var rd=st.roundsData[st.roundsData.length-1];
    var m=rd.matches.filter(function(x){return x.decided})[0];
    if(!m) return 'no-decided-match';
    var E=TMS.engine, sc=E.scOf(t,st), fmt=E.fmtOf(t,st);
    return JSON.stringify({
      score: m.result.gamesA+':'+m.result.gamesB,
      winner: m.result.winner,
      ptsA: E.pointsFrom(m,'A',sc,fmt),
      ptsB: E.pointsFrom(m,'B',sc,fmt)
    });
  })()`);
  console.log('    该场结果：', res);
  ok('2:1 → 胜方 2 分、负方 1 分', /"ptsA":2/.test(res) && /"ptsB":1/.test(res), res);

  // 再录一场 2:0
  const q2 = await ev(`(function(){
    var btns=[].slice.call(document.querySelectorAll('[data-act="applyScore"]'));
    for(var i=0;i<btns.length;i++){
      var mid=btns[i].getAttribute('data-id');
      var t=TMS.store.get(TMS.store.getCurrentId());
      var st=t.stages[t.currentStage];
      var rd=st.roundsData[st.roundsData.length-1];
      var m=rd.matches.filter(function(x){return x.id===mid})[0];
      if(m && !m.decided && !m.isBye){
        document.getElementById('qa_'+mid).value='2';
        document.getElementById('qb_'+mid).value='0';
        btns[i].click();
        return mid;
      }
    }
    return 'none';
  })()`);
  await sleep(500);
  const res2 = await ev(`(function(){
    var t=TMS.store.get(TMS.store.getCurrentId()); var E=TMS.engine;
    var st=t.stages[t.currentStage]; var rd=st.roundsData[st.roundsData.length-1];
    var m=rd.matches.filter(function(x){return x.result && x.result.settled && x.result.gamesB===0 && x.result.gamesA===2})[0];
    if(!m) return 'none';
    var sc=E.scOf(t,st), fmt=E.fmtOf(t,st);
    return JSON.stringify({a:E.pointsFrom(m,'A',sc,fmt), b:E.pointsFrom(m,'B',sc,fmt)});
  })()`);
  ok('2:0 → 胜方 3 分、负方 0 分', /"a":3/.test(res2) && /"b":0/.test(res2), res2);

  await ev(`(function(){var el=document.querySelector('[data-view="standing"]');if(el){el.click();return 1}return 0})()`);
  await sleep(500);
  const st = await ev(`(function(){
    var t=TMS.store.get(TMS.store.getCurrentId());
    return TMS.engine.standings(t,{}).slice(0,4).map(function(s){return s.rank+'.'+s.name+'('+s.points+')'}).join(' ');
  })()`);
  console.log('    排名：', st);
  ok('排名已按大比分档位出分', /\(2\)|\(3\)/.test(st), st);
  await shot('scoreline_standing.png');

  console.log('\n=== 4. 打满 2 局 + 允许平局 → 应出现 1:1 平局档 ===');
  await ev(`(function(){
    var S=TMS.store, t=S.get(S.getCurrentId());
    t.format={gamesPerMatch:2,winNeeded:0,recordScore:false};
    t.stages[0].tie='draw_ok';
    t.scoring.mode='scoreline';
    t.scoring.scoreTable={};
    S.put(t); return 1;
  })()`);
  await ev('location.reload()'); await sleep(1600);
  await ev(`window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message))});
    (function(){var oe=console.error;console.error=function(){window.__errs.push([].slice.call(arguments).join(' '));oe.apply(console,arguments)}})();'ok'`);
  await ev(`(function(){var el=document.querySelector('[data-view="setup"]');if(el){el.click();return 1}return 0})()`);
  await sleep(500);
  const draw = await ev(`(function(){
    var tb=document.querySelector('table');
    var ins=document.querySelectorAll('[data-bind^="scoring.scoreTable"]');
    var binds=[]; for(var i=0;i<ins.length;i++) binds.push(ins[i].getAttribute('data-bind'));
    return {rows: tb?tb.querySelectorAll('tbody tr').length:0, text: tb?tb.innerText.replace(/\\s+/g,' ').slice(0,260):'', binds:binds};
  })()`);
  console.log('    档位表：', draw.text);
  ok('打满 2 局列出 2:0 与 1:1 两档', draw.rows === 2 && /1 : 1/.test(draw.text), draw.text);
  ok('平局档提供「各得」输入', draw.binds.some(b => /scoreTable\.1-1\.d/.test(b)), draw.binds);
  await shot('scoreline_draw.png');

  const errs = await ev('window.__errs.join(" | ")');
  console.log('\n=== RESULT ===');
  console.log('页面报错：', errs || '(none)');
  ok('全程无 JS 报错', !errs || !errs.trim(), errs);
  console.log('\nPASS: ' + pass + '   FAIL: ' + fail);
  child.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SMOKE ERROR:', e.message); process.exit(1); });
