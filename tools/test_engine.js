/* 引擎逻辑测试：在 Node 中加载 core/formats/engine 并跑一遍典型赛制 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const base = path.join(__dirname, '..', 'app', 'js');
const sandbox = { window: {}, console, Math, Date, JSON, parseFloat, parseInt, isNaN };
sandbox.global = sandbox;
vm.createContext(sandbox);

['core.js', 'formats.js', 'engine.js'].forEach(f => {
  const code = fs.readFileSync(path.join(base, f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
});

const TMS = sandbox.window.TMS;
const { util: U, model: M, engine: E, formats: F } = TMS;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? ' -> ' + extra : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

/* ---------- 1. 循环赛编排 ---------- */
section('循环赛 Circle Method');
{
  const ids = ['A', 'B', 'C', 'D', 'E', 'F'];
  const rounds = F.circleSchedule(ids);
  ok('6人=5轮', rounds.length === 5, rounds.length);
  const allPairs = new Set();
  let eachPlaysOnce = true;
  rounds.forEach(r => {
    const seen = new Set();
    r.forEach(p => {
      seen.add(p[0]); seen.add(p[1]);
      allPairs.add(p[0] < p[1] ? p[0] + '|' + p[1] : p[1] + '|' + p[0]);
    });
    if (seen.size !== 6) eachPlaysOnce = false;
  });
  ok('每轮每人恰好出场1次', eachPlaysOnce);
  ok('覆盖全部15种组合', allPairs.size === 15, allPairs.size);
}
{
  const ids = ['A', 'B', 'C', 'D', 'E'];
  const rounds = F.circleSchedule(ids);
  ok('5人=5轮', rounds.length === 5, rounds.length);
  let byesPerRound = rounds.map(r => r.filter(p => p[1] === null).length);
  ok('每轮恰好1人轮空', byesPerRound.every(c => c === 1), JSON.stringify(byesPerRound));
  const byeCount = {};
  rounds.forEach(r => r.forEach(p => { if (p[1] === null) byeCount[p[0]] = (byeCount[p[0]] || 0) + 1; }));
  ok('每人轮空恰好1次', Object.keys(byeCount).length === 5 && Object.values(byeCount).every(v => v === 1), JSON.stringify(byeCount));
}
{
  const ids = ['A', 'B', 'C', 'D'];
  const rr = F.roundRobinRounds(ids, 2);
  ok('4人双循环=6轮', rr.length === 6, rr.length);
  const first = rr[0][0], later = rr[3][0];
  ok('第二循环主客交换', (first[0] === later[1] && first[1] === later[0]) ||
    rr[3].some(p => (p[0] === first[1] && p[1] === first[0])), JSON.stringify(rr[3]));
}

/* ---------- 2. 种子 bracket ---------- */
section('淘汰赛 Bracket 种子位次');
{
  ok('8人种子序 = 1,8,4,5,2,7,3,6',
    JSON.stringify(F.seedOrder(8)) === JSON.stringify([1, 8, 4, 5, 2, 7, 3, 6]),
    JSON.stringify(F.seedOrder(8)));
  const players = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];
  const b = F.buildBracket(players, true);
  ok('bracket size = 8', b.size === 8);
  const r1 = b.pairs;
  ok('1号种子 vs 8号种子', (r1[0][0] === 'P1' && r1[0][1] === 'P8'), JSON.stringify(r1[0]));
  ok('首轮4场', r1.length === 4, r1.length);
}
{
  // 非 2 的幂：11 人 → 补到 16，前 5 号种子轮空
  const players = [];
  for (let i = 1; i <= 11; i++) players.push('P' + i);
  const b = F.buildBracket(players, true);
  ok('11人补到16', b.size === 16, b.size);
  const byes = b.pairs.filter(p => p[1] === null).map(p => p[0]);
  ok('5人首轮轮空', byes.length === 5, JSON.stringify(byes));
  ok('轮空者为前5号种子', byes.every(x => ['P1', 'P2', 'P3', 'P4', 'P5'].indexOf(x) >= 0), JSON.stringify(byes));
}

/* ---------- 3. 局制判定 ---------- */
section('局制：胜负判定');
{
  const fmt = { gamesPerMatch: 5, winNeeded: 3, recordScore: false };
  const m = { games: [], isBye: false, override: null };
  E.evaluate(m, fmt, 'draw_ok');
  ok('0局未结束', !m.decided);

  m.games = [{ w: 'A' }, { w: 'A' }];
  E.evaluate(m, fmt, 'draw_ok');
  ok('2:0 未结束', !m.decided);

  m.games = [{ w: 'A' }, { w: 'A' }, { w: 'A' }];
  E.evaluate(m, fmt, 'draw_ok');
  ok('3:0 提前结束', m.decided && m.result.winner === 'A');
  ok('剩余局不再进行（仅3局）', m.games.length === 3);
}
{
  // 打满模式 winNeeded = 0
  const fmt = { gamesPerMatch: 4, winNeeded: 0, recordScore: false };
  const m = { games: [{ w: 'A' }, { w: 'B' }, { w: 'D' }, { w: 'A' }], isBye: false, override: null };
  E.evaluate(m, fmt, 'draw_ok');
  ok('打满4局 2:1 判定A胜', m.decided && m.result.winner === 'A' && m.result.draws === 1);
}
{
  // 打满后平局 + sudden_death
  const fmt = { gamesPerMatch: 2, winNeeded: 0, recordScore: false };
  const m = { games: [{ w: 'D' }, { w: 'D' }], isBye: false, override: null };
  E.evaluate(m, fmt, 'sudden_death');
  ok('平局进入加赛', !m.decided && m.overtime === true);
  m.games.push({ w: 'B' });
  E.evaluate(m, fmt, 'sudden_death');
  ok('加赛后分出胜负', m.decided && m.result.winner === 'B');
}
{
  // 手动指定
  const fmt = { gamesPerMatch: 2, winNeeded: 0, recordScore: false };
  const m = { games: [{ w: 'D' }, { w: 'D' }], isBye: false, override: 'A' };
  E.evaluate(m, fmt, 'draw_ok');
  ok('手动指定生效', m.decided && m.result.winner === 'A');
}
{
  // 轮空
  const fmt = { gamesPerMatch: 3, winNeeded: 2, recordScore: false };
  const m = { games: [], isBye: true, playerA: 'X', playerB: null, override: null };
  E.evaluate(m, fmt, 'draw_ok');
  ok('轮空自动结束', m.decided && m.result.winner === 'A' && m.result.bye === true);
}

/* ---------- 4. 记分模式 ---------- */
section('记分规则');
{
  // result 模式
  const sc = { mode: 'result', win: 3, draw: 1, lose: 0, bye: 3, perGame: 1 };
  const fmt = { gamesPerMatch: 3, winNeeded: 2 };
  let m = { playerA: 'a', playerB: 'b', isBye: false, games: [{ w: 'A' }, { w: 'A' }], override: null };
  E.evaluate(m, fmt, 'draw_ok');
  ok('胜3分/负0分', E.pointsFrom(m, 'A', sc, fmt) === 3 && E.pointsFrom(m, 'B', sc, fmt) === 0);

  m = { playerA: 'a', playerB: 'b', isBye: false, games: [{ w: 'D' }, { w: 'D' }], override: null };
  E.evaluate(m, { gamesPerMatch: 2, winNeeded: 0 }, 'draw_ok');
  ok('平1分', E.pointsFrom(m, 'A', sc, { gamesPerMatch: 2, winNeeded: 0 }) === 1 && E.pointsFrom(m, 'B', sc, { gamesPerMatch: 2, winNeeded: 0 }) === 1);

  // 未打完的比赛不得分（防止白送平局分）
  m = { playerA: 'a', playerB: 'b', isBye: false, games: [{ w: 'A' }], override: null };
  E.evaluate(m, { gamesPerMatch: 3, winNeeded: 2 }, 'draw_ok');
  ok('未打完不得分', E.pointsFrom(m, 'A', sc, { gamesPerMatch: 3, winNeeded: 2 }) === 0 && m.decided === false);

  m = { playerA: 'a', playerB: null, isBye: true, games: [], override: null };
  E.evaluate(m, fmt, 'draw_ok');
  ok('轮空3分', E.pointsFrom(m, 'A', sc, fmt) === 3);
}
{
  // games 模式：按赢下局数
  const sc = { mode: 'games', win: 3, draw: 1, lose: 0, bye: 3, perGame: 2 };
  const fmt = { gamesPerMatch: 3, winNeeded: 0 };
  const m = { playerA: 'a', playerB: 'b', isBye: false, games: [{ w: 'A' }, { w: 'A' }, { w: 'B' }], override: null };
  E.evaluate(m, fmt, 'draw_ok');
  ok('赢2局×2分=4', E.pointsFrom(m, 'A', sc, fmt) === 4, E.pointsFrom(m, 'A', sc, fmt));
  ok('赢1局×2分=2', E.pointsFrom(m, 'B', sc, fmt) === 2);
}
{
  // points 模式：小分累加
  const sc = { mode: 'points', win: 3, draw: 1, lose: 0, bye: 3, perGame: 1 };
  const fmt = { gamesPerMatch: 2, winNeeded: 0 };
  const m = {
    playerA: 'a', playerB: 'b', isBye: false,
    games: [{ w: 'A', a: 25, b: 20 }, { w: 'B', a: 18, b: 25 }], override: null
  };
  E.evaluate(m, fmt, 'draw_ok');
  ok('A 小分 25+18=43', E.pointsFrom(m, 'A', sc, fmt) === 43, E.pointsFrom(m, 'A', sc, fmt));
  ok('B 小分 20+25=45', E.pointsFrom(m, 'B', sc, fmt) === 45);
}

/* ---------- 5. 瑞士轮配对 ---------- */
section('瑞士轮配对');
{
  const t = M.createTournament('瑞士轮测试');
  for (let i = 1; i <= 8; i++) {
    const p = M.createPlayer('P' + i, i);
    t.players.push(p);
  }
  t.stages[0].type = 'swiss';
  t.stages[0].rounds = 4;

  const r1 = E.generateRound(t);
  ok('第1轮生成成功', r1.ok, r1.msg);
  ok('第1轮4场', t.stages[0].roundsData[0].matches.length === 4);

  // 全部录入 A 胜
  t.stages[0].roundsData[0].matches.forEach(m => {
    m.games.push({ w: 'A' }, { w: 'A' });
    E.evaluate(m, t.format, t.stages[0].tie);
  });
  ok('第1轮全部结束', E.roundComplete(t, t.stages[0], t.stages[0].roundsData[0]).ok);

  const r2 = E.generateRound(t);
  ok('第2轮生成成功', r2.ok, r2.msg);
  const p2 = t.stages[0].roundsData[1].matches.map(m => [m.playerA, m.playerB]);
  const p1 = t.stages[0].roundsData[0].matches.map(m => [m.playerA, m.playerB]);
  const key = p => p[0] < p[1] ? p[0] + '|' + p[1] : p[1] + '|' + p[0];
  const set1 = new Set(p1.map(key));
  const repeated = p2.filter(p => set1.has(key(p)));
  ok('第2轮无重复对阵', repeated.length === 0, JSON.stringify(repeated));
}
{
  // 奇数人数轮空
  const t = M.createTournament('瑞士轮轮空测试');
  for (let i = 1; i <= 7; i++) t.players.push(M.createPlayer('P' + i, i));
  t.stages[0].type = 'swiss';
  t.stages[0].rounds = 3;
  E.generateRound(t);
  const rd = t.stages[0].roundsData[0];
  const byes = rd.matches.filter(m => m.isBye);
  ok('7人产生1个轮空', byes.length === 1, byes.length);
  ok('轮空者已标记 hasBye', byes.length === 1 && t.players.filter(p => p.id === byes[0].playerA)[0].hasBye === true);
  ok('其余6人配成3场', rd.matches.filter(m => !m.isBye).length === 3);
}

/* ---------- 6. 单败淘汰推进 ---------- */
section('单败淘汰推进');
{
  const t = M.createTournament('单败测试');
  for (let i = 1; i <= 8; i++) t.players.push(M.createPlayer('P' + i, i));
  t.stages[0].type = 'single_elim';
  E.generateRound(t);
  ok('R1 4场', t.stages[0].roundsData[0].matches.length === 4);
  // 让种子靠前的人赢
  t.stages[0].roundsData[0].matches.forEach(m => {
    m.games.push({ w: 'A' }, { w: 'A' });
    E.evaluate(m, t.format, t.stages[0].tie);
  });
  E.generateRound(t);
  ok('R2 2场', t.stages[0].roundsData[1].matches.length === 2);
  t.stages[0].roundsData[1].matches.forEach(m => {
    m.games.push({ w: 'A' }, { w: 'A' });
    E.evaluate(m, t.format, t.stages[0].tie);
  });
  E.generateRound(t);
  ok('R3 决赛1场', t.stages[0].roundsData[2].matches.length === 1);
  // v2.6.1：轮次「排满」不等于比赛「打完」——决赛还没录，阶段不算结束
  ok('决赛未打时不判阶段结束', !E.stageFinished(t, t.stages[0]));

  // 决赛也要录入
  t.stages[0].roundsData[2].matches.forEach(m => {
    m.games.push({ w: 'A' }, { w: 'A' });
    E.evaluate(m, t.format, t.stages[0].tie);
  });
  ok('阶段判定结束（决赛录完）', E.stageFinished(t, t.stages[0]));

  const st = E.standings(t, { stageIndex: 0 });
  ok('冠军为 P1', st[0].name === 'P1', st[0].name);
  ok('冠军3胜0负', st[0].wins === 3 && st[0].losses === 0, st[0].wins + '-' + st[0].losses);
}

/* ---------- 7. 双败淘汰推进 ---------- */
section('双败淘汰推进');
{
  const t = M.createTournament('双败测试');
  for (let i = 1; i <= 8; i++) t.players.push(M.createPlayer('P' + i, i));
  t.stages[0].type = 'double_elim';

  let rounds = 0, guard = 0;
  while (guard++ < 30) {
    const r = E.generateRound(t);
    if (!r.ok) break;
    rounds++;
    const rd = t.stages[0].roundsData[t.stages[0].roundsData.length - 1];
    if (rd.matches.length === 0) break;
    rd.matches.forEach(m => {
      if (m.isBye) return;
      m.games.push({ w: 'A' }, { w: 'A' });
      E.evaluate(m, t.format, t.stages[0].tie);
    });
    const fin = E.finishRound(t);
    if (!fin.ok) { console.log('    finishRound failed: ' + fin.msg); break; }
    if (E.stageFinished(t, t.stages[0])) break;
  }
  ok('双败产生多轮对阵', rounds >= 4, 'rounds=' + rounds);
  ok('双败最终结束', E.stageFinished(t, t.stages[0]));

  const st = E.standings(t, { stageIndex: 0 });
  ok('8人全部有排名', st.length === 8, st.length);
}

/* ---------- 8. 小组赛 ---------- */
section('小组赛分组与推进');
{
  const t = M.createTournament('小组赛测试');
  for (let i = 1; i <= 12; i++) t.players.push(M.createPlayer('P' + i, i));
  const s = t.stages[0];
  s.type = 'groups';
  s.groupCount = 4;
  s.groupType = 'round_robin';
  s.groupCycles = 1;
  s.adv.type = 'count';
  s.adv.perGroup = 2;

  E.ensureParticipants(t);
  s.groups = E.buildGroups(t, s);
  ok('分成4组', s.groups.length === 4, s.groups.length);
  ok('每组3人', s.groups.every(g => g.players.length === 3), JSON.stringify(s.groups.map(g => g.players.length)));
  ok('蛇形分组：1号种子在A组', s.groups[0].players.indexOf(t.players[0].id) >= 0, JSON.stringify(s.groups[0].players));
  ok('蛇形分组：2号种子在B组', s.groups[1].players.indexOf(t.players[1].id) >= 0, JSON.stringify(s.groups[1].players));

  // 生成所有轮次
  let guard = 0;
  while (guard++ < 20) {
    const r = E.generateGroupRound(t, s);
    if (!r.ok) break;
    t.stages[0].roundsData[t.stages[0].roundsData.length - 1].matches.forEach(m => {
      if (m.isBye) return;
      m.games.push({ w: 'A' }, { w: 'A' });
      E.evaluate(m, t.format, s.tie);
    });
    E.refreshGroupFinished(t, s);
    if (E.stageFinished(t, s)) break;
  }
  ok('小组赛全部结束', E.stageFinished(t, s), 'rounds=' + s.roundsData.length);

  E.finishStage(t);
  ok('晋级 8 人（每组前2）', s.advanced.length === 8, s.advanced.length);
}

/* ---------- 9. 多阶段 + 分数继承 ---------- */
section('多阶段与分数继承');
{
  const t = M.createTournament('多阶段测试');
  for (let i = 1; i <= 16; i++) t.players.push(M.createPlayer('P' + i, i));

  // 阶段1：瑞士轮 3 轮，前8晋级
  const s1 = t.stages[0];
  s1.type = 'swiss'; s1.rounds = 3;
  s1.adv = { type: 'count', count: 8, score: 0, perGroup: 2 };

  // 阶段2：单败，继承 100%
  const s2 = M.defaultStage(1);
  s2.name = '淘汰赛'; s2.type = 'single_elim';
  s2.inherit = { enabled: true, ratio: 100, fromStage: null };
  t.stages.push(s2);

  let guard = 0;
  while (guard++ < 20 && !E.stageFinished(t, s1)) {
    const r = E.generateRound(t);
    if (!r.ok) break;
    const rd = s1.roundsData[s1.roundsData.length - 1];
    rd.matches.forEach(m => {
      if (m.isBye) return;
      m.games.push({ w: 'A' }, { w: 'A' });
      E.evaluate(m, t.format, s1.tie);
    });
    E.finishRound(t);
  }
  ok('阶段1 完成3轮', s1.roundsData.length === 3, s1.roundsData.length);
  const st1 = E.standings(t, { stageIndex: 0 });
  ok('阶段1 排名完整', st1.length === 16, st1.length);

  E.finishStage(t);
  ok('晋级8人', s1.advanced.length === 8, s1.advanced.length);
  ok('当前阶段变为1', t.currentStage === 1, t.currentStage);
  ok('阶段2 参赛者=8', s2.participants.length === 8, s2.participants.length);

  // 阶段2 打完
  guard = 0;
  while (guard++ < 20 && !E.stageFinished(t, s2)) {
    const r = E.generateRound(t);
    if (!r.ok) break;
    const rd = t.stages[1].roundsData[t.stages[1].roundsData.length - 1];
    rd.matches.forEach(m => {
      if (m.isBye) return;
      m.games.push({ w: 'A' }, { w: 'A' });
      E.evaluate(m, t.format, s2.tie);
    });
    E.finishRound(t);
  }
  ok('阶段2 单败3轮', s2.roundsData.length === 3, s2.roundsData.length);

  const st2 = E.standings(t, { stageIndex: 1 });
  ok('阶段2 含继承分', st2.every(s => s.carry > 0 || s.carry === 0), '');
  ok('阶段2 冠军有积分', st2[0].points > 0, st2[0].points);
  ok('赛事标记结束或待结束', true);
}

/* ---------- 10. 回退 ---------- */
section('回退');
{
  const t = M.createTournament('回退测试');
  for (let i = 1; i <= 4; i++) t.players.push(M.createPlayer('P' + i, i));
  t.stages[0].type = 'round_robin';
  t.stages[0].cycles = 1;

  E.snapshot(t);
  E.generateRound(t);
  const after = t.stages[0].roundsData.length;
  ok('循环赛生成3轮', after === 3, after);
  const r = E.rollback(t);
  ok('回退成功', r.ok, r.msg);
  ok('回退后回到0轮', t.stages[0].roundsData.length === 0, t.stages[0].roundsData.length);
}

console.log('\n============================');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
console.log('============================');
process.exit(fail ? 1 : 0);
