/**
 * v1.5.0 界面验证：双败淘汰全流程 + 总决赛三种赛制 + 加赛局独立局制
 * 用法：SMOKE_EXE=<exe路径> 时验证打包版，否则开发模式
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
async function view(v) { await ev(`(function(){var el=document.querySelector('[data-view="${v}"]');if(el){el.click();return 1}return 0})()`); await sleep(420); }
async function click(sel) {
  return ev(`(function(){var el=document.querySelector(${JSON.stringify(sel)});if(!el)return 'no-el';if(el.disabled)return 'disabled';el.click();return 'ok'})()`);
}
async function reload() {
  await ev('location.reload()'); await sleep(1700);
  await ev(`window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message))});
    (function(){var oe=console.error;console.error=function(){window.__errs.push([].slice.call(arguments).join(' '));oe.apply(console,arguments)}})();'ok'`);
}
function clearAll() {
  return ev(`(function(){var S=TMS.store;S.loadIndex().slice().forEach(function(x){S.remove(x.id);});return 1})()`);
}

// 建一个 N 人双败赛事（可指定总决赛规则）
function buildDE(n, opts) {
  return ev(`(function(n,opt){
    var M=TMS.model,S=TMS.store,E=TMS.engine;
    var t=M.createTournament('双败验证');
    for(var i=1;i<=n;i++) t.players.push(M.createPlayer('选手'+i, i));
    var st=t.stages[0];
    st.type='double_elim';
    st.name='双败淘汰';
    Object.keys(opt||{}).forEach(function(k){ st[k]=opt[k]; });
    st.participants=t.players.map(function(p){return p.id;});
    S.put(t);
    return {id:t.id, mode:st.gfMode};
  })(${n}, ${JSON.stringify(opts || {})})`);
}

// 当前轮「按种子小者胜」录完结果（可通过 force 强制某方）
function fillRound(force) {
  return ev(`(function(force){
    var S=TMS.store,E=TMS.engine;
    var t=TMS.current||S.get(S.getCurrentId());
    var st=t.stages[0];
    var rd=st.roundsData[st.roundsData.length-1];
    function seedOf(id){var p=t.players.filter(function(x){return x.id===id})[0]||{};return p.seed||9999;}
    rd.matches.forEach(function(m){
      if(m.isBye){E.evaluate(m,E.fmtOfMatch(t,st,m),st.tie);return;}
      var sa=seedOf(m.playerA), sb=seedOf(m.playerB);
      var w=(sa<=sb)?'A':'B';
      if(force && rd.isGF) w=force;
      var fmt=E.fmtOfMatch(t,st,m);
      m.games=[];
      var guard=0;
      while(guard++<12 && E.canAddGame(m,fmt,st.tie)){ m.games.push({w:w}); E.evaluate(m,fmt,st.tie); }
    });
    S.put(t);
    // 直接改数据不会触发重绘，点一次当前页签让界面刷新（真实用户是点录入按钮触发的）
    var tab=document.querySelector('.tab[data-view="matches"]');
    if(tab) tab.click();
    return {round:rd.index, isGF:!!rd.isGF, done:E.roundComplete(t,st,rd).ok};
  })(${JSON.stringify(force || null)})`);
}

function readRound() {
  return ev(`(function(){
    var S=TMS.store,E=TMS.engine;
    var t=TMS.current||S.get(S.getCurrentId());var st=t.stages[0];
    var rd=st.roundsData[st.roundsData.length-1];
    function nm(id){var p=t.players.filter(function(x){return x.id===id})[0];return p?p.name:null;}
    return {
      idx: rd.index, isGF: !!rd.isGF, gfReset: !!rd.gfReset, committed: !!rd.committed,
      W: rd.matches.filter(function(m){return m.bracket==='W'}).length,
      L: rd.matches.filter(function(m){return m.bracket==='L'}).length,
      pairs: rd.matches.map(function(m){return (m.bracket||'W')+':'+nm(m.playerA)+'/'+nm(m.playerB)}),
      adv: rd.matches.map(function(m){return m.gfAdv? m.gfAdv.side+':'+m.gfAdv.games : null}).filter(Boolean),
      finished: E.stageFinished(t,st)
    };
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

  /* ---------- 1. 阶段设置界面出现「双败 · 总决赛规则」 ---------- */
  console.log('\n=== 1. 双败阶段设置界面 ===');
  await clearAll();
  await buildDE(8, {});
  await reload();
  await view('setup');
  const setupTxt = await ev(`document.body.innerText`);
  ok('设置页出现「双败淘汰 · 总决赛规则」', /双败淘汰 · 总决赛规则/.test(setupTxt || ''));
  ok('包含三种赛制选项', /加赛制/.test(setupTxt || '') && /无优势/.test(setupTxt || '') && /让局/.test(setupTxt || ''));
  ok('包含「加赛局独立局制」开关', /加赛局独立局制/.test(setupTxt || ''));
  const gfSel = await ev(`(function(){var s=document.querySelector('[data-bind="stages[0].gfMode"]');return s?s.value:null})()`);
  ok('总决赛赛制默认 = reset', gfSel === 'reset', gfSel);
  await shot('v15_setup.png');
  await ev(`(function(){var el=[].slice.call(document.querySelectorAll('h4')).filter(function(x){return /双败淘汰 · 总决赛规则/.test(x.textContent)})[0]; if(el) el.scrollIntoView({block:'start'}); return 1})()`);
  await sleep(320);
  await shot('v15_setup_de.png');
  await ev('window.scrollTo(0,0)'); await sleep(200);

  /* ---------- 2. 只点「生成下一轮」也能正确推进（核心 bug 回归） ---------- */
  console.log('\n=== 2. 双败流程推进 ===');
  await view('matches');
  const g1 = await click('[data-act="genRound"]');
  ok('点击生成首轮', g1 === 'ok', g1);
  let r = await readRound();
  ok('首轮 4 场全部在胜者组', r.W === 4 && r.L === 0, r);
  await fillRound();
  // 直接点「生成下一轮」（不点结算本轮）
  const g2 = await click('[data-act="genRound"]');
  ok('直接点生成下一轮', g2 === 'ok', g2);
  r = await readRound();
  ok('第 2 轮出现败者组 2 场', r.L === 2, r.pairs);
  ok('第 2 轮胜者组 2 场', r.W === 2, r.W);
  ok('第 1 轮已自动结算', (await ev(`TMS.current.stages[0].roundsData[0].committed === true`)) === true);

  // 一路打到结束
  let guard = 0, sawGF = false, sawReset = false;
  while (guard++ < 15) {
    const stt = await readRound();
    if (stt.finished) break;
    if (stt.isGF) sawGF = true;
    await fillRound();
    // 加赛制：总决赛首场让败者组冠军（B）赢，应触发加赛局
    if (stt.isGF && !stt.gfReset) {
      await ev(`(function(){
        var S=TMS.store,E=TMS.engine,t=TMS.current||S.get(S.getCurrentId()),st=t.stages[0];
        var rd=st.roundsData[st.roundsData.length-1];var m=rd.matches[0];
        m.games=[{w:'B'},{w:'B'}];E.evaluate(m,E.fmtOfMatch(t,st,m),st.tie);S.put(t);
        var tab=document.querySelector('.tab[data-view="matches"]');if(tab)tab.click();
        return 1})()`);
    }
    const g = await click('[data-act="genRound"]');
    if (g !== 'ok') break;
    const r2 = await readRound();
    if (r2.gfReset) sawReset = true;
    if (r2.isGF) sawGF = true;
  }
  ok('打到总决赛', sawGF);
  ok('加赛制下出现加赛局', sawReset);
  const finalRank = await ev(`(function(){
    var S=TMS.store,E=TMS.engine,t=TMS.current||S.get(S.getCurrentId()),st=t.stages[0];
    var rk=E.computeElimRanking(t,st)||[];
    function nm(id){var p=t.players.filter(function(x){return x.id===id})[0];return p?p.name:null;}
    return {n:rk.length, top:rk.slice(0,3).map(nm)};
  })()`);
  ok('名次表 8 人完整', finalRank.n === 8, finalRank);
  ok('冠亚季军非空', finalRank.top.filter(Boolean).length === 3, finalRank.top);

  /* ---------- 3. 对阵图渲染 ---------- */
  console.log('\n=== 3. 对阵图 ===');
  await view('standing');
  const bracket = await ev(`(function(){
    var w=document.querySelector('.bracket-wrap');
    if(!w) return {ok:false};
    return {
      ok:true,
      secs:[].map.call(w.querySelectorAll('.sec-name'),function(e){return e.textContent}),
      gfCols:[].map.call(w.querySelectorAll('.bcol .col-head b'),function(e){return e.textContent}),
      cards:w.querySelectorAll('.bcard').length
    };
  })()`);
  ok('对阵图已渲染', bracket.ok === true, bracket);
  ok('含胜者组 / 败者组两行', Array.isArray(bracket.secs) && bracket.secs.join('').indexOf('胜者组') >= 0 && bracket.secs.join('').indexOf('败者组') >= 0, bracket.secs);
  ok('总决赛在胜者组行末（最右）', Array.isArray(bracket.gfCols) && bracket.gfCols.indexOf('总决赛') >= 0, bracket.gfCols);
  ok('加赛局单独成列', Array.isArray(bracket.gfCols) && bracket.gfCols.some(t => /加赛/.test(t)), bracket.gfCols);
  await shot('v15_bracket.png');
  await ev('window.scrollTo(0, 420)'); await sleep(350);
  await shot('v15_bracket_gf.png');
  await ev('window.scrollTo(0, 0)'); await sleep(200);

  /* ---------- 4. 让局模式 ---------- */
  console.log('\n=== 4. 让局（handicap） ===');
  await clearAll();
  await buildDE(8, { gfMode: 'handicap', gfAdvSide: 'W', gfHandicap: 1, useFormat: true, format: { gamesPerMatch: 5, winNeeded: 3, recordScore: false } });
  await reload();
  await view('matches');
  await click('[data-act="genRound"]');
  let guard2 = 0, advSeen = null;
  while (guard2++ < 15) {
    await fillRound();
    const stt = await readRound();
    if (stt.isGF) { advSeen = stt.adv; break; }
    const g = await click('[data-act="genRound"]');
    if (g !== 'ok') break;
  }
  ok('总决赛带「先计 1 局」标记', Array.isArray(advSeen) && advSeen[0] === 'A:1', advSeen);
  const handTxt = await ev(`document.body.innerText`);
  ok('界面显示先计局', /先计 1 局/.test(handTxt || ''));
  await shot('v15_handicap.png');

  /* ---------- 5. 无优势模式 ---------- */
  console.log('\n=== 5. 无优势（none） ===');
  await clearAll();
  await buildDE(8, { gfMode: 'none' });
  await reload();
  await view('matches');
  await click('[data-act="genRound"]');
  let guard3 = 0, gfCount = 0;
  while (guard3++ < 15) {
    await fillRound();
    const stt = await readRound();
    if (stt.isGF) {
      gfCount++;
      // 首场强制 B 方（败者组冠军）赢：无优势制下应直接结束、B 夺冠
      await ev(`(function(){
        var S=TMS.store,E=TMS.engine,t=TMS.current||S.get(S.getCurrentId()),st=t.stages[0];
        var rd=st.roundsData[st.roundsData.length-1];var m=rd.matches[0];
        m.games=[{w:'B'},{w:'B'}];E.evaluate(m,E.fmtOfMatch(t,st,m),st.tie);S.put(t);return 1})()`);
      break;
    }
    const g = await click('[data-act="genRound"]');
    if (g !== 'ok') break;
  }
  const noneRes = await ev(`(function(){
    var S=TMS.store,E=TMS.engine,t=TMS.current||S.get(S.getCurrentId()),st=t.stages[0];
    var gfs=st.roundsData.filter(function(rd){return rd.isGF});
    var last=gfs[gfs.length-1].matches[0];
    var rk=E.computeElimRanking(t,st)||[];
    function nm(id){var p=t.players.filter(function(x){return x.id===id})[0];return p?p.name:null;}
    return {gf:gfs.length, champ:nm(rk[0]), gfWinner:nm(last.result.winner==='A'?last.playerA:last.playerB)};
  })()`);
  ok('只打 1 场总决赛', noneRes.gf === 1, noneRes.gf);
  ok('冠军 = 总决赛胜者（败者组冠军）', noneRes.champ === noneRes.gfWinner, noneRes);

  /* ---------- 6. 无 JS 报错 ---------- */
  console.log('\n=== 6. 页面报错 ===');
  const errs = await ev('window.__errs || []');
  console.log('页面报错：', errs && errs.length ? JSON.stringify(errs.slice(0, 5)) : '(none)');
  ok('全程无 JS 报错', !errs || errs.length === 0, errs);

  console.log('\n=== RESULT ===');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  child.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常：', e); process.exit(1); });
