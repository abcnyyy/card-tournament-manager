/**
 * v1.3.0 界面验证：对阵图（单败/双败）、页内确认框（退赛）、新增破同依据、轮空文案
 * 用法：SMOKE_EXE=<exe路径> 时验证打包版，否则开发模式
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ELEC = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const OUT = path.join(ROOT, 'tools', 'smoke_out');
const PORT = 9338;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function get(u) { return new Promise((res, rej) => { http.get(u, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res(b)); }).on('error', rej); }); }
async function pageTarget() { const s = await get(`http://127.0.0.1:${PORT}/json/list`); return JSON.parse(s).filter(t => t.type === 'page')[0]; }
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
  const r = await conn.send('Runtime.evaluate', { expression: expr, awaitPromise: false, returnByValue: true });
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
async function view(v) { await ev(`(function(){var el=document.querySelector('[data-view="${v}"]');if(el){el.click();return 1}return 0})()`); await sleep(450); }
async function reload() {
  await ev('location.reload()'); await sleep(1600);
  await ev(`window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message))});
    (function(){var oe=console.error;console.error=function(){window.__errs.push([].slice.call(arguments).join(' '));oe.apply(console,arguments)}})();'ok'`);
}
// 在页内跑完一个淘汰赛阶段
const RUN_STAGE = `(function(type){
  var M=TMS.model,S=TMS.store,E=TMS.engine;
  var t=M.createTournament((type==='double_elim'?'双败':'单败')+'界面验证');
  for(var i=1;i<=8;i++) t.players.push(M.createPlayer('选手'+i, i));
  t.stages[0].type=type;
  S.put(t);
  var st=t.stages[0];
  for(var k=0;k<14;k++){
    if(E.stageFinished(t,st)) break;
    var g=E.generateRound(t); if(!g.ok) break;
    var rd=st.roundsData[st.roundsData.length-1];
    rd.matches.forEach(function(m){
      if(m.isBye){E.evaluate(m,E.fmtOf(t,st),st.tie);return;}
      var sa=(t.players.filter(function(p){return p.id===m.playerA})[0]||{}).seed||9999;
      var sb=(t.players.filter(function(p){return p.id===m.playerB})[0]||{}).seed||9999;
      var w = sa<=sb ? 'A':'B';
      m.games=[{w:w},{w:w}];
      E.evaluate(m,E.fmtOf(t,st),st.tie);
    });
    E.finishRound(t);
  }
  S.put(t);
  return {rounds:st.roundsData.length, finished:E.stageFinished(t,st)};
})`;

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
    // 无头浏览器（不弹任何窗口）：本地静态服务 + 系统 Edge/Chrome --headless=new
  const { launch } = require('./headless');
  const { child } = await launch(PORT, path.join(ROOT, 'app'));

  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(500); try { if (await pageTarget()) { ready = true; break; } } catch (e) {} }
  if (!ready) { console.error('窗口未就绪'); child.kill(); process.exit(1); }
  await sleep(1200);
  conn = await connect();
  await conn.send('Runtime.enable'); await conn.send('Page.enable');
  await ev(`window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message))});
    (function(){var oe=console.error;console.error=function(){window.__errs.push([].slice.call(arguments).join(' '));oe.apply(console,arguments)}})();'ok'`);

  /* ---------- 1. 双败对阵图 ---------- */
  console.log('\n=== 1. 双败对阵图 ===');
  console.log('   ', JSON.stringify(await ev(RUN_STAGE + "('double_elim')")));
  await reload();
  await view('standing');
  const b1 = await ev(`(function(){
    var secs=document.querySelectorAll('.bracket-sec');
    var names=[]; for(var i=0;i<secs.length;i++){ var t=secs[i].querySelector('.sec-name'); names.push(t?t.textContent:''); }
    var heads=[].map.call(document.querySelectorAll('.bcol .col-head b'),function(e){return e.textContent});
    return {sections:secs.length, names:names, cards:document.querySelectorAll('.bcard').length,
            cols:heads.length, heads:heads};
  })()`);
  console.log('    分区：', JSON.stringify(b1));
  ok('双败图分胜者组 / 败者组两行', b1.sections === 2, b1.names);
  ok('总决赛与加赛局列在最右（与胜者组同排）',
    b1.heads.indexOf('总决赛') >= 0 && (b1.heads.indexOf('加赛局') >= 0 || b1.heads.indexOf('升格决赛') >= 0), b1.heads);
  ok('分区名含胜者组与败者组', b1.names.join('').indexOf('胜者组') >= 0 && b1.names.join('').indexOf('败者组') >= 0, b1.names);
  ok('渲染出对阵卡片', b1.cards > 10, b1.cards);
  await shot('v13_bracket_double.png');

  /* ---------- 2. 单败对阵图 ---------- */
  console.log('\n=== 2. 单败对阵图 ===');
  console.log('   ', JSON.stringify(await ev(RUN_STAGE + "('single_elim')")));
  await reload();
  await view('standing');
  const b2 = await ev(`(function(){
    var secs=document.querySelectorAll('.bracket-sec');
    var names=[].map.call(document.querySelectorAll('.bcol .col-head b'),function(e){return e.textContent});
    var winners=document.querySelectorAll('.bslot.win').length;
    return {sections:secs.length, colNames:names, cards:document.querySelectorAll('.bcard').length, winners:winners};
  })()`);
  console.log('    列：', JSON.stringify(b2));
  ok('单败图 3 列', b2.colNames.length === 3, b2.colNames);
  ok('列名为 第 1 轮 → 半决赛 → 决赛',
    b2.colNames.join('|').indexOf('第 1 轮') >= 0 && b2.colNames.join('|').indexOf('半决赛') >= 0 && b2.colNames.join('|').indexOf('决赛') >= 0,
    b2.colNames);
  ok('有胜者反白标记', b2.winners > 0, b2.winners);
  await shot('v13_bracket_single.png');

  /* ---------- 3. 退赛：页内确认框 ---------- */
  console.log('\n=== 3. 退赛（页内输入框，不再用原生 prompt）===');
  await view('players');
  const before = await ev(`(function(){var t=TMS.store.get(TMS.store.getCurrentId());return t.players.filter(function(p){return p.active===false}).length})()`);
  await ev(`(function(){var b=document.querySelector('[data-act="dropPlayer"]');if(b)b.click();return 1})()`);
  await sleep(400);
  const modal = await ev(`(function(){
    var w=document.getElementById('modalWrap');
    if(!w) return 'no-modal';
    return {display:w.style.display, title:(w.querySelector('.modal-title')||{}).textContent, hasInput:!!w.querySelector('.modal-input')};
  })()`);
  console.log('    模态框：', JSON.stringify(modal));
  ok('弹出页内输入框（而非原生 prompt）', modal !== 'no-modal' && modal.display === 'block' && modal.hasInput, modal);
  await shot('v13_modal.png');
  await ev(`(function(){var b=document.getElementById('modalOk');if(b)b.click();return 1})()`);
  await sleep(500);
  const after = await ev(`(function(){var t=TMS.store.get(TMS.store.getCurrentId());
    return {dropped:t.players.filter(function(p){return p.active===false}).length,
            reason:(t.players.filter(function(p){return p.active===false})[0]||{}).dropReason};})()`);
  console.log('    结果：', JSON.stringify(after));
  ok('确定后退赛生效', after.dropped === before + 1, after);

  /* ---------- 4. 新增破同依据 ---------- */
  console.log('\n=== 4. 破同依据与排名列 ===');
  await view('setup');
  const tb = await ev(`(function(){
    var rows=[].slice.call(document.querySelectorAll('[data-act^="tie"]')).map(function(b){return b.parentNode.textContent.replace(/\\s+/g,' ').trim()});
    return rows.join(' | ');
  })()`);
  console.log('    依据：', tb);
  ok('含累进分', /累进分/.test(tb), tb.slice(0, 200));
  ok('含胜场数', /胜场数/.test(tb));
  ok('含上一阶段得分', /上一阶段得分/.test(tb));
  ok('含输掉局数', /输掉局数/.test(tb));
  const bye = await ev(`(function(){var el=document.querySelector('[data-bind="byeRule"]');return el?el.textContent.replace(/\\s+/g,' '):'none'})()`);
  ok('轮空选项标明「自动」', /自动/.test(bye), bye.slice(0, 120));

  // 淘汰赛阶段：名次表按对阵结果
  await view('standing');
  const elimCols = await ev(`(function(){
    var ths=[].slice.call(document.querySelectorAll('table th')).map(function(t){return t.textContent.trim()});
    return ths.join(',');
  })()`);
  console.log('    淘汰赛名次表列：', elimCols);
  ok('淘汰赛显示「名次（按对阵结果）」表', /结果/.test(elimCols) && /名次/.test(elimCols), elimCols);

  // 瑞士轮阶段：积分表 + 新增列
  await ev(`(function(){
    var M=TMS.model,S=TMS.store;
    S.loadIndex().slice().forEach(function(x){S.remove(x.id);});
    var t=M.createTournament('瑞士轮列验证');
    for(var i=1;i<=6;i++) t.players.push(M.createPlayer('R'+i, i));
    t.stages[0].type='swiss'; t.stages[0].rounds=2;
    S.put(t);
    var st=t.stages[0];
    for(var k=0;k<3;k++){
      var g=TMS.engine.generateRound(t); if(!g.ok) break;
      var rd=st.roundsData[st.roundsData.length-1];
      rd.matches.forEach(function(m){ if(m.isBye){TMS.engine.evaluate(m,TMS.engine.fmtOf(t,st),st.tie);return;}
        m.games=[{w:'A'},{w:'A'}]; TMS.engine.evaluate(m,TMS.engine.fmtOf(t,st),st.tie); });
      TMS.engine.finishRound(t);
    }
    S.put(t); return 1;
  })()`);
  await reload();
  await view('standing');
  const cols = await ev(`(function(){
    var ths=[].slice.call(document.querySelectorAll('table th')).map(function(t){return t.textContent.trim()});
    return ths.join(',');
  })()`);
  console.log('    瑞士轮排名列：', cols);
  ok('积分表含累进分列', /累进分/.test(cols), cols);
  ok('积分表含净小分列', /净小分/.test(cols), cols);
  await shot('v13_standing_swiss.png');

  const errs = await ev('window.__errs.join(" | ")');
  console.log('\n=== RESULT ===');
  console.log('页面报错：', errs || '(none)');
  ok('全程无 JS 报错', !errs || !errs.trim(), errs);
  console.log('\nPASS: ' + pass + '   FAIL: ' + fail);
  child.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SMOKE ERROR:', e.message); process.exit(1); });
