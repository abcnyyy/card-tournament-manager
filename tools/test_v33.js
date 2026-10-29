/**
 * v2.5 引擎测试
 *  A. 赛季取数口径：老赛季 / 迁移赛季自动回到「各站自己的积分」
 *  B. 用户点过方案（planLock）/ 改过分值 / 逐阶段规则 → 保留
 *  C. 一个站都没启用积分榜时兜底（按赛季分值算，并给明确提示）
 *  D. 各站自己的规则真的生效（按胜场 / 按名次各自算）
 *  E. PDF 组装（纯手写）：结构、页数、字节前缀
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const base = path.join(__dirname, '..', 'app', 'js');
const sandbox = {
  window: {}, console, Math, Date, JSON, parseFloat, parseInt, isNaN, Object, Array, String, Number,
  atob: function (s) { return Buffer.from(s, 'base64').toString('binary'); },
  btoa: function (s) { return Buffer.from(s, 'binary').toString('base64'); }
};
sandbox.global = sandbox;
vm.createContext(sandbox);
['core.js', 'formats.js', 'engine.js', 'pdfgen.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(base, f), 'utf8'), sandbox, { filename: f });
});
const TMS = sandbox.window.TMS;
const { model: M, engine: E, store: S, pdf: PDF } = TMS;

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

/* 造一站：4 人单败，种子靠前者赢 */
function makeStop(names, opts) {
  opts = opts || {};
  const t = M.createTournament(opts.name || '站点');
  t.createdAt = opts.createdAt || '2026-01-01 10:00';
  names.forEach(function (n, i) { t.players.push(M.createPlayer(n, i + 1)); });
  t.status = 'running';
  const s = M.defaultStage(0);
  s.type = 'single_elim';
  s.name = '淘汰赛';
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
      if (m.isBye || !m.playerA || !m.playerB) return;
      const sa = t.players.filter(function (p) { return p.id === m.playerA; })[0];
      const sb = t.players.filter(function (p) { return p.id === m.playerB; })[0];
      setRes(m, (sa.seed <= sb.seed) ? 'A' : 'B');
    });
    E.finishRound(t, s);
  }
  s.status = 'finished';
  t.status = 'finished';
  if (opts.pts) t.ptsRule = Object.assign(M.defaultPtsRule(), opts.pts);
  return t;
}
function total(tab, name) {
  const r = tab.rows.filter(function (x) { return x.name === name; })[0];
  return r ? r.total : null;
}

/* ================= A. 自动回到「各站自己的积分」 ================= */
sec('A. 老赛季 / 迁移赛季自动按各站规则算');
{
  // A1 老存档：没有 plan / source，分值也是出厂默认
  const old = {
    v: 1, id: 'se_a1', name: '老赛季', createdAt: '2026-01-01', updatedAt: '2026-01-01',
    rule: {
      source: 'season', unit: 'tournament', stack: true, mode: 'rank',
      rank: { top: { 1: 100, 2: 80, 3: 65, 4: 55 }, step: 5, floor: 5 },
      win: { perWin: 10, perDraw: 5, perLoss: 0, base: 0 },
      resetScope: 'participants', includeRunning: false, overrides: {}
    }
  };
  S.normalizeSeason(old);
  ok('A1 老赛季（无 plan、默认分值）→ site', E.seasonPlan(old) === 'site', old.rule.plan);
  ok('A2 source 同步成 tournament', old.rule.source === 'tournament', old.rule.source);

  // v2.4 迁移时被写成 plan='single' 的存档（同样没改过分值）
  const migrated = JSON.parse(JSON.stringify(old));
  migrated.id = 'se_a3';
  migrated.rule.plan = 'single';
  S.normalizeSeason(migrated);
  ok('A3 v2.4 被误判成 single 的存档 → 自动回到 site', E.seasonPlan(migrated) === 'site', migrated.rule.plan);

  // 同一批赛事，两种口径的分数不同 —— 证明真的按各站规则算
  const t = makeStop(['A', 'B', 'C', 'D'], { name: '第 1 站', pts: { on: true, mode: 'win', unit: 'tournament', win: { perWin: 7, perDraw: 0, perLoss: 0, base: 0 } } });
  const tabSite = E.seasonTable(migrated, [t]);
  ok('A4 按各站规则：冠军拿到 2 胜 × 7 = 14', total(tabSite, 'A') === 14, total(tabSite, 'A'));
  ok('A5 表上标了 plan=site', tabSite.plan === 'site', tabSite.plan);

  migrated.rule.planLock = true;
  migrated.rule.plan = 'single';
  migrated.rule.source = 'season';
  S.normalizeSeason(migrated);
  const tabSeason = E.seasonTable(migrated, [t]);
  ok('A6 显式选「赛季统一一套分值」后按赛季分算（100）', total(tabSeason, 'A') === 100, total(tabSeason, 'A'));
}

/* ================= B. 什么情况保留赛季自己定分值 ================= */
sec('B. 保留「赛季自己定分值」的三种情况');
{
  const mk = function (rule) {
    const s = { v: 1, id: 'se_b', name: 'B', createdAt: '2026-01-01', updatedAt: '2026-01-01',
      rule: Object.assign({ source: 'season', unit: 'tournament', stack: true, mode: 'rank',
        rank: { tiers: [{ from: 1, to: 1, pts: 100 }, { from: 2, to: 4, pts: 50 }], step: 5, floor: 5 },
        win: { perWin: 10, perDraw: 5, perLoss: 0, base: 0 },
        resetScope: 'participants', includeRunning: false, overrides: {} }, rule) };
    return S.normalizeSeason(s);
  };
  const b1 = mk({ plan: 'single', planLock: true });
  ok('B1 点过方案按钮（planLock）→ single', E.seasonPlan(b1) === 'single', b1.rule.plan);

  const b2 = mk({ plan: 'single', rank: { tiers: [{ from: 1, to: 1, pts: 300 }, { from: 2, to: 4, pts: 120 }], step: 9, floor: 1 } });
  ok('B2 分值被改过 → 保留 single', E.seasonPlan(b2) === 'single', b2.rule.plan);

  const b3raw = { v: 1, id: 'se_b3', name: 'B3', createdAt: '2026-01-01', updatedAt: '2026-01-01',
    rule: { source: 'season', unit: 'stage', stack: true, mode: 'rank', plan: 'stage',
      rank: { tiers: [{ from: 1, to: 1, pts: 100 }, { from: 2, to: 4, pts: 50 }], step: 5, floor: 5 },
      win: { perWin: 10, perDraw: 5, perLoss: 0, base: 0 },
      resetScope: 'participants', includeRunning: false, overrides: { 't:xx#0': { mode: 'win', win: { perWin: 3 } } } } };
  const b3 = S.normalizeSeason(b3raw);
  ok('B3 配了逐阶段规则 → 保留 stage', E.seasonPlan(b3) === 'stage', b3.rule.plan);

  const b4 = mk({ plan: 'site' });
  ok('B4 显式 site 直接生效', E.seasonPlan(b4) === 'site', b4.rule.plan);
}

/* ================= C. 一个站都没启用积分榜时兜底 ================= */
sec('C. 兜底：没有站点启用积分榜');
{
  const s = { v: 1, id: 'se_c', name: 'C', createdAt: '2026-01-01', updatedAt: '2026-01-01',
    rule: { source: 'tournament', mode: 'rank',
      rank: { tiers: [{ from: 1, to: 1, pts: 120 }, { from: 2, to: 4, pts: 60 }], step: 5, floor: 5 },
      win: { perWin: 10, perDraw: 5, perLoss: 0, base: 0 },
      overrides: {} } };
  S.normalizeSeason(s);
  const t1 = makeStop(['A', 'B', 'C', 'D'], { name: '第 1 站' });   // 没启用积分榜
  const tab = E.seasonTable(s, [t1]);
  ok('C1 兜底后仍有分数（冠军 120）', total(tab, 'A') === 120, total(tab, 'A'));
  ok('C2 标记了 siteFallback', tab.siteFallback === true, tab.siteFallback);
  ok('C3 给出「去启用积分榜」的提示', (tab.warnings[0] || '').indexOf('赛事积分榜') >= 0, tab.warnings[0]);
  ok('C4 单元上仍能看到该站没启用', tab.units[0].ptsOn === false, tab.units[0] && tab.units[0].ptsOn);

  // 一旦启用，就自动改为按各站规则
  t1.ptsRule = Object.assign(M.defaultPtsRule(), { on: true, mode: 'win', unit: 'tournament',
    win: { perWin: 9, perDraw: 0, perLoss: 0, base: 0 } });
  const tab2 = E.seasonTable(s, [t1]);
  ok('C5 启用后不再兜底', !tab2.siteFallback, tab2.siteFallback);
  ok('C6 冠军按各站规则 = 2 胜 × 9 = 18', total(tab2, 'A') === 18, total(tab2, 'A'));
}

/* ================= D. 各站自己规则的可见性 ================= */
sec('D. 赛季页要能看到「这一站用什么规则」');
{
  const s = { v: 1, id: 'se_d', name: 'D', createdAt: '2026-01-01', updatedAt: '2026-01-01', rule: {} };
  S.normalizeSeason(s);
  const t1 = makeStop(['A', 'B', 'C', 'D'], { name: '第 1 站',
    pts: { on: true, mode: 'win', unit: 'tournament', win: { perWin: 7, perDraw: 0, perLoss: 0, base: 0 } } });
  const t2 = makeStop(['A', 'B', 'C', 'D'], { name: '第 2 站',
    pts: { on: true, mode: 'rank', unit: 'tournament' } });
  const tab = E.seasonTable(s, [t1, t2]);
  ok('D1 单元上带出站点规则对象', !!tab.units[0].siteRule && tab.units[1].siteRule.mode === 'rank',
    tab.units.map(function (u) { return u.siteRule && u.siteRule.mode; }));
  ok('D2 单元上带出方式与是否启用', tab.units[0].siteMode === 'win' && tab.units[0].ptsOn === true,
    [tab.units[0].siteMode, tab.units[0].ptsOn]);
  ok('D3 两站各按自己的规则：站 1 冠军 14 分，站 2 冠军 100 分',
    total(tab, 'A') === 114, total(tab, 'A'));
}

/* ================= E. PDF 组装 ================= */
sec('E. 手写 PDF：结构正确');
{
  // 1x1 白色 JPEG
  const tiny = 'data:image/jpeg;base64,' +
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
  const one = PDF.fromJPEGs([{ dataURL: tiny, width: 1, height: 1 }]);
  const head = Buffer.from(one.bytes.subarray(0, 8)).toString('latin1');
  const tail = Buffer.from(one.bytes.subarray(one.bytes.length - 6)).toString('latin1');
  ok('E1 一页 PDF 以 %PDF-1.4 开头', head === '%PDF-1.4', head);
  ok('E2 以 %%EOF 结尾', tail.indexOf('%%EOF') >= 0, tail);
  ok('E3 内嵌 DCTDecode 图片流', Buffer.from(one.bytes).toString('latin1').indexOf('/DCTDecode') > 0);
  ok('E4 页数 = 1', one.pages === 1, one.pages);

  const three = PDF.fromJPEGs([
    { dataURL: tiny, width: 1, height: 1 },
    { dataURL: tiny, width: 1, height: 1 },
    { dataURL: tiny, width: 1, height: 1 }
  ]);
  const txt = Buffer.from(three.bytes).toString('latin1');
  ok('E5 三页 PDF 的 /Count 是 3', /\/Count 3\b/.test(txt), (txt.match(/\/Count \d+/) || [])[0]);
  ok('E6 三个页面对象', (txt.match(/\/Type \/Page\b/g) || []).length === 3);
  ok('E7 xref 偏移量指向真实对象（抽查第一个）',
    (function () {
      const m = txt.match(/xref\n0 \d+\n0000000000 65535 f \n(\d{10})/);
      if (!m) return false;
      const off = parseInt(m[1], 10);
      return txt.substr(off, 6) === '1 0 ob';
    })());
  ok('E8 base64 可往返（能存成文件）', PDF.bytesToBase64(one.bytes).slice(0, 6) === 'JVBERi');
}

console.log('\n===============================');
console.log('PASS: ' + pass + '   FAIL: ' + fail);
console.log('===============================');
process.exit(fail ? 1 : 0);
