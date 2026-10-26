/**
 * v1.14.0 引擎测试
 *  A. 名次档位改成「几个名次一档」（区间档）
 *  B. 积分规则里的「晋级下一阶段」标注
 *  C. 回合：一场比赛 = 若干回合，每回合同局制
 *  D. 团体赛：nvn / 征服 / KOF 三种团体局制
 *  E. 后进选手：指定「从第 N 阶段开始」
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
const { model: M, engine: E, store: S } = TMS;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra === undefined ? '' : '  →  ' + JSON.stringify(extra))); }
}
function sec(t) { console.log('\n[' + t + ']'); }

/* ================= A. 区间档位 ================= */
sec('A. 名次档位按「几个名次一档」');
{
  const rule = {
    rank: {
      tiers: [
        { from: 1, to: 1, pts: 100 },
        { from: 2, to: 3, pts: 80 },
        { from: 4, to: 6, pts: 65 }
      ],
      step: 5, floor: 10
    }
  };
  ok('A1 第 1 名 = 100', E.rankPoints(rule, 1) === 100, E.rankPoints(rule, 1));
  ok('A2 第 2 名落在 2~3 档 = 80', E.rankPoints(rule, 2) === 80, E.rankPoints(rule, 2));
  ok('A3 第 3 名同档同分 = 80', E.rankPoints(rule, 3) === 80, E.rankPoints(rule, 3));
  ok('A4 第 5 名 = 65', E.rankPoints(rule, 5) === 65, E.rankPoints(rule, 5));
  ok('A5 第 7 名从第 6 名递减 = 60', E.rankPoints(rule, 7) === 60, E.rankPoints(rule, 7));
  ok('A6 第 10 名 = 45', E.rankPoints(rule, 10) === 45, E.rankPoints(rule, 10));
  ok('A7 第 100 名触底 = 10', E.rankPoints(rule, 100) === 10, E.rankPoints(rule, 100));

  // 档位之间有空档：第 2 名（1 档之后、3 档之前）从第 1 档递减
  const gap = { rank: { tiers: [{ from: 1, to: 1, pts: 100 }, { from: 4, to: 4, pts: 50 }], step: 10, floor: 0 } };
  ok('A8 空档按 step 递减（第 2 名 = 90）', E.rankPoints(gap, 2) === 90, E.rankPoints(gap, 2));
  ok('A9 空档按 step 递减（第 3 名 = 80）', E.rankPoints(gap, 3) === 80, E.rankPoints(gap, 3));
  ok('A10 档位内以档位值为准（第 4 名 = 50）', E.rankPoints(gap, 4) === 50, E.rankPoints(gap, 4));

  // 老口径 rank.top 仍然可用
  const legacy = { rank: { top: { 1: 200, 2: 150 }, step: 10, floor: 0 } };
  ok('A11 老口径 rank.top 仍生效', E.rankPoints(legacy, 2) === 150 && E.rankPoints(legacy, 3) === 140,
    [E.rankPoints(legacy, 2), E.rankPoints(legacy, 3)]);
}

/* ================= B. 晋级标注 ================= */
sec('B. 积分规则里的「晋级下一阶段」标注');
{
  const rule = {
    rank: {
      tiers: [
        { from: 1, to: 1, pts: 100, adv: true },
        { from: 2, to: 4, pts: 80, adv: true },
        { from: 5, to: 8, pts: 50, adv: false }
      ],
      step: 5, floor: 5
    }
  };
  ok('B1 第 1 名标晋级', E.rankAdv(rule, 1) === true);
  ok('B2 第 3 名所在档标晋级', E.rankAdv(rule, 3) === true);
  ok('B3 第 6 名所在档不晋级', E.rankAdv(rule, 6) === false);
  ok('B4 空档（第 9 名）不晋级', E.rankAdv(rule, 9) === false);
  ok('B5 规则整体「有晋级标注」', E.rankAdvOn(rule) === true);
  ok('B6 没有 adv 的规则不算有标注', E.rankAdvOn({ rank: { tiers: [{ from: 1, to: 1, pts: 1 }] } }) === false);
}

/* ================= C. 回合 ================= */
sec('C. 回合（一场 = 若干回合，每回合同局制）');
{
  // 三个回合，每回合五局三胜
  const fmt = M.normalizeFormat({ gamesPerMatch: 5, winNeeded: 3, sets: 3, setRule: 'sets' });
  ok('C1 归一化保留回合数', E.setCount(fmt) === 3, E.setCount(fmt));
  ok('C2 三回合默认需赢 2 回合', E.setsNeeded(fmt) === 2, E.setsNeeded(fmt));

  const m = { games: [] };
  // 第 1 回合 A 3:0
  [0, 0, 0].forEach(function () { m.games.push({ s: 0, w: 'A' }); });
  ok('C3 第 1 回合打完', E.setDone(m, 0, fmt, 'sudden_death') === true);
  ok('C4 第 1 回合胜方 A', E.setWinnerOf(m, 0, fmt, 'sudden_death') === 'A');
  ok('C5 当前应录第 2 回合', E.curSet(m, fmt, 'sudden_death') === 1, E.curSet(m, fmt, 'sudden_death'));

  // 第 2 回合 A 3:2 再胜 → 2:0 拿下整场
  ['A', 'A', 'B', 'B', 'A'].forEach(function (w) { m.games.push({ s: 1, w: w }); });
  let r = E.evaluate(m, fmt, 'sudden_death');
  ok('C6 两回合到手即赢下整场', r.winner === 'A' && r.settled === true, r);
  ok('C7 大比分 = 回合比分 2:0', r.gamesA === 2 && r.gamesB === 0, [r.gamesA, r.gamesB]);
  ok('C8 同时给出总赢局 6:2', r.rawGamesA === 6 && r.rawGamesB === 2, [r.rawGamesA, r.rawGamesB]);
  ok('C9 已赢下整场后不能再加局', E.canAddGame(m, fmt, 'sudden_death') === false);
  ok('C10 最多局数 = 3 回合 × 5 局 = 15', E.matchMaxGames(m, fmt) === 15, E.matchMaxGames(m, fmt));

  // setRule = games：按总大比分（总赢局），必须三回合都打完
  const fg = M.normalizeFormat({ gamesPerMatch: 2, winNeeded: 0, sets: 3, setRule: 'games' });
  const mg = { games: [] };
  [['A', 'A'], ['B', 'B'], ['A', 'A']].forEach(function (set, si) {
    set.forEach(function (w) { mg.games.push({ s: si, w: w }); });
  });
  let rg = E.evaluate(mg, fg, 'draw_ok');
  ok('C11 按总大比分：3 回合都打满才结算', rg.settled === true, rg && rg.settled);
  ok('C12 总赢局 4:2 → A 胜，大比分显示总赢局', rg.winner === 'A' && rg.gamesA === 4 && rg.gamesB === 2,
    [rg.winner, rg.gamesA, rg.gamesB]);
  ok('C13 回合数仍单独记（2:1）', rg.setsA === 2 && rg.setsB === 1, [rg.setsA, rg.setsB]);

  // setRule = points：按总得分
  const fp = M.normalizeFormat({ gamesPerMatch: 2, winNeeded: 0, sets: 2, setRule: 'points', recordScore: true });
  const mp = {
    games: [
      { s: 0, w: 'A', a: 21, b: 10 }, { s: 0, w: 'B', a: 5, b: 21 },
      { s: 1, w: 'A', a: 21, b: 19 }, { s: 1, w: 'B', a: 3, b: 21 }
    ]
  };
  const rp = E.evaluate(mp, fp, 'draw_ok');
  ok('C14 按总得分：A 50 分', rp.pointsA === 50, rp.pointsA);
  ok('C15 按总得分：B 71 分 → B 胜', rp.pointsB === 71 && rp.winner === 'B', [rp.pointsB, rp.winner]);
  ok('C16 大比分显示总得分', rp.gamesA === 50 && rp.gamesB === 71, [rp.gamesA, rp.gamesB]);

  // 回合 = 1 时行为与老版本完全一致
  const f1 = M.normalizeFormat({ gamesPerMatch: 3, winNeeded: 2 });
  const m1 = { games: [{ w: 'A' }, { w: 'A' }] };
  const r1 = E.evaluate(m1, f1, 'sudden_death');
  ok('C17 单回合与旧口径一致（2:0 胜）', r1.winner === 'A' && r1.gamesA === 2 && r1.setsA === undefined, r1);
}

/* ================= D. 团体赛 ================= */
sec('D. 团体赛：nvn / 征服 / KOF');
{
  const t = M.createTournament('团体赛');
  ok('D1 新赛事默认关闭团体赛', t.team.on === false);

  t.team = { on: true, mode: 'nvn', size: 3, winNeeded: 0 };
  ok('D2 团体赛开关生效', E.teamOn(t) === true);
  let f = E.fmtOf(t, t.stages[0]);
  ok('D3 nvn 3 人 = 3 个回合，全部打完比赢盘（没有胜盘线）',
    f.sets === 3 && f.teamNeed === null, [f.sets, f.teamNeed]);

  t.team.mode = 'kof';
  f = E.fmtOf(t, t.stages[0]);
  ok('D4 KOF：要把对方全员击败（各需 3 盘），最多 5 个回合',
    f.sets === 5 && f.teamNeed.a === 3 && f.teamNeed.b === 3, [f.sets, f.teamNeed]);

  t.team.mode = 'conquest';
  f = E.fmtOf(t, t.stages[0]);
  ok('D5 征服：本方全员各赢一盘才达标（各需 3 盘）',
    f.sets === 5 && f.teamNeed.a === 3 && f.teamNeed.b === 3, [f.sets, f.teamNeed]);

  t.team.mode = 'nvn'; t.team.size = 4; t.team.winNeeded = 3;
  f = E.fmtOf(t, t.stages[0]);
  ok('D6 nvn 4 人 = 4 个回合（胜盘线字段已废弃）', f.sets === 4, f.sets);

  // 每一个回合内部的局制 = 赛事常规局制
  const bf = E.boardFmtOf(t, t.stages[0]);
  ok('D7 每盘沿用常规局制（三局两胜）', bf.gamesPerMatch === 3 && bf.winNeeded === 2, [bf.gamesPerMatch, bf.winNeeded]);

  // 队伍就是参赛单位：以队伍为「选手」，队伍里挂 members
  const squadA = { id: 'tmA', name: 'A 队', isTeam: true, members: [{ id: 'a1', name: '甲' }, { id: 'a2', name: '乙' }] };
  ok('D8 队伍可挂多名队员', squadA.members.length === 2);

  // 团体赛的对阵结果就是「赢盘数」：3 个回合 2:1（每条 games 用 s 标回合）
  const m = { games: [
    { s: 0, w: 'A', pa: 'a1', pb: 'b1' },
    { s: 1, w: 'B', pa: 'a2', pb: 'b2' },
    { s: 2, w: 'A', pa: 'a3', pb: 'b3' }
  ] };
  t.team.mode = 'nvn'; t.team.size = 3;
  const fm = E.fmtOf(t, t.stages[0]);
  const r = E.evaluate(m, fm, 'sudden_death');
  ok('D9 大比分 = 赢盘数 2:1', r.gamesA === 2 && r.gamesB === 1, [r.gamesA, r.gamesB]);
  ok('D10 所有回合打完、赢盘数多者胜', r.winner === 'A' && r.settled === true, r);
  ok('D11 队员信息挂在每一盘上', m.games[0].pa === 'a1' && m.games[0].pb === 'b1');
}

/* ================= E. 后进选手 ================= */
sec('E. 后进选手：从后续某一阶段开始');
{
  const t = M.createTournament('后进赛');
  const a = M.createPlayer('甲', 1), b = M.createPlayer('乙', 2), c = M.createPlayer('丙', 3);
  t.players = [a, b, c];
  t.players.forEach(function (p) { p.startStage = 0; });
  c.startStage = 1;                          // 丙直接从第 2 阶段打
  t.stages.push(M.defaultStage(1));

  ok('E1 第 1 阶段不包含后进选手', E.ensureParticipants(t, t.stages[0]).indexOf(c.id) < 0);
  ok('E2 第 1 阶段包含正常选手', E.ensureParticipants(t, t.stages[0]).length === 2);
  ok('E3 latecomers 取到第 2 阶段的人', E.latecomers(t, 1, []).map(function (p) { return p.name; }).join(',') === '丙');

  // 模拟第 1 阶段结束：只晋级甲，丙仍然要空降进第 2 阶段
  t.stages[0].advanced = [a.id];
  t.stages[1].participants = null;
  const ids = E.withLatecomers(t, 1, [a.id]);
  ok('E4 空降选手并入下一阶段名单', ids.indexOf(c.id) >= 0 && ids.length === 2, ids);

  // 退赛的人不会被空降
  c.active = false;
  ok('E5 退赛的后进选手不再加入', E.withLatecomers(t, 1, [a.id]).indexOf(c.id) < 0);
}

console.log('\n=====================================');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
console.log('=====================================');
process.exit(fail ? 1 : 0);
