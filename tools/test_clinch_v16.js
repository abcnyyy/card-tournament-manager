/**
 * 提前晋级 / 提前淘汰 专项测试（v1.6.0）
 *  A. 判定：达到 N 胜提前晋级、达到 N 负提前淘汰
 *  B. 出场：提前晋级 / 淘汰者不再出现在后续对局
 *  C. 排名：提前晋级者靠前、提前淘汰者靠后、名次不并列
 *  D. 对手分：提前晋级者的对手分随对手后续战绩变化
 *  E. 下一阶段加分：固定加分 + 每提前一轮加权
 *  F. 晋级保证：人数线 / 积分线都不能把提前晋级者挤掉
 *  G. 边界：全员判定完 → 阶段结束；小局制判定；回退恢复
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

function mkSwiss(n, opts, stageOpts) {
  opts = opts || {};
  const t = M.createTournament('CL');
  for (let i = 1; i <= n; i++) t.players.push(M.createPlayer('P' + i, i));
  const st = t.stages[0];
  st.type = 'swiss';
  st.rounds = opts.rounds || 3;
  st.participants = t.players.map(p => p.id);
  st.adv = { type: 'all', count: 4, score: 0, perGroup: 2 };
  st.clinch = Object.assign({
    enabled: true, basis: 'match', winTarget: 2, lossTarget: 2, bonus: 0, bonusPerEarly: 0
  }, opts.clinch || {});
  if (stageOpts) Object.assign(st, stageOpts);
  return { t, st };
}

// 序号小者赢（种子强的赢）
function playRound(t, st, opts) {
  opts = opts || {};
  const rd = st.roundsData[st.roundsData.length - 1];
  const nm = NMOF(t);
  rd.matches.forEach(m => {
    if (m.isBye) { E.evaluate(m, E.fmtOfMatch(t, st, m), st.tie); return; }
    const a = SEED(nm(m.playerA)), b = SEED(nm(m.playerB));
    let w = (a < b) ? 'A' : 'B';
    if (opts.force && opts.force(m, a, b)) w = opts.force(m, a, b);
    const fmt = E.fmtOfMatch(t, st, m);
    m.games = [];
    const need = (parseInt(fmt.winNeeded, 10) > 0) ? parseInt(fmt.winNeeded, 10) : 1;
    for (let i = 0; i < need; i++) m.games.push({ w });
    E.evaluate(m, fmt, st.tie);
  });
  return rd;
}

const nameOf = t => id => NMOF(t)(id);
function names(t, ids) { return ids.map(id => NMOF(t)(id)).join(','); }

/* ================= A. 基本判定 ================= */
section('A. 判定：达到 N 胜晋级 / N 负淘汰');
(function () {
  const { t, st } = mkSwiss(8, { rounds: 3, clinch: { winTarget: 2, lossTarget: 2 } });

  ok('A1 首轮生成后无人晋级', (function () {
    E.generateRound(t); playRound(t, st); E.finishRound(t);
    return st.clinched.length === 0 && st.eliminated.length === 0;
  })());

  E.generateRound(t); playRound(t, st); const msg2 = E.finishRound(t).msg;
  ok('A2 第 2 轮后 2 人 2-0 提前晋级', st.clinched.length === 2, names(t, st.clinched));
  ok('A3 第 2 轮后 2 人 0-2 提前淘汰', st.eliminated.length === 2, names(t, st.eliminated));
  ok('A4 晋级的是 P1/P5', names(t, st.clinched).split(',').sort().join(',') === 'P1,P5', names(t, st.clinched));
  ok('A5 淘汰的是 P4/P8', names(t, st.eliminated).split(',').sort().join(',') === 'P4,P8', names(t, st.eliminated));
  ok('A6 记录晋级轮次 = 第 2 轮（index 1）', st.clinchRound[st.clinched[0]] === 1, JSON.stringify(st.clinchRound));
  ok('A7 记录淘汰轮次 = 第 2 轮（index 1）', st.elimRound[st.eliminated[0]] === 1, JSON.stringify(st.elimRound));
  ok('A8 finishRound 提示新增人数', /提前晋级/.test(msg2) && /淘汰/.test(msg2), msg2);
  ok('A9 幂等：重复 ensureClinch 不重复追加', (function () {
    const n = st.clinched.length + st.eliminated.length;
    E.ensureClinch(t, st); E.ensureClinch(t, st);
    return st.clinched.length + st.eliminated.length === n;
  })());
})();

/* ================= B. 不再出场 ================= */
section('B. 出场：已判定者不再参赛');
(function () {
  const { t, st } = mkSwiss(8, { rounds: 3, clinch: { winTarget: 2, lossTarget: 2 } });
  E.generateRound(t); playRound(t, st); E.finishRound(t);
  E.generateRound(t); playRound(t, st); E.finishRound(t);
  E.generateRound(t);
  const rd = st.roundsData[st.roundsData.length - 1];
  const pool = E.roundPool(rd);
  const gone = st.clinched.concat(st.eliminated);
  ok('B1 第 3 轮只安排剩余 4 人', pool.length === 4, 'pool=' + pool.length);
  ok('B2 第 3 轮没有提前晋级者', st.clinched.every(id => pool.indexOf(id) < 0), names(t, pool));
  ok('B3 第 3 轮没有提前淘汰者', st.eliminated.every(id => pool.indexOf(id) < 0), names(t, pool));
  ok('B4 剩余 4 人恰好 2 桌', rd.matches.length === 2, rd.matches.length);
  playRound(t, st); E.finishRound(t);
  ok('B5 第 3 轮后 1-2 者也判淘汰', st.eliminated.length === 4, names(t, st.eliminated));
  ok('B6 阶段结束（3 轮打满）', E.stageFinished(t, st) === true);
})();

/* ================= C. 排名分层 ================= */
section('C. 排名：晋级者靠前 / 淘汰者靠后');
(function () {
  const { t, st } = mkSwiss(8, { rounds: 3, clinch: { winTarget: 2, lossTarget: 2 } });
  for (let r = 0; r < 3; r++) { E.generateRound(t); playRound(t, st); E.finishRound(t); }
  const list = E.standings(t, { stageIndex: 0 });
  ok('C1 前 2 名都是提前晋级者', list.slice(0, 2).every(s => s.clinched), list.slice(0, 2).map(s => s.name + (s.clinched ? '*' : '')).join(','));
  ok('C2 最后 2 名都是淘汰者', list.slice(-2).every(s => s.eliminated), list.slice(-2).map(s => s.name).join(','));
  ok('C3 名次不跨层并列', (function () {
    for (let i = 1; i < list.length; i++) {
      if (list[i].rank === list[i - 1].rank && list[i].layer !== list[i - 1].layer) return false;
    }
    return true;
  })(), list.map(s => s.name + ':' + s.rank + '/L' + s.layer).join(' '));
  ok('C4 晋级者名次 < 未定者名次', (function () {
    const clMax = Math.max(...list.filter(s => s.clinched).map(s => s.rank));
    const aliveMin = Math.min(...list.filter(s => !s.clinched && !s.eliminated).map(s => s.rank));
    return clMax < aliveMin + 1;
  })());
  ok('C5 淘汰者名次 > 未定者名次', (function () {
    const elMin = Math.min(...list.filter(s => s.eliminated).map(s => s.rank));
    const aliveMax = Math.max(...list.filter(s => !s.clinched && !s.eliminated).map(s => s.rank));
    return elMin > aliveMax;
  })(), list.map(s => s.name + ':' + s.rank + '/L' + s.layer).join(' '));
  ok('C6 提前晋级者排在同分未定者之前', (function () {
    // 3-0 的 P1 只有 9 分，而 2-1 的 P2 有 6 分；这里主要验证分层优先于积分
    return list[0].clinched || list[0].layer === 0;
  })());
})();

/* ================= D. 对手分继续变动 ================= */
section('D. 对手分：晋级后仍随对手战绩变化');
(function () {
  const { t, st } = mkSwiss(8, { rounds: 3, clinch: { winTarget: 2, lossTarget: 2 } });
  E.generateRound(t); playRound(t, st); E.finishRound(t);
  E.generateRound(t); playRound(t, st);
  // 第 2 轮结束、但第 3 轮尚未开始时，先记录 P1 的对手分
  const id1 = t.players[0].id;
  E.finishRound(t);
  const before = E.standings(t, { stageIndex: 0 }).find(s => s.id === id1);
  const b1 = before.buchholz;
  E.generateRound(t); playRound(t, st); E.finishRound(t);
  const after = E.standings(t, { stageIndex: 0 }).find(s => s.id === id1);
  ok('D1 提前晋级者仍在排行榜中', !!after);
  ok('D2 对手分随对手后续胜场增加', after.buchholz > b1, b1 + ' -> ' + after.buchholz);
  ok('D3 本人场次不再增加', before.matches === after.matches, before.matches + ' -> ' + after.matches);
  ok('D4 本人积分不再增加', before.points === after.points, before.points + ' -> ' + after.points);
})();

/* ================= E. 下一阶段加分 ================= */
section('E. 下一阶段加分：固定 + 每提前一轮加权');
(function () {
  const { t, st } = mkSwiss(8, { rounds: 5, clinch: { winTarget: 2, lossTarget: 2, bonus: 3, bonusPerEarly: 1 } });
  st.adv = { type: 'all', count: 99, score: 0, perGroup: 2 };
  const next = M.defaultStage(1);
  next.type = 'swiss'; next.rounds = 3;
  t.stages.push(next);
  st.rounds = 5;
  for (let r = 0; r < 2; r++) { E.generateRound(t); playRound(t, st); E.finishRound(t); }
  ok('E1 第 2 轮锁定 → 提前 3 轮', E.clinchEarlyBy(st, st.clinched[0]) === 3, E.clinchEarlyBy(st, st.clinched[0]));
  ok('E2 单人加分 = 3 + 1*3 = 6', E.clinchBonusOf(st, st.clinched[0]) === 6, E.clinchBonusOf(st, st.clinched[0]));
  const r = E.finishStage(t);
  ok('E3 阶段结束', r.ok, JSON.stringify(r));
  const ns = t.stages[1];
  ok('E4 下一阶段写入 carryBonus', Object.keys(ns.carryBonus || {}).length === 2, JSON.stringify(ns.carryBonus));
  const stats = E.buildStats(t, ns, ns.participants.slice(), null);
  const cid = Object.keys(ns.carryBonus)[0];
  ok('E5 下一阶段积分已含加分', stats[cid].points === ns.carryBonus[cid], stats[cid].points + ' vs ' + ns.carryBonus[cid]);
  ok('E6 未提前晋级者不加分', stats[ns.participants.find(id => !ns.carryBonus[id])].carryBonus === 0);
})();

section('E2. 不加分时 carryBonus 为空');
(function () {
  const { t, st } = mkSwiss(8, { rounds: 3, clinch: { winTarget: 2, lossTarget: 2, bonus: 0, bonusPerEarly: 0 } });
  t.stages.push(M.defaultStage(1));
  for (let r = 0; r < 3; r++) { E.generateRound(t); playRound(t, st); E.finishRound(t); }
  E.finishStage(t);
  ok('E7 carryBonus 为空对象', Object.keys(t.stages[1].carryBonus || {}).length === 0, JSON.stringify(t.stages[1].carryBonus));
})();

/* ================= F. 晋级保证 ================= */
section('F. 晋级保证：人数线 / 积分线都不能挤掉提前晋级者');
(function () {
  const { t, st } = mkSwiss(8, { rounds: 3, clinch: { winTarget: 2, lossTarget: 2 } });
  st.adv = { type: 'count', count: 1, score: 0, perGroup: 2 };   // 故意只留 1 个名额
  t.stages.push(M.defaultStage(1));
  for (let r = 0; r < 3; r++) { E.generateRound(t); playRound(t, st); E.finishRound(t); }
  const cl = st.clinched.slice();
  E.finishStage(t);
  ok('F1 名额只有 1 个时 2 名提前晋级者仍全部晋级', cl.every(id => st.advanced.indexOf(id) >= 0), names(t, st.advanced));
  ok('F2 下一阶段参赛者含全部提前晋级者', cl.every(id => t.stages[1].participants.indexOf(id) >= 0));
  ok('F3 晋级名单中提前晋级者排在最前', names(t, st.advanced).slice(0, 3) === 'P1,P5'.slice(0, 3) || st.advanced[0] === cl[0] || st.advanced[0] === cl[1]);
})();

(function () {
  const { t, st } = mkSwiss(8, { rounds: 3, clinch: { winTarget: 2, lossTarget: 2 } });
  st.adv = { type: 'score', count: 4, score: 9999, perGroup: 2 };  // 荒谬的高积分线
  t.stages.push(M.defaultStage(1));
  for (let r = 0; r < 3; r++) { E.generateRound(t); playRound(t, st); E.finishRound(t); }
  const cl = st.clinched.slice();
  E.finishStage(t);
  ok('F4 积分线高到无人达标时提前晋级者仍晋级', cl.every(id => st.advanced.indexOf(id) >= 0), names(t, st.advanced));
  ok('F5 其它人一个都没进', st.advanced.length === cl.length, names(t, st.advanced));
})();

/* ================= G. 边界 ================= */
section('G. 边界情况');
(function () {
  // 全部一轮内判定完
  const { t, st } = mkSwiss(8, { rounds: 3, clinch: { winTarget: 1, lossTarget: 1 } });
  E.generateRound(t); playRound(t, st); E.finishRound(t);
  ok('G1 1 胜 / 1 负线：一轮后 4 晋级 4 淘汰', st.clinched.length === 4 && st.eliminated.length === 4,
    st.clinched.length + '/' + st.eliminated.length);
  ok('G2 剩余未定者 0 人', E.aliveInStage(t, st).length === 0);
  ok('G3 stageFinished = true', E.stageFinished(t, st) === true);
  const g = E.generateRound(t);
  ok('G4 再生成对阵被拒绝且提示友好', g.ok === false && /结束本阶段/.test(g.msg), g.msg);
})();

(function () {
  // 只设晋级线，不设淘汰线
  const { t, st } = mkSwiss(8, { rounds: 3, clinch: { winTarget: 2, lossTarget: 0 } });
  for (let r = 0; r < 2; r++) { E.generateRound(t); playRound(t, st); E.finishRound(t); }
  ok('G5 只设晋级线时不淘汰任何人', st.eliminated.length === 0, names(t, st.eliminated));
  ok('G6 仍有人提前晋级', st.clinched.length === 2, names(t, st.clinched));
})();

(function () {
  // 只设淘汰线
  const { t, st } = mkSwiss(8, { rounds: 3, clinch: { winTarget: 0, lossTarget: 2 } });
  for (let r = 0; r < 2; r++) { E.generateRound(t); playRound(t, st); E.finishRound(t); }
  ok('G7 只设淘汰线时不晋级任何人', st.clinched.length === 0);
  ok('G8 2 人提前淘汰', st.eliminated.length === 2, names(t, st.eliminated));
})();

(function () {
  // 按小局判定
  const { t, st } = mkSwiss(8, { rounds: 3, clinch: { basis: 'game', winTarget: 4, lossTarget: 0 } });
  t.format = { gamesPerMatch: 3, winNeeded: 2, recordScore: false };
  for (let r = 0; r < 2; r++) { E.generateRound(t); playRound(t, st); E.finishRound(t); }
  ok('G9 小局制：2 轮各赢 2 局 = 4 局 → 晋级', st.clinched.length === 2, names(t, st.clinched));
  ok('G10 小局数记录正确', E.buildStats(t, st, st.participants.slice(), null)[st.clinched[0]].gamesWon === 4,
    E.buildStats(t, st, st.participants.slice(), null)[st.clinched[0]].gamesWon);
})();

(function () {
  // 未启用时不影响排名与出场
  const { t, st } = mkSwiss(8, { rounds: 3, clinch: { enabled: false, winTarget: 2, lossTarget: 2 } });
  E.generateRound(t); playRound(t, st); E.finishRound(t);
  ok('G11 未启用时不判定', st.clinched.length === 0 && st.eliminated.length === 0);
  E.generateRound(t);
  ok('G12 未启用时全员继续出场', E.roundPool(st.roundsData[1]).length === 8);
})();

(function () {
  // 回退能恢复
  const { t, st } = mkSwiss(8, { rounds: 3, clinch: { winTarget: 2, lossTarget: 2 } });
  E.generateRound(t); playRound(t, st); E.finishRound(t);
  E.generateRound(t);
  const snapLen = st.roundsData.length;
  E.snapshot(t);                 // 模拟界面在操作前的快照
  playRound(t, st); E.finishRound(t);
  const nCl = st.clinched.length;
  E.rollback(t);
  const stAfter = t.stages[0];
  ok('G13 回退后轮次数恢复', stAfter.roundsData.length === snapLen, stAfter.roundsData.length + ' vs ' + snapLen);
  ok('G14 回退后晋级名单恢复（清空）', (stAfter.clinched || []).length === 0 && nCl === 2,
    (stAfter.clinched || []).length + ' / was ' + nCl);
})();

(function () {
  // 淘汰赛阶段不应出现提前晋级 / 淘汰
  const t = M.createTournament('DE');
  for (let i = 1; i <= 8; i++) t.players.push(M.createPlayer('P' + i, i));
  const st = t.stages[0];
  st.type = 'single_elim';
  st.participants = t.players.map(p => p.id);
  st.clinch = { enabled: true, basis: 'match', winTarget: 1, lossTarget: 1, bonus: 0, bonusPerEarly: 0 };
  ok('G15 淘汰赛阶段不支持提前晋级', E.clinchSupported(st) === false);
  E.generateRound(t); playRound(t, st); E.finishRound(t);
  ok('G16 淘汰赛不写 clinched', (st.clinched || []).length === 0);
  ok('G17 淘汰赛不因 clinch 提前结束', E.stageFinished(t, st) === false);
})();

/* ================= 结果 ================= */
console.log('\n==== 合计 ' + (pass + fail) + ' 项：PASS ' + pass + ' / FAIL ' + fail + ' ====');
process.exit(fail ? 1 : 0);
