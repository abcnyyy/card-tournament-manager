/**
 * v1.10.0 引擎测试
 *  A. 继承小分扩展为「全部小分」（累计小分 / 净小分 / 赢局 / 输局 / 净胜局 / 对手分 / 累进分）
 *  B. 比赛计时器：开表 / 暂停 / 加时 / 归零 + 到点自动结算未打完的比赛
 *  C. 大比分设置中的「未打完」档位（u: 前缀）
 *  D. 旧存档兼容
 *  E. 导出的「未打完」标注
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
const { model: M, engine: E, util: U, store: S, exporter: X } = TMSW;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra === undefined ? '' : '  →  ' + JSON.stringify(extra))); }
}
function sec(t) { console.log('\n[' + t + ']'); }
function near(a, b, eps) { return Math.abs((+a || 0) - (+b || 0)) <= (eps === undefined ? 0.011 : eps); }

/* 建一个 n 人的赛事，返回 {t, st} */
function mk(n, type, opts) {
  const t = M.createTournament('T');
  for (let i = 1; i <= n; i++) t.players.push(M.createPlayer('P' + i, i));
  const a = M.defaultStage(0);
  a.type = type || 'swiss';
  Object.assign(a, opts || {});
  t.stages = [a];
  t.status = 'running';
  t.format.recordScore = true;
  E.ensureParticipants(t);
  return { t: t, st: a };
}
/* 第 1 轮全部按「A 胜、3:1 与 2:4」录完（有每局小分，便于统计累计小分） */
function playFirstRound(t, st) {
  t.currentStage = st.index;               // 生成对阵按「当前阶段」走
  if (!(st.participants || []).length) st.participants = t.players.map(p => p.id);
  E.ensureParticipants(t);
  const gen = E.generateRound(t);
  const rd = st.roundsData[0];
  if (!rd) throw new Error('生成对阵失败：' + JSON.stringify(gen));
  (rd.matches || []).forEach(function (m) {
    if (m.isBye) { E.evaluate(m, E.fmtOfMatch(t, st, m), st.tie); return; }
    m.games = [{ w: 'A', a: 3, b: 1 }, { w: 'A', a: 2, b: 4 }];
    E.evaluate(m, E.fmtOfMatch(t, st, m), st.tie);
  });
  return rd;
}

/* ========================= A. 全部小分继承 ========================= */
sec('A. 继承小分 = 全部小分');
(function () {
  const t = M.createTournament('INH');
  for (let i = 1; i <= 4; i++) t.players.push(M.createPlayer('P' + i, i));
  t.format.recordScore = true;
  const s0 = M.defaultStage(0); s0.type = 'swiss'; s0.participants = t.players.map(p => p.id);
  const s1 = M.defaultStage(1); s1.type = 'swiss';
  s1.inherit = { enabled: true, ratio: 100, fromStage: 0, tie: true };
  const s2 = M.defaultStage(2); s2.type = 'swiss';
  s2.inherit = { enabled: true, ratio: 100, fromStage: 1, tie: false };
  t.stages = [s0, s1, s2];
  t.status = 'running';
  E.ensureParticipants(t);
  playFirstRound(t, s0);

  const ids = s0.participants.slice();
  const st0 = E.buildStats(t, s0, ids, null);
  const st1 = E.buildStats(t, s1, ids, null);
  const st2 = E.buildStats(t, s2, ids, null);
  const id = ids[0];

  ok('A1 上一阶段统计含净小分 / 累进分', E.stageFinalStats(t, 0)[id].cumDiff !== undefined &&
    E.stageFinalStats(t, 0)[id].progressive !== undefined, E.stageFinalStats(t, 0)[id]);
  ok('A2 累计小分 100% 继承', near(st1[id].cumulative, st0[id].cumulative), [st1[id].cumulative, st0[id].cumulative]);
  ok('A3 净小分 100% 继承', near(st1[id].cumDiff, st0[id].cumDiff), [st1[id].cumDiff, st0[id].cumDiff]);
  ok('A4 赢局 100% 继承', near(st1[id].gamesWon, st0[id].gamesWon), [st1[id].gamesWon, st0[id].gamesWon]);
  ok('A5 输局 100% 继承', near(st1[id].gamesLost, st0[id].gamesLost), [st1[id].gamesLost, st0[id].gamesLost]);
  ok('A6 净胜局 100% 继承', near(st1[id].gamesDiff, st0[id].gamesDiff), [st1[id].gamesDiff, st0[id].gamesDiff]);
  ok('A7 对手分 100% 继承', near(st1[id].buchholz, st0[id].buchholz), [st1[id].buchholz, st0[id].buchholz]);
  ok('A8 累进分 100% 继承', near(st1[id].progressive, st0[id].progressive), [st1[id].progressive, st0[id].progressive]);
  ok('A9 继承值同时记在 carry* 字段', near(st1[id].carryCum, st0[id].cumulative) &&
    near(st1[id].carryCumDiff, st0[id].cumDiff) && near(st1[id].carryProgressive, st0[id].progressive));
  ok('A10 不勾「继承小分」时小分归零', near(st2[id].cumulative, 0) && near(st2[id].gamesWon, 0) &&
    near(st2[id].progressive, 0), [st2[id].cumulative, st2[id].progressive]);

  // 本阶段继续累加
  const rd1 = playFirstRound(t, s1);
  const st1b = E.buildStats(t, s1, ids, null);
  ok('A11 本阶段成绩叠加在继承值之上', st1b[id].gamesWon > st1[id].gamesWon &&
    st1b[id].cumulative > st1[id].cumulative, [st1b[id].cumulative, st1[id].cumulative]);
  ok('A12 每轮过后累进分继续累加', st1b[id].progressive > st1[id].progressive,
    [st1b[id].progressive, st1[id].progressive]);

  // 净小分：两个选手的继承值不同，不应互相抵消
  const p1 = ids[0], p2 = ids[2];
  const diffNow = st1[p1].cumDiff - st1[p2].cumDiff;
  const diffOld = st0[p1].cumDiff - st0[p2].cumDiff;
  ok('A13 净小分继承后仍保留相对差', near(diffNow, diffOld), [diffNow, diffOld]);

  // 50% 折算
  const t2s0 = M.defaultStage(0); t2s0.type = 'swiss';
  const t2s1 = M.defaultStage(1); t2s1.type = 'swiss';
  t2s1.inherit = { enabled: true, ratio: 50, fromStage: 0, tie: true };
  const t2 = M.createTournament('R50');
  for (let i = 1; i <= 4; i++) t2.players.push(M.createPlayer('Q' + i, i));
  t2.format.recordScore = true;
  t2s0.participants = t2.players.map(p => p.id);
  t2.stages = [t2s0, t2s1]; t2.status = 'running';
  E.ensureParticipants(t2);
  playFirstRound(t2, t2s0);
  const q = t2s0.participants[0];
  const f0 = E.stageFinalStats(t2, 0)[q];
  const g1 = E.buildStats(t2, t2s1, t2s0.participants.slice(), null)[q];
  ok('A14 50% 比例对小分同样生效（累计小分）', near(g1.cumulative, f0.cumulative * 0.5), [g1.cumulative, f0.cumulative]);
  ok('A15 50% 比例对小分同样生效（累进分）', near(g1.progressive, f0.progressive * 0.5), [g1.progressive, f0.progressive]);
  ok('A16 50% 比例对小分同样生效（净小分）', near(g1.cumDiff, f0.cumDiff * 0.5), [g1.cumDiff, f0.cumDiff]);
})();

/* ========================= B. 计时器 ========================= */
sec('B. 比赛计时器');
(function () {
  const { t, st } = mk(4, 'swiss');
  const cfg = E.tmCfg(t);
  ok('B1 计时器默认关闭、30 分钟、到点自动结算', !cfg.enabled && cfg.minutes === 30 && cfg.autoSettle === true);
  ok('B2 限时换算成秒', E.tmLimitSec(t, 20) === 1200 && E.tmLimitSec(t) === 1800);

  t.timer = { enabled: true, minutes: 20, autoSettle: true, tieAction: 'draw' };
  const rd = playFirstRound(t, st);
  st.roundsData[0] = rd;
  const m = rd.matches[0];
  m.games = [{ w: 'A', a: 1, b: 0 }];      // 一局没打完：A 1:0 领先
  E.evaluate(m, E.fmtOfMatch(t, st, m), st.tie);
  ok('B3 只打 1 局时比赛未结束', !m.decided);

  let s = E.tmStart(m, 600, 1000);
  ok('B4 开表后 running = true，剩余 600 秒', s.running && s.remain === 600, s);
  s = E.tmState(m, 31000);
  ok('B5 走表 30 秒后剩余 570 秒', s.remain === 570, s);
  s = E.tmPause(m, 31000);
  ok('B6 暂停后 elapsed 冻结在 30 秒', !s.running && s.elapsed === 30, s);
  s = E.tmState(m, 90000);
  ok('B7 暂停期间不再走表', s.remain === 570, s);
  s = E.tmStart(m, 600, 90000);
  ok('B8 继续后重新走表', s.running);
  m.tm.limit = m.tm.limit + 300;          // 模拟「+5 分钟」
  s = E.tmState(m, 90000);
  ok('B9 加时后剩余时间变长', s.remain === 870, s);
  s = E.tmReset(m, 600);
  ok('B10 归零后回到 600 秒', s.remain === 600 && !s.running, s);

  // 到点自动结算
  E.tmRestart(m, 60, 10000);
  let done = E.tmTick(t, 40000);
  ok('B11 未到点不结算', done.length === 0 && !m.decided);
  done = E.tmTick(t, 80000);
  ok('B12 到点自动结算 1 场', done.length === 1 && m.decided, done);
  ok('B13 领先方获胜', m.result.winner === 'A', m.result);
  ok('B14 结果标记 unfinished + endReason=timeout',
    m.result.unfinished === true && m.result.endReason === 'timeout', m.result);
  ok('B15 大比分保留到收场时的局数', m.result.gamesA === 1 && m.result.gamesB === 0, m.result);
  ok('B16 结算后计时器收表', !E.tmState(m, 80000).running);

  // 再 tick 一次不会重复结算
  const again = E.tmTick(t, 90000);
  ok('B17 已结算的比赛不会被重复结算', again.length === 0);

  // 未打完的成绩要计入战绩
  const stats = E.buildStats(t, st, st.participants.slice(), null);
  ok('B18 未打完按实际胜负计入战绩', stats[m.playerA].wins >= 1 && stats[m.playerA].matches >= 1,
    { wins: stats[m.playerA].wins, matches: stats[m.playerA].matches });
  rd.matches.forEach(function (x) {
    if (x.isBye || x.decided) return;
    E.settleUnfinished(t, st, x, { reason: 'manual' });
  });
  ok('B19 全部场次按未打完结算后，本轮可正常结算', E.roundComplete(t, st, rd).ok === true);

  // 平分 + 记平局（瑞士轮）
  const t3 = mk(4, 'swiss');
  t3.t.timer = { enabled: true, minutes: 10, autoSettle: true, tieAction: 'draw' };
  const rd3 = playFirstRound(t3.t, t3.st);
  const m3 = rd3.matches[0];
  m3.games = [{ w: 'A', a: 1, b: 0 }, { w: 'B', a: 0, b: 1 }];
  E.evaluate(m3, E.fmtOfMatch(t3.t, t3.st, m3), t3.st.tie);
  E.tmStart(m3, 60, 0);
  E.tmTick(t3.t, 70000);
  ok('B20 平分 + 记为平局 → winner 为 null', m3.decided && m3.result.winner === null, m3.result);
  ok('B21 平局的未打完同样带 unfinished 标记', m3.result.unfinished === true);

  // 平分 + keep（继续打，不结算）
  const t4 = mk(4, 'swiss');
  t4.t.timer = { enabled: true, minutes: 10, autoSettle: true, tieAction: 'keep' };
  const rd4 = playFirstRound(t4.t, t4.st);
  const m4 = rd4.matches[0];
  m4.games = [{ w: 'A', a: 1, b: 0 }, { w: 'B', a: 0, b: 1 }];
  E.evaluate(m4, E.fmtOfMatch(t4.t, t4.st, m4), t4.st.tie);
  E.tmStart(m4, 60, 0);
  const d4 = E.tmTick(t4.t, 70000);
  ok('B22 平分 + 继续打 → 不自动结算', d4.length === 0 && !m4.decided, m4.result);

  // 淘汰赛平分：必须有人晋级 → 按种子号
  const t5 = mk(8, 'single_elim');
  t5.t.timer = { enabled: true, minutes: 10, autoSettle: true, tieAction: 'draw' };
  E.generateRound(t5.t);
  const rd5 = t5.st.roundsData[0];
  const m5 = rd5.matches[0];
  m5.games = [{ w: 'A', a: 1, b: 0 }, { w: 'B', a: 0, b: 1 }];
  E.evaluate(m5, E.fmtOfMatch(t5.t, t5.st, m5), t5.st.tie);
  E.tmStart(m5, 60, 0);
  E.tmTick(t5.t, 70000);
  const seedA = t5.t.players.filter(p => p.id === m5.playerA)[0].seed;
  const seedB = t5.t.players.filter(p => p.id === m5.playerB)[0].seed;
  const expect = seedA <= seedB ? 'A' : 'B';
  ok('B23 淘汰赛平分按种子号判定（一定有人晋级）', m5.decided && m5.result.winner === expect,
    { winner: m5.result.winner, seedA: seedA, seedB: seedB });

  // autoSettle = false：到点不自动结算
  const t6 = mk(4, 'swiss');
  t6.t.timer = { enabled: true, minutes: 10, autoSettle: false, tieAction: 'draw' };
  const rd6 = playFirstRound(t6.t, t6.st);
  const m6 = rd6.matches[0];
  m6.games = [{ w: 'A', a: 1, b: 0 }];
  E.evaluate(m6, E.fmtOfMatch(t6.t, t6.st, m6), t6.st.tie);
  E.tmStart(m6, 60, 0);
  const d6 = E.tmTick(t6.t, 70000);
  ok('B24 关闭「到点自动结算」时只提醒不结算', d6.length === 0 && !m6.decided);
  ok('B25 到点但未结算时 expired = true', E.tmState(m6, 70000).expired === true);

  // 已经打完的比赛：计时器不再结算
  const t7 = mk(4, 'swiss');
  t7.t.timer = { enabled: true, minutes: 10, autoSettle: true, tieAction: 'draw' };
  const rd7 = playFirstRound(t7.t, t7.st);
  const m7 = rd7.matches[0];
  const before = JSON.stringify(m7.result);
  E.tmStart(m7, 60, 0);
  E.tmTick(t7.t, 70000);
  ok('B26 已正常打完的比赛不会被计时器改写', JSON.stringify(m7.result) === before, m7.result);

  // 手动「按未打完结算」
  const t8 = mk(4, 'swiss');
  t8.t.format = { gamesPerMatch: 5, winNeeded: 3, recordScore: true };
  const rd8 = playFirstRound(t8.t, t8.st);
  const m8 = rd8.matches[0];
  m8.games = [{ w: 'B', a: 0, b: 1 }, { w: 'A', a: 1, b: 0 }, { w: 'A', a: 1, b: 0 }];
  E.evaluate(m8, E.fmtOfMatch(t8.t, t8.st, m8), t8.st.tie);
  ok('B27a BO5 打到 2:1 时比赛尚未结束', !m8.decided);
  const r8 = E.settleUnfinished(t8.t, t8.st, m8, { reason: 'manual' });
  ok('B27 手动结算未打完：按当前比分歧胜', r8.ok && m8.result.winner === 'A' && r8.a === 2 && r8.b === 1, r8);
  const r8b = E.settleUnfinished(t8.t, t8.st, m8, {});
  ok('B28 已结出胜负的比赛不能重复结算', r8b.ok === false, r8b);
})();

/* ========================= C. 未打完档位 ========================= */
sec('C. 大比分设置中的「未打完」档位');
(function () {
  const l3 = E.scoreUnfinishedLines({ gamesPerMatch: 3, winNeeded: 2 }).map(x => x.key);
  ok('C1 BO3（先赢 2 局）未打完档位 = 1-1 / 1-0 / 0-0',
    l3.join(',') === 'u:1-1,u:1-0,u:0-0', l3);
  const l1 = E.scoreUnfinishedLines({ gamesPerMatch: 1, winNeeded: 1 }).map(x => x.key);
  ok('C2 BO1 只有 0-0 是未打完', l1.join(',') === 'u:0-0', l1);
  const lf = E.scoreUnfinishedLines({ gamesPerMatch: 3, winNeeded: 0 }).map(x => x.key);
  ok('C3 打满 3 局制：未打完不含已打满的比分', lf.indexOf('u:3-0') < 0 && lf.indexOf('u:2-1') < 0 &&
    lf.indexOf('u:2-0') >= 0, lf);
  const l5 = E.scoreUnfinishedLines({ gamesPerMatch: 5, winNeeded: 3 }).map(x => x.key);
  ok('C4 BO5（先赢 3 局）未打完含 2-2', l5.indexOf('u:2-2') >= 0 && l5.indexOf('u:3-0') < 0, l5);

  // scoreline 计分：未打完优先用 u: 档
  const t = M.createTournament('SC');
  for (let i = 1; i <= 4; i++) t.players.push(M.createPlayer('P' + i, i));
  const st = M.defaultStage(0); st.type = 'swiss'; st.participants = t.players.map(p => p.id);
  t.stages = [st]; t.status = 'running';
  t.scoring.mode = 'scoreline';
  t.scoring.scoreTable = {
    '2-0': { w: 3, l: 0 },
    '2-1': { w: 2, l: 1 },
    'u:1-0': { w: 1, l: 0 },
    'u:1-1': { d: 0.5 },
    'u:0-0': { d: 0 }
  };
  E.ensureParticipants(t);
  E.generateRound(t);
  const m = st.roundsData[0].matches[0];
  const fmt = E.fmtOfMatch(t, st, m), sc = E.scOf(t, st);

  m.games = [{ w: 'A', a: 1, b: 0 }];
  m.result = { winner: 'A', gamesA: 1, gamesB: 0, draws: 0, settled: true, unfinished: true, endReason: 'timeout' };
  ok('C5 未打完 1-0：领先方取 u:1-0 的「领先方得」', E.pointsFrom(m, 'A', sc, fmt) === 1, E.pointsFrom(m, 'A', sc, fmt));
  ok('C6 未打完 1-0：落后方取 u:1-0 的「落后方得」', E.pointsFrom(m, 'B', sc, fmt) === 0);

  m.result = { winner: null, gamesA: 1, gamesB: 1, draws: 0, settled: true, unfinished: true };
  ok('C7 未打完 1-1：双方各得 u:1-1 的 d 值', E.pointsFrom(m, 'A', sc, fmt) === 0.5 &&
    E.pointsFrom(m, 'B', sc, fmt) === 0.5, [E.pointsFrom(m, 'A', sc, fmt), E.pointsFrom(m, 'B', sc, fmt)]);

  m.result = { winner: null, gamesA: 0, gamesB: 0, draws: 0, settled: true, unfinished: true };
  ok('C8 未打完 0-0：按 u:0-0 记 0 分', E.pointsFrom(m, 'A', sc, fmt) === 0 && E.pointsFrom(m, 'B', sc, fmt) === 0);

  // 没有设置 u: 档 → 退回同一比分档位
  delete t.scoring.scoreTable['u:1-0'];
  m.result = { winner: 'A', gamesA: 1, gamesB: 0, draws: 0, settled: true, unfinished: true };
  t.scoring.scoreTable['1-0'] = { w: 2, l: 0 };
  ok('C9 没设未打完档位时退回同比分档', E.pointsFrom(m, 'A', sc, fmt) === 2, E.pointsFrom(m, 'A', sc, fmt));
  delete t.scoring.scoreTable['1-0'];
  ok('C10 都没有时退回胜负兜底分值', E.pointsFrom(m, 'A', sc, fmt) === sc.win, E.pointsFrom(m, 'A', sc, fmt));

  // 正常打满的比赛不受未打完档影响
  m.result = { winner: 'A', gamesA: 2, gamesB: 0, draws: 0, settled: true };
  ok('C11 正常比分走原档位（2-0 → 3 分）', E.pointsFrom(m, 'A', sc, fmt) === 3, E.pointsFrom(m, 'A', sc, fmt));

  // 未打完的场次进入排名
  const t2 = mkLite();
  function mkLite() {
    const tt = M.createTournament('RANK');
    for (let i = 1; i <= 4; i++) tt.players.push(M.createPlayer('R' + i, i));
    const ss = M.defaultStage(0); ss.type = 'swiss'; ss.participants = tt.players.map(p => p.id);
    tt.stages = [ss]; tt.status = 'running'; tt.format.recordScore = true;
    E.ensureParticipants(tt); E.generateRound(tt);
    return { t: tt, st: ss };
  }
  const mm = t2.st.roundsData[0].matches[0];
  mm.games = [{ w: 'A', a: 2, b: 0 }];
  E.settleUnfinished(t2.t, t2.st, mm, {});
  const stand = E.standings(t2.t, { stageIndex: 0 });
  const sA = stand.filter(x => x.id === mm.playerA)[0];
  const sB = stand.filter(x => x.id === mm.playerB)[0];
  ok('C12 未打完的胜方在排名里记 1 胜', sA.wins === 1, { wins: sA.wins, pts: sA.points });
  ok('C13 未打完的负方在排名里记 1 负', sB.losses === 1);
  ok('C14 未打完的场次计入已赛场次', sA.matches === 1 && sB.matches === 1);
})();

/* ========================= D. 兼容性 ========================= */
sec('D. 旧存档兼容');
(function () {
  const t = M.createTournament('OLD');
  delete t.timer;
  S.normalize(t);
  ok('D1 旧存档自动补齐 timer 字段', !!t.timer && t.timer.minutes === 30 && t.timer.autoSettle === true, t.timer);

  t.timer = { enabled: 'yes', minutes: 0, autoSettle: 0, tieAction: 'bogus' };
  S.normalize(t);
  ok('D2 非法 timer 值被纠正', t.timer.minutes === 30 && t.timer.tieAction === 'draw', t.timer);

  const t2 = M.createTournament('UNF');
  for (let i = 1; i <= 4; i++) t2.players.push(M.createPlayer('P' + i, i));
  const st = M.defaultStage(0); st.type = 'swiss'; st.participants = t2.players.map(p => p.id);
  t2.stages = [st]; t2.status = 'running';
  E.ensureParticipants(t2); E.generateRound(t2);
  const m = st.roundsData[0].matches[0];
  m.result = { winner: null, gamesA: 0, gamesB: 0, draws: 0, settled: true, unfinished: true };
  m.decided = true;
  S.normalize(t2);
  ok('D3 0 局的「未打完」结果不被当成脏数据清掉', !!st.roundsData[0].matches[0].result &&
    st.roundsData[0].matches[0].result.unfinished === true);

  const m2 = st.roundsData[0].matches[1];
  m2.result = { winner: null, gamesA: 0, gamesB: 0, draws: 0, settled: true };
  m2.decided = true;
  S.normalize(t2);
  ok('D4 旧的 0:0 脏数据仍会被清掉', st.roundsData[0].matches[1].result === null);
})();

/* ========================= E. 导出标注 ========================= */
sec('E. 导出标注');
(function () {
  const t = M.createTournament('EXP');
  for (let i = 1; i <= 4; i++) t.players.push(M.createPlayer('P' + i, i));
  const st = M.defaultStage(0); st.type = 'swiss'; st.participants = t.players.map(p => p.id);
  t.stages = [st]; t.currentStage = 0; t.status = 'running';
  E.ensureParticipants(t); E.generateRound(t);
  const m = st.roundsData[0].matches[0];
  m.games = [{ w: 'A', a: 1, b: 0 }];
  E.settleUnfinished(t, st, m, { reason: 'timeout' });

  const html = X.matchupsHTML(t, { stageIndex: 0 });
  ok('E1 打印 / PDF 对阵表标注「未打完」', html.indexOf('未打完') >= 0);
  const csv = X.matchupsCSV(t, { stageIndex: 0 });
  ok('E2 CSV 状态列标注未打完', csv.indexOf('未打完') >= 0);
})();

console.log('\n========================================');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
console.log('========================================');
if (fail) process.exit(1);
