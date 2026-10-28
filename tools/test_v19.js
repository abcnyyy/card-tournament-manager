/**
 * v1.9.0 引擎测试
 *  A. 瑞士轮三种配对方式（自动 / 随机 / 手动编排）
 *  B. 淘汰赛首轮编排：按种子 / 分档抽签 / 完全随机 + 重新抽签
 *  C. 继承积分 + 可选继承小分（累计小分 / 赢输局 / 对手分）
 *  D. 导出通道（浏览器 / 桌面桥 / 安卓桥）
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const base = path.join(ROOT, 'app', 'js');
const sandbox = { window: {}, console, Math, Date, JSON, parseFloat, parseInt, isNaN, Object, Array, String, Number };
sandbox.global = sandbox;
vm.createContext(sandbox);
['core.js', 'formats.js', 'engine.js', 'exporter.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(base, f), 'utf8'), sandbox, { filename: f });
});
const { model: M, engine: E, util: U, store: S } = sandbox.window.TMS;
const C = sandbox.window.TMS.const;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra === undefined ? '' : '  →  ' + JSON.stringify(extra))); }
}
function sec(t) { console.log('\n[' + t + ']'); }

function mk(n, stageType, opts) {
  const t = M.createTournament('T');
  for (let i = 1; i <= n; i++) t.players.push(M.createPlayer('P' + i, i));
  const a = M.defaultStage(0);
  a.type = stageType;
  Object.assign(a, opts || {});
  t.stages = [a];
  t.status = 'running';
  E.ensureParticipants(t);
  return t;
}
function numOf(t, id) {
  const p = t.players.filter(x => x.id === id)[0];
  return p ? +String(p.name).replace('P', '') : 0;
}
/* 让号码小的赢；a/b 比分写进去（小分 / 累计小分要用） */
function playRound(t, st, opt) {
  opt = opt || {};
  const rd = st.roundsData[st.roundsData.length - 1];
  (rd.matches || []).forEach(m => {
    if (m.isBye) { m.games = []; E.evaluate(m, E.fmtOfMatch(t, st, m), st.tie); return; }
    let w = numOf(t, m.playerA) < numOf(t, m.playerB) ? 'A' : 'B';
    if (opt.flip && opt.flip(m)) w = (w === 'A' ? 'B' : 'A');
    const f = E.fmtOfMatch(t, st, m);
    const need = (parseInt(f.winNeeded, 10) > 0) ? parseInt(f.winNeeded, 10) : f.gamesPerMatch;
    m.games = [];
    for (let k = 0; k < need; k++) {
      m.games.push(w === 'A' ? { w: 'A', a: 2, b: 1 } : { w: 'B', a: 1, b: 2 });
    }
    E.evaluate(m, f, st.tie);
  });
  return rd;
}
function runAll(t, st, opt) {
  let guard = 0;
  while (guard++ < 40) {
    const r = E.generateRound(t);
    if (!r.ok) break;
    playRound(t, st, opt);
    if (!E.finishRound(t).ok) break;
    if (E.stageFinished(t, st)) break;
  }
}

/* ================= A. 瑞士轮配对方式 ================= */
sec('A. 瑞士轮手动编排');

// A1. manual 模式：生成时只提示，不写数据
let tm = mk(9, 'swiss', { rounds: 3, pairMode: 'manual' });
let r1 = E.generateRound(tm);
ok('手动编排时生成轮次被拦下', r1.ok === false && r1.needManual === true, r1);
ok('不会偷偷生成对阵', tm.stages[0].roundsData.length === 0, tm.stages[0].roundsData.length);

let pool = E.manualPool(tm, tm.stages[0]);
ok('可编排名单 = 9 人', pool.length === 9, pool.length);

// A2. 缺人 → 拒绝（9 人只排 4 桌、也没指定轮空）
let r2 = E.commitManualRound(tm, 0, [[pool[0], pool[1]]], null);
ok('漏排选手时拒绝提交', r2.ok === false && /没有安排|轮空/.test(r2.msg), r2.msg);

// A3. 奇数人不给轮空 → 拒绝
let pairs4 = [];
for (let i = 0; i < 8; i += 2) pairs4.push([pool[i], pool[i + 1]]);
let r3 = E.commitManualRound(tm, 0, pairs4, null);
ok('9 人未指定轮空时拒绝', r3.ok === false && /轮空/.test(r3.msg), r3.msg);

// A4. 同一人出现两次 → 拒绝
let r4 = E.commitManualRound(tm, 0, [[pool[0], pool[1]], [pool[0], pool[2]]], pool[8]);
ok('同一人被排两次时拒绝', r4.ok === false && /两次/.test(r4.msg), r4.msg);

// A5. 正确提交：4 桌 + 1 轮空
let r5 = E.commitManualRound(tm, 0, pairs4, pool[8]);
ok('正确提交成功', r5.ok === true, r5.msg);
let rd0 = tm.stages[0].roundsData[0];
ok('写入 5 场（4 桌 + 1 轮空）', rd0.matches.length === 5, rd0.matches.length);
ok('标记为本轮手动编排', rd0.manual === true);
ok('轮空场记在轮空者名下',
  rd0.matches.filter(m => m.isBye).length === 1 && rd0.matches.filter(m => m.isBye)[0].playerA === pool[8]);
ok('轮空者本阶段记分已生效（+1 胜）',
  (function () { const s = E.buildStats(tm, tm.stages[0], pool, null)[pool[8]]; return s && s.wins === 1; })());

// A6. 本轮已有成绩时，覆盖编排被拒绝
playRound(tm, tm.stages[0]);
let r6 = E.commitManualRound(tm, 0, pairs4, pool[8], { replace: true });
ok('已录成绩后不允许改编排', r6.ok === false, r6.msg);

// A7. 淘汰赛不允许手动编排
let te = mk(8, 'single_elim', { __single: true });
let r7 = E.commitManualRound(te, 0, [[te.stages[0].participants[0], te.stages[0].participants[1]]], null);
ok('淘汰赛走首轮编排，不能用逐轮点选编排', r7.ok === false && /首轮|摆放|抽签/.test(r7.msg), r7.msg);

sec('A2. 瑞士轮随机配对');
let tr = mk(10, 'swiss', { rounds: 3, pairMode: 'random' });
let rr = E.generateRound(tr);
ok('随机配对生成成功', rr.ok === true, rr.msg);
let rdR = tr.stages[0].roundsData[0];
let seen = {};
let dup = false;
rdR.matches.forEach(m => {
  [m.playerA, m.playerB].forEach(id => {
    if (!id) return;
    if (seen[id]) dup = true;
    seen[id] = 1;
  });
});
ok('10 人全部上场且无重复', Object.keys(seen).length === 10 && !dup, Object.keys(seen).length);
ok('5 桌（10 人无轮空）', rdR.matches.length === 5, rdR.matches.length);

// 不重复交手：跑满 3 轮后检查
let tr2 = mk(10, 'swiss', { rounds: 3, pairMode: 'random' });
runAll(tr2, tr2.stages[0]);
let pairSeen = {}, repeat = 0;
tr2.stages[0].roundsData.forEach(rd => rd.matches.forEach(m => {
  if (!m.playerA || !m.playerB) return;
  const k = [m.playerA, m.playerB].sort().join('|');
  if (pairSeen[k]) repeat++;
  pairSeen[k] = 1;
}));
ok('随机配对 3 轮内不重复交手', repeat === 0, repeat);
ok('随机配对 3 轮打满', tr2.stages[0].roundsData.length === 3, tr2.stages[0].roundsData.length);

/* ================= B. 淘汰赛抽签 ================= */
sec('B. 淘汰赛首轮编排方式');

const DRAW_MODE_NAMES = C.DRAW_MODES.map(x => x.key).join(',');
ok('存在四种编排方式（种子 / 分档 / 随机 / 手动摆位）', DRAW_MODE_NAMES === 'seed,tier,random,manual', DRAW_MODE_NAMES);

function firstRoundPairs(mode, n, opts) {
  const t = mk(n, 'single_elim', Object.assign({ drawMode: mode, drawSeed: 20260101 }, opts || {}));
  t.stages[0].adv = { type: 'count', count: 1 };
  E.generateRound(t);
  const rd = t.stages[0].roundsData[0];
  return {
    t,
    pairs: rd.matches.filter(m => !m.isBye).map(m => [numOf(t, m.playerA), numOf(t, m.playerB)].sort((a, b) => a - b)),
    byes: rd.matches.filter(m => m.isBye).length,
    size: t.stages[0].bracketSize
  };
}

const seedR = firstRoundPairs('seed', 8);
ok('按种子：1-8 / 4-5 / 2-7 / 3-6',
  JSON.stringify(seedR.pairs) === JSON.stringify([[1, 8], [4, 5], [2, 7], [3, 6]]),
  seedR.pairs);

const randR = firstRoundPairs('random', 8);
ok('随机抽签仍是 4 桌 8 人',
  randR.pairs.length === 4 && randR.pairs.flat().sort((a, b) => a - b).join(',') === '1,2,3,4,5,6,7,8',
  randR.pairs);
ok('随机抽签结果与种子序不同', JSON.stringify(randR.pairs) !== JSON.stringify(seedR.pairs), randR.pairs);

const randR2 = firstRoundPairs('random', 8);
ok('同一个随机种子结果可复现', JSON.stringify(randR.pairs) === JSON.stringify(randR2.pairs), randR2.pairs);

// 分档抽签：2 档 8 人 → 每场都是 1 档（1-4）vs 2 档（5-8）
const tierR = firstRoundPairs('tier', 8, { drawTiers: 2 });
let tierOk = tierR.pairs.every(p => (p[0] <= 4) !== (p[1] <= 4));
ok('分 2 档：每桌都是强档 vs 弱档', tierOk, tierR.pairs);

// 4 档：每桌两人不同档
const tier4 = firstRoundPairs('tier', 8, { drawTiers: 4 });
const tierOf = x => x <= 2 ? 0 : (x <= 4 ? 1 : (x <= 6 ? 2 : 3));
ok('分 4 档：同档选手首轮不相遇', tier4.pairs.every(p => tierOf(p[0]) !== tierOf(p[1])), tier4.pairs);

// 轮空数不受编排方式影响
const r20s = firstRoundPairs('seed', 20);
const r20r = firstRoundPairs('random', 20);
ok('20 人：无论怎么抽，对阵表都是 32 位', r20s.size === 32 && r20r.size === 32, [r20s.size, r20r.size]);

sec('B2. 重新抽签');

// 首轮未录成绩 → 可以重抽，且对局变化
let trd = mk(8, 'single_elim', { drawMode: 'random', drawSeed: 1 });
trd.stages[0].adv = { type: 'count', count: 1 };
E.generateRound(trd);
const beforePairs = trd.stages[0].roundsData[0].matches
  .map(m => [numOf(trd, m.playerA), numOf(trd, m.playerB)].sort((a, b) => a - b).join('-')).join('|');
let rdw = E.redrawStage(trd);
const afterPairs = trd.stages[0].roundsData[0].matches
  .map(m => [numOf(trd, m.playerA), numOf(trd, m.playerB)].sort((a, b) => a - b).join('-')).join('|');
ok('重新抽签成功', rdw.ok === true, rdw.msg);
ok('重新抽签后对局发生变化', beforePairs !== afterPairs, [beforePairs, afterPairs]);
ok('重新抽签仍在同一轮（不新增轮次）', trd.stages[0].roundsData.length === 1, trd.stages[0].roundsData.length);

// 已录成绩 → 拒绝
playRound(trd, trd.stages[0]);
let rdw2 = E.redrawStage(trd);
ok('首轮已录成绩后不能再抽签', rdw2.ok === false && /不能重新抽签/.test(rdw2.msg), rdw2.msg);

// 种子模式 → 拒绝
let tseed = mk(8, 'single_elim', { drawMode: 'seed' });
tseed.stages[0].adv = { type: 'count', count: 1 };
E.generateRound(tseed);
let rdw3 = E.redrawStage(tseed);
ok('种子模式下不提供重新抽签', rdw3.ok === false && /种子号/.test(rdw3.msg), rdw3.msg);

// 双败随机抽签
let tde = mk(8, 'double_elim', { drawMode: 'random', drawSeed: 7 });
E.generateRound(tde);
const deRd = tde.stages[0].roundsData[0];
const deIds = deRd.matches.map(m => numOf(tde, m.playerA)).concat(deRd.matches.map(m => numOf(tde, m.playerB)));
ok('双败随机抽签：8 人各就各位', deIds.filter(Boolean).sort((a, b) => a - b).join(',') === '1,2,3,4,5,6,7,8', deIds);
ok('双败抽签后胜者组状态正常', !!tde.stages[0].de && tde.stages[0].de.w.length === 8, tde.stages[0].de && tde.stages[0].de.w.length);

ok('drawLabel 文案：种子', E.drawLabel({ drawMode: 'seed' }) === '按种子号编排');
ok('drawLabel 文案：随机', E.drawLabel({ drawMode: 'random' }) === '完全随机抽签');
ok('drawLabel 文案：分档带档数', /2 档/.test(E.drawLabel({ drawMode: 'tier', drawTiers: 2 })), E.drawLabel({ drawMode: 'tier', drawTiers: 2 }));

/* ================= C. 继承积分 / 继承小分 ================= */
sec('C. 继承积分 + 可选继承小分');

function twoStage(tieOn, ratio) {
  const t = M.createTournament('T');
  for (let i = 1; i <= 8; i++) t.players.push(M.createPlayer('P' + i, i));
  const s0 = M.defaultStage(0); s0.type = 'swiss'; s0.rounds = 3; s0.adv = { type: 'count', count: 8 };
  const s1 = M.defaultStage(1); s1.type = 'swiss'; s1.rounds = 2;
  s1.inherit = { enabled: true, ratio: ratio, fromStage: null, tie: tieOn };
  t.stages = [s0, s1];
  t.status = 'running';
  t.currentStage = 0;
  E.ensureParticipants(t);
  runAll(t, t.stages[0]);
  E.finishStage(t);
  return t;
}

const tOff = twoStage(false, 50);
const tOn = twoStage(true, 50);
const tFull = twoStage(true, 100);

function firstId(t) {
  return t.stages[1].participants.slice().sort((a, b) => numOf(t, a) - numOf(t, b))[0];
}
function s2(t, id) {
  t.currentStage = 1;
  E.ensureParticipants(t);
  const st = E.buildStats(t, t.stages[1], t.stages[1].participants.slice(), null);
  return st[id];
}
function finalOf(t, id) {
  const f = E.stageFinalStats(t, 0);
  return f[id];
}

const idOff = firstId(tOff), idOn = firstId(tOn), idFull = firstId(tFull);
const fOff = finalOf(tOff, idOff), fOn = finalOf(tOn, idOn), fFull = finalOf(tFull, idFull);

ok('上阶段统计含积分与小分', fOff.points > 0 && fOff.gamesWon > 0 && fOff.cumulative > 0, fOff);

const off = s2(tOff, idOff), on = s2(tOn, idOn), full = s2(tFull, idFull);

ok('不继承小分：累计小分从 0 开始', off.cumulative === 0, off.cumulative);
ok('不继承小分：赢局从 0 开始', off.gamesWon === 0 && off.gamesLost === 0, [off.gamesWon, off.gamesLost]);
ok('不继承小分：对手分从 0 开始（本阶段未打）', off.buchholz === 0, off.buchholz);
ok('积分照旧按 50% 带入', Math.abs(off.carry - fOff.points * 0.5) < 1e-9, [off.carry, fOff.points]);

ok('继承小分 50%：累计小分 = 上阶段 × 50%', Math.abs(on.cumulative - fOn.cumulative * 0.5) < 1e-9, [on.cumulative, fOn.cumulative]);
ok('继承小分 50%：赢局 = 上阶段 × 50%', Math.abs(on.gamesWon - fOn.gamesWon * 0.5) < 1e-9, [on.gamesWon, fOn.gamesWon]);
ok('继承小分 50%：输局 = 上阶段 × 50%', Math.abs(on.gamesLost - fOn.gamesLost * 0.5) < 1e-9, [on.gamesLost, fOn.gamesLost]);
ok('继承小分 50%：对手分 = 上阶段 × 50%', Math.abs(on.buchholz - fOn.buchholz * 0.5) < 1e-9, [on.buchholz, fOn.buchholz]);
ok('净胜局随继承一起带过来', on.gamesDiff === on.gamesWon - on.gamesLost, on.gamesDiff);
ok('积分仍等于 50%（小分不影响积分）',
  Math.abs(on.points - fOn.points * 0.5) < 1e-9, [on.points, fOn.points]);

ok('继承 100%：累计小分与上阶段一致', full.cumulative === fFull.cumulative, [full.cumulative, fFull.cumulative]);
ok('继承 100%：赢局与上阶段一致', full.gamesWon === fFull.gamesWon, [full.gamesWon, fFull.gamesWon]);

// 本阶段继续累加：打一轮后 = 继承值 + 本轮
let tAdd = twoStage(true, 50);
tAdd.currentStage = 1;
E.ensureParticipants(tAdd);
const idA = firstId(tAdd);
const baseCum = s2(tAdd, idA).cumulative;
E.generateRound(tAdd);
playRound(tAdd, tAdd.stages[1]);
const afterCum = s2(tAdd, idA).cumulative;
ok('本阶段的小分在继承值上继续累加', afterCum > baseCum, [baseCum, afterCum]);

// 默认值 / 迁移
ok('默认 inherit.tie = false', M.defaultStage(1).inherit.tie === false, M.defaultStage(1).inherit.tie);
let tMig = M.createTournament('M');
tMig.stages = [M.defaultStage(0), M.defaultStage(1)];
tMig.stages[1].inherit = { enabled: true, ratio: 80 };
S.normalize(tMig);
ok('旧存档迁移后补上 tie 字段', tMig.stages[1].inherit.tie === false, tMig.stages[1].inherit.tie);
ok('迁移保留原有比例', tMig.stages[1].inherit.ratio === 80, tMig.stages[1].inherit.ratio);

/* ================= D. 导出通道 ================= */
sec('D. 导出通道');

const saved = [];
sandbox.document = {
  body: { appendChild() {}, removeChild() {} },
  createElement: function () {
    return { set href(v) { this._h = v; }, get href() { return this._h; }, click: function () { saved.push(this.download); } };
  },
  getElementById: function () { return null; }
};
sandbox.Blob = function (parts, o) { this.parts = parts; this.type = o && o.type; };
sandbox.URL = { createObjectURL: function () { return 'blob:x'; }, revokeObjectURL: function () {} };
sandbox.setTimeout = function (fn) { return 0; };

ok('无原生桥时识别为浏览器', U.nativeKind() === '', U.nativeKind());
let done1 = null;
U.saveFile('测试.csv', 'a,b', 'text/csv', function (r) { done1 = r; });
ok('浏览器里走 <a download> 下载', saved.length === 1 && saved[0] === '测试.csv', saved);
ok('下载后回调提示成功', done1 && done1.ok === true, done1);

sandbox.window.tmsNative = {
  saveFile: function (fn) {
    return Promise.resolve({ ok: true, path: 'D:/x/' + fn, msg: '已保存' });
  }
};
ok('桌面桥被识别为 electron', U.nativeKind() === 'electron', U.nativeKind());

sandbox.window.TmsNative = { saveFile: function () {} };
delete sandbox.window.tmsNative;
ok('安卓桥被识别为 android', U.nativeKind() === 'android', U.nativeKind());

let done2 = null;
U.saveFile('名单.txt', 'P1', 'text/plain', function (r) { done2 = r; });
ok('安卓桥调用后给出提示', done2 && done2.ok === true && /保存到/.test(done2.msg), done2);

ok('CSV 导出带 BOM（Excel 不乱码）', (function () {
  const X = sandbox.window.TMS.exporter;
  if (!X) return false;
  const csv = X.matchupsCSV(tOff, { stageIndex: 0 });
  return csv.charCodeAt(0) === 0xFEFF;
})());
ok('CSV 表头含轮次与选手列', (function () {
  const X = sandbox.window.TMS.exporter;
  const csv = X.matchupsCSV(tOff, { stageIndex: 0 }).replace(/^\ufeff/, '');
  const head = csv.split(/\r?\n/)[0];
  return /轮次/.test(head) && /选手/.test(head);
})());

/* ================= 汇总 ================= */
console.log('\n================');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
console.log('================');
process.exit(fail ? 1 : 0);
