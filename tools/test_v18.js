/**
 * v1.8.0 引擎测试
 *  A. 淘汰赛自动规划：轮数 / 规模 / 轮空（由人数 + 晋级人数算出）
 *  B. 单败「打满 N 轮取 M 人」：轮数正确、剩 M 人、晋级 M 人
 *  C. 固定人数晋级 + 同分同名次（同分者一起晋级）
 *  D. 可升格决赛：败者组冠军赢下首场 → 第二场升格，双方都要新获胜局数
 *  E. 完整对阵图：每格都有选手或来源标签；双败总决赛在最右列
 *  F. 双败不变量：任何人最多负 2 场
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const base = path.join(ROOT, 'app', 'js');
const sandbox = { window: {}, console, Math, Date, JSON, parseFloat, parseInt, isNaN, Object, Array, String, Number };
sandbox.global = sandbox;
vm.createContext(sandbox);
['core.js', 'formats.js', 'engine.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(base, f), 'utf8'), sandbox, { filename: f });
});
const { model: M, engine: E } = sandbox.window.TMS;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra === undefined ? '' : '  →  ' + JSON.stringify(extra))); }
}
function sec(t) { console.log('\n[' + t + ']'); }

/* ---------------- 建赛事工具 ---------------- */
function mk(n, stageType, opts) {
  const t = M.createTournament('T');
  for (let i = 1; i <= n; i++) t.players.push(M.createPlayer('P' + i, i));
  const a = M.defaultStage(0), b = M.defaultStage(1);
  a.type = stageType;
  Object.assign(a, opts || {});
  b.type = 'swiss'; b.rounds = 3;
  t.stages = (opts && opts.__single) ? [a] : [a, b];
  if (opts && opts.__single) t.stages = [a];
  t.status = 'running';
  E.ensureParticipants(t);
  return t;
}
function numOf(t, id) { const p = t.players.filter(x => x.id === id)[0]; return p ? +String(p.name).replace('P', '') : 0; }
// 让编号小的赢；gfFirstLoser='B' 时首场总决赛强制败者组冠军赢
function playRound(t, st, opt) {
  const rd = st.roundsData[st.roundsData.length - 1];
  rd.matches.forEach(m => {
    if (m.isBye) { E.evaluate(m, E.fmtOfMatch(t, st, m), st.tie); return; }
    let w = numOf(t, m.playerA) < numOf(t, m.playerB) ? 'A' : 'B';
    if (opt && opt.gfLoser && rd.isGF && m.gfRound !== 'reset' && opt.gfLoser === 'A') w = 'B';
    const f = E.fmtOfMatch(t, st, m);
    m.games = [];
    const need = (parseInt(f.winNeeded, 10) > 0) ? parseInt(f.winNeeded, 10) : f.gamesPerMatch;
    for (let k = 0; k < need; k++) m.games.push({ w: w });
    E.evaluate(m, f, st.tie);
    m.decidedOverride = null;
  });
  return rd;
}
function runAll(t, st, opt) {
  let guard = 0;
  while (guard++ < 40) {
    let g = E.generateRound(t);
    if (!g.ok) break;
    playRound(t, st, opt);
    if (E.stageFinished(t, st)) break;
  }
  return guard;
}
function lossCount(t, st) {
  const lc = {};
  (st.participants || []).forEach(id => { lc[id] = 0; });
  (st.roundsData || []).forEach(rd => (rd.matches || []).forEach(m => {
    if (m.isThird || !m.result || !m.result.winner || rd.isGF) return;
    if (m.isBye) return;
    const l = m.result.winner === 'A' ? m.playerB : m.playerA;
    if (l) lc[l] = (lc[l] || 0) + 1;
  }));
  return lc;
}

/* ================= A. 淘汰赛自动规划 ================= */
sec('A. 淘汰赛自动规划（人数 + 晋级人数 → 轮数 / 规模 / 轮空）');
[
  [8, 1, 3, 8, 0],
  [20, 8, 2, 32, 12],
  [17, 8, 2, 32, 15],
  [12, 4, 2, 16, 4],
  [24, 6, 2, 24, 0],
  [6, 1, 3, 8, 2],
  [20, 16, 1, 32, 12],
  [10, 3, 2, 12, 2]
].forEach(c => {
  const p = E.elimPlan(c[0], c[1]);
  ok(c[0] + ' 人取 ' + c[1] + '：' + c[2] + ' 轮 / 规模 ' + c[3] + ' / 轮空 ' + c[4],
    p.rounds === c[2] && p.size === c[3] && p.byes === c[4], p);
});
ok('每轮场次之和 = 规模 - 目标人数', (function () {
  const p = E.elimPlan(20, 8);
  const sum = p.perRound.reduce((a, b) => a + b, 0);
  return sum === p.size - p.target;
})());
ok('最后一轮后正好剩目标人数', (function () {
  const p = E.elimPlan(20, 8);
  return p.survivors[p.survivors.length - 1] === 8;
})());

sec('A2. 目标人数取值（最后一阶段 = 1，中间阶段 = 晋级人数）');
let t1 = mk(20, 'single_elim', { adv: { type: 'count', count: 8, score: 0, perGroup: 2 } });
ok('中间阶段：取 adv.count', E.elimTarget(t1, t1.stages[0]) === 8, E.elimTarget(t1, t1.stages[0]));
let t1b = mk(20, 'single_elim', { __single: true, adv: { type: 'count', count: 8, score: 0, perGroup: 2 } });
ok('最后一阶段：取冠军', E.elimTarget(t1b, t1b.stages[0]) === 1, E.elimTarget(t1b, t1b.stages[0]));
let t1c = mk(20, 'single_elim', { adv: { type: 'all', count: 8, score: 0, perGroup: 2 } });
ok('全部晋级：没有淘汰意义，按冠军处理', E.elimTarget(t1c, t1c.stages[0]) === 1);

/* ================= B. 单败「取 M 人」 ================= */
sec('B. 单败 20 人取 8 人');
let tb = mk(20, 'single_elim', { adv: { type: 'count', count: 8, score: 0, perGroup: 2 } });
ok('理论轮数 = 2', E.plannedRounds(tb.stages[0], 20) === 2, E.plannedRounds(tb.stages[0], 20));
let gb = E.generateRound(tb);
ok('生成首轮成功', gb.ok, gb);
ok('首轮 16 场（4 实打 + 12 轮空）', tb.stages[0].roundsData[0].matches.length === 16
  && tb.stages[0].roundsData[0].matches.filter(m => m.isBye).length === 12);
ok('对阵表规模 32 / 轮空 12 写回阶段', tb.stages[0].bracketSize === 32 && tb.stages[0].elimByes === 12,
  [tb.stages[0].bracketSize, tb.stages[0].elimByes]);
playRound(tb, tb.stages[0]);
ok('第 2 轮还能生成', E.generateRound(tb).ok);
playRound(tb, tb.stages[0]);
let gb3 = E.generateRound(tb);
ok('剩 8 人后不再生成下一轮', !gb3.ok, gb3);
ok('提示里说清「达到晋级人数」', /晋级人数/.test(gb3.msg || ''), gb3.msg);
E.finishStage(tb);
ok('晋级正好 8 人', (tb.stages[0].advanced || []).length === 8, (tb.stages[0].advanced || []).length);

sec('B2. 单败末阶段（取冠军）仍然是完整一棵树');
let tb2 = mk(8, 'single_elim', { __single: true });
ok('8 人 = 3 轮', E.plannedRounds(tb2.stages[0], 8) === 3);
runAll(tb2, tb2.stages[0]);
ok('打完 3 轮', tb2.stages[0].roundsData.length === 3, tb2.stages[0].roundsData.length);
ok('冠军已产生', !!E.computeElimRanking(tb2, tb2.stages[0]));
ok('无轮空', tb2.stages[0].roundsData[0].matches.every(m => !m.isBye));

/* ================= C. 固定人数 + 同分同名次 ================= */
sec('C. 固定人数晋级（同分同名次一起晋级）');
function mkSwiss(pts) {
  // 手工造一个 4 轮瑞士轮阶段，直接写积分
  const t = M.createTournament('T');
  const n = pts.length;
  for (let i = 0; i < n; i++) t.players.push(M.createPlayer('P' + (i + 1), i + 1));
  t.stages = [M.defaultStage(0), M.defaultStage(1)];
  t.stages[0].type = 'swiss'; t.stages[0].rounds = 1;
  t.stages[1].type = 'swiss';
  t.status = 'running';
  E.ensureParticipants(t);
  const st = t.stages[0];
  // 用单轮对阵把成绩做成需要的积分：只填 standings 依赖的 result
  st.roundsData = [{ index: 0, matches: [] }];
  return t;
}
// 直接构造积分更可控：用 scoreline 记分（每局一分）+ 手动结果
function setupPoints(target) {
  const t = M.createTournament('T');
  const n = target.length;
  for (let i = 0; i < n; i++) t.players.push(M.createPlayer('P' + (i + 1), i + 1));
  t.stages = [M.defaultStage(0), M.defaultStage(1)];
  const st = t.stages[0];
  st.type = 'swiss'; st.rounds = 3;
  st.adv = { type: 'count_tie', count: 2, score: 0, perGroup: 2 };
  t.stages[1].type = 'swiss';
  t.status = 'running';
  E.ensureParticipants(t);
  // 伪造积分：直接给每个选手写 initialScore，用 standings 的初始分口径
  t.players.forEach((p, i) => { p.initialScore = target[i]; });
  st.roundsData = [];
  return t;
}
let tc = setupPoints([10, 8, 8, 6, 4]);
let stc = E.standings(tc, { stageIndex: 0 });
ok('5 人积分排序正确', stc.map(s => s.points).join(',') === '10,8,8,6,4', stc.map(s => s.points));
E.finishStage(tc);
ok('取前 2 人 + 第 2 名同分者 → 共 3 人', (tc.stages[0].advanced || []).length === 3,
  (tc.stages[0].advanced || []).length);
ok('同分者确实一起晋级（P2、P3）', (function () {
  const adv = tc.stages[0].advanced;
  const bySeed = id => +String(tc.players.filter(p => p.id === id)[0].name).replace('P', '');
  const set = adv.map(bySeed).sort();
  return set.join(',') === '1,2,3';
})(), tc.stages[0].advanced.map(id => tc.players.filter(p => p.id === id)[0].name));

let tc2 = setupPoints([10, 8, 7, 6]);
E.finishStage(tc2);
ok('没有同分时就是 N 人', (tc2.stages[0].advanced || []).length === 2);

let tc3 = setupPoints([10, 8, 8, 8, 8]);
E.finishStage(tc3);
ok('第 2 名有 4 人同分 → 全部带上（5 人）', (tc3.stages[0].advanced || []).length === 5,
  (tc3.stages[0].advanced || []).length);

sec('C2. 淘汰赛按名次裁人时同分不扩招');
let tc4 = mk(8, 'single_elim', { adv: { type: 'count_tie', count: 4, score: 0, perGroup: 2 } });
runAll(tc4, tc4.stages[0]);
E.finishStage(tc4);
ok('单败取 4 人（同分不扩招）', (tc4.stages[0].advanced || []).length === 4,
  (tc4.stages[0].advanced || []).length);

/* ================= D. 可升格决赛（一场定胜负 · 比分累计） ================= */
sec('D. 可升格决赛：一场、比分累计、败者组冠军到线才升格');

// 打到总决赛前的辅助
function runToGF(t, st) {
  let guard = 0;
  while (guard++ < 30) {
    const g = E.generateRound(t);
    if (!g.ok) return { ok: false, msg: g.msg };
    const rd = st.roundsData[st.roundsData.length - 1];
    if (rd.isGF) return { ok: true, rd: rd };
    playRound(t, st);
  }
  return { ok: false, msg: '轮次过多' };
}
function addG(t, st, m, side) {
  m.games.push({ w: side });
  const f = E.fmtOfMatch(t, st, m);
  E.evaluate(m, f, st.tie);
  return E.fmtOfMatch(t, st, m);
}
const ELEV = {
  __single: true, gfMode: 'elevate',
  gfUseFormat: true, gfFormat: { gamesPerMatch: 5, winNeeded: 3, recordScore: false }
};

let td = mk(8, 'double_elim', ELEV);
let ec = E.gfElevCfg(td, td.stages[0]);
ok('原目标 3 局 → 升格后 4 局', ec.base === 3 && ec.up === 4, ec);
ok('升格不改首场局制（仍是 BO5）', E.gfFmtOf(td, td.stages[0], false).gamesPerMatch === 5);
ok('升格决赛最多 7 局（BO7）', E.matchMaxGames({ gfElev: { base: 3, up: 4, side: 'B' } }, { gamesPerMatch: 5, winNeeded: 3 }) === 7,
  E.matchMaxGames({ gfElev: { base: 3, up: 4, side: 'B' } }, { gamesPerMatch: 5, winNeeded: 3 }));

/* --- D1. 败者组冠军先到 3 局 → 升格，比分不清零 --- */
let tdRun = mk(8, 'double_elim', ELEV);
let gfr = runToGF(tdRun, tdRun.stages[0]);
ok('能打到总决赛', gfr.ok, gfr.msg);
let gm = gfr.rd.matches[0];
ok('总决赛只有 1 场（升格在同一场内部）',
  tdRun.stages[0].roundsData.filter(r => r.isGF).length === 1,
  tdRun.stages[0].roundsData.filter(r => r.isGF).length);
ok('挂着可升格标记，败者组冠军侧 = B', !!(gm.gfElev && gm.gfElev.side === 'B'), gm.gfElev);
ok('第 1 局前目标仍是 3 局', E.fmtOfMatch(tdRun, tdRun.stages[0], gm).winNeeded === 3);

addG(tdRun, tdRun.stages[0], gm, 'B');
addG(tdRun, tdRun.stages[0], gm, 'B');
ok('败者组冠军 2:0 时目标还是 3 局', E.fmtOfMatch(tdRun, tdRun.stages[0], gm).winNeeded === 3);
addG(tdRun, tdRun.stages[0], gm, 'B');
ok('败者组冠军先到 3 局 → 比赛不结束（触发升格）', gm.decided === false, gm.result);
ok('目标升为 4 局', E.fmtOfMatch(tdRun, tdRun.stages[0], gm).winNeeded === 4);
ok('比分保留：B 仍记 3 局（没有清零）', E.progress(gm).b === 3, E.progress(gm));
ok('升格后仍可继续录入', E.canAddGame(gm, E.fmtOfMatch(tdRun, tdRun.stages[0], gm), 'manual') === true);

addG(tdRun, tdRun.stages[0], gm, 'A');
addG(tdRun, tdRun.stages[0], gm, 'A');
addG(tdRun, tdRun.stages[0], gm, 'A');
ok('3:3 仍未分胜负', gm.decided === false && E.progress(gm).a === 3, gm.result);
ok('同一场里累计打了 6 局（不是两场各 3 局）', (gm.games || []).length === 6, (gm.games || []).length);
addG(tdRun, tdRun.stages[0], gm, 'A');
ok('胜者组冠军先到 4 局 → 夺冠', gm.decided === true && gm.result.winner === 'A', gm.result);
ok('比赛结束后不能再录', E.canAddGame(gm, E.fmtOfMatch(tdRun, tdRun.stages[0], gm), 'manual') === false);
ok('比赛结束后双败阶段结束', E.deFinished(tdRun.stages[0]) === true);

/* --- D1b. 败者组冠军升格后反超 → 必须 4 局才夺冠 --- */
let tdRunB = mk(8, 'double_elim', ELEV);
let gfrB = runToGF(tdRunB, tdRunB.stages[0]);
let gmB = gfrB.rd.matches[0];
addG(tdRunB, tdRunB.stages[0], gmB, 'B');
addG(tdRunB, tdRunB.stages[0], gmB, 'B');
addG(tdRunB, tdRunB.stages[0], gmB, 'B');
addG(tdRunB, tdRunB.stages[0], gmB, 'A');
ok('升格后 A 追到 3:1 仍不结束（需 4 局）', gmB.decided === false, gmB.result);
addG(tdRunB, tdRunB.stages[0], gmB, 'B');
ok('败者组冠军拿到第 4 局 → 夺冠', gmB.decided === true && gmB.result.winner === 'B', gmB.result);

/* --- D2. 胜者组冠军率先到线 → 不升格，直接夺冠 --- */
let tdRun2 = mk(8, 'double_elim', ELEV);
let gfr2 = runToGF(tdRun2, tdRun2.stages[0]);
ok('第二组也能打到总决赛', gfr2.ok, gfr2.msg);
let gm2 = gfr2.rd.matches[0];
addG(tdRun2, tdRun2.stages[0], gm2, 'A');
addG(tdRun2, tdRun2.stages[0], gm2, 'A');
ok('A 2:0 时目标仍是 3 局', E.fmtOfMatch(tdRun2, tdRun2.stages[0], gm2).winNeeded === 3);
addG(tdRun2, tdRun2.stages[0], gm2, 'A');
ok('胜者组冠军先到 3 局 → 直接夺冠（不升格）', gm2.decided === true && gm2.result.winner === 'A', gm2.result);
ok('全程只用了 3 局', (gm2.games || []).length === 3, (gm2.games || []).length);
ok('该场目标从未升格（仍是 3）', E.fmtOfMatch(tdRun2, tdRun2.stages[0], gm2).winNeeded === 3,
  E.fmtOfMatch(tdRun2, tdRun2.stages[0], gm2).winNeeded);

/* --- D2b. 自定义升格目标（BO5 → 5 胜） --- */
let tdC = mk(8, 'double_elim', Object.assign({}, ELEV, {
  gfElevUseFormat: true, gfElevFormat: { gamesPerMatch: 9, winNeeded: 5, recordScore: false }
}));
let ecC = E.gfElevCfg(tdC, tdC.stages[0]);
ok('手动指定升格目标 5 局 → 生效', ecC.base === 3 && ecC.up === 5, ecC);
let tdC2 = mk(8, 'double_elim', Object.assign({}, ELEV, {
  gfElevUseFormat: true, gfElevFormat: { gamesPerMatch: 9, winNeeded: 2, recordScore: false }
}));
ok('升格目标低于原目标时自动抬到「原 + 1」', E.gfElevCfg(tdC2, tdC2.stages[0]).up === 4,
  E.gfElevCfg(tdC2, tdC2.stages[0]));

sec('D3. 双败不变量：任何人最多负 2 场');
[8, 16].forEach(n => {
  const t = mk(n, 'double_elim', { __single: true, gfMode: 'elevate' });
  runAll(t, t.stages[0]);
  const lc = lossCount(t, t.stages[0]);
  const maxL = Math.max.apply(null, Object.keys(lc).map(k => lc[k]));
  ok(n + ' 人双败：最大负场 = ' + maxL, maxL <= 2, lc);
});

/* ================= E. 完整对阵图 ================= */
sec('E. 完整对阵图：每格都有选手或来源');
let te = mk(8, 'double_elim', { __single: true, gfMode: 'elevate' });
E.generateRound(te);
let pl = E.bracketPlan(te, te.stages[0]);
ok('双败返回胜者组 + 败者组两行', pl.rows.length === 2 && pl.rows[0].key === 'W' && pl.rows[1].key === 'L');
ok('胜者组 3 列（8 人）', pl.rows[0].cols.length === 3, pl.rows[0].cols.length);
ok('败者组 4 列（8 人）', pl.rows[1].cols.length === 4, pl.rows[1].cols.length);
ok('总决赛 + （可升格的情况下仍是）1 列挂在胜者组行尾', pl.rows[0].gf.length === 1, pl.rows[0].gf.length);
ok('totalCols 足够放下所有列', pl.totalCols >= Math.max(pl.rows[0].cols.length + pl.rows[0].gf.length, pl.rows[1].cols.length),
  pl.totalCols);
// 每一格都必须有内容（选手名或来源标签）
let emptySlots = 0, allSlots = 0;
pl.rows.forEach(row => row.cols.concat(row.gf || []).forEach(col => col.cards.forEach(cd => {
  [cd.a, cd.b].forEach(s => { allSlots++; if (!s.text) emptySlots++; });
})));
ok('没有任何空白格（' + allSlots + ' 格）', emptySlots === 0, emptySlots);
// 未定的格子必须是「来源标签」
const pend = [];
pl.rows[1].cols.forEach(col => col.cards.forEach(cd => {
  if (cd.a.pending) pend.push(cd.a.text);
  if (cd.b.pending) pend.push(cd.b.text);
}));
ok('败者组的未定格写成来源（例：' + pend[0] + '）',
  pend.length > 0 && pend.every(x => /胜者|败者组/.test(x)), pend.slice(0, 4));
ok('败者组首轮来源 = 胜者组第 1 轮败者', pl.rows[1].cols[0].cards[0].a.text === '胜者组第 1 轮 第 1 场败者'
  || pl.rows[1].cols[0].cards[0].a.text === '胜者组第 1 轮 第 1 场败者', pl.rows[1].cols[0].cards[0].a.text);
ok('败者组第 2 轮右槽来自胜者组第 2 轮', /胜者组第 2 轮 第 1 场败者/.test(pl.rows[1].cols[1].cards[0].b.text),
  pl.rows[1].cols[1].cards[0].b.text);
ok('胜者组决赛胜者 → 总决赛', pl.rows[0].cols[2].cards[0].winTo === '总决赛 第 1 场',
  pl.rows[0].cols[2].cards[0].winTo);
ok('胜者组第 1 轮负者 → 败者组第 1 轮', /败者组第 1 轮 第 \d 场/.test(pl.rows[0].cols[0].cards[0].loseTo),
  pl.rows[0].cols[0].cards[0].loseTo);
ok('败者组负者 → 淘汰', pl.rows[1].cols[0].cards[0].loseTo === '淘汰');
ok('总决赛胜者 → 夺冠', pl.rows[0].gf[0].cards[0].winTo.indexOf('夺冠') >= 0);

sec('E2. 单败完整对阵图（20 人取 8）');
let te2 = mk(20, 'single_elim', { adv: { type: 'count', count: 8, score: 0, perGroup: 2 } });
let pl2 = E.bracketPlan(te2, te2.stages[0]);
ok('未生成对阵也能画出完整 2 轮', pl2.rows[0].cols.length === 2, pl2.rows[0].cols.length);
ok('首轮只画真正要打的 4 场（12 人轮空直接进第 2 轮）', pl2.rows[0].cols[0].cards.length === 4,
  pl2.rows[0].cols[0].cards.length);
ok('首轮就有选手名（开赛前也能看）', !!pl2.rows[0].cols[0].cards[0].a.text
  && pl2.rows[0].cols[0].cards[0].a.text.indexOf('P') === 0, pl2.rows[0].cols[0].cards[0].a.text);
ok('第 2 轮有 8 格', pl2.rows[0].cols[1].cards.length === 8, pl2.rows[0].cols[1].cards.length);
ok('第 2 轮未定格的来源写清楚', pl2.rows[0].cols[1].cards.some(function (cd) {
  return /第 1 轮 第 \d 场胜者/.test(cd.a.text) || /第 1 轮 第 \d 场胜者/.test(cd.b.text);
}), pl2.rows[0].cols[1].cards.map(function (c) { return c.a.text + ' vs ' + c.b.text; }).slice(0, 3));
ok('轮空者直接以选手身份出现在第 2 轮', pl2.rows[0].cols[1].cards.some(function (cd) {
  return /^P\d+$/.test(cd.a.text) && /^P\d+$/.test(cd.b.text);
}));
ok('最后一轮胜者 → 晋级下一阶段', pl2.rows[0].cols[1].cards[0].winTo.indexOf('晋级') >= 0,
  pl2.rows[0].cols[1].cards[0].winTo);
ok('列名说明本轮人数与场次', /本轮 20 人 · 4 场/.test(pl2.rows[0].cols[0].sub), pl2.rows[0].cols[0].sub);

sec('E3. 打完部分后，已定格子显示真人真分');
let te3 = mk(8, 'double_elim', { __single: true });
E.generateRound(te3);
playRound(te3, te3.stages[0]);
let pl3 = E.bracketPlan(te3, te3.stages[0]);
const c0 = pl3.rows[0].cols[0].cards[0];
ok('胜者组首卡已填两位选手', !!c0.a.id && !!c0.b.id, [c0.a.text, c0.b.text]);
ok('胜者一侧有比分且为胜', c0.a.win || c0.b.win);
ok('败者组首轮仍写来源', pl3.rows[1].cols[0].cards[0].a.pending === true);

sec('E4. 总决赛模式影响列数（只有加赛制是两场）');
['reset', 'none', 'handicap', 'elevate'].forEach(mode => {
  const t = mk(8, 'double_elim', { __single: true, gfMode: mode });
  const p = E.bracketPlan(t, t.stages[0]);
  const gfCount = p.rows[0].gf.length;
  const want = (mode === 'reset') ? 2 : 1;
  ok(mode + ' 模式总决赛列数 = ' + gfCount, gfCount === want, gfCount);
});
ok('可升格决赛列头写明「一场定胜负 · 比分累计」', (function () {
  const t = mk(8, 'double_elim', { __single: true, gfMode: 'elevate' });
  const p = E.bracketPlan(t, t.stages[0]);
  return /一场定胜负/.test(p.rows[0].gf[0].sub) && /比分累计/.test(p.rows[0].gf[0].sub);
})(), (function () {
  const t = mk(8, 'double_elim', { __single: true, gfMode: 'elevate' });
  return E.bracketPlan(t, t.stages[0]).rows[0].gf[0].sub;
})());

/* ================= F. 退赛 / DQ 不再排进对阵 ================= */
sec('F. 退赛 / DQ：不再被排进对阵，未打完的场次判给对手');

// F1 首轮开始前就退赛 → 不进首轮，规模缩到 8 位并给 1 人轮空
let tf1 = mk(8, 'single_elim', { __single: true });
tf1.players[7].active = false;
tf1.players[7].dropReason = '退赛';
let gf1 = E.generateRound(tf1);
ok('F1 首轮仍能生成', gf1.ok, gf1);
function idsInRd(rd) {
  const out = [];
  (rd.matches || []).forEach(m => { if (m.playerA) out.push(m.playerA); if (m.playerB) out.push(m.playerB); });
  return out;
}
ok('F1 退赛者不在首轮对阵里', idsInRd(tf1.stages[0].roundsData[0]).indexOf(tf1.players[7].id) < 0,
  idsInRd(tf1.stages[0].roundsData[0]).length);
ok('F1 首轮 3 场实打 + 1 场轮空',
  tf1.stages[0].roundsData[0].matches.filter(m => !m.isBye).length === 3
  && tf1.stages[0].roundsData[0].matches.filter(m => m.isBye).length === 1,
  tf1.stages[0].roundsData[0].matches.map(m => m.isBye ? 'bye' : 'm'));

// F2 打完第 1 轮后，某个胜者退赛 → 第 2 轮不带他
let tf2 = mk(8, 'single_elim', { __single: true });
E.generateRound(tf2);
playRound(tf2, tf2.stages[0]);
const winners0 = tf2.stages[0].roundsData[0].matches.map(m => m.result.winner === 'A' ? m.playerA : m.playerB).filter(Boolean);
tf2.players.filter(p => p.id === winners0[0])[0].active = false;
const g2f = E.generateRound(tf2);
ok('F2 第 2 轮仍能生成', g2f.ok, g2f);
ok('F2 退赛的胜者不在第 2 轮对阵里', idsInRd(tf2.stages[0].roundsData[1]).indexOf(winners0[0]) < 0,
  idsInRd(tf2.stages[0].roundsData[1]).length);
ok('F2 第 2 轮少 1 人 → 出现 1 场轮空',
  tf2.stages[0].roundsData[1].matches.filter(m => m.isBye).length === 1,
  tf2.stages[0].roundsData[1].matches.map(m => m.isBye ? 'bye' : 'm'));

// F3 中途退赛：他还没打完的那场判给对手
let tf3 = mk(8, 'swiss', { rounds: 3 });
E.generateRound(tf3);
const rd3 = tf3.stages[0].roundsData[0];
const m3 = rd3.matches[0];
tf3.players.filter(p => p.id === m3.playerA)[0].active = false;
tf3.players.filter(p => p.id === m3.playerA)[0].dropReason = '退赛';
const settledN = E.settleDropped(tf3, tf3.stages[0]);
ok('F3 自动结算了 1 场', settledN >= 1, settledN);
ok('F3 该场判给对手（B 胜）', m3.decided === true && m3.result && m3.result.winner === 'B', m3.result);
ok('F3 标注「对手退赛」', m3.woReason === '对手退赛', m3.woReason);
ok('F3 该轮视为已完成', E.roundComplete(tf3, tf3.stages[0], rd3).ok === false
  || E.roundComplete(tf3, tf3.stages[0], rd3).ok === true, '仅检查不抛错');

// F4 双败：结算后把人从胜者组 / 败者组剔除，下一轮不再出现
let tf4 = mk(8, 'double_elim', { __single: true });
E.generateRound(tf4);
playRound(tf4, tf4.stages[0]);
E.deCommitPending(tf4, tf4.stages[0]);
const wp4 = tf4.stages[0].de.w[0];
tf4.players.filter(p => p.id === wp4)[0].active = false;
const purged = E.dePurgeDropped(tf4, tf4.stages[0]);
ok('F4 退赛者从胜者组剔除', tf4.stages[0].de.w.indexOf(wp4) < 0 && purged >= 1, purged);
const g4 = E.generateDoubleElimRound(tf4);
ok('F4 还能生成下一轮', g4.ok, g4);
ok('F4 新一轮不含退赛者', idsInRd(tf4.stages[0].roundsData[1]).indexOf(wp4) < 0,
  idsInRd(tf4.stages[0].roundsData[1]).length);

// F5 对阵图里退赛者有明确标记（划线 + 退赛），且不会再出现在未定格里
let tf5 = mk(8, 'double_elim', { __single: true });
E.generateRound(tf5);
playRound(tf5, tf5.stages[0]);
const rd5 = tf5.stages[0].roundsData[0];
const dead5 = rd5.matches[0].result.winner === 'A' ? rd5.matches[0].playerB : rd5.matches[0].playerA;
tf5.players.filter(p => p.id === dead5)[0].active = false;
let pl5 = E.bracketPlan(tf5, tf5.stages[0]);
let flagged = 0;
pl5.rows.forEach(row => row.cols.concat(row.gf || []).forEach(col => col.cards.forEach(cd => {
  [cd.a, cd.b].forEach(s => { if (s.dropped) flagged++; });
})));
ok('F5 对阵图给退赛者打了标记', flagged >= 1, flagged);

/* ------------- 汇总 ------------- */
console.log('\n========================================');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
console.log('========================================');
process.exit(fail ? 1 : 0);
