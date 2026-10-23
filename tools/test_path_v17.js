/**
 * v1.7.0 专项：淘汰赛完整对阵图 + 晋级路径
 *  A. 单败 8 人：场次编号、胜者去向、负者淘汰、冠军/亚军终点
 *  B. 单败 16 人 + 轮空：轮空场不产生路径、跳轮也能算准
 *  C. 双败 8 人：胜者组负者掉入败者组（标注到具体某轮某场）、总决赛终点
 *  D. 加赛制：首场总决赛胜者的去向是「加赛局」
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

const NMOF = t => id => (t.players.find(x => x.id === id) || {}).name || null;
const SEED = s => { const m = String(s).match(/(\d+)/); return m ? +m[1] : 99; };

function mk(n, type, extra) {
  const t = M.createTournament('path');
  for (let i = 1; i <= n; i++) t.players.push(M.createPlayer('P' + i, i));
  const st = t.stages[0];
  st.type = type;
  st.participants = t.players.map(p => p.id);
  if (extra) Object.assign(st, extra);
  return { t, st };
}

function play(t, st, rd, opts) {
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

function run(n, type, extra, playOpts) {
  const { t, st } = mk(n, type, extra);
  let guard = 0;
  while (guard++ < 40) {
    const g = E.generateRound(t);
    if (!g.ok) break;
    const rd = st.roundsData[st.roundsData.length - 1];
    play(t, st, rd, typeof playOpts === 'function' ? playOpts(rd, st, t) : playOpts);
    if (E.stageFinished(t, st)) break;
  }
  return { t, st, paths: E.bracketPaths(t, st) };
}

/* ================= A. 单败 8 人 ================= */
section('A. 单败 8 人：编号 / 胜者去向 / 负者淘汰');
(function () {
  const { t, st, paths } = run(8, 'single_elim');
  const nm = NMOF(t);
  const all = [];
  st.roundsData.forEach(rd => rd.matches.forEach(m => all.push(m)));

  ok('每场都有场次编号', all.every(m => !!paths.labels[m.id]), all.map(m => paths.labels[m.id]));
  ok('第 1 轮编号为「1/4 决赛 第 N 场」',
    /^1\/4 决赛 第 \d 场$/.test(paths.labels[all[0].id]), paths.labels[all[0].id]);
  ok('半决赛编号正确',
    st.roundsData[1].matches.every(m => /^半决赛 第 \d 场$/.test(paths.labels[m.id])),
    st.roundsData[1].matches.map(m => paths.labels[m.id]));
  ok('决赛编号正确',
    /^决赛 第 1 场$/.test(paths.labels[st.roundsData[2].matches[0].id]),
    paths.labels[st.roundsData[2].matches[0].id]);

  ok('第 1 轮胜者去向是半决赛',
    st.roundsData[0].matches.every(m => /^半决赛 第 \d 场$/.test(paths.win[m.id])),
    st.roundsData[0].matches.map(m => paths.win[m.id]));
  ok('第 1 轮负者去向是「淘汰」',
    st.roundsData[0].matches.every(m => paths.lose[m.id] === '淘汰'),
    st.roundsData[0].matches.map(m => paths.lose[m.id]));
  ok('半决赛胜者去向是决赛',
    st.roundsData[1].matches.every(m => /^决赛 第 1 场$/.test(paths.win[m.id])),
    st.roundsData[1].matches.map(m => paths.win[m.id]));
  ok('决赛胜者为冠军（无后续）',
    paths.win[st.roundsData[2].matches[0].id] === '夺冠（无后续比赛）',
    paths.win[st.roundsData[2].matches[0].id]);
  ok('决赛负者为淘汰（本阶段结束）',
    paths.lose[st.roundsData[2].matches[0].id] === '淘汰',
    paths.lose[st.roundsData[2].matches[0].id]);

  // 一对一校验：胜者去向确实就是该胜者下一场所在的那张卡
  let bad = [];
  all.forEach(m => {
    if (!m.result || !m.result.winner) return;
    const wid = m.result.winner === 'A' ? m.playerA : m.playerB;
    const wname = nm(wid);
    const to = paths.win[m.id];
    if (/^淘汰|^夺冠/.test(to)) return;
    // 找到该 label 对应的比赛，确认里面有这名选手
    const target = all.filter(x => paths.labels[x.id] === to)[0];
    if (!target) { bad.push([wname, to, 'no-target']); return; }
    if (target.playerA !== wid && target.playerB !== wid) bad.push([wname, to, 'wrong-target']);
  });
  ok('每个「胜 →」指向的比赛里确实有该胜者', bad.length === 0, bad);

  ok('场次编号在阶段内唯一', (function () {
    const set = {}; let dup = [];
    all.forEach(m => { const L = paths.labels[m.id]; if (set[L]) dup.push(L); set[L] = 1; });
    return dup.length === 0;
  })(), all.map(m => paths.labels[m.id]));
})();

/* ================= B. 单败 16 人（含轮空） ================= */
section('B. 单败 16 人 + 轮空');
(function () {
  // 12 人 → 16 签位，首轮 4 个轮空
  const { t, st, paths } = run(12, 'single_elim');
  const nm = NMOF(t);
  const all = [];
  st.roundsData.forEach(rd => rd.matches.forEach(m => all.push(m)));
  const byes = all.filter(m => m.isBye);
  ok('存在轮空场', byes.length > 0, byes.length);
  ok('轮空场只标注「下一场」，不产生负者路径',
    byes.every(m => paths.lose[m.id] === '' &&
      (paths.win[m.id] === '' || /第 \d+ 场$/.test(paths.win[m.id]))),
    byes.map(m => [paths.win[m.id], paths.lose[m.id]]));

  let bad = [];
  all.forEach(m => {
    if (m.isBye || !m.result || !m.result.winner) return;
    const wid = m.result.winner === 'A' ? m.playerA : m.playerB;
    const to = paths.win[m.id];
    if (/^淘汰|^夺冠/.test(to)) return;
    const target = all.filter(x => paths.labels[x.id] === to)[0];
    if (!target || (target.playerA !== wid && target.playerB !== wid)) bad.push([nm(m.playerA), to]);
  });
  ok('轮空跳轮后路径依然正确', bad.length === 0, bad);
  ok('全部场次都有编号', all.every(m => !!paths.labels[m.id]));
})();

/* ================= C. 双败 8 人 ================= */
section('C. 双败 8 人：败者组落点');
(function () {
  const { t, st, paths } = run(8, 'double_elim');
  const nm = NMOF(t);
  const all = [];
  st.roundsData.forEach(rd => rd.matches.forEach(m => all.push(m)));
  const wms = all.filter(m => m.bracket === 'W' && !m.isBye && !m.isThird);

  ok('胜者组场次编号存在', wms.every(m => !!paths.labels[m.id]), wms.map(m => paths.labels[m.id]));
  ok('败者组场次编号形如「败者组第 N 轮 第 M 场」',
    all.filter(m => m.bracket === 'L' && !m.isBye)
      .every(m => /^败者组第 \d+ 轮 第 \d+ 场$/.test(paths.labels[m.id])),
    all.filter(m => m.bracket === 'L').map(m => paths.labels[m.id]));

  // 胜者组首轮负者应全部掉进败者组
  const firstW = st.roundsData[0].matches.filter(m => m.bracket === 'W' && !m.isBye);
  ok('胜者组首轮负者都指向败者组',
    firstW.every(m => /^败者组第/.test(paths.lose[m.id])),
    firstW.map(m => paths.lose[m.id]));

  // 每场已决出的比赛，去向文字都不该是「待定」
  const undecided = all.filter(m => !m.isBye && m.decided && (!paths.win[m.id] || !paths.lose[m.id]));
  ok('已决出的比赛都有明确去向', undecided.length === 0, undecided.map(m => paths.labels[m.id]));

  // 败者组里被淘汰的人：去向为「淘汰」
  const lLose = all.filter(m => m.bracket === 'L' && m.decided && !m.isBye)
    .map(m => paths.lose[m.id]);
  ok('败者组负者去向为「淘汰」', lLose.every(x => x === '淘汰'), lLose);

  // 一对一校验：去向指向的比赛里必须包含该选手
  let bad = [];
  all.forEach(m => {
    if (m.isBye || !m.result || !m.result.winner) return;
    const wid = m.result.winner === 'A' ? m.playerA : m.playerB;
    const to = paths.win[m.id];
    if (/^淘汰|^夺冠|^亚军/.test(to)) return;
    const target = all.filter(x => paths.labels[x.id] === to)[0];
    if (!target || (target.playerA !== wid && target.playerB !== wid)) bad.push([nm(wid), to]);
  });
  ok('双败「胜 →」全部指向该胜者真实参加的比赛', bad.length === 0, bad);

  // 负者去向同样要能对上：要么「淘汰 / 亚军」，要么指向一场确实包含该负者的比赛
  let badL = [];
  all.forEach(m => {
    if (m.isBye || !m.result || !m.result.winner) return;
    const lid = m.result.winner === 'A' ? m.playerB : m.playerA;
    const to = paths.lose[m.id];
    if (!to || /^淘汰|^亚军/.test(to)) return;
    const target = all.filter(x => paths.labels[x.id] === to)[0];
    if (!target || (target.playerA !== lid && target.playerB !== lid)) badL.push([nm(lid), to]);
  });
  ok('双败「负 →」全部指向该负者真实参加的比赛', badL.length === 0, badL);
  ok('双败场次编号唯一', (function () {
    const set = {}; let dup = [];
    all.forEach(m => { const L = paths.labels[m.id]; if (set[L]) dup.push(L); set[L] = 1; });
    return dup.length === 0;
  })(), all.map(m => paths.labels[m.id]));
})();

/* ================= D. 加赛制：首场总决赛的去向 ================= */
section('D. 加赛制 reset：首场总决赛 → 加赛局');
(function () {
  let t, st, paths;
  const r = mk(8, 'double_elim', { gfMode: 'reset' });
  t = r.t; st = r.st;
  let guard = 0;
  while (guard++ < 40) {
    const g = E.generateRound(t);
    if (!g.ok) break;
    const rd = st.roundsData[st.roundsData.length - 1];
    // 总决赛首场强制「败者组冠军」赢（B 位）→ 触发加赛
    play(t, st, rd, rd.isGF && !rd.gfReset ? { force: 'B' } : {});
    if (E.stageFinished(t, st)) break;
  }
  paths = E.bracketPaths(t, st);
  const gfs = [];
  st.roundsData.forEach(rd => { if (rd.isGF) rd.matches.forEach(m => gfs.push({ m, rd })); });
  ok('出现两场总决赛（首场 + 加赛）', gfs.length >= 2, gfs.length);
  ok('首场总决赛胜者去向 = 加赛局',
    gfs.length >= 2 && /加赛局/.test(paths.win[gfs[0].m.id]), gfs[0] && paths.win[gfs[0].m.id]);
  ok('加赛局胜者 = 冠军',
    paths.win[gfs[gfs.length - 1].m.id] === '夺冠（无后续比赛）',
    paths.win[gfs[gfs.length - 1].m.id]);
  ok('加赛局负者 = 亚军',
    paths.lose[gfs[gfs.length - 1].m.id] === '亚军',
    paths.lose[gfs[gfs.length - 1].m.id]);
})();

/* ================= E. 季军赛 ================= */
section('E. 季军赛也有明确说明');
(function () {
  const { st, paths } = run(8, 'single_elim', { thirdPlace: true });
  const third = [];
  st.roundsData.forEach(rd => rd.matches.forEach(m => { if (m.isThird) third.push(m); }));
  ok('存在季军赛', third.length === 1, third.length);
  if (third.length) {
    ok('季军赛编号', /季军争夺战/.test(paths.labels[third[0].id]), paths.labels[third[0].id]);
    ok('季军赛胜者去向说明', /第 3 名/.test(paths.win[third[0].id]) || paths.win[third[0].id] === '夺冠（无后续比赛）',
      paths.win[third[0].id]);
    ok('季军赛负者去向说明', /第 4 名/.test(paths.lose[third[0].id]) || paths.lose[third[0].id] === '淘汰',
      paths.lose[third[0].id]);
  }
})();

/* ================= F. 下一轮尚未生成时不得谎报「夺冠」 ================= */
section('F. 未生成下一轮时的去向措辞');
(function () {
  // 单败 8 人只打两轮（1/4、半决赛），决赛还没生成
  const { t, st } = mk(8, 'single_elim');
  for (let i = 0; i < 2; i++) {
    const g = E.generateRound(t);
    if (!g.ok) break;
    play(t, st, st.roundsData[st.roundsData.length - 1]);
  }
  const paths = E.bracketPaths(t, st);
  const semi = st.roundsData[1].matches;
  ok('半决赛胜者去向 = 下一轮（待生成）',
    semi.every(m => paths.win[m.id] === '下一轮（待生成）'),
    semi.map(m => paths.win[m.id]));
  ok('半决赛负者去向 = 淘汰',
    semi.every(m => paths.lose[m.id] === '淘汰'),
    semi.map(m => paths.lose[m.id]));
  ok('此时全场没有「夺冠」字样',
    Object.keys(paths.win).every(k => !/夺冠/.test(paths.win[k])),
    Object.keys(paths.win).map(k => paths.win[k]));

  // 双败：胜者组只剩 1 人（总决赛还没生成）时停手
  const r2 = mk(8, 'double_elim');
  let guard = 0;
  while (guard++ < 10) {
    const g = E.generateRound(r2.t);
    if (!g.ok) break;
    const cur = r2.st.roundsData[r2.st.roundsData.length - 1];
    play(r2.t, r2.st, cur);
    if (r2.st.de && r2.st.de.w && r2.st.de.w.length <= 1) break;
  }
  const p2 = E.bracketPaths(r2.t, r2.st);
  const hasGF = r2.st.roundsData.some(x => x.isGF);
  if (!hasGF) {
    const wFinalWin = Object.keys(p2.win)
      .map(k => p2.win[k]).filter(x => /夺冠/.test(x));
    ok('胜者组冠军未打总决赛前不显示「夺冠」', wFinalWin.length === 0, wFinalWin);
  } else {
    ok('已生成总决赛，跳过', true);
  }
})();

console.log('\n================  ' + pass + ' passed, ' + fail + ' failed  ================');
process.exit(fail ? 1 : 0);
