/**
 * v2.6.1 回归测试 —— 审计报告（审计报告-2026-10-31.md）里每条修复都对应一条断言
 * 纯 Node，不需要浏览器：node tools/test_v35.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const base = path.join(__dirname, '..', 'app', 'js');

/* ---------- 载入真实模块（和 tools/test_engine.js 一样的方式） ---------- */
function makeSandbox(withStorage) {
  const sb = { window: {}, console, Math, Date, JSON, parseFloat, parseInt, isNaN, isFinite, isNaN };
  sb.global = sb;
  if (withStorage) {
    const mem = {};
    sb.localStorage = {
      getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
      setItem: (k, v) => {
        if (sb.__quotaFull) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
        mem[k] = String(v);
      },
      removeItem: k => { delete mem[k]; }
    };
    sb.__mem = mem;
  }
  vm.createContext(sb);
  ['core.js', 'formats.js', 'engine.js'].forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(base, f), 'utf8'), sb, { filename: f });
  });
  return sb;
}

const SB = makeSandbox(true);
const TMS = SB.window.TMS;
const { util: U, model: M, engine: E, formats: F, store: S } = TMS;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

const nmOf = t => id => (t.players.find(x => x.id === id) || {}).name || null;
const seedOf = s => { const m = String(s).match(/(\d+)/); return m ? +m[1] : 99; };

function mk(type, n, opts) {
  const t = M.createTournament('T');
  for (let i = 1; i <= n; i++) t.players.push(M.createPlayer('P' + i, i));
  const st = t.stages[0];
  st.type = type;
  st.participants = t.players.map(p => p.id);
  if (opts) Object.assign(st, opts);
  return { t, st };
}
// 按种子序小者赢；strongestLast=true 时反过来
function playRound(t, st, rd, opts) {
  opts = opts || {};
  const nm = nmOf(t);
  rd.matches.forEach(m => {
    if (m.isBye) { E.evaluate(m, E.fmtOfMatch(t, st, m), st.tie); return; }
    const a = seedOf(nm(m.playerA)), b = seedOf(nm(m.playerB));
    let w = (a < b) ? 'A' : 'B';
    if (opts.weakWins) w = (a < b) ? 'B' : 'A';
    if (opts.thirdWeak && m.isThird) w = (a < b) ? 'B' : 'A';
    const fmt = E.fmtOfMatch(t, st, m);
    m.games = [];
    const need = parseInt(fmt.winNeeded, 10) > 0 ? parseInt(fmt.winNeeded, 10) : fmt.gamesPerMatch;
    for (let i = 0; i < need; i++) m.games.push({ w });
    E.evaluate(m, fmt, st.tie);
  });
}
function runToEnd(t, st, opts) {
  let g = 0;
  while (g++ < 60) {
    const r = E.generateRound(t);
    if (!r.ok) break;
    playRound(t, st, st.roundsData[st.roundsData.length - 1], opts);
    if (E.stageFinished(t, st)) break;
  }
}

/* ================= A. 季军赛：名次数组不能重复 ================= */
section('A. 季军赛名次');
{
  const { t, st } = mk('single_elim', 4, { thirdPlace: true });
  runToEnd(t, st, { thirdWeak: true });
  const rank = E.computeElimRanking(t, st) || [];
  const names = rank.map(nmOf(t));
  ok('名次数组长度 = 人数（不重复、不缺人）', names.length === 4, JSON.stringify(names));
  ok('没有重复的人', new Set(names).size === names.length, JSON.stringify(names));
  const third = st.roundsData.flatMap(rd => rd.matches).filter(m => m.isThird)[0];
  if (third && third.result) {
    const tw = third.result.winner === 'A' ? third.playerA : third.playerB;
    ok('季军赛胜者排第 3', names[2] === nmOf(t)(tw), JSON.stringify(names));
  }
}

/* ================= B. 退赛者不能排在前面 / 不能晋级 ================= */
section('B. 退赛者');
{
  const { t, st } = mk('single_elim', 4);
  t.players[3].active = false;                   // P4 赛前退赛
  t.players[3].dropReason = '退赛';
  runToEnd(t, st);
  const rank = (E.computeElimRanking(t, st) || []).map(nmOf(t));
  ok('退赛者排在最后', rank[rank.length - 1] === 'P4', JSON.stringify(rank));
  ok('退赛者不在晋级名单里', (st.advanced || []).indexOf(t.players[3].id) < 0,
    JSON.stringify((st.advanced || []).map(nmOf(t))));
}

/* ================= C. 双败半区互换：同一轮不能重复出场 ================= */
section('C. 双败半区互换');
{
  let dupInfo = '';
  [4, 6, 8, 10].forEach(n => {
    if (dupInfo) return;
    const { t, st } = mk('double_elim', n, { deCrossDrop: true });
    let g = 0;
    while (g++ < 40) {
      const r = E.generateRound(t);
      if (!r.ok) break;
      const rd = st.roundsData[st.roundsData.length - 1];
      const cnt = {};
      rd.matches.forEach(m => [m.playerA, m.playerB].forEach(id => { if (id) cnt[id] = (cnt[id] || 0) + 1; }));
      const twice = Object.keys(cnt).filter(id => cnt[id] > 1);
      if (twice.length) dupInfo = n + ' 人第 ' + (rd.index + 1) + ' 轮：' + twice.map(nmOf(t)).join('、');
      playRound(t, st, rd);
      if (E.stageFinished(t, st)) break;
    }
  });
  ok('没人同一轮出场两次', !dupInfo, dupInfo);
}

/* ================= D. 同名选手不能被合并 ================= */
section('D. 同名选手');
{
  const t = M.createTournament('同名');
  for (let i = 0; i < 4; i++) t.players.push(M.createPlayer('同名', i + 1));
  t.ptsRule.on = true;
  const st = t.stages[0];
  st.type = 'round_robin';
  st.participants = t.players.map(p => p.id);
  runToEnd(t, st);
  const out = E.tournamentPoints(t);
  ok('4 个同名选手 = 4 行', out.rows.length === 4, '行数=' + out.rows.length);
  ok('每行 stops 都是 1（不叠加）', out.rows.every(r => r.stops === 1),
    JSON.stringify(out.rows.map(r => r.stops)));
  ok('每行总分 = 单人分，不是四人之和', out.rows.every(r => r.total < 200),
    JSON.stringify(out.rows.map(r => r.total)));
}

/* ================= E. 累进分只累加已打完的轮次 ================= */
section('E. 累进分');
{
  const { t, st } = mk('round_robin', 4);
  E.generateRound(t);                        // 一次性生成全部轮次
  playRound(t, st, st.roundsData[0]);
  const st1 = E.standings(t, { stageIndex: 0 });
  const maxProg = Math.max(...st1.map(s => s.progressive));
  ok('只打 1 轮时累进分 = 3（不是 3×总轮数）', maxProg === 3, '实际=' + maxProg);
}

/* ================= F. 阶段结束判定 ================= */
section('F. stageFinished');
{
  const { t, st } = mk('round_robin', 4);
  E.generateRound(t);                        // 循环赛一次生成全部轮次
  ok('刚生成对阵 → 未结束', E.stageFinished(t, st) === false);
  ok('赛事也未被判成就结束', E.tournamentDone(t) === false);
  st.roundsData.forEach(rd => playRound(t, st, rd));
  ok('全部打完 → 结束', E.stageFinished(t, st) === true);
}

/* ================= G. 小组赛：轮空记 hasBye / 打完刷新 finished / 退赛不下场 ================= */
section('G. 小组赛');
{
  // G1 轮空
  const { t, st } = mk('groups', 3, { groupCount: 1, groupType: 'swiss' });
  E.ensureParticipants(t);
  st.groups = E.buildGroups(t, st);
  E.generateRound(t);
  const byes = st.roundsData[0].matches.filter(m => m.isBye);
  ok('3 人组第 1 轮有 1 个轮空', byes.length === 1, byes.length);
  const byeId = byes[0] && (byes[0].playerA || byes[0].playerB);
  ok('轮空者被标记 hasBye', !!(t.players.find(p => p.id === byeId) || {}).hasBye, byeId);
}
{
  // G2 finished 刷新
  const { t, st } = mk('groups', 6, { groupCount: 2, groupType: 'round_robin' });
  E.ensureParticipants(t);
  st.groups = E.buildGroups(t, st);
  let g = 0;
  while (g++ < 20) {
    const r = E.generateRound(t);
    if (!r.ok) break;
    const rd = st.roundsData[st.roundsData.length - 1];
    playRound(t, st, rd);
    E.finishRound(t);
    if (E.stageFinished(t, st)) break;
  }
  ok('全部打完后每组 finished = true', (st.groups || []).every(x => x.finished),
    JSON.stringify((st.groups || []).map(x => x.finished)));
}
{
  // G3 退赛者不再被编排
  const { t, st } = mk('groups', 6, { groupCount: 2, groupType: 'swiss' });
  E.ensureParticipants(t);
  st.groups = E.buildGroups(t, st);
  E.generateRound(t);
  const p1 = t.players[0];
  p1.active = false; p1.dropReason = '退赛';
  const before = st.roundsData.length;
  const r2 = E.generateRound(t);
  const later = st.roundsData.slice(before).flatMap(rd => rd.matches);
  ok('退赛者不再出现在新对阵里', !later.some(m => m.playerA === p1.id || m.playerB === p1.id),
    r2.msg || '');
  ok('退赛者也不在手动编排池里', E.manualPool(t, st, 0).indexOf(p1.id) < 0);
}

/* ================= H. 多回合（回合设定）：1:1 之后可以加赛 ================= */
section('H. 多回合加赛');
{
  const { t, st } = mk('swiss', 2, {});
  t.format = Object.assign(M.defaultFormat(), {
    gamesPerMatch: 1, winNeeded: 0, sets: 2, setRule: 'sets', setsToWin: 2
  });
  E.generateRound(t);
  const m = st.roundsData[0].matches[0];
  const fmt = E.fmtOfMatch(t, st, m);
  m.games = [{ s: 0, w: 'A' }]; E.evaluate(m, fmt, st.tie);
  m.games.push({ s: 1, w: 'B' }); E.evaluate(m, fmt, st.tie);
  ok('1:1 时判为未完成 + 需要加赛', m.decided === false && m.overtime === true,
    'decided=' + m.decided + ' overtime=' + m.overtime);
  ok('1:1 时仍可继续录入', E.canAddGame(m, fmt, st.tie) === true);
  ok('当前回合 = 加赛回合（第 3 个）', E.curSet(m, fmt, st.tie) === 2, E.curSet(m, fmt, st.tie));
  m.games.push({ s: E.curSet(m, fmt, st.tie), w: 'A' });
  E.evaluate(m, fmt, st.tie);
  ok('加赛打赢后出结果', m.decided === true && m.result.winner === 'A',
    JSON.stringify(m.result));
  ok('加赛后不能继续录入', E.canAddGame(m, fmt, st.tie) === false);
  ok('大比分 = 2:1（按回合口径）', m.result.gamesA === 2 && m.result.gamesB === 1,
    m.result.gamesA + ':' + m.result.gamesB);
}
{
  // 回合制下的分数档位枚举要跟回合口径一致
  const fmt = { gamesPerMatch: 1, winNeeded: 1, sets: 3, setRule: 'sets', setsToWin: 2 };
  const lines = E.scoreLines(fmt, 'sudden_death');
  const keys = lines.map(l => l.key);
  ok('3 回合两胜制：档位是 2-0 / 2-1', keys.indexOf('2-0') >= 0 && keys.indexOf('2-1') >= 0, keys.join(','));
  ok('不会再出现单回合的 1-0 档', keys.indexOf('1-0') < 0, keys.join(','));
}

/* ================= I. 自定义公式：语法错误要报出来 ================= */
section('I. 自定义公式');
{
  ['w*3+d', '(w+1)*gd', 'w - l + gw*0.5'].forEach(f => {
    ok('公式可用：' + f, E.validateFormula(f).ok === true, E.validateFormula(f).msg);
  });
  ['w+', '1 2', 'w^^2', 'w//2', '(w+1', 'w*'].forEach(f => {
    ok('公式报错：' + f, E.validateFormula(f).ok === false, E.validateFormula(f).msg);
  });
  ok('合法公式求值正确', E.evalFormula('w*3+gd', { w: 1, gd: 2 }) === 5, E.evalFormula('w*3+gd', { w: 1, gd: 2 }));
}

/* ================= J. 淘汰赛后阶段轮空给排名靠前者 ================= */
section('J. 轮空优先权');
{
  const ids = ['p1', 'p2', 'p3', 'p4'];
  const rank = ['p3', 'p1', 'p2', 'p4'];     // 排名序：P3 第一
  const slots = E.bracketSlots(ids, 6, rank);
  const byeIdx = [];
  for (let i = 0; i + 1 < slots.length; i += 2) {
    if (slots[i] && !slots[i + 1]) byeIdx.push(slots[i]);
    else if (!slots[i] && slots[i + 1]) byeIdx.push(slots[i + 1]);
  }
  ok('轮空给到排名第 1 的人', byeIdx.indexOf('p3') >= 0, JSON.stringify({ slots, byeIdx }));
}

/* ================= K. 名次并列：只按 points 时同分同名次 ================= */
section('K. 并列名次');
{
  const { t, st } = mk('swiss', 8, {});
  st.rounds = 2;
  t.scoring.tieOrder = ['points'];
  E.generateRound(t);
  playRound(t, st, st.roundsData[0]);
  E.generateRound(t);
  playRound(t, st, st.roundsData[1]);
  const stt = E.standings(t, { stageIndex: 0 });
  const byPts = {};
  let bad = '';
  stt.forEach(s => {
    if (byPts[s.points] === undefined) byPts[s.points] = s.rank;
    else if (byPts[s.points] !== s.rank) bad = s.points + ' 分出现两个名次 ' + byPts[s.points] + '/' + s.rank;
  });
  ok('同分同名次（破同只剩积分时）', !bad, bad);
}

/* ================= L. 后进选手要进小组 ================= */
section('L. 后进选手入组');
{
  const { t, st } = mk('groups', 6, { groupCount: 2, groupType: 'round_robin' });
  E.ensureParticipants(t);
  st.groups = E.buildGroups(t, st);
  const late = M.createPlayer('后进', 7);
  late.startStage = 0;
  t.players.push(late);
  E.ensureParticipants(t);
  const inSome = st.groups.some(g => g.players.indexOf(late.id) >= 0);
  ok('后进选手被补进某个小组', inSome, JSON.stringify(st.groups.map(g => g.players.length)));
}

/* ================= M. 0 人双败不产生空轮次 ================= */
section('M. 边界：空双败');
{
  const { t, st } = mk('double_elim', 0, {});
  st.participants = [];
  const r = E.generateDoubleElimRound(t);
  ok('返回失败而不是压一个空轮次', r.ok === false, JSON.stringify(r));
  ok('没有产生 roundsData', st.roundsData.length === 0, st.roundsData.length);
}

/* ================= N. 快照瘦身 ================= */
section('N. 回退快照');
{
  const { t, st } = mk('swiss', 32, {});
  for (let i = 0; i < 60; i++) E.snapshot(t);
  ok('快照上限 30 条', t.history.length === 30, t.history.length);
  ok('players 只在变化时存（后面都是 null）',
    t.history[0].players === null || t.history[1].players === null,
    '第一条=' + (t.history[0].players ? '有' : 'null') + ' 第二条=' + (t.history[1].players ? '有' : 'null'));
  E.generateRound(t);
  playRound(t, st, st.roundsData[0]);
  const okRollback = E.rollback(t);
  ok('回退仍可用', okRollback.ok === true, JSON.stringify(okRollback));
}

/* ================= O. 存档层：配额失败 / currentId / 导入校验 ================= */
section('O. 存档层');
{
  const t = M.createTournament('配额');
  ok('正常保存返回 true', S.put(t) === true);
  ok('改别人的赛事用 putQuiet：不动当前赛事指针',
    (function () {
      S.setCurrentId('another_id');
      S.putQuiet(t);
      return S.getCurrentId() === 'another_id';
    })());
  SB.__quotaFull = true;
  const okPut = S.put(t);
  const msg = S.lastError;
  SB.__quotaFull = false;
  ok('配额满时 put 返回 false', okPut === false);
  ok('配额满时给出可读提示', /存储空间已满/.test(msg), msg);

  // 导入校验
  ok('players 不是数组 → 拒绝', S.validateImport({ players: 'abc' }).ok === false);
  ok('不是对象 → 拒绝', S.validateImport([]).ok === false);
  ok('正常存档 → 通过', S.validateImport({ id: 'x', players: [] }).ok === true);

  // normalize 容错
  let threw = false;
  let norm = null;
  try { norm = S.normalize({ players: [{ id: '<img src=x>', name: 'x', seed: 'abc' }] }); }
  catch (e) { threw = true; }
  ok('脏存档不会抛异常', threw === false);
  ok('非法 id 被重发', norm && !/[<>]/.test(norm.players[0].id), norm && norm.players[0].id);
  ok('非法 seed 归零', norm && norm.players[0].seed === 0, norm && norm.players[0].seed);
}

/* ================= P. CSV 注入 ================= */
section('P. CSV 注入');
{
  // exporter 需要 window.TMS + document，这里只测纯函数部分
  const sb2 = { window: {}, console, Math, Date, JSON, parseFloat, parseInt, isNaN, isFinite };
  sb2.global = sb2;
  vm.createContext(sb2);
  ['core.js', 'formats.js', 'engine.js', 'exporter.js'].forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(base, f), 'utf8'), sb2, { filename: f });
  });
  const X = sb2.window.TMS.exporter;
  const csv = X.toCSV([['名字', '值'], ['=1+1', '2'], ['-3', '-3'], ['@cmd', 'x']]);
  ok('公式开头加引号前缀', /'=1\+1/.test(csv), csv.split('\r\n')[1]);
  ok('@ 开头也加前缀', /'@cmd/.test(csv), csv.split('\r\n')[3]);
  ok('负数保持数字形态', /,-3/.test(csv), csv.split('\r\n')[2]);
}

console.log('\n========================================');
console.log('v2.6.1 回归：PASS ' + pass + ' / FAIL ' + fail);
if (fail) process.exit(1);
