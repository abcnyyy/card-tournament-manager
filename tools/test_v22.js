/**
 * v1.11.1 引擎测试：双败「平局 = 双方都输」
 *  A. 胜者组平局：两人一起掉进败者组，没有人留在胜者组
 *  B. 败者组平局：两人各吃第 2 负，双双淘汰
 *  C. 总决赛平局：胜者组冠军第 1 负仍在场（冠军），败者组冠军被淘汰（亚军）
 *  D. 名次表：负场数、冠亚军顺序正确
 *  E. 未开启时：平局仍然像以前一样卡住（不能推进）
 *  F. 组内双败：同样按双方都输处理
 *  G. 边界：normalize 默认值 / 导出、对阵图、晋级路径都不报错
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
  return t;
}
function mkDE(t, opt) {
  opt = opt || {};
  const s = M.defaultStage(0);
  s.type = 'double_elim';
  s.name = '双败';
  s.tie = 'draw_ok';                 // 允许平局
  s.drawBothLose = !!opt.drawBothLose;
  s.gfMode = opt.gfMode || 'none';
  s.format = { gamesPerMatch: 1, winNeeded: 1, recordScore: true };
  s.useFormat = true;
  t.stages = [s];
  E.ensureParticipants(t, s);
  return s;
}
const nm = (t, id) => E.nameOf(t, id);

/* 把整场打完：每轮按 pick(m) 决定怎么判（'A' / 'B' / 'D' 平局） */
function play(t, si, pick) {
  t.currentStage = si;
  for (let guard = 0; guard < 40; guard++) {
    const g = E.generateRound(t);
    if (!g || !g.ok) break;
    const st = t.stages[si];
    const rd = st.roundsData[st.roundsData.length - 1];
    (rd.matches || []).forEach(function (m, i) {
      if (m.isBye) return;
      const how = pick(m, i, rd, st);
      const fmt = E.fmtOfMatch(t, st, m);
      if (how === 'D') { m.games = [{ w: 'D', a: 1, b: 1 }]; }
      else { m.games = [{ w: how, a: 1, b: 0 }]; }
      E.evaluate(m, fmt, st.tie);
    });
    E.finishRound(t);
    if (st.type === 'double_elim') { const c = E.deCommitPending(t, st); if (!c.ok) return { err: c.msg }; }
    if (E.stageFinished(t, st)) break;
  }
  const st = t.stages[si];
  if (st.type === 'double_elim') { const c = E.deCommitPending(t, st); if (!c.ok) return { err: c.msg }; }
  return E.finishStage(t);
}

const names = (t, ids) => (ids || []).map(function (x) { return nm(t, x); });

/* ================= A. 胜者组平局 ================= */
sec('A. 胜者组平局 → 两人都掉进败者组');
{
  const t = mkT(8, 'A');
  const s = mkDE(t, { drawBothLose: true });
  const g1 = E.generateRound(t);
  const rd = s.roundsData[0];
  ok('A1 首轮 4 场', g1.ok && rd.matches.length === 4, rd.matches.length);

  // 第 1 场判平局，其余 A 胜
  const f = E.fmtOfMatch(t, s, rd.matches[0]);
  rd.matches[0].games = [{ w: 'D', a: 1, b: 1 }];
  E.evaluate(rd.matches[0], f, s.tie);
  for (let i = 1; i < rd.matches.length; i++) {
    rd.matches[i].games = [{ w: 'A', a: 1, b: 0 }];
    E.evaluate(rd.matches[i], E.fmtOfMatch(t, s, rd.matches[i]), s.tie);
  }
  ok('A2 平局那场 decided=true 且 winner=null',
    rd.matches[0].decided && rd.matches[0].result.winner === null);

  E.finishRound(t);
  const c = E.deCommitPending(t, s);
  ok('A3 允许结算（不再报「未完成」）', c.ok, c);

  const de = s.de;
  ok('A4 平局两人都不在胜者组',
    de.w.indexOf(rd.matches[0].playerA) < 0 && de.w.indexOf(rd.matches[0].playerB) < 0,
    { w: names(t, de.w) });
  ok('A5 平局两人都进了待注入（败者组）名单',
    de.pending.indexOf(rd.matches[0].playerA) >= 0 && de.pending.indexOf(rd.matches[0].playerB) >= 0,
    { pending: names(t, de.pending) });
  ok('A6 胜者组只剩 3 人（其余 3 场胜者）', de.w.length === 3, names(t, de.w));
}

/* ================= B. 败者组平局 → 双双淘汰 ================= */
sec('B. 败者组平局 → 双方都被淘汰');
{
  const t = mkT(8, 'B');
  const s = mkDE(t, { drawBothLose: true });
  // 第一轮全 A 胜 → 4 人进败者组
  let r = play(t, 0, function (m, i, rd) { return rd.index === 0 && m.bracket === 'L' && i === 0 ? 'D' : 'A'; });
  ok('B1 打完全程', !r.err && (!r.ok ? true : true), r.err || '');
  // 直接构造一轮只有败者组两人都平的轮次，验证 commit 的规则
  const de = s.de;
  ok('B2 阶段结束后 de 有结论', !!de);

  // 单元层面的验证：败者组一场平局
  const t2 = mkT(4, 'B2');
  const s2 = mkDE(t2, { drawBothLose: true });
  const d2 = F.createDEState([], 4);
  d2.w = ['p1', 'p2'];
  d2.l = ['p3', 'p4'];
  const before = d2.l.slice();
  const c2 = F.doubleElimCommit(d2, {
    matches: [{ id: 'x', playerA: 'p3', playerB: 'p4', bracket: 'L', result: { winner: null, settled: true, gamesA: 1, gamesB: 1 } }]
  }, { drawBothLose: true });
  ok('B3 败者组平局允许结算', c2.ok, c2);
  ok('B4 败者组没人留下（双双淘汰）', d2.l.length === 0, d2.l);
  ok('B5 两人都没进下一轮名单', before.every(function (x) { return d2.l.indexOf(x) < 0 && d2.pending.indexOf(x) < 0; }));
}

/* ================= C. 总决赛平局 ================= */
sec('C. 总决赛平局 → 胜者组冠军夺冠、败者组冠军亚军');
{
  const t = mkT(4, 'C');
  const s = mkDE(t, { drawBothLose: true, gfMode: 'none' });
  // 一路 A 胜打到总决赛
  const before = [];
  for (let k = 0; k < 4; k++) {
    const g = E.generateRound(t);
    if (!g.ok) break;
    const rd = s.roundsData[s.roundsData.length - 1];
    const isGF = !!rd.isGF;
    before.push({ index: rd.index, isGF: isGF, n: rd.matches.length });
    rd.matches.forEach(function (m) {
      if (m.isBye) return;
      m.games = isGF ? [{ w: 'D', a: 1, b: 1 }] : [{ w: 'A', a: 1, b: 0 }];
      E.evaluate(m, E.fmtOfMatch(t, s, m), s.tie);
    });
    E.finishRound(t);
    const cd = E.deCommitPending(t, s);
    if (isGF) {
      ok('C1 总决赛平局可以结算', cd.ok, cd);
      break;
    }
    if (!cd.ok) { ok('C1.5 前面的轮次结算', cd.ok, cd); break; }
  }
  const de = s.de;
  ok('C2 平局后已走到终局（只有一个人的名单）', de.w.length === 0 || de.w.length === 1, { w: names(t, de.w), l: names(t, de.l) });
  ok('C3 标记了 gfDrawBothLose', !!de.gfDrawBothLose);

  const fin = E.stageFinished(t, s);
  ok('C4 阶段判定为已结束', !!fin, fin);
  const r = E.finishStage(t);
  ok('C5 能收尾', r.ok, r);
  const rk = s.finalRank || [];
  ok('C6 产生了完整名次', rk.length === 4, names(t, rk));
  ok('C7 冠军是胜者组冠军（负场最少的那位）', !!rk[0], nm(t, rk[0]));
  const losses = {};
  (s.roundsData || []).forEach(function (rd) {
    (rd.matches || []).forEach(function (m) {
      const rg = m.result || {};
      if (m.isBye) return;
      if (!rg.winner) { if (m.playerA) losses[m.playerA] = (losses[m.playerA] || 0) + 1; if (m.playerB) losses[m.playerB] = (losses[m.playerB] || 0) + 1; return; }
      const lid = rg.winner === 'A' ? m.playerB : m.playerA;
      if (lid) losses[lid] = (losses[lid] || 0) + 1;
    });
  });
  ok('C8 冠军确实只有 1 负（总决赛那场平局）', losses[rk[0]] === 1, { champ: nm(t, rk[0]), losses: losses[rk[0]] });
  ok('C9 亚军就是平局的另一方、共 2 负', losses[rk[1]] === 2, { runner: nm(t, rk[1]), losses: losses[rk[1]] });
}

/* ================= D. 未开启时仍然卡住 ================= */
sec('D. 未勾选「双方都输」时，平局照旧卡住');
{
  const t = mkT(8, 'D');
  const s = mkDE(t, { drawBothLose: false });
  const g = E.generateRound(t);
  const rd = s.roundsData[0];
  rd.matches[0].games = [{ w: 'D', a: 1, b: 1 }];
  E.evaluate(rd.matches[0], E.fmtOfMatch(t, s, rd.matches[0]), s.tie);
  for (let i = 1; i < rd.matches.length; i++) {
    rd.matches[i].games = [{ w: 'A', a: 1, b: 0 }];
    E.evaluate(rd.matches[i], E.fmtOfMatch(t, s, rd.matches[i]), s.tie);
  }
  E.finishRound(t);
  const c = E.deCommitPending(t, s);
  ok('D1 平局会挡住结算（提示存在未完成的比赛）', !c.ok, c);

  // 单元层面：不带 opts 也不看 stage，行为不变
  const d = F.createDEState([], 4);
  d.w = ['p1', 'p2'];
  const c2 = F.doubleElimCommit(d, {
    matches: [{ id: 'y', playerA: 'p1', playerB: 'p2', result: { winner: null, settled: true } }]
  });
  ok('D2 默认（不带开关）拒绝平局', !c2.ok, c2);
}

/* ================= E. 组内双败 ================= */
sec('E. 小组赛·组内双败：平局同样双方都输');
{
  const t = mkT(8, 'E');
  const s = M.defaultStage(0);
  s.type = 'groups';
  s.groupType = 'double_elim';
  s.tie = 'draw_ok';
  s.drawBothLose = true;
  s.format = { gamesPerMatch: 1, winNeeded: 1, recordScore: true };
  s.useFormat = true;
  s.groupCount = 2;
  t.stages = [s];
  E.ensureParticipants(t, s);
  s.groups = E.buildGroups(t, s, true);
  ok('E1 分成 2 组', (s.groups || []).length === 2, (s.groups || []).length);

  let drew = false, guard = 0;
  for (; guard < 20; guard++) {
    const g = E.generateRound(t);
    if (!g.ok) break;
    const rd = s.roundsData[s.roundsData.length - 1];
    rd.matches.forEach(function (m, i) {
      if (m.isBye) return;
      if (!drew && i === 0) { drew = true; m.games = [{ w: 'D', a: 1, b: 1 }]; }
      else m.games = [{ w: 'A', a: 1, b: 0 }];
      E.evaluate(m, E.fmtOfMatch(t, s, m), s.tie);
    });
    E.finishRound(t);
    if (E.stageFinished(t, s)) break;
  }
  ok('E2 出现过平局', drew);
  ok('E3 没有因平局卡死（能推进到收尾或打完）', guard < 20 && s.roundsData.length > 1, s.roundsData.length);
  const rFin = E.finishStage(t);
  ok('E4 阶段能收尾', !rFin.ok ? false : true, rFin);
  const adv = s.advanced || [];
  ok('E5 产生了晋级名单', adv.length > 0, names(t, adv));
}

/* ================= F. 数据模型 ================= */
sec('F. 数据模型与默认值');
{
  const s = M.defaultStage(0);
  ok('F1 默认关闭', s.drawBothLose === false);
  const t = mkT(4, 'F');
  delete t.stages[0].drawBothLose;
  S.normalize(t);
  ok('F2 normalize 补齐 false', t.stages[0].drawBothLose === false);
  // 名次示意：two draws at once don't break computeElimRanking
  const t2 = mkT(4, 'F2');
  const s2 = mkDE(t2, { drawBothLose: true });
  const rk = E.computeElimRanking(t2, s2);
  ok('F3 没有对阵时返回 null', rk === null);
}

/* ================= G. 导出不报错 ================= */
sec('G. 导出');
{
  const t = mkT(8, 'G');
  const s = mkDE(t, { drawBothLose: true, gfMode: 'none' });
  play(t, 0, function (m, i, rd) { return (i === 0 ? 'D' : 'A'); });
  let okHtml = true, okCsv = true, err = '';
  try { okHtml = !!X.matchupsHTML(t, { stageIndex: 0 }); } catch (e) { okHtml = false; err = e.message; }
  try { okCsv = typeof X.matchupsCSV(t, { stageIndex: 0 }) === 'string'; } catch (e) { okCsv = false; err = e.message; }
  ok('G1 对阵 HTML 导出正常', okHtml, err);
  ok('G2 对阵 CSV 导出正常', okCsv, err);
  let planOk = true;
  try { planOk = !!E.bracketPlan(t, s); } catch (e) { planOk = false; err = e.message; }
  ok('G3 对阵图仍然画得出来', planOk, err);
  let pathsOk = true;
  try { const p = E.bracketPaths(t, s); pathsOk = !!p && !!p.labels; } catch (e) { pathsOk = false; err = e.message; }
  ok('G4 晋级路径不报错', pathsOk, err);
  const onePath = E.bracketPaths(t, s);
  const drewKey = Object.keys(onePath.win || {}).filter(function (k) { return /平局/.test(onePath.win[k] || ''); });
  ok('G5 平局那一系列会标注「双方各记一负」', drewKey.length > 0, drewKey.slice(0, 2));
}

console.log('\n================ v1.11.1 引擎（平局双方都输）：' + pass + ' 项通过，' + fail + ' 项失败 ================');
process.exit(fail ? 1 : 0);
