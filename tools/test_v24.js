/**
 * v1.12.0 引擎测试：赛季积分
 *  A. 名次分：前 N 名查表 / 之后递减 / 最低分保底
 *  B. 胜场分：基础 + 胜×分 + 平×分 + 负×分
 *  C. 叠加：多站累加
 *  D. 不叠加：只重置进入该单元的人（默认）/ 全榜重置
 *  E. 计分单元：整站 vs 站内每阶段
 *  F. 单元覆盖：单站改成按胜场
 *  G. 进行中的站点默认不计分，includeRunning 打开后计入
 *  H. 跨赛事认人：姓名归一化（全角空格 / 大小写 / 多余空白）
 *  I. 排序与并列名次
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
  else {
    fail++;
    console.log('  FAIL ' + name + (extra === undefined ? '' : '  →  ' + JSON.stringify(extra)));
  }
}
function sec(t) { console.log('\n[' + t + ']'); }

/* ---------- 构造一站的比赛结果 ----------
 * 用单败淘汰，按 names 顺序（种子）让种子靠前者一路赢，
 * 结果名次 = names 的顺序（1..n）。
 */
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

  const rounds = Math.log2(names.length);
  for (let r = 0; r < rounds; r++) {
    if (opts.partial && r >= 1) break;
    const g = E.generateRound(t);
    if (!g.ok) break;
    const rd = s.roundsData[s.roundsData.length - 1];
    rd.matches.forEach(function (m) {
      if (!m.playerA || !m.playerB) return;
      if (m.isBye) { E.evaluate(m, E.fmtOfMatch(t, s, m), s.tie); return; }
      // 种子靠前者（列表里靠前）赢
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

function mkSeason(rule) {
  const s = M.defaultSeason('测试赛季');
  // 本套测试验证「赛季统一规则」这一老口径（v1.12 行为），显式指定来源
  s.rule.source = 'season';
  if (rule) Object.assign(s.rule, rule);
  return s;
}

/* ================= A. 名次分 ================= */
sec('A. 名次 → 分数');
{
  const rule = { rank: { top: { 1: 100, 2: 80, 3: 65, 4: 55 }, step: 5, floor: 10 } };
  ok('A1 第 1 名 = 100', E.seasonRankPoints(rule, 1) === 100, E.seasonRankPoints(rule, 1));
  ok('A2 第 4 名 = 55', E.seasonRankPoints(rule, 4) === 55, E.seasonRankPoints(rule, 4));
  ok('A3 第 5 名 = 55-5 = 50', E.seasonRankPoints(rule, 5) === 50, E.seasonRankPoints(rule, 5));
  ok('A4 第 10 名 = 55-30 = 25', E.seasonRankPoints(rule, 10) === 25, E.seasonRankPoints(rule, 10));
  ok('A5 第 20 名触底 = 10', E.seasonRankPoints(rule, 20) === 10, E.seasonRankPoints(rule, 20));
  ok('A6 非法名次 = 0', E.seasonRankPoints(rule, 0) === 0 && E.seasonRankPoints(rule, null) === 0);
  // 中间缺档：只填 1 和 4，第 2 名按第 1 名递推
  const gap = { rank: { top: { 1: 100, 4: 40 }, step: 10, floor: 0 } };
  ok('A7 缺档按上一档递推（第 2 名 = 90）', E.seasonRankPoints(gap, 2) === 90, E.seasonRankPoints(gap, 2));
}

/* ================= B. 胜场分 ================= */
sec('B. 胜场 → 分数');
{
  const rule = { win: { perWin: 10, perDraw: 5, perLoss: 0, base: 20 } };
  ok('B1 3 胜 0 平 0 负 = 20+30 = 50', E.seasonWinPoints(rule, 3, 0, 0) === 50, E.seasonWinPoints(rule, 3, 0, 0));
  ok('B2 2 胜 1 平 1 负 = 20+20+5 = 45', E.seasonWinPoints(rule, 2, 1, 1) === 45, E.seasonWinPoints(rule, 2, 1, 1));
  const negRule = { win: { perWin: 10, perDraw: 0, perLoss: -2, base: 0 } };
  ok('B3 允许负场扣分（2 胜 3 负 = 14）', E.seasonWinPoints(negRule, 2, 0, 3) === 14, E.seasonWinPoints(negRule, 2, 0, 3));
}

/* ================= C. 叠加 ================= */
sec('C. 多站叠加');
{
  const t1 = makeStop(['A', 'B', 'C', 'D'], { name: '第 1 站', createdAt: '2026-01-01 10:00' });
  const t2 = makeStop(['B', 'C', 'D', 'A'], { name: '第 2 站', createdAt: '2026-02-01 10:00' });
  const season = mkSeason({ unit: 'tournament', stack: true, mode: 'rank' });
  const tab = E.seasonTable(season, [t1, t2]);
  const get = function (n) { return (tab.rows.filter(function (r) { return r.name === n; })[0] || {}).total; };
  ok('C1 两站各 4 人都有分', tab.rows.length === 4, tab.rows.map(function (r) { return r.name; }));
  // v1.14 起默认档位是「几个名次一档」：第 4~6 名同档 = 65 分
  ok('C2 A = 100(第1站冠军) + 65(第2站第4~6档) = 165', get('A') === 165, get('A'));
  ok('C3 B = 80 + 100 = 180', get('B') === 180, get('B'));
  ok('C4 B 总分最高排第一', tab.rows[0].name === 'B', tab.rows.map(function (r) { return [r.name, r.total]; }));
  ok('C5 每人记录 2 站', tab.rows.every(function (r) { return r.stops === 2; }));
  ok('C6 单元数 = 2', tab.units.length === 2 && tab.counted === 2, [tab.units.length, tab.counted]);
}

/* ================= D. 不叠加 ================= */
sec('D. 不叠加（重新起算）');
{
  const t1 = makeStop(['A', 'B', 'C', 'D'], { name: '第 1 站', createdAt: '2026-01-01 10:00' });
  const t2 = makeStop(['C', 'D', 'A', 'B'], { name: '第 2 站', createdAt: '2026-02-01 10:00' });
  const season = mkSeason({ unit: 'tournament', stack: true, mode: 'rank' });
  season.rule.overrides['t:' + t2.id] = { stack: false };
  const tab = E.seasonTable(season, [t1, t2]);
  const get = function (n) { return (tab.rows.filter(function (r) { return r.name === n; })[0] || {}).total; };
  ok('D1 第 2 站不叠加：C = 100（只剩本站）', get('C') === 100, get('C'));
  ok('D2 A（本站第 3，第 2~3 档 = 80），之前 100 分不保留', get('A') === 80, get('A'));
  ok('D3 参与者的站数也归零重记', (tab.rows.filter(function (r) { return r.name === 'A'; })[0] || {}).stops === 1);

  // 全榜重置：未参与者也清零（这里所有人都在第 2 站，故与 D1 等价；换个只让 2 人参加的场景）
  const t3 = makeStop(['A', 'B', 'C', 'D'], { name: '第 1 站', createdAt: '2026-01-01 10:00' });
  const t4 = makeStop(['A', 'B'], { name: '决赛站', createdAt: '2026-02-01 10:00' });
  const s2 = mkSeason({ unit: 'tournament', stack: true });
  s2.rule.overrides['t:' + t4.id] = { stack: false, resetScope: 'participants' };
  const tab2 = E.seasonTable(s2, [t3, t4]);
  const get2 = function (n) { return (tab2.rows.filter(function (r) { return r.name === n; })[0] || {}).total; };
  ok('D4 只重置参与者：没进决赛的 C 保留原分 80', get2('C') === 80, get2('C'));
  const s3 = mkSeason({ unit: 'tournament', stack: true });
  s3.rule.overrides['t:' + t4.id] = { stack: false, resetScope: 'all' };
  const tab3 = E.seasonTable(s3, [t3, t4]);
  const get3 = function (n) { return (tab3.rows.filter(function (r) { return r.name === n; })[0] || {}).total; };
  ok('D5 全榜重置：没进决赛的 C = 0', get3('C') === 0, get3('C'));
}

/* ================= E. 计分单元 ================= */
sec('E. 计分单元（整站 / 站内每阶段）');
{
  const t = makeStop(['A', 'B', 'C', 'D'], { name: '两阶段站' });
  // 追加一个阶段（复制前四名打单败）
  const s2 = M.defaultStage(1);
  s2.type = 'single_elim';
  s2.name = '第 2 阶段';
  s2.participants = t.players.slice(0, 2).map(function (p) { return p.id; });
  s2.adv = { type: 'count', count: 1, score: 0, perGroup: 1 };
  s2.format = { gamesPerMatch: 1, winNeeded: 1, recordScore: false };
  s2.useFormat = true;
  t.stages.push(s2);
  t.currentStage = 1;
  const g = E.generateRound(t);
  const rd = s2.roundsData[s2.roundsData.length - 1];
  rd.matches.forEach(function (m) {
    if (m.isBye) { E.evaluate(m, E.fmtOfMatch(t, s2, m), s2.tie); return; }
    m.games = [{ w: 'A', a: 1, b: 0 }];
    E.evaluate(m, E.fmtOfMatch(t, s2, m), s2.tie);
  });
  E.finishRound(t);
  s2.status = 'finished';

  const byStage = mkSeason({ unit: 'stage' });
  const tabS = E.seasonTable(byStage, [t]);
  ok('E1 unit=stage 时每个阶段各一个单元', tabS.units.length === 2, tabS.units.map(function (u) { return u.label; }));
  const byT = mkSeason({ unit: 'tournament' });
  const tabT = E.seasonTable(byT, [t]);
  ok('E2 unit=tournament 时整站一个单元', tabT.units.length === 1, tabT.units.length);
  ok('E3 整站名次：最后一个阶段的人排在前面',
    tabT.rows[0].name === 'A' && tabT.rows[1].name === 'B', tabT.rows.map(function (r) { return [r.name, r.pos]; }));
  ok('E4 站内每阶段计分：A/B 各有 2 条明细',
    (tabS.rows.filter(function (r) { return r.name === 'A'; })[0] || {}).stops === 2);
}

/* ================= F. 单元覆盖 ================= */
sec('F. 单站改成按胜场');
{
  const t1 = makeStop(['A', 'B', 'C', 'D'], { name: '第 1 站', createdAt: '2026-01-01 10:00' });
  const season = mkSeason({ unit: 'tournament', mode: 'rank' });
  season.rule.overrides['t:' + t1.id] = { mode: 'win', win: { perWin: 10, base: 5 } };
  const tab = E.seasonTable(season, [t1]);
  const a = tab.rows.filter(function (r) { return r.name === 'A'; })[0];
  // 4 人单败：冠军 2 胜，其余 1 胜或 0 胜
  ok('F1 冠军按胜场计分 = 5 + 2×10 = 25', a.total === 25, a.total);
  ok('F2 单元上标了 mode=win', tab.units[0].mode === 'win', tab.units[0].mode);
}

/* ================= G. 进行中的站点 ================= */
sec('G. 进行中的站点');
{
  const done = makeStop(['A', 'B', 'C', 'D'], { name: '已结束', createdAt: '2026-01-01 10:00' });
  const running = makeStop(['D', 'C', 'B', 'A'], { name: '进行中', createdAt: '2026-02-01 10:00', running: true, partial: true });
  const season = mkSeason({ unit: 'tournament' });
  const tab = E.seasonTable(season, [done, running]);
  ok('G1 默认只统计已结束的站点', tab.counted === 1, [tab.counted, tab.units.map(function (u) { return u.status; })]);
  season.rule.includeRunning = true;
  const tab2 = E.seasonTable(season, [done, running]);
  ok('G2 includeRunning 打开后两站都计分', tab2.counted === 2, tab2.counted);
}

/* ================= H. 跨赛事认人 ================= */
sec('H. 姓名归一化');
{
  const t1 = makeStop(['JCLE', '张三', '李四', '王五'], { name: '第 1 站', createdAt: '2026-01-01 10:00' });
  const t2 = makeStop([' jcle ', '张三\u3000', 'LiSi', '王五'], { name: '第 2 站', createdAt: '2026-02-01 10:00' });
  const tab = E.seasonTable(mkSeason({ unit: 'tournament' }), [t1, t2]);
  const names = tab.rows.map(function (r) { return r.name; });
  ok('H1 大小写 + 空格不同仍是同一人（JCLE 只出现一次）',
    tab.rows.filter(function (r) { return E.nameKey(r.name) === 'jcle'; }).length === 1, names);
  ok('H2 全角空格不影响匹配（张三 1 条记录 2 站）',
    (tab.rows.filter(function (r) { return E.nameKey(r.name) === '张三'; })[0] || {}).stops === 2);
  ok('H3 真正不同的人不会被合并（LiSi 与 李四 是 2 条）',
    tab.rows.filter(function (r) { return /lisi/.test(E.nameKey(r.name)) || r.name === '李四'; }).length === 2, names);
}

/* ================= I. 排序与并列 ================= */
sec('I. 排序与并列名次');
{
  const t1 = makeStop(['A', 'B', 'C', 'D'], { name: '第 1 站', createdAt: '2026-01-01 10:00' });
  const tab = E.seasonTable(mkSeason({ unit: 'tournament' }), [t1]);
  ok('I1 分数降序', tab.rows[0].total >= tab.rows[1].total && tab.rows[1].total >= tab.rows[2].total);
  // 同一档位的两名选手分数相同 → 并列名次，所以只要求「不倒退」且冠军是 1
  (function () {
    var ps = tab.rows.map(function (r) { return r.pos; });
    var mono = ps.every(function (v, i) { return i === 0 || v >= ps[i - 1]; });
    ok('I2 名次不倒退且冠军为第 1', mono && ps[0] === 1, ps);
  })();
  ok('I3 冠军标为第 1 名', tab.rows[0].best === 1, tab.rows[0].best);

  // 同分并列：两人都 100 分
  const s = mkSeason({ unit: 'tournament' });
  s.rule.rank = { top: { 1: 100, 2: 100, 3: 65, 4: 55 }, step: 5, floor: 10 };
  const tab2 = E.seasonTable(s, [t1]);
  ok('I4 同分并列同名次', tab2.rows[0].pos === tab2.rows[1].pos, tab2.rows.map(function (r) { return [r.name, r.pos]; }));
}

/* ================= J. 空/异常 ================= */
sec('J. 空与异常');
{
  const tab = E.seasonTable(mkSeason({}), []);
  ok('J1 没有赛事时返回空表', tab.rows.length === 0 && tab.units.length === 0);
  const t = M.createTournament('空赛事');
  const tab2 = E.seasonTable(mkSeason({}), [t]);
  ok('J2 没有对阵的赛事不产生单元', tab2.units.length === 0, tab2.units.length);
  ok('J3 nameKey 处理 null / 空格', E.nameKey(null) === '' && E.nameKey('  ') === '');
}

console.log('\n=====================================');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
console.log('=====================================');
process.exit(fail ? 1 : 0);
