/**
 * v1.13.0 引擎测试：积分体系下沉到赛事，赛季只做加总
 *  A. 名次分档可以很多档（前 4 / 前 16 / 前 32）
 *  B. 赛事积分榜：整站算一次
 *  C. 赛事积分榜：站内每个阶段各算一次（叠加 / 不叠加 / 全榜重置）
 *  D. 阶段单独设置积分规则
 *  E. 赛季 = 各站积分加总（两站规则不同也能加）
 *  F. 未启用积分榜的赛事不计分，并给出提示
 *  G. 兼容：source='season' 的老口径不受赛事 ptsRule 影响
 *  H. 归一化：旧存档补齐 ptsRule，名次档位键统一
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
const TMS = sandbox.window.TMS;
const { model: M, engine: E, store: S } = TMS;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra === undefined ? '' : '  →  ' + JSON.stringify(extra))); }
}
function sec(t) { console.log('\n[' + t + ']'); }

/* ---------- 造一站单败淘汰：种子靠前者一路赢，名次 = names 顺序 ---------- */
function makeStop(names, opts) {
  opts = opts || {};
  const t = M.createTournament(opts.name || '站点');
  t.createdAt = opts.createdAt || '2026-01-01 10:00';
  names.forEach(function (n, i) { t.players.push(M.createPlayer(n, i + 1)); });
  t.status = 'running';
  if (opts.ptsRule) t.ptsRule = M.normalizePtsRule(opts.ptsRule);

  const s = M.defaultStage(0);
  s.type = 'single_elim';
  s.name = opts.stageName || '淘汰赛';
  s.participants = t.players.map(function (p) { return p.id; });
  s.adv = { type: 'count', count: 1, score: 0, perGroup: 1 };
  s.format = { gamesPerMatch: 1, winNeeded: 1, recordScore: false };
  s.useFormat = true;
  t.stages = [s];
  t.currentStage = 0;

  const rounds = Math.log2(names.length);
  for (let r = 0; r < rounds; r++) {
    if (opts.partial && r >= 1) break;
    const g = E.generateRound(t);
    if (!g.ok) break;
    const rd = s.roundsData[s.roundsData.length - 1];
    rd.matches.forEach(function (m) {
      if (!m.playerA || !m.playerB) return;
      if (m.isBye) { E.evaluate(m, E.fmtOfMatch(t, s, m), s.tie); return; }
      const sa = t.players.filter(function (p) { return p.id === m.playerA; })[0];
      const sb = t.players.filter(function (p) { return p.id === m.playerB; })[0];
      const w = (sa.seed <= sb.seed) ? 'A' : 'B';
      m.games = [{ w: w, a: 1, b: 0 }];
      E.evaluate(m, E.fmtOfMatch(t, s, m), s.tie);
    });
    E.finishRound(t);
  }
  if (!opts.running) { s.status = 'finished'; t.status = 'finished'; }
  return t;
}

// 在一站赛事后面追加一个只有前 n 人参加的单败阶段
function addFinalStage(t, n, winnerSide) {
  const s2 = M.defaultStage(t.stages.length);
  s2.type = 'single_elim';
  s2.name = '第 ' + (t.stages.length + 1) + ' 阶段';
  s2.participants = t.players.slice(0, n).map(function (p) { return p.id; });
  s2.adv = { type: 'count', count: 1, score: 0, perGroup: 1 };
  s2.format = { gamesPerMatch: 1, winNeeded: 1, recordScore: false };
  s2.useFormat = true;
  t.stages.push(s2);
  t.currentStage = t.stages.length - 1;
  const rounds = Math.log2(n);
  for (let r = 0; r < rounds; r++) {
    const g = E.generateRound(t);
    if (!g.ok) break;
    const rd = s2.roundsData[s2.roundsData.length - 1];
    rd.matches.forEach(function (m) {
      if (!m.playerA || !m.playerB) return;
      if (m.isBye) { E.evaluate(m, E.fmtOfMatch(t, s2, m), s2.tie); return; }
      m.games = [{ w: winnerSide || 'A', a: 1, b: 0 }];
      E.evaluate(m, E.fmtOfMatch(t, s2, m), s2.tie);
    });
    E.finishRound(t);
  }
  s2.status = 'finished';
  return s2;
}

function mkSeason(rule, src) {
  const s = M.defaultSeason('测试赛季');
  s.rule.source = src || 'tournament';
  if (rule) Object.assign(s.rule, rule);
  return s;
}
function rowOf(tab, n) { return tab.rows.filter(function (r) { return r.name === n; })[0] || {}; }

/* ================= A. 多档名次分 ================= */
sec('A. 名次分档（多档）');
{
  const top = {};
  for (let i = 1; i <= 16; i++) top[i] = 200 - (i - 1) * 10;   // 200,190,…,50
  const rule = { rank: { top: top, step: 5, floor: 5 } };
  ok('A1 第 1 名 = 200', E.rankPoints(rule, 1) === 200, E.rankPoints(rule, 1));
  ok('A2 第 16 名 = 50', E.rankPoints(rule, 16) === 50, E.rankPoints(rule, 16));
  ok('A3 第 17 名 = 50-5 = 45', E.rankPoints(rule, 17) === 45, E.rankPoints(rule, 17));
  ok('A4 第 100 名触底 = 5', E.rankPoints(rule, 100) === 5, E.rankPoints(rule, 100));
  ok('A5 seasonRankPoints 别名等价', E.seasonRankPoints(rule, 3) === E.rankPoints(rule, 3));
  // 只填奇数档：偶数名次从上一档递推
  const odd = { rank: { top: { 1: 100, 3: 60, 5: 20 }, step: 5, floor: 0 } };
  ok('A6 缺档递推（第 2 名 = 95）', E.rankPoints(odd, 2) === 95, E.rankPoints(odd, 2));
  ok('A7 缺档递推（第 4 名 = 55）', E.rankPoints(odd, 4) === 55, E.rankPoints(odd, 4));
  ok('A8 有明确档位时以明确值为准（第 5 名 = 20）', E.rankPoints(odd, 5) === 20, E.rankPoints(odd, 5));
}

/* ================= B. 赛事积分榜（整站） ================= */
sec('B. 赛事积分榜（整站算一次）');
{
  const t = makeStop(['A', 'B', 'C', 'D'], {
    ptsRule: { on: true, mode: 'rank', unit: 'tournament', rank: { top: { 1: 100, 2: 80, 3: 65, 4: 55 }, step: 5, floor: 10 } }
  });
  const tp = E.tournamentPoints(t);
  ok('B1 已启用 → on=true', tp.on === true);
  ok('B2 整站只有 1 个计分单元', tp.units.length === 1, tp.units.length);
  ok('B3 冠军 100 / 亚军 80', rowOf(tp, 'A').total === 100 && rowOf(tp, 'B').total === 80,
    [rowOf(tp, 'A').total, rowOf(tp, 'B').total]);
  ok('B4 名次连续 1..4', tp.rows.map(function (r) { return r.pos; }).join(',') === '1,2,3,4',
    tp.rows.map(function (r) { return r.pos; }));
  ok('B5 明细键为 all（整站）', !!rowOf(tp, 'A').units.all, Object.keys(rowOf(tp, 'A').units));

  const off = makeStop(['A', 'B', 'C', 'D'], {});
  const tp2 = E.tournamentPoints(off);
  ok('B6 未启用 → 不产生积分榜', tp2.on === false && tp2.rows.length === 0);
}

/* ================= C. 站内每阶段 ================= */
sec('C. 赛事积分榜（站内每个阶段各算一次）');
{
  const t = makeStop(['A', 'B', 'C', 'D'], {
    name: '两阶段站',
    ptsRule: { on: true, mode: 'rank', unit: 'stage', stack: true, rank: { top: { 1: 100, 2: 80, 3: 65, 4: 55 }, step: 5, floor: 10 } }
  });
  addFinalStage(t, 2);
  const tp = E.tournamentPoints(t);
  ok('C1 两个阶段 → 2 个计分单元', tp.units.length === 2, tp.units.map(function (u) { return u.label; }));
  ok('C2 叠加：A = 100(阶段1冠军) + 100(阶段2冠军) = 200', rowOf(tp, 'A').total === 200, rowOf(tp, 'A').total);
  ok('C3 只打一个阶段的人计分次数 = 1', rowOf(tp, 'C').stops === 1, rowOf(tp, 'C').stops);
  ok('C4 明细键按阶段分开', Object.keys(rowOf(tp, 'A').units).length === 2, Object.keys(rowOf(tp, 'A').units));

  // 不叠加：进入第 2 阶段的人重新起算
  const t2 = makeStop(['A', 'B', 'C', 'D'], {
    name: '不叠加站',
    ptsRule: { on: true, mode: 'rank', unit: 'stage', stack: false, resetScope: 'participants',
      rank: { top: { 1: 100, 2: 80, 3: 65, 4: 55 }, step: 5, floor: 10 } }
  });
  addFinalStage(t2, 2);
  const tp2 = E.tournamentPoints(t2);
  ok('C5 不叠加：A 只剩第 2 阶段的 100', rowOf(tp2, 'A').total === 100, rowOf(tp2, 'A').total);
  ok('C6 不叠加：没进第 2 阶段的 C 保留第 1 阶段的 65', rowOf(tp2, 'C').total === 65, rowOf(tp2, 'C').total);

  // 全榜清零
  const t3 = makeStop(['A', 'B', 'C', 'D'], {
    name: '全榜清零站',
    ptsRule: { on: true, mode: 'rank', unit: 'stage', stack: false, resetScope: 'all',
      rank: { top: { 1: 100, 2: 80, 3: 65, 4: 55 }, step: 5, floor: 10 } }
  });
  addFinalStage(t3, 2);
  const tp3 = E.tournamentPoints(t3);
  ok('C7 全榜清零：没进第 2 阶段的 C = 0', rowOf(tp3, 'C').total === 0, rowOf(tp3, 'C').total);
}

/* ================= D. 阶段单独设置 ================= */
sec('D. 阶段单独设置积分规则');
{
  const t = makeStop(['A', 'B', 'C', 'D'], {
    name: '混搭站',
    ptsRule: { on: true, mode: 'rank', unit: 'stage', stack: true,
      rank: { top: { 1: 100, 2: 80, 3: 65, 4: 55 }, step: 5, floor: 10 } }
  });
  addFinalStage(t, 2);
  // 第 2 阶段改成按胜场
  t.ptsRule.stageOv['1'] = M.normalizePtsRule({
    on: true, mode: 'win', unit: 'tournament',
    win: { perWin: 10, perDraw: 0, perLoss: 0, base: 0 }
  });
  const tp = E.tournamentPoints(t);
  const a = rowOf(tp, 'A');
  // 阶段1 冠军 100 + 阶段2 赢 1 场 10 = 110
  ok('D1 阶段 1 按名次、阶段 2 按胜场，混算正确（A = 110）', a.total === 110, a.total);
  ok('D2 阶段 2 明细 = 10', a.units['s1'] && a.units['s1'].pts === 10, a.units);

  const rule = E.ptsRuleFor(t, 1);
  ok('D3 ptsRuleFor(阶段1) 返回独立规则', rule.mode === 'win', rule.mode);
  const rule0 = E.ptsRuleFor(t, 0);
  ok('D4 没有单独设置的阶段跟随赛事默认', rule0.mode === 'rank', rule0.mode);
  ok('D5 ptsRuleFor(null) 返回赛事默认', E.ptsRuleFor(t, null).mode === 'rank');
}

/* ================= E. 赛季 = 各站加总 ================= */
sec('E. 赛季只做加总');
{
  const t1 = makeStop(['A', 'B', 'C', 'D'], {
    name: '第 1 站', createdAt: '2026-01-01 10:00',
    ptsRule: { on: true, mode: 'rank', unit: 'tournament', rank: { top: { 1: 100, 2: 80, 3: 65, 4: 55 }, step: 5, floor: 10 } }
  });
  const t2 = makeStop(['B', 'C', 'D', 'A'], {
    name: '第 2 站', createdAt: '2026-02-01 10:00',
    // 第 2 站的分值完全不一样，赛季照样按各站自己的算
    ptsRule: { on: true, mode: 'rank', unit: 'tournament', rank: { top: { 1: 50, 2: 40, 3: 30, 4: 20 }, step: 2, floor: 5 } }
  });
  const season = mkSeason({ stack: true, includeRunning: true });
  const tab = E.seasonTable(season, [t1, t2]);
  ok('E1 来源为 tournament', tab.source === 'tournament', tab.source);
  ok('E2 两站 → 2 个计分单元', tab.units.length === 2 && tab.counted === 2, [tab.units.length, tab.counted]);
  ok('E3 A = 100(第1站) + 20(第2站第4) = 120', rowOf(tab, 'A').total === 120, rowOf(tab, 'A').total);
  ok('E4 B = 80 + 50 = 130', rowOf(tab, 'B').total === 130, rowOf(tab, 'B').total);
  ok('E5 B 排第一', tab.rows[0].name === 'B', tab.rows.map(function (r) { return [r.name, r.total]; }));
  ok('E6 每人记 2 站', tab.rows.every(function (r) { return r.stops === 2; }));

  // 赛季层面的「不叠加」：第 2 站重新起算
  const s2 = mkSeason({ stack: true, includeRunning: true });
  s2.rule.overrides['t:' + t2.id] = { stack: false };
  const tab2 = E.seasonTable(s2, [t1, t2]);
  ok('E7 单站不叠加：A 只剩第 2 站的 20', rowOf(tab2, 'A').total === 20, rowOf(tab2, 'A').total);

  // 站内按阶段计分时，赛季仍然按站加总
  const t3 = makeStop(['A', 'B', 'C', 'D'], {
    name: '按阶段的站', createdAt: '2026-03-01 10:00',
    ptsRule: { on: true, mode: 'rank', unit: 'stage', stack: true, rank: { top: { 1: 100, 2: 80, 3: 65, 4: 55 }, step: 5, floor: 10 } }
  });
  addFinalStage(t3, 2);
  const tab3 = E.seasonTable(mkSeason({ stack: true, includeRunning: true }), [t3]);
  ok('E8 站内按阶段算，赛季仍按站加总（1 个单元）', tab3.units.length === 1, tab3.units.length);
  ok('E9 A 该站 200 分进赛季', rowOf(tab3, 'A').total === 200, rowOf(tab3, 'A').total);
  ok('E10 单元上标了该站按阶段', tab3.units[0].siteUnit === 'stage', tab3.units[0].siteUnit);
}

/* ================= F. 未启用积分榜 ================= */
sec('F. 未启用积分榜的站点');
{
  const on = makeStop(['A', 'B', 'C', 'D'], {
    name: '有积分', createdAt: '2026-01-01 10:00',
    ptsRule: { on: true, mode: 'rank', unit: 'tournament', rank: { top: { 1: 100 }, step: 5, floor: 10 } }
  });
  const off = makeStop(['A', 'B', 'C', 'D'], { name: '没积分', createdAt: '2026-02-01 10:00' });
  const tab = E.seasonTable(mkSeason({ includeRunning: true }), [on, off]);
  ok('F1 只算启用了积分榜的站', tab.counted === 2 && tab.rows.length === 4, [tab.counted, tab.rows.length]);
  ok('F2 给出「未启用」提示', tab.warnings.some(function (w) { return /没有启用赛事积分榜/.test(w); }), tab.warnings);
  ok('F3 没积分的站不加分（A 只有 100）', rowOf(tab, 'A').total === 100, rowOf(tab, 'A').total);
  ok('F4 单元上带 ptsOn 标记', tab.units.filter(function (u) { return u.tid === off.id; })[0].ptsOn === false);
}

/* ================= G. 老口径兼容 ================= */
sec('G. source=season 不受赛事 ptsRule 影响');
{
  const t = makeStop(['A', 'B', 'C', 'D'], {
    ptsRule: { on: true, mode: 'rank', unit: 'tournament', rank: { top: { 1: 999 }, step: 1, floor: 0 } }
  });
  const season = mkSeason({ unit: 'tournament', mode: 'rank', stack: true,
    rank: { top: { 1: 100, 2: 80, 3: 65, 4: 55 }, step: 5, floor: 10 } }, 'season');
  const tab = E.seasonTable(season, [t]);
  ok('G1 来源为 season', tab.source === 'season', tab.source);
  ok('G2 按赛季统一规则给分（冠军 100，不是 999）', rowOf(tab, 'A').total === 100, rowOf(tab, 'A').total);
  const t2 = makeStop(['A', 'B', 'C', 'D'], { name: '没积分', createdAt: '2026-02-01 10:00' });
  const tab2 = E.seasonTable(season, [t2]);
  ok('G3 老口径下未启用积分榜的赛事照样计分', rowOf(tab2, 'A').total === 100, rowOf(tab2, 'A').total);
}

/* ================= H. 归一化 ================= */
sec('H. 归一化');
{
  // 旧存档：没有 ptsRule
  const t = M.createTournament('旧存档');
  delete t.ptsRule;
  const n = S.normalize(t);
  ok('H1 旧存档补出 ptsRule（默认关闭）', !!n.ptsRule && n.ptsRule.on === false);
  ok('H2 默认 6 个名次档位', Array.isArray(n.ptsRule.rank.tiers) && n.ptsRule.rank.tiers.length === 6,
    n.ptsRule.rank.tiers && n.ptsRule.rank.tiers.length);

  // 老口径 rank.top 会被迁成等价档位（每档只含一个名次）
  const r = M.normalizePtsRule({ on: true, rank: { top: { '1': 50, '2': '40', x: 9, '0': 100 }, step: 2, floor: 1 } });
  ok('H3 非法键被剔除', r.rank.tiers.map(function (x) { return x.from; }).join(',') === '1,2',
    r.rank.tiers.map(function (x) { return x.from; }));
  ok('H4 数值字符串转成数字', r.rank.tiers[1].pts === 40, r.rank.tiers[1].pts);

  // 阶段覆盖会被补齐成完整规则
  const r2 = M.normalizePtsRule({ on: true, stageOv: { '0': { mode: 'win' } } });
  ok('H5 阶段覆盖补成完整规则', r2.stageOv['0'].win && r2.stageOv['0'].win.perWin !== undefined);
  ok('H6 阶段覆盖强制 on=true', r2.stageOv['0'].on === true);

  // 赛季口径归一化（v2.5）：没主动选过方案的赛季，一律按各站自己的积分
  const old = { v: 1, id: 'se_x', name: '旧赛季', rule: { unit: 'tournament', mode: 'rank' } };
  ok('H7 旧赛季（没有 source/plan）→ 各站自己的积分', S.normalizeSeason(old).rule.source === 'tournament');
  const neu = M.defaultSeason('新赛季');
  ok('H8 新赛季默认 source=tournament', neu.rule.source === 'tournament', neu.rule.source);
  ok('H9 新赛季默认 6 个名次档位', neu.rule.rank.tiers.length === 6, neu.rule.rank.tiers.length);
  const keep = M.defaultSeason('显式的');
  keep.rule.source = 'season';
  keep.rule.plan = 'single';
  keep.rule.planLock = true;   // 用户主动点过「赛季统一一套分值」
  ok('H10 显式选过方案（planLock）才保留赛季统一口径',
    S.normalizeSeason(keep).rule.source === 'season', keep.rule.source);
}

console.log('\n=====================================');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
console.log('=====================================');
process.exit(fail ? 1 : 0);
