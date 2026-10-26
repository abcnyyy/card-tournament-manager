/**
 * v2.0 引擎测试
 *  A. 团体赛的「回合」= 一盘，每个回合可以是不同选手
 *  B. nvn：所有盘打满再比赢盘数（比分会是 3:0 / 2:1 / 平局……）
 *  C. 征服：一队所有队员各赢一盘，这一队才获胜
 *  D. KOF：把对方全员击败才获胜
 *  E. 积分：按是否晋级下一阶段 = 独立计分方式；阶段可分别设叠加 / 不叠加
 *  F. 旧存档迁移：团体赛旧数据补回合号
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

/* ---------------- 造队伍 ---------------- */
function team(id, name, n) {
  var mem = [];
  for (var i = 0; i < n; i++) mem.push({ id: id + 'm' + (i + 1), name: name + (i + 1), seed: i + 1 });
  return { id: id, name: name, isTeam: true, active: true, startStage: 0, seed: 0, members: mem };
}
function teamT(mode, na, nb) {
  var t = M.createTournament('团体赛 v2');
  var A = team('tA', '甲队', na || 3);
  var B = team('tB', '乙队', nb || 3);
  t.players = [A, B];
  t.team = { on: true, mode: mode, size: 3, winNeeded: 0, fmt: null };
  t.format = M.normalizeFormat({ gamesPerMatch: 1, winNeeded: 1 });
  var st = t.stages[0];
  st.participants = [A.id, B.id];
  return { t: t, A: A, B: B, st: st };
}
function rnd(si, w, pa, pb) { return { s: si, w: w, pa: pa, pb: pb }; }

/* ================= A. 回合 = 一盘，可换不同选手 ================= */
sec('A. 团体赛的回合：每个回合可以是不同选手');
{
  const { t, A, B, st } = teamT('nvn', 3, 3);
  const m = { id: 'm1', playerA: A.id, playerB: B.id, games: [] };
  const fmt = E.fmtOfMatch(t, st, m);

  ok('A1 3 人 = 3 个回合', fmt.sets === 3, fmt.sets);
  ok('A2 每回合的内部局制沿用赛事局制', fmt.gamesPerMatch === 1 && fmt.winNeeded === 1,
    [fmt.gamesPerMatch, fmt.winNeeded]);

  // 三个回合，双方各换不同队员
  m.games.push(rnd(0, 'A', 'tAm1', 'tBm3'));
  m.games.push(rnd(1, 'A', 'tAm2', 'tBm1'));
  m.games.push(rnd(2, 'B', 'tAm3', 'tBm2'));

  ok('A3 回合号记在每条记录上', E.teamRoundsOf(m).join(',') === '0,1,2', E.teamRoundsOf(m));
  ok('A4 第 1 回合上场的队员可以和第 2 回合不同',
    E.teamRoundPlayers(m, 0).a === 'tAm1' && E.teamRoundPlayers(m, 1).a === 'tAm2' &&
    E.teamRoundPlayers(m, 0).b === 'tBm3' && E.teamRoundPlayers(m, 1).b === 'tBm1',
    [E.teamRoundPlayers(m, 0), E.teamRoundPlayers(m, 1)]);

  const r = E.evaluate(m, fmt, null);
  ok('A5 大比分 = 赢下的回合数 2:1', r.gamesA === 2 && r.gamesB === 1, [r.gamesA, r.gamesB]);
  ok('A6 三个回合都打完才定胜负', r.settled === true && r.roundsDone === 3, r);
  ok('A7 团体赛的回合胜方按「盘」算', r.setWinners.join(',') === 'A,A,B', r.setWinners);
}

/* ================= B. nvn：打满比赢盘 ================= */
sec('B. nvn：所有盘打满再比赢盘数');
{
  function play(str) {
    const { t, A, B, st } = teamT('nvn', 3, 3);
    const m = { id: 'mx', playerA: A.id, playerB: B.id, games: [] };
    const fmt = E.fmtOfMatch(t, st, m);
    str.split('').forEach(function (w, i) { m.games.push(rnd(i, w, 'tAm' + (i + 1), 'tBm' + (i + 1))); });
    return E.evaluate(m, fmt, 'draw_ok');
  }
  const r1 = play('AAA');
  ok('B1 3:0 完胜', r1.winner === 'A' && r1.gamesA === 3 && r1.gamesB === 0, r1);
  const r2 = play('ABA');
  ok('B2 2:1 也能赢（比分不是固定的）', r2.winner === 'A' && r2.gamesA === 2 && r2.gamesB === 1, r2);
  const r3 = play('ABB');
  ok('B3 1:2 换对方赢', r3.winner === 'B' && r3.gamesA === 1 && r3.gamesB === 2, r3);

  // 平盘：允许平局时 1:1 加一个平盘 → 平局
  {
    const { t, A, B, st } = teamT('nvn', 3, 3);
    const m = { id: 'mt', playerA: A.id, playerB: B.id, games: [
      rnd(0, 'A', 'tAm1', 'tBm1'), rnd(1, 'B', 'tAm2', 'tBm2'), rnd(2, 'D', 'tAm3', 'tBm3')
    ] };
    const fmt = E.fmtOfMatch(t, st, m);
    const r = E.evaluate(m, fmt, 'draw_ok');
    ok('B4 有平盘时 1:1 → 平局', r.winner === null && r.settled === true && r.draws === 1, r);
    const r2b = E.evaluate(m, fmt, 'sudden_death');
    ok('B5 加赛制下 1:1 不算结束', r2b.settled === false && m.overtime === true, r2b);
  }

  // 只打了两盘：还不能结束
  {
    const { t, A, B, st } = teamT('nvn', 3, 3);
    const m = { id: 'mu', playerA: A.id, playerB: B.id, games: [
      rnd(0, 'A', 'tAm1', 'tBm1'), rnd(1, 'A', 'tAm2', 'tBm2')
    ] };
    const fmt = E.fmtOfMatch(t, st, m);
    const r = E.evaluate(m, fmt, 'draw_ok');
    ok('B6 nvn 2:0 也不能提前结束（要打完全部盘）', r.settled === false && r.gamesA === 2, r);
  }
}

/* ================= C. 征服：全员获胜 ================= */
sec('C. 征服：一队所有队员都赢下一盘才获胜');
{
  const { t, A, B, st } = teamT('conquest', 3, 3);
  const m = { id: 'mc', playerA: A.id, playerB: B.id, games: [] };
  const fmt = E.fmtOfMatch(t, st, m);
  ok('C1 征服的达标线 = 本方人数（各 3 盘）', fmt.teamNeed.a === 3 && fmt.teamNeed.b === 3, fmt.teamNeed);

  m.games.push(rnd(0, 'A', 'tAm1', 'tBm1'));
  m.games.push(rnd(1, 'A', 'tAm2', 'tBm1'));
  const r1 = E.evaluate(m, fmt, null);
  ok('C2 赢 2 盘还不算赢', r1.winner === null && r1.settled === false, r1);

  m.games.push(rnd(2, 'A', 'tAm3', 'tBm1'));
  const r2 = E.evaluate(m, fmt, null);
  ok('C3 第三位队员也赢了 → 全员获胜', r2.winner === 'A' && r2.gamesA === 3, r2);

  // 双方人数不同：4 人队要 4 盘、3 人队要 3 盘
  const t2 = teamT('conquest', 4, 3);
  const m2 = { id: 'mc2', playerA: t2.A.id, playerB: t2.B.id, games: [
    rnd(0, 'B', 'tAm1', 'tBm3'), rnd(1, 'B', 'tAm2', 'tBm1'), rnd(2, 'B', 'tAm3', 'tBm2')
  ] };
  const f2 = E.fmtOfMatch(t2.t, t2.st, m2);
  const r3 = E.evaluate(m2, f2, null);
  ok('C4 人数不同时各按自己的人数达标（3 人队先达标就赢）',
    f2.teamNeed.a === 4 && f2.teamNeed.b === 3 && r3.winner === 'B', [f2.teamNeed, r3.winner]);
  ok('C5 最多回合数 = 双方人数之和 − 1', f2.sets === 6, f2.sets);
}

/* ================= D. KOF：全灭对方 ================= */
sec('D. KOF：把对方全员击败');
{
  const { t, A, B, st } = teamT('kof', 3, 3);
  const m = { id: 'mk', playerA: A.id, playerB: B.id, games: [] };
  const fmt = E.fmtOfMatch(t, st, m);
  ok('D1 KOF 达标线 = 对方人数', fmt.teamNeed.a === 3 && fmt.teamNeed.b === 3, fmt.teamNeed);

  m.games.push(rnd(0, 'A', 'tAm1', 'tBm1'));
  ok('D2 赢的人还能继续上（同样的人打第二盘）', E.teamCanField(t, m, 'A', 'tAm1') === true);
  m.games.push(rnd(1, 'A', 'tAm1', 'tBm2'));
  const r1 = E.evaluate(m, fmt, null);
  ok('D3 击败 2 人还没结束', r1.settled === false && r1.gamesA === 2, r1);
  m.games.push(rnd(2, 'A', 'tAm1', 'tBm3'));
  const r2 = E.evaluate(m, fmt, null);
  ok('D4 击败全部 3 人 → 获胜', r2.winner === 'A' && r2.gamesA === 3, r2);
}

/* ================= E. 积分：独立计分方式 + 阶段叠加 ================= */
sec('E. 积分：按是否晋级 / 阶段叠加');
{
  // 构造 2 阶段 4 人
  const t = M.createTournament('阶段积分');
  const ps = ['甲', '乙', '丙', '丁'].map(function (n, i) { return M.createPlayer(n, i + 1); });
  t.players = ps;
  t.stages.push(M.defaultStage(1));
  const fmt = M.normalizeFormat({ gamesPerMatch: 1, winNeeded: 1 });
  function mkRound(stage, pairs, tg) {
    stage.roundsData = [{ index: 0, matches: [] }];
    pairs.forEach(function (pr, i) {
      const m = { id: 'y' + tg + i, round: 0, playerA: pr[0].id, playerB: pr[1].id, games: [{ w: 'A', a: 1, b: 0 }], result: null };
      E.evaluate(m, fmt, 'sudden_death');
      stage.roundsData[0].matches.push(m);
    });
  }
  const s0 = t.stages[0], s1 = t.stages[1];
  s0.participants = ps.map(function (p) { return p.id; });
  mkRound(s0, [[ps[0], ps[3]], [ps[1], ps[2]]], 'p');
  s0.advanced = [ps[0].id, ps[1].id];
  s0.status = 'finished';
  s1.participants = [ps[0].id, ps[1].id];
  mkRound(s1, [[ps[0], ps[1]]], 'q');
  // 「按是否晋级下一阶段给分」看的是该阶段自己的晋级名单：
  // 第 2 阶段是最后一阶段，没有下一阶段可晋级 —— 想让这一阶段也计分就把人勾进去
  s1.advanced = [ps[0].id];
  s1.status = 'finished';

  t.ptsRule = {
    on: true, mode: 'adv', unit: 'stage', stack: true,
    rank: { tiers: [{ from: 1, to: 1, pts: 100 }, { from: 2, to: 3, pts: 60 }], step: 10, floor: 5 },
    win: { perWin: 10, perDraw: 5, perLoss: 0, base: 0 },
    adv: { yes: 40, no: 0 },
    stageOv: {}
  };
  function total(name) {
    const tp = E.tournamentPoints(t);
    const r = tp.rows.filter(function (x) { return x.name === name; })[0];
    return r ? r.total : null;
  }
  ok('E1 晋级分是独立计分方式（不看名次）', E.ptsOf(t.ptsRule, { rank: 1, adv: true }) === 40);
  ok('E2 没晋级拿未晋级分', E.ptsOf(t.ptsRule, { rank: 1, adv: false }) === 0);
  ok('E3 阶段1 + 阶段2 都晋级 → 40 + 40（默认叠加）', total('甲') === 80, total('甲'));
  ok('E4 没晋级的丙只有阶段1 的 0 分', total('丙') === 0, total('丙'));

  // 阶段 2 设「不叠加」：只有晋级到本阶段的人重新起算
  s1.ptsStack = 'reset';
  ok('E5 阶段2 不叠加 → 甲只算本阶段的 40', total('甲') === 40, total('甲'));
  ok('E6 阶段2 不叠加不影响没参加的人（丙仍是 0）', total('丙') === 0, total('丙'));

  // 赛事默认不叠加，但阶段1 显式设「叠加」→ 以阶段为准
  s0.ptsStack = 'stack';
  s1.ptsStack = 'inherit';
  t.ptsRule.stack = false;
  ok('E7 阶段显式「叠加」优先于赛事默认的不叠加', total('甲') === 40, total('甲'));

  // 名次口径：同样的阶段数据，按名次给分
  t.ptsRule.mode = 'rank';
  t.ptsRule.stack = true;
  s0.ptsStack = 'inherit'; s1.ptsStack = 'inherit';
  const tp2 = E.tournamentPoints(t);
  const rJia = tp2.rows.filter(function (x) { return x.name === '甲'; })[0];
  ok('E8 按名次时晋级分完全不参与', rJia.total === E.rankPoints(t.ptsRule, rJia.units['s0'].rank) +
    E.rankPoints(t.ptsRule, rJia.units['s1'].rank), rJia.total);
}

/* ================= F. 旧存档迁移 ================= */
sec('F. 旧存档：团体赛旧数据补回合号');
{
  const t = M.createTournament('旧团体赛');
  t.team = { on: true, mode: 'conquest', size: 3, winNeeded: 0, fmt: null };
  t.players = [team('oA', '甲', 3), team('oB', '乙', 3)];
  t.stages[0].participants = ['oA', 'oB'];
  // v1.14.x 的数据：一盘一条 games，没有 s
  const m = {
    id: 'old1', round: 0, playerA: 'oA', playerB: 'oB', games: [
      { w: 'A', pa: 'oAm1', pb: 'oBm1' },
      { w: 'A', pa: 'oAm2', pb: 'oBm2' },
      { w: 'A', pa: 'oAm3', pb: 'oBm3' }
    ], result: null
  };
  t.stages[0].roundsData = [{ index: 0, matches: [m] }];

  const n = TMS.store.normalize(t);
  const gm = n.stages[0].roundsData[0].matches[0].games;
  ok('F1 旧数据补上回合号 0/1/2', gm.map(function (g) { return g.s; }).join(',') === '0,1,2',
    gm.map(function (g) { return g.s; }));
  ok('F2 迁移后按新口径算：3 个回合 A 全胜', E.teamRoundsOf(gm.length ? m : m).length === 3);
  const r = E.evaluate(m, E.fmtOfMatch(n, n.stages[0], m), null);
  ok('F3 迁移后征服判定正确（A 全员获胜）', r.winner === 'A' && r.gamesA === 3, r);
}

console.log('\n=====================================');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
console.log('=====================================');
process.exit(fail ? 1 : 0);
