/* 验收测试：完整赛事流程 + 用户新增的 3 项规则（自定义公式 / 季军赛开关 / 多赛事） */
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
const { util: U, model: M, engine: E, formats: F, store: S } = TMS;

let pass = 0, fail = 0;
const ok = (n, c, e) => { c ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (e ? ' -> ' + e : ''))); };
const sec = t => console.log('\n=== ' + t + ' ===');

/* ---------- A. 自定义公式 ---------- */
sec('A. 自定义公式记分');
{
  const t = M.createTournament('公式测试');
  t.scoring.mode = 'formula';
  t.scoring.formula = 'w*3 + d*1';
  t.format = { gamesPerMatch: 1, winNeeded: 1, recordScore: false };
  ['A', 'B'].forEach(n => t.players.push(M.createPlayer('P' + n, n === 'A' ? 1 : 2)));

  const m = { id: 'm1', playerA: t.players[0].id, playerB: t.players[1].id, isBye: false, games: [{ w: 'A' }], override: null };
  E.evaluate(m, t.format, t.scoring.mode === 'formula' ? 'draw_ok' : t.scoring.mode);
  ok('公式 w*3+d：胜方得3', E.pointsFrom(m, 'A', t.scoring, t.format) === 3, E.pointsFrom(m, 'A', t.scoring, t.format));
  ok('公式 w*3+d：负方得0', E.pointsFrom(m, 'B', t.scoring, t.format) === 0);

  t.scoring.formula = 'gw*2';
  ok('公式 gw*2：赢1局得2', E.pointsFrom(m, 'A', t.scoring, t.format) === 2, E.pointsFrom(m, 'A', t.scoring, t.format));

  t.scoring.formula = 'w*3+d+gd*0.1';
  const v = E.pointsFrom(m, 'A', t.scoring, t.format);
  ok('公式含括号/小数：3+0.1=3.1', Math.abs(v - 3.1) < 1e-9, String(v));

  t.scoring.formula = 'w*((3+2)/5)';
  ok('公式支持括号优先级：=1', Math.abs(E.pointsFrom(m, 'A', t.scoring, t.format) - 1) < 1e-9);

  t.scoring.formula = 'w*3 +@@@';
  var bad = E.validateFormula(t.scoring.formula);
  ok('非法公式被校验拦截', bad.ok === false, JSON.stringify(bad));
  var val = E.pointsFrom(m, 'A', t.scoring, t.format);
  ok('非法公式不崩溃（返回有限数）', typeof val === 'number' && isFinite(val), String(val));

  ok('合法公式通过校验', E.validateFormula('w*3 + d*1 + gd*0.1').ok === true);
  ok('空公式被拦截', E.validateFormula('').ok === false);
  ok('括号不匹配被拦截', E.validateFormula('(w*3').ok === false);
  ok('未知变量被拦截', E.validateFormula('w*3+zzz').ok === false);
}

/* ---------- B. 季军争夺战开关 ---------- */
sec('B. 单败淘汰季军争夺战');
{
  const mk = (third) => {
    const t = M.createTournament(third ? '含季军' : '无季军');
    t.stages[0].type = 'single_elim';
    t.stages[0].thirdPlace = third;
    for (let i = 1; i <= 8; i++) t.players.push(M.createPlayer('P' + i, i));
    let guard = 0;
    while (guard++ < 12 && !E.stageFinished(t, t.stages[0])) {
      const r = E.generateRound(t);
      if (!r.ok) break;
      const rd = t.stages[0].roundsData[t.stages[0].roundsData.length - 1];
      rd.matches.forEach(mm => {
        if (mm.isBye) return;
        mm.games.push({ w: 'A' }, { w: 'A' });
        E.evaluate(mm, t.format, t.stages[0].tie);
      });
    }
    return t;
  };
  const a = mk(true), b = mk(false);
  const lastA = a.stages[0].roundsData[a.stages[0].roundsData.length - 1];
  const lastB = b.stages[0].roundsData[b.stages[0].roundsData.length - 1];
  ok('开启季军赛：决赛轮 2 场', lastA.matches.length === 2, lastA.matches.length);
  ok('其中一场标记为季军赛', lastA.matches.some(m => m.isThird === true));
  ok('关闭季军赛：决赛轮 1 场', lastB.matches.length === 1, lastB.matches.length);

  // 最终名次：冠军 + 亚军 + 季军 + 殿军
  E.finishStage(a);
  ok('生成最终名次且人数正确', a.stages[0].finalRank && a.stages[0].finalRank.length === 8, (a.stages[0].finalRank || []).length);
  const names = a.stages[0].finalRank.map(id => t => 0); // placeholder
}

/* ---------- C. 多赛事存储 ---------- */
sec('C. 多赛事存储');
{
  // 用内存 mock localStorage
  const mem = {};
  sandbox.localStorage = {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; }
  };
  vm.runInContext('var localStorage = window.localStorage || localStorage;', sandbox);

  // 重新执行 core.js 以绑定 mock
  const code = fs.readFileSync(path.join(base, 'core.js'), 'utf8');
  const sb2 = { window: {}, console, Math, Date, JSON, parseFloat, parseInt, isNaN, localStorage: sandbox.localStorage };
  sb2.global = sb2;
  vm.createContext(sb2);
  vm.runInContext(code, sb2, { filename: 'core.js' });
  const S2 = sb2.window.TMS.store, M2 = sb2.window.TMS.model;

  const t1 = M2.createTournament('春季赛');
  const t2 = M2.createTournament('秋季赛');
  S2.put(t1); S2.put(t2);

  const idx = S2.loadIndex();
  ok('索引包含2个赛事', idx.length === 2, idx.length);
  ok('可分别读取赛事', S2.get(t1.id).name === '春季赛' && S2.get(t2.id).name === '秋季赛');
  ok('当前 id 指向最后保存的赛事', S2.getCurrentId() === t2.id);

  S2.remove(t1.id);
  ok('删除后索引剩1个', S2.loadIndex().length === 1, S2.loadIndex().length);
}

/* ---------- D. 完整多阶段赛事（小组赛 → 单败，含继承分） ---------- */
sec('D. 完整多阶段赛事：小组赛 → 单败淘汰');
{
  const t = M.createTournament('城市杯');
  for (let i = 1; i <= 16; i++) t.players.push(M.createPlayer('选手' + i, i));

  // 阶段1：4 组循环赛，每组前 2 晋级
  const s1 = t.stages[0];
  s1.name = '小组赛';
  s1.type = 'groups';
  s1.groupCount = 4;
  s1.groupType = 'round_robin';
  s1.groupCycles = 1;
  s1.adv = { type: 'count', count: 8, score: 0, perGroup: 2 };

  // 阶段2：单败，继承 100%
  const s2 = M.defaultStage(1);
  s2.name = '淘汰赛';
  s2.type = 'single_elim';
  s2.thirdPlace = true;            // 开启季军争夺战
  s2.inherit = { enabled: true, ratio: 100, fromStage: null };
  t.stages.push(s2);

  E.ensureParticipants(t);
  ok('阶段1 参赛 16 人', s1.participants.length === 16, s1.participants.length);
  s1.groups = E.buildGroups(t, s1);
  ok('分成 4 组每组 4 人', s1.groups.length === 4 && s1.groups[0].players.length === 4);

  // 打完小组赛（每组 4 人单循环 = 3 轮）
  let g = 0;
  while (g++ < 15 && !E.stageFinished(t, s1)) {
    const r = E.generateGroupRound(t, s1);
    if (!r.ok) break;
    const rd = s1.roundsData[s1.roundsData.length - 1];
    rd.matches.forEach(mm => {
      if (mm.isBye) return;
      mm.games.push({ w: 'A' }, { w: 'A' }); E.evaluate(mm, t.format, s1.tie);
    });
    E.refreshGroupFinished(t, s1);
  }
  ok('小组赛完成 3 轮', s1.roundsData.length === 3, s1.roundsData.length);
  ok('小组赛阶段判定结束', E.stageFinished(t, s1));

  E.finishStage(t);
  ok('晋级 8 人', s1.advanced.length === 8, s1.advanced.length);
  ok('当前阶段切到 1', t.currentStage === 1, t.currentStage);

  // 阶段2 单败 3 轮（8→4→2→1）
  g = 0;
  while (g++ < 12 && !E.stageFinished(t, s2)) {
    const r = E.generateRound(t);
    if (!r.ok) break;
    const rd = t.stages[1].roundsData[t.stages[1].roundsData.length - 1];
    rd.matches.forEach(mm => {
      if (mm.isBye) return;
      mm.games.push({ w: 'A' }, { w: 'A' }); E.evaluate(mm, t.format, s2.tie);
    });
  }
  ok('淘汰赛完成 3 轮', s2.roundsData.length === 3, s2.roundsData.length);

  E.finishStage(t);
  ok('赛事结束', t.status === 'finished', t.status);
  ok('阶段2 有最终名次', s2.finalRank && s2.finalRank.length === 8, (s2.finalRank || []).length);

  const st = E.standings(t, { stageIndex: 1 });
  ok('冠军有继承分', st[0].carry > 0, st[0].carry);
  console.log('  INFO  最终前四：' + st.slice(0, 4).map(s => s.rank + '.' + s.name + '(' + U.fmt(s.points) + ')').join('  '));
}

console.log('\n============================');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
console.log('============================');
process.exit(fail ? 1 : 0);
