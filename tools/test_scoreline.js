/* 新增记分模式「按大比分逐档设分（scoreline）」的专项测试 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const base = path.join(__dirname, '..', 'app', 'js');
const sandbox = { window: {}, console, Math, Date, JSON, parseFloat, parseInt, isNaN };
sandbox.global = sandbox;
vm.createContext(sandbox);
['core.js', 'formats.js', 'engine.js'].forEach(f => {
  vm.runInContext(fs.readFileSync(path.join(base, f), 'utf8'), sandbox, { filename: f });
});
const TMS = sandbox.window.TMS;
const { model: M, engine: E } = TMS;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + extra : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

function mkMatch(a, b, ga, gb, winner) {
  return {
    id: 'm', playerA: a, playerB: b, isBye: false, games: [],
    result: { winner: winner === undefined ? (ga > gb ? 'A' : (gb > ga ? 'B' : null)) : winner, gamesA: ga, gamesB: gb, draws: 0, settled: true },
    decided: true
  };
}

/* ---------- 1. 档位枚举 ---------- */
section('枚举所有可能的最终比分');
{
  const l = E.scoreLines({ gamesPerMatch: 3, winNeeded: 2 }, null);
  ok('三局两胜 = 2:0 / 2:1', JSON.stringify(l.map(x => x.key)) === JSON.stringify(['2-0', '2-1']), JSON.stringify(l));
}
{
  const l = E.scoreLines({ gamesPerMatch: 5, winNeeded: 3 }, null);
  ok('五局三胜 = 3:0 / 3:1 / 3:2', l.map(x => x.key).join(',') === '3-0,3-1,3-2', l.map(x => x.key).join(','));
}
{
  const l = E.scoreLines({ gamesPerMatch: 1, winNeeded: 1 }, null);
  ok('一局制 = 1:0', l.map(x => x.key).join(',') === '1-0', l.map(x => x.key).join(','));
}
{
  const l = E.scoreLines({ gamesPerMatch: 3, winNeeded: 0 }, 'draw_ok');
  ok('打满 3 局 = 3:0 / 2:1（3局无平局）', l.map(x => x.key).join(',') === '3-0,2-1', l.map(x => x.key).join(','));
}
{
  const l = E.scoreLines({ gamesPerMatch: 2, winNeeded: 0 }, 'draw_ok');
  ok('打满 2 局 = 2:0 / 1:1（含平局档）', l.map(x => x.key).join(',') === '2-0,1-1', l.map(x => x.key).join(','));
  ok('1:1 标记为平局档', l[1].draw === true);
}
{
  const l = E.scoreLines({ gamesPerMatch: 2, winNeeded: 0 }, 'sudden_death');
  ok('加赛制不列平局档', l.map(x => x.key).join(',') === '2-0', l.map(x => x.key).join(','));
}
{
  const l = E.scoreLines({ gamesPerMatch: 4, winNeeded: 0 }, 'draw_ok');
  ok('打满 4 局 = 4:0 / 3:1 / 2:2', l.map(x => x.key).join(',') === '4-0,3-1,2-2', l.map(x => x.key).join(','));
}

/* ---------- 2. 档位 key 归一化 ---------- */
section('比分归一化（2:0 与 0:2 同一档）');
ok('scoreKey(0,2) = 2-0', E.scoreKey(0, 2) === '2-0', E.scoreKey(0, 2));
ok('scoreKey(2,0) = 2-0', E.scoreKey(2, 0) === '2-0');
ok('scoreKey(1,1) = 1-1', E.scoreKey(1, 1) === '1-1');
ok('scoreKey(3,2) = 3-2', E.scoreKey(3, 2) === '3-2');

/* ---------- 3. 按表给分 ---------- */
section('按大比分表给分');
{
  const sc = {
    mode: 'scoreline', win: 3, draw: 1, lose: 0, bye: 3,
    scoreTable: { '2-0': { w: 3, l: 0 }, '2-1': { w: 2, l: 1 } }
  };
  const fmt = { gamesPerMatch: 3, winNeeded: 2 };
  const m1 = mkMatch('A', 'B', 2, 0);
  ok('2:0 胜方得 3', E.pointsFrom(m1, 'A', sc, fmt) === 3, E.pointsFrom(m1, 'A', sc, fmt));
  ok('2:0 负方得 0', E.pointsFrom(m1, 'B', sc, fmt) === 0, E.pointsFrom(m1, 'B', sc, fmt));
  const m2 = mkMatch('A', 'B', 2, 1);
  ok('2:1 胜方得 2', E.pointsFrom(m2, 'A', sc, fmt) === 2, E.pointsFrom(m2, 'A', sc, fmt));
  ok('2:1 负方得 1', E.pointsFrom(m2, 'B', sc, fmt) === 1, E.pointsFrom(m2, 'B', sc, fmt));
  const m3 = mkMatch('A', 'B', 0, 2);
  ok('0:2 与 2:0 同一档（B 得 3）', E.pointsFrom(m3, 'B', sc, fmt) === 3, E.pointsFrom(m3, 'B', sc, fmt));
  ok('0:2 的 A 得 0', E.pointsFrom(m3, 'A', sc, fmt) === 0);
  const m4 = mkMatch('A', 'B', 1, 2);
  ok('1:2 负方仍拿 1 分', E.pointsFrom(m4, 'A', sc, fmt) === 1, E.pointsFrom(m4, 'A', sc, fmt));
}
{
  // 平局档
  const sc = { mode: 'scoreline', win: 3, draw: 1, lose: 0, bye: 3, scoreTable: { '1-1': { d: 1 }, '2-0': { w: 3, l: 0 } } };
  const fmt = { gamesPerMatch: 2, winNeeded: 0 };
  const m = mkMatch('A', 'B', 1, 1);
  ok('1:1 双方各得 1', E.pointsFrom(m, 'A', sc, fmt) === 1 && E.pointsFrom(m, 'B', sc, fmt) === 1);
}
{
  // 表里没有这一档 → 兜底
  const sc = { mode: 'scoreline', win: 5, draw: 2, lose: 1, bye: 3, scoreTable: { '2-0': { w: 3, l: 0 } } };
  const fmt = { gamesPerMatch: 3, winNeeded: 2 };
  const m = mkMatch('A', 'B', 2, 1);
  ok('未设档位走胜的兜底 5', E.pointsFrom(m, 'A', sc, fmt) === 5, E.pointsFrom(m, 'A', sc, fmt));
  ok('未设档位走负的兜底 1', E.pointsFrom(m, 'B', sc, fmt) === 1, E.pointsFrom(m, 'B', sc, fmt));
}
{
  // 轮空与未定案
  const sc = { mode: 'scoreline', win: 3, draw: 1, lose: 0, bye: 4, scoreTable: { '2-0': { w: 3, l: 0 } } };
  const bye = { isBye: true, playerA: 'A', playerB: null };
  ok('轮空按 bye 分', E.pointsFrom(bye, 'A', sc, { gamesPerMatch: 3, winNeeded: 2 }) === 4);
  const un = mkMatch('A', 'B', 1, 0);
  un.result.settled = false;
  ok('未打完不给分', E.pointsFrom(un, 'A', sc, { gamesPerMatch: 3, winNeeded: 2 }) === 0);
}

/* ---------- 4. 整场比赛跑通 ---------- */
section('整场赛事：8 人循环赛 + 大比分计分');
{
  const t = M.createTournament('大比分计分测试');
  for (let i = 1; i <= 4; i++) t.players.push(M.createPlayer('P' + i, i));
  t.format = { gamesPerMatch: 3, winNeeded: 2, recordScore: false };
  t.stages[0].type = 'round_robin';
  t.stages[0].rounds = 3;
  t.stages[0].cycles = 1;
  t.scoring = {
    mode: 'scoreline', win: 3, draw: 1, lose: 0, bye: 3,
    perGame: 1, formula: 'w*3+d',
    scoreTable: { '2-0': { w: 3, l: 0 }, '2-1': { w: 2, l: 1 } },
    tieOrder: ['points', 'buchholz', 'h2h', 'gamesDiff', 'cumulative', 'seed', 'manual'],
    manualOrder: {}
  };

  const st = t.stages[0];
  // 循环赛会一次性生成全部轮次，瑞士轮/淘汰赛才逐轮生成
  let guard = 0;
  while (guard++ < 12 && st.roundsData.length < 3) {
    const g = E.generateRound(t);
    if (!g.ok) break;
  }
  st.roundsData.forEach(function (rd) {
    rd.matches.forEach((m, i) => {
      if (m.isBye) { E.evaluate(m, E.fmtOf(t, st), st.tie); return; }
      // 每轮第 1 场打成 2:0，第 2 场打成 2:1
      m.games.push({ w: 'A' }, { w: 'A' });
      if (i % 2 === 1) m.games.push({ w: 'B' });
      E.evaluate(m, E.fmtOf(t, st), st.tie);
    });
  });
  E.finishRound(t);
  ok('3 轮全部生成', st.roundsData.length === 3, st.roundsData.length);

  const table = E.standings(t, { stageIndex: 0 });
  ok('排名人数 = 4', table.length === 4, table.length);
  console.log('    名次：' + table.map(s => `${s.rank}.${s.name}(${s.points})`).join('  '));
  const total = table.reduce((a, s) => a + s.points, 0);
  // 6 场：3 场 2:0（3+0），3 场 2:1（2+1）→ 总分 3*3 + 3*3 = 18
  ok('总积分符合档位设置（18）', total === 18, total);
  const top = table[0];
  ok('榜首积分为整数档位累加', Number.isInteger(top.points), top.points);
}

/* ---------- 5. 与阶段级覆盖配合 ---------- */
section('阶段级独立记分 + 大比分档位');
{
  const t = M.createTournament('阶段档位测试');
  for (let i = 1; i <= 4; i++) t.players.push(M.createPlayer('Q' + i, i));
  t.format = { gamesPerMatch: 3, winNeeded: 2, recordScore: false };
  t.stages[0].type = 'round_robin';
  t.stages[0].rounds = 3;
  t.stages[0].useFormat = true;
  t.stages[0].format = { gamesPerMatch: 2, winNeeded: 0, recordScore: false };
  t.stages[0].tie = 'draw_ok';   // 打满 2 局允许 1:1 平局
  t.stages[0].useScoring = true;
  t.stages[0].scoring = {
    mode: 'scoreline', win: 3, draw: 1, lose: 0, bye: 3, perGame: 1, formula: 'w*3+d',
    scoreTable: { '2-0': { w: 4, l: 0 }, '1-1': { d: 2 } },
    tieOrder: ['points', 'buchholz', 'h2h', 'gamesDiff', 'cumulative', 'seed', 'manual'],
    manualOrder: {}
  };

  const stage = t.stages[0];
  const lines = E.scoreLines(E.fmtOf(t, stage), null);
  ok('按阶段局制（打满2局）枚举出 2:0 / 1:1', lines.map(x => x.key).join(',') === '2-0,1-1', lines.map(x => x.key).join(','));

  let guard = 0;
  while (guard++ < 12 && stage.roundsData.length < 3) {
    const g = E.generateRound(t);
    if (!g.ok) break;
  }
  stage.roundsData.forEach(function (rd) {
    rd.matches.forEach((m, i) => {
      if (m.isBye) { E.evaluate(m, E.fmtOf(t, stage), stage.tie); return; }
      m.games.push({ w: 'A' }, { w: (i % 2 === 0 ? 'A' : 'B') });
      E.evaluate(m, E.fmtOf(t, stage), stage.tie);
    });
  });
  E.finishRound(t);
  const table = E.standings(t, { stageIndex: 0 });
  console.log('    名次：' + table.map(s => `${s.rank}.${s.name}(${s.points})`).join('  '));
  const total = table.reduce((a, s) => a + s.points, 0);
  // 6 场：3 场 2:0 → 4+0；3 场 1:1 → 2+2 ；总分 12 + 12 = 24
  ok('阶段档位生效（总分 24）', total === 24, total);
}

/* ---------- 6. 旧存档兼容 ---------- */
section('旧存档兼容');
{
  const t = M.createTournament('旧档');
  delete t.scoring.scoreTable;
  t.scoring.mode = 'result';
  const n = sandbox.window.TMS.store.normalize(t);
  ok('normalize 补齐 scoreTable', !!n.scoring.scoreTable, JSON.stringify(n.scoring.scoreTable));
}

console.log('\n============================');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
console.log('============================');
process.exit(fail ? 1 : 0);
