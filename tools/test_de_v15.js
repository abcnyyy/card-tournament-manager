/**
 * 双败淘汰 + 总决赛自定义规则 专项测试（v1.5.0）
 *  A. 双败全流程（走界面路径：只点「生成下一轮」，不点「结算本轮」）
 *  B. 总决赛三种赛制：加赛 reset / 无优势 none / 让局 handicap
 *  C. 加赛局独立局制
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
const { model: M, engine: E } = sandbox.window.TMS;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  NG  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t) { console.log('\n[' + t + ']'); }

function mkDE(n, opts) {
  opts = opts || {};
  const t = M.createTournament('DE');
  for (let i = 1; i <= n; i++) t.players.push(M.createPlayer('P' + i, i));
  const st = t.stages[0];
  st.type = 'double_elim';
  st.participants = t.players.map(p => p.id);
  Object.assign(st, opts);
  return { t, st };
}
const NMOF = t => id => (t.players.find(x => x.id === id) || {}).name || null;
const SEED = s => { const m = String(s).match(/(\d+)/); return m ? +m[1] : 99; };

// 默认：序号小者赢；weakWins=true 时序号大者赢（用来制造败者组冠军取胜）
function playRound(t, st, rd, opts) {
  opts = opts || {};
  const nm = NMOF(t);
  rd.matches.forEach(m => {
    if (m.isBye) { E.evaluate(m, E.fmtOfMatch(t, st, m), st.tie); return; }
    const a = SEED(nm(m.playerA)), b = SEED(nm(m.playerB));
    let w = (a < b) ? 'A' : 'B';
    if (opts.weakWins) w = (a < b) ? 'B' : 'A';
    if (opts.force) w = opts.force;
    const fmt = E.fmtOfMatch(t, st, m);
    m.games = [];
    const need = (parseInt(fmt.winNeeded, 10) > 0) ? parseInt(fmt.winNeeded, 10) : fmt.gamesPerMatch;
    for (let i = 0; i < need; i++) m.games.push({ w });
    E.evaluate(m, fmt, st.tie);
  });
}

function runDE(n, opts, playOpts) {
  const { t, st } = mkDE(n, opts);
  let guard = 0, log = [];
  while (guard++ < 40) {
    const g = E.generateRound(t);           // 界面路径
    if (!g.ok) { log.push('STOP: ' + g.msg); break; }
    const rd = st.roundsData[st.roundsData.length - 1];
    const nm = NMOF(t);
    log.push('R' + rd.index + (rd.isGF ? (rd.gfReset ? '[加赛]' : '[总决赛]') : '') + ' ' +
      rd.matches.map(m => (m.isBye ? 'bye' : (m.bracket === 'L' ? 'L' : 'W') + ':' +
        nm(m.playerA) + '/' + nm(m.playerB))).join(' '));
    playRound(t, st, rd, typeof playOpts === 'function' ? playOpts(rd, st, t) : playOpts);
    if (E.stageFinished(t, st)) { log.push('阶段结束'); break; }
  }
  return { t, st, log };
}

/* ================= A. 双败全流程 ================= */
section('A. 双败全流程（界面路径，不手动结算）');
[2, 3, 4, 5, 6, 7, 8, 12, 16].forEach(function (n) {
  const { t, st, log } = runDE(n);
  const rank = E.computeElimRanking(t, st);
  const nm = NMOF(t);
  const names = rank ? rank.map(nm) : [];
  // 1) 每人最多输两场（冠军除外），且除冠军外所有人恰好两负
  const loss = {};
  t.players.forEach(p => loss[p.id] = 0);
  st.roundsData.forEach(rd => rd.matches.forEach(m => {
    if (m.isBye || !m.result || !m.result.winner) return;
    const l = m.result.winner === 'A' ? m.playerB : m.playerA;
    if (l) loss[l]++;
  }));
  const over = Object.keys(loss).filter(id => loss[id] > 2);
  ok(n + ' 人：无人输超过两场', over.length === 0, JSON.stringify(over.map(i => nm(i))));
  const losers2 = Object.keys(loss).filter(id => loss[id] === 2).length;
  ok(n + ' 人：除冠军外全部两负', losers2 === n - 1, 'twoLoss=' + losers2 + '/' + (n - 1));

  // 2) 同一轮同一人只能出场一次
  let dup = false;
  st.roundsData.forEach(rd => {
    const seen = {};
    rd.matches.forEach(m => {
      [m.playerA, m.playerB].forEach(id => { if (id) { if (seen[id]) dup = true; seen[id] = 1; } });
    });
  });
  ok(n + ' 人：同一轮无人重复出场', !dup);

  // 3) 名次完整（人数一致、无重复）
  ok(n + ' 人：名次表人数完整且无重复',
    names.length === n && new Set(names).size === n, names.join('>'));

  // 4) 冠军负场最少（0 或 1）
  const champ = rank && rank[0];
  ok(n + ' 人：冠军负场 ≤ 1', !!champ && loss[champ] <= 1, champ ? nm(champ) + ' 负' + loss[champ] : 'null');

  // 5) 有过总决赛
  ok(n + ' 人：打了总决赛', st.roundsData.some(rd => rd.isGF && rd.matches.length));
});

section('A2. 重复生成不会重排（幂等）');
(function () {
  const { t, st } = mkDE(8);
  E.generateRound(t);
  const rd0 = st.roundsData[0];
  playRound(t, st, rd0);
  E.generateRound(t);
  const r1 = st.roundsData[1];
  const snap = r1.matches.map(m => NMOF(t)(m.playerA) + '/' + NMOF(t)(m.playerB)).join(',');
  ok('第 2 轮含败者组', r1.matches.some(m => m.bracket === 'L'), snap);
  const wCount = r1.matches.filter(m => m.bracket === 'W').length;
  ok('第 2 轮胜者组只剩 2 场', wCount === 2, 'W=' + wCount);
})();

/* ================= B. 总决赛三制 ================= */
section('B1. 加赛制（reset）：败者组冠军赢首场 → 加赛');
(function () {
  const { t, st, log } = runDE(8, { gfMode: 'reset' }, function (rd) {
    // 总决赛首场让 B 方（败者组冠军）赢；加赛让 A 方赢
    if (rd.isGF) return { force: rd.gfReset ? 'A' : 'B' };
    return {};
  });
  const gfs = st.roundsData.filter(rd => rd.isGF);
  ok('出现 2 场总决赛', gfs.length === 2, 'gf=' + gfs.length);
  ok('第二场标记为加赛局', !!(gfs[1] && gfs[1].gfReset));
  const rank = E.computeElimRanking(t, st).map(NMOF(t));
  const lastGF = gfs[1].matches[0];
  const champ = lastGF.result.winner === 'A' ? NMOF(t)(lastGF.playerA) : NMOF(t)(lastGF.playerB);
  ok('冠军 = 加赛局胜者', rank[0] === champ, rank[0] + ' vs ' + champ);
  ok('亚军 = 加赛局负者', rank[1] === (lastGF.result.winner === 'A' ? NMOF(t)(lastGF.playerB) : NMOF(t)(lastGF.playerA)));
})();

section('B2. 加赛制：胜者组冠军赢首场 → 直接夺冠，无加赛');
(function () {
  const { t, st } = runDE(8, { gfMode: 'reset' }, function (rd) {
    if (rd.isGF) return { force: 'A' };
    return {};
  });
  const gfs = st.roundsData.filter(rd => rd.isGF);
  ok('只有 1 场总决赛', gfs.length === 1, 'gf=' + gfs.length);
  const rank = E.computeElimRanking(t, st).map(NMOF(t));
  const gf = gfs[0].matches[0];
  ok('冠军 = 胜者组冠军', rank[0] === NMOF(t)(gf.playerA), rank[0] + ' / ' + NMOF(t)(gf.playerA));
})();

section('B3. 无优势（none）：败者组冠军赢一场即夺冠');
(function () {
  const { t, st } = runDE(8, { gfMode: 'none' }, function (rd) {
    if (rd.isGF) return { force: 'B' };
    return {};
  });
  const gfs = st.roundsData.filter(rd => rd.isGF);
  ok('只有 1 场总决赛', gfs.length === 1, 'gf=' + gfs.length);
  const rank = E.computeElimRanking(t, st).map(NMOF(t));
  const gf = gfs[0].matches[0];
  ok('冠军 = 败者组冠军（B 方）', rank[0] === NMOF(t)(gf.playerB), rank[0] + ' / ' + NMOF(t)(gf.playerB));
  ok('亚军 = 胜者组冠军', rank[1] === NMOF(t)(gf.playerA), rank[1]);
})();

section('B4. 让局（handicap）：胜者组冠军先计 1 局');
(function () {
  const { t, st } = mkDE(8, {
    gfMode: 'handicap', gfAdvSide: 'W', gfHandicap: 1,
    useFormat: true, format: { gamesPerMatch: 5, winNeeded: 3, recordScore: false }
  });
  // 直接推进到总决赛
  let guard = 0;
  while (guard++ < 30) {
    const g = E.generateRound(t);
    if (!g.ok) break;
    const rd = st.roundsData[st.roundsData.length - 1];
    if (rd.isGF) break;
    playRound(t, st, rd);
  }
  const gf = st.roundsData[st.roundsData.length - 1];
  const m = gf.matches[0];
  ok('总决赛标记 isGF', !!m.isGF);
  ok('A 方带先计 1 局', !!m.gfAdv && m.gfAdv.side === 'A' && m.gfAdv.games === 1, JSON.stringify(m.gfAdv));
  ok('最大局数 = 4（先赢 3 局，让 1 局）', E.matchMaxGames(m, E.fmtOfMatch(t, st, m)) === 4,
    String(E.matchMaxGames(m, E.fmtOfMatch(t, st, m))));
  // A 先计 1 局，再赢 2 局 → 3:0 夺冠
  m.games = [{ w: 'A' }, { w: 'A' }];
  E.evaluate(m, E.fmtOfMatch(t, st, m), st.tie);
  ok('A 再赢 2 局即结束', m.decided === true && m.result.winner === 'A');
  ok('显示比分为 3:0', m.result.gamesA + m.result.advA === 3, (m.result.gamesA + m.result.advA) + ':' + m.result.gamesB);
})();

section('B5. 让局：败者组冠军先计 1 局时，胜者组冠军需多赢一局');
(function () {
  const { t, st } = mkDE(8, { gfMode: 'handicap', gfAdvSide: 'L', gfHandicap: 1 });
  let guard = 0;
  while (guard++ < 30) {
    const g = E.generateRound(t);
    if (!g.ok) break;
    const rd = st.roundsData[st.roundsData.length - 1];
    if (rd.isGF) break;
    playRound(t, st, rd);
  }
  const m = st.roundsData[st.roundsData.length - 1].matches[0];
  ok('B 方带先计 1 局', !!m.gfAdv && m.gfAdv.side === 'B', JSON.stringify(m.gfAdv));
  m.games = [{ w: 'A' }, { w: 'A' }, { w: 'A' }];
  E.evaluate(m, E.fmtOfMatch(t, st, m), st.tie);
  ok('A 赢 3 局（B 含先计 1 局）→ 3:1 A 胜', m.result.winner === 'A' && m.decided);
})();

/* ================= C. 加赛局独立局制 ================= */
section('C. 加赛局独立局制');
(function () {
  const { t, st } = mkDE(8, {
    gfMode: 'reset',
    useFormat: true, format: { gamesPerMatch: 5, winNeeded: 3, recordScore: false },
    gfUseFormat: true, gfFormat: { gamesPerMatch: 5, winNeeded: 3, recordScore: false },
    resetUseFormat: true, resetFormat: { gamesPerMatch: 1, winNeeded: 1, recordScore: false }
  });
  const fGf = E.gfFmtOf(t, st, false), fReset = E.gfFmtOf(t, st, true);
  ok('总决赛局制 = BO5', fGf.gamesPerMatch === 5 && fGf.winNeeded === 3);
  ok('加赛局局制 = BO1', fReset.gamesPerMatch === 1 && fReset.winNeeded === 1,
    fReset.gamesPerMatch + '/' + fReset.winNeeded);
  const stageFmt = E.fmtOf(t, st);
  ok('阶段局制仍为 BO5', stageFmt.gamesPerMatch === 5);
  // 未设置独立加赛局制时 → 沿用总决赛
  st.resetUseFormat = false;
  const f2 = E.gfFmtOf(t, st, true);
  ok('未单独设置时加赛局沿用总决赛局制', f2.gamesPerMatch === 5 && f2.winNeeded === 3);
})();

section('D. 单败不受影响（回归）');
(function () {
  const t = M.createTournament('SE');
  for (let i = 1; i <= 8; i++) t.players.push(M.createPlayer('P' + i, i));
  const st = t.stages[0];
  st.type = 'single_elim';
  st.participants = t.players.map(p => p.id);
  let guard = 0;
  while (guard++ < 10) {
    const g = E.generateRound(t);
    if (!g.ok) break;
    playRound(t, st, st.roundsData[st.roundsData.length - 1]);
    if (E.stageFinished(t, st)) break;
  }
  const rank = E.computeElimRanking(t, st).map(NMOF(t));
  ok('8 人单败：冠军 P1', rank[0] === 'P1', rank.join('>'));
  ok('8 人单败：名次完整', rank.length === 8 && new Set(rank).size === 8);
})();

console.log('\n================  ' + pass + ' passed, ' + fail + ' failed  ================');
process.exit(fail ? 1 : 0);
