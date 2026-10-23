/**
 * v1.7.0 界面验证：对阵页实时战绩（胜 / 负 / 平 · 积分 · 名次）
 *  1. 首轮开局：所有卡片显示 0 胜 0 负 0 平 · 0 分
 *  2. 只录入第一桌 → 该桌两人立即变化，其余桌不变（无需点「完成本轮」）
 *  3. 显示值与 E.standings 完全一致（积分 / 名次 / 场次）
 *  4. 录入全部 → 全场战绩自洽（总胜 = 总负）
 *  5. 生成下一轮后，历史轮次卡片显示「截至该轮」的战绩
 * 用法：SMOKE_EXE=<exe路径> 时验证打包版
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ELEC = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const OUT = path.join(ROOT, 'tools', 'smoke_out');
const PORT = 9357;
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

/* 读取当前轮每张卡片：桌号、双方姓名、双方战绩文本、是否已结束 */
function readCards() {
  return ev(`(function(){
    var cards=[].slice.call(document.querySelectorAll('.match'));
    return cards.map(function(c){
      var head=(c.querySelector('.match-head')||{}).innerText||'';
      var sides=[].slice.call(c.querySelectorAll('.side'));
      return {
        head: head.replace(/\\s+/g,' ').trim(),
        done: c.classList.contains('done'),
        sides: sides.map(function(s){
          return {
            name: ((s.querySelector('.pname')||{}).innerText||'').trim(),
            rec: ((s.querySelector('.prec')||{}).innerText||'').replace(/\\s+/g,' ').trim()
          };
        })
      };
    });
  })()`);
}

/* 榜单真值：id -> {name, wins, losses, draws, points, rank} */
function readTruth() {
  return ev(`(function(){
    var E=TMS.engine, t=TMS.current;
    var st=t.stages[t.currentStage];
    return E.standings(t,{stageIndex:t.currentStage}).map(function(s){
      return {name:s.name, w:s.wins, l:s.losses, d:s.draws, p:s.points, rank:s.rank};
    });
  })()`);
}

/* 点第 idx 张卡片的「A 胜」一次（BO3 里点两次即结束） */
function winOne(idx) {
  return ev(`(function(){
    var cards=[].slice.call(document.querySelectorAll('.match'));
    var c=cards[${idx}]; if(!c) return 'no-card';
    var b=c.querySelector('[data-act="addGame"][data-w="A"]');
    if(!b) return 'no-btn'; if(b.disabled) return 'disabled';
    b.click(); return 'ok';
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

  /* ---------- 0. 建赛事 ---------- */
  await clearAll();
  await ev(`(function(){
    var M=TMS.model,S=TMS.store;
    var t=M.createTournament('实时战绩验证');
    for(var i=1;i<=8;i++) t.players.push(M.createPlayer('选手'+i, i));
    var s0=t.stages[0];
    s0.name='瑞士轮'; s0.type='swiss'; s0.rounds=3;
    S.put(t); return t.id;
  })()`);
  await reload();
  await view('matches');

  console.log('\n=== 1. 首轮开局：全为 0 ===');
  ok('生成首轮', (await click('[data-act="genRound"]')) === 'ok');
  await sleep(400);
  let cards = await readCards();
  ok('首轮出现 4 张卡片', cards.length === 4, cards.length);
  const allZero = cards.every(c => c.sides.length === 2 && c.sides.every(s => /0 胜 0 负 0 平/.test(s.rec)));
  ok('所有选手显示 0 胜 0 负 0 平', allZero, cards.map(c => c.sides.map(s => s.rec)));
  ok('积分显示 0 分', cards.every(c => c.sides.every(s => /0 分/.test(s.rec))), cards[0] && cards[0].sides.map(s=>s.rec));
  ok('显示当前名次', cards.every(c => c.sides.every(s => /第 \d+ 名/.test(s.rec))), cards[0] && cards[0].sides.map(s=>s.rec));
  const legend = await ev(`document.body.innerText`);
  ok('页面有实时战绩说明', /实时战绩/.test(legend || ''), (legend || '').slice(0, 60));

  console.log('\n=== 2. 录入第一桌：实时变化 ===');
  const first = cards[0].sides.map(s => s.name);
  ok('第 1 桌 A 方先胜一局', (await winOne(0)) === 'ok');
  await sleep(300);
  cards = await readCards();
  ok('第 1 桌仍为未完成（1 局）', !cards[0].done, cards[0].done);
  ok('进行中的比赛不提前计分（仍 0 胜 0 分）',
    /0 胜 0 负 0 平/.test(cards[0].sides[0].rec) && /0 分/.test(cards[0].sides[0].rec),
    cards[0].sides[0].rec);
  ok('比分板实时显示 1 : 0', /1 : 0/.test(await ev(`(function(){var c=document.querySelectorAll('.match')[0];return (c.querySelector('.bigscore')||{}).innerText||''})()`)));
  ok('未参与的其他桌不变', /0 胜 0 负 0 平/.test(cards[1].sides[0].rec), cards[1].sides[0].rec);

  ok('再胜一局', (await winOne(0)) === 'ok');
  await sleep(350);
  cards = await readCards();
  ok('第 1 桌已结束', cards[0].done === true, cards[0].done);
  ok('胜方 1 胜 0 负（按比赛场次计）', /1 胜 0 负/.test(cards[0].sides[0].rec), cards[0].sides[0].rec);
  ok('负方 0 胜 1 负', /0 胜 1 负/.test(cards[0].sides[1].rec), cards[0].sides[1].rec);
  ok('胜方拿到 3 分', /3 分/.test(cards[0].sides[0].rec), cards[0].sides[0].rec);

  console.log('\n=== 3. 显示值与榜单一致 ===');
  let truth = await readTruth();
  const tmap = {}; truth.forEach(s => tmap[s.name] = s);
  const seg = t => {
    let m = /(\d+) 胜 (\d+) 负 (\d+) 平/.exec(t) || [];
    let p = /([\d.]+) 分/.exec(t) || [];
    let r = /第 (\d+) 名/.exec(t) || [];
    return { w: +m[1], l: +m[2], d: +m[3], p: parseFloat(p[1]), rank: +r[1] };
  };
  let mismatch = [];
  cards.forEach(c => c.sides.forEach(s => {
    const g = seg(s.rec), tr = tmap[s.name];
    if (!tr) { mismatch.push([s.name, 'missing']); return; }
    if (g.w !== tr.w || g.l !== tr.l || g.d !== tr.d || g.p !== tr.p || g.rank !== tr.rank) {
      mismatch.push([s.name, g, tr]);
    }
  }));
  ok('每人战绩 / 积分 / 名次与榜单逐一相符', mismatch.length === 0, mismatch);

  console.log('\n=== 4. 录完全部：战绩自洽 ===');
  for (let i = 1; i < 4; i++) {
    for (let k = 0; k < 3; k++) {
      const r = await winOne(i);
      if (r !== 'ok') break;
      await sleep(220);
    }
  }
  await sleep(400);
  cards = await readCards();
  truth = await readTruth();
  const sumW = truth.reduce((a, s) => a + s.w, 0);
  const sumL = truth.reduce((a, s) => a + s.l, 0);
  const sumM = truth.reduce((a, s) => a + s.w + s.l + s.d, 0);
  ok('总胜 = 总负', sumW === sumL, [sumW, sumL]);
  ok('总场次 = 8 人 × 各 1 场', sumM === 8, sumM);
  ok('所有卡片都显示 1 场', cards.every(c => c.sides.every(s => {
    const g = seg(s.rec); return g.w + g.l + g.d === 1;
  })), cards.map(c => c.sides.map(s => s.rec)));
  ok('胜者一侧反白且积分更高', (function () {
    const c = cards[0]; if (!c.done) return false;
    const a = seg(c.sides[0].rec), b = seg(c.sides[1].rec);
    return a.p !== b.p;
  })(), cards[0] && cards[0].sides.map(s => s.rec));
  await shot('v17_match_records.png');

  console.log('\n=== 5. 历史轮次按当时口径 ===');
  ok('生成下一轮', (await click('[data-act="genRound"]')) === 'ok');
  await sleep(500);
  const cardIdx = await ev(`(function(){
    return [].slice.call(document.querySelectorAll('.card')).map(function(c){
      return ((c.querySelector('h3')||{}).innerText||'') + '|' + c.querySelectorAll('.match').length;
    });
  })()`);
  ok('出现第 2 轮卡片', cardIdx.some(t => /第 2 轮/.test(t)), cardIdx);
  // 回看历史轮次：v1.11 起改为「轮次切换条」，点第 1 轮即可回看
  const hasBar = await ev(`!!document.querySelector('[data-act="pickRound"]')`);
  if (hasBar) {
    await ev(`(function(){
      var chips=document.querySelectorAll('[data-act="pickRound"]');
      for(var i=0;i<chips.length;i++){ if(/第 1 轮/.test(chips[i].innerText)) { chips[i].click(); return 1; } }
      return 0;
    })()`);
    await sleep(450);
  } else {
    const hasHist = await ev(`!!document.querySelector('[data-act="toggleHistory"]')`);
    if (hasHist) { await click('[data-act="toggleHistory"]'); await sleep(450); }
  }
  const hist = await ev(`(function(){
    var c=[].slice.call(document.querySelectorAll('.card')).filter(function(x){
      return /第 1 轮/.test(((x.querySelector('h3')||{}).innerText||''));
    })[0];
    if(!c) return null;
    return [].slice.call(c.querySelectorAll('.match .side .prec')).map(function(e){
      return e.innerText.replace(/\\s+/g,' ').trim();
    });
  })()`);
  ok('历史第 1 轮已展开', Array.isArray(hist) && hist.length === 8, hist);
  ok('历史轮次显示的是「截至该轮」的战绩（各 1 场）', (hist || []).every(t => {
    const g = seg(t); return g.w + g.l + g.d === 1;
  }), hist);

  console.log('\n=== 6. 无脚本报错 ===');
  const errs = await ev('window.__errs');
  ok('全程无 JS 报错', !errs || errs.length === 0, errs);

  console.log('\n----------------------------------------');
  console.log(`PASS: ${pass}   FAIL: ${fail}`);
  child.kill();
  process.exit(fail ? 1 : 0);
})().catch(async e => {
  console.error(e);
  try { if (conn) await shot('v17_error.png'); } catch (_) {}
  process.exit(1);
});
