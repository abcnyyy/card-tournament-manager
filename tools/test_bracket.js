/* 单败 / 双败淘汰：推进、名次、对阵图数据 的专项测试 */
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
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

// 让「种子更靠前（数字更小）」的一方赢，模拟实力顺序
function play(t, stage, rd) {
  const seedOf = id => (t.players.filter(p => p.id === id)[0] || {}).seed || 9999;
  rd.matches.forEach(m => {
    if (m.isBye) { E.evaluate(m, E.fmtOf(t, stage), stage.tie); return; }
    const keepA = seedOf(m.playerA) <= seedOf(m.playerB);
    m.games.push({ w: keepA ? 'A' : 'B' }, { w: keepA ? 'A' : 'B' });
    E.evaluate(m, E.fmtOf(t, stage), stage.tie);
  });
}

function run(t, maxRounds) {
  const stage = t.stages[0];
  for (let i = 0; i < maxRounds; i++) {
    if (E.stageFinished(t, stage)) break;
    const g = E.generateRound(t);
    if (!g.ok) break;
    const rd = stage.roundsData[stage.roundsData.length - 1];
    play(t, stage, rd);
    const fin = E.finishRound(t);
    if (!fin.ok) { console.log('    完成失败:', fin.msg); break; }
  }
  return stage;
}

/* ---------- 1. 单败：8 人 → 3 轮，冠军为 1 号种子 ---------- */
section('单败淘汰（8 人）');
{
  const t = M.createTournament('单败8人');
  for (let i = 1; i <= 8; i++) t.players.push(M.createPlayer('S' + i, i));
  t.stages[0].type = 'single_elim';
  const stage = run(t, 8);
  ok('共 3 轮', stage.roundsData.length === 3, stage.roundsData.length);
  ok('场次 4+2+1', stage.roundsData.map(r => r.matches.length).join(',') === '4,2,1',
    stage.roundsData.map(r => r.matches.length).join(','));
  const fr = E.computeElimRanking(t, stage);
  const names = fr.map(id => (t.players.filter(p => p.id === id)[0] || {}).name);
  console.log('    名次：', names.join(' > '));
  ok('冠军 = S1（1 号种子）', names[0] === 'S1', names[0]);
  ok('亚军 = S2', names[1] === 'S2', names[1]);
  ok('名次覆盖 8 人', fr.length === 8, fr.length);
}

/* ---------- 2. 单败 + 季军赛 ---------- */
section('单败淘汰（含季军赛）');
{
  const t = M.createTournament('单败季军');
  for (let i = 1; i <= 4; i++) t.players.push(M.createPlayer('T' + i, i));
  t.stages[0].type = 'single_elim';
  t.stages[0].thirdPlace = true;
  const stage = run(t, 6);
  const fr = E.computeElimRanking(t, stage);
  const names = fr.map(id => (t.players.filter(p => p.id === id)[0] || {}).name);
  console.log('    名次：', names.join(' > '));
  ok('冠军 = T1', names[0] === 'T1', names[0]);
  ok('亚军 = T2', names[1] === 'T2', names[1]);
  ok('第 3 名有明确归属（季军赛）', !!names[2], names[2]);
}

/* ---------- 3. 双败：8 人 ---------- */
section('双败淘汰（8 人）');
{
  const t = M.createTournament('双败8人');
  for (let i = 1; i <= 8; i++) t.players.push(M.createPlayer('D' + i, i));
  t.stages[0].type = 'double_elim';
  const stage = run(t, 12);
  console.log('    每轮场次：', stage.roundsData.map((r, i) => (r.isGF ? 'GF' : 'R' + (i + 1)) + '(' + r.matches.length + ')').join(' '));
  ok('能推进到结束', E.stageFinished(t, stage), stage.roundsData.length);
  // 胜者组/败者组都有比赛
  const hasW = stage.roundsData.some(rd => rd.matches.some(m => m.bracket === 'W' && !m.isBye));
  const hasL = stage.roundsData.some(rd => rd.matches.some(m => m.bracket === 'L' && !m.isBye));
  ok('存在胜者组比赛', hasW);
  ok('存在败者组比赛', hasL);
  ok('存在总决赛', stage.roundsData.some(rd => rd.isGF));

  const fr = E.computeElimRanking(t, stage);
  const names = fr.map(id => (t.players.filter(p => p.id === id)[0] || {}).name);
  console.log('    名次：', names.join(' > '));
  ok('名次覆盖 8 人', fr.length === 8, fr.length);
  ok('冠军 = D1', names[0] === 'D1', names[0]);
  ok('亚军 = D2 或 D3（败者组杀回来的）', names[1] === 'D2' || names[1] === 'D3', names[1]);
  // 冠军全程不败
  const champLoss = stage.roundsData.reduce((n, rd) =>
    n + rd.matches.filter(m => !m.isBye && m.decided && m.result && m.result.winner &&
      ((m.result.winner === 'A' ? m.playerB : m.playerA) === fr[0])).length, 0);
  ok('冠军最多输过 1 场（双败规则）', champLoss <= 1, champLoss);
}

/* ---------- 4. 双败：败者组冠军夺冠 → 需要加赛 ---------- */
section('双败：败者组冠军先赢总决赛 → 应加赛一场');
{
  const t = M.createTournament('双败加赛');
  for (let i = 1; i <= 8; i++) t.players.push(M.createPlayer('E' + i, i));
  t.stages[0].type = 'double_elim';
  const stage = t.stages[0];
  // 先正常打到总决赛：一旦生成出总决赛就停手，留给自己安排胜负
  for (let i = 0; i < 12; i++) {
    if (E.stageFinished(t, stage)) break;
    const g = E.generateRound(t);
    if (!g.ok) break;
    const rd = stage.roundsData[stage.roundsData.length - 1];
    if (rd.isGF) break;
    play(t, stage, rd);
    E.finishRound(t);
  }
  const gfIdx = stage.roundsData.findIndex(rd => rd.isGF);
  ok('已生成总决赛', gfIdx >= 0, gfIdx);
  // 让「非胜者组冠军」赢下总决赛第一场：把 B 设为赢家（A 是 de.w[0]）
  const gfRd = stage.roundsData[gfIdx];
  gfRd.matches.forEach(m => {
    if (m.isBye) return;
    m.games = [{ w: 'B' }, { w: 'B' }];
    E.evaluate(m, E.fmtOf(t, stage), stage.tie);
  });
  E.finishRound(t);
  ok('败者组夺冠后未结束（需加赛）', !E.stageFinished(t, stage), 'finished=' + E.stageFinished(t, stage));
  const g2 = E.generateRound(t);
  ok('能生成加赛', g2.ok, g2.msg);
  if (g2.ok) {
    const rd2 = stage.roundsData[stage.roundsData.length - 1];
    ok('加赛标记为总决赛', !!rd2.isGF);
    rd2.matches.forEach(m => {
      if (m.isBye) return;
      m.games = [{ w: 'A' }, { w: 'A' }];
      E.evaluate(m, E.fmtOf(t, stage), stage.tie);
    });
    E.finishRound(t);
    ok('加赛打完后结束', E.stageFinished(t, stage));
  }
}

/* ---------- 5. 对阵图数据 ---------- */
section('对阵图数据（bracket）');
{
  const t = M.createTournament('对阵图');
  for (let i = 1; i <= 8; i++) t.players.push(M.createPlayer('B' + i, i));
  t.stages[0].type = 'single_elim';
  const stage = run(t, 8);
  const g = E.bracketGraph(t, stage);
  ok('图有 3 列（8人单败）', g.cols.length === 3, g.cols.length);
  ok('首列 4 场', g.cols[0].length === 4, g.cols[0].length);
  ok('决赛列 1 场', g.cols[2].length === 1, g.cols[2].length);
  const finalMatch = g.cols[2][0];
  const champ = finalMatch.winnerId && (t.players.filter(p => p.id === finalMatch.winnerId)[0] || {}).name;
  ok('决赛胜者 = B1', champ === 'B1', champ);
  console.log('    图结构：', g.cols.map(c => c.length).join(' → '));
}
{
  const t = M.createTournament('双败对阵图');
  for (let i = 1; i <= 8; i++) t.players.push(M.createPlayer('C' + i, i));
  t.stages[0].type = 'double_elim';
  const stage = run(t, 12);
  const g = E.bracketGraph(t, stage);
  ok('双败图含胜者组与败者组两区', g.sections.length === 2, g.sections.map(s => s.key).join(','));
  ok('胜者组区非空', g.sections[0].cols.length > 0, g.sections[0].cols.length);
  ok('败者组区非空', g.sections[1].cols.length > 0, g.sections[1].cols.length);
  console.log('    胜者组列：', g.sections[0].cols.map(c => c.length).join(' → '),
    '｜败者组列：', g.sections[1].cols.map(c => c.length).join(' → '));
}

console.log('\n============================');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
console.log('============================');
process.exit(fail ? 1 : 0);
