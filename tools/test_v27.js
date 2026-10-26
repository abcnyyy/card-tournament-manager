/**
 * v1.14.1 引擎测试
 *  A. 征服赛制修正：赢过的人不能再上（必须换人），负方可继续 / 可换人
 *  B. 团体赛：每盘先选队员（出场资格）、nvn 固定对位与批量对位
 *  C. 按是否晋级下一阶段给分（晋级分 / 未晋级分 / 是否叠加）
 *  D. 团体赛计分：大比分 = 盘数，个人小局只进小分
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
const TMS = sandbox.window.TMS;
const { model: M, engine: E } = TMS;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra === undefined ? '' : '  →  ' + JSON.stringify(extra))); }
}
function sec(t) { console.log('\n[' + t + ']'); }

/* ---------------- 造一支队伍 / 一场团体赛 ---------------- */
function team(id, name, memNames) {
  return {
    id: id, name: name, isTeam: true, active: true, startStage: 0, seed: 0,
    members: memNames.map(function (n, i) { return { id: id + 'm' + (i + 1), name: n, seed: i + 1 }; })
  };
}
function teamT(mode, size) {
  const t = M.createTournament('团体赛测试');
  const A = team('tA', 'A 队', ['甲一', '甲二', '甲三']);
  const B = team('tB', 'B 队', ['乙一', '乙二', '乙三']);
  t.players = [A, B];
  t.team = { on: true, mode: mode, size: size || 3, winNeeded: 0, fmt: null };
  const st = t.stages[0];
  st.participants = [A.id, B.id];
  return { t: t, A: A, B: B, st: st };
}
function board(si, w, pa, pb, a, b) {
  const g = { s: si, w: w, pa: pa, pb: pb };
  if (a !== undefined) g.a = a;
  if (b !== undefined) g.b = b;
  return g;
}

/* ================= A. 征服赛制 ================= */
sec('A. 征服赛制：赢过的人不能再上，负方可继续');
{
  const { t, A, B } = teamT('conquest', 3);
  const m = { id: 'm1', playerA: A.id, playerB: B.id, games: [] };

  const nx0 = E.teamNextBoard(t, m);
  ok('A1 第一回合默认派双方第 1 位队员', nx0.a === 'tAm1' && nx0.b === 'tBm1', nx0);

  // A 方 甲一 赢下第一回合
  m.games.push(board(0, 'A', 'tAm1', 'tBm1'));
  ok('A2 赢过的人这一场不能再上', E.teamCanField(t, m, 'A', 'tAm1') === false);
  ok('A3 输的人还能继续上', E.teamCanField(t, m, 'B', 'tBm1') === true);

  const nx1 = E.teamNextBoard(t, m);
  ok('A4 赢方必须换人（下一回合派 甲二）', nx1.a === 'tAm2', nx1);
  ok('A5 负方默认让刚才那位继续', nx1.b === 'tBm1', nx1);
  ok('A6 负方也可以手动换成别人', E.teamCanField(t, m, 'B', 'tBm2') === true);

  // 第二回合 B 方 乙一 赢
  m.games.push(board(1, 'B', 'tAm2', 'tBm1'));
  const nx2 = E.teamNextBoard(t, m);
  ok('A7 赢过的人全部退出候选（甲一 / 乙一）',
    E.teamCanField(t, m, 'A', 'tAm1') === false && E.teamCanField(t, m, 'B', 'tBm1') === false);
  ok('A8 负方（甲二）默认继续，赢方换 乙二', nx2.a === 'tAm2' && nx2.b === 'tBm2', nx2);

  // 2:1 时 A 只赢了两盘，但还没到「全员各赢一盘」→ 不能结束
  m.games.push(board(2, 'A', 'tAm2', 'tBm2'));
  const r1 = E.evaluate(m, E.fmtOfMatch(t, t.stages[0], m), null);
  ok('A9 只赢 2 盘还不算赢（还差一人没赢过）', r1.winner === null && r1.settled === false,
    [r1.winner, r1.gamesA, r1.gamesB]);

  // 甲三再赢一盘 → A 全员各赢一盘 → A 获胜
  m.games.push(board(3, 'A', 'tAm3', 'tBm2'));
  const r2 = E.evaluate(m, E.fmtOfMatch(t, t.stages[0], m), null);
  ok('A10 全员都赢过之后 A 获胜', r2.winner === 'A' && r2.settled === true && r2.gamesA === 3, r2);

  // 全队都赢过之后没人能上
  const m2 = { id: 'm2', playerA: A.id, playerB: B.id, games: [
    board(0, 'A', 'tAm1', 'tBm1'), board(1, 'A', 'tAm2', 'tBm2'), board(2, 'A', 'tAm3', 'tBm3')
  ] };
  ok('A11 三人全赢过后 A 方没有可上场的人', E.teamEligible(t, m2, 'A').length === 0,
    E.teamEligible(t, m2, 'A').length);
}

/* ================= B. 每回合选人 + nvn 对位 ================= */
sec('B. 每回合先选队员 / nvn 批量对位');
{
  const { t, A, B } = teamT('nvn', 3);
  const m = { id: 'm3', playerA: A.id, playerB: B.id, games: [] };

  const pairs = E.teamBatchPairs(t, m);
  ok('B1 nvn 批量对位 = 三位队员依次对位',
    pairs.length === 3 && pairs[0].a === 'tAm1' && pairs[0].b === 'tBm1' &&
    pairs[2].a === 'tAm3' && pairs[2].b === 'tBm3', pairs);

  const nx = E.teamNextBoard(t, m);
  ok('B2 nvn 第一回合按顺序取第 1 组', nx.a === 'tAm1' && nx.b === 'tBm1', nx);

  m.games.push(board(0, 'A', 'tAm1', 'tBm1'));
  const nx2 = E.teamNextBoard(t, m);
  ok('B3 nvn 第二回合自动排到第 2 组', nx2.a === 'tAm2' && nx2.b === 'tBm2', nx2);

  ok('B4 nvn 不限制重复上场（按顺序即可）', E.teamEligible(t, m, 'A').length === 3);

  // KOF：赢者留场、输者换人
  t.team.mode = 'kof';
  const mk = { id: 'm4', playerA: A.id, playerB: B.id, games: [board(0, 'A', 'tAm1', 'tBm1')] };
  const nk = E.teamNextBoard(t, mk);
  ok('B5 KOF 赢者留场、输者换下一位', nk.a === 'tAm1' && nk.b === 'tBm2', nk);
  ok('B6 KOF 输过的人不能再上', E.teamCanField(t, mk, 'B', 'tBm1') === false);
  ok('B7 KOF 赢过的人仍然能上', E.teamCanField(t, mk, 'A', 'tAm1') === true);
}

/* ================= C. 按是否晋级下一阶段给分（独立计分方式） ================= */
sec('C. 按是否晋级下一阶段给分');
{
  const rule = {
    mode: 'adv',
    rank: { tiers: [{ from: 1, to: 1, pts: 100 }], step: 0, floor: 0 },
    adv: { yes: 100, no: 20 }
  };
  ok('C1 晋级 = 只拿晋级分（不与名次分相加）', E.ptsOf(rule, { rank: 1, adv: true }) === 100,
    E.ptsOf(rule, { rank: 1, adv: true }));
  ok('C2 没晋级 = 拿未晋级分', E.ptsOf(rule, { rank: 1, adv: false }) === 20,
    E.ptsOf(rule, { rank: 1, adv: false }));
  ok('C3 ptsAdvOn 只认 mode=adv', E.ptsAdvOn(rule) === true && E.ptsAdvOn({ mode: 'rank' }) === false);

  // 按名次 / 按胜场时，adv 字段完全不参与
  const ruleWin = { mode: 'win', win: { perWin: 10, perDraw: 5, perLoss: 0, base: 0 }, adv: { yes: 50, no: 0 } };
  ok('C4 按胜场时晋级分不掺进来', E.ptsOf(ruleWin, { wins: 2, draws: 1, losses: 0, adv: true }) === 25,
    E.ptsOf(ruleWin, { wins: 2, draws: 1, losses: 0, adv: true }));

  // 归一化：旧版「晋级分叠加」迁移成独立计分方式
  const norm = M.normalizePtsRule({ on: true, mode: 'rank', adv: { on: true, yes: 30, no: 5, add: false } });
  ok('C5 旧版 adv.on 迁移成 mode=adv 并保留分值',
    norm.mode === 'adv' && norm.adv.yes === 30 && norm.adv.no === 5, [norm.mode, norm.adv]);
  const norm2 = M.normalizePtsRule({ on: true, mode: 'rank' });
  ok('C6 没有晋级分的老规则保持按名次', norm2.mode === 'rank' && norm2.adv.yes === 100, [norm2.mode, norm2.adv]);

  // ---- 走真实的阶段数据：晋级判定 = 阶段实际晋级名单 ----
  const t = M.createTournament('晋级分赛');
  const ps = ['甲', '乙', '丙', '丁'].map(function (n, i) { return M.createPlayer(n, i + 1); });
  t.players = ps;
  t.stages.push(M.defaultStage(1));

  const fmt = M.normalizeFormat({ gamesPerMatch: 1, winNeeded: 1 });
  function mkRound(stage, pairs, base) {
    stage.roundsData = [{ index: 0, matches: [] }];
    pairs.forEach(function (pr, i) {
      const m = {
        id: 'x' + base + i, round: 0, playerA: pr[0].id, playerB: pr[1].id, games: [],
        result: null
      };
      m.games.push({ w: 'A', a: 1, b: 0 });
      E.evaluate(m, fmt, 'sudden_death');
      stage.roundsData[0].matches.push(m);
    });
  }
  const s0 = t.stages[0], s1 = t.stages[1];
  s0.participants = ps.map(function (p) { return p.id; });
  mkRound(s0, [[ps[0], ps[3]], [ps[1], ps[2]]], 'a');
  s0.advanced = [ps[0].id, ps[1].id];
  s0.status = 'finished';
  s1.participants = [ps[0].id, ps[1].id];
  mkRound(s1, [[ps[0], ps[1]]], 'b');
  s1.advanced = [];
  s1.status = 'finished';

  const rs0 = E.stageResults(t, 0);
  ok('C7 stageResults 带 adv 字段（晋级者 true）',
    rs0.filter(function (r) { return r.id === ps[0].id; })[0].adv === true &&
    rs0.filter(function (r) { return r.id === ps[2].id; })[0].adv === false, rs0);

  t.ptsRule = {
    on: true, mode: 'adv', unit: 'stage', stack: true,
    rank: { tiers: [{ from: 1, to: 1, pts: 100 }, { from: 2, to: 2, pts: 50 }], step: 0, floor: 0 },
    win: { perWin: 10, perDraw: 5, perLoss: 0, base: 0 },
    adv: { yes: 30, no: 5 }
  };
  const tp = E.tournamentPoints(t);
  const rowOf = function (name) { return tp.rows.filter(function (r) { return r.name === name; })[0] || {}; };
  const u0 = rowOf('甲').units ? rowOf('甲').units['s0'] : {};
  ok('C8 阶段单元里记下「是否晋级」', u0.adv === true, u0);
  ok('C9 晋级者 = 晋级分（不叠加名次分）', u0.pts === 30, u0.pts);
  const u0c = rowOf('丙').units ? rowOf('丙').units['s0'] : {};
  ok('C10 没晋级的人拿未晋级分', u0c.adv === false && u0c.pts === 5, u0c);
  ok('C11 叠加时：甲 = 阶段1的30 + 阶段2的5', rowOf('甲').total === 35, rowOf('甲').total);

  // 阶段 2 改成「不叠加」：只有晋级到本阶段的人重新起算
  s1.ptsStack = 'reset';
  const tp2 = E.tournamentPoints(t);
  const r2 = tp2.rows.filter(function (r) { return r.name === '甲'; })[0];
  ok('C12 阶段2 不叠加 → 甲只算本阶段的 5 分', r2.total === 5, r2.total);
  ok('C13 阶段1 的分不会因为阶段2 的 reset 被清掉（丙仍是 5）',
    tp2.rows.filter(function (r) { return r.name === '丙'; })[0].total === 5,
    tp2.rows.filter(function (r) { return r.name === '丙'; })[0].total);
}

/* ================= D. 团体赛计分 ================= */
sec('D. 团体赛：大比分 = 盘数，个人小局只进小分');
{
  const { t, A, B, st } = teamT('nvn', 3);
  const fmt = E.fmtOf(t, st);
  const m = {
    id: 'md1', playerA: A.id, playerB: B.id, round: 0, games: [
      board(0, 'A', 'tAm1', 'tBm1', 2, 1),
      board(1, 'A', 'tAm2', 'tBm2', 2, 0),
      board(2, 'B', 'tAm3', 'tBm3', 1, 2)
    ], result: null
  };
  const r = E.evaluate(m, fmt, null);
  ok('D1 大比分 = 赢盘数（2:1）', r.gamesA === 2 && r.gamesB === 1, [r.gamesA, r.gamesB]);
  ok('D2 三盘打完，赢盘多者胜', r.winner === 'A' && r.settled === true, r);

  st.roundsData = [{ index: 0, matches: [m] }];
  const stats = E.buildStats(t, st, [A.id, B.id], null);
  ok('D3 排名页赢局列 = 盘数', stats[A.id].gamesWon === 2 && stats[A.id].gamesLost === 1,
    [stats[A.id].gamesWon, stats[A.id].gamesLost]);
  ok('D4 累计小分 = 队员个人小局之和（2+2+1=5）', stats[A.id].cumulative === 5, stats[A.id].cumulative);
  ok('D5 B 队个人小局 1+0+2=3', stats[B.id].cumulative === 3, stats[B.id].cumulative);

  // 记分方式：按小分累加 → 团体赛下按盘分（个人小局不影响积分）
  const scPoints = { mode: 'points' };
  ok('D6 团体赛「按小分累加」改成按盘分', E.pointsFrom(m, 'A', scPoints, fmt) === 2,
    E.pointsFrom(m, 'A', scPoints, fmt));
  // 记分方式：赢局计分 → 盘数 × perGame
  ok('D7 团体赛「按赢局」= 盘数 × 分值', E.pointsFrom(m, 'A', { mode: 'games', perGame: 3 }, fmt) === 6,
    E.pointsFrom(m, 'A', { mode: 'games', perGame: 3 }, fmt));
  // 普通赛（非团体）不受影响
  ok('D8 普通赛「按小分累加」仍按逐局小分', E.pointsFrom(m, 'A', scPoints, { gamesPerMatch: 3, winNeeded: 2 }) === 5,
    E.pointsFrom(m, 'A', scPoints, { gamesPerMatch: 3, winNeeded: 2 }));
}

console.log('\n=====================================');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
console.log('=====================================');
process.exit(fail ? 1 : 0);
