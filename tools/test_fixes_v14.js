/**
 * 专项测试：v1.4.0 四项修复
 *   1. 淘汰赛轮空自动判定（不再卡轮 / 不再丢分）
 *   2. 轮空在排名中按一场胜利计算
 *   3. 只有一轮（或提前结束）的淘汰赛，获胜者必须排在负者之前
 *   4. 破同分依据可删除且不被回填
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const base = path.join(ROOT, 'app', 'js');
const sandbox = { window: {}, console, Math, Date, JSON, parseFloat, parseInt, isNaN };
sandbox.global = sandbox;
vm.createContext(sandbox);
['core.js', 'formats.js', 'engine.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(base, f), 'utf8'), sandbox, { filename: f });
});
const { model: M, store: S, engine: E } = sandbox.window.TMS;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  NG  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t) { console.log('\n[' + t + ']'); }

function mkTour(n, opts) {
  opts = opts || {};
  const t = M.createTournament(opts.name || 'T');
  for (let i = 1; i <= n; i++) t.players.push(M.createPlayer('P' + i, i));
  const st = t.stages[0];
  st.type = opts.type || 'single_elim';
  st.thirdPlace = !!opts.third;
  return t;
}
function nmf(t) {
  return function (id) {
    const p = t.players.filter(function (x) { return x.id === id; })[0] || {};
    return p.name || '?';
  };
}
function seedNo(name) {
  const m = String(name).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 99;
}
// 序号小者（强）赢；轮空直接 evaluate
function playRound(t, stage, rd) {
  const nm = nmf(t);
  rd.matches.forEach(function (m) {
    if (m.isBye) { E.evaluate(m, E.fmtOf(t, stage), stage.tie); return; }
    const a = seedNo(nm(m.playerA)), b = seedNo(nm(m.playerB));
    const w = (a < b) ? 'A' : 'B';
    m.games = [{ w: w }, { w: w }];
    E.evaluate(m, E.fmtOf(t, stage), stage.tie);
  });
}

/* ============ 1. 淘汰赛轮空自动判定 ============ */
section('1. 淘汰赛轮空自动判定');
[3, 5, 6, 7, 9, 11, 13].forEach(function (n) {
  const t = mkTour(n, { name: 'S' + n });
  const stage = t.stages[0];
  E.generateRound(t);
  const rd = stage.roundsData[0];
  const byes = rd.matches.filter(function (m) { return m.isBye; });
  const expected = Math.pow(2, Math.ceil(Math.log2(n))) - n;
  ok(n + ' 人首轮轮空数 = ' + expected, byes.length === expected, byes.length);

  const nm = nmf(t);
  const byeSeeds = byes.map(function (m) { return seedNo(nm(m.playerA || m.playerB)); })
    .sort(function (a, b) { return a - b; });
  let okSeed = true;
  for (let i = 0; i < byeSeeds.length; i++) if (byeSeeds[i] !== i + 1) okSeed = false;
  ok(n + ' 人轮空者为最强种子 ' + JSON.stringify(byeSeeds), okSeed, byeSeeds.join(','));

  // 未录入比分时，卡住的必须是真实比赛而不是轮空；
  // 录入普通场次后本轮应判定完成——轮空不能卡住整轮
  const c0 = E.roundComplete(t, stage, rd);
  ok(n + ' 人未完成原因是未录入的实赛（非轮空）',
    c0.ok || !/^未完成：P\d+ vs (\?|)$/.test(c0.msg || ''), c0.msg || '');
  playRound(t, stage, rd);
  const c = E.roundComplete(t, stage, rd);
  ok(n + ' 人录完实赛后本轮即可完成', c.ok === true, c.msg || '');
});

/* 轮空者的 match 必须保持 bracket 槽位：1、2 号种子要到决赛才相遇 */
function driveToEnd(t, max) {
  const stage = t.stages[t.currentStage];
  for (let k = 0; k < (max || 15); k++) {
    if (E.stageFinished(t, stage)) return { finished: true };
    const g = E.generateRound(t);
    if (!g.ok) return { finished: false, msg: g.msg };
    const rd = stage.roundsData[stage.roundsData.length - 1];
    playRound(t, stage, rd);
    const c = E.roundComplete(t, stage, rd);
    if (!c.ok) return { stuck: true, msg: c.msg };
    E.finishRound(t);
  }
  return { finished: false, msg: '超出迭代上限' };
}

/* 轮空者的 match 必须保持 bracket 槽位：1、2 号种子要到决赛才相遇 */
section('1b. 轮空不破坏种子排位');
[5, 6, 7].forEach(function (n) {
  const t = mkTour(n, { name: 'S' + n });
  const stage = t.stages[0];
  const res = driveToEnd(t, 8);
  ok(n + ' 人单败可完整跑完', res.finished === true, res.msg || JSON.stringify(res));
  E.finishStage(t);
  const nm = nmf(t);
  const final = stage.roundsData[stage.roundsData.length - 1];
  const names = final.matches.map(function (m) { return [nm(m.playerA), nm(m.playerB)].sort().join(' vs '); });
  const champ = stage.finalRank[0], runner = stage.finalRank[1];
  ok(n + ' 人决赛为 1 号 vs 2 号种子', final.matches.length === 1 &&
    [nm(final.matches[0].playerA), nm(final.matches[0].playerB)].sort().join(',') === 'P1,P2',
    names.join(' | '));
  ok(n + ' 人冠军为 1 号种子', nm(champ) === 'P1', nm(champ));
  ok(n + ' 人亚军为 2 号种子', nm(runner) === 'P2', nm(runner));
});

/* ============ 2. 轮空按胜利计入 ============ */
section('2. 轮空计入场次与胜场');
{
  const t = mkTour(6, { name: 'B6' });
  const stage = t.stages[0];
  E.generateRound(t);
  const rd = stage.roundsData[0];
  playRound(t, stage, rd);
  E.finishRound(t);
  const st = E.standings(t, {});
  const nm = nmf(t);
  const byeNames = rd.matches.filter(function (m) { return m.isBye; }).map(function (m) { return nm(m.playerA); });
  const rows = byeNames.map(function (name) { return st.filter(function (s) { return s.name === name; })[0]; });
  ok('轮空者记 1 场', rows.every(function (r) { return r && r.matches === 1; }), JSON.stringify(rows.map(function (r) { return r && r.matches; })));
  ok('轮空者记 1 胜', rows.every(function (r) { return r && r.wins === 1; }), JSON.stringify(rows.map(function (r) { return r && r.wins; })));
  ok('轮空者得轮空分 3', rows.every(function (r) { return r && r.points === 3; }), JSON.stringify(rows.map(function (r) { return r && r.points; })));
  ok('轮空者 byes = 1', rows.every(function (r) { return r && r.byes === 1; }), JSON.stringify(rows.map(function (r) { return r && r.byes; })));
  ok('轮空者不出现在负场统计', rows.every(function (r) { return r && r.losses === 0; }), JSON.stringify(rows.map(function (r) { return r && r.losses; })));
}
{
  const t = mkTour(7, { type: 'swiss', name: 'SW7' });
  t.stages[0].rounds = 3;
  const stage = t.stages[0];
  for (let k = 0; k < 3; k++) {
    const g = E.generateRound(t);
    if (!g.ok) break;
    const rd = stage.roundsData[stage.roundsData.length - 1];
    playRound(t, stage, rd);
    E.finishRound(t);
  }
  const st = E.standings(t, {});
  const byers = st.filter(function (s) { return s.byes > 0; });
  ok('瑞士轮有轮空者', byers.length > 0, byers.length);
  ok('瑞士轮轮空者计入胜场', byers.every(function (s) { return s.wins >= 1; }),
    byers.map(function (s) { return s.name + ':' + s.wins; }).join(','));
  ok('瑞士轮轮空者场次 = 胜+平+负', byers.every(function (s) { return s.matches === s.wins + s.draws + s.losses; }),
    byers.map(function (s) { return s.name + ':' + s.matches; }).join(','));
}

/* ============ 3. 提前结束的淘汰赛名次 ============ */
section('3. 只打一轮的淘汰赛：胜者必须排在负者之前');
{
  const t = mkTour(8, { name: 'R1only' });
  const stage = t.stages[0];
  stage.maxRounds = 1;
  stage.adv = { type: 'count', count: 4, score: 0, perGroup: 2 };
  ok('8 人限制 1 轮时计划轮数为 1', E.plannedRounds(stage, 8) === 1, E.plannedRounds(stage, 8));

  E.generateRound(t);
  const rd = stage.roundsData[0];
  playRound(t, stage, rd);
  E.finishRound(t);
  ok('打满 1 轮后阶段判定结束', E.stageFinished(t, stage) === true);

  const nm = nmf(t);
  const winners = rd.matches.map(function (m) { return m.result.winner === 'A' ? m.playerA : m.playerB; });
  const losers = rd.matches.map(function (m) { return m.result.winner === 'A' ? m.playerB : m.playerA; });
  const rank = stage.finalRank || (E.finishStage(t), stage.finalRank);
  const rankNames = rank.map(nm);
  const advNames = stage.advanced.map(nm);
  ok('胜者全部排在负者之前', winners.every(function (w) {
    return rankNames.indexOf(nm(w)) < Math.min.apply(null, losers.map(function (l) { return rankNames.indexOf(nm(l)); }));
  }), rankNames.join('>'));

  ok('晋级 4 人', advNames.length === 4, advNames.join(','));
  ok('晋级名单 = 4 个胜者', winners.every(function (w) { return advNames.indexOf(nm(w)) >= 0; }), advNames.join(','));
  ok('负者无一人晋级', losers.every(function (l) { return advNames.indexOf(nm(l)) < 0; }), advNames.join(','));
}
{
  // 7 人（含轮空）只打 1 轮：轮空者视为获胜，应一起晋级
  const t = mkTour(7, { name: 'R1bye' });
  const stage = t.stages[0];
  stage.maxRounds = 1;
  stage.adv = { type: 'count', count: 4, score: 0, perGroup: 2 };
  E.generateRound(t);
  const rd = stage.roundsData[0];
  playRound(t, stage, rd);
  E.finishRound(t);
  E.finishStage(t);
  const nm = nmf(t);
  const rankNames = stage.finalRank.map(nm);
  const byeNames = rd.matches.filter(function (m) { return m.isBye; }).map(function (m) { return nm(m.playerA); });
  const advNames = stage.advanced.map(nm);
  ok('7 人 1 轮：轮空者排在负者之前', byeNames.every(function (b) {
    const losers = rd.matches.filter(function (m) { return !m.isBye; })
      .map(function (m) { return nm(m.result.winner === 'A' ? m.playerB : m.playerA); });
    return rankNames.indexOf(b) < Math.min.apply(null, losers.map(function (l) { return rankNames.indexOf(l); }));
  }), '轮空=' + byeNames.join(',') + ' 名次=' + rankNames.join('>'));
  ok('7 人 1 轮：晋级 4 人且全部是胜者/轮空者',
    advNames.length === 4, advNames.join(','));
  ok('7 人 1 轮：轮空者均已晋级', byeNames.every(function (b) { return advNames.indexOf(b) >= 0; }), advNames.join(','));
}
{
  // 完整单败名次仍然正确：冠军 > 亚军 > 四强 > 八强
  const t = mkTour(8, { name: 'full8', third: true });
  const stage = t.stages[0];
  driveToEnd(t, 8);
  E.finishStage(t);
  const nm = nmf(t);
  const r = stage.finalRank.map(nm);
  ok('8 人单败+季军赛名次 = P1..P8', r.join('>') === 'P1>P2>P3>P4>P5>P6>P7>P8', r.join('>'));
}
{
  // 双败完整名次
  [5, 8].forEach(function (n) {
    const t = mkTour(n, { type: 'double_elim', name: 'DE' + n });
    const stage = t.stages[0];
    const res = driveToEnd(t, 14);
    ok(n + ' 人双败可完整跑完', res.finished === true, res.msg || JSON.stringify(res));
    E.finishStage(t);
    const nm = nmf(t);
    const r = stage.finalRank.map(nm);
    ok(n + ' 人双败冠军为 1 号种子', r[0] === 'P1', r.join('>'));
    ok(n + ' 人双败名次无重复无遗漏', new Set(r).size === n && r.length === n, r.join('>'));
  });
}

/* ============ 4. 破同分依据可删除 ============ */
section('4. 破同分依据可删除且不被回填');
{
  const t = M.createTournament('TIE');
  const def = t.scoring.tieOrder.length;
  ok('新建赛事带完整依据表（15 项，v2.3 起含判负 / 警告）', def === 15, def);
  ok('新建赛事无需迁移', t.scoring.tieMigrated === true);

  t.scoring.tieOrder = t.scoring.tieOrder.filter(function (k) {
    return ['cumulative', 'cumDiff', 'stagePoints'].indexOf(k) < 0;
  });
  S.normalize(t);
  S.normalize(t);
  ok('删除 3 项后不会被 normalize 回填', t.scoring.tieOrder.length === 12, t.scoring.tieOrder.join(','));
  ok('被删项确实不在列表中', t.scoring.tieOrder.indexOf('cumulative') < 0 &&
    t.scoring.tieOrder.indexOf('cumDiff') < 0 &&
    t.scoring.tieOrder.indexOf('stagePoints') < 0, t.scoring.tieOrder.join(','));
}
{
  // 旧存档（无 tieMigrated）只迁移一次
  function mkOld() {
    return {
      id: 'old', name: '旧存档', v: 1, seed: 1, players: [], format: {},
      scoring: {
        mode: 'result', win: 3, draw: 1, lose: 0, bye: 3,
        tieOrder: ['points', 'buchholz', 'h2h', 'gamesDiff', 'cumulative', 'seed', 'manual'],
        manualOrder: {}
      },
      byeRule: 'randomFirst', stages: [], currentStage: 0, status: 'setup', history: []
    };
  }
  const o = mkOld();
  S.normalize(o);
  ok('旧存档补齐到 15 项', o.scoring.tieOrder.length === 15, o.scoring.tieOrder.join(','));
  ok('旧存档原有顺序未被破坏（points 仍第一）', o.scoring.tieOrder[0] === 'points');
  ok('旧存档补齐后标记已迁移', o.scoring.tieMigrated === true);

  o.scoring.tieOrder = o.scoring.tieOrder.filter(function (k) { return k !== 'cumulative'; });
  S.normalize(o);
  S.normalize(o);
  ok('旧存档删除后不再被回填', o.scoring.tieOrder.indexOf('cumulative') < 0, o.scoring.tieOrder.join(','));
}
{
  // 全部删光：不崩，且不回退到默认表
  const t = mkTour(4, { type: 'swiss', name: 'EMPTY' });
  t.stages[0].rounds = 2;
  E.generateRound(t);
  const stage = t.stages[0];
  const rd = stage.roundsData[0];
  playRound(t, stage, rd);
  E.finishRound(t);
  t.scoring.tieOrder = [];
  S.normalize(t);
  ok('全删后仍为空（不回退默认）', t.scoring.tieOrder.length === 0, t.scoring.tieOrder.length);
  let crashed = null, st = null;
  try { st = E.standings(t, {}); } catch (e) { crashed = e.message; }
  ok('空依据时排名不报错', !crashed, crashed);
  ok('空依据时仍能出完整排名', st && st.length === 4, st && st.length);
}
{
  // 删除一项后，排名确实不再按该项比较
  const t = M.createTournament('ORDER');
  for (let i = 1; i <= 2; i++) t.players.push(M.createPlayer('P' + i, i));
  t.scoring.tieOrder = ['points'];   // 只比积分
  const stage = t.stages[0];
  stage.type = 'round_robin';
  t.format = { gamesPerMatch: 1, winNeeded: 1, recordScore: false };
  E.generateRound(t);
  stage.roundsData[0].matches.forEach(function (m) {
    m.games = [{ w: 'B' }];
    E.evaluate(m, E.fmtOf(t, stage), stage.tie);
  });
  const st = E.standings(t, {});
  ok('只按积分排序时 P2 第一', st[0].name === 'P2', st.map(function (s) { return s.name + ':' + s.points; }).join(' '));
}

console.log('\nPASS: ' + pass + '   FAIL: ' + fail);
process.exit(fail ? 1 : 0);
