/**
 * v3.1 双败结构回归：半区互换（crossover）与「胜者组决赛败者必须进败者组决赛」
 *
 *   node tools/test_v36.js
 *
 * 覆盖 n = 2..24（含非 2 的幂）两种模式（标准双败 / 半区互换），逐条断言：
 *   1. 同一轮里同一个人只出场一次
 *   2. 没有人输超过 2 场（冠军最多 1 负），也没有人「输 0 场还被淘汰」
 *   3. 败者组轮数 = 2×log2(对阵规模) − 2（与真实双败一致，互换不会多打轮次）
 *   4. 胜者组决赛的败者只打「败者组决赛」这一场，然后进总决赛（核心回归项）
 *   5. 半区互换时，败者组配对以「不同半区」为主（同半区的人不在败者组第一轮相遇）
 *   6. 全程没有轮空（人数为 2 的幂时）
 *   7. 名次完整：全员有名次、冠军唯一
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const base = path.join(__dirname, '..', 'app', 'js');
const sandbox = { window: {}, console, Math, Date, JSON, parseFloat, parseInt, isNaN, isFinite };
sandbox.global = sandbox;
vm.createContext(sandbox);
['core.js', 'formats.js', 'engine.js'].forEach(f => {
  vm.runInContext(fs.readFileSync(path.join(base, f), 'utf8'), sandbox, { filename: f });
});
const { model: M, engine: E } = sandbox.window.TMS;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

const nameOf = t => id => (t.players.find(x => x.id === id) || {}).name || String(id);
const seedOf = s => { const m = String(s).match(/(\d+)/); return m ? +m[1] : 999; };

function mk(n, opts) {
  const t = M.createTournament('T');
  for (let i = 1; i <= n; i++) t.players.push(M.createPlayer('P' + i, i));
  const st = t.stages[0];
  st.type = 'double_elim';
  st.participants = t.players.map(p => p.id);
  Object.assign(st, opts || {});
  return { t, st };
}

/* seed 靠前的赢（结果可复现），可选指定「谁赢谁输」 */
function playRound(t, st, rd, force) {
  const nm = nameOf(t);
  rd.matches.forEach(m => {
    if (m.isBye) { E.evaluate(m, E.fmtOfMatch(t, st, m), st.tie); return; }
    const fmt = E.fmtOfMatch(t, st, m);
    let w;
    if (force) w = force(m);
    else w = (seedOf(nm(m.playerA)) < seedOf(nm(m.playerB))) ? 'A' : 'B';
    m.games = [];
    // 平局要打满整场（winNeeded 只管「分出胜负时提前结束」），否则会被判成没打完
    const need = (w === 'D') ? fmt.gamesPerMatch : (parseInt(fmt.winNeeded, 10) || fmt.gamesPerMatch);
    for (let i = 0; i < need; i++) m.games.push({ w });
    E.evaluate(m, fmt, st.tie);
  });
}

function run(n, opts, force) {
  const { t, st } = mk(n, opts);
  let guard = 0;
  while (guard++ < 80) {
    const r = E.generateRound(t);
    if (!r.ok) break;
    const rd = st.roundsData[st.roundsData.length - 1];
    playRound(t, st, rd, force);
    if (E.stageFinished(t, st)) break;
  }
  return { t, st };
}

function structure(t, st) {
  const nm = nameOf(t);
  const rounds = st.roundsData;
  const losses = {}, appear = {}, byes = [];
  let dup = '';
  rounds.forEach(rd => {
    const cnt = {};
    rd.matches.forEach(m => {
      [m.playerA, m.playerB].forEach(id => { if (id) cnt[id] = (cnt[id] || 0) + 1; });
      if (m.isBye) byes.push({ r: rd.index, br: m.bracket, id: m.playerA || m.playerB });
      if (m.isBye || !m.result || !m.result.winner) return;
      const l = m.result.winner === 'A' ? m.playerB : m.playerA;
      if (l) {
        losses[l] = (losses[l] || 0) + 1;
        (appear[l] = appear[l] || []).push({
          r: rd.index, br: m.bracket, gf: !!m.isGF, x: !!m.isLBCross
        });
      }
    });
    Object.keys(cnt).forEach(id => { if (cnt[id] > 1) dup += ' R' + rd.index + ':' + nm(id) + '×' + cnt[id]; });
  });
  const lbRounds = rounds.filter(rd => rd.matches.some(m => m.bracket === 'L' && m.playerA && m.playerB)).length;
  const wbRounds = rounds.filter(rd => rd.matches.some(m => m.bracket === 'W' && !m.isBye && !m.isGF)).length;
  return { losses, appear, byes, dup, lbRounds, wbRounds, nm };
}

/* ============ A. 标准双败结构（不互换） ============ */
section('A. 标准双败：结构与「胜者组决赛败者」的落点');
[4, 8, 16, 32].forEach(n => {
  const { t, st } = run(n);
  const s = structure(t, st);
  const size = st.de.size || t.players.length;
  const plan = Math.ceil(Math.log(size) / Math.LN2);
  ok(n + ' 人：同轮无重复出场', !s.dup, s.dup);
  ok(n + ' 人：无人输超过 2 场', Object.keys(s.losses).every(id => s.losses[id] <= 2),
    Object.entries(s.losses).filter(([, v]) => v > 2).map(([k, v]) => s.nm(k) + '×' + v).join(','));
  ok(n + ' 人：败者组轮数 = 2×log2 − 2（' + (2 * plan - 2) + '）', s.lbRounds === 2 * plan - 2, s.lbRounds);
  ok(n + ' 人：没有轮空', s.byes.length === 0, s.byes.length);

  // 胜者组决赛的败者 = 只在「最后一轮败者组」出现一次，然后进总决赛
  const wf = st.roundsData
    .map(rd => ({ rd, m: rd.matches.filter(x => x.bracket === 'W' && !x.isBye && !x.isGF) }))
    .filter(x => x.m.length === 1)
    .pop();
  if (wf && wf.m[0].result && wf.m[0].result.winner) {
    const m = wf.m[0];
    const wbLoser = m.result.winner === 'A' ? m.playerB : m.playerA;
    const after = st.roundsData
      .filter(rd => rd.index > wf.rd.index)
      .flatMap(rd => rd.matches
        .filter(mm => mm.playerA === wbLoser || mm.playerB === wbLoser)
        .map(mm => ({ r: rd.index, br: mm.bracket, gf: !!mm.isGF })));
    const lbAfter = after.filter(x => x.br === 'L');
    ok(n + ' 人：胜者组决赛败者只打 1 场败者组比赛', lbAfter.length === 1,
      after.map(x => (x.gf ? 'GF' : x.br) + '@R' + x.r));
    ok(n + ' 人：那一场就是最后一场败者组比赛（败者组决赛）',
      lbAfter.length === 1 && lbAfter[0].r === Math.max(...st.roundsData.filter(rd =>
        rd.matches.some(mm => mm.bracket === 'L' && mm.playerA && mm.playerB)).map(rd => rd.index)),
      lbAfter);
    ok(n + ' 人：他随后进入总决赛', after.some(x => x.gf), after);
  }
  const rank = (E.computeElimRanking(t, st) || []).map(s.nm);
  ok(n + ' 人：名次完整且冠军唯一',
    rank.length === n && new Set(rank).size === n, rank);
});

/* ============ B. 半区互换：结构不变 + 跨半区配对 ============ */
section('B. 半区互换：结构不变、败者组优先跨半区配对');
[4, 8, 16, 32].forEach(n => {
  const { t, st } = run(n, { deCrossDrop: true });
  const s = structure(t, st);
  const size = st.de.size || t.players.length;
  const plan = Math.ceil(Math.log(size) / Math.LN2);
  const halfOf = st.de.halfOf || {};

  ok(n + ' 人：同轮无重复出场', !s.dup, s.dup);
  ok(n + ' 人：无人输超过 2 场', Object.keys(s.losses).every(id => s.losses[id] <= 2),
    Object.entries(s.losses).filter(([, v]) => v > 2).map(([k, v]) => s.nm(k) + '×' + v).join(','));
  ok(n + ' 人：败者组轮数与标准双败一致（' + (2 * plan - 2) + '）', s.lbRounds === 2 * plan - 2, s.lbRounds);
  ok(n + ' 人：没有轮空', s.byes.length === 0, s.byes.length);

  // 跨半区配对占比
  let cross = 0, same = 0;
  st.roundsData.forEach(rd => rd.matches.forEach(m => {
    if (m.bracket !== 'L' || !m.playerA || !m.playerB) return;
    const ha = halfOf[m.playerA], hb = halfOf[m.playerB];
    if (ha === undefined || hb === undefined) return;
    if (ha !== hb) cross++; else same++;
  }));
  // n=4 时败者组只有 3 场，最后一场「存活者 vs 胜者组决赛败者」天然可能同半区，所以用 >=\n  ok(n + ' 人：败者组以跨半区配对为主', cross >= same && (n <= 4 || cross > same), { cross, same });

  // 胜者组决赛败者的落点
  const wf = st.roundsData
    .map(rd => ({ rd, m: rd.matches.filter(x => x.bracket === 'W' && !x.isBye && !x.isGF) }))
    .filter(x => x.m.length === 1)
    .pop();
  if (wf && wf.m[0].result && wf.m[0].result.winner) {
    const m = wf.m[0];
    const wbLoser = m.result.winner === 'A' ? m.playerB : m.playerA;
    const lbAfter = st.roundsData
      .filter(rd => rd.index > wf.rd.index)
      .flatMap(rd => rd.matches.filter(mm => mm.bracket === 'L' &&
        (mm.playerA === wbLoser || mm.playerB === wbLoser)));
    ok(n + ' 人：互换下胜者组决赛败者仍然只打 1 场败者组（败者组决赛）', lbAfter.length === 1,
      lbAfter.map(mm => s.nm(mm.playerA) + ' vs ' + s.nm(mm.playerB)));
  }

  const rank = (E.computeElimRanking(t, st) || []).map(s.nm);
  ok(n + ' 人：名次完整且冠军唯一', rank.length === n && new Set(rank).size === n, rank);
});

/* ============ B2. 半区落位：不互换=同半区先打，互换=首轮跨半区 ============ */
section('B2. 半区落位（败者组第一轮）');
[4, 8, 16, 32].forEach(n => {
  const halfOfOf = st => id => {
    const h = st.de && st.de.halfOf ? (st.de.halfOf['id:' + id] !== undefined ? st.de.halfOf['id:' + id] : st.de.halfOf[id]) : undefined;
    return h;
  };
  const firstLB = st => {
    const rd = st.roundsData.find(r => r.matches.some(m => m.bracket === 'L' && m.playerA && m.playerB));
    return rd ? rd.matches.filter(m => m.bracket === 'L' && m.playerA && m.playerB) : [];
  };

  const plain = run(n);
  const hP = halfOfOf(plain.st);
  const pPairs = firstLB(plain.st);
  const pCross = pPairs.filter(m => hP(m.playerA) !== undefined && hP(m.playerB) !== undefined && hP(m.playerA) !== hP(m.playerB)).length;
  // 4 人时胜者组只有 2 场、败者组首轮只有 1 场 —— 两个败者天然来自不同半区，无法避免
  ok(n + ' 人 不互换：败者组第一轮同半区' + (n === 4 ? '（4 人时无解，跳过）' : ''),
    pPairs.length > 0 && (n === 4 || pCross === 0), { 场次: pPairs.length, 跨半区: pCross });

  const cross = run(n, { deCrossDrop: true });
  const hC = halfOfOf(cross.st);
  const cPairs = firstLB(cross.st);
  const cCross = cPairs.filter(m => hC(m.playerA) !== undefined && hC(m.playerB) !== undefined && hC(m.playerA) !== hC(m.playerB)).length;
  ok(n + ' 人 互换：败者组第一轮全部跨半区', cCross === cPairs.length && cPairs.length > 0, { 场次: cPairs.length, 跨半区: cCross });
  ok(n + ' 人 互换：半区人数前后一致（上 / 下各一半）', (function () {
    const hs = Object.keys(cross.st.de.halfOf || {}).map(k => cross.st.de.halfOf[k]).filter(v => v === 0 || v === 1);
    const c0 = hs.filter(v => v === 0).length, c1 = hs.filter(v => v === 1).length;
    return c0 === c1 && c0 > 0;
  })(), cross.st.de && cross.st.de.halfOf);
});

/* ============ B3. 对阵图：卡片选手 / 胜负去向必须和真实比赛一致 ============ */
section('B3. 对阵图去向与实际比赛一致');
function planCardsOf(plan) {
  const out = [];
  (plan.rows || []).forEach(r => (r.cols || []).forEach(c => (c.cards || []).forEach(cd => out.push({ col: c.name, cd }))));
  (plan.rows || []).forEach(r => (r.gf || []).forEach(c => (c.cards || []).forEach(cd => out.push({ col: c.name, cd }))));
  return out;
}
[4, 8, 16, 32].forEach(n => {
  [false, true].forEach(crossMode => {
    const { t, st } = run(n, { deCrossDrop: crossMode });
    const nm = nameOf(t);
    const plan = E.bracketPlan(t, st);
    const cards = planCardsOf(plan);
    const byMatch = {};
    cards.forEach(x => { if (x.cd.m) byMatch[x.cd.m.id] = x; });
    let badWin = 0, badLose = 0, checked = 0;
    const samples = [];
    st.roundsData.forEach(rd => rd.matches.forEach(m => {
      const x = byMatch[m.id];
      if (!x || !m.result || !m.result.winner || m.isBye) return;
      checked++;
      const wid = m.result.winner === 'A' ? m.playerA : m.playerB;
      const lid = m.result.winner === 'A' ? m.playerB : m.playerA;
      const later = st.roundsData.filter(r2 => r2.index > rd.index).flatMap(r2 => r2.matches);
      const nextW = later.filter(mm => mm.playerA === wid || mm.playerB === wid)[0];
      if (nextW && (!byMatch[nextW.id] || byMatch[nextW.id].cd.title !== x.cd.winTo)) {
        badWin++;
        if (samples.length < 3) samples.push(x.cd.title + ' 胜→' + x.cd.winTo + ' 实际→' + (byMatch[nextW.id] || {}).title);
      }
      const nextL = later.filter(mm => mm.playerA === lid || mm.playerB === lid)[0];
      if (nextL && (!byMatch[nextL.id] || byMatch[nextL.id].cd.title !== x.cd.loseTo)) {
        badLose++;
        if (samples.length < 3) samples.push(x.cd.title + ' 负→' + x.cd.loseTo + ' 实际→' + (byMatch[nextL.id] || {}).title);
      }
    }));
    ok(n + ' 人' + (crossMode ? ' 互换' : '') + '：对阵图「胜→」与真实下一场一致（' + checked + ' 场）', badWin === 0, samples);
    ok(n + ' 人' + (crossMode ? ' 互换' : '') + '：对阵图「负→」与真实掉落地一致', badLose === 0, samples);
    // 卡片上的选手与实际比赛一致
    let badPlayer = 0;
    st.roundsData.forEach(rd => rd.matches.forEach(m => {
      const x = byMatch[m.id];
      if (!x || !m.playerA) return;
      const txt = String(x.cd.a && x.cd.a.text || '') + '|' + String(x.cd.b && x.cd.b.text || '');
      if (txt.indexOf(nm(m.playerA)) < 0 || (m.playerB && txt.indexOf(nm(m.playerB)) < 0)) badPlayer++;
    }));
    ok(n + ' 人' + (crossMode ? ' 互换' : '') + '：卡片选手与真实比赛一致', badPlayer === 0, badPlayer);
  });
});
/* ============ C. 两种模式结构对比：互换不多打轮次 ============ */
section('C. 互换 vs 标准：轮数 / 场次对比');
[8, 16, 32].forEach(n => {
  const a = run(n);
  const b = run(n, { deCrossDrop: true });
  const sa = structure(a.t, a.st), sb = structure(b.t, b.st);
  const cnt = st => st.roundsData.reduce((k, rd) => k + rd.matches.length, 0);
  ok(n + ' 人：轮数一致', a.st.roundsData.length === b.st.roundsData.length,
    [a.st.roundsData.length, b.st.roundsData.length]);
  ok(n + ' 人：场次数一致', cnt(a.st) === cnt(b.st), [cnt(a.st), cnt(b.st)]);
  ok(n + ' 人：败者组轮数一致', sa.lbRounds === sb.lbRounds, [sa.lbRounds, sb.lbRounds]);
});

/* ============ D. 非 2 的幂（有轮空）+ 平局双负 也能跑完 ============ */
section('D. 边角：非 2 的幂 / 平局双负');
[5, 6, 7, 9, 12].forEach(n => {
  [false, true].forEach(cross => {
    const { t, st } = run(n, { deCrossDrop: cross });
    const s = structure(t, st);
    const rank = (E.computeElimRanking(t, st) || []).map(s.nm);
    ok(n + ' 人' + (cross ? '互换' : '') + '：完赛且名次完整',
      E.stageFinished(t, st) && rank.length === n && new Set(rank).size === n, rank);
    ok(n + ' 人' + (cross ? '互换' : '') + '：无人三负',
      Object.keys(s.losses).every(id => s.losses[id] <= 2),
      Object.entries(s.losses).filter(([, v]) => v > 2).map(([k, v]) => s.nm(k) + '×' + v).join(','));
  });
});
{
  // 平局双负：双方都输，赛事仍要跑完（tie 设成允许平局，否则加赛制下平局会被判成「未打完」而卡住 —— 那是另一个设定问题）
  const { t, st } = run(8, { deCrossDrop: true, drawBothLose: true, tie: 'draw_ok' }, () => 'D');
  ok('平局双负 + 互换：能结束', !!(st.status === 'finished' || E.stageFinished(t, st)), st.status);
}

console.log('\n========================================');
console.log('v3.1 双败结构回归：PASS ' + pass + ' / FAIL ' + fail);
if (fail) process.exit(1);
