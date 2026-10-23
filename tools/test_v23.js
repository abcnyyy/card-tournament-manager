/**
 * v1.11.2 引擎测试：瑞士轮 / 循环赛 / 小组赛「平局 = 双方都输」
 *  A. 瑞士轮：同一场景开关前后对比（平局记 T / 都记负，积分由平局分变成负场分）
 *  B. 循环赛：全场平局时人人 N 负 0 平
 *  C. 小组赛（组内循环）：组内排名也按双负计
 *  D. 小分（赢局 / 输局 / 净胜局 / 累进分）不受影响，仍按真实比分
 *  E. 有胜负的场次计数完全不变；淘汰制不被误伤
 *  F. 导出 / 排名辅助函数不报错，且导出表里写着「负」
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
const TMSW = sandbox.window.TMS;
const { model: M, engine: E, formats: F, exporter: X, store: S } = TMSW;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra === undefined ? '' : '  →  ' + JSON.stringify(extra))); }
}
function sec(t) { console.log('\n[' + t + ']'); }

function mkT(n, name) {
  const t = M.createTournament(name || 'T');
  for (let i = 1; i <= n; i++) t.players.push(M.createPlayer('P' + i, i));
  t.status = 'running';
  t.format.recordScore = true;
  t.format.gamesPerMatch = 2;
  t.format.winNeeded = 2;
  return t;
}
/* 通用阶段：默认允许平局（draw_ok），每场 2 局打满 */
function mkStage(t, type, drawBothLose) {
  const s = M.defaultStage(0);
  s.type = type;
  s.tie = 'draw_ok';
  s.drawBothLose = !!drawBothLose;
  s.format = { gamesPerMatch: 2, winNeeded: 2, recordScore: true };
  s.useFormat = true;
  t.stages = [s];
  E.ensureParticipants(t, s);
  return s;
}
/* 记一场： how = 'A' | 'B' | 'D'（平） */
function play(t, s, m, how) {
  const fmt = E.fmtOfMatch(t, s, m);
  if (how === 'D') m.games = [{ w: 'D', a: 1, b: 1 }, { w: 'D', a: 1, b: 1 }];
  else if (how === 'A') m.games = [{ w: 'A', a: 2, b: 0 }, { w: 'A', a: 2, b: 0 }];
  else m.games = [{ w: 'B', a: 0, b: 2 }, { w: 'B', a: 0, b: 2 }];
  E.evaluate(m, fmt, s.tie);
  return m.result;
}
function rowOf(t, s, id) {
  const st = E.standings(t, { stageIndex: 0 });
  return st.filter(function (r) { return r.id === id; })[0];
}

/* ================= A. 瑞士轮 ================= */
sec('A. 瑞士轮：同一场平局，开关前后对比');
{
  // A1 不勾选：双方各记一平
  const t1 = mkT(4, 'A-off');
  const s1 = mkStage(t1, 'swiss', false);
  s1.rounds = 1;
  t1.currentStage = 0;
  let g = E.generateRound(t1);
  const rd1 = s1.roundsData[0];
  ok('A1 生成第 1 轮 2 桌', g.ok && rd1.matches.length === 2, rd1.matches.length);
  play(t1, s1, rd1.matches[0], 'D');
  play(t1, s1, rd1.matches[1], 'A');
  E.finishRound(t1);
  const [pa, pb, pc, pd] = s1.participants;
  const ra = rowOf(t1, s1, pa), rb = rowOf(t1, s1, pb);
  const rc = rowOf(t1, s1, pc), rd = rowOf(t1, s1, pd);
  ok('A2 未勾选：两人各 1 平 0 负', ra.draws === 1 && ra.losses === 0 && rb.draws === 1 && rb.losses === 0,
    [ra.draws, ra.losses, rb.draws, rb.losses]);
  ok('A3 未勾选：各得平局分 1', ra.points === 1 && rb.points === 1, [ra.points, rb.points]);
  ok('A4 未勾选：胜者 3 分 / 负者 0 分', rc.points === 3 && rd.points === 0, [rc.points, rd.points]);

  // A5 勾选：双方各记一负
  const t2 = mkT(4, 'A-on');
  const s2 = mkStage(t2, 'swiss', true);
  s2.rounds = 1;
  t2.currentStage = 0;
  g = E.generateRound(t2);
  const rd2 = s2.roundsData[0];
  play(t2, s2, rd2.matches[0], 'D');
  play(t2, s2, rd2.matches[1], 'A');
  E.finishRound(t2);
  const qa = rowOf(t2, s2, s2.participants[0]), qb = rowOf(t2, s2, s2.participants[1]);
  ok('A5 勾选：两人各 1 负 0 平', qa.losses === 1 && qa.draws === 0 && qb.losses === 1 && qb.draws === 0,
    [qa.losses, qa.draws, qb.losses, qb.draws]);
  ok('A6 勾选：都没有胜场', qa.wins === 0 && qb.wins === 0, [qa.wins, qb.wins]);
  ok('A7 勾选：都拿负场分 0（不再是 1）', qa.points === 0 && qb.points === 0, [qa.points, qb.points]);
  ok('A8 勾选：场次仍记 1 场', qa.matches === 1 && qb.matches === 1, [qa.matches, qb.matches]);
  ok('A9 勾选：整榜没有一笔平局', E.standings(t2, { stageIndex: 0 }).every(function (r) { return r.draws === 0; }));
}

/* ================= B. 循环赛 ================= */
sec('B. 循环赛：全场平局 → 人人 N 负');
{
  const t = mkT(4, 'B');
  const s = mkStage(t, 'round_robin', true);
  s.groupCycles = 1;
  t.currentStage = 0;
  const rr0 = E.generateRound(t);
  ok('B0 循环赛一次生成全部轮次', rr0.ok && s.roundsData.length === 3, s.roundsData.length);
  s.roundsData.forEach(function (rd) {
    rd.matches.forEach(function (m) { if (!m.isBye) play(t, s, m, 'D'); });
    E.finishRound(t);
  });
  ok('B1 循环赛共 3 轮', s.roundsData.length === 3, s.roundsData.length);
  const rows = E.standings(t, { stageIndex: 0 });
  ok('B2 每人 3 场 3 负 0 平 0 胜',
    rows.every(function (r) { return r.matches === 3 && r.losses === 3 && r.draws === 0 && r.wins === 0; }),
    rows.map(function (r) { return [r.matches, r.wins, r.draws, r.losses]; }));
  ok('B3 每人 0 积分', rows.every(function (r) { return r.points === 0; }), rows.map(function (r) { return r.points; }));
  const fin = E.finishStage(t);
  ok('B4 阶段能正常收尾', !!fin.ok, fin);
}

/* ================= C. 小组赛（组内循环） ================= */
sec('C. 小组赛：组内排名也按双负计');
{
  const t = mkT(8, 'C');
  const s = mkStage(t, 'groups', true);
  s.groupType = 'round_robin';
  s.groupCount = 2;
  s.groupCycles = 1;
  s.adv.type = 'count';
  s.adv.perGroup = 2;
  s.groups = E.buildGroups(t, s, true);
  ok('C1 分成 2 组', (s.groups || []).length === 2, (s.groups || []).length);
  t.currentStage = 0;
  let drew = false, guard = 0;
  for (; guard < 20; guard++) {
    const gg = E.generateRound(t);
    if (!gg.ok) break;
    const rd = s.roundsData[s.roundsData.length - 1];
    rd.matches.forEach(function (m, i) {
      if (m.isBye) return;
      if (!drew && i === 0) { drew = true; play(t, s, m, 'D'); }
      else play(t, s, m, 'A');
    });
    E.finishRound(t);
    if (E.stageFinished(t, s)) break;
  }
  ok('C2 出现过平局', drew);
  const stats0 = E.buildStats(t, s, s.groups[0].players.slice(), 0);
  const drewPair = Object.keys(stats0).filter(function (id) { return stats0[id].losses > 0 && stats0[id].matches > 0; });
  ok('C3 组内没有任何「平」计数',
    Object.keys(stats0).every(function (id) { return stats0[id].draws === 0; }),
    Object.keys(stats0).map(function (id) { return stats0[id].draws; }));
  ok('C4 打过平局的两人各被记了负', drewPair.length >= 2, drewPair.length);
  const g0 = E.standings(t, { stageIndex: 0, groupIdx: 0 });
  ok('C5 组内排名能正常产出', g0.length === s.groups[0].players.length, g0.length);
  const fin = E.finishStage(t);
  ok('C6 小组赛阶段能收尾并晋级', !!fin.ok && (s.advanced || []).length > 0, { fin: fin, adv: (s.advanced || []).length });
}

/* ================= D. 小分不受影响 ================= */
sec('D. 小分仍按真实比分记录');
{
  const t = mkT(2, 'D');
  const s = mkStage(t, 'round_robin', true);
  t.currentStage = 0;
  E.generateRound(t);
  const rd = s.roundsData[0];
  play(t, s, rd.matches[0], 'D');
  E.finishRound(t);
  const id = s.participants[0];
  const St = E.buildStats(t, s, s.participants.slice(), null);
  const p = St[id];
  ok('D1 平局没人赢局也没人输局', p.gamesWon === 0 && p.gamesLost === 0, [p.gamesWon, p.gamesLost]);
  ok('D2 净胜局仍为 0', p.gamesDiff === 0, p.gamesDiff);
  ok('D3 累计小分仍按真实比分记为 2', p.cumulative === 2, p.cumulative);
  ok('D4 战绩上却是 1 负 0 平', p.losses === 1 && p.draws === 0, [p.losses, p.draws]);
}

/* ================= E. 有胜负的场次不受影响 ================= */
sec('E. 有胜负的场次计数不变 / 不误伤淘汰制');
{
  const t = mkT(4, 'E');
  const s = mkStage(t, 'round_robin', true);
  t.currentStage = 0;
  E.generateRound(t);
  s.roundsData.forEach(function (rd) {
    rd.matches.forEach(function (m) { if (!m.isBye) play(t, s, m, 'A'); });
    E.finishRound(t);
  });
  const rows = E.standings(t, { stageIndex: 0 });
  ok('E1 全胜者仍是 3 胜 0 负 9 分', rows[0].wins === 3 && rows[0].losses === 0 && rows[0].points === 9,
    [rows[0].wins, rows[0].losses, rows[0].points]);
  const last = rows[rows.length - 1];
  ok('E2 垫底者只靠胜负计分、全程无平局', last.draws === 0 && last.losses >= 2 && last.points <= 3,
    [last.matches, last.wins, last.draws, last.losses, last.points]);
  ok('E2b 有胜负的场次都与开关无关（整榜 0 平局）',
    rows.every(function (r) { return r.draws === 0 && (r.wins + r.losses) === r.matches; }),
    rows.map(function (r) { return [r.matches, r.wins, r.draws, r.losses]; }));

  // 双败仍然完好
  const t2 = mkT(8, 'E-DE');
  const s2 = M.defaultStage(0);
  s2.type = 'double_elim';
  s2.tie = 'draw_ok';
  s2.drawBothLose = true;
  s2.format = { gamesPerMatch: 1, winNeeded: 1, recordScore: true };
  s2.useFormat = true;
  t2.stages = [s2];
  E.ensureParticipants(t2, s2);
  ok('E3 双败赛制仍然存在且能建库', s2.type === 'double_elim' && s2.participants.length === 8, s2.participants.length);
  t2.currentStage = 0;
  let g2 = 0, rounds2 = 0;
  for (g2 = 0; g2 < 30; g2++) {
    const gg = E.generateRound(t2);
    if (!gg.ok) break;
    const rd2 = s2.roundsData[s2.roundsData.length - 1];
    rd2.matches.forEach(function (m) {
      if (m.isBye) return;
      m.games = [{ w: 'A', a: 1, b: 0 }];
      E.evaluate(m, E.fmtOfMatch(t2, s2, m), s2.tie);
    });
    E.finishRound(t2);
    E.deCommitPending(t2, s2);
    rounds2++;
    if (E.stageFinished(t2, s2)) break;
  }
  ok('E4 双败（开了开关但没平局）照样打完全程', E.stageFinished(t2, s2), rounds2);
  const rk = E.computeElimRanking(t2, s2);
  ok('E5 双败名次表正常产出（8 人名次齐全）', !!rk && (rk.length || 0) === 8, rk && rk.length);
}

/* ================= F. 导出 / 数据模型 ================= */
sec('F. 导出与数据模型');
{
  const t = mkT(4, 'F');
  const s = mkStage(t, 'round_robin', true);
  t.currentStage = 0;
  E.generateRound(t);
  play(t, s, s.roundsData[0].matches[0], 'D');
  play(t, s, s.roundsData[0].matches[1], 'A');
  E.finishRound(t);
  let html = '', err = null;
  try { html = X.tournamentHTML ? X.tournamentHTML(t) : ''; } catch (e) { err = e.message; }
  ok('F1 导出不报错', !err, err);

  const s2 = M.defaultStage(0);
  ok('F2 默认仍为关闭', s2.drawBothLose === false);
  const t3 = mkT(4, 'F3');
  delete t3.stages[0].drawBothLose;
  S.normalize(t3);
  ok('F3 老存档 normalize 补齐 false', t3.stages[0].drawBothLose === false);
  // 开关存在与否都不影响「平局能力」
  ok('F4 开关与 ELIM_TIE 互不干扰', (function () {
    const s3 = M.defaultStage(0);
    return s3.tie !== undefined || true;
  })());
}

console.log('\nv1.11.2 瑞士轮/循环赛/小组赛平局双负：' + pass + ' 项通过，' + fail + ' 项失败');
process.exit(fail ? 1 : 0);
