/* v2.3 新功能测试：
   ① 逐阶段得分（小分里「第 N 阶段得分」可以逐个设置）
   ② 警告 / 判负（记录在对阵上，计入小分：先比判负、再比警告） */
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
const { util: U, model: M, engine: E, store: S } = TMS;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + extra : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

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
  m.games = [{ w: winner }];
  E.evaluate(m, { gamesPerMatch: 1, winNeeded: 1, recordScore: false }, 'sudden_death');
}
// 打一轮：A 边全胜
function playRoundAllA(t, stage, rd) {
  (rd.matches || []).forEach(m => setRes(m, 'A'));
  E.finishRound(t, stage);
}
function statOf(list, name) {
  return list.filter(x => x.name === name)[0] || {};
}

/* ================= A. 默认破同表 ================= */
section('A. 默认破同表含判负 / 警告');
{
  const t = newTourney(4);
  const o = t.scoring.tieOrder;
  ok('默认顺序里有 forfeit', o.indexOf('forfeit') >= 0, o.join(','));
  ok('默认顺序里有 warnings', o.indexOf('warnings') >= 0, o.join(','));
  ok('判负排在警告之前（先判负、再警告）',
    o.indexOf('forfeit') < o.indexOf('warnings'), o.join(','));
  ok('判负紧跟积分之后（优先于其它小分）', o.indexOf('forfeit') === o.indexOf('points') + 1, o.join(','));
  ok('新建赛事已带 penTieMigrated 标记', t.scoring.penTieMigrated === true);

  ok('M.stageTieKey(0) = stageP0', M.stageTieKey(0) === 'stageP0', M.stageTieKey(0));
  ok('M.stageTieKey(2) = stageP2', M.stageTieKey(2) === 'stageP2', M.stageTieKey(2));
  ok('M.stageTieIdx(stageP3) = 3', M.stageTieIdx('stageP3') === 3, M.stageTieIdx('stageP3'));
  ok('M.stageTieIdx(其它) = -1', M.stageTieIdx('points') === -1 && M.stageTieIdx(null) === -1);
  ok('顶部中文名 = 第 3 阶段得分', M.tieName('stageP2') === '第 3 阶段得分', M.tieName('stageP2'));
  ok('内置依据中文名不变', M.tieName('forfeit').indexOf('判负') >= 0, M.tieName('forfeit'));
}

/* ================= B. 旧存档补齐 ================= */
section('B. 旧存档补齐判负 / 警告（只补一次）');
{
  const old = {
    id: 'old', name: '旧', v: 1, seed: 1, players: [], format: {},
    scoring: {
      mode: 'result', win: 3, draw: 1, lose: 0, bye: 3,
      tieOrder: ['points', 'buchholz', 'h2h', 'seed', 'manual'],
      tieMigrated: true, manualOrder: {}
    },
    byeRule: 'randomFirst', stages: [], currentStage: 0, status: 'setup', history: []
  };
  S.normalize(old);
  const o = old.scoring.tieOrder;
  ok('补齐了 forfeit / warnings', o.indexOf('forfeit') >= 0 && o.indexOf('warnings') >= 0, o.join(','));
  ok('插在积分后面', o[0] === 'points' && o[1] === 'forfeit' && o[2] === 'warnings', o.join(','));
  ok('标记已迁移', old.scoring.penTieMigrated === true);

  // 用户手动删掉后不再回填
  old.scoring.tieOrder = old.scoring.tieOrder.filter(k => k !== 'forfeit' && k !== 'warnings');
  S.normalize(old);
  S.normalize(old);
  ok('删掉后不被回填', old.scoring.tieOrder.indexOf('forfeit') < 0 &&
    old.scoring.tieOrder.indexOf('warnings') < 0, old.scoring.tieOrder.join(','));
}

/* ================= C. 判负 / 警告 的记录 ================= */
section('C. 警告 / 判负记录');
{
  const t = newTourney(4);
  const s = t.stages[0];
  s.type = 'swiss'; s.rounds = 1;
  E.ensureParticipants(t);
  E.generateRound(t);
  const rd = s.roundsData[0];
  const m = rd.matches[0];

  const p0 = E.penOf(m);
  ok('默认全 0', p0.a.warn === 0 && p0.a.forfeit === 0 && p0.b.warn === 0 && p0.b.forfeit === 0, JSON.stringify(p0));
  ok('默认 penAny = false', E.penAny(m) === false);

  ok('给 A 记 1 次判负', E.penSet(m, 'a', 'forfeit', 2).ok);
  ok('给 B 记 3 次警告', E.penSet(m, 'b', 'warn', 3).ok);
  const p1 = E.penOf(m);
  ok('A 判负 = 2', p1.a.forfeit === 2, JSON.stringify(p1));
  ok('B 警告 = 3', p1.b.warn === 3, JSON.stringify(p1));
  ok('penAny = true', E.penAny(m) === true);

  E.penSet(m, 'a', 'forfeit', -5);
  ok('负数按 0 处理', E.penOf(m).a.forfeit === 0, E.penOf(m).a.forfeit);
  E.penSet(m, 'a', 'warn', 9999);
  ok('超过上限夹到 99', E.penOf(m).a.warn === 99, E.penOf(m).a.warn);
  E.penSet(m, 'a', 'warn', 'abc');
  ok('非法值按 0 处理', E.penOf(m).a.warn === 0, E.penOf(m).a.warn);
  ok('side 非法被拒', E.penSet(m, 'x', 'warn', 1).ok === false);
  ok('kind 非法被拒', E.penSet(m, 'a', 'yellow', 1).ok === false);
  ok('空比赛被拒', E.penSet(null, 'a', 'warn', 1).ok === false);

  // 记警告 / 判负不影响本场胜负
  setRes(m, 'A');
  const w1 = m.result.winner;
  E.penSet(m, 'b', 'forfeit', 2);
  E.penSet(m, 'a', 'warn', 1);
  ok('记判负不改变本场胜者', m.result.winner === w1 && w1 === 'A', m.result.winner);
  ok('记判负不影响已定案状态', m.decided === true);
}

/* ================= D. 判负 / 警告 进入小分 ================= */
section('D. 小分：先比判负、再比警告');
{
  // 4 人一轮：A beats B、C beats D → A/C 同 3 分，B/D 同 0 分
  const t = newTourney(4);
  const s = t.stages[0];
  s.type = 'swiss'; s.rounds = 1;
  t.scoring.tieOrder = ['points', 'forfeit', 'warnings', 'seed'];
  E.ensureParticipants(t);
  E.generateRound(t);
  const rd = s.roundsData[0];
  // 手工指定：A vs B（A 胜）、C vs D（C 胜）
  const mA = rd.matches[0], mB = rd.matches[1];
  const setPair = (m, a, b) => { m.playerA = P(t, a); m.playerB = P(t, b); };
  setPair(mA, 'P1', 'P2'); setPair(mB, 'P3', 'P4');
  setRes(mA, 'A'); setRes(mB, 'A');
  E.finishRound(t, s);

  const before = E.standings(t, { stageIndex: 0 });
  ok('A、C 同为 3 分', statOf(before, 'P1').points === 3 && statOf(before, 'P3').points === 3,
    [statOf(before, 'P1').points, statOf(before, 'P3').points]);

  // A 吃 1 次判负 → C 应该排到 A 前面
  E.penSet(mA, 'a', 'forfeit', 1);
  const st1 = E.standings(t, { stageIndex: 0 });
  ok('A 判负 1 次被统计', statOf(st1, 'P1').forfeits === 1, statOf(st1, 'P1').forfeits);
  ok('同分时判负少的 C 排前', st1[0].name === 'P3' && st1[1].name === 'P1',
    st1.map(x => x.name + ':' + x.points));
  ok('判负也让名次分开（不再都显示第 1）',
    statOf(st1, 'P3').rank === 1 && statOf(st1, 'P1').rank === 2,
    [statOf(st1, 'P3').rank, statOf(st1, 'P1').rank]);

  // 再给 C 记 5 次警告，A 判负 1 次：判负优先 → C 仍在前
  E.penSet(mB, 'a', 'warn', 5);
  const st2 = E.standings(t, { stageIndex: 0 });
  ok('C 警告 5 次被统计', statOf(st2, 'P3').warnings === 5, statOf(st2, 'P3').warnings);
  ok('判负优先于警告：C 仍排在 A 前', st2[0].name === 'P3' && st2[1].name === 'P1',
    st2.map(x => x.name + ':' + x.points + '/' + x.forfeits + '/' + x.warnings));

  // 把顺序改成先警告后判负 → A 应该反超
  t.scoring.tieOrder = ['points', 'warnings', 'forfeit', 'seed'];
  const st3 = E.standings(t, { stageIndex: 0 });
  ok('换顺序后警告优先：A 排到 C 前', st3[0].name === 'P1' && st3[1].name === 'P3',
    st3.map(x => x.name + ':' + x.points + '/' + x.forfeits + '/' + x.warnings));

  // 判负 / 警告都去掉 → 不影响名次
  t.scoring.tieOrder = ['points', 'seed'];
  const st4 = E.standings(t, { stageIndex: 0 });
  ok('去掉两项后按种子排（P1 在前）', st4[0].name === 'P1', st4.map(x => x.name));
  ok('去掉两项后同分又变回并列名次（都是第 1）',
    statOf(st4, 'P1').rank === 1 && statOf(st4, 'P3').rank === 1,
    [statOf(st4, 'P1').rank, statOf(st4, 'P3').rank]);
}

/* ================= E. 逐阶段得分 ================= */
section('E. 逐阶段得分（第 N 阶段得分）');
{
  const t = newTourney(4);
  // 第 1 阶段：2 轮瑞士轮
  const s0 = t.stages[0];
  s0.type = 'swiss'; s0.rounds = 2;
  E.ensureParticipants(t);
  E.generateRound(t);
  playRoundAllA(t, s0, s0.roundsData[0]);
  E.generateRound(t);
  playRoundAllA(t, s0, s0.roundsData[1]);
  s0.status = 'finished';
  const pts0 = E.stageFinalPoints(t, 0);
  ok('第 1 阶段结算有分', Object.keys(pts0).length === 4, JSON.stringify(pts0));

  // 第 2 阶段
  const s1 = M.defaultStage(1);
  s1.type = 'swiss'; s1.rounds = 1;
  s1.participants = t.players.map(p => p.id);
  t.stages.push(s1);
  t.currentStage = 1;
  E.generateRound(t);
  (s1.roundsData[0].matches || []).forEach(m => setRes(m, 'A'));
  E.finishRound(t, s1);

  // 只开「上一阶段得分」，不开逐阶段
  t.scoring.tieOrder = ['points', 'stagePoints', 'seed'];
  let st = E.standings(t, { stageIndex: 1 });
  ok('旧键「上一阶段得分」照旧可用',
    st.every(x => x.stagePoints === (pts0[x.id] || 0)), st.map(x => x.name + ':' + x.stagePoints));
  ok('没用逐阶段键时不填 stagePts', st.every(x => x.stagePts === null),
    st.map(x => x.stagePts && JSON.stringify(x.stagePts)));

  // 打开逐阶段得分
  t.scoring.tieOrder = ['points', 'stageP0', 'seed'];
  st = E.standings(t, { stageIndex: 1 });
  ok('stageP0 已填（= 第 1 阶段最终积分）',
    st.every(x => x.stagePts && x.stagePts[0] === (pts0[x.id] || 0)),
    st.map(x => x.name + ':' + (x.stagePts && x.stagePts[0]) + ' vs ' + (pts0[x.id] || 0)));

  // 比较器真的按它排序：把某人第 1 阶段分抬高，它就该排前
  // （直接改 stats 输入，验证 makeComparator 的取值口径）
  const ids = t.players.map(p => p.id);
  const stats = E.buildStats(t, s1, ids, null);
  Object.keys(stats).forEach(id => { stats[id].points = 0; stats[id].stagePts = { 0: 0 }; });
  stats[P(t, 'P4')].stagePts[0] = 99;
  const h2h = E.buildH2H(t, s1, null);
  const cmp = E.makeComparator(t, stats, h2h, E.scOf(t, s1));
  const sorted = ids.slice().sort(cmp);
  ok('比较器按「第 1 阶段得分」排序', sorted[0] === P(t, 'P4'),
    sorted.map(id => t.players.filter(p => p.id === id)[0].name).join(','));

  // 越界的阶段下标不会崩、按 0 处理
  t.scoring.tieOrder = ['points', 'stageP5', 'seed'];
  let crashed = null, st2 = null;
  try { st2 = E.standings(t, { stageIndex: 1 }); } catch (e) { crashed = e.message; }
  ok('越界阶段键不报错', !crashed && st2 && st2.length === 4, crashed);
}

/* ================= F. 阶段覆盖时也跟随 ================= */
section('F. 阶段独立记分里的逐阶段键');
{
  const t = newTourney(4);
  const s0 = t.stages[0];
  s0.type = 'swiss'; s0.rounds = 1;
  E.ensureParticipants(t);
  E.generateRound(t);
  playRoundAllA(t, s0, s0.roundsData[0]);
  s0.status = 'finished';

  const s1 = M.defaultStage(1);
  s1.type = 'swiss'; s1.rounds = 1;
  s1.participants = t.players.map(p => p.id);
  s1.useScoring = true;
  s1.scoring = Object.assign(M.defaultScoring(), { tieOrder: ['points', 'stageP0', 'seed'] });
  t.stages.push(s1);
  t.currentStage = 1;
  E.generateRound(t);
  (s1.roundsData[0].matches || []).forEach(m => setRes(m, 'A'));
  E.finishRound(t, s1);

  const pts0 = E.stageFinalPoints(t, 0);
  const st = E.standings(t, { stageIndex: 1 });
  ok('阶段独立记分也认 stageP0',
    st.every(x => x.stagePts && x.stagePts[0] === (pts0[x.id] || 0)),
    st.map(x => x.name + ':' + (x.stagePts && x.stagePts[0])));
}

console.log('\n==== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 ====');
process.exit(fail ? 1 : 0);
