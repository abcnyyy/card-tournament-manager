/**
 * v1.6.0 界面验证：提前晋级 / 提前淘汰
 *  1. 阶段设置界面（启用、判定依据、晋级线、淘汰线、下阶段加分）
 *  2. 界面录入走完 3 轮：第 2 轮后出现提前晋级/淘汰，第 3 轮只排剩余的人
 *  3. 排名页：状态条、行标记、名次分层
 *  4. 阶段结束 → 下一阶段加分生效
 * 用法：SMOKE_EXE=<exe路径> 时验证打包版
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ELEC = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const OUT = path.join(ROOT, 'tools', 'smoke_out');
const PORT = 9347;
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

// 8 人 + 2 阶段（瑞士轮 3 轮 → 单败），提前晋级/淘汰由界面修改
function buildT() {
  return ev(`(function(){
    var M=TMS.model,S=TMS.store;
    var t=M.createTournament('提前晋级验证');
    for(var i=1;i<=8;i++) t.players.push(M.createPlayer('选手'+i, i));
    var s0=t.stages[0];
    s0.name='瑞士轮'; s0.type='swiss'; s0.rounds=3;
    s0.clinch={enabled:false, basis:'match', winTarget:0, lossTarget:0, bonus:0, bonusPerEarly:0};
    var s1=M.defaultStage(1);
    s1.name='决赛阶段'; s1.type='single_elim'; s1.adv={type:'all',count:8,score:0,perGroup:2};
    t.stages.push(s1);
    S.put(t);
    return t.id;
  })()`);
}

// 通过界面控件改值（真实 change 事件）
function setBind(sel, val, isCheck) {
  return ev(`(function(){
    var el=document.querySelector(${JSON.stringify(sel)});
    if(!el) return 'no-el';
    if(${isCheck ? 'true' : 'false'}) el.checked=!!${JSON.stringify(!!val)};
    else el.value=${JSON.stringify(String(val))};
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return 'ok';
  })()`);
}

function fillRound() {
  return ev(`(function(){
    var S=TMS.store,E=TMS.engine;
    var t=TMS.current||S.get(S.getCurrentId());
    var st=t.stages[t.currentStage];
    var rd=st.roundsData[st.roundsData.length-1];
    function seedOf(id){var p=t.players.filter(function(x){return x.id===id})[0]||{};return p.seed||9999;}
    rd.matches.forEach(function(m){
      if(m.isBye){E.evaluate(m,E.fmtOfMatch(t,st,m),st.tie);return;}
      var sa=seedOf(m.playerA), sb=seedOf(m.playerB);
      var w=(sa<=sb)?'A':'B';
      var fmt=E.fmtOfMatch(t,st,m);
      m.games=[];
      var guard=0;
      while(guard++<12 && E.canAddGame(m,fmt,st.tie)){ m.games.push({w:w}); E.evaluate(m,fmt,st.tie); }
    });
    S.put(t);
    var tab=document.querySelector('.tab[data-view="matches"]');
    if(tab) tab.click();
    return {round:rd.index, done:E.roundComplete(t,st,rd).ok};
  })()`);
}

function readState() {
  return ev(`(function(){
    var S=TMS.store,E=TMS.engine;
    var t=TMS.current||S.get(S.getCurrentId());
    var st=t.stages[t.currentStage];
    function nm(id){var p=t.players.filter(function(x){return x.id===id})[0];return p?p.name:null;}
    var rd=st.roundsData[st.roundsData.length-1];
    return {
      ci: t.currentStage,
      nClinch: (st.clinched||[]).length,
      nElim: (st.eliminated||[]).length,
      cNames: (st.clinched||[]).map(nm),
      eNames: (st.eliminated||[]).map(nm),
      matches: rd?rd.matches.length:0,
      pool: rd?E.roundPool(rd).length:0,
      poolNames: rd?E.roundPool(rd).map(nm):[],
      finished: E.stageFinished(t,st),
      alive: E.aliveInStage(t,st).length
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

  /* ---------- 1. 阶段设置界面 ---------- */
  console.log('\n=== 1. 阶段设置界面 ===');
  await clearAll();
  await buildT();
  await reload();
  await view('setup');
  const txt0 = await ev(`document.body.innerText`);
  ok('设置页出现「提前晋级 / 提前淘汰」', /提前晋级 \/ 提前淘汰/.test(txt0 || ''));
  ok('有启用开关', (await ev(`!!document.querySelector('[data-bind="stages[0].clinch.enabled"]')`)) === true);

  // 勾选启用
  ok('勾选启用', (await setBind('[data-bind="stages[0].clinch.enabled"]', true, true)) === 'ok');
  await sleep(400);
  const txt1 = await ev(`document.body.innerText`);
  ok('启用后出现判定依据', /判定依据/.test(txt1 || ''));
  ok('出现晋级线输入', (await ev(`!!document.querySelector('[data-bind="stages[0].clinch.winTarget"]')`)) === true);
  ok('出现淘汰线输入', (await ev(`!!document.querySelector('[data-bind="stages[0].clinch.lossTarget"]')`)) === true);
  ok('出现下一阶段加分输入', (await ev(`!!document.querySelector('[data-bind="stages[0].clinch.bonus"]')`)) === true);
  ok('出现每提前一轮加权输入', (await ev(`!!document.querySelector('[data-bind="stages[0].clinch.bonusPerEarly"]')`)) === true);
  await ev("(function(){var el=[].slice.call(document.querySelectorAll('h4')).filter(function(x){return /提前晋级/.test(x.textContent)})[0]; if(el) el.scrollIntoView({block:'start'}); return 1})()");
  await sleep(350);
  await shot('v16_setup_clinch.png');
  await ev('window.scrollTo(0,0)'); await sleep(200);

  await setBind('[data-bind="stages[0].clinch.winTarget"]', 2);
  await sleep(250);
  await setBind('[data-bind="stages[0].clinch.lossTarget"]', 2);
  await sleep(250);
  await setBind('[data-bind="stages[0].clinch.bonus"]', 2);
  await sleep(250);
  await setBind('[data-bind="stages[0].clinch.bonusPerEarly"]', 1);
  await sleep(350);
  const cfg = await ev(`(function(){var c=TMS.current.stages[0].clinch;return c})()`);
  ok('界面改值写入数据：2 胜晋级', cfg.winTarget === 2, cfg);
  ok('界面改值写入数据：2 负淘汰', cfg.lossTarget === 2, cfg);
  ok('界面改值写入数据：加分 2', cfg.bonus === 2, cfg);
  ok('界面改值写入数据：每轮加权 1', cfg.bonusPerEarly === 1, cfg);
  ok('判定依据默认按场次', cfg.basis === 'match', cfg);

  /* ---------- 2. 走完 3 轮 ---------- */
  console.log('\n=== 2. 三轮流程 ===');
  await view('matches');
  ok('生成首轮', (await click('[data-act="genRound"]')) === 'ok');
  await sleep(300);
  await fillRound();
  await sleep(250);
  const fr1=await click('[data-act="finishRound"]');
  await sleep(400);
  let s = await readState();
  ok('第 1 轮后无人判定', s.nClinch === 0 && s.nElim === 0, s);

  ok('生成第 2 轮', (await click('[data-act="genRound"]')) === 'ok');
  await sleep(300);
  await fillRound();
  await sleep(250);
  const finMsg = await ev(`(function(){return (document.getElementById('toast')||{}).textContent||''})()`);
  const fr2=await click('[data-act="finishRound"]');
  await sleep(400);
  s = await readState();
  ok('完成本轮按钮可用（第 2 轮）', fr2 === 'ok', fr2);
  ok('第 2 轮后 2 人提前晋级', s.nClinch === 2, s);
  ok('第 2 轮后 2 人提前淘汰', s.nElim === 2, s);
  ok('提示里出现「提前晋级」', /提前晋级/.test(finMsg) || /提前晋级/.test(await ev(`(document.getElementById('toast')||{}).textContent||''`)), finMsg);

  ok('生成第 3 轮', (await click('[data-act="genRound"]')) === 'ok');
  await sleep(350);
  s = await readState();
  ok('第 3 轮只剩 2 桌', s.matches === 2, s);
  ok('第 3 轮只剩 4 人出场', s.pool === 4, s);
  ok('第 3 轮出场名单不含已判定者', (function () {
    const gone = s.cNames.concat(s.eNames);
    return gone.every(n => s.poolNames.indexOf(n) < 0);
  })(), { pool: s.poolNames, gone: s.cNames.concat(s.eNames) });
  await shot('v16_round3.png');

  await fillRound();
  await sleep(250);
  const fr3=await click('[data-act="finishRound"]');
  await sleep(400);
  s = await readState();
  ok('第 3 轮后共 4 人淘汰', s.nElim === 4, s);
  ok('阶段自然结束', s.finished === true, s);

  /* ---------- 3. 排名页 ---------- */
  console.log('\n=== 3. 排名页 ===');
  await view('standing');
  const rank = await ev(`(function(){
    var t=TMS.current;
    var st=t.stages[0];
    var list=TMS.engine.standings(t,{stageIndex:0});
    var notices=[].slice.call(document.querySelectorAll('.notice')).map(function(e){return e.innerText});
    return {
      notice: notices.length > 0,
      noticeTxt: notices.filter(function(x){return /提前晋级/.test(x)})[0]||'',
      rowClinch: document.querySelectorAll('tr.row-clinch').length,
      rowElim: document.querySelectorAll('tr.row-elim').length,
      order: list.map(function(s){return s.name+':'+s.rank+'/L'+s.layer}),
      firstIsClinch: list.length ? list[0].clinched : false,
      lastIsElim: list.length ? list[list.length-1].eliminated : false,
      rankText: [].slice.call(document.querySelectorAll('table.compact tbody tr')).map(function(r){return r.innerText.replace(/\\s+/g,' ')})
    };
  })()`);
  ok('排名页有状态条', rank.notice === true);
  ok('状态条写明晋级线 / 淘汰线', /2 场/.test(rank.noticeTxt) && /提前晋级/.test(rank.noticeTxt), rank.noticeTxt);
  ok('状态条区分「提前」与「末轮达标」', /已提前晋级 2 人/.test(rank.noticeTxt) && /另有 2 人末轮达标/.test(rank.noticeTxt), rank.noticeTxt);
  ok('状态条显示淘汰人数', /已淘汰 4 人/.test(rank.noticeTxt), rank.noticeTxt);
  ok('只有真正提前晋级的行被标记', rank.rowClinch === 2, rank.rowClinch);
  ok('只有真正提前淘汰的行被标记', rank.rowElim === 2, rank.rowElim);
  ok('第 1 名是提前晋级者', rank.firstIsClinch === true, rank.order);
  ok('最后 1 名是淘汰者', rank.lastIsElim === true, rank.order);
  ok('状态列出现「提前晋级（提前 N 轮）」', rank.rankText.some(t => /提前晋级（提前 \d+ 轮）/.test(t)), rank.rankText.slice(0, 3));
  ok('状态列区分末轮达标', rank.rankText.some(t => /晋级（末轮达标）/.test(t)), rank.rankText.slice(0, 4));
  ok('状态列区分末轮出局', rank.rankText.some(t => /淘汰（末轮出局）/.test(t)), rank.rankText.slice(-3));
  ok('状态列出现「提前淘汰（第 2 轮）」', rank.rankText.some(t => /提前淘汰（第 2 轮）/.test(t)), rank.rankText.slice(-3));
  ok('状态列出现下阶段加分', rank.rankText.some(t => /下阶段 \+/.test(t)), rank.rankText.slice(0, 3));
  await shot('v16_standing.png');

  /* ---------- 4. 下一阶段加分 ---------- */
  console.log('\n=== 4. 下一阶段加分 ===');
  await view('matches');
  const fin = await click('[data-act="finishStage"]');
  ok('点击结束本阶段', fin === 'ok', fin);
  await sleep(600);
  // 有确认框时点确定
  const modalOk = await click('#modalOk');
  if (modalOk === 'ok') await sleep(500);

  const nx = await ev(`(function(){
    var t=TMS.current, TMSx=TMS;
    var st=t.stages[t.currentStage];
    var ids=st.participants||[];
    var stats=TMSx.engine.buildStats(t,st,ids,null);
    function nm(id){var p=t.players.filter(function(x){return x.id===id})[0];return p?p.name:null;}
    return {
      ci: t.currentStage,
      parts: ids.length,
      bonuses: Object.keys(st.carryBonus||{}).map(function(k){return nm(k)+':'+st.carryBonus[k]}),
      ptsWithBonus: ids.filter(function(id){return (st.carryBonus||{})[id]}).map(function(id){return nm(id)+'='+stats[id].points})
    };
  })()`);
  ok('已进入第 2 阶段', nx.ci === 1, nx);
  ok('下一阶段记录了 2 人的加分', nx.bonuses.length === 2, nx.bonuses);
  ok('加分数值 = 基础 2 + 提前轮次加权', nx.bonuses.every(b => /:\d+$/.test(b)) && nx.bonuses.some(b => +b.split(':')[1] > 2), nx.bonuses);
  ok('下一阶段积分已含加分', nx.ptsWithBonus.every(p => +p.split('=')[1] >= 2), nx.ptsWithBonus);
  await shot('v16_next_stage.png');

  /* ---------- 5. 全程无 JS 报错 ---------- */
  const errs = await ev('window.__errs || []');
  ok('全程无 JS 报错', errs.length === 0, errs);

  console.log('\n=========== PASS: ' + pass + '   FAIL: ' + fail + ' ===========');
  child.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('崩溃：', e); process.exit(1); });
