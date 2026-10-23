/* 新功能测试：阶段级局制/记分、按轮次快照排名、手动编排/随机抽签、CSV 导出 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const base = path.join(__dirname, '..', 'app', 'js');
const sandbox = {
  window: {}, console, Math, Date, JSON, parseFloat, parseInt, isNaN,
  Blob: function () {}, URL: { createObjectURL() { }, revokeObjectURL() { } },
  document: { createElement: () => ({ click() { } }), body: { appendChild() { }, removeChild() { } } }
};
sandbox.global = sandbox;
vm.createContext(sandbox);
['core.js', 'formats.js', 'engine.js', 'exporter.js'].forEach(f => {
  vm.runInContext(fs.readFileSync(path.join(base, f), 'utf8'), sandbox, { filename: f });
});

const TMS = sandbox.window.TMS;
const { model: M, engine: E, exporter: X } = TMS;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + extra : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

function mk(n, name) {
  const t = M.createTournament(name || 'T');
  for (let i = 0; i < n; i++) t.players.push(M.createPlayer('选手' + (i + 1), i + 1));
  return t;
}
function decide(t, stage, m, side) {
  const fmt = E.fmtOf(t, stage);
  let guard = 0;
  while (!m.decided && E.canAddGame(m, fmt, stage.tie) && guard++ < 20) {
    m.games.push({ w: side, a: null, b: null });
    E.evaluate(m, fmt, stage.tie);
  }
  return m;
}

/* ---------- 1. 阶段级局制 ---------- */
section('阶段级局制');
{
  const t = mk(4);
  t.format = { gamesPerMatch: 3, winNeeded: 2, recordScore: false };
  const st = t.stages[0];
  st.useFormat = true;
  st.format = { gamesPerMatch: 1, winNeeded: 1, recordScore: false };
  E.ensureParticipants(t);
  E.generateRound(t);
  const m = st.roundsData[0].matches[0];
  m.games.push({ w: 'A' });
  E.evaluate(m, E.fmtOf(t, st), st.tie);
  ok('本阶段 BO1：赢 1 局即定胜负', m.decided === true);
  ok('赛事全局仍为 BO3', E.fmtOf(t, null).gamesPerMatch === 3);
  ok('其他阶段未开独立设置 → 沿用全局', E.fmtOf(t, t.stages[0].useFormat ? null : st).gamesPerMatch === 3);

  const t2 = mk(4);
  const st2 = t2.stages[0];
  st2.useFormat = false;
  st2.format = { gamesPerMatch: 1, winNeeded: 1 };
  E.ensureParticipants(t2);
  E.generateRound(t2);
  const m2 = st2.roundsData[0].matches[0];
  m2.games.push({ w: 'A' });
  E.evaluate(m2, E.fmtOf(t2, st2), st2.tie);
  ok('未勾选独立局制时忽略阶段 format', m2.decided === false);
}

/* ---------- 2. 阶段级记分 ---------- */
section('阶段级记分');
{
  const t = mk(4);
  t.scoring = Object.assign(M.defaultScoring(), { mode: 'result', win: 3, draw: 1, lose: 0, bye: 3 });
  const st = t.stages[0];
  st.useScoring = true;
  st.scoring = { mode: 'result', win: 5, draw: 2, lose: 1, bye: 5 };
  E.ensureParticipants(t);
  E.generateRound(t);
  const m = st.roundsData[0].matches[0];
  decide(t, st, m, 'A');
  const sc = E.scOf(t, st);
  ok('本阶段胜场 5 分', E.pointsFrom(m, 'A', sc, E.fmtOf(t, st)) === 5);
  ok('本阶段负场 1 分', E.pointsFrom(m, 'B', sc, E.fmtOf(t, st)) === 1);
  ok('全局胜场仍为 3 分', E.pointsFrom(m, 'A', E.scOf(t, null), E.fmtOf(t, null)) === 3);

  const stg = E.standings(t, { stageIndex: 0 });
  ok('排名积分采用本阶段记分', stg[0].points === 5, stg[0].points);
}

/* ---------- 3. 截至某轮的排名快照 ---------- */
section('按轮次快照排名');
{
  const t = mk(4);
  t.format = { gamesPerMatch: 3, winNeeded: 2, recordScore: false };
  const st = t.stages[0];
  st.type = 'round_robin';
  st.cycles = 1;
  E.ensureParticipants(t);
  E.generateRound(t);              // 循环赛一次性生成全部轮次
  ok('循环赛 3 轮', st.roundsData.length === 3, st.roundsData.length);

  // 第 1 轮：左侧全胜
  st.roundsData[0].matches.forEach(m => decide(t, st, m, 'A'));
  const snap = E.standings(t, { stageIndex: 0, upToRound: 0 });
  ok('截至第 1 轮：每人 1 场', snap.every(s => s.matches === 1), snap.map(s => s.matches).join(','));
  ok('截至第 1 轮：总积分 6', snap.reduce((a, s) => a + s.points, 0) === 6,
    snap.reduce((a, s) => a + s.points, 0));

  // 全部打完
  st.roundsData.forEach(rd => rd.matches.forEach(m => decide(t, st, m, 'A')));
  const full = E.standings(t, { stageIndex: 0 });
  ok('全部轮次：每人 3 场', full.every(s => s.matches === 3), full.map(s => s.matches).join(','));
  ok('快照不受后续轮次影响', E.standings(t, { stageIndex: 0, upToRound: 0 })
    .every(s => s.matches === 1));
  ok('HTML 标题标注截止轮次', X.standingsHTML(t, { stageIndex: 0, upToRound: 1 }).indexOf('截至第 2 轮') > 0);
}

/* ---------- 4. 随机抽签重排 ---------- */
section('随机抽签重排');
{
  const t = mk(6);
  const st = t.stages[0];
  E.ensureParticipants(t);
  E.generateRound(t);
  const rd = st.roundsData[0];
  const before = E.roundPool(rd).slice().sort().join(',');
  ok('首轮 3 桌', rd.matches.length === 3, rd.matches.length);

  const r1 = E.randomizeRound(t);
  ok('随机重排成功', r1.ok === true, r1.msg);
  const after = E.roundPool(rd).slice().sort().join(',');
  ok('选手池不变', before === after, before + ' vs ' + after);
  ok('重排后仍 3 桌', rd.matches.length === 3, rd.matches.length);

  let dup = false;
  rd.matches.forEach(m => { if (m.playerA && m.playerA === m.playerB) dup = true; });
  ok('无自我对阵', !dup);

  // 录入成绩后不允许再排
  decide(t, st, rd.matches[0], 'A');
  const r2 = E.randomizeRound(t);
  ok('已录入成绩后拒绝重排', r2.ok === false, r2.msg);
}

/* ---------- 5. 手动指派与对调 ---------- */
section('手动指派对阵');
{
  const t = mk(6);
  const st = t.stages[0];
  E.ensureParticipants(t);
  E.generateRound(t);
  const rd = st.roundsData[0];
  const m0 = rd.matches[0], m1 = rd.matches[1];
  const a0 = m0.playerA, a1 = m1.playerA;   // 把 m1 的 A 拿到 m0 的 A
  const r = E.setMatchSlot(t, m0.id, 'A', a1);
  ok('指派成功', r.ok === true, r.msg);
  ok('目标桌换成新选手', m0.playerA === a1);
  ok('原桌自动补上被换下的选手', m1.playerA === a0);

  const pool = E.roundPool(rd);
  ok('无重复上场', new Set(pool).size === pool.length && pool.length === 6, pool.join(','));

  // 清空一侧 → 轮空
  E.setMatchSlot(t, m0.id, 'B', '');
  ok('清空一侧后成为轮空', m0.isBye === true);

  // 补回 → 正常对阵
  E.setMatchSlot(t, m0.id, 'B', m1.playerB);
  ok('补人后不再是轮空', !m0.isBye);
}

/* ---------- 6. 增删桌次 ---------- */
section('增删桌次');
{
  const t = mk(6);
  const st = t.stages[0];
  E.ensureParticipants(t);
  E.generateRound(t);
  const rd = st.roundsData[0];
  const r = E.addMatchToRound(t);
  ok('新增空桌', r.ok === true && rd.matches.length === 4, rd.matches.length);
  E.removeMatchFromRound(t, rd.matches[3].id);
  ok('删除后恢复 3 桌', rd.matches.length === 3);
  ok('未安排选手可被识别', E.unassignedInRound(t, st, rd).length === 0);

  // 空桌不影响本轮完成判定
  rd.matches.forEach(m => decide(t, st, m, 'A'));
  rd.matches.push({
    id: 'empty_x', playerA: null, playerB: null, isBye: false,
    games: [], decided: false, __empty: true
  });
  ok('空桌不阻挡本轮完成', E.roundComplete(t, st, rd).ok === true, E.roundComplete(t, st, rd).msg);
  rd.matches.pop();
}

/* ---------- 7. 手动分组 ---------- */
section('手动分组');
{
  const t = mk(8);
  const st = t.stages[0];
  st.type = 'groups';
  st.groupMethod = 'manual';
  st.groupCount = 2;
  st.groupType = 'round_robin';
  E.ensureParticipants(t);
  st.groups = E.buildGroups(t, st);
  ok('生成 2 个小组', st.groups.length === 2, st.groups.length);
  ok('初始每组 4 人', st.groups[0].players.length === 4 && st.groups[1].players.length === 4);

  const pid = st.groups[0].players[0];
  E.moveToGroup(t, st, pid, 1);
  ok('移组后原组减 1', st.groups[0].players.length === 3);
  ok('移组后目标组加 1', st.groups[1].players.length === 5);
  const all = st.groups[0].players.concat(st.groups[1].players);
  ok('移组后不重不漏', all.length === 8 && new Set(all).size === 8);

  const r = E.generateRound(t);
  ok('手动分组后可生成对阵', r.ok === true, r.msg);
  ok('分组不会被重建', st.groups[1].players.length === 5);
}

/* ---------- 8. CSV 导出 ---------- */
section('CSV 导出');
{
  const t = mk(4);
  const st = t.stages[0];
  E.ensureParticipants(t);
  E.generateRound(t);
  st.roundsData[0].matches.forEach(m => decide(t, st, m, 'A'));

  const csv = X.matchupsCSV(t, { stageIndex: 0, roundIndex: 0 });
  ok('对阵 CSV 带 BOM', csv.charCodeAt(0) === 0xFEFF);
  ok('对阵 CSV 含表头', csv.indexOf('选手A') > 0);
  ok('对阵 CSV 含轮次', csv.indexOf('第 1 轮') > 0);
  ok('对阵 CSV 含胜者', csv.indexOf('选手1') > 0);

  const allCsv = X.matchupsCSV(t, { stageIndex: 0 });
  const totalMatches = st.roundsData.reduce((a, rd) => a + rd.matches.filter(m => !m.__empty).length, 0);
  ok('全部轮次 CSV 行数正确', allCsv.split('\r\n').length === totalMatches + 1,
    allCsv.split('\r\n').length + ' vs ' + (totalMatches + 1));

  const stCsv = X.standingsCSV(t, { stageIndex: 0 });
  ok('排名 CSV 含名次表头', stCsv.indexOf('名次') > 0);
  ok('排名 CSV 含积分列', stCsv.indexOf('对手分') > 0);

  const snapCsv = X.standingsCSV(t, { stageIndex: 0, upToRound: 0 });
  ok('排名 CSV 标注截止轮次', snapCsv.indexOf('截至第 1 轮') > 0);
}

/* ---------- 9. 旧存档兼容 ---------- */
section('旧存档兼容');
{
  const t = mk(4);
  t.stages[0].participants = t.players.map(p => p.id);
  t.stages[0].type = 'round_robin';
  E.generateRound(t);
  const raw = JSON.parse(JSON.stringify(t));
  delete raw.stages[0].useFormat;
  delete raw.stages[0].useScoring;
  delete raw.stages[0].format;
  delete raw.stages[0].scoring;
  const n = TMS.store.normalize(raw);
  ok('归一化补 useFormat', n.stages[0].useFormat === false);
  ok('归一化补 useScoring', n.stages[0].useScoring === false);
  ok('归一化后局制沿用全局', E.fmtOf(n, n.stages[0]).gamesPerMatch === 3);
  ok('归一化后仍可算排名', E.standings(n, { stageIndex: 0 }).length === 4);
}

console.log('\n============================');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
console.log('============================');
process.exit(fail ? 1 : 0);
