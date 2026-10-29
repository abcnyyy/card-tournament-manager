/**
 * v2.6 引擎测试：分数继承补全战绩
 *  A. 继承开着时，场次 / 胜 / 平 / 负 / 轮空 / 赢局 / 输局 一起带过来（原值，不随比例折算）
 *  B. 关掉「继承战绩」→ 战绩从 0 开始（积分照旧）
 *  C. 本阶段口径独立：提前晋级 / 积分榜不能被继承值顶上去
 *  D. 老存档迁移：没有 stats 字段 = 默认开启
 *  E. 破同与导出取数
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const base = path.join(__dirname, '..', 'app', 'js');
const sandbox = {
  window: {}, console, Math, Date, JSON, parseFloat, parseInt, isNaN, Object, Array, String, Number
};
sandbox.global = sandbox;
vm.createContext(sandbox);
['core.js', 'formats.js', 'engine.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(base, f), 'utf8'), sandbox, { filename: f });
});
const TMS = sandbox.window.TMS;
const { model: M, engine: E, store: S } = TMS;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra === undefined ? '' : '  ->  ' + JSON.stringify(extra))); }
}
function sec(t) { console.log('\n=== ' + t + ' ==='); }
function numOf(t, id) {
  const p = t.players.filter(x => x.id === id)[0];
  return p ? +String(p.name).replace('P', '') : 0;
}

/* 一场：号码小的赢，3 局 2 胜（这样赢局 / 输局都是多局数） */
function playRound(t, st) {
  const rd = st.roundsData[st.roundsData.length - 1];
  (rd.matches || []).forEach(function (m) {
    if (m.isBye) { m.games = []; E.evaluate(m, E.fmtOfMatch(t, st, m), st.tie); return; }
    const w = numOf(t, m.playerA) < numOf(t, m.playerB) ? 'A' : 'B';
    const f = E.fmtOfMatch(t, st, m);
    const need = (parseInt(f.winNeeded, 10) > 0) ? parseInt(f.winNeeded, 10) : f.gamesPerMatch;
    m.games = [];
    for (let k = 0; k < need; k++) m.games.push(w === 'A' ? { w: 'A', a: 2, b: 1 } : { w: 'B', a: 1, b: 2 });
    E.evaluate(m, f, st.tie);
  });
  return rd;
}
function runAll(t, st) {
  let guard = 0;
  while (guard++ < 40) {
    const r = E.generateRound(t);
    if (!r.ok) break;
    playRound(t, st);
    if (!E.finishRound(t).ok) break;
    if (E.stageFinished(t, st)) break;
  }
}

/**
 * 造两阶段：8 人瑞士轮 3 轮 → 决赛组瑞士轮 2 轮
 * opts = { ratio, tie, stats }
 */
function twoStage(opts) {
  opts = opts || {};
  const t = M.createTournament('T');
  for (let i = 1; i <= 8; i++) t.players.push(M.createPlayer('P' + i, i));
  const s0 = M.defaultStage(0);
  s0.type = 'swiss'; s0.rounds = 3; s0.adv = { type: 'count', count: 8 };
  const s1 = M.defaultStage(1);
  s1.type = 'swiss'; s1.rounds = 2;
  s1.inherit = { enabled: true, ratio: opts.ratio === undefined ? 100 : opts.ratio, fromStage: null, tie: !!opts.tie };
  if (opts.stats !== undefined) s1.inherit.stats = opts.stats;
  t.stages = [s0, s1];
  t.status = 'running';
  t.currentStage = 0;
  E.ensureParticipants(t);
  runAll(t, t.stages[0]);
  E.finishStage(t);
  return t;
}
function statsOf(t, si, id) {
  t.currentStage = si;
  E.ensureParticipants(t);
  const st = t.stages[si];
  const all = E.buildStats(t, st, st.participants.slice(), null);
  return all[id];
}
function topOf(t) {   // 第 1 阶段结束后排第 1 的人（号码最小，全胜）
  const ids = t.stages[0].participants.slice().sort((a, b) => numOf(t, a) - numOf(t, b));
  return ids[0];
}

/* ================= A. 战绩随积分一起继承 ================= */
sec('A. 继承战绩（默认）');

const tA = twoStage({ ratio: 100, tie: false });
const idA = topOf(tA);
const finA = E.stageFinalStats(tA, 0)[idA];
const sA = statsOf(tA, 1, idA);

ok('上一阶段确实有战绩可继承', finA.matches > 0 && finA.wins > 0 && finA.gamesWon > 0, finA);
ok('场次被继承', sA.matches === finA.matches, [sA.matches, finA.matches]);
ok('胜场被继承', sA.wins === finA.wins, [sA.wins, finA.wins]);
ok('负场被继承', sA.losses === finA.losses, [sA.losses, finA.losses]);
ok('平场被继承', sA.draws === finA.draws, [sA.draws, finA.draws]);
ok('轮空次数被继承', sA.byes === finA.byes, [sA.byes, finA.byes]);
ok('赢局被继承（不勾「继承小分」也要带）', sA.gamesWon === finA.gamesWon, [sA.gamesWon, finA.gamesWon]);
ok('输局被继承', sA.gamesLost === finA.gamesLost, [sA.gamesLost, finA.gamesLost]);
ok('净胜局跟着算对', sA.gamesDiff === sA.gamesWon - sA.gamesLost, sA.gamesDiff);
ok('破同用的「胜场数」含继承', E.tieVal(sA, 'wins') === finA.wins, E.tieVal(sA, 'wins'));
ok('破同用的「赢局数」含继承', E.tieVal(sA, 'gamesWon') === finA.gamesWon, E.tieVal(sA, 'gamesWon'));

/* 战绩不随比例折算 */
const tB = twoStage({ ratio: 30, tie: false });
const idB = topOf(tB);
const finB = E.stageFinalStats(tB, 0)[idB];
const sB = statsOf(tB, 1, idB);
ok('比例 30%：积分按比例折算', Math.abs(sB.carry - finB.points * 0.3) < 1e-9, [sB.carry, finB.points * 0.3]);
ok('比例 30%：场次仍是原值（不折算）', sB.matches === finB.matches, [sB.matches, finB.matches]);
ok('比例 30%：胜场仍是原值（不折算）', sB.wins === finB.wins, [sB.wins, finB.wins]);
ok('比例 30%：赢局仍是原值（不折算）', sB.gamesWon === finB.gamesWon, [sB.gamesWon, finB.gamesWon]);

/* 本阶段开打后继续累加 */
const tC = twoStage({ ratio: 100, tie: false });
const idC = topOf(tC);
const finC = E.stageFinalStats(tC, 0)[idC];
tC.currentStage = 1;
E.ensureParticipants(tC);
E.generateRound(tC);
playRound(tC, tC.stages[1]);
const sC = statsOf(tC, 1, idC);
ok('本阶段打 1 轮后场次 = 继承 + 1', sC.matches === finC.matches + 1 && sC.ownMatches === 1,
  [sC.matches, sC.ownMatches, finC.matches]);
ok('本阶段打 1 轮后胜场 = 继承 + 本阶段胜', sC.wins === finC.wins + sC.ownWins,
  [sC.wins, finC.wins, sC.ownWins]);
ok('本阶段打 1 轮后赢局 = 继承 + 本阶段赢局', sC.gamesWon === finC.gamesWon + sC.ownGamesWon,
  [sC.gamesWon, finC.gamesWon, sC.ownGamesWon]);

/* ================= B. 关掉「继承战绩」 ================= */
sec('B. 关掉继承战绩');

const tD = twoStage({ ratio: 100, tie: false, stats: false });
const idD = topOf(tD);
const sD = statsOf(tD, 1, idD);
const finD = E.stageFinalStats(tD, 0)[idD];
ok('关掉后场次从 0 开始', sD.matches === 0, sD.matches);
ok('关掉后胜场从 0 开始', sD.wins === 0 && sD.losses === 0, [sD.wins, sD.losses]);
ok('关掉后赢局从 0 开始', sD.gamesWon === 0 && sD.gamesLost === 0, [sD.gamesWon, sD.gamesLost]);
ok('关掉后积分照旧按比例带', Math.abs(sD.carry - finD.points) < 1e-9, [sD.carry, finD.points]);

/* ================= C. 本阶段口径不被继承值污染 ================= */
sec('C. 本阶段口径独立');

/* C1 own* 只算本阶段 */
const tE = twoStage({ ratio: 100, tie: false });
const idE = topOf(tE);
tE.currentStage = 1;
E.ensureParticipants(tE);
E.generateRound(tE);
const sE = statsOf(tE, 1, idE);
ok('ownWins 只算本阶段', sE.ownWins === (sE.wins - E.stageFinalStats(tE, 0)[idE].wins), [sE.ownWins, sE.wins]);
ok('ownMatches 只算本阶段', sE.ownMatches === (sE.matches - E.stageFinalStats(tE, 0)[idE].matches), [sE.ownMatches, sE.matches]);

/* C2 提前晋级：继承来的胜场不能一进场就判提前晋级 */
const tF = twoStage({ ratio: 100, tie: false });
const idF = topOf(tF);
const finF = E.stageFinalStats(tF, 0)[idF];
tF.stages[1].clinch = { enabled: true, winTarget: finF.wins, lossTarget: 99, basis: 'match', bonus: 0, bonusPerEarly: 0 };
tF.stages[1].clinched = []; tF.stages[1].eliminated = [];
tF.stages[1].clinchRound = {}; tF.stages[1].elimRound = {};
tF.currentStage = 1;
E.ensureParticipants(tF);
E.generateRound(tF);
playRound(tF, tF.stages[1]);
E.finishRound(tF);
const clF = E.ensureClinch(tF, tF.stages[1]);
ok('继承 ' + finF.wins + ' 胜后打第 1 轮：不会立刻判提前晋级',
  (clF.clinched || []).indexOf(idF) < 0, clF.clinched);

/* C3 赛事积分榜按胜场算分：不重复计继承值 */
const tG = twoStage({ ratio: 100, tie: false });
const idG = topOf(tG);
const finG = E.stageFinalStats(tG, 0)[idG];
tG.currentStage = 1;
E.ensureParticipants(tG);
E.generateRound(tG);
playRound(tG, tG.stages[1]);
const resG = E.tournamentResults(tG);
const rG = resG.filter(r => r.id === idG)[0];
ok('整站战绩 = 各阶段「本阶段」战绩之和（不重复计继承）',
  rG.wins === finG.wins + (E.stageResults(tG, 1).filter(r => r.id === idG)[0] || {}).wins,
  [rG.wins, finG.wins, (E.stageResults(tG, 1).filter(r => r.id === idG)[0] || {}).wins]);
ok('stageResults 返回本阶段战绩', E.stageResults(tG, 1).filter(r => r.id === idG)[0].wins ===
  statsOf(tG, 1, idG).ownWins, null);

/* ================= D. 老存档迁移 ================= */
sec('D. 老存档迁移');

const old = M.createTournament('老');
old.players.push(M.createPlayer('A', 1));
const o0 = M.defaultStage(0);
const o1 = M.defaultStage(1);
o1.inherit = { enabled: true, ratio: 80 };      // 老存档：没有 stats / tie 字段
old.stages = [o0, o1];
const nOld = S.normalize(JSON.parse(JSON.stringify(old)));
ok('老存档补上 stats = true（默认继承战绩）', nOld.stages[1].inherit.stats === true, nOld.stages[1].inherit.stats);
ok('老存档补上 tie = false', nOld.stages[1].inherit.tie === false, nOld.stages[1].inherit.tie);
ok('老存档保留原比例', nOld.stages[1].inherit.ratio === 80, nOld.stages[1].inherit.ratio);
const nKeep = S.normalize(Object.assign(JSON.parse(JSON.stringify(old)), {}));
nKeep.stages[1].inherit.stats = false;
ok('显式关掉 stats 时能保留 false', S.normalize(nKeep).stages[1].inherit.stats === false,
  S.normalize(nKeep).stages[1].inherit.stats);
ok('defaultStage 默认 stats = true', M.defaultStage(1).inherit.stats === true, M.defaultStage(1).inherit.stats);

/* ================= E. 导出取数 ================= */
sec('E. 排名表取数');

const tH = twoStage({ ratio: 100, tie: false });
tH.currentStage = 1;
E.ensureParticipants(tH);
const standH = E.standings(tH, { stageIndex: 1 });
const idH = topOf(tH);
const rowH = standH.filter(s => s.id === idH)[0];
const finH = E.stageFinalStats(tH, 0)[idH];
ok('排名表里的「胜」是累计值（含继承）', rowH.wins === finH.wins, [rowH.wins, finH.wins]);
ok('排名表里仍能找到本阶段值', rowH.ownWins === 0, rowH.ownWins);

console.log('\nPASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail ? 1 : 0);
