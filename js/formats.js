/* ============================================================
   formats.js —— 各赛制的对阵生成算法
   · 循环赛：Circle Method（贝格尔编排）
   · 单败淘汰：标准种子位次 bracket
   · 双败淘汰：胜者组 / 败者组动态状态机
   · 瑞士轮：分数段内配对 + 回溯避免重复交手 + 轮空策略
   · 小组赛：蛇形/随机/手动分组 + 组内独立赛制
   ============================================================ */
(function (global) {
  'use strict';
  var TMS = global.TMS;
  var U = TMS.util;
  var F = TMS.formats = {};

  /* ============ 通用：把选手数组两两配对（按数组顺序相邻配对） ============ */
  F.chunkPairs = function (ids) {
    var out = [], i;
    for (i = 0; i + 1 < ids.length; i += 2) out.push([ids[i], ids[i + 1]]);
    if (ids.length % 2 === 1) out.push([ids[ids.length - 1], null]);
    return out;
  };

  /* ============ 循环赛：Circle Method ============ */
  // 返回 一个循环 的所有轮次；若人数为奇数，每轮有一人轮空
  F.circleSchedule = function (ids) {
    var list = ids.slice();
    if (list.length < 2) return [];
    var odd = list.length % 2 === 1;
    if (odd) list.push(null);
    var m = list.length, rounds = [], arr = list.slice(), r, i, pairs, a, b;
    for (r = 0; r < m - 1; r++) {
      pairs = [];
      for (i = 0; i < m / 2; i++) {
        a = arr[i]; b = arr[m - 1 - i];
        if (a === null || b === null) {
          var who = (a === null) ? b : a;
          if (who !== null) pairs.push([who, null]);
        } else {
          pairs.push([a, b]);
        }
      }
      rounds.push(pairs);
      // 轮转：固定首位，其余向右循环移位一位
      var fixed = arr[0], rest = arr.slice(1);
      rest.unshift(rest.pop());
      arr = [fixed].concat(rest);
    }
    // 奇数人数时，把 null 轮空分散（circle 已自动保证每轮仅一人轮空）
    return rounds;
  };

  // cycles 次循环；奇数索引循环交换主客顺序，保证"主客场"平衡
  F.roundRobinRounds = function (ids, cycles) {
    cycles = Math.max(1, parseInt(cycles, 10) || 1);
    var all = [], c, r, rounds, flipped;
    for (c = 0; c < cycles; c++) {
      rounds = F.circleSchedule(ids);
      for (r = 0; r < rounds.length; r++) {
        flipped = rounds[r].map(function (p) {
          // 第 2、4… 次循环交换左右；轮空保持
          return (c % 2 === 1 && p[1]) ? [p[1], p[0]] : p.slice();
        });
        all.push(flipped);
      }
    }
    return all;
  };

  /* ============ 单败淘汰：种子位次 ============ */
  // 返回长度 size 的数组，第 i 项表示第 i 个位置应放的种子号（1-based）
  F.seedOrder = function (size) {
    var order = [1], next, sum, i;
    while (order.length < size) {
      next = []; sum = order.length * 2 + 1;
      for (i = 0; i < order.length; i++) { next.push(order[i]); next.push(sum - order[i]); }
      order = next;
    }
    return order;
  };

  // 按种子把选手摆到 bracket 位置上；不足 2 的幂的位置补 null（轮空）
  F.layoutSeeds = function (seededIds, size) {
    var order = F.seedOrder(size), slots = [], i, seedNo, id;
    for (i = 0; i < size; i++) {
      seedNo = order[i];
      id = (seedNo <= seededIds.length) ? seededIds[seedNo - 1] : null;
      slots.push(id);
    }
    return slots;
  };

  // 由 bracket 位置数组生成首轮对阵：位置 0v1, 2v3, ...；对手为 null 则轮空
  F.bracketFirstRound = function (slots) {
    var pairs = [], i;
    for (i = 0; i + 1 < slots.length; i += 2) {
      var a = slots[i], b = slots[i + 1];
      if (a && b) pairs.push([a, b]);
      else if (a) pairs.push([a, null]);
      else if (b) pairs.push([b, null]);
    }
    return pairs;
  };

  /* ============ 瑞士轮 ============ */
  /**
   * 在一个分数段内穷举配对，尽量避开已交手过的对手。
   * pool: [playerId]（已按排名排序）
   * playedSet: { 'a|b': true }
   * 返回 pairs: [[a,b], ...]；仅当池子为奇数时才会出现 1 个 [x, null] 轮空项。
   *
   * 注意（v2.4 修复）：以前这里允许「每个人都轮空」这种解，而且找到新解就无条件覆盖 best，
   * 结果偶数人的池子也可能返回一堆 [x, null] ——界面上就表现为「选手莫名其妙获得轮空」，
   * 而且是同一个人 / 好几个人同时轮空。现在：
   *   ① 只有奇数池才允许轮空，且至多 1 次；
   *   ② 只有「重复交手更少」的解才会替换当前最优解；
   *   ③ 轮空本身也算一次「代价」，所以不会为了让重复更少而把偶数池拆成两个轮空。
   */
  F.avoidRepeats = function (pool, playedSet) {
    var n = pool.length;
    if (n === 0) return [];
    if (n === 1) return [[pool[0], null]];

    var allowBye = (n % 2 === 1);   // 偶数人绝对不产生轮空
    var used = new Array(n), pairs = [], best = null, count = 0;
    var LIMIT = 60000;

    function conflict(i, j) {
      return !!playedSet[U.pairKey(pool[i], pool[j])];
    }
    function dfs(idx, bad, byeUsed) {
      if (count > LIMIT) return;
      count++;
      if (idx === n) {
        if (!best || bad < best.bad) {
          best = pairs.map(function (p) { return p.slice(); });
          best.bad = bad;
          if (bad === 0) { count = LIMIT + 1; } // 完美解，立即停止
        }
        return;
      }
      if (used[idx]) { dfs(idx + 1, bad, byeUsed); return; }
      var i = idx;
      for (var j = i + 1; j < n; j++) {
        if (used[j]) continue;
        var c = conflict(i, j) ? 1 : 0;
        if (bad + c >= (best ? best.bad : 9999)) continue; // 剪枝：不再可能更优
        used[i] = used[j] = 1;
        pairs.push([pool[i], pool[j]]);
        dfs(idx + 1, bad + c, byeUsed);
        pairs.pop();
        used[i] = used[j] = 0;
        if (count > LIMIT) return;
      }
      // 只有奇数人才允许 1 次轮空，而且要确实比当前最优解更好才值得尝试
      if (allowBye && !byeUsed && bad + 1 < (best ? best.bad : 9999)) {
        used[i] = 1;
        pairs.push([pool[i], null]);
        dfs(idx + 1, bad + 1, true);
        pairs.pop();
        used[i] = 0;
      }
    }
    dfs(0, 0, false);
    return best || F.chunkPairs(pool);
  };

  /**
   * 瑞士轮单轮配对
   * @param entries [{id, points, seed, hasBye}] 已按 points desc 排好
   * @param playedSet {} 已交手记录
   * @param rng 随机函数
   * @param opts {byeRule, roundIndex}
   * @return { pairs: [[a,b]], bye: id|null }
   */
  F.swissPairing = function (entries, playedSet, rng, opts) {
    opts = opts || {};
    var list = entries.slice(), bye = null, r = rng || Math.random;

    // ---------- 1. 处理轮空 ----------
    if (list.length % 2 === 1) {
      var idx = -1, i;
      var rule = opts.byeRule || 'randomFirst';
      var isFirst = (opts.roundIndex === 0);

      if (rule === 'manual') {
        // 界面层已可通过固定名单处理；此处退化为"未轮空过的最低分"
        rule = 'lowest';
      }
      if (rule === 'random' || (rule === 'randomFirst' && isFirst)) {
        var cand = [];
        for (i = 0; i < list.length; i++) if (!list[i].hasBye) cand.push(i);
        if (!cand.length) for (i = 0; i < list.length; i++) cand.push(i);
        idx = cand[Math.floor(r() * cand.length)];
      } else {
        // lowest：从未轮空过的人里取排名最低的
        for (i = list.length - 1; i >= 0; i--) {
          if (!list[i].hasBye) { idx = i; break; }
        }
        if (idx < 0) idx = list.length - 1;
      }
      bye = list[idx].id;
      list.splice(idx, 1);
    }

    // ---------- 2. 按积分分段，段内配对，落单者下移 ----------
    var groups = [], cur = [];
    for (var k = 0; k < list.length; k++) {
      if (cur.length === 0 || cur[0].points === list[k].points) cur.push(list[k]);
      else { groups.push(cur); cur = [list[k]]; }
    }
    if (cur.length) groups.push(cur);

    var pairs = [], leftover = [];
    for (var g = 0; g < groups.length; g++) {
      var pool = leftover.concat(groups[g]);
      leftover = [];
      // pool 若为奇数，最后一人下移到下一段
      while (pool.length % 2 === 1 && g < groups.length - 1) {
        leftover.unshift(pool.pop());
      }
      if (pool.length === 0) continue;
      if (pool.length === 1) { leftover.unshift(pool.pop()); continue; }
      var sub = F.avoidRepeats(pool.map(function (e) { return e.id; }), playedSet);
      for (var s = 0; s < sub.length; s++) {
        if (sub[s][1] === null) leftover.unshift(sub[s][0]);
        else pairs.push(sub[s]);
      }
    }
    // 兜底：仍有落单则强制配对
    while (leftover.length >= 2) pairs.push([leftover.shift(), leftover.shift()]);
    if (leftover.length && pairs.length) {
      // 极端情况：无法配对，忽略（不应发生）
    }
    return { pairs: pairs, bye: bye };
  };

  /* ============ 小组赛：分组 ============ */
  /**
   * @param ids 按种子排好序的选手
   * @param count 组数
   * @param method 'snake' 蛇形 | 'random' 随机 | 'manual' 手动（groups 已给定）
   */
  F.splitGroups = function (ids, count, method, rng) {
    count = Math.max(1, parseInt(count, 10) || 1);
    var groups = [], i;
    for (i = 0; i < count; i++) groups.push([]);
    if (method === 'random') {
      var sh = U.shuffle(ids, rng);
      for (i = 0; i < sh.length; i++) groups[i % count].push(sh[i]);
    } else {
      // 蛇形排列：1→G1, 2→G2, ..., n→Gn, n+1→Gn, ...
      for (i = 0; i < ids.length; i++) {
        var round = Math.floor(i / count);
        var idx = (round % 2 === 0) ? (i % count) : (count - 1 - (i % count));
        groups[idx].push(ids[i]);
      }
    }
    return groups.filter(function (g) { return g.length > 0; });
  };

  /* ============ 双败淘汰：状态机 ============ */
  /**
   * 状态说明
   *   w       胜者组仍存活的选手（按种子序）
   *   l       败者组仍存活的选手
   *   pending 刚从胜者组掉下来、还没在败者组出过场的选手
   *   gfCount 已打完的总决赛场次（0 / 1 / 2）
   *   gfFirst 总决赛首场胜者（'A' = 胜者组冠军，'B' = 败者组冠军）
   *   cross   半区互换开关 + halfOf（选手 → 0 上半区 / 1 下半区）
   *           ★ 互换只影响「败者组怎么配对」，不改变对阵结构：
   *             胜者组 / 败者组的轮数与人数完全沿用标准双败，
   *             所以「胜者组决赛败者直接进败者组决赛」这条铁律不会被破掉。
   *             （v3.0 之前的实现把败者组拆成两个独立半区各自出冠军再打「交叉决赛」，
   *              多打一轮、WB 决赛败者还会被塞进已经打完的半区，导致败者组出现轮空、
   *              有人三负、WB 决赛败者提前出局 —— 已重写。）
   */
  F.createDEState = function (ids, size, opts) {
    opts = opts || {};
    var st = {
      size: size,
      w: ids.slice(),      // 胜者组存活
      l: [],               // 败者组存活
      pending: [],         // 待注入败者组的"胜者组败者"
      started: false,
      gfCount: 0,          // 已进行的总决赛场次
      gfFirst: null        // 总决赛首场胜者（用于判断是否加赛）
    };
    st.halfOf = opts.halfOf || {};   // 半区映射总是保留（不互换时也用来画图 / 排查）
    if (opts.cross) st.cross = true;
    return st;
  };

  /* 选手属于哪个半区：0 上 / 1 下 / 2 未登记
     id 既可能是选手 id（字符串），也可能是对阵图骨架里的占位 token（对象，用 __k 作键） */
  function halfKeyOf(id) {
    if (id == null) return null;
    if (typeof id === 'object') return (id.__k != null) ? '__k:' + id.__k : (id.id != null ? 'id:' + id.id : null);
    return 'id:' + id;
  }
  function halfOfId(de, id) {
    if (!de || !de.halfOf) return 2;
    function pick(k) { var v = (k == null) ? undefined : de.halfOf[k]; return (v === 0 || v === 1) ? v : undefined; }
    var h = pick(halfKeyOf(id));                       // '__k:12' / 'id:abc'
    if (h !== undefined) return h;
    if (id != null && typeof id === 'object') {         // 骨架里的 token
      h = pick('__k:' + id.__k); if (h !== undefined) return h;
      if (id.__k != null) { h = pick(id.__k); if (h !== undefined) return h; }
      if (id.id != null) { h = pick(id.id); if (h !== undefined) return h; }
      return 2;
    }
    h = pick(id);                                      // 老写法：直接用选手 id 当键
    return (h === undefined) ? 2 : h;
  }

  /* 按半区分组（保持原有顺序）：上、下、未知 */
  function splitByHalf(de, list) {
    var top = [], bot = [], unk = [];
    (list || []).forEach(function (id) {
      var h = halfOfId(de, id);
      (h === 0 ? top : h === 1 ? bot : unk).push(id);
    });
    return { top: top, bot: bot, unk: unk };
  }

  /* 相邻配对（不互换）：(0,1) (2,3) … 与真实双败「同半区先打」的顺序一致 */
  function plainPairsOfList(list) {
    var pairs = [], byes = [];
    var arr = (list || []).slice();
    if (arr.length % 2 === 1) {
      byes.push(arr[arr.length - 1]);
      arr.pop();
    }
    for (var k = 0; k + 1 < arr.length; k += 2) pairs.push([arr[k], arr[k + 1]]);
    return { pairs: pairs, byes: byes };
  }

  /* 指定半区互配：上区第 i 个 × 下区第 i 个，剩下的相邻配 */
  function crossPairsOfList(de, list) {
    var g = splitByHalf(de, list);
    var pairs = [];
    var n = Math.min(g.top.length, g.bot.length), k;
    for (k = 0; k < n; k++) pairs.push([g.top[k], g.bot[k]]);
    var rest = plainPairsOfList(g.top.slice(n).concat(g.bot.slice(n)).concat(g.unk));
    return { pairs: pairs.concat(rest.pairs), byes: rest.byes };
  }

  /* 不互换的合并轮：存活者第 i 个 × 新败者第 i 个（与对阵图的「第 X 场对第 X 场」一致） */
  function plainPairsSurviveDrop(survivors, dropped) {
    var pairs = [], byes = [];
    var sv = (survivors || []).slice(), dp = (dropped || []).slice();
    var n = Math.min(sv.length, dp.length), k;
    for (k = 0; k < n; k++) pairs.push([sv[k], dp[k]]);
    var rest = plainPairsOfList(sv.slice(n).concat(dp.slice(n)));
    return { pairs: pairs.concat(rest.pairs), byes: byes.concat(rest.byes) };
  }

  /**
   * 双败淘汰：生成下一轮的配对
   * @param de 状态对象
   * @param opts {gfMode:'reset'|'none'|'handicap'|'elevate'}
   * @return { pairsW: [[a,b]], pairsL: [[a,b]], byesW: [id], byesL: [id],
   *           finished: bool, gf: bool, gfReset: bool }
   */
  F.doubleElimNext = function (de, opts) {
    opts = opts || {};
    var mode = opts.gfMode || 'reset';
    var res = { pairsW: [], pairsL: [], byesW: [], byesL: [], finished: false, gf: false, gfReset: false };

    // 只剩两人（胜者组冠军 + 一名还没在败者组出场的败者）时，
    // 直接把待入败者组的人并入败者组，避免多排一场「轮空」的空轮。
    if (de.w.length <= 1 && de.pending.length && (de.l.length + de.pending.length) <= 1) {
      de.l = de.l.concat(de.pending);
      de.pending = [];
    }

    // ---- 总决赛阶段：胜者组冠军 vs 败者组冠军 ----
    if (de.w.length === 1 && de.l.length === 1 && de.pending.length === 0) {
      // 加赛制：败者组冠军必须先赢下首场，才触发第二场加赛
      if (mode === 'reset') {
        if (de.gfCount >= 2) { res.finished = true; return res; }
        if (de.gfCount === 0) {
          res.gf = true;
          res.pairsW = [[de.w[0], de.l[0]]];
          return res;
        }
        if (de.gfFirst === 'A') { res.finished = true; return res; }  // 胜者组冠军首场即夺冠
        res.gf = true;
        res.gfReset = true;   // 败者组冠军赢了首场 → 再打一场（加赛）定冠军
        res.pairsW = [[de.w[0], de.l[0]]];
        return res;
      }
      // 无优势 / 让局 / 可升格决赛：只有一场，胜者即冠军。
      // 可升格决赛的「升格」发生在这一场内部 —— 比分累计不重置，
      // 败者组冠军先达到原获胜局数后目标升为更高的局数，双方继续打。
      if (de.gfCount >= 1) { res.finished = true; return res; }
      res.gf = true;
      res.pairsW = [[de.w[0], de.l[0]]];
      return res;
    }
    if (de.w.length === 1 && de.l.length === 1 && de.pending.length === 1) {
      // 败者组还需消化 W 组决赛败者
      res.pairsL = [[de.l[0], de.pending[0]]];
      return res;
    }
    if (de.w.length === 0 && de.l.length === 1) { res.finished = true; return res; }
    if (de.w.length === 1 && de.l.length === 0) { res.finished = true; return res; }

    // ---- 胜者组 ----
    if (de.w.length >= 2) {
      res.pairsW = F.chunkPairs(de.w);
      for (var i = 0; i < res.pairsW.length; i++) {
        if (res.pairsW[i][1] === null) { res.byesW.push(res.pairsW[i][0]); res.pairsW.splice(i, 1); i--; }
      }
    }

    // ---- 败者组：老成员 + 新注入的胜者组败者 ----
    // ★ 标准双败的「波浪」是固定的：
    //     · 合并轮（存活者 l 个 + 至少 l 个刚落下来的败者）→ 存活者 1:1 接新败者，
    //       每次只吃 l 个（按掉落先后），多出来的留到下一轮；
    //     · 内部轮（没有新败者）→ 存活者两两配，人数减半；
    //     · 只剩 0/1 个存活者时（败者组决赛那种）→ 把待注入的败者也拉进来配一场。
    //   「不互换」= 相邻/同位配对（同半区先打，和经典双败对阵图完全一致）；
    //   「半区互换」= 上区第 i 个对下区第 i 个（跨半区先打）。
    var lCnt = de.l.length, pCnt = de.pending.length;
    var lbPairs = [], lbByes = [], lbRes;

    if (lCnt >= 2 && pCnt >= lCnt) {
      // 合并轮：只吃 lCnt 个新败者，剩下的继续待注入
      var drops = de.pending.slice(0, lCnt);
      lbRes = plainPairsSurviveDrop(de.l, drops);
    } else if (lCnt >= 2) {
      // 内部轮（也可能 pending 不够，先让存活者自己打）
      lbRes = plainPairsOfList(de.l);
    } else {
      // 存活者 0~1 人：把待注入的败者并进来（败者组决赛）
      var all = de.l.concat(de.pending);
      if (all.length >= 2) {
        // ★ 半区互换只作用在「败者组第一轮」的落位：上区的人先去对下区的人，
        //   之后就按标准双败的相邻配对推进（这正是真实赛事里「交叉落位」的做法，
        //   也保证结构和对阵图与实际生成完全一致）。
        lbRes = (de.cross && lCnt === 0) ? crossPairsOfList(de, all) : plainPairsOfList(all);
      } else {
        lbRes = { pairs: [], byes: all.length === 1 ? [all[0]] : [] };
      }
    }
    lbPairs = lbRes.pairs; lbByes = lbRes.byes;
    lbPairs.forEach(function (p) { res.pairsL.push(p); });
    res.byesL = res.byesL.concat(lbByes);

    return res;
  };

  /**
   * 双败淘汰：本轮结束后推进状态
   * @param de 状态
   * @param round {matches:[...]}（已全部完成）
   * @param opts {drawBothLose:bool}
   *        drawBothLose = true：平局视为「双方都输」
   *          · 胜者组平局 → 两人一起掉进败者组
   *          · 败者组平局 → 两人各自吃到第 2 负，双双淘汰
   *          · 总决赛平局 → 胜者组冠军掉进败者组（第 1 负）、败者组冠军被淘汰（第 2 负），
   *            这样场上只剩胜者组冠军一人，即本阶段冠军
   */
  F.doubleElimCommit = function (de, round, opts) {
    var bothLose = !!(opts && opts.drawBothLose);
    var wW = [], wL = [], lW = [], i, m, win, lose;
    /* 判定一场比赛是不是「已结算的平局」 */
    function drawn(x) {
      return !!(bothLose && x.result && x.result.settled && x.result.winner === null
        && !x.isBye && !x.voided && x.playerA && x.playerB);
    }
    for (i = 0; i < round.matches.length; i++) {
      m = round.matches[i];
      if (!m.playerA && !m.playerB) continue;   // 编排过程中的空桌，忽略
      if (m.voided) continue;                   // 双方都已退赛：作废，不影响晋级归属
      if (m.isBye) {
        var alone = m.playerA || m.playerB;
        if (m.bracket === 'W') wW.push(alone); else lW.push(alone);
        continue;
      }
      if (drawn(m)) {
        // 平局 = 双方都输：胜者组两侧都算败者掉下去，败者组两侧都被淘汰（不进 lW）
        if (m.bracket === 'W') { wL.push(m.playerA); wL.push(m.playerB); }
        continue;
      }
      if (!m.result || !m.result.winner) return { ok: false, msg: '存在未完成的比赛' };
      win = (m.result.winner === 'A') ? m.playerA : m.playerB;
      lose = (m.result.winner === 'A') ? m.playerB : m.playerA;
      if (m.bracket === 'W') { wW.push(win); wL.push(lose); }
      else { lW.push(win); }
    }

    if (round.isGF && round.matches.length) {
      // 总决赛结果
      var gm = round.matches[0];
      if (drawn(gm)) {
        // 平局双败：胜者组冠军拿到第 1 负掉进败者组；败者组冠军已是第 2 负，直接淘汰。
        // 场上只剩胜者组冠军一人 → 他就是本阶段冠军（doubleElimNext 会判 finished）。
        var wchamp = (de.w.indexOf(gm.playerA) >= 0) ? gm.playerA
          : ((de.w.indexOf(gm.playerB) >= 0) ? gm.playerB : gm.playerA);
        de.gfCount = (de.gfCount && de.gfCount >= 1) ? 2 : 1;
        de.gfFirst = null;
        de.gfDrawBothLose = true;
        de.w = [];
        de.l = [wchamp];
        de.pending = [];
        return { ok: true, drawEnd: true };
      }
      if (de.gfCount === 0) {
        de.gfCount = 1;
        de.gfFirst = gm.result.winner;      // 'A' = 胜者组冠军赢 → 直接夺冠
      } else {
        de.gfCount = 2;
      }
      return { ok: true };
    }

    // 没有 W 组比赛时（胜者组已结束），保持 de.w 不变
    if (round.matches.some(function (x) { return x.bracket === 'W'; })) {
      de.w = wW;
      // ★ 待注入队列必须是「先进先出」：老的败者先被打，最新掉下来的人排最后。
      //   否则胜者组决赛的败者会被当成「最早掉落的人」提前一轮抽走，多打一场败者组
      //   （真实双败里他只该打「败者组决赛」）。
      de.pending = de.pending.filter(function (x) {
        // 上一轮未消化的 pending 若本轮没比赛，则保留
        return round.matches.every(function (mm) {
          return mm.playerA !== x && mm.playerB !== x;
        });
      }).concat(wL);
    } else {
      // 本轮只有 L 组比赛：pending 中未被安排的人继续保留
      de.pending = de.pending.filter(function (x) {
        return round.matches.every(function (mm) {
          return mm.playerA !== x && mm.playerB !== x;
        });
      });
    }
    de.l = lW;
    return { ok: true };
  };

  /* ============ 半区互换（crossover）============
     说明：互换不再是一台独立状态机，而是上面 doubleElimNext 里的
     「败者组配对策略」——结构仍是标准双败，这样才能保证：
       · 胜者组决赛的败者直接进「败者组决赛」（不会提前被消化掉）；
       · 败者组轮数固定为 2×log2(size) − 2，不会多打一轮；
       · 不会出现败者组轮空 / 一人三负；
       · 互换的效果是「同半区的人不在败者组第一场相遇」，
         这与真实赛事里「上下半区交叉落位」的诉求一致。
     v3.0 之前那台 doubleElimNextCross / doubleElimCommitCross 已删除。 */
  /* ============ 名次 bracket 顺序生成（单败/双败首轮） ============ */
  F.buildBracket = function (playerIds, useSeed) {
    var n = playerIds.length;
    var size = U.nextPow2(n);
    var ids = playerIds.slice();
    if (useSeed) {
      ids.sort(function (a, b) { return (a.seed || 9999) - (b.seed || 9999); });
    }
    var slots = F.layoutSeeds(ids, size);
    return { size: size, slots: slots, pairs: F.bracketFirstRound(slots) };
  };

})(window);
