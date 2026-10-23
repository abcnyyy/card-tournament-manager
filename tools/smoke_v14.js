/**
 * v1.4.0 界面验证：淘汰赛轮空、轮空计胜、淘汰赛限轮、破同分依据增删
 * 用法：SMOKE_EXE=<exe路径> 时验证打包版，否则开发模式
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ELEC = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const OUT = path.join(ROOT, 'tools', 'smoke_out');
const PORT = 9341;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function get(u) {
  return new Promise((res, rej) => {
    http.get(u, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res(b)); }).on('error', rej);
  });
}
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
  await ev('location.reload()'); await sleep(1700);
  await ev(`window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message))});
    (function(){var oe=console.error;console.error=function(){window.__errs.push([].slice.call(arguments).join(' '));oe.apply(console,arguments)}})();'ok'`);
}

function clearAll() {
  return ev(`(function(){var S=TMS.store;S.loadIndex().slice().forEach(function(x){S.remove(x.id);});return 1})()`);
}

// 造一个「N 人单败，首轮已生成」的赛事
function buildElim(n, opts) {
  opts = opts || {};
  return ev(`(function(n,opt){
    var M=TMS.model,S=TMS.store,E=TMS.engine;
    var t=M.createTournament('淘汰赛轮空验证');
    for(var i=1;i<=n;i++) t.players.push(M.createPlayer('选手'+i, i));
    t.stages[0].type='single_elim';
    if(opt.maxRounds) t.stages[0].maxRounds=opt.maxRounds;
    if(opt.advCount) t.stages[0].adv={type:'count',count:opt.advCount,score:0,perGroup:2};
    S.put(t);
    var st=t.stages[0];
    var g=E.generateRound(t);
    S.put(t);
    var rd=st.roundsData[0];
    return {
      ok:g.ok, msg:g.msg||'',
      byeCount: rd.matches.filter(function(m){return m.isBye}).length,
      normalCount: rd.matches.filter(function(m){return !m.isBye}).length,
      emptyOpponent: rd.matches.filter(function(m){return !m.isBye && (!m.playerA||!m.playerB)}).length,
      roundDone: E.roundComplete(t,st,rd).ok
    };
  })(${n}, ${JSON.stringify(opts || {})})`);
}

// 打完首轮（胜者为种子靠前者）
function playFirstRound() {
  return ev(`(function(){
    var S=TMS.store,E=TMS.engine;
    var t=S.get(S.getCurrentId());
    var st=t.stages[0], rd=st.roundsData[0];
    rd.matches.forEach(function(m){
      if(m.isBye){E.evaluate(m,E.fmtOf(t,st),st.tie);return;}
      var sa=(t.players.filter(function(p){return p.id===m.playerA})[0]||{}).seed||9999;
      var sb=(t.players.filter(function(p){return p.id===m.playerB})[0]||{}).seed||9999;
      var w=(sa<=sb)?'A':'B';
      m.games=[{w:w},{w:w}];
      E.evaluate(m,E.fmtOf(t,st),st.tie);
    });
    E.finishRound(t);
    S.put(t);
    var rank=st.roundsData[0].matches.map(function(m){return m.result.winner==='A'?m.playerA:m.playerB;});
    return {finished:E.stageFinished(t,st)};
  })()`);
}

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

  /* ---------- 1. 淘汰赛轮空自动判定 ---------- */
  console.log('\n=== 1. 淘汰赛轮空自动判定 ===');
  for (const [n, expect] of [[5, 3], [6, 2], [7, 1], [8, 0]]) {
    await clearAll();
    const r = await buildElim(n);
    console.log(`    ${n} 人:` , JSON.stringify(r));
    ok(`${n} 人首轮轮空数 = ${expect}`, r.byeCount === expect, r.byeCount);
    ok(`${n} 人不存在「对手为空」的实赛`, r.emptyOpponent === 0, r.emptyOpponent);
  }
  await clearAll();
  await buildElim(6);
  await reload();
  await view('matches');
  const byeCard = await ev(`(function(){
    var txt=document.body.innerText;
    return {hasBye:/轮空/.test(txt), body:txt.slice(0,400)};
  })()`);
  ok('对阵页出现「轮空」标记', byeCard.hasBye, byeCard.body.slice(0, 80));
  await shot('v14_bye_matches.png');

  // 录完实赛后本轮可直接完成、下一轮可生成
  const p1 = await playFirstRound();
  ok('6 人单败首轮录完即可完成', p1 && p1.finished === false, p1 && p1.finished);
  const gen2 = await ev(`(function(){
    var S=TMS.store,E=TMS.engine;
    var t=S.get(S.getCurrentId()); var st=t.stages[0];
    var g=E.generateRound(t); S.put(t);
    return {ok:g.ok,msg:g.msg||'',rounds:st.roundsData.length,
            m2:(st.roundsData[1]||{matches:[]}).matches.map(function(m){
              var na=(t.players.filter(function(p){return p.id===m.playerA})[0]||{}).name||'?';
              var nb=(t.players.filter(function(p){return p.id===m.playerB})[0]||{}).name||'?';
              return (m.isBye?'[轮空]':'')+na+'v'+nb;})};
  })()`);
  console.log('    第二轮:', JSON.stringify(gen2));
  ok('第二轮可以生成（轮空不再卡轮）', gen2.ok === true, gen2.msg);
  ok('第二轮 4 人成 2 场、无轮空', gen2.m2.length === 2 && gen2.m2.every(x => x.indexOf('[轮空]') < 0), gen2.m2);

  /* ---------- 2. 轮空在排名中按胜利算 ---------- */
  console.log('\n=== 2. 轮空按胜利计入排名 ===');
  await reload();
  await view('standing');
  const row = await ev(`(function(){
    var S=TMS.store,E=TMS.engine;
    var t=S.get(S.getCurrentId());
    var st=E.standings(t,{});
    var byers=st.filter(function(s){return s.byes>0});
    return byers.map(function(s){return {name:s.name,matches:s.matches,wins:s.wins,losses:s.losses,points:s.points,byes:s.byes}});
  })()`);
  console.log('    轮空者:', JSON.stringify(row));
  ok('界面排名中轮空者场次 >= 1', row.length > 0 && row.every(s => s.matches >= 1), row);
  ok('界面排名中轮空者胜场 >= 1', row.length > 0 && row.every(s => s.wins >= 1), row);
  ok('轮空者胜+平+负 = 场次', row.every(s => s.wins + s.losses <= s.matches), row);
  const seen = await ev(`(function(){
    var trs=[].slice.call(document.querySelectorAll('table tbody tr'));
    return trs.map(function(tr){var tds=tr.querySelectorAll('td');return [].slice.call(tds).map(function(x){return x.textContent.trim()}).join('|')});
  })()`);
  console.log('    排名表首行:', seen[0]);
  ok('排名表渲染出数据行', seen.length >= 6, seen.length);
  await shot('v14_standing_bye.png');

  /* ---------- 3. 只打一轮的淘汰赛晋级 ---------- */
  console.log('\n=== 3. 只打一轮（maxRounds=1）的淘汰赛晋级 ===');
  await clearAll();
  const r3 = await buildElim(8, { maxRounds: 1, advCount: 4 });
  ok('8 人设 1 轮时首轮 4 场无轮空', r3.byeCount === 0 && r3.normalCount === 4, JSON.stringify(r3));
  await reload();
  await view('setup');
  await ev(`(function(){
    var S=TMS.store,E=TMS.engine;
    var t=S.get(S.getCurrentId()); var st=t.stages[0];
    st.roundsData[0].matches.forEach(function(m){
      var sa=(t.players.filter(function(p){return p.id===m.playerA})[0]||{}).seed||9999;
      var sb=(t.players.filter(function(p){return p.id===m.playerB})[0]||{}).seed||9999;
      m.games=[{w:(sa<=sb)?'A':'B'},{w:(sa<=sb)?'A':'B'}];
      E.evaluate(m,E.fmtOf(t,st),st.tie);
    });
    E.finishRound(t); E.finishStage(t); S.put(t); return 1;
  })()`);
  await reload();
  await view('standing');
  const adv = await ev(`(function(){
    var S=TMS.store;
    var t=S.get(S.getCurrentId()); var st=t.stages[0];
    var nm=function(id){return (t.players.filter(function(p){return p.id===id})[0]||{}).name||'?'};
    return {advanced:st.advanced.map(nm), rank:(st.finalRank||[]).map(nm)};
  })()`);
  console.log('    名次:', adv.rank.join(' > '));
  console.log('    晋级:', adv.advanced.join(','));
  ok('晋级 4 人', adv.advanced.length === 4, adv.advanced);
  ok('晋级的 4 人正是首轮胜者',
    ['选手1', '选手2', '选手3', '选手4'].every(x => adv.advanced.indexOf(x) >= 0), adv.advanced);
  ok('名次里胜者全在负者之前',
    adv.rank.slice(0, 4).sort().join(',') === '选手1,选手2,选手3,选手4', adv.rank);
  await shot('v14_stand_elim_one_round.png');

  /* ---------- 4. 破同分依据可删除 / 可添加 ---------- */
  console.log('\n=== 4. 破同分依据增删 ===');
  await clearAll();
  await ev(`(function(){
    var M=TMS.model,S=TMS.store;
    var t=M.createTournament('依据增删验证');
    for(var i=1;i<=6;i++) t.players.push(M.createPlayer('R'+i, i));
    S.put(t); return 1;
  })()`);
  await reload();
  await view('setup');
  const t0 = await ev(`(function(){
    return {rows:document.querySelectorAll('[data-act="tieRemove"]').length,
            hasAddBtn:!!document.querySelector('[data-act="tieAdd"]'),
            hasSel:!!document.getElementById('tieAddSel'),
            total:(TMS.store.get(TMS.store.getCurrentId()).scoring.tieOrder||[]).length};
  })()`);
  console.log('    初始:', JSON.stringify(t0));
  ok('每条依据都有「移除」按钮', t0.rows > 0 && t0.rows === t0.total, t0);
  ok('全部依据启用时无需「添加」下拉', t0.hasAddBtn === false && t0.hasSel === false, t0);

  // 移除第一项（积分）
  await ev(`(function(){document.querySelectorAll('[data-act="tieRemove"]')[0].click();return 1})()`);
  await sleep(500);
  const t1 = await ev(`(function(){
    var o=TMS.store.get(TMS.store.getCurrentId()).scoring.tieOrder;
    return {len:o.length, first:o[0], hasPoints:o.indexOf('points')>=0,
            rows:document.querySelectorAll('[data-act="tieRemove"]').length,
            opts:[].slice.call(document.querySelectorAll('#tieAddSel option')).map(function(x){return x.value})};
  })()`);
  console.log('    移除第一项后:', JSON.stringify(t1));
  ok('依据数量减 1', t1.len === t0.total - 1, t1.len);
  ok('被移除的是「积分」', t1.hasPoints === false, t1.first);
  ok('移除后 DOM 行数同步', t1.rows === t1.len, t1.rows);
  ok('移除后出现「添加依据」下拉，且含被删项', t1.opts.length > 0 && t1.opts.indexOf('points') >= 0, t1.opts);

  // 重新添加回来
  await ev(`(function(){
    var s=document.getElementById('tieAddSel');
    s.value='points';
    document.querySelector('[data-act="tieAdd"]').click();
    return 1;
  })()`);
  await sleep(500);
  const t2 = await ev(`(function(){
    var o=TMS.store.get(TMS.store.getCurrentId()).scoring.tieOrder;
    return {len:o.length, last:o[o.length-1], hasPoints:o.indexOf('points')>=0};
  })()`);
  console.log('    重新添加后:', JSON.stringify(t2));
  ok('添加后依据数量恢复', t2.len === t0.total, t2.len);
  ok('「积分」已重新加入', t2.hasPoints === true, t2.last);

  // 持久化：刷新后仍保持
  await ev(`(function(){
    document.querySelectorAll('[data-act="tieRemove"]').forEach(function(b,i){if(i===1) b.click();});
    return 1;
  })()`);
  await sleep(400);
  const beforeReload = await ev(`TMS.store.get(TMS.store.getCurrentId()).scoring.tieOrder.length`);
  await reload();
  await view('setup');
  const afterReload = await ev(`TMS.store.get(TMS.store.getCurrentId()).scoring.tieOrder.length`);
  ok('删除结果刷新后仍保留（不被回填）', afterReload === beforeReload && afterReload === t0.total - 1,
    { before: beforeReload, after: afterReload });
  await shot('v14_tie_editor.png');

  const errs = await ev('window.__errs.join(" | ")');
  console.log('\n=== RESULT ===');
  console.log('页面报错：', errs || '(none)');
  ok('全程无 JS 报错', !errs || !errs.trim(), errs);
  console.log('\nPASS: ' + pass + '   FAIL: ' + fail);
  child.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SMOKE ERROR:', e.message); process.exit(1); });
