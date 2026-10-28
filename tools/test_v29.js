/**
 * v2.1 引擎测试 —— 团体赛统一为「一桌 = 一场比赛」
 *  A. 场数：由「上场人数」决定，队员不一定等于上场人数（playSize）
 *  B. 排阵：先定上场队员，再录成绩；nvn 必须整场排完才允许录
 *  C. nvn 判定：比分有多种（3:0 / 2:1 / 1:2 / 平局）
 *  D. 征服：本方所有上场队员各赢一场才获胜
 *  E. KOF：把对方所有上场队员击败
 *  F. 一人一场：同一方在场上的队员不会重复
 *  G. 旧存档迁移：补 slots、补场次号
 *  H. 平局加赛：加赛可以重新派人（nvn 一人一场的限制只管规定的场次）
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

/* ---- 造一个团体赛 ---- */
function mkTeam(opts) {
  opts = opts || {};
  var t = M.createTournament('团体赛');
  t.team = { on: true, mode: opts.mode || 'nvn', size: opts.size || 3, playSize: opts.playSize || 0, winNeeded: 0, fmt: null };
  t.format = M.normalizeFormat({ gamesPerMatch: 3, winNeeded: 2 });
  var teamA = { id: 'TA', name: '红队', isTeam: true, members: [] };
  var teamB = { id: 'TB', name: '白队', isTeam: true, members: [] };
  var n = opts.members || 3;
  for (var i = 0; i < n; i++) {
    teamA.members.push({ id: 'a' + i, name: '红-' + (i + 1) });
    teamB.members.push({ id: 'b' + i, name: '白-' + (i + 1) });
  }
  if (opts.aMembers) {
    teamA.members = [];
    for (var j = 0; j < opts.aMembers; j++) teamA.members.push({ id: 'a' + j, name: '红-' + (j + 1) });
  }
  if (opts.bMembers) {
    teamB.members = [];
    for (var k = 0; k < opts.bMembers; k++) teamB.members.push({ id: 'b' + k, name: '白-' + (k + 1) });
  }
  t.players = [teamA, teamB];
  return { t: t, m: { id: 'M1', playerA: 'TA', playerB: 'TB', games: [], slots: [] }, fmt: E.fmtOf(t, t.stages[0]) };
}

/* ================= A. 场数 ================= */
sec('A. 一场团体赛打几场对局');
{
  let x = mkTeam({ mode: 'nvn', size: 3, members: 3 });
  ok('A1 nvn 3 人 = 3 场', E.teamTableTotal(x.t, x.m) === 3, E.teamTableTotal(x.t, x.m));
  ok('A2 局制里 sets = 3（大比分口径是场数）', E.fmtOfMatch(x.t, x.t.stages[0], x.m).sets === 3);

  x = mkTeam({ mode: 'nvn', size: 5, members: 5, playSize: 3 });
  ok('A3 报名 5 人但只上 3 人 = 3 场（队员 ≠ 上场人数）',
    E.teamTableTotal(x.t, x.m) === 3, E.teamTableTotal(x.t, x.m));
  ok('A4 每方上场人数按 playSize 夹紧', E.teamFieldSize(x.t, x.m, 'A') === 3, E.teamFieldSize(x.t, x.m, 'A'));
  ok('A5 队伍里第 4、5 人这场不打（候选里仍然在，但不占场次）',
    E.teamMembersOf(x.t, x.m, 'A').length === 5);

  x = mkTeam({ mode: 'nvn', members: 3, aMembers: 2, bMembers: 3 });
  ok('A6 双方人数不齐时按少的算（2 场）', E.teamTableTotal(x.t, x.m) === 2, E.teamTableTotal(x.t, x.m));

  x = mkTeam({ mode: 'conquest', members: 3 });
  ok('A7 征服：最多 3+3−1 = 5 场', E.teamTableTotal(x.t, x.m) === 5, E.teamTableTotal(x.t, x.m));
  x = mkTeam({ mode: 'kof', members: 4 });
  ok('A8 KOF：最多 4+4−1 = 7 场', E.teamTableTotal(x.t, x.m) === 7, E.teamTableTotal(x.t, x.m));
}

/* ================= B. 排阵 ================= */
sec('B. 先定人，再录成绩');
{
  const x = mkTeam({ mode: 'nvn', members: 3 });
  const { t, m } = x;
  ok('B1 一开始没排阵 → 不能录', E.teamLineupReady(t, m) === false);
  ok('B2 已排 0 场', E.teamPairedCount(t, m) === 0);

  E.teamAutoLineup(t, m);
  ok('B3 按名单自动排阵 → 3 场全部对位',
    E.teamSlotPlayers(m, 0).a === 'a0' && E.teamSlotPlayers(m, 1).b === 'b1' && E.teamSlotPlayers(m, 2).a === 'a2',
    [E.teamSlotPlayers(m, 0), E.teamSlotPlayers(m, 1), E.teamSlotPlayers(m, 2)]);
  ok('B4 排完阵 → 可以录成绩', E.teamLineupReady(t, m) === true);
  ok('B5 已排 3 场', E.teamPairedCount(t, m) === 3);

  // 手改第 2 场：红-3 vs 白-1
  E.teamSetSlot(m, 1, 'a2', 'b0');
  ok('B6 手动改排阵生效', E.teamSlotPlayers(m, 1).a === 'a2' && E.teamSlotPlayers(m, 1).b === 'b0',
    E.teamSlotPlayers(m, 1));

  // 清空一场 → 又不能录
  E.teamSetSlot(m, 2, '', '');
  ok('B7 有一场没排人 → 又不允许录', E.teamLineupReady(t, m) === false);
  E.teamSetSlot(m, 2, 'a2', 'b2');
  ok('B8 补回来 → 恢复', E.teamLineupReady(t, m) === true);

  // 录完一场后，已打完的场次算「排好了」
  m.games.push({ s: 0, w: 'A', pa: 'a0', pb: 'b0' });
  ok('B9 已打完的场次不再要求排阵', E.teamLineupReady(t, m) === true);
}

/* ================= C. nvn 判定 ================= */
sec('C. nvn：全部打完比赢下场数');
{
  const x = mkTeam({ mode: 'nvn', members: 3 });
  const fmt = E.fmtOfMatch(x.t, x.t.stages[0], x.m);
  const m = x.m;
  m.games.push({ s: 0, w: 'A', pa: 'a0', pb: 'b0' });
  m.games.push({ s: 1, w: 'B', pa: 'a1', pb: 'b1' });
  let r = E.evaluate(m, fmt, 'draw_ok');
  ok('C1 打 2 场 1:1 → 还没结束', r.settled === false && r.gamesA === 1 && r.gamesB === 1, r);
  m.games.push({ s: 2, w: 'A', pa: 'a2', pb: 'b2' });
  r = E.evaluate(m, fmt, 'draw_ok');
  ok('C2 3 场打完 2:1 → 红队胜', r.settled === true && r.winner === 'A' && r.gamesA === 2 && r.gamesB === 1, r);

  // 平局
  const x2 = mkTeam({ mode: 'nvn', members: 2 });
  const fmt2 = E.fmtOfMatch(x2.t, x2.t.stages[0], x2.m);
  x2.m.games.push({ s: 0, w: 'A', pa: 'a0', pb: 'b0' });
  x2.m.games.push({ s: 1, w: 'B', pa: 'a1', pb: 'b1' });
  const r2 = E.evaluate(x2.m, fmt2, 'draw_ok');
  ok('C3 1:1 且允许平局 → 判平局（已结算、无胜方）',
    r2.settled === true && r2.winner === null, r2);
  const r3 = E.evaluate(x2.m, fmt2, 'sudden_death');
  ok('C4 1:1 且必须分胜负 → 加赛', r3.settled === false && x2.m.overtime === true, r3);

  // 加赛一场定胜负
  x2.m.games.push({ s: 2, w: 'A', pa: 'a0', pb: 'b0' });
  const r4 = E.evaluate(x2.m, fmt2, 'sudden_death');
  ok('C5 加赛第 3 场 2:1 → 红队胜', r4.settled === true && r4.winner === 'A', r4);
}

/* ================= D. 征服 ================= */
sec('D. 征服：本方全员各赢一场');
{
  const x = mkTeam({ mode: 'conquest', members: 3 });
  const fmt = E.fmtOfMatch(x.t, x.t.stages[0], x.m);
  ok('D1 每方要赢 3 场（= 上场人数）', fmt.teamNeed && fmt.teamNeed.a === 3 && fmt.teamNeed.b === 3, fmt.teamNeed);

  x.m.games.push({ s: 0, w: 'A', pa: 'a0', pb: 'b0' });
  x.m.games.push({ s: 1, w: 'A', pa: 'a1', pb: 'b1' });
  let r = E.evaluate(x.m, fmt, 'draw_ok');
  ok('D2 赢 2 场还不算赢（还有队员没出线）', r.settled === false, r);

  // 赢了的人不能再上
  const el = E.teamEligible(x.t, x.m, 'A');
  ok('D3 赢过的队员从候选里消失', el.length === 1 && el[0].id === 'a2', el.map(v => v.id));
  ok('D4 赢过的人不能再上（校验拦截）', E.teamCanField(x.t, x.m, 'A', 'a0') === false);

  const elB = E.teamEligible(x.t, x.m, 'B');
  ok('D5 负方三人仍可选（可以继续也可以换）', elB.length === 3, elB.map(v => v.id));

  x.m.games.push({ s: 2, w: 'A', pa: 'a2', pb: 'b0' });
  r = E.evaluate(x.m, fmt, 'draw_ok');
  ok('D6 三位队员各赢一场 → 红队胜 3:0', r.settled === true && r.winner === 'A' && r.gamesA === 3, r);

  // 少人上场：报名 4 人只上 3 人 → 只需 3 场
  const y = mkTeam({ mode: 'conquest', members: 4, playSize: 3 });
  const fy = E.fmtOfMatch(y.t, y.t.stages[0], y.m);
  ok('D7 只上 3 人：达标线 3 场（第 4 人不用赢）', fy.teamNeed.a === 3, fy.teamNeed);
}

/* ================= E. KOF ================= */
sec('E. KOF：把对方全员击败');
{
  const x = mkTeam({ mode: 'kof', members: 3 });
  const fmt = E.fmtOfMatch(x.t, x.t.stages[0], x.m);
  ok('E1 每方要赢 3 场（击败对方三人）', fmt.teamNeed.a === 3 && fmt.teamNeed.b === 3, fmt.teamNeed);

  // A 先输一场：输的人下场
  x.m.games.push({ s: 0, w: 'B', pa: 'a0', pb: 'b0' });
  const elA = E.teamEligible(x.t, x.m, 'A');
  ok('E2 输的人下场（候选少一个）', elA.length === 2 && elA.every(v => v.id !== 'a0'), elA.map(v => v.id));
  const elB = E.teamEligible(x.t, x.m, 'B');
  ok('E3 赢的人留场（仍在候选里）', elB.length === 3, elB.map(v => v.id));
  ok('E4 下一个该上谁：赢者留场、负方换人',
    (function () { const nx = E.teamNextBoard(x.t, x.m); return nx.a === 'a1' && nx.b === 'b0'; })(),
    E.teamNextBoard(x.t, x.m));

  // 上场人数少于队员数
  const y = mkTeam({ mode: 'kof', members: 4, playSize: 2 });
  const fy = E.fmtOfMatch(y.t, y.t.stages[0], y.m);
  ok('E5 只上 2 人：击败对方 2 人就算赢', fy.teamNeed.a === 2, fy.teamNeed);
}

/* ================= F. 一人一场 ================= */
sec('F. nvn 同一方不重复上场');
{
  const x = mkTeam({ mode: 'nvn', members: 3 });
  E.teamAutoLineup(x.t, x.m);
  ok('F1 自动排阵不重复用人',
    (function () {
      const ids = [0, 1, 2].map(i => E.teamSlotPlayers(x.m, i).a);
      return ids.join(',') === 'a0,a1,a2';
    })(), [0, 1, 2].map(i => E.teamSlotPlayers(x.m, i).a));

  const avail = E.teamEligible(x.t, x.m, 'A', 1);   // 编辑第 2 场时，其他人已占位
  ok('F2 编辑第 2 场时，候选排除已被占用的人（只剩自己那一位）',
    avail.length === 1 && avail[0].id === 'a1', avail.map(v => v.id));

  ok('F3 想把红-1 排到第 2 场会被拦下', E.teamCanField(x.t, x.m, 'A', 'a0', 1) === false);
  ok('F4 排自己原来那位是允许的', E.teamCanField(x.t, x.m, 'A', 'a1', 1) === true);
}

/* ================= H. 平局加赛 ================= */
sec('H. 平局加赛：可以重新派人');
{
  const x = mkTeam({ mode: 'nvn', members: 3 });
  const fmt = E.fmtOfMatch(x.t, x.t.stages[0], x.m);
  const m = x.m;
  E.teamAutoLineup(x.t, m);
  // 红胜 1 场、白胜 1 场、平 1 场 → 1:1 平局
  m.games.push({ s: 0, w: 'A', pa: 'a0', pb: 'b0' });
  m.games.push({ s: 1, w: 'B', pa: 'a1', pb: 'b1' });
  m.games.push({ s: 2, w: 'D', pa: 'a2', pb: 'b2' });
  let r = E.evaluate(m, fmt, 'sudden_death');
  ok('H1 三场打成 1:1（含一场平）→ 不结束，标记加赛', r.settled === false && m.overtime === true, r);
  ok('H2 平局时不判胜方', r.winner === null && r.gamesA === 1 && r.gamesB === 1, r);

  ok('H3 当前该打第 4 场（加赛）', E.teamCur(x.t, m) === 3, E.teamCur(x.t, m));
  ok('H4 加赛时双方全部队员都能再上（nvn 一人一场只限规定的场次）',
    E.teamEligible(x.t, m, 'A', 3).length === 3 && E.teamCanField(x.t, m, 'A', 'a0', 3) === true,
    E.teamEligible(x.t, m, 'A', 3).map(v => v.id));
  ok('H5 规定场次内的限制不受影响（第 2 场仍然排不进红-1）',
    E.teamCanField(x.t, m, 'A', 'a0', 1) === false);

  // 加赛一场：红队胜
  E.teamSetSlot(m, 3, 'a0', 'b0');
  m.games.push({ s: 3, w: 'A', pa: 'a0', pb: 'b0' });
  r = E.evaluate(m, fmt, 'sudden_death');
  ok('H6 加赛一场定胜负：2:1 红队胜', r.settled === true && r.winner === 'A' && r.gamesA === 2, r);

  // draw_ok 阶段：1:1 直接判平局，不给加赛行
  const y = mkTeam({ mode: 'nvn', members: 3 });
  const fy = E.fmtOfMatch(y.t, y.t.stages[0], y.m);
  E.teamAutoLineup(y.t, y.m);
  y.m.games.push({ s: 0, w: 'A', pa: 'a0', pb: 'b0' });
  y.m.games.push({ s: 1, w: 'B', pa: 'a1', pb: 'b1' });
  y.m.games.push({ s: 2, w: 'D', pa: 'a2', pb: 'b2' });
  const ry = E.evaluate(y.m, fy, 'draw_ok');
  ok('H7 允许平局的阶段：1:1 直接判平，不标记加赛',
    ry.settled === true && ry.winner === null && y.m.overtime === false, ry);
}

/* ================= G. 旧存档迁移 ================= */
sec('G. 旧存档迁移');
{
  // v2.0 存档：games 有 s（盘号），没有 slots
  const t = M.createTournament('老赛事');
  t.team = { on: true, mode: 'nvn', size: 3, winNeeded: 0 };
  t.stages[0].roundsData = [{
    round: 0, matches: [{
      id: 'M1', playerA: 'TA', playerB: 'TB',
      games: [{ s: 0, w: 'A', pa: 'a0', pb: 'b0' }, { s: 1, w: 'B', pa: 'a1', pb: 'b1' }]
    }]
  }];
  const nt = S.normalize(t);
  const nm = nt.stages[0].roundsData[0].matches[0];
  ok('G1 补出 slots 数组', Array.isArray(nm.slots));
  ok('G2 场次号保留（0 / 1）', nm.games[0].s === 0 && nm.games[1].s === 1);
  ok('G3 旧数据照旧能判：2 场 1:1 还没打完',
    (function () {
      const fmt = E.fmtOfMatch(nt, nt.stages[0], nm);
      const r = E.evaluate(nm, fmt, 'draw_ok');
      return r.settled === false && r.gamesA === 1 && r.gamesB === 1;
    })());
  ok('G4 新增字段 playSize 默认 0（全场都上）', nt.team.playSize === 0, nt.team.playSize);
  ok('G5 没有 rounds 这种多余层级', nt.team.rounds === undefined);
}

console.log('\n============================');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
console.log('============================');
process.exit(fail ? 1 : 0);
