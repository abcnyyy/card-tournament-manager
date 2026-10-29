/**
 * v2.4 引擎测试
 *  A. 提前晋级 / 淘汰开启后：轮空只有「人数为奇数」时才有 1 个，且不重复给人
 *  B. 循环赛人数为奇数：空对手必须算轮空（整轮不会卡住）
 *  C. 赛季计分方案：single（一套）/ stage（逐阶段），逐阶段能真的改方式与分值
 *  D. 老赛季兼容：只有「叠加方式」覆盖的存档行为不变；残留的逐阶段规则有迹可循
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const base = path.join(__dirname, '..', 'app', 'js');
const sandbox = { window: {}, console, Math, Date, JSON, parseFloat, parseInt, isNaN, Object, Array, String, Number };
sandbox.global = sandbox;
vm.createContext(sandbox);
['core.js', 'formats.js', 'engine.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(base, f), 'utf8'), sandbox, { filename: f });
});
const TMS = sandbox.window.TMS;
const { model: M, engine: E, formats: F, store: S } = TMS;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra === undefined ? '' : '  ->  ' + JSON.stringify(extra))); }
}
function sec(t) { console.log('\n=== ' + t + ' ==='); }

function setRes(m, winner) {
  if (m.isBye || !m.playerA || !m.playerB) return;
  m.games = [{ w: winner }];
  E.evaluate(m, { gamesPerMatch: 1, winNeeded: 1, recordScore: false }, 'sudden_death');
}
function nm(t, id) { const p = t.players.find(function (x) { return x.id === id; }); return p ? p.name : id; }

/* ================= A. 轮空（提前晋级 / 淘汰） ================= */
sec('A. 轮空：只在人数为奇数时出现，且不会重复给同一个人');

/* A1 直接测配对底层：偶数池绝不返回轮空 */
{
  const played = {};
  ['P1|P2', 'P3|P4', 'P1|P3', 'P1|P4', 'P2|P3'].forEach(function (k) {
    played[k] = 1; played[k.split('|').reverse().join('|')] = 1;
  });
  const r4 = F.avoidRepeats(['P1', 'P2', 'P3', 'P4'], played);
  ok('A1 偶数池（4 人，几乎都交手过）不产生轮空',
    r4.length === 2 && r4.every(function (p) { return p[1]; }), JSON.stringify(r4));
  const r3 = F.avoidRepeats(['P1', 'P2', 'P3'], played);
  const byes3 = r3.filter(function (p) { return !p[1]; }).length;
  ok('A2 奇数池（3 人）正好 1 个轮空', byes3 === 1 && r3.length === 2, JSON.stringify(r3));
  const r2 = F.avoidRepeats(['P1', 'P2'], played);
  ok('A3 两人池（已交手）= 硬配一场，不留轮空', r2.length === 1 && r2[0][1], JSON.stringify(r2));
}
/* A2 瑞士轮 + 提前晋级：每轮轮空数 = 人数 % 2，且同阶段内不重复 */
{
  const t = M.createTournament('轮空测试');
  for (let i = 1; i <= 15; i++) t.players.push(M.createPlayer('P' + i, i));
  const st = t.stages[0];
  st.type = 'swiss';
  st.rounds = 8;
  st.clinch = { enabled: true, basis: 'match', winTarget: 10, lossTarget: 10 };  // 只为了触发确保流程
  t.status = 'running';

  let bad = 0, dup = 0, rows = [];
  const seen = {};
  for (let r = 0; r < 6; r++) {
    const g = E.generateRound(t);
    if (!g.ok) break;
    const rd = st.roundsData[st.roundsData.length - 1];
    const alive = E.aliveInStage(t, st).length;
    const byes = rd.matches.filter(function (m) { return m.isBye; });
    const real = rd.matches.filter(function (m) { return !m.isBye; });
    const expect = alive % 2;
    rows.push(alive + '/' + byes.length);
    if (byes.length !== expect) bad++;
    if (real.length * 2 + byes.length !== alive) bad++;
    byes.forEach(function (m) {
      const id = m.playerA || m.playerB;
      if (!id) bad++;                    // 谁都不是的「空轮空」
      else { if (seen[id]) dup++; seen[id] = 1; }
    });
    rd.matches.forEach(function (m) { if (!m.isBye) setRes(m, Math.random() < 0.5 ? 'A' : 'B'); });
    E.finishRound(t, st);
  }
  ok('A4 每轮轮空数 = 参赛人数 % 2（15 人 → 每轮 1 个）', bad === 0, rows.join(' | '));
  ok('A5 6 轮里没有重复轮空给同一个人', dup === 0, 'dup=' + dup);
}
/* A3 提前淘汰制造奇数人数：仍然只有 1 个轮空 */
{
  const t = M.createTournament('淘汰线');
  for (let i = 1; i <= 12; i++) t.players.push(M.createPlayer('P' + i, i));
  const st = t.stages[0];
  st.type = 'swiss';
  st.clinch = { enabled: true, basis: 'match', winTarget: 2, lossTarget: 3 };
  t.status = 'running';
  let bad = 0, rows = [];
  for (let r = 0; r < 4; r++) {
    const g = E.generateRound(t);
    if (!g.ok) break;
    const rd = st.roundsData[st.roundsData.length - 1];
    const alive = E.aliveInStage(t, st).length;
    const byes = rd.matches.filter(function (m) { return m.isBye; });
    rows.push(alive + '人/' + byes.length + '轮空/' + (st.clinched || []).length + '晋级/' + (st.eliminated || []).length + '淘汰');
    if (byes.length !== alive % 2) bad++;
    if (byes.some(function (m) { return !(m.playerA || m.playerB); })) bad++;
    // 打完后按 A/B 交替，制造一部分人提前达标
    rd.matches.forEach(function (m, i) { if (!m.isBye) setRes(m, (i % 3 === 0) ? 'A' : 'B'); });
    E.finishRound(t, st);
  }
  ok('A6 提前晋级/淘汰后轮空数依然正确', bad === 0, rows.join(' | '));
  ok('A7 确实发生了提前晋级或淘汰（场景有效）',
    (st.clinched || []).length + (st.eliminated || []).length > 0,
    JSON.stringify({ c: (st.clinched || []).length, e: (st.eliminated || []).length }));
}

/* ================= B. 循环赛奇数人数 ================= */
sec('B. 循环赛：人数为奇数时「空对手」必须算轮空');
{
  const t = M.createTournament('循环赛');
  for (let i = 1; i <= 5; i++) t.players.push(M.createPlayer('P' + i, i));
  const st = t.stages[0];
  st.type = 'round_robin';
  st.cycles = 1;
  t.status = 'running';
  const g = E.generateRound(t);
  ok('B1 一次性生成 5 轮（5 人循环）', g.ok && st.roundsData.length === 5, g.msg || st.roundsData.length);
  let phantom = 0, byeOk = 0, keyed = 0;
  st.roundsData.forEach(function (rd) {
    rd.matches.forEach(function (m) {
      if (!m.playerA && !m.playerB) phantom++;
      if ((!m.playerA || !m.playerB) && m.playerA) { if (m.isBye) byeOk++; else keyed++; }
    });
  });
  ok('B2 没有「谁都不是」的空桌', phantom === 0, phantom);
  ok('B3 全部单边对阵都标了 isBye', keyed === 0, 'keyed=' + keyed);
  ok('B4 每轮正好 1 人轮空', byeOk === 5, byeOk);
  // 把整轮打完：轮空不应再卡住「本轮完成」
  const rd0 = st.roundsData[0];
  rd0.matches.forEach(function (m) { if (!m.isBye) setRes(m, 'A'); });
  const chk = E.roundComplete(t, st, rd0);
  ok('B5 奇数人数的一轮可以正常判定「已完成」', chk.ok === true, chk.msg);
}

/* ---------- 造一站：4 人单败，名次 = names 顺序 ---------- */
function makeStop(names, opts) {
  opts = opts || {};
  const t = M.createTournament(opts.name || '站点');
  t.createdAt = opts.createdAt || '2026-01-01 10:00';
  names.forEach(function (n, i) { t.players.push(M.createPlayer(n, i + 1)); });
  t.status = 'running';
  const s = M.defaultStage(0);
  s.type = 'single_elim';
  s.name = opts.stageName || '淘汰赛';
  s.participants = t.players.map(function (p) { return p.id; });
  s.adv = { type: 'count', count: 1, score: 0, perGroup: 1 };
  s.format = { gamesPerMatch: 1, winNeeded: 1, recordScore: false };
  s.useFormat = true;
  t.stages = [s];
  t.currentStage = 0;
  for (let r = 0; r < Math.log2(names.length); r++) {
    const g = E.generateRound(t);
    if (!g.ok) break;
    const rd = s.roundsData[s.roundsData.length - 1];
    rd.matches.forEach(function (m) {
      if (!m.playerA || !m.playerB) return;
      if (m.isBye) return;
      const sa = t.players.filter(function (p) { return p.id === m.playerA; })[0];
      const sb = t.players.filter(function (p) { return p.id === m.playerB; })[0];
      setRes(m, (sa.seed <= sb.seed) ? 'A' : 'B');
    });
    E.finishRound(t, s);
  }
  s.status = 'finished';
  t.status = 'finished';
  if (opts.pts) {
    t.ptsRule = Object.assign(M.defaultPtsRule(), { on: true, unit: 'tournament', mode: 'rank' });
  }
  return t;
}
/* 造一站：两个阶段（每个阶段 4 人单败） */
function makeTwoStage(names, opts) {
  opts = opts || {};
  const t = M.createTournament(opts.name || '两阶段站');
  t.createdAt = opts.createdAt || '2026-01-01 10:00';
  names.forEach(function (n, i) { t.players.push(M.createPlayer(n, i + 1)); });
  t.status = 'running';
  t.stages = [];
  for (let si = 0; si < 2; si++) {
    const s = M.defaultStage(si);
    s.name = '第 ' + (si + 1) + ' 阶段';
    s.type = 'single_elim';
    s.participants = t.players.map(function (p) { return p.id; });
    s.adv = { type: 'all', count: 4, score: 0, perGroup: 1 };
    s.format = { gamesPerMatch: 1, winNeeded: 1, recordScore: false };
    s.useFormat = true;
    t.stages.push(s);
  }
  t.currentStage = 0;
  t.stages.forEach(function (s) {
    for (let r = 0; r < 2; r++) {
      const g = E.generateRound(t);
      if (!g.ok) break;
      const rd = s.roundsData[s.roundsData.length - 1];
      rd.matches.forEach(function (m) {
        if (!m.playerA || !m.playerB || m.isBye) return;
        const sa = t.players.filter(function (p) { return p.id === m.playerA; })[0];
        const sb = t.players.filter(function (p) { return p.id === m.playerB; })[0];
        setRes(m, (sa.seed <= sb.seed) ? 'A' : 'B');
      });
      E.finishRound(t, s);
    }
    s.status = 'finished';
    t.currentStage = Math.min(1, s.index + 1);
  });
  t.status = 'finished';
  return t;
}

/* ================= C. 赛季计分方案 ================= */
sec('C. 赛季计分方案：一套 vs 逐阶段');
{
  const t = makeTwoStage(['A', 'B', 'C', 'D'], { name: '春季赛' });
  const se = M.defaultSeason('测试赛季');
  se.rule.source = 'season';
  se.rule.unit = 'stage';
  se.rule.plan = 'single';
  se.rule.mode = 'rank';
  se.rule.stack = true;
  se.rule.rank = { tiers: [{ from: 1, to: 1, pts: 100, adv: false }, { from: 2, to: 2, pts: 60, adv: false }, { from: 3, to: 3, pts: 40, adv: false }, { from: 4, to: 4, pts: 20, adv: false }], step: 5, floor: 5 };
  const u0 = 't:' + t.id + '#0';
  const u1 = 't:' + t.id + '#1';

  let tab = E.seasonTable(se, [t]);
  ok('C1 两阶段 = 2 个计分单元', tab.units.length === 2, tab.units.map(function (u) { return u.label; }));
  ok('C2 方案识别为 single', E.seasonPlan(se) === 'single', E.seasonPlan(se));
  const a0 = tab.rows.filter(function (r) { return r.name === 'A'; })[0];
  ok('C3 A 两阶段都是第 1：100 + 100 = 200', a0 && a0.total === 200, a0 && a0.total);

  // —— 原来「只能按固有模式」的 bug：逐阶段应该能改方式 + 分值 ——
  se.rule.plan = 'stage';
  const ov0 = E.seasonStageRule(se, u0);
  ov0.mode = 'win';
  ov0.win = { perWin: 10, perDraw: 0, perLoss: 0, base: 5 };
  const ov1 = E.seasonStageRule(se, u1);
  ov1.mode = 'rank';
  ov1.rank.tiers = [{ from: 1, to: 1, pts: 30, adv: false }];
  ov1.rank.step = 1;
  ov1.rank.floor = 0;

  tab = E.seasonTable(se, [t]);
  ok('C4 方案识别为 stage', E.seasonPlan(se) === 'stage', E.seasonPlan(se));
  const rA = tab.rows.filter(function (r) { return r.name === 'A'; })[0];
  const rB = tab.rows.filter(function (r) { return r.name === 'B'; })[0];
  // A：第 1 阶段 2 胜 → 5 + 20 = 25；第 2 阶段第 1 → 30
  ok('C5 逐阶段改了「方式 + 分值」后第 1 阶段按胜场算（2 胜 = 25）',
    rA.units[u0] && rA.units[u0].pts === 25, rA.units[u0] && rA.units[u0].pts);
  ok('C6 第 2 阶段用自己那套名次分（第 1 名 30）',
    rA.units[u1] && rA.units[u1].pts === 30, rA.units[u1] && rA.units[u1].pts);
  ok('C7 每个阶段的分值互不影响（A 合计 55）', rA.total === 55, rA.total);
  ok('C8 单元上记录了各自的方式', tab.units[0].mode === 'win' && tab.units[1].mode === 'rank',
    [tab.units[0].mode, tab.units[1].mode]);
  ok('C9 逐阶段改档位后第 2 名也能拿分（B 第 1 阶段 1 胜 = 15）',
    rB && rB.units[u0] && rB.units[u0].pts === 15, rB && rB.units[u0]);

  // 第 2 阶段改成「不叠加」→ 前面阶段的分被重新起算清掉
  ov1.stack = false;
  tab = E.seasonTable(se, [t]);
  const rA2 = tab.rows.filter(function (r) { return r.name === 'A'; })[0];
  ok('C10 第 2 阶段不叠加 → 总分只剩本阶段 30', rA2.total === 30, rA2.total);
  ok('C11 不叠加时前面的单元不再出现在明细里', !rA2.units[u0], Object.keys(rA2.units));

  // 回到 single：逐阶段规则不再生效（先在 UI 里清除，这里模拟）
  se.rule.overrides = {};
  se.rule.plan = 'single';
  tab = E.seasonTable(se, [t]);
  const rr = tab.rows.filter(function (r) { return r.name === 'A'; })[0];
  ok('C12 清掉逐阶段规则后又回到统一分值（100 + 100）', rr.total === 200, rr.total);
}

/* ================= D. 老赛季兼容 ================= */
sec('D. 老赛季兼容');
{
  const t1 = makeStop(['A', 'B', 'C', 'D'], { name: '第 1 站', createdAt: '2026-01-01 10:00', pts: true });
  const t2 = makeStop(['C', 'D', 'A', 'B'], { name: '第 2 站', createdAt: '2026-02-01 10:00', pts: true });

  // 只有「叠加方式」覆盖的老存档
  const old = {
    v: 1, id: 'se_old', name: '老赛季', createdAt: '2026-01-01', updatedAt: '2026-01-01',
    rule: {
      source: 'season', unit: 'tournament', stack: true, mode: 'rank',
      rank: { top: { 1: 100, 2: 80, 3: 65, 4: 55 }, step: 5, floor: 5 },
      win: { perWin: 10, perDraw: 5, perLoss: 0, base: 0 },
      resetScope: 'participants', includeRunning: false,
      overrides: {}
    }
  };
  old.rule.overrides['t:' + t2.id] = { stack: false };
  S.normalizeSeason(old);
  // v2.5：没点过方案按钮、分值也是出厂默认 → 自动回到「各站自己的积分」
  ok('D1 老存档（只覆盖叠加）自动改判为「各站自己的积分」', E.seasonPlan(old) === 'site', old.rule.plan);
  const tab = E.seasonTable(old, [t1, t2]);
  const get = function (n) { return (tab.rows.filter(function (r) { return r.name === n; })[0] || {}).total; };
  const siteA2 = (E.tournamentPoints(t2).rows.filter(function (r) { return r.name === 'A'; })[0] || {}).total;
  const siteA1 = (E.tournamentPoints(t1).rows.filter(function (r) { return r.name === 'A'; })[0] || {}).total;
  ok('D2 各站按自己的积分榜算（A 第 1 站第 1 = 100）', siteA1 === 100, siteA1);
  ok('D2b 第 2 站不叠加仍然生效（A 只剩本站的分）', get('A') === siteA2, [get('A'), siteA2]);
  ok('D2c 有参与的其他人也被重置（C 只剩本站 100）', get('C') === 100, get('C'));

  // 叠加口径下：两站分数相加
  const oldS = JSON.parse(JSON.stringify(old));
  oldS.id = 'se_old_stack';
  delete oldS.rule.overrides['t:' + t2.id];
  S.normalizeSeason(oldS);
  const tabS = E.seasonTable(oldS, [t1, t2]);
  const totalS = function (n) { return (tabS.rows.filter(function (r) { return r.name === n; })[0] || {}).total; };
  ok('D2d 叠加时两站分数相加（A = 100 + 本站）', totalS('A') === siteA1 + siteA2, totalS('A'));

  // 有阶段级计分规则的老存档 → 自动识别为逐阶段
  const old2 = {
    v: 1, id: 'se_old2', name: '老赛季2', createdAt: '2026-01-01', updatedAt: '2026-01-01',
    rule: {
      source: 'season', unit: 'stage', stack: true, mode: 'rank',
      rank: { tiers: [{ from: 1, to: 1, pts: 100 }], step: 5, floor: 5 },
      win: { perWin: 10, perDraw: 5, perLoss: 0, base: 0 },
      resetScope: 'participants', includeRunning: false, overrides: {}
    }
  };
  old2.rule.overrides['t:' + t1.id + '#0'] = { mode: 'win', win: { perWin: 7, base: 0 } };
  S.normalizeSeason(old2);
  ok('D3 带阶段级计分规则的老存档自动识别为「逐阶段」', old2.rule.plan === 'stage', old2.rule.plan);
  const ru = E.seasonRuleFor(old2, { key: 't:' + t1.id + '#0' });
  ok('D4 老覆盖里的 win 分值仍然生效', ru.mode === 'win' && ru.win.perWin === 7, ru);
  ok('D5 没覆盖的字段仍从统一规则继承', ru.rank.tiers[0].pts === 100, ru.rank.tiers[0].pts);
}

/* ================= E. 新赛季默认 ================= */
sec('E. 新建赛季默认值');
{
  const se = M.defaultSeason('新');
  ok('E1 新赛季默认 plan=single', se.rule.plan === 'single', se.rule.plan);
  ok('E2 新赛季默认走「各站自己的积分」', E.seasonPlan(se) === 'site', E.seasonPlan(se));
  ok('E3 默认没有逐单元覆盖', Object.keys(se.rule.overrides).length === 0);
  const se2 = M.defaultSeason('新2');
  se2.rule.source = 'season';
  se2.rule.plan = 'stage';
  se2.rule.planLock = true;           // 显式选过方案
  se2.rule.unit = 'tournament';       // 故意写错，normalize 应纠正
  S.normalizeSeason(se2);
  ok('E4 逐阶段方案强制按阶段分单元', se2.rule.unit === 'stage', se2.rule.unit);
}

console.log('\n===============================');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
console.log('===============================');
process.exit(fail ? 1 : 0);
