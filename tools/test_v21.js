/**
 * v1.11.0 引擎测试
 *  A. 合并对阵图：多个淘汰赛阶段接成一条路径（阶段数 / 列数 / 晋级衔接 / 总冠军）
 *  B. 只合并「淘汰赛」阶段：瑞士轮 / 小组赛不进入合并图
 *  C. 进行中的阶段：没有冠军、finished=false
 *  D. 边界：无对阵 / 单阶段 / 空赛事
 *  E. 合并对阵图的打印文本（exporter）
 *  F. 阶段索引与 bracketPlan 结果一致（合并不改变任何一张图本身）
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
const { model: M, engine: E, exporter: X } = TMSW;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra === undefined ? '' : '  →  ' + JSON.stringify(extra))); }
}
function sec(t) { console.log('\n[' + t + ']'); }

function mkTournament(n, name) {
  const t = M.createTournament(name || 'T');
  for (let i = 1; i <= n; i++) t.players.push(M.createPlayer('P' + i, i));
  t.status = 'running';
  t.format.recordScore = true;
  return t;
}

/* 把当前阶段打到底：生成一轮 → 全判 A 胜 → 结算，直到生成不出新一轮 */
function runStage(t, si) {
  t.currentStage = si;
  for (let guard = 0; guard < 30; guard++) {
    const g = E.generateRound(t);
    if (!g || !g.ok) break;
    const st = t.stages[si];
    const rd = st.roundsData[st.roundsData.length - 1];
    (rd.matches || []).forEach(function (m) {
      if (m.isBye) return;
      m.games = [{ w: 'A', a: 1, b: 0 }, { w: 'A', a: 1, b: 0 }];
      E.evaluate(m, E.fmtOfMatch(t, st, m), st.tie);
    });
    E.finishRound(t);
    // 双败结算后才会推进胜/败者组；普通淘汰赛到轮数就应停
    if (E.stageFinished(t, st)) break;
  }
  return E.finishStage(t);
}

/* 8 人 → 取 2 → 打到冠军：两个单败阶段 */
function twoStages() {
  const t = mkTournament(8, '两阶段');
  const s0 = M.defaultStage(0); s0.type = 'single_elim'; s0.name = '八强赛';
  s0.adv = { type: 'count', count: 2, score: 0, perGroup: 1 };
  s0.participants = t.players.map(function (p) { return p.id; });
  const s1 = M.defaultStage(1); s1.type = 'single_elim'; s1.name = '决赛阶段';
  s1.adv = { type: 'count', count: 1, score: 0, perGroup: 1 };
  t.stages = [s0, s1];
  E.ensureParticipants(t);
  runStage(t, 0);
  E.ensureParticipants(t);
  runStage(t, 1);
  return t;
}

/* ========================= A. 两阶段合并 ========================= */
sec('A. 两个淘汰赛阶段 → 一张合并图');
(function () {
  const t = twoStages();
  const mp = E.mergedBracketPlan(t);
  ok('A1 ok = true', mp.ok === true, mp.ok);
  ok('A2 合并了 2 个阶段', mp.stages.length === 2, mp.stages.length);
  ok('A3 阶段顺序 = 赛事阶段顺序', mp.stages[0].si === 0 && mp.stages[1].si === 1,
    mp.stages.map(function (s) { return s.si; }));
  ok('A4 总列数 = 各阶段列数之和',
    mp.totalCols === mp.stages[0].cols + mp.stages[1].cols, { total: mp.totalCols, cols: mp.stages.map(function (s) { return s.cols; }) });
  ok('A5 阶段 1 是 8 人取 2 人', mp.stages[0].people === 8 && mp.stages[0].target === 2,
    { people: mp.stages[0].people, target: mp.stages[0].target });
  ok('A6 阶段 1 晋级 2 人，且写在合并图上',
    mp.stages[0].advancedNames.length === 2, mp.stages[0].advancedNames);
  ok('A7 阶段 2 的参赛者 = 阶段 1 的晋级者',
    JSON.stringify(t.stages[1].participants.slice().sort()) ===
    JSON.stringify(t.stages[0].advanced.slice().sort()),
    { p2: t.stages[1].participants, adv: t.stages[0].advanced });
  ok('A8 阶段 1 被提前掐断 → 没有阶段冠军', !mp.stages[0].champion, mp.stages[0].championName);
  ok('A9 最后阶段有冠军', !!mp.stages[1].championName, mp.stages[1].championName);
  ok('A10 总冠军 = 最后阶段冠军', !!mp.championName && mp.champion === mp.stages[1].champion,
    { champ: mp.championName, stage: mp.stages[1].championName });
  ok('A11 阶段状态：都已结束',
    mp.stages.every(function (s) { return s.finished === true; }),
    mp.stages.map(function (s) { return s.status; }));
  ok('A12 note 里写清阶段数与列数',
    mp.note.indexOf('2 个淘汰赛阶段') >= 0 && mp.note.indexOf(String(mp.totalCols) + ' 列') >= 0, mp.note);
})();

/* ========================= B. 只合并淘汰赛 ========================= */
sec('B. 瑞士轮 / 小组赛不进入合并图');
(function () {
  const t = mkTournament(8, '混合赛制');
  const s0 = M.defaultStage(0); s0.type = 'swiss'; s0.name = '瑞士轮'; s0.rounds = 2;
  s0.participants = t.players.map(function (p) { return p.id; });
  s0.adv = { type: 'count', count: 4, score: 0, perGroup: 1 };
  const s1 = M.defaultStage(1); s1.type = 'single_elim'; s1.name = '四强淘汰';
  s1.adv = { type: 'count', count: 2, score: 0, perGroup: 1 };
  const s2 = M.defaultStage(2); s2.type = 'double_elim'; s2.name = '双败决赛';
  s2.adv = { type: 'count', count: 1, score: 0, perGroup: 1 };
  t.stages = [s0, s1, s2];
  E.ensureParticipants(t);
  runStage(t, 0);
  E.ensureParticipants(t);
  runStage(t, 1);
  E.ensureParticipants(t);
  runStage(t, 2);

  const mp = E.mergedBracketPlan(t);
  ok('B1 只合并 2 个淘汰赛阶段（瑞士轮被排除）', mp.stages.length === 2, mp.stages.map(function (s) { return s.name; }));
  ok('B2 阶段索引 = 1、2', mp.stages[0].si === 1 && mp.stages[1].si === 2,
    mp.stages.map(function (s) { return s.si; }));
  ok('B3 第二个是双败（plan.type = double）', mp.stages[1].type === 'double_elim' &&
    mp.stages[1].plan.type === 'double', mp.stages[1].plan && mp.stages[1].plan.type);
  ok('B4 双败阶段含胜者组 / 败者组两行', mp.stages[1].plan.rows.length === 2,
    mp.stages[1].plan.rows.map(function (r) { return r.key; }));
  ok('B5 双败总决赛在最右列（gf 列存在）',
    (mp.stages[1].plan.rows[0].gf || []).length >= 1,
    (mp.stages[1].plan.rows[0].gf || []).length);
  ok('B6 双败阶段冠军 = 总冠军', !!mp.championName && mp.championStage === 2,
    { champ: mp.championName, at: mp.championStage });
  ok('B7 elimStageIndexes 只回淘汰赛阶段', JSON.stringify(E.elimStageIndexes(t)) === JSON.stringify([1, 2]),
    E.elimStageIndexes(t));
})();

/* ========================= C. 进行中的阶段 ========================= */
sec('C. 进行中的阶段：无冠军');
(function () {
  const t = mkTournament(8, '进行中');
  const s0 = M.defaultStage(0); s0.type = 'single_elim'; s0.name = '八强';
  s0.adv = { type: 'count', count: 4, score: 0, perGroup: 1 };
  s0.participants = t.players.map(function (p) { return p.id; });
  const s1 = M.defaultStage(1); s1.type = 'single_elim'; s1.name = '决赛';
  s1.adv = { type: 'count', count: 1, score: 0, perGroup: 1 };
  t.stages = [s0, s1];
  E.ensureParticipants(t);
  runStage(t, 0);
  E.ensureParticipants(t);
  t.currentStage = 1;
  E.generateRound(t);          // 只生成、不打完

  const mp = E.mergedBracketPlan(t);
  ok('C1 进行中的阶段也出现在合并图里', mp.stages.length === 2, mp.stages.length);
  ok('C2 进行中的阶段没有冠军', !mp.stages[1].championName, mp.stages[1].championName);
  ok('C3 finished = false', mp.stages[1].finished === false, mp.stages[1].finished);
  ok('C4 总冠军为空（还没打完）', !mp.championName, mp.championName);
  ok('C5 晋级名单已产生（阶段 1）', mp.stages[0].advancedNames.length === 4,
    mp.stages[0].advancedNames);
})();

/* ========================= D. 边界 ========================= */
sec('D. 边界情况');
(function () {
  const empty = M.createTournament('空赛事');
  const mp0 = E.mergedBracketPlan(empty);
  ok('D1 没有阶段 → ok=false，不报错', mp0.ok === false && mp0.stages.length === 0, mp0.ok);

  const t1 = mkTournament(4, '单阶段');
  const s0 = M.defaultStage(0); s0.type = 'single_elim'; s0.name = '直接淘汰';
  s0.participants = t1.players.map(function (p) { return p.id; });
  t1.stages = [s0];
  E.ensureParticipants(t1);
  runStage(t1, 0);
  const mp1 = E.mergedBracketPlan(t1);
  ok('D2 单个淘汰赛阶段 → ok=true，1 个阶段', mp1.ok === true && mp1.stages.length === 1, mp1.stages.length);
  ok('D3 单阶段时 note 说明无需合并', mp1.note.indexOf('只有 1 个') >= 0, mp1.note);
  ok('D4 单阶段也有冠军', !!mp1.championName, mp1.championName);

  // 生成了阶段但还没有任何一轮
  const t2 = mkTournament(4, '未生成');
  const s1 = M.defaultStage(0); s1.type = 'double_elim';
  s1.participants = t2.players.map(function (p) { return p.id; });
  t2.stages = [s1];
  const mp2 = E.mergedBracketPlan(t2);
  ok('D5 淘汰赛阶段还没生成对阵 → 不进入合并图', mp2.ok === false && mp2.stages.length === 0,
    mp2.stages.length);

  // 全是瑞士轮
  const t3 = mkTournament(4, '纯瑞士');
  const s3 = M.defaultStage(0); s3.type = 'swiss'; s3.rounds = 1;
  s3.participants = t3.players.map(function (p) { return p.id; });
  t3.stages = [s3];
  E.ensureParticipants(t3); runStage(t3, 0);
  const mp3 = E.mergedBracketPlan(t3);
  ok('D6 纯瑞士轮赛事 → 没有可合并的淘汰赛阶段', mp3.ok === false, mp3.ok);
  ok('D7 elimStageIndexes 对空赛事安全', JSON.stringify(E.elimStageIndexes(null)) === '[]');
})();

/* ========================= E. 打印文本 ========================= */
sec('E. 合并对阵图的打印 / PDF 文本');
(function () {
  const t = twoStages();
  const html = X.mergedBracketHTML(t);
  ok('E1 标题含赛事名与「淘汰赛合并对阵图」',
    html.indexOf('淘汰赛合并对阵图') >= 0 && html.indexOf(t.name) >= 0);
  ok('E2 两个阶段各自有标题', html.indexOf('八强赛') >= 0 && html.indexOf('决赛阶段') >= 0);
  ok('E3 写了「晋级 … 进入下一阶段」', html.indexOf('晋级') >= 0 && html.indexOf('进入') >= 0);
  ok('E4 最后一行有总冠军', html.indexOf('总冠军') >= 0 && html.indexOf('总冠军：') >= 0, null);
  ok('E5 没有重复的赛事标题（noTitle 生效）',
    (html.match(/· 淘汰赛合并对阵图/g) || []).length === 1,
    (html.match(/· 淘汰赛合并对阵图/g) || []).length);

  // 单阶段也能导出
  const t1 = mkTournament(4, '单阶段导出');
  const s0 = M.defaultStage(0); s0.type = 'single_elim';
  s0.participants = t1.players.map(function (p) { return p.id; });
  t1.stages = [s0];
  E.ensureParticipants(t1); runStage(t1, 0);
  const html1 = X.mergedBracketHTML(t1);
  ok('E6 单阶段也能导出（含冠军行）', html1.indexOf('总冠军') >= 0);

  // 完全没有淘汰赛阶段
  const t2 = mkTournament(4, '空');
  ok('E7 没有淘汰赛阶段时给出提示而不是报错',
    X.mergedBracketHTML(t2).indexOf('还没有任何淘汰赛阶段') >= 0);
})();

/* ========================= F. 合并不改变单张图 ========================= */
sec('F. 合并视图与单阶段视图一致');
(function () {
  const t = twoStages();
  const mp = E.mergedBracketPlan(t);
  const single0 = E.bracketPlan(t, t.stages[0]);
  const single1 = E.bracketPlan(t, t.stages[1]);
  ok('F1 阶段 1 的列名与独立视图一致',
    JSON.stringify(mp.stages[0].plan.rows[0].cols.map(function (c) { return c.name; })) ===
    JSON.stringify(single0.rows[0].cols.map(function (c) { return c.name; })));
  ok('F2 阶段 2 的卡片数与独立视图一致',
    mp.stages[1].plan.rows[0].cols.reduce(function (a, c) { return a + c.cards.length; }, 0) ===
    single1.rows[0].cols.reduce(function (a, c) { return a + c.cards.length; }, 0));
  ok('F3 列数不因合并而改变',
    mp.stages[0].cols === single0.totalCols && mp.stages[1].cols === single1.totalCols,
    { m: [mp.stages[0].cols, mp.stages[1].cols], s: [single0.totalCols, single1.totalCols] });
  ok('F4 每张卡都写清了「胜 → / 负 →」', mp.stages[1].plan.rows[0].cols[0].cards.every(function (cd) {
    return !!cd.winTo && !!cd.loseTo;
  }), mp.stages[1].plan.rows[0].cols[0].cards);
})();

console.log('\n================  v1.11.0 引擎：' + pass + ' 项通过，' + fail + ' 项失败  ================');
process.exit(fail ? 1 : 0);
