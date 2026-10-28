/* v2.2 新功能测试：手动指定对阵（全赛制）+ 双败半区互换（crossover） */
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
const { util: U, model: M, engine: E, formats: F } = TMS;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + extra : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

// 把「选手显示名」解析成真实的 uid 型 player id（createPlayer 生成的是 uid，
// name 只是显示名，不能直接拿去当 id 用）
function P(t, name) {
  const p = t.players.find(x => x.name === name);
  return p ? p.id : name;
}

function newTourney(n) {
  const t = M.createTournament('t');
  for (let i = 1; i <= n; i++) t.players.push(M.createPlayer('P' + i, i));
  return t;
}
function setRes(m, winner) {
  if (m.isBye || !m.playerA || !m.playerB) return;
  m.games = [];
  if (winner === 'A') { m.games.push({ w: 'A' }); } else { m.games.push({ w: 'B' }); }
  E.evaluate(m, m.fmt || { gamesPerMatch: 1, winNeeded: 1 }, 'sudden_death');
}

/* ---------- A. 瑞士轮手动编排 ---------- */
section('A. 瑞士轮手动编排');
{
  const t = newTourney(8);
  const s = t.stages[0];
  s.type = 'swiss'; s.rounds = 3; s.pairMode = 'manual';
  E.ensureParticipants(t);
  const r0 = E.generateRound(t);
  ok('瑞士轮手动：首轮返回 needManual', r0 && r0.needManual === true, JSON.stringify(r0));
  const can = E.canManualArrange(t, s);
  ok('可手动编排', can.ok, can.msg);
  const cm = E.commitManualRound(t, 0, [[P(t,'P1'), P(t,'P2')], [P(t,'P3'), P(t,'P4')], [P(t,'P5'), P(t,'P6')], [P(t,'P7'), P(t,'P8')]], null, {});
  ok('确认本轮对阵成功', cm.ok, cm.msg);
  ok('轮次已生成', s.roundsData.length === 1 && s.roundsData[0].matches.length === 4, s.roundsData.length);
  s.roundsData[0].matches.forEach(m => setRes(m, 'A'));
  E.finishRound(t);
  // 第二轮仍应可手动
  const r1 = E.generateRound(t);
  ok('第二轮仍 needManual', r1 && r1.needManual === true, JSON.stringify(r1));
}

/* ---------- B. 循环赛手动编排 ---------- */
section('B. 循环赛手动编排');
{
  const t = newTourney(6);
  const s = t.stages[0];
  s.type = 'round_robin'; s.cycles = 1; s.pairMode = 'manual';
  E.ensureParticipants(t);
  const r0 = E.generateRound(t);
  ok('循环赛手动：首轮 needManual', r0 && r0.needManual === true, JSON.stringify(r0));
  const cm = E.commitManualRound(t, 0, [[P(t,'P1'), P(t,'P2')], [P(t,'P3'), P(t,'P4')], [P(t,'P5'), P(t,'P6')]], null, {});
  ok('确认循环赛本轮', cm.ok, cm.msg);
  s.roundsData[0].matches.forEach(m => setRes(m, 'A'));
  E.finishRound(t);
  ok('循环赛未一次性生成全部轮', s.roundsData.length === 1, s.roundsData.length);
}

/* ---------- C. 小组赛手动编排（按组） ---------- */
section('C. 小组赛手动编排（按组）');
{
  const t = newTourney(8);
  const s = t.stages[0];
  s.type = 'groups'; s.groupCount = 2; s.groupMethod = 'snake';
  s.groupType = 'round_robin'; s.pairMode = 'manual';
  E.ensureParticipants(t);
  s.groups = E.buildGroups(t, s);
  ok('分组建立（2 组各4人）', s.groups.length === 2 && s.groups[0].players.length === 4, JSON.stringify(s.groups.map(g => g.players.length)));
  const r0 = E.generateGroupRound(t, s);
  ok('小组赛手动：needManual 且列出待编排组', r0 && r0.needManual === true && r0.groups && r0.groups.length === 2, JSON.stringify(r0.groups));
  const g0 = s.groups[0];
  const cm = E.commitManualRound(t, 0, [[g0.players[0], g0.players[1]], [g0.players[2], g0.players[3]]], null, { groupIdx: 0 });
  ok('确认 A 组本轮', cm.ok, cm.msg);
  const g1 = s.groups[1];
  const cm2 = E.commitManualRound(t, 0, [[g1.players[0], g1.players[1]], [g1.players[2], g1.players[3]]], null, { groupIdx: 1 });
  ok('确认 B 组本轮', cm2.ok, cm2.msg);
  ok('两个小组的比赛都在 roundsData', s.roundsData.length === 2 &&
    s.roundsData[0].matches.every(m => m.group === 0) &&
    s.roundsData[1].matches.every(m => m.group === 1), s.roundsData.length);
}

/* ---------- D. 淘汰赛手动摆放首轮位 ---------- */
section('D. 单败淘汰手动摆放首轮位');
{
  const t = newTourney(8);
  const s = t.stages[0];
  s.type = 'single_elim'; s.drawMode = 'manual';
  E.ensureParticipants(t);
  // 8 人 -> size=8；手动把选手按自定义顺序摆进 bracket 位置（满员，无轮空）
  s.bracketSlots = [P(t,'P3'), P(t,'P5'), P(t,'P1'), P(t,'P7'), P(t,'P2'), P(t,'P8'), P(t,'P4'), P(t,'P6')];
  const r = E.generateRound(t);
  ok('单败手动：生成首轮', r && r.ok, JSON.stringify(r));
  const rd = s.roundsData[0];
  // 位置 0v1 = P3 vs P5，2v3 = P1 vs P7 ...
  const pair0 = [rd.matches[0].playerA, rd.matches[0].playerB];
  ok('首轮第1桌 = bracketSlots[0]v[1]', pair0[0] === P(t,'P3') && pair0[1] === P(t,'P5'), JSON.stringify(pair0));
  const pair1 = [rd.matches[1].playerA, rd.matches[1].playerB];
  ok('首轮第2桌 = bracketSlots[2]v[3]', pair1[0] === P(t,'P1') && pair1[1] === P(t,'P7'), JSON.stringify(pair1));
}

/* ---------- E. 双败半区互换（crossover） ---------- */
section('E. 双败半区互换（crossover）');
function simulateDE(t, cross) {
  const s = t.stages[0];
  s.type = 'double_elim'; s.deCrossDrop = !!cross; s.gfMode = 'reset';
  E.ensureParticipants(t);
  s.drawMode = 'seed';
  let guard = 0;
  const allMatches = [];
  while (guard++ < 200) {
    const r = E.generateRound(t);
    if (!r.ok) {
      if (E.stageFinished(t, s)) break;
      break;
    }
    const rd = s.roundsData[s.roundsData.length - 1];
    rd.matches.forEach(m => { setRes(m, 'A'); allMatches.push(m); });
    E.finishRound(t);
  }
  return { s, allMatches };
}
{
  const t = newTourney(8);
  const { s, allMatches } = simulateDE(t, true);
  ok('crossover：整届完赛', E.stageFinished(t, s), 'rounds=' + s.roundsData.length);
  // 半区映射：按初始 bracket 位置，前4人 half=0（上），后4人 half=1（下）
  const halfOf = s.de ? s.de.halfOf : {};
  const topIds = Object.keys(halfOf).filter(id => halfOf[id] === 0);
  // 交叉掉落：存在某场 lbHalf='B'（下半区败者组）的比赛，其选手来自上半区
  let crossDrop = false, lbCrossSeen = false;
  allMatches.forEach(m => {
    if (m.isLBCross) lbCrossSeen = true;
    if (m.bracket === 'L' && m.lbHalf === 'B' && m.playerA && m.playerB) {
      if (halfOf[m.playerA] === 0 || halfOf[m.playerB] === 0) crossDrop = true;
    }
  });
  ok('crossover：出现败者组交叉决赛', lbCrossSeen, 'rounds=' + s.roundsData.length);
  ok('crossover：上半区 WB 败者掉入下半区败者组(lbHalf=B)', crossDrop,
    'top=' + topIds.length + ' matches=' + allMatches.length);
  // 冠军：de.w 或 de.lChamp 唯一
  const champ = (s.de && s.de.w && s.de.w[0]) || (s.de && s.de.lChamp);
  ok('crossover：产生唯一冠军', !!champ, champ);
  // 比赛场次数 ≈ 2N-1（含重置）或 2N-2
  const total = allMatches.length;
  ok('crossover：场次数合理(13~15)', total >= 13 && total <= 15, total);
}
{
  // 对照：关闭 crossover，行为应正常完赛且不应出现 lbHalf/cross
  const t = newTourney(8);
  const { s, allMatches } = simulateDE(t, false);
  ok('对照(无crossover)：完赛', E.stageFinished(t, s), 'rounds=' + s.roundsData.length);
  const hasCross = allMatches.some(m => m.isLBCross || (m.bracket === 'L' && m.lbHalf));
  ok('对照：无 lbHalf/交叉决赛标记', !hasCross, hasCross);
}

/* ---------- F. 座位表（E.manualSlots）与摆位校验 ---------- */
section('F. 首轮座位表 / 摆位校验');
{
  const t = newTourney(8);
  const s = t.stages[0];
  s.type = 'single_elim'; s.drawMode = 'manual';
  E.ensureParticipants(t);
  const info = E.manualSlots(t, s);
  ok('manualSlots：8 人 → 8 个位置、0 轮空', info.ok && info.size === 8 && info.byes === 0, JSON.stringify(info && info.size));
  ok('manualSlots：座位表长度 = 规模', info.slots.length === 8, info.slots && info.slots.length);
  ok('manualSlots：候选池 = 全体', info.pool.length === 8, info.pool && info.pool.length);
  ok('manualSlots：默认按种子位预填（每人恰好一次）',
    info.slots.filter(Boolean).length === 8 && new Set(info.slots).size === 8, JSON.stringify(info.slots));
}
{
  // 6 人：规模 8、2 个轮空位
  const t = newTourney(6);
  const s = t.stages[0];
  s.type = 'single_elim'; s.drawMode = 'manual';
  E.ensureParticipants(t);
  const info = E.manualSlots(t, s);
  ok('manualSlots：6 人 → 8 个位置、2 轮空', info.ok && info.size === 8 && info.byes === 2,
    JSON.stringify({ size: info.size, byes: info.byes }));
}
{
  // 摆错（少放 1 人）→ 引擎必须退回种子位，而不是排出空桌
  const t = newTourney(8);
  const s = t.stages[0];
  s.type = 'single_elim'; s.drawMode = 'manual';
  E.ensureParticipants(t);
  s.bracketSlots = [P(t,'P1'), P(t,'P2'), P(t,'P3'), P(t,'P4'), P(t,'P5'), P(t,'P6'), P(t,'P7'), null];
  const r = E.generateRound(t);
  const rd = s.roundsData[0];
  const seated = [];
  rd.matches.forEach(m => { if (m.playerA) seated.push(m.playerA); if (m.playerB) seated.push(m.playerB); });
  ok('摆位不完整 → 仍能生成首轮', r && r.ok, JSON.stringify(r));
  ok('摆位不完整 → 退回种子位（8 人全部登场且不重复）',
    seated.length === 8 && new Set(seated).size === 8, seated.length + '/' + new Set(seated).size);
}
{
  // 双败手动摆位：座位表作用于胜者组首轮
  const t = newTourney(8);
  const s = t.stages[0];
  s.type = 'double_elim'; s.drawMode = 'manual'; s.gfMode = 'reset';
  E.ensureParticipants(t);
  const info = E.manualSlots(t, s);
  ok('双败 manualSlots：8 人 → 8 个位置', info.ok && info.size === 8, JSON.stringify({ ok: info.ok, size: info.size }));
  s.bracketSlots = [P(t,'P8'), P(t,'P1'), P(t,'P7'), P(t,'P2'), P(t,'P6'), P(t,'P3'), P(t,'P5'), P(t,'P4')];
  const r = E.generateRound(t);
  ok('双败手动：生成首轮', r && r.ok, JSON.stringify(r));
  const wm = (s.roundsData[0].matches || []).filter(m => m.bracket === 'W');
  ok('双败手动：胜者组第 1 桌 = 摆放的第 1、2 位',
    wm[0].playerA === P(t,'P8') && wm[0].playerB === P(t,'P1'),
    wm[0] && (wm[0].playerA + 'v' + wm[0].playerB));
}

/* ---------- G. 小组赛：按组编排互不阻塞 ---------- */
section('G. 小组赛按组编排（互不阻塞）');
{
  const t = newTourney(8);
  const s = t.stages[0];
  s.type = 'groups'; s.groupCount = 2; s.groupMethod = 'snake';
  s.groupType = 'round_robin'; s.pairMode = 'manual';
  E.ensureParticipants(t);
  s.groups = E.buildGroups(t, s);
  E.generateGroupRound(t, s);
  const pend = E.groupArrangePending(s);
  ok('groupArrangePending：2 个组待编排', pend.length === 2, JSON.stringify(pend));
  const c0 = E.canManualArrange(t, s, null, { groupIdx: 0 });
  ok('canManualArrange(组0)：可编排且带 pending', c0.ok && c0.pending && c0.pending.length === 2, c0.msg);
  const g0 = s.groups[0];
  E.commitManualRound(t, 0, [[g0.players[0], g0.players[1]], [g0.players[2], g0.players[3]]], null, { groupIdx: 0 });
  // A 组已经落了一轮但还没打完 → B 组仍应能编排（不能被 A 组卡住）
  const c1 = E.canManualArrange(t, s, null, { groupIdx: 1 });
  ok('A 组未完赛时 B 组仍可编排', c1.ok, c1.msg);
  const g1 = s.groups[1];
  const cm = E.commitManualRound(t, 0, [[g1.players[0], g1.players[1]], [g1.players[2], g1.players[3]]], null, { groupIdx: 1 });
  ok('B 组顺利落一轮', cm.ok, cm.msg);
  // A 组自己没打完 → 再想排 A 组应被拦下
  const c0b = E.canManualArrange(t, s, null, { groupIdx: 0 });
  ok('A 组自己未完赛 → 拦住 A 组下一轮', !c0b.ok, c0b.msg);
}

console.log('\n==== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 ====');
process.exit(fail ? 1 : 0);
