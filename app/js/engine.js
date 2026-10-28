/* ============================================================
   engine.js —— 记分规则 / 排名计算 / 阶段推进 / 回退
   ============================================================ */
(function (global) {
  'use strict';
  var TMS = global.TMS;
  var U = TMS.util, F = TMS.formats, M = TMS.model, C = TMS.const;
  var E = TMS.engine = {};

  /* =========================================================
     〇、阶段配置解析
     每个阶段可单独设置局制与记分方式；未启用时沿用赛事全局设置。
     ========================================================= */
  E.fmtOf = function (t, stage) {
    // 团体赛：一场 = 一桌（每场双方各派一名队员，可换人），大比分 = 赢下的场数
    if (E.teamOn(t)) return E.teamFmtOf(t, null, stage);
    var out = Object.assign(M.defaultFormat(), (t && t.format) || {});
    if (stage && stage.useFormat && stage.format) Object.assign(out, stage.format);
    out.gamesPerMatch = Math.max(1, parseInt(out.gamesPerMatch, 10) || 1);
    out.winNeeded = Math.max(0, parseInt(out.winNeeded, 10) || 0);
    if (out.winNeeded > out.gamesPerMatch) out.winNeeded = out.gamesPerMatch;
    out.recordScore = !!out.recordScore;
    return out;
  };

  /* ---------------- 团体赛（v1.14.0 引入，v2.1 统一「一桌 = 一场」口径） ----------------
     开启后参赛单位是「队伍」，每队若干队员。

     **一场团体赛 = 若干场对局，每场对局就是一桌**（双方各派一名队员打一场）。
       一场对局用团体局制（几局几胜）定胜负；团体赛的大比分 = 赢下的场数；
       场内的局分只进小分（累计小分 / 净小分），不影响大比分。
       每一场都可以换不同队员 —— 上场人数不一定等于队伍人数（playSize 限制）。

     录入流程（和用户实际执裁一致）：
       ① 先在卡片上把这一场双方上场的队员定下来（排阵，存 m.slots）；
       ② 再录这一场的成绩（局分 + 胜方，存 m.games）。
       nvn            同时进行 → **必须先把整场的所有对局都排好阵**，才能录任何一场的成绩；
       conquest / kof 依次进行 → 一场一场来，能看到前面每一场谁上、结果如何。

     赛制与胜负条件：
       nvn      两队同时开打（场数 = 上场人数），全部打完比赢下场数
                → 比分可以是 3:0 / 2:1 / 1:2 ……，有平局时还会是平局
       conquest 赢过的人不能再上（必须换人），对手可选换不换；
                **一队所有上场队员都各赢下一场，这一队才获胜**
       kof      输的下场、赢的留场，直到对方上场队员全部被击败

     数据：m.games[] 每条 = 一场对局的成绩 {s: 场次(0 起), pa, pb, a, b, w}
           m.slots[] 每条 = 一场对局的排阵（上场队员）{s, pa, pb}
     ------------------------------------------------------ */
  E.teamOn = function (t) {
    return !!(t && t.team && t.team.on);
  };

  E.teamOf = function (t) {
    var c = Object.assign(M.defaultTeam(), (t && t.team) || {});
    c.on = !!c.on;
    c.size = Math.max(1, parseInt(c.size, 10) || 1);
    c.playSize = Math.max(0, parseInt(c.playSize, 10) || 0);
    c.winNeeded = Math.max(0, parseInt(c.winNeeded, 10) || 0);   // v2.0 起不再参与判定
    if (['nvn', 'conquest', 'kof'].indexOf(c.mode) < 0) c.mode = 'nvn';
    return c;
  };

  // 某支队伍的队员名单
  E.teamMembersOf = function (t, m, side) {
    var pid = (side === 'A') ? (m && m.playerA) : (m && m.playerB);
    var p = (t.players || []).filter(function (x) { return x.id === pid; })[0];
    return (p && p.members) || [];
  };

  /* 这一方这场上几人（队员不一定等于队伍人数）
       playSize 填了就按 playSize（且不超过实际队员数），没填 = 全员都能上 */
  E.teamFieldSize = function (t, m, side) {
    var cfg = E.teamOf(t);
    var mem = E.teamMembersOf(t, m, side);
    var total = mem.length || cfg.size;
    var want = cfg.playSize > 0 ? Math.min(cfg.playSize, total) : total;
    return Math.max(1, want);
  };

  /* 这一场团体赛一共打几场对局（= 大比分上限）
       nvn      双方同时上场的场数（双方人数不齐时按少的算）
       征服/KOF  依次进行，最多两边各差一场 */
  E.teamTableTotal = function (t, m) {
    var cfg = E.teamOf(t);
    var fa = E.teamFieldSize(t, m, 'A'), fb = E.teamFieldSize(t, m, 'B');
    if (cfg.mode === 'nvn') return Math.max(1, Math.min(fa, fb));
    return Math.max(1, fa + fb - 1);
  };

  // 兼容旧调用名（v1.14 ~ v2.0 里叫「回合数」）
  E.teamRoundCount = function (t, m) {
    return E.teamTableTotal(t, m);
  };

  // 每方要赢几场才算赢；nvn 返回 null = 全部打完再比谁赢得多
  E.teamNeedOf = function (t, m) {
    var cfg = E.teamOf(t);
    var fa = E.teamFieldSize(t, m, 'A'), fb = E.teamFieldSize(t, m, 'B');
    if (cfg.mode === 'conquest') return { a: fa, b: fb };   // 本方全员各赢下一场
    if (cfg.mode === 'kof') return { a: fb, b: fa };        // 把对方全员击败
    return null;
  };

  /* 团体赛整场的「局制」
       sets           = 总场数（大比分口径）
       gamesPerMatch / winNeeded = 每一场的局制（几局几胜）
       team: true     让记分方知道大比分单位是「场」
       teamNeed       征服 / KOF 每方要赢几场；nvn 为 null（打满比多少） */
  E.teamFmtOf = function (t, m, stage) {
    var cfg = E.teamOf(t);
    var st = stage || (t.stages || [])[t.currentStage || 0];
    var board = E.boardFmtOf(t, st);
    return {
      recordScore: false,
      sets: E.teamTableTotal(t, m), setRule: 'sets', setsToWin: 0,
      gamesPerMatch: board.gamesPerMatch, winNeeded: board.winNeeded,
      team: true, teamMode: cfg.mode, teamNeed: E.teamNeedOf(t, m)
    };
  };

  // 团体赛里「每一场对局」用的局制（= 赛事常规局制，可被团体设置 / 阶段独立局制覆盖）
  E.boardFmtOf = function (t, stage) {
    var out = Object.assign(M.defaultFormat(), (t && t.format) || {});
    if (t && t.team && t.team.fmt) Object.assign(out, t.team.fmt);
    if (stage && stage.useFormat && stage.format) Object.assign(out, stage.format);
    out.gamesPerMatch = Math.max(1, parseInt(out.gamesPerMatch, 10) || 1);
    out.winNeeded = Math.max(0, parseInt(out.winNeeded, 10) || 0);
    if (out.winNeeded > out.gamesPerMatch) out.winNeeded = out.gamesPerMatch;
    out.recordScore = !!out.recordScore;
    return out;
  };

  /* ---------------- 排阵（上场队员）---------------- */
  E.teamSlotsOf = function (m) {
    return (m && Array.isArray(m.slots)) ? m.slots : [];
  };

  E.teamSlotOf = function (m, si) {
    var list = E.teamSlotsOf(m);
    for (var i = 0; i < list.length; i++) {
      if ((parseInt(list[i].s, 10) || 0) === si) return list[i];
    }
    return null;
  };

  E.teamSetSlot = function (m, si, pa, pb) {
    if (!Array.isArray(m.slots)) m.slots = [];
    var sl = E.teamSlotOf(m, si);
    if (!sl) { sl = { s: si, pa: '', pb: '' }; m.slots.push(sl); }
    if (pa !== undefined) sl.pa = pa || '';
    if (pb !== undefined) sl.pb = pb || '';
    return sl;
  };

  // 这一场已经录入的成绩（没有则 null）
  E.teamGameAt = function (m, si) {
    var list = (m && m.games) || [];
    for (var i = 0; i < list.length; i++) {
      if ((parseInt(list[i].s, 10) || 0) === si) return list[i];
    }
    return null;
  };

  // 这一场双方上场的队员（先看已录的成绩，再看排阵）
  E.teamSlotPlayers = function (m, si) {
    var g = E.teamGameAt(m, si);
    if (g && (g.pa || g.pb)) return { a: g.pa || null, b: g.pb || null };
    var sl = E.teamSlotOf(m, si);
    return { a: (sl && sl.pa) || null, b: (sl && sl.pb) || null };
  };

  // 已经打完的场次（升序）
  E.teamTablesOf = function (m) {
    var out = [];
    ((m && m.games) || []).forEach(function (g) {
      out.push({
        s: parseInt(g.s, 10) || 0,
        pa: g.pa, pb: g.pb, w: g.w, a: g.a, b: g.b, game: g
      });
    });
    out.sort(function (x, y) { return x.s - y.s; });
    return out;
  };

  // 已经打过比赛的场次号（升序）
  E.teamRoundsOf = function (m) {
    return E.teamTablesOf(m).map(function (u) { return u.s; });
  };

  // 某个场次的胜方（一条记录 = 一场，w 直接给出；同号多条时按多数）
  E.teamRoundWinner = function (t, m, si) {
    var a = 0, b = 0;
    E.teamTablesOf(m).forEach(function (u) {
      if (u.s !== si) return;
      if (u.w === 'A') a++; else if (u.w === 'B') b++;
    });
    if (a > b) return 'A';
    if (b > a) return 'B';
    return null;
  };

  // 某个场次双方上场的队员
  E.teamRoundPlayers = function (m, si) {
    return E.teamSlotPlayers(m, si);
  };

  // 当前该打的场次（第一个还没打的）；打满规定的场数还没定胜负就是加赛（场次号继续往后走）
  E.teamCur = function (t, m) {
    return E.teamTablesOf(m).length;
  };

  /* 整场的对阵是不是都排好了（nvn 录入成绩的前置条件）
     已打完的场次算排好；没打的场次必须有 pa 和 pb */
  E.teamLineupReady = function (t, m) {
    var total = E.teamTableTotal(t, m);
    for (var i = 0; i < total; i++) {
      if (E.teamGameAt(m, i)) continue;
      var pl = E.teamSlotPlayers(m, i);
      if (!pl.a || !pl.b) return false;
    }
    return true;
  };

  // 已排好阵的场次数（给界面显示进度）
  E.teamPairedCount = function (t, m) {
    var total = E.teamTableTotal(t, m), n = 0;
    for (var i = 0; i < total; i++) {
      if (E.teamGameAt(m, i)) { n++; continue; }
      var pl = E.teamSlotPlayers(m, i);
      if (pl.a && pl.b) n++;
    }
    return n;
  };

  /* 按名单顺序把整场的对阵排好（不动已打完的场次）
     nvn 下同一个人一场只能上一次 → 顺序取未被占用的人 */
  E.teamAutoLineup = function (t, m) {
    var total = E.teamTableTotal(t, m);
    var A = E.teamMembersOf(t, m, 'A').slice();
    var B = E.teamMembersOf(t, m, 'B').slice();
    var usedA = {}, usedB = {};
    var i;
    for (i = 0; i < total; i++) {
      var g = E.teamGameAt(m, i);
      if (!g) continue;
      if (g.pa) usedA[g.pa] = 1;
      if (g.pb) usedB[g.pb] = 1;
    }
    function pick(list, used) {
      for (var k = 0; k < list.length; k++) if (!used[list[k].id]) return list[k];
      return null;
    }
    for (i = 0; i < total; i++) {
      if (E.teamGameAt(m, i)) continue;
      var ma = pick(A, usedA); if (ma) usedA[ma.id] = 1;
      var mb = pick(B, usedB); if (mb) usedB[mb.id] = 1;
      E.teamSetSlot(m, i, ma ? ma.id : '', mb ? mb.id : '');
    }
  };

  // 某一方打过的场次（哪一场谁上、赢没赢）
  E.teamBoardsOf = function (t, m, side) {
    return E.teamTablesOf(m).map(function (u) {
      return {
        s: u.s, id: (side === 'A') ? u.pa : u.pb,
        win: u.w === side, lose: !!u.w && u.w !== side,
        draw: u.w === 'D' || !u.w,
        decided: u.w === 'A' || u.w === 'B' || u.w === 'D'
      };
    });
  };

  /* 团体赛大比分：赢下的场数 / 已打场数 / 还需几场 */
  E.teamScore = function (t, m) {
    var need = E.teamNeedOf(t, m);
    var total = E.teamTableTotal(t, m);
    var wA = 0, wB = 0, draws = 0;
    E.teamTablesOf(m).forEach(function (u) {
      if (u.w === 'A') wA++;
      else if (u.w === 'B') wB++;
      else draws++;
    });
    var done = E.teamTablesOf(m).length;
    return {
      tables: total, rounds: total, done: done,
      winsA: wA, winsB: wB, draws: draws, need: need,
      cur: E.teamCur(t, m), paired: E.teamPairedCount(t, m),
      lineupReady: E.teamLineupReady(t, m),
      leftA: need ? Math.max(0, need.a - wA) : Math.max(0, total - done),
      leftB: need ? Math.max(0, need.b - wB) : Math.max(0, total - done)
    };
  };

  /**
   * 某一方这一场还能派谁上
   *   nvn      整场一人只能上一场（已排到别人身上的不算）
   *   conquest 赢过的人不能再上（赢者必须换人，输的人还能继续打）
   *   kof      输过的人不能再上（输者下场，赢者留场）
   * @param exceptSi 正在编辑的场次号（不算它自己占位）
   */
  E.teamEligible = function (t, m, side, exceptSi) {
    var cfg = E.teamOf(t);
    var mem = E.teamMembersOf(t, m, side);
    if (cfg.mode === 'nvn') {
      if (exceptSi === undefined || exceptSi === null) return mem.slice();
      // 加赛（超出规定场数）= 新的一轮同时开打，队员可以再上一次
      var esi = parseInt(exceptSi, 10) || 0;
      if (esi >= E.teamTableTotal(t, m)) return mem.slice();
      var used = {};
      function mark(si, id) {
        if ((parseInt(si, 10) || 0) === exceptSi) return;
        if (id) used[id] = 1;
      }
      E.teamSlotsOf(m).forEach(function (sl) { mark(sl.s, (side === 'A') ? sl.pa : sl.pb); });
      E.teamTablesOf(m).forEach(function (u) { mark(u.s, (side === 'A') ? u.pa : u.pb); });
      return mem.filter(function (mb) { return !used[mb.id]; });
    }
    var out = {};
    E.teamBoardsOf(t, m, side).forEach(function (u) {
      if (!u.decided) return;
      if (cfg.mode === 'conquest' && u.win) out[u.id] = 1;
      if (cfg.mode === 'kof' && u.lose) out[u.id] = 1;
    });
    return mem.filter(function (mb) { return !out[mb.id]; });
  };

  // 这个人还能不能上（录入时校验，防止手滑派出已经不能上场的人）
  E.teamCanField = function (t, m, side, memberId, exceptSi) {
    if (!memberId) return false;
    return E.teamEligible(t, m, side, exceptSi).some(function (mb) { return mb.id === memberId; });
  };

  /**
   * 下一场该派谁上（返回 {s 场次, a, b, mode}）
   *   nvn      当前场次还没排阵 → 按名单给默认对位
   *   conquest 赢方必须换人；负方默认让刚才那位继续，可手动换
   *   kof      赢者留场，负方换下一个还能上的人
   */
  E.teamNextBoard = function (t, m) {
    var cfg = E.teamOf(t);
    var si = E.teamCur(t, m);
    var cur = E.teamSlotPlayers(m, si);

    if (cfg.mode === 'nvn') {
      var A0 = E.teamEligible(t, m, 'A', si);
      var B0 = E.teamEligible(t, m, 'B', si);
      return {
        s: si, mode: cfg.mode,
        a: cur.a || (A0[0] ? A0[0].id : null),
        b: cur.b || (B0[0] ? B0[0].id : null)
      };
    }

    var A = E.teamEligible(t, m, 'A');
    var B = E.teamEligible(t, m, 'B');
    var rounds = E.teamRoundsOf(m);
    function first(list, i) { return (list[i] ? list[i].id : (list[0] ? list[0].id : null)); }
    function has(list, id) {
      if (!id) return false;
      for (var k = 0; k < list.length; k++) if (list[k].id === id) return true;
      return false;
    }
    var lastSi = -1;
    rounds.forEach(function (x) { if (E.teamRoundWinner(t, m, x)) lastSi = x; });
    if (lastSi < 0) return { s: si, mode: cfg.mode, a: first(A, 0), b: first(B, 0) };
    var lp = E.teamRoundPlayers(m, lastSi);
    var aWin = (E.teamRoundWinner(t, m, lastSi) === 'A');
    var bWin = (E.teamRoundWinner(t, m, lastSi) === 'B');
    var ca, cb;
    if (cfg.mode === 'conquest') {
      ca = aWin ? first(A, 0) : (has(A, lp.a) ? lp.a : first(A, 0));
      cb = bWin ? first(B, 0) : (has(B, lp.b) ? lp.b : first(B, 0));
    } else {
      ca = aWin ? (has(A, lp.a) ? lp.a : first(A, 0)) : first(A, 0);
      cb = bWin ? (has(B, lp.b) ? lp.b : first(B, 0)) : first(B, 0);
    }
    return { s: si, mode: cfg.mode, a: ca, b: cb };
  };

  // 整场的默认对位（按名单顺序，供界面一键排阵）
  E.teamBatchPairs = function (t, m) {
    var total = E.teamTableTotal(t, m);
    var A = E.teamMembersOf(t, m, 'A'), B = E.teamMembersOf(t, m, 'B');
    var out = [];
    for (var i = 0; i < total; i++) out.push({ s: i, a: A[i] ? A[i].id : null, b: B[i] ? B[i].id : null });
    return out;
  };

  E.scOf = function (t, stage) {
    var out = Object.assign(M.defaultScoring(), (t && t.scoring) || {});
    if (stage && stage.useScoring && stage.scoring) Object.assign(out, stage.scoring);
    if (!Array.isArray(out.tieOrder)) out.tieOrder = M.defaultScoring().tieOrder;
    out.manualOrder = (stage && stage.manualOrder) ||
      ((t && t.scoring && t.scoring.manualOrder) || {});
    return out;
  };

  /* ---- 双败总决赛 / 加赛局的独立局制 ---- */
  function normFmt(out) {
    out = Object.assign(M.defaultFormat(), out || {});
    out.gamesPerMatch = Math.max(1, parseInt(out.gamesPerMatch, 10) || 1);
    out.winNeeded = Math.max(0, parseInt(out.winNeeded, 10) || 0);
    if (out.winNeeded > out.gamesPerMatch) out.winNeeded = out.gamesPerMatch;
    out.recordScore = !!out.recordScore;
    return out;
  }

  /**
   * 双败阶段：总决赛局制
   * @param isReset true = 加赛局（可单独设置，未设置时沿用总决赛局制）
   *
   * 注意：可升格决赛（elevate）没有第二场 —— 升格发生在同一场内部，
   * 所以这里既不用 resetFormat 也不用 gfElevFormat，直接返回首场局制。
   * 升格后的目标局数由 E.gfElevCfg() 算出并挂在 match.gfElev 上，
   * 由 E.fmtOfMatch() / E.evaluate() 动态读取。
   */
  E.gfFmtOf = function (t, stage, isReset) {
    var base = E.fmtOf(t, stage);
    if (!stage) return base;
    if (isReset) {
      if (stage.resetUseFormat && stage.resetFormat) return normFmt(Object.assign({}, base, stage.resetFormat));
      if (stage.gfUseFormat && stage.gfFormat) return normFmt(Object.assign({}, base, stage.gfFormat));
      return base;
    }
    if (stage.gfUseFormat && stage.gfFormat) return normFmt(Object.assign({}, base, stage.gfFormat));
    return base;
  };

  /**
   * 可升格决赛的目标局数
   *   base = 首场获胜所需局数（原局制的 winNeeded，未设时取「多数局」）
   *   up   = 败者组冠军先拿到 base 局之后，双方都要达到的新目标（默认 base + 1）
   * 一场定胜负、比分累计不重置：
   *   胜者组冠军先到 base → 直接夺冠，不升格
   *   败者组冠军先到 base → 目标升到 up，双方带着原比分继续打
   */
  E.gfElevCfg = function (t, stage) {
    var b = E.gfFmtOf(t, stage, false);
    var need0 = parseInt(b.winNeeded, 10);
    if (!(need0 > 0)) need0 = Math.floor((parseInt(b.gamesPerMatch, 10) || 1) / 2) + 1;
    need0 = Math.max(1, need0);
    var ef = (stage && stage.gfElevUseFormat) ? (stage.gfElevFormat || {}) : {};
    var need1 = parseInt(ef.winNeeded, 10);
    if (!(need1 > 0)) need1 = need0 + 1;
    need1 = Math.max(need1, need0 + 1);
    return { base: need0, up: need1, fmt: b };
  };

  // 某场可升格决赛「当前」的获胜所需局数（败者组冠军已达标则升格）
  E.gfElevNeed = function (m) {
    if (!m || !m.gfElev) return 0;
    var p = E.progress(m);
    var lb = (m.gfElev.side === 'A') ? p.a : p.b;
    return (lb >= m.gfElev.base) ? m.gfElev.up : m.gfElev.base;
  };

  // 某一场比赛实际生效的局制（总决赛 / 加赛局 / 升格后的目标局数会覆盖阶段默认值）
  E.fmtOfMatch = function (t, stage, m) {
    // 团体赛：场数 / 达标线都跟具体两支队伍的人头数有关，所以必须带 match
    if (E.teamOn(t)) return E.teamFmtOf(t, m, stage);
    var f = (m && m.isGF) ? E.gfFmtOf(t, stage, m.gfRound === 'reset') : E.fmtOf(t, stage);
    if (m && m.gfElev) {
      var need = E.gfElevNeed(m);
      f = normFmt(Object.assign({}, f, {
        winNeeded: need,
        gamesPerMatch: Math.max(parseInt(f.gamesPerMatch, 10) || 1, need * 2 - 1)
      }));
    }
    return f;
  };

  // 供界面显示：本阶段是否使用独立设置
  E.stageOverrides = function (stage) {
    return {
      format: !!(stage && stage.useFormat),
      scoring: !!(stage && stage.useScoring)
    };
  };

  /* =========================================================
     一、局制：单场进度与胜负判定
     ========================================================= */
  E.progress = function (match) {
    var ga = 0, gb = 0, d = 0;
    (match.games || []).forEach(function (g) {
      if (g.w === 'A') ga++; else if (g.w === 'B') gb++; else d++;
    });
    return { a: ga, b: gb, d: d, played: (match.games || []).length };
  };

  /* ---- 回合（v1.14.0）：一场比赛可以分若干回合，每回合用同一套局制 ---- */
  // 回合数（1 = 不分回合）
  E.setCount = function (fmt) {
    return Math.max(1, parseInt(fmt && fmt.sets, 10) || 1);
  };

  // 某个回合内的进度（每局记在 g.s 上，缺省视为第 1 回合）
  E.progressSet = function (match, si) {
    var a = 0, b = 0, d = 0, n = 0;
    (match.games || []).forEach(function (g) {
      if ((parseInt(g.s, 10) || 0) !== si) return;
      n++;
      if (g.w === 'A') a++; else if (g.w === 'B') b++; else d++;
    });
    return { a: a, b: b, d: d, played: n };
  };

  // 这一回合是否已经打完（赢够局数 或 局数打满；加赛制下平分不算打完）
  E.setDone = function (match, si, fmt, tie) {
    var p = E.progressSet(match, si);
    var N = Math.max(1, parseInt(fmt.gamesPerMatch, 10) || 1);
    var M = Math.max(0, parseInt(fmt.winNeeded, 10) || 0);
    if (M > 0) return (p.a >= M || p.b >= M);
    if (p.played < N) return false;
    if (tie === 'sudden_death' && p.a === p.b) return false;
    return true;
  };

  // 这一回合的胜方（null = 未定 / 平局）
  E.setWinnerOf = function (match, si, fmt, tie) {
    var p = E.progressSet(match, si);
    var M = Math.max(0, parseInt(fmt.winNeeded, 10) || 0);
    if (M > 0) return p.a >= M ? 'A' : (p.b >= M ? 'B' : null);
    if (!E.setDone(match, si, fmt, tie)) return null;
    if (p.a > p.b) return 'A';
    if (p.b > p.a) return 'B';
    return null;
  };

  // 需要赢下几个回合（0 配置时取过半）
  E.setsNeeded = function (fmt) {
    var S = E.setCount(fmt);
    var n = parseInt(fmt && fmt.setsToWin, 10) || 0;
    if (!(n > 0)) n = Math.floor(S / 2) + 1;
    return Math.min(S, Math.max(1, n));
  };

  // 当前该录入第几个回合（已打完的回合自动跳过）
  E.curSet = function (match, fmt, tie) {
    var S = E.setCount(fmt);
    for (var i = 0; i < S; i++) {
      if (!E.setDone(match, i, fmt, tie)) return i;
    }
    return S - 1;
  };

  // 各回合的胜方
  E.setWinners = function (match, fmt, tie) {
    var S = E.setCount(fmt), out = [];
    for (var i = 0; i < S; i++) out.push(E.setWinnerOf(match, i, fmt, tie));
    return out;
  };

  /**
   * 团体赛的胜负判定（fmt.team = true 时由 E.evaluate 转进来）
   *   一桌 = 双方各一名队员的一场对局，这一桌谁赢由记录上的 w 直接给出（桌内局分只进小分）
   *   nvn            全部桌打完 → 比赢下的桌数，多者胜，相等按平局规则处理
   *   conquest / kof 先达到 teamNeed 的一方直接获胜
   *                   conquest：本方所有上场队员都各赢下一桌才达标
   *                   kof     ：把对方上场队员全部击败才达标
   *   大比分 gamesA / gamesB = 赢下的桌数
   */
  E.evaluateTeam = function (match, fmt, tie) {
    var S = Math.max(1, parseInt(fmt.sets, 10) || 1);      // 这一场团体赛一共打几场对局
    var tables = E.teamTablesOf(match);

    if (match.isBye) {
      match.result = {
        winner: match.playerA ? 'A' : (match.playerB ? 'B' : null),
        gamesA: 0, gamesB: 0, draws: 0, bye: true, team: true,
        setsA: 0, setsB: 0, setWinners: [], rounds: S, roundsDone: 0, tables: S
      };
      match.decided = true; match.overtime = false;
      return match.result;
    }
    var touched = tables.length > 0 || match.override === 'A' || match.override === 'B';
    if (!touched) {
      match.result = null;
      match.decided = false;
      match.overtime = false;
      return null;
    }

    var winsA = 0, winsB = 0, draws = 0;
    var setW = [];            // 每一场对局的胜方（按场次）
    var maxSi = -1;
    tables.forEach(function (u) {
      maxSi = Math.max(maxSi, u.s);
      if (u.w === 'A') winsA++;
      else if (u.w === 'B') winsB++;
      else draws++;
    });
    for (var si = 0; si <= Math.max(S, maxSi + 1) - 1; si++) {
      setW.push(E.teamRoundWinner(null, match, si));
    }

    var need = fmt.teamNeed || null;
    var winner = null, decided = false, overtime = false;
    var played = tables.length;

    function settle() {
      decided = true;
      if (winsA > winsB) winner = 'A';
      else if (winsB > winsA) winner = 'B';
      else if (tie === 'sudden_death') { decided = false; overtime = true; }
    }

    if (need) {
      if (winsA >= need.a && winsB >= need.b) settle();       // 只有人为改判才会两边同时达标
      else if (winsA >= need.a) { winner = 'A'; decided = true; }
      else if (winsB >= need.b) { winner = 'B'; decided = true; }
      else if (played >= S) settle();                        // 打满了还没人达标（有平桌）
    } else if (played >= S) {
      // nvn：所有桌都打完（含平桌）再比赢桌数
      settle();
    }
    if (match.override === 'A' || match.override === 'B') {
      winner = match.override; decided = true; overtime = false;
    }

    match.result = {
      winner: winner, gamesA: winsA, gamesB: winsB, draws: draws,
      settled: decided, setsA: winsA, setsB: winsB, setWinners: setW,
      team: true, rounds: S, tables: S, roundsDone: played,
      advA: 0, advB: 0
    };
    match.decided = decided;
    match.overtime = overtime;
    return match.result;
  };

  /**
   * 判定一场比赛当前状态
   * @param fmt {gamesPerMatch, winNeeded}
   * @param tie 'sudden_death' | 'draw_ok' | 'manual'
   * 若 match.gfAdv 存在（双败总决赛「让局」），该方开局先计 N 局，
   * 双方都以「先到 winNeeded 局」为胜（winNeeded 为 0 时取多数局）。
   */
  E.evaluate = function (match, fmt, tie) {
    // 团体赛：一桌 = 一场对局，胜负按赢下的桌数 / 全员出线判定
    if (fmt && fmt.team) return E.evaluateTeam(match, fmt, tie);
    // 多回合：走独立的判定（回合 > 1 时才有区别，回合 = 1 完全沿用下面的老逻辑）
    if (E.setCount(fmt) > 1) return E.evaluateSets(match, fmt, tie);
    var p = E.progress(match);
    var N = Math.max(1, parseInt(fmt.gamesPerMatch, 10) || 1);
    var M = Math.max(0, parseInt(fmt.winNeeded, 10) || 0);
    var winner = null, decided = false, overtime = false;

    // 让局（先计局数）
    var advA = 0, advB = 0;
    if (match.gfAdv && match.gfAdv.games > 0) {
      if (match.gfAdv.side === 'A') advA = match.gfAdv.games; else advB = match.gfAdv.games;
    }
    var ea = p.a + advA, eb = p.b + advB;

    if (match.isBye) {
      match.result = { winner: match.playerA ? 'A' : (match.playerB ? 'B' : null), gamesA: 0, gamesB: 0, draws: 0, bye: true };
      match.decided = true; match.overtime = false;
      return match.result;
    }

    // 一局未打且没有裁判判定：视为「未开始」，不产生成绩
    // （否则会被统计成一场 0:0 的平局，白送积分）
    var touched = p.played > 0 || match.override === 'A' || match.override === 'B';
    if (!touched) {
      match.result = null;
      match.decided = false;
      match.overtime = false;
      return null;
    }

    if (match.gfAdv) {
      // 让局制：双方都「先到 need 局」（含先计局）
      var need = (M > 0) ? M : (Math.floor(N / 2) + 1);
      if (ea >= need) { winner = 'A'; decided = true; }
      else if (eb >= need) { winner = 'B'; decided = true; }
    } else {
      // 可升格决赛：一场定胜负、比分累计。败者组冠军先到 base 局 → 目标升到 up。
      // 胜者组冠军「率先」到 base 时目标仍是 base，直接夺冠，不升格。
      if (match.gfElev) {
        var eNeed = E.gfElevNeed(match);
        if (eNeed > 0) M = eNeed;
      }
      if (M > 0) {
        if (p.a >= M) { winner = 'A'; decided = true; }
        else if (p.b >= M) { winner = 'B'; decided = true; }
      }
      if (!decided && p.played >= N) {
        if (p.a > p.b) { winner = 'A'; decided = true; }
        else if (p.b > p.a) { winner = 'B'; decided = true; }
        else {
          if (tie === 'sudden_death') { decided = false; overtime = true; winner = null; }
          else { decided = true; winner = null; }  // 平局（draw_ok / manual）
        }
      }
    }
    if (match.override === 'A' || match.override === 'B') { winner = match.override; decided = true; overtime = false; }

    match.result = {
      winner: winner, gamesA: p.a, gamesB: p.b, draws: p.d, settled: decided,
      advA: advA, advB: advB
    };
    match.decided = decided;
    match.overtime = overtime;
    return match.result;
  };

  /**
   * 多回合比赛的判定（回合数 > 1 时由 E.evaluate 转进来）
   * 一场 = sets 个回合，每个回合打同一套局制；
   * setRule 决定整场胜负：
   *   sets   赢下回合数（三回合两胜）→ 大比分 = 回合比分
   *   games  总大比分（各回合赢局相加）→ 大比分 = 总赢局
   *   points 总得分（各回合小分相加）→ 大比分 = 总得分
   */
  E.evaluateSets = function (match, fmt, tie) {
    var S = E.setCount(fmt);
    var setsA = 0, setsB = 0, totA = 0, totB = 0, totD = 0, ptsA = 0, ptsB = 0;
    var setW = [], i;

    for (i = 0; i < S; i++) {
      var ps = E.progressSet(match, i);
      totA += ps.a; totB += ps.b; totD += ps.d;
      var w = E.setWinnerOf(match, i, fmt, tie);
      setW.push(w);
      if (w === 'A') setsA++; else if (w === 'B') setsB++;
    }
    (match.games || []).forEach(function (g) {
      if (typeof g.a === 'number' && isFinite(g.a)) ptsA += g.a;
      if (typeof g.b === 'number' && isFinite(g.b)) ptsB += g.b;
    });

    if (match.isBye) {
      match.result = {
        winner: match.playerA ? 'A' : (match.playerB ? 'B' : null),
        gamesA: 0, gamesB: 0, draws: 0, bye: true, setsA: 0, setsB: 0, setWinners: []
      };
      match.decided = true; match.overtime = false;
      return match.result;
    }

    var played = (match.games || []).length;
    var touched = played > 0 || match.override === 'A' || match.override === 'B';
    if (!touched) {
      match.result = null;
      match.decided = false;
      match.overtime = false;
      return null;
    }

    var rule = fmt.setRule || 'sets';
    var needSets = E.setsNeeded(fmt);
    var allDone = true;
    for (i = 0; i < S; i++) { if (!E.setDone(match, i, fmt, tie)) { allDone = false; break; } }

    var winner = null, decided = false, overtime = false;
    if (rule === 'games') {
      if (allDone) {
        decided = true;
        if (totA > totB) winner = 'A';
        else if (totB > totA) winner = 'B';
        else if (tie === 'sudden_death') { decided = false; overtime = true; }
      }
    } else if (rule === 'points') {
      if (allDone) {
        decided = true;
        if (ptsA > ptsB) winner = 'A';
        else if (ptsB > ptsA) winner = 'B';
        else if (tie === 'sudden_death') { decided = false; overtime = true; }
      }
    } else {
      if (setsA >= needSets) { winner = 'A'; decided = true; }
      else if (setsB >= needSets) { winner = 'B'; decided = true; }
      else if (allDone) {
        decided = true;
        if (setsA > setsB) winner = 'A';
        else if (setsB > setsA) winner = 'B';
        else if (totA !== totB) winner = (totA > totB) ? 'A' : 'B';
        else if (tie === 'sudden_death') { decided = false; overtime = true; }
      }
    }
    if (match.override === 'A' || match.override === 'B') {
      winner = match.override; decided = true; overtime = false;
    }

    // 大比分跟随判定口径，保证界面上的「几比几」和晋级依据一致
    var ga, gb;
    if (rule === 'games') { ga = totA; gb = totB; }
    else if (rule === 'points') { ga = ptsA; gb = ptsB; }
    else { ga = setsA; gb = setsB; }

    match.result = {
      winner: winner, gamesA: ga, gamesB: gb, draws: totD, settled: decided,
      setsA: setsA, setsB: setsB, setWinners: setW, rawGamesA: totA, rawGamesB: totB,
      pointsA: ptsA, pointsB: ptsB, setRule: rule, sets: S,
      advA: 0, advB: 0
    };
    match.decided = decided;
    match.overtime = overtime;
    return match.result;
  };

  // 是否允许继续录入一局
  E.canAddGame = function (match, fmt, tie) {
    if (match.isBye) return false;
    if (match.override) return false;
    // 团体赛：一桌 = 一场对局，只要还有没打的桌就能继续录（整场已定则停）；
    // 平分需要加赛时允许再多打几桌把胜负打出来
    if (fmt && fmt.team) {
      if (match.result && match.result.settled) return false;
      var S1 = Math.max(1, parseInt(fmt.sets, 10) || 1);
      return E.teamTablesOf(match).length < S1 + 3;
    }
    var p = E.progress(match);

    // 多回合：只能录还没打完的那个回合；整场已分出胜负则不能再录
    if (E.setCount(fmt) > 1) {
      var S = E.setCount(fmt), cur = -1, i;
      for (i = 0; i < S; i++) {
        if (!E.setDone(match, i, fmt, tie)) { cur = i; break; }
      }
      if (cur < 0) return false;
      if ((fmt.setRule || 'sets') === 'sets') {
        var need = E.setsNeeded(fmt), sA = 0, sB = 0;
        for (i = 0; i < S; i++) {
          var w = E.setWinnerOf(match, i, fmt, tie);
          if (w === 'A') sA++; else if (w === 'B') sB++;
        }
        if (sA >= need || sB >= need) return false;
      }
      return true;
    }

    if (match.gfAdv) {
      var advA = 0, advB = 0;
      if (match.gfAdv.games > 0) {
        if (match.gfAdv.side === 'A') advA = match.gfAdv.games; else advB = match.gfAdv.games;
      }
      var N0 = Math.max(1, parseInt(fmt.gamesPerMatch, 10) || 1);
      var M0 = Math.max(0, parseInt(fmt.winNeeded, 10) || 0);
      var need = (M0 > 0) ? M0 : (Math.floor(N0 / 2) + 1);
      if (p.a + advA >= need || p.b + advB >= need) return false;
      var cap = (need - advA) + (need - advB) - 1;
      return p.played < cap;
    }

    if (match.gfElev) {
      // 可升格决赛：达到（含升格后的）目标即停；否则可以一直往下打
      var eN = E.gfElevNeed(match);
      if (eN > 0) {
        if (p.a >= eN || p.b >= eN) return false;
        return true;
      }
    }

    if (p.played < fmt.gamesPerMatch) return true;
    // 已达满局数：仅当处于加赛（平局且 sudden_death）时可继续
    if (tie === 'sudden_death') {
      if (p.a === p.b) return true;
    }
    return false;
  };

  // 本场最多还要打几局（让局制下双方上限不同，取合计）
  E.matchMaxGames = function (match, fmt) {
    fmt = fmt || {};
    var N = Math.max(1, parseInt(fmt.gamesPerMatch, 10) || 1);
    var M = Math.max(0, parseInt(fmt.winNeeded, 10) || 0);
    var S = E.setCount(fmt);
    // 团体赛：一「局」= 一场对局，最多打「场数」那么多场
    if (fmt.team) return Math.max(1, parseInt(fmt.sets, 10) || 1);
    if (S > 1) {
      var per = M > 0 ? (M * 2 - 1) : N;
      return per * S;
    }
    if (match && match.gfAdv) {
      var advA = 0, advB = 0;
      if (match.gfAdv.games > 0) {
        if (match.gfAdv.side === 'A') advA = match.gfAdv.games; else advB = match.gfAdv.games;
      }
      var need = (M > 0) ? M : (Math.floor(N / 2) + 1);
      return Math.max(1, (need - advA) + (need - advB) - 1);
    }
    if (match && match.gfElev) return Math.max(1, (match.gfElev.up || 1) * 2 - 1);
    return M > 0 ? (M * 2 - 1) : N;
  };

  /* =========================================================
     二、记分规则：一名选手从一场比赛中获得的积分
     ========================================================= */
  E.pointsFrom = function (match, side, sc, fmt) {
    if (match.isBye) return sc.bye;
    if (!match.result) return 0;
    var r = match.result;
    if (r.settled === false) return 0;   // 未定案不给分
    var mode = sc.mode || 'result';

    if (mode === 'formula') {
      var won = (r.winner === side) ? 1 : 0;
      var drew = (r.winner === null) ? 1 : 0;
      var lost = (r.winner && r.winner !== side) ? 1 : 0;
      var mine = (side === 'A') ? r.gamesA : r.gamesB;
      var theirs = (side === 'A') ? r.gamesB : r.gamesA;
      var sa = 0, sb = 0;
      (match.games || []).forEach(function (g) {
        if (typeof g.a === 'number' && isFinite(g.a)) sa += g.a;
        if (typeof g.b === 'number' && isFinite(g.b)) sb += g.b;
      });
      var myPts = (side === 'A') ? sa : sb;
      var opPts = (side === 'A') ? sb : sa;
      return E.evalFormula(sc.formula || 'w*3+d', {
        w: won, d: drew, l: lost,
        gw: mine, gl: theirs, gd: mine - theirs,
        pa: myPts, pb: opPts
      });
    }
    if (mode === 'scoreline') {
      // 按大比分逐档设分：把本场大比分归一化成「大数-小数」后查表
      // 计时器到点 / 中途结束的比赛先查「未打完」档（u: 前缀），
      // 没有单独设置时退回同一比分档位，再退回胜负平兜底分值
      var tbl = sc.scoreTable || {};
      var my = (side === 'A') ? r.gamesA : r.gamesB;
      var op = (side === 'A') ? r.gamesB : r.gamesA;
      var row = null;
      if (r.unfinished) row = tbl['u:' + E.scoreKey(my, op)] || null;
      if (!row) row = tbl[E.scoreKey(my, op)];
      if (row) {
        if (r.winner === null) return parseFloat(row.d) || 0;            // 平局比分：双方各得
        return (r.winner === side) ? (parseFloat(row.w) || 0) : (parseFloat(row.l) || 0);
      }
      // 表里没有这一档（例如后来改过局制）→ 回退到胜负平兜底分值
      if (r.winner === null) return parseFloat(sc.draw) || 0;
      return (r.winner === side) ? (parseFloat(sc.win) || 0) : (parseFloat(sc.lose) || 0);
    }
    if (mode === 'games') {
      // 按赢下局数计分
      var won = (side === 'A') ? r.gamesA : r.gamesB;
      return won * (parseFloat(sc.perGame) || 1);
    }
    if (mode === 'points') {
      // 团体赛：大比分单位是「场」，个人小局只进小分 → 这里按场分累加
      if (fmt && fmt.team) return (side === 'A') ? (r.gamesA || 0) : (r.gamesB || 0);
      // 按小分累加
      var sum = 0;
      (match.games || []).forEach(function (g) {
        var v = (side === 'A') ? g.a : g.b;
        if (typeof v === 'number' && !isNaN(v)) sum += v;
      });
      return sum;
    }
    // result：胜负平
    if (r.winner === null) return sc.draw;
    if (r.winner === side) return sc.win;
    return sc.lose;
  };

  /* =========================================================
     二之一、大比分档位（scoreline 模式）
     —— 枚举当前局制下所有可能出现的最终比分，逐个设分
     ========================================================= */

  // 把 A:B 归一化为「大数-小数」的档位 key（2:0 与 0:2 视为同一档）
  E.scoreKey = function (a, b) {
    var x = Math.max(0, parseInt(a, 10) || 0);
    var y = Math.max(0, parseInt(b, 10) || 0);
    return (x >= y) ? (x + '-' + y) : (y + '-' + x);
  };

  /**
   * 枚举当前局制下所有可能的最终大比分
   * @param fmt {gamesPerMatch, winNeeded}
   * @param tie 'sudden_death' | 'draw_ok' | 'manual' | null（null = 允许平局）
   * @return [{a, b, key, draw}]  已按 a 降序（a 为胜方局数，a >= b）
   */
  E.scoreLines = function (fmt, tie) {
    fmt = fmt || {};
    var N = Math.max(1, parseInt(fmt.gamesPerMatch, 10) || 1);
    var M = Math.max(0, parseInt(fmt.winNeeded, 10) || 0);
    var out = [];

    if (M > 0) {
      // 先赢 M 局即结束：胜方恰好 M 局，负方 0 ~ M-1 局
      for (var l = 0; l <= M - 1; l++) {
        out.push({ a: M, b: l, key: M + '-' + l, draw: false });
      }
      // 决胜制下理论上不会出现平局；若裁判手动判定，按 M-M 处理不了，忽略
      return out;
    }

    // 打满 N 局：按总局数枚举，归一化为 a >= b
    var allowDraw = (tie !== 'sudden_death');
    for (var a = N; a >= 0; a--) {
      var b = N - a;
      if (b > a) continue;               // 同一形态只保留一次
      if (a === b && !allowDraw) continue; // 加赛制下平局不会成为最终比分
      out.push({ a: a, b: b, key: a + '-' + b, draw: (a === b) });
    }
    return out;
  };

  // 某一档位当前的设置；未设置时回退到「兜底分值」，保证界面显示与实际计分一致
  E.scoreRow = function (tbl, key, isDraw, sc) {
    var r = (tbl || {})[key];
    if (r) return r;
    sc = sc || {};
    var nz = function (v, def) { return (v === undefined || v === null || v === '') ? def : v; };
    return isDraw
      ? { d: nz(sc.draw, 1) }
      : { w: nz(sc.win, 3), l: nz(sc.lose, 0) };
  };

  /**
   * 枚举「未打完」的大比分档位（计时器到点 / 中途结束比赛）
   *   —— 这些比分正常情况下不会成为最终比分，但提前结束时真的会出现，
   *      所以大比分设置里必须能单独设分。
   * @return [{a, b, key, draw, lead}]  key 形如 "u:1-0"，a >= b（a 为领先方局数）
   */
  E.scoreUnfinishedLines = function (fmt) {
    fmt = fmt || {};
    var N = Math.max(1, parseInt(fmt.gamesPerMatch, 10) || 1);
    var M = Math.max(0, parseInt(fmt.winNeeded, 10) || 0);
    // 单方在「没打完」的前提下最多能拿到几局
    var hi = (M > 0) ? (M - 1) : (N - 1);
    var out = [], seen = {};
    for (var a = hi; a >= 0; a--) {
      for (var b = a; b >= 0; b--) {
        if (a + b >= N) continue;         // 打满局数就不算「未打完」了
        var k = a + '-' + b;
        if (seen[k]) continue;
        seen[k] = 1;
        out.push({ a: a, b: b, key: 'u:' + k, draw: (a === b), lead: (a > b) });
      }
    }
    out.sort(function (p, q) {
      if (q.a !== p.a) return q.a - p.a;
      return q.b - p.b;
    });
    return out;
  };

  /* =========================================================
     二之二、自定义公式求值器（不使用 eval，兼容严格 CSP）
     支持：数字、变量、+ - * / % ^、一元正负、括号
     ========================================================= */
  E.evalFormula = function (expr, vars) {
    var s = String(expr === undefined ? '' : expr);
    var pos = 0;

    function skip() { while (pos < s.length && (s[pos] === ' ' || s[pos] === '\t')) pos++; }
    function parseExpr() {
      var v = parseTerm();
      for (;;) {
        skip();
        var c = s[pos];
        if (c === '+' || c === '-') { pos++; var r = parseTerm(); v = (c === '+') ? (v + r) : (v - r); }
        else break;
      }
      return v;
    }
    function parseTerm() {
      var v = parseUnary();
      for (;;) {
        skip();
        var c = s[pos];
        if (c === '*' || c === '/' || c === '%') {
          pos++; var r = parseUnary();
          if (c === '*') v = v * r;
          else if (c === '/') v = (r === 0 ? 0 : v / r);
          else v = (r === 0 ? 0 : v % r);
        } else break;
      }
      return v;
    }
    function parseUnary() {
      skip();
      if (s[pos] === '-') { pos++; return -parseUnary(); }
      if (s[pos] === '+') { pos++; return parseUnary(); }
      return parsePower();
    }
    function parsePower() {
      var v = parseAtom();
      skip();
      if (s[pos] === '^') { pos++; v = Math.pow(v, parseUnary()); }
      return v;
    }
    function parseAtom() {
      skip();
      var c = s[pos];
      if (c === '(') {
        pos++;
        var v = parseExpr();
        skip();
        if (s[pos] === ')') pos++;
        return v;
      }
      var m = /^[0-9]*\.?[0-9]+/.exec(s.slice(pos));
      if (m) { pos += m[0].length; return parseFloat(m[0]); }
      var m2 = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(pos));
      if (m2) {
        var name = m2[0]; pos += m2[0].length;
        var val = vars[name];
        return (typeof val === 'number' && isFinite(val)) ? val : 0;
      }
      pos++;
      return 0;
    }

    var out;
    try { out = parseExpr(); }
    catch (e) { return 0; }
    return (typeof out === 'number' && isFinite(out)) ? out : 0;
  };

  // 公式合法性校验（用于界面即时提示，不阻塞输入）
  E.validateFormula = function (expr) {
    var s = String(expr === undefined ? '' : expr).trim();
    if (!s) return { ok: false, msg: '公式不能为空' };
    if (!/^[0-9A-Za-z_+\-*/%^()\s.]+$/.test(s)) {
      return { ok: false, msg: '包含不支持的字符（仅允许数字、变量、+ - * / % ^ 与括号）' };
    }
    var depth = 0, i;
    for (i = 0; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') { depth--; if (depth < 0) return { ok: false, msg: '括号不匹配' }; }
    }
    if (depth !== 0) return { ok: false, msg: '括号不匹配' };

    var known = {};
    (E.FORMULA_VARS || []).forEach(function (v) { known[v.k] = 1; });
    var re = /[A-Za-z_][A-Za-z0-9_]*/g, m;
    while ((m = re.exec(s)) !== null) {
      if (!known[m[0]]) return { ok: false, msg: '未知变量「' + m[0] + '」，可用：' + Object.keys(known).join(', ') };
    }
    return { ok: true, msg: '公式可用' };
  };

  // 公式可用变量说明（用于界面提示）
  E.FORMULA_VARS = [
    { k: 'w', d: '本场胜（1/0）' },
    { k: 'd', d: '本场平（1/0）' },
    { k: 'l', d: '本场负（1/0）' },
    { k: 'gw', d: '本场赢下局数' },
    { k: 'gl', d: '本场输掉局数' },
    { k: 'gd', d: '净胜局数' },
    { k: 'pa', d: '本人小分合计' },
    { k: 'pb', d: '对手小分合计' }
  ];

  /* =========================================================
     三、统计与排名
     ========================================================= */
  /* ---- 警告 / 判负（v2.3）----
     一场比赛里双方各自可以被记若干次「警告」与「判负」。
     它们不改变这一场的胜负（胜负仍由比分决定），只作为纪律记录累计到选手身上，
     并在破同（小分）里用：先比判负次数、再比警告次数，都是「越少越靠前」。
       m.pen = { a: { warn: 0, forfeit: 0 }, b: { warn: 0, forfeit: 0 } } */
  E.penOf = function (m) {
    var p = (m && m.pen) || {};
    function g(o, k) {
      var n = parseInt(o && o[k], 10);
      return (isNaN(n) || n < 0) ? 0 : n;
    }
    return {
      a: { warn: g(p.a, 'warn'), forfeit: g(p.a, 'forfeit') },
      b: { warn: g(p.b, 'warn'), forfeit: g(p.b, 'forfeit') }
    };
  };
  // 设置某一方某项的次数：kind = 'warn'（警告）| 'forfeit'（判负）
  E.penSet = function (m, side, kind, val) {
    if (!m) return { ok: false, msg: '未找到该场比赛' };
    if (side !== 'a' && side !== 'b') return { ok: false, msg: '只能给 A / B 两方记警告判负' };
    if (kind !== 'warn' && kind !== 'forfeit') return { ok: false, msg: '类型只能是警告或判负' };
    var n = parseInt(val, 10);
    if (isNaN(n) || n < 0) n = 0;
    if (n > 99) n = 99;
    var p = E.penOf(m);
    p[side][kind] = n;
    m.pen = p;
    return { ok: true, quiet: true, pen: p };
  };
  // 一场比赛有没有记过警告 / 判负（界面用来决定要不要显示徽标）
  E.penAny = function (m) {
    var p = E.penOf(m);
    return !!(p.a.warn || p.a.forfeit || p.b.warn || p.b.forfeit);
  };

  /**
   * @param scope {stage, groupIdx, playerIds}
   * @param upToRound 仅统计到第 N 轮（含），undefined = 全部
   * @return { [playerId]: stat }
   */
  E.buildStats = function (t, stage, scopePlayerIds, groupIdx, upToRound) {
    var stats = {}, i, j;
    var fmt = E.fmtOf(t, stage), sc = E.scOf(t, stage);
    // 继承上一阶段（积分 + 可选小分）。比例 0 时不带任何东西。
    var inh = null;
    if (stage.inherit && stage.inherit.enabled) {
      var pst = E.stageFinalStats(t, stage.index - 1);
      if (pst) {
        inh = {
          map: pst,
          ratio: (parseFloat(stage.inherit.ratio) || 0) / 100,
          tie: !!stage.inherit.tie
        };
      }
    }
    var r2 = function (v) { return Math.round((parseFloat(v) || 0) * 100) / 100; };

    scopePlayerIds.forEach(function (id) {
      var pl = t.players.filter(function (x) { return x.id === id; })[0] || {};
      var init = parseFloat(pl.initialScore) || 0;
      // 上一阶段「提前晋级」奖励分：进入本阶段时直接计入积分
      var cBonus = (stage.carryBonus && stage.carryBonus[id]) ? (parseFloat(stage.carryBonus[id]) || 0) : 0;
      // 继承来的「全部小分」，按同一比例折算：
      //   累计小分 / 净小分 / 赢局 / 输局 / 净胜局 / 对手分 / 累进分
      var bc = 0, bgw = 0, bgl = 0, bbu = 0, bcd = 0, bpg = 0;
      if (inh && inh.tie) {
        var pv = inh.map[id] || {};
        bc = r2((parseFloat(pv.cumulative) || 0) * inh.ratio);
        bgw = r2((parseFloat(pv.gamesWon) || 0) * inh.ratio);
        bgl = r2((parseFloat(pv.gamesLost) || 0) * inh.ratio);
        bbu = r2((parseFloat(pv.buchholz) || 0) * inh.ratio);
        bcd = r2((parseFloat(pv.cumDiff) || 0) * inh.ratio);
        bpg = r2((parseFloat(pv.progressive) || 0) * inh.ratio);
      }
      stats[id] = {
        id: id,
        points: init + cBonus,                      // 初始携带分 + 提前晋级奖励
        carryBonus: cBonus,
        matches: 0, wins: 0, draws: 0, losses: 0, byes: 0,
        // 赢局 / 输局 / 累计小分都从继承值起步，再叠加本阶段实际战绩
        gamesWon: bgw, gamesLost: bgl, gamesDiff: r2(bgw - bgl), cumulative: bc,
        // 本阶段自己打出的小分（净小分要用「本阶段」的对手小分来算，避免继承值互相干扰）
        ownCum: 0,
        // 继承来的小分原值（不含本阶段，用于跨阶段净小分 / 累进分累加）
        carryCum: bc, carryGamesWon: bgw, carryGamesLost: bgl, carryBuchholz: bbu,
        carryCumDiff: bcd, carryProgressive: bpg,
        // 累进分：每轮结束后「当时累计积分」的总和（第 0 轮记初始分），继承时在此之上继续累加
        progressive: r2(init + cBonus + bpg),
        stagePoints: 0,   // 上一阶段得分（用于跨阶段破同）
        // 逐阶段得分（v2.3）：{'0': 第1阶段分, ...}，只有 tieOrder 里用到时才填
        stagePts: null,
        // 纪律记录（v2.3）：警告 / 判负次数，越少越靠前
        warnings: 0, forfeits: 0,
        seed: pl.seed || 0,
        opponents: [], carry: 0
      };
    });

    var rounds = stage.roundsData || [];
    for (i = 0; i < rounds.length; i++) {
      if (upToRound !== undefined && upToRound !== null && rounds[i].index > upToRound) continue;
      var ms = rounds[i].matches || [];
      for (j = 0; j < ms.length; j++) {
        var m = ms[j];
        if (groupIdx !== null && groupIdx !== undefined && m.group !== groupIdx) continue;
        // 警告 / 判负累计（v2.3）：只做纪律记录，不改本场胜负；
        // 还没定案的比赛也照记（裁判常常边打边记）
        var pn = E.penOf(m);
        if (pn.a.warn || pn.a.forfeit || pn.b.warn || pn.b.forfeit) {
          var pa0 = stats[m.playerA], pb0 = stats[m.playerB];
          if (pa0) { pa0.warnings += pn.a.warn; pa0.forfeits += pn.a.forfeit; }
          if (pb0) { pb0.warnings += pn.b.warn; pb0.forfeits += pn.b.forfeit; }
        }
        if (!m.result) continue;
        // 未定案（打了部分局但还没分出胜负 / 加赛中）不计入任何成绩
        if (m.result.settled === false && !m.isBye) continue;
        var A = m.playerA, B = m.playerB;
        var sa = stats[A], sb = stats[B];

        // 轮空（含历史数据中「对手为空」的旧格式）：直接判定为获胜
        if (m.isBye || !A || !B) {
          var alone = A || B;
          if (stats[alone]) {
            stats[alone].points += E.pointsFrom(m, (alone === A ? 'A' : 'B'), sc, fmt);
            stats[alone].byes += 1;
            stats[alone].matches += 1;   // 轮空计入已赛场次
            stats[alone].wins += 1;      // 轮空按一场胜利计入
          }
          continue;
        }
        if (!sa || !sb) continue;
        // 「平局判为双方都输」：本阶段的平局不分胜负，双方都按「负」计分、各记一场负
        var drawAsLose = !!(stage && stage.drawBothLose) && m.result.winner === null
          && m.result.settled !== false;
        var pa, pb;
        if (drawAsLose) {
          // 造一个「双方都输」的虚拟结果去取分，
          // 这样胜负平 / 公式 / 大比分档三种记分口径都自动一致
          var mmA = Object.assign({}, m, { result: Object.assign({}, m.result, { winner: 'B' }) });
          var mmB = Object.assign({}, m, { result: Object.assign({}, m.result, { winner: 'A' }) });
          pa = E.pointsFrom(mmA, 'A', sc, fmt);
          pb = E.pointsFrom(mmB, 'B', sc, fmt);
        } else {
          pa = E.pointsFrom(m, 'A', sc, fmt);
          pb = E.pointsFrom(m, 'B', sc, fmt);
        }
        sa.points += pa; sb.points += pb;
        sa.matches += 1; sb.matches += 1;
        sa.gamesWon += m.result.gamesA; sa.gamesWon += 0;
        sa.gamesLost += m.result.gamesB;
        sb.gamesWon += m.result.gamesB;
        sb.gamesLost += m.result.gamesA;
        sa.gamesDiff = sa.gamesWon - sa.gamesLost;
        sb.gamesDiff = sb.gamesWon - sb.gamesLost;

        // 累计小分（同时记一份「本阶段」口径，供净小分使用）
        (m.games || []).forEach(function (g) {
          if (typeof g.a === 'number') { sa.cumulative += g.a; sa.ownCum += g.a; }
          if (typeof g.b === 'number') { sb.cumulative += g.b; sb.ownCum += g.b; }
        });

        if (sa.opponents.indexOf(B) < 0) sa.opponents.push(B);
        if (sb.opponents.indexOf(A) < 0) sb.opponents.push(A);

        if (m.result.winner === 'A') { sa.wins += 1; sb.losses += 1; }
        else if (m.result.winner === 'B') { sb.wins += 1; sa.losses += 1; }
        else if (drawAsLose) { sa.losses += 1; sb.losses += 1; }
        else { sa.draws += 1; sb.draws += 1; }
      }

      // 累进分：本轮全部结束后，把每人「当时的累计积分」再加一遍
      Object.keys(stats).forEach(function (id) {
        stats[id].progressive += stats[id].points;
      });
    }

    // Buchholz：对手的本赛段积分总和（轮空不计）；继承时叠加上一阶段的对手分
    Object.keys(stats).forEach(function (id) {
      var s = stats[id], sum = 0;
      s.opponents.forEach(function (o) { if (stats[o]) sum += stats[o].points; });
      s.buchholz = sum + (s.carryBuchholz || 0);
    });

    // 净小分：本人累计小分 − 所有对手累计小分之和
    //   继承时用「本阶段小分口径」算，再叠加继承来的净小分，
    //   否则双方都带进来的继承值互相抵消会把上一阶段的净小分吃掉
    Object.keys(stats).forEach(function (id) {
      var s = stats[id], opp = 0;
      s.opponents.forEach(function (o) { if (stats[o]) opp += (stats[o].ownCum || 0); });
      s.cumDiff = r2((s.ownCum || 0) - opp + (s.carryCumDiff || 0));
      s.gamesDiff = r2(s.gamesWon - s.gamesLost);
      s.progressive = r2(s.progressive);
    });

    // 上一阶段得分（破同用；首阶段为 0）
    if (stage.index > 0) {
      var prevPts = E.stageFinalPoints(t, stage.index - 1);
      if (prevPts) {
        Object.keys(stats).forEach(function (id) {
          stats[id].stagePoints = prevPts[id] || 0;
        });
      }
    }

    // 逐阶段得分（v2.3）：「第 N 阶段得分」可以分别作为独立破同依据。
    // 只在 tieOrder 里真的用到时才算（每个阶段都要重算一次完整统计，不必白花时间）。
    var wantSP = [];
    (sc.tieOrder || []).forEach(function (k) {
      var n = M.stageTieIdx(k);
      if (n >= 0 && n < stage.index && wantSP.indexOf(n) < 0) wantSP.push(n);
    });
    if (wantSP.length) {
      Object.keys(stats).forEach(function (id) { stats[id].stagePts = {}; });
      wantSP.forEach(function (n) {
        var pm = E.stageFinalPoints(t, n);
        if (!pm) return;
        Object.keys(stats).forEach(function (id) {
          if (stats[id].stagePts) stats[id].stagePts[n] = pm[id] || 0;
        });
      });
    }

    // 继承上一阶段分数（只带积分，不含小分）
    if (inh) {
      Object.keys(stats).forEach(function (id) {
        var v = (inh.map[id] && inh.map[id].points) || 0;
        stats[id].carry = r2(v * inh.ratio);
        stats[id].points += stats[id].carry;
      });
    }
    return stats;
  };

  /** 某阶段结束时的完整统计（积分 + 全部小分），用于「继承积分 / 继承小分」 */
  E.stageFinalStats = function (t, stageIndex) {
    if (!(stageIndex >= 0) || stageIndex >= t.stages.length) return null;
    var st = t.stages[stageIndex];
    if (!st.participants || !st.participants.length) return null;
    var scopeIds = st.participants.slice();
    var stats = E.buildStats(t, st, scopeIds, null);
    var out = {};
    scopeIds.forEach(function (id) {
      var s = stats[id];
      if (!s) {
        out[id] = {
          points: 0, cumulative: 0, cumDiff: 0, gamesWon: 0, gamesLost: 0,
          gamesDiff: 0, buchholz: 0, progressive: 0
        };
        return;
      }
      out[id] = {
        points: s.points,
        cumulative: s.cumulative,      // 累计小分
        cumDiff: s.cumDiff,            // 净小分
        gamesWon: s.gamesWon,          // 赢局
        gamesLost: s.gamesLost,        // 输局
        gamesDiff: s.gamesDiff,        // 净胜局
        buchholz: s.buchholz,          // 对手分
        progressive: s.progressive     // 累进分
      };
    });
    return out;
  };

  // 某阶段结束时的各选手积分（用于继承）
  E.stageFinalPoints = function (t, stageIndex) {
    var all = E.stageFinalStats(t, stageIndex);
    if (!all) return null;
    var out = {};
    Object.keys(all).forEach(function (id) { out[id] = all[id].points; });
    return out;
  };

  // 相互胜负矩阵
  E.buildH2H = function (t, stage, groupIdx, upToRound) {
    var map = {};
    var rounds = stage.roundsData || [];
    rounds.forEach(function (rd) {
      if (upToRound !== undefined && upToRound !== null && rd.index > upToRound) return;
      (rd.matches || []).forEach(function (m) {
        if (groupIdx !== null && groupIdx !== undefined && m.group !== groupIdx) return;
        if (!m.result || m.isBye) return;
        var A = m.playerA, B = m.playerB;
        if (!A || !B) return;
        var k = U.pairKey(A, B);
        if (!map[k]) map[k] = { a: A, b: B, aw: 0, bw: 0, ag: 0, bg: 0 };
        var e = map[k], fwd = (A < B);
        if (m.result.winner === 'A') { if (fwd) e.aw++; else e.bw++; }
        else if (m.result.winner === 'B') { if (fwd) e.bw++; else e.aw++; }
        if (fwd) { e.ag += m.result.gamesA; e.bg += m.result.gamesB; }
        else { e.ag += m.result.gamesB; e.bg += m.result.gamesA; }
      });
    });
    return map;
  };

  /** 取某个破同依据在选手统计上的数值（大者靠前；「越少越靠前」的项这里取负） */
  E.tieVal = function (s, key) {
    if (!s) return 0;
    switch (key) {
      case 'points': return s.points;
      case 'forfeit': return -(s.forfeits || 0);        // 判负越少越靠前（先比判负）
      case 'warnings': return -(s.warnings || 0);       // 再比警告
      case 'buchholz': return s.buchholz;
      case 'gamesDiff': return s.gamesDiff;
      case 'gamesWon': return s.gamesWon;
      case 'gamesLost': return -(s.gamesLost || 0);      // 输得越少越靠前
      case 'wins': return s.wins;
      case 'progressive': return s.progressive || 0;
      case 'cumulative': return s.cumulative;
      case 'cumDiff': return s.cumDiff || 0;
      case 'stagePoints': return s.stagePoints || 0;
      case 'seed': return -(s.seed || 9999);
      default:
        // 逐阶段得分：stageP<阶段下标>
        var spi = M.stageTieIdx(key);
        if (spi >= 0) return (s.stagePts && s.stagePts[spi]) || 0;
        return 0;
    }
  };

  // 按 tieOrder 生成比较器（sc 为阶段生效的记分配置）
  E.makeComparator = function (t, stats, h2h, sc) {
    sc = sc || E.scOf(t, null);
    // 允许为空数组：用户主动删除全部依据时表示「不比较，保持原顺序」
    var order = Array.isArray(sc.tieOrder) ? sc.tieOrder : M.defaultScoring().tieOrder;
    var manual = sc.manualOrder || {};
    var val = E.tieVal;

    return function (ia, ib) {
      var a = stats[ia], b = stats[ib];
      if (!a || !b) return 0;
      for (var i = 0; i < order.length; i++) {
        var key = order[i];
        if (key === 'h2h') {
          var k = U.pairKey(ia, ib);
          var e = h2h[k];
          if (e) {
            var aWins = (e.a === ia) ? e.aw : e.bw;
            var bWins = (e.a === ia) ? e.bw : e.aw;
            if (aWins !== bWins) return bWins - aWins;
          }
        } else if (key === 'manual') {
          var ma = manual[ia], mb = manual[ib];
          if (ma !== undefined && mb !== undefined && ma !== mb) return ma - mb;
        } else {
          var va = val(a, key), vb = val(b, key);
          if (va !== vb) return vb - va;
        }
      }
      return 0;
    };
  };

  /**
   * 计算排名
   * @param opts {stageIndex, groupIdx, includeEliminated}
   */
  E.standings = function (t, opts) {
    opts = opts || {};
    var si = (opts.stageIndex === undefined) ? t.currentStage : opts.stageIndex;
    var stage = t.stages[si];
    if (!stage) return [];

    var gi = (opts.groupIdx === undefined) ? null : opts.groupIdx;
    var ids;
    if (gi !== null && stage.groups) ids = stage.groups[gi].players.slice();
    else ids = (stage.participants || []).slice();

    var upTo = (opts.upToRound === undefined) ? null : opts.upToRound;
    var sc = E.scOf(t, stage);
    var stats = E.buildStats(t, stage, ids, gi, upTo);
    var h2h = E.buildH2H(t, stage, gi, upTo);
    var cmp = E.makeComparator(t, stats, h2h, sc);

    // ---- 提前晋级 / 提前淘汰：分层排序 ----
    // 第 0 层 = 已提前晋级（排在所有未定者之前）
    // 第 1 层 = 尚未确定
    // 第 2 层 = 已提前淘汰（排在最后）
    var ccfg = E.clinchCfg(stage);
    var useLayer = !!(ccfg.enabled && (ccfg.winTarget || ccfg.lossTarget));
    var clIds = stage.clinched || [], elIds = stage.eliminated || [];
    function layerOf(id) {
      if (!useLayer) return 1;
      var cr = stage.clinchRound ? stage.clinchRound[id] : undefined;
      var er = stage.elimRound ? stage.elimRound[id] : undefined;
      if (clIds.indexOf(id) >= 0) {
        // 查看「截至第 N 轮」时，当时还没锁定的不能算已晋级
        if (upTo !== null && upTo !== undefined && cr !== undefined && cr > upTo) return 1;
        return 0;
      }
      if (elIds.indexOf(id) >= 0) {
        if (upTo !== null && upTo !== undefined && er !== undefined && er > upTo) return 1;
        return 2;
      }
      return 1;
    }

    if (gi === null && upTo === null && stage.finalRank && stage.finalRank.length) {
      // 淘汰赛已结束：按 bracket 名次排序
      var fr = stage.finalRank;
      ids.sort(function (a, b) {
        var ia = fr.indexOf(a), ib = fr.indexOf(b);
        ia = ia < 0 ? 9999 : ia;
        ib = ib < 0 ? 9999 : ib;
        if (ia !== ib) return ia - ib;
        return cmp(a, b);
      });
    } else if (useLayer) {
      ids.sort(function (a, b) {
        var la = layerOf(a), lb = layerOf(b);
        if (la !== lb) return la - lb;
        if (la === 0) {
          // 同为提前晋级：越早锁定名次越靠前（0 负者先锁定）
          var ra = stage.clinchRound[a], rb = stage.clinchRound[b];
          ra = (ra === undefined || ra === null) ? 9999 : ra;
          rb = (rb === undefined || rb === null) ? 9999 : rb;
          if (ra !== rb) return ra - rb;
        } else if (la === 2) {
          // 同为提前淘汰：越晚被淘汰越靠前
          var ea = stage.elimRound[a], eb = stage.elimRound[b];
          ea = (ea === undefined || ea === null) ? 9999 : ea;
          eb = (eb === undefined || eb === null) ? 9999 : eb;
          if (ea !== eb) return eb - ea;
        }
        return cmp(a, b);
      });
    } else {
      ids.sort(cmp);
    }

    // 计算名次（同分同名次）；分层也算进名次键，否则跨层同分会显示成同一名次
    // v2.3：判负 / 警告若在破同依据里启用，也算进名次键 ——
    //       否则会出现「排序上分成先后、名次却都显示 1」的矛盾，进而让名次分档两头不一致。
    //       （逐阶段得分 / h2h / 种子只影响先后顺序，不参与「是否并列」的判定）
    var penKeys = ['forfeit', 'warnings'].filter(function (k) {
      return (sc.tieOrder || []).indexOf(k) >= 0;
    });
    var list = [], rank = 0, prevKey = null;
    ids.forEach(function (id, i) {
      var s = stats[id];
      var lyr = layerOf(id);
      var key = lyr + '|' + String(s.points) + '|' + String(s.buchholz) + '|' + String(s.gamesDiff) + '|' + String(s.cumulative);
      if (penKeys.length) {
        key += '|' + penKeys.map(function (k) { return String(E.tieVal(s, k)); }).join('|');
      }
      if (key !== prevKey) { rank = i + 1; prevKey = key; }
      var p = t.players.filter(function (x) { return x.id === id; })[0] || {};
      s.rank = rank;
      s.name = p.name || '?';
      s.seed = p.seed || 0;
      s.active = p.active !== false;
      s.dropReason = p.dropReason || '';
      s.eliminated = elIds.indexOf(id) >= 0;
      s.layer = lyr;
      s.clinched = clIds.indexOf(id) >= 0;
      s.clinchRound = (stage.clinchRound && stage.clinchRound[id] !== undefined) ? stage.clinchRound[id] : null;
      s.elimRound = (stage.elimRound && stage.elimRound[id] !== undefined) ? stage.elimRound[id] : null;
      list.push(s);
    });
    return list;
  };

  /* =========================================================
     四、阶段与轮次推进
     ========================================================= */

  E.activePlayers = function (t) {
    return t.players.filter(function (p) { return p.active !== false; });
  };

  /* ---- 后进选手（v1.14.0）：指定「从第 N 阶段开始」的选手，在该阶段自动加入 ---- */
  // 某个阶段应该「空降」进来的选手（按种子序排在晋级者之后）
  E.latecomers = function (t, si, exclude) {
    si = parseInt(si, 10) || 0;
    if (si <= 0) {
      // 第 1 阶段：只有 startStage = 0 的人才参赛
      return E.activePlayers(t).filter(function (p) {
        return (parseInt(p.startStage, 10) || 0) === 0;
      });
    }
    var have = {};
    (exclude || []).forEach(function (id) { have[id] = 1; });
    return E.activePlayers(t).filter(function (p) {
      return (parseInt(p.startStage, 10) || 0) === si && !have[p.id];
    });
  };

  // 把后进选手并进名单（去重，保持原顺序，后进者排在后面）
  E.withLatecomers = function (t, si, ids) {
    var out = (ids || []).slice();
    var have = {};
    out.forEach(function (id) { have[id] = 1; });
    E.latecomers(t, si, out).forEach(function (p) {
      if (have[p.id]) return;
      have[p.id] = 1;
      out.push(p.id);
    });
    return out;
  };

  // 当前阶段的参赛者（进入阶段时确定）
  E.ensureParticipants = function (t, stage) {
    stage = stage || t.stages[t.currentStage];
    if (!stage) return null;
    if (!stage.participants || !stage.participants.length) {
      var si = t.stages.indexOf(stage);
      var ids;
      if (si <= 0) {
        ids = E.latecomers(t, 0, []).map(function (p) { return p.id; });
      } else {
        ids = (t.stages[si - 1].advanced || []).slice();
      }
      // 已退赛 / 取消资格的人即使在上阶段晋级名单里，也不再进本阶段的对阵
      var dead = E.droppedMap(t);
      ids = ids.filter(function (id) { return !dead[id]; });
      // 直接从本阶段开始打的选手（种子 / 直邀 / 上届前四）
      ids = E.withLatecomers(t, si, ids);
      stage.participants = ids;
    } else {
      // 已经生成过名单的阶段：补进后来才被标成「从本阶段开始」的选手
      stage.participants = E.withLatecomers(t, t.stages.indexOf(stage), stage.participants);
    }
    return stage.participants;
  };

  /* ============ 淘汰赛自动规划：轮数 / 轮空由「人数 + 晋级人数」算出 ============ */
  /**
   * 本阶段要留下多少人。
   *   最后一阶段 = 1（打到冠军）
   *   其它阶段   = 晋级人数（按名次人数 / 固定人数 两种模式都取 adv.count）
   *   adv.type = 'all' / 'score' 时无法预知人数，按冠军（1）处理
   */
  E.elimTarget = function (t, stage) {
    if (!stage) return 1;
    var idx = (t && t.stages) ? t.stages.indexOf(stage) : -1;
    var isLast = (idx < 0) || (idx === t.stages.length - 1);
    if (isLast) return 1;
    var adv = stage.adv || {};
    var c = Math.max(1, parseInt(adv.count, 10) || 1);
    // 固定人数 / 按名次人数 → 用人数；「全部晋级」没有淘汰意义，退回冠军
    if (adv.type === 'count' || adv.type === 'count_tie') return c;
    return 1;
  };

  /**
   * 由人数 n 与目标人数 target 推出对阵表规模。
   *   规模 = 2^轮数 × target，保证打满这么多轮后正好剩 target 人；
   *   首轮轮空 = 规模 - n。
   *   例：20 人取 8 人 → 2 轮、规模 32、首轮 12 人轮空（4 场 + 12 轮空 → 16 人 → 8 人）
   *       17 人取 8 人 → 2 轮、规模 32、首轮 15 人轮空
   *       24 人取 6 人 → 2 轮、规模 24、首轮 0 轮空（12 场 → 12 人 → 6 人）
   */
  E.elimPlan = function (n, target) {
    n = parseInt(n, 10) || 0;
    target = Math.max(1, parseInt(target, 10) || 1);
    if (n < 2) return { rounds: 0, size: n || 0, byes: 0, target: target, matches: 0, perRound: [] };
    var rounds = Math.ceil(Math.log(n / target) / Math.LN2);
    if (!isFinite(rounds) || rounds < 1) rounds = 1;
    var size = Math.pow(2, rounds) * target;
    while (size < n) { rounds += 1; size = Math.pow(2, rounds) * target; }
    var perRound = [], cur = size;
    for (var i = 0; i < rounds; i++) { perRound.push(cur / 2); cur = cur / 2; }
    return {
      rounds: rounds, size: size, byes: size - n, target: target,
      matches: perRound.reduce(function (a, b) { return a + b; }, 0),  // 不含轮空
      perRound: perRound,
      survivors: perRound.map(function (c, i) { return size / Math.pow(2, i + 1); })
    };
  };

  /**
   * 把种子按「强弱分散」摆进规模为 size 的对阵位。
   * size 是 2 的幂时用标准种子位（1 号与末位同区、1/2 号分属两半）；
   * size 不是 2 的幂（target 不是 2 的幂）时，用上一档 2 的幂的种子序过滤后取前 size 个。
   *
   * rankIds（可选）：本阶段的「排名序」（上阶段晋级名次）。轮空位一律优先给排名靠前者 —
   * 人数不是 2 的幂时标准种子序会把轮空落到中间种子身上，这里把轮空位上的选手
   * 与排名最靠前的人对调（只换人、不动对阵结构），保证「排名靠前才有轮空」。
   */
  E.bracketSlots = function (seededIds, size, rankIds) {
    var ids = seededIds || [];
    size = Math.max(2, parseInt(size, 10) || 2);
    var isPow2 = (size & (size - 1)) === 0;
    var slots;
    if (isPow2) {
      slots = F.layoutSeeds(ids, size);
    } else {
      var base = U.nextPow2(size);
      var order = F.seedOrder(base).filter(function (v) { return v <= size; });
      while (order.length < size) order.push(order.length + 1);
      slots = [];
      for (var i = 0; i < size; i++) {
        var seedNo = order[i];
        slots.push((seedNo <= ids.length) ? ids[seedNo - 1] : null);
      }
    }

    // ---- 轮空位优先给排名靠前者 ----
    var rank = (rankIds && rankIds.length) ? rankIds.slice() : ids.slice();
    var byePos = [];
    for (var p = 0; p + 1 < slots.length; p += 2) {
      if (slots[p] && !slots[p + 1]) byePos.push(p);
      else if (!slots[p] && slots[p + 1]) byePos.push(p + 1);
    }
    if (byePos.length && rank.length) {
      var top = rank.slice(0, byePos.length);
      var posOf = {};
      slots.forEach(function (id, k) { if (id) posOf[id] = k; });
      top.forEach(function (id, k) {
        var at = posOf[id];
        if (at === undefined) return;
        var target = byePos[k];
        if (at === target) return;
        if (byePos.indexOf(at) >= 0) return;          // 本来就在轮空位上，别抢别人的
        var move = slots[target];
        slots[target] = id;
        slots[at] = move;
        posOf[id] = target;
        if (move) posOf[move] = at;
      });
    }
    return slots;
  };

  /**
   * 本阶段的「排名序」：阶段 2 及以后优先沿用上阶段晋级名次
   * （participants 就是晋级名次的顺序），同一阶段内再看种子号。
   * 用于「轮空给谁」「双败前几名进胜者组」这类需要「排名靠前」的判断。
   */
  E.rankOrderIds = function (t, stage, ids) {
    var list = (ids || []).slice();
    var pos = {};
    ((stage && stage.participants) || []).forEach(function (id, i) { pos[id] = i; });
    var si = (t && t.stages) ? t.stages.indexOf(stage) : -1;
    var usePos = (si > 0);
    return list.sort(function (a, b) {
      if (usePos) {
        var pa = (pos[a] === undefined) ? 99999 : pos[a];
        var pb = (pos[b] === undefined) ? 99999 : pos[b];
        if (pa !== pb) return pa - pb;
      }
      var sa = E.seedOf(t, a), sb = E.seedOf(t, b);
      if (sa !== sb) return sa - sb;
      return (pos[a] || 0) - (pos[b] || 0);
    });
  };

  /* ============ 淘汰赛首轮编排方式：种子 / 分档抽签 / 随机抽签 ============ */
  E.drawLabel = function (stage) {
    var m = (stage && stage.drawMode) || 'seed';
    if (m === 'random') return '完全随机抽签';
    if (m === 'tier') return '分档抽签（' + (Math.max(2, parseInt(stage.drawTiers, 10) || 4)) + ' 档）';
    return '按种子号编排';
  };

  /**
   * 按阶段的编排方式生成首轮对阵位。
   *   seed   ：标准种子位（原来的行为）
   *   random ：把已入位的选手整体打乱（轮空位置不动，轮空人数不变）
   *   tier   ：按种子顺序分成 N 档，**档内随机**，档与档之间的强弱分布保持不变
   *
   * 轮空是「上阶段排名换来的待遇」，无论怎么抽签都**不参与置换**：
   * 已经占据轮空位的人原地不动，抽签只在其余选手之间互相交换，
   * 所以「谁轮空」这件事在随机 / 分档抽签下都不会被抽掉。
   *
   * 无论哪种方式，返回的数组长度都是 size，null 表示轮空位。
   */
  E.drawSlots = function (t, stage, seededIds, size) {
    var seeded = (seededIds || []).slice();
    var rank = E.rankOrderIds(t, stage, seeded);
    var slots = E.bracketSlots(seeded, size, rank);
    var mode = (stage && stage.drawMode) || 'seed';
    if (mode === 'seed' || !seeded.length) return slots;
    // 手动摆放首轮位：直接返回用户排好的 bracket 位置（长度 = size，null = 轮空位）
    if (mode === 'manual') {
      var man = stage.bracketSlots;
      // 校验：长度必须等于规模、不能重复、且必须正好是这批选手（多一个少一个都会把
      // 对阵摆歪，比如两人都没填的空桌会被当成「未完成的比赛」卡住整轮）。
      if (man && man.length === size) {
        var seen = {}, uniq = true, cnt = 0;
        for (var mi = 0; mi < man.length; mi++) {
          if (!man[mi]) continue;
          cnt++;
          if (seen[man[mi]] || seeded.indexOf(man[mi]) < 0) { uniq = false; break; }
          seen[man[mi]] = 1;
        }
        if (uniq && cnt === seeded.length) return man.slice();
      }
      // 还没摆放 / 摆得不对就退回种子位，保证仍能生成对阵
      return slots;
    }

    var seedKey = (stage && parseInt(stage.drawSeed, 10)) ? parseInt(stage.drawSeed, 10) : 0;
    var rng = U.makeRng(seedKey || (U.randomSeed() + (t && t.seed ? t.seed : 0)));

    // 打乱工具：只在这些位置上互相置换，null（轮空位）完全不参与
    function permute(positions) {
      if (positions.length < 2) return;
      var vals = positions.map(function (p) { return slots[p]; });
      vals = U.shuffle(vals, rng);          // shuffle 返回新数组，必须接住
      positions.forEach(function (p, i) { slots[p] = vals[i]; });
    }

    // 轮空位：与 null 配对的位置。这些位置上的选手（按排名应得轮空）锁定不动。
    var locked = {};
    for (var q = 0; q + 1 < slots.length; q += 2) {
      if (slots[q] && !slots[q + 1]) locked[q] = 1;
      else if (!slots[q] && slots[q + 1]) locked[q + 1] = 1;
    }

    var all = [];
    for (var i = 0; i < slots.length; i++) if (slots[i] && !locked[i]) all.push(i);

    if (mode === 'random') {
      permute(all);
      return slots;
    }

    // tier：先算出每位选手在种子表中的序号，再按档分组
    var rankOf = {};
    seeded.forEach(function (id, k) { rankOf[id] = k; });
    var tiers = Math.max(2, parseInt(stage.drawTiers, 10) || 4);
    tiers = Math.min(tiers, Math.max(1, seeded.length));
    var per = Math.ceil(seeded.length / tiers);
    var byTier = [];
    for (var k2 = 0; k2 < tiers; k2++) byTier.push([]);
    all.forEach(function (pos) {
      var rk = rankOf[slots[pos]];
      if (rk === undefined) return;
      var ti = Math.min(tiers - 1, Math.floor(rk / per));
      byTier[ti].push(pos);
    });
    byTier.forEach(function (poss) { permute(poss); });
    return slots;
  };

  /**
   * 重新抽签：只允许在首轮尚未录入任何成绩时进行。
   * 会换一个新的随机种子，并把首轮对阵重排。
   */
  E.redrawStage = function (t, stageIndex) {
    var si = (stageIndex === undefined) ? t.currentStage : stageIndex;
    var stage = t.stages[si];
    if (!stage) return { ok: false, msg: '无此阶段' };
    if (stage.type !== 'single_elim' && stage.type !== 'double_elim') {
      return { ok: false, msg: '只有淘汰赛阶段才需要抽签' };
    }
    if ((stage.drawMode || 'seed') === 'seed') {
      return { ok: false, msg: '当前是「按种子号编排」，请先在设置里改成抽签方式' };
    }
    if ((stage.drawMode || 'seed') === 'manual') {
      return { ok: false, msg: '当前是「手动摆放首轮位」：直接调整座位后重新「生成首轮对阵」即可，无需重新抽签' };
    }
    var rd = stage.roundsData[0];
    if (!rd) return { ok: false, msg: '还没生成首轮对阵，直接点「生成首轮对阵」即可抽签' };
    var i, m;
    for (i = 0; i < (rd.matches || []).length; i++) {
      m = rd.matches[i];
      if (m.isBye) continue;
      if ((m.games || []).length || m.decided || m.override) {
        return { ok: false, msg: '首轮已开始录入成绩，不能重新抽签（可先「回退一步」）' };
      }
    }
    if (stage.roundsData.length > 1) return { ok: false, msg: '比赛已经打到第 2 轮，不能重新抽签' };

    stage.drawSeed = U.randomSeed();
    var alive = E.aliveInStage(t, stage);
    var target = E.elimTarget(t, stage);
    var seeded = alive.slice().sort(function (a, b) {
      var pa = t.players.filter(function (x) { return x.id === a; })[0] || {};
      var pb = t.players.filter(function (x) { return x.id === b; })[0] || {};
      return (pa.seed || 9999) - (pb.seed || 9999);
    });

    if (stage.type === 'single_elim') {
      var plan = E.elimPlan(seeded.length, target);
      var slots = E.drawSlots(t, stage, seeded, plan.size);
      var pairs = F.bracketFirstRound(slots);
      stage.bracketSize = plan.size;
      rd.matches = pairs.map(function (p) {
        if (p[0] && p[1]) return E.mkMatch(0, p[0], p[1], null);
        var bm = E.mkMatch(0, p[0] || p[1], null, null);
        bm.isBye = true;
        return bm;
      });
      E.refreshRound(t, stage, rd);
      return { ok: true, msg: '已重新抽签（' + E.drawLabel(stage) + '），共 ' + rd.matches.length + ' 桌' };
    }

    // 双败：按起跑设置重建首轮（首轮还没打，重建是安全的）
    var frDE = E.deFirstRound(t, stage, seeded);
    stage.de = F.createDEState(frDE.wSeeds, frDE.wSize);
    if (frDE.split) stage.de.l = frDE.lSeeds.slice();
    stage.bracketSize = frDE.wSize;
    stage.deSplit = frDE.split;
    rd.matches = frDE.matches;
    E.refreshRound(t, stage, rd);
    return { ok: true, msg: '已重新抽签（' + E.drawLabel(stage) + '）' };
  };

  // 阶段理论轮数（瑞士轮/循环赛可算；双败为动态，返回 null）
  E.plannedRounds = function (stage, n) {
    if (!n || n <= 0) return null;
    switch (stage.type) {
      case 'swiss': return Math.max(1, parseInt(stage.rounds, 10) || 1);
      case 'round_robin': {
        var c = Math.max(1, parseInt(stage.cycles, 10) || 1);
        var per = (n % 2 === 0) ? (n - 1) : n;
        return per * c;
      }
      case 'single_elim': {
        var full;
        if (stage.elimRounds) {
          full = stage.elimRounds;
        } else {
          // 未生成过对阵：先按「晋级人数」推算；只有「全部晋级」才打到冠军
          var adv = stage.adv || {};
          var tg = (adv.type === 'count' || adv.type === 'count_tie')
            ? Math.max(1, parseInt(adv.count, 10) || 1) : 1;
          full = E.elimPlan(n, tg).rounds;
        }
        // 显式限制了轮数则提前收尾（例如「单败筛一轮，取 4 名进下一阶段」）
        var mr = parseInt(stage.maxRounds, 10) || 0;
        return (mr > 0 && mr < full) ? mr : full;
      }
      case 'double_elim': return null;
      case 'groups': {
        var gc = Math.max(1, parseInt(stage.groupCount, 10) || 1);
        var perGroup = Math.ceil(n / gc);
        var sub = { type: stage.groupType, rounds: stage.groupRounds, cycles: stage.groupCycles };
        var pr = E.plannedRounds(sub, perGroup);
        return pr;
      }
    }
    return 1;
  };

  // ============ 生成下一轮 ============
  E.generateRound = function (t) {
    var stage = t.stages[t.currentStage];
    if (!stage) return { ok: false, msg: '无当前阶段' };
    E.ensureParticipants(t);

    // 退赛 / 取消资格：先把含退赛者且还没打完的比赛判给对手（不战而胜），
    // 这样退赛者不会「带着未完的比赛」被带进下一轮，也不会卡住轮次完成检查。
    E.settleDropped(t, stage);

    // 上一轮必须全部完成，才能生成新一轮
    // （小组赛·手动编排例外：各组各自落一轮，别的组没打完不该卡住本组）
    var perGroupManual = (stage.type === 'groups' && (stage.pairMode || 'auto') === 'manual');
    if (stage.roundsData.length && !perGroupManual) {
      var lastRd = stage.roundsData[stage.roundsData.length - 1];
      var chkPrev = E.roundComplete(t, stage, lastRd);
      if (!chkPrev.ok) return { ok: false, msg: '请先完成上一轮：' + chkPrev.msg };
    }

    // 先把「提前晋级 / 提前淘汰」按已有战绩算好，再决定下一轮谁能出场
    E.ensureClinch(t, stage);

    if (stage.type === 'groups') {
      if (!stage.groups) stage.groups = [];
      if (!stage.groups.length) {
        stage.groups = E.buildGroups(t, stage);
      }
      return E.generateGroupRound(t, stage);
    }

    var alive = E.aliveInStage(t, stage);
    // 提前晋级 / 提前淘汰之后，可能只剩 0~1 人还需要比赛
    if (alive.length < 2 && stage.type !== 'double_elim') {
      return {
        ok: false,
        msg: '本阶段已没有可继续配对的选手（未定者剩 ' + alive.length + ' 人），请点「结束本阶段并晋级」'
      };
    }
    var playedSet = E.playedSet(t, stage, null);
    var rng = U.makeRng(t.seed + stage.index * 7919 + (stage.roundsData.length + 1) * 104729);
    var pairs = [], byes = [], extraMatches = [];

    if (stage.type === 'swiss') {
      var pm = stage.pairMode || 'auto';
      if (pm === 'manual') {
        return {
          ok: false, needManual: true,
          msg: '本阶段按「手动编排」配对：请点「手动编排本轮」，自己点选配对后再确认。'
        };
      }
      var stats = E.buildStats(t, stage, stage.participants.slice(), null);
      var entries = alive.map(function (id) {
        var p = t.players.filter(function (x) { return x.id === id; })[0] || {};
        return {
          id: id,
          points: stats[id] ? stats[id].points : 0,
          seed: p.seed || 9999,
          hasBye: !!p.hasBye
        };
      });
      // 主排序：积分降序、种子升序
      entries.sort(function (a, b) {
        if (b.points !== a.points) return b.points - a.points;
        return (a.seed || 9999) - (b.seed || 9999);
      });
      if (pm === 'random') {
        var rr = E.randomSwissPairs(t, stage, entries, playedSet, stage.roundsData.length);
        pairs = rr.pairs;
        rr.byes.forEach(function (b) { byes.push(b); });
      } else {
        var res = F.swissPairing(entries, playedSet, rng, {
          byeRule: t.byeRule,
          roundIndex: stage.roundsData.length
        });
        pairs = res.pairs;
        if (res.bye) byes.push(res.bye);
      }
    } else if (stage.type === 'round_robin') {
      // 手动编排：每轮由用户在「对阵与录入」页点选配对
      if ((stage.pairMode || 'auto') === 'manual') {
        return {
          ok: false, needManual: true,
          msg: '本阶段按「手动编排」配对：请点「手动编排本轮」，自己点选配对后再确认。'
        };
      }
      // 一次性生成所有轮次
      if (stage.roundsData.length === 0) {
        var all = F.roundRobinRounds(alive, stage.cycles);
        stage.roundsData = all.map(function (prs, idx) {
          return {
            index: idx, matches: prs.map(function (p) {
              var m = E.mkMatch(idx, p[0], p[1], null);
              // 人数为奇数时循环表里会出现「对手为空」的一桌 —— 那就是轮空，
              // 必须打上 isBye，否则这一轮永远“没打完”，也没人知道他在轮空
              if (!p[0] || !p[1]) m.isBye = true;
              return m;
            })
          };
        });
        stage.roundsData.forEach(function (rd) {
          rd.matches.forEach(function (m) {
            E.evaluate(m, E.fmtOfMatch(t, stage, m), stage.tie);
            if (!m.isBye) return;
            var pb0 = t.players.filter(function (x) { return x.id === (m.playerA || m.playerB); })[0];
            if (pb0) pb0.hasBye = true;
          });
        });
        return { ok: true, generated: stage.roundsData.length };
      }
      return { ok: false, msg: '循环赛对阵已全部生成' };
    } else if (stage.type === 'single_elim') {
      var target = E.elimTarget(t, stage);
      if (alive.length <= target) {
        return {
          ok: false,
          msg: '本阶段已剩 ' + alive.length + ' 人，达到晋级人数 ' + target + ' 人，请点「结束本阶段并晋级」'
        };
      }
      if (stage.roundsData.length === 0) {
        var seeded = alive.slice().sort(function (a, b) {
          var pa = t.players.filter(function (x) { return x.id === a; })[0] || {};
          var pb = t.players.filter(function (x) { return x.id === b; })[0] || {};
          return (pa.seed || 9999) - (pb.seed || 9999);
        });
        // 规模由「人数 + 晋级人数」算出：打满 plan.rounds 轮后正好剩 target 人
        var plan = E.elimPlan(seeded.length, target);
        var size = plan.size;
        if (!(parseInt(stage.drawSeed, 10) > 0)) stage.drawSeed = U.randomSeed();
        var slots = E.drawSlots(t, stage, seeded, size);
        pairs = F.bracketFirstRound(slots);
        stage.bracketSize = size;
        stage.elimTarget = target;
        stage.elimRounds = plan.rounds;
        stage.elimSize = plan.size;
        stage.elimByes = plan.byes;
      } else {
        var deadMap = E.droppedMap(t);
        var last = stage.roundsData[stage.roundsData.length - 1];
        // 上一轮赢了但赛后已退赛的人不再往下一轮带（他赢的那场成绩保留）
        var winners = last.matches.map(function (m) {
          if (m.isBye) return m.playerA || m.playerB;
          if (!m.result || !m.result.winner) return null;
          return (m.result.winner === 'A') ? m.playerA : m.playerB;
        }).filter(Boolean).filter(function (id) { return !deadMap[id]; });
        // 只剩 target 人（含 1 人）就不再打进下一轮：本阶段的晋级名额已经产生
        if (winners.length <= target) {
          return {
            ok: false,
            msg: (target <= 1 ? '淘汰赛已结束' : '本阶段已剩 ' + winners.length + ' 人，达到晋级人数 ' + target + ' 人')
          };
        }
        pairs = F.chunkPairs(winners);
        // 季军争夺战：只在「打到冠军」（target = 1）时才有意义
        var thirdPair = null;
        if (target <= 1 && pairs.length === 1 && stage.thirdPlace) {
          var semis = (last.matches || []).filter(function (m) { return !m.isBye; });
          if (semis.length === 2) {
            var ls = semis.map(function (m) {
              if (!m.result || !m.result.winner) return null;
              return m.result.winner === 'A' ? m.playerB : m.playerA;
            }).filter(Boolean).filter(function (id) { return !deadMap[id]; });
            if (ls.length === 2) thirdPair = [ls[0], ls[1]];
          }
        }
        if (thirdPair) {
          var tm = E.mkMatch(stage.roundsData.length, thirdPair[0], thirdPair[1], null);
          tm.isThird = true;
          extraMatches.push(tm);
        }
      }
    } else if (stage.type === 'double_elim') {
      return E.generateDoubleElimRound(t);
      /* eslint-disable no-unreachable */
      if (!stage.de) {
        var seeded2 = alive.slice().sort(function (a, b) {
          var pa = t.players.filter(function (x) { return x.id === a; })[0] || {};
          var pb = t.players.filter(function (x) { return x.id === b; })[0] || {};
          return (pa.seed || 9999) - (pb.seed || 9999);
        });
        var size2 = U.nextPow2(seeded2.length);
        var slots2 = F.layoutSeeds(seeded2, size2);
        stage.de = F.createDEState(seeded2, size2);
        pairs = F.bracketFirstRound(slots2);
        stage.bracketSize = size2;
      } else {
        return { ok: false, msg: '双败淘汰请使用「推进双败轮次」' };
      }
    }

    if (!pairs.length && !byes.length) return { ok: false, msg: '无法生成更多对阵' };

    var rIdx = stage.roundsData.length;
    // 对手为空 = 轮空（多为人数不是 2 的幂时种子靠前者）。
    // 必须就地转成 bye 对局并保持其槽位顺序，否则：
    //   ① 会被当成「未完成的正常比赛」卡住整轮；
    //   ② 轮空者跑到数组末尾会打乱 bracket，导致 1 号与 2 号种子提前相遇。
    var matches = pairs.map(function (p) {
      if (p[0] && p[1]) return E.mkMatch(rIdx, p[0], p[1], null);
      var bm = E.mkMatch(rIdx, p[0] || p[1], null, null);
      bm.isBye = true;
      return bm;
    // 兜底：两边都空的“空桌”不能留给轮次，否则这一轮永远打不完
    }).filter(function (m) { return !!(m.playerA || m.playerB); });
    extraMatches.forEach(function (m) { m.round = rIdx; matches.push(m); });
    byes.forEach(function (b) {
      var m = E.mkMatch(rIdx, b, null, null);
      m.isBye = true;
      matches.push(m);
    });
    matches.forEach(function (m) { E.evaluate(m, E.fmtOfMatch(t, stage, m), stage.tie); });
    stage.roundsData.push({ index: rIdx, matches: matches });
    stage.status = 'running';

    // 轮空标记
    matches.forEach(function (m) {
      if (!m.isBye) return;
      var pb = t.players.filter(function (x) { return x.id === (m.playerA || m.playerB); })[0];
      if (pb) pb.hasBye = true;
    });

    return { ok: true, roundIndex: rIdx };
  };

  E.mkMatch = function (roundIndex, a, b, groupIdx) {
    return {
      id: U.uid('m'),
      round: roundIndex,
      group: (groupIdx === undefined ? null : groupIdx),
      bracket: 'W',
      playerA: a || null,
      playerB: b || null,
      games: [],
      decided: false,
      overtime: false,
      override: null,
      result: null,
      note: ''
    };
  };

  // 双败淘汰：生成下一轮（含胜者组与败者组）
  /**
   * 双败的「分组起跑」：按本阶段排名把前 N 人放进胜者组，其余人直接落在败者组。
   *   deSplitTop = 0 或人数不够（<2 或剩下的不足 2 人）→ 不起用，全部从胜者组开始。
   * @return {on, top, w:[], l:[]}
   */
  E.deSplitOf = function (t, stage, ids) {
    var rank = E.rankOrderIds(t, stage, ids || []);
    var n = Math.max(0, parseInt(stage && stage.deSplitTop, 10) || 0);
    var on = (n >= 2 && rank.length >= n + 2);
    return {
      on: on,
      top: on ? n : 0,
      w: on ? rank.slice(0, n) : rank.slice(),
      l: on ? rank.slice(n) : []
    };
  };

  /**
   * 本阶段实际生效的「前 N 名进胜者组」人数（0 = 不启用）。
   * 已生成对阵的阶段以当时写入的 deSplit 为准，避免改了设置却和历史对阵对不上。
   */
  E.deSplitTopOf = function (t, stage) {
    if (!stage) return 0;
    if (stage.deSplit && stage.deSplit.top > 0) return stage.deSplit.top;
    var n = (stage.participants || []).length;
    var want = Math.max(0, parseInt(stage.deSplitTop, 10) || 0);
    return (want >= 2 && n >= want + 2) ? want : 0;
  };

  /**
   * 双败首轮的「座位」：按起跑设置算出胜者组 / 败者组各自的座位表。
   * 抽签（随机 / 分档）只作用于各自的阵容，轮空位仍然锁定给排名靠前者。
   */
  E.deFirstSlots = function (t, stage, ids) {
    var sp = E.deSplitOf(t, stage, ids);
    var wSize = U.nextPow2(Math.max(2, sp.w.length));
    var slotsW = E.drawSlots(t, stage, sp.w, wSize);
    var lSize = 0, slotsL = null;
    if (sp.on) {
      lSize = U.nextPow2(Math.max(2, sp.l.length));
      slotsL = E.drawSlots(t, stage, sp.l, lSize);
    }
    return {
      slotsW: slotsW, slotsL: slotsL, wSize: wSize, lSize: lSize,
      wSeeds: sp.w.slice(), lSeeds: sp.l.slice(),
      split: sp.on ? { top: sp.w.length, wSize: wSize, rest: sp.l.length, lSize: lSize } : null
    };
  };

  /**
   * 双败首轮：按起跑设置生成胜者组 / 败者组的第一轮对阵。
   */
  E.deFirstRound = function (t, stage, ids) {
    var fs = E.deFirstSlots(t, stage, ids);
    var ms = F.bracketFirstRound(fs.slotsW).map(function (p) {
      var m = E.mkMatch(0, p[0], p[1], null);
      m.bracket = 'W';
      if (!p[1]) m.isBye = true;
      return m;
    });
    if (fs.slotsL) {
      F.bracketFirstRound(fs.slotsL).forEach(function (p) {
        var m = E.mkMatch(0, p[0], p[1], null);
        m.bracket = 'L';
        if (!p[1]) m.isBye = true;
        ms.push(m);
      });
    }
    return {
      matches: ms,
      slotsW: fs.slotsW,      // 胜者组座位表（半区互换按「首轮对阵位」分上下半区要用）
      slotsL: fs.slotsL,
      wSize: fs.wSize,
      lSize: fs.lSize,
      wSeeds: fs.wSeeds,
      lSeeds: fs.lSeeds,
      split: fs.split
    };
  };

  /**
   * 双败对阵的「骨架」：从起跑状态出发，用占位标记把整棵对阵（胜者组 + 败者组 + 总决赛）
   * 一轮一轮推演出来。「前 N 名进胜者组、其余从败者组起跑」这种非标准结构也能画出完整的图，
   * 而且每张卡都能标清来源（第几轮第几场的胜者 / 败者）。
   * @return {cols:[{pairsW,pairsL,byesW,byesL}], gf, split, wSize, lSize}
   */
  E.deSkeleton = function (t, stage, ids) {
    var fs = E.deFirstSlots(t, stage, ids);
    var seq = 0;
    function pTok(id) { seq++; return { kind: 'p', id: id, __k: seq }; }
    function mTok(br, col, idx, win) { seq++; return { kind: 'm', br: br, col: col, idx: idx, win: win, __k: seq }; }

    var de = F.createDEState([], fs.wSize);
    de.w = fs.wSeeds.map(pTok);
    de.l = fs.lSeeds.map(pTok);
    de.pending = [];

    // 第 1 列直接用座位表，保证与真实生成的首轮完全一致
    var first = { pairsW: [], pairsL: [], byesW: [], byesL: [] };
    var firstToks = {};   // playerId -> token（让第 1 列与状态里的 token 是同一个对象）
    de.w.concat(de.l).forEach(function (tk) { firstToks[tk.id] = tk; });
    F.bracketFirstRound(fs.slotsW).forEach(function (p) {
      if (p[0] && p[1]) first.pairsW.push([firstToks[p[0]], firstToks[p[1]]]);
      else first.byesW.push(firstToks[p[0] || p[1]]);
    });
    if (fs.slotsL) {
      F.bracketFirstRound(fs.slotsL).forEach(function (p) {
        if (p[0] && p[1]) first.pairsL.push([firstToks[p[0]], firstToks[p[1]]]);
        else first.byesL.push(firstToks[p[0] || p[1]]);
      });
    }

    // 用「A 位胜」的占位结果推进状态：只看结构，不看具体谁赢。
    // 这里自己算新的胜者组 / 败者组 / 待注入名单，比复用 doubleElimCommit 的对象同一性判断更稳。
    function advance(nx, colNo) {
      var wWin = [], wLose = [], lWin = [], used = {};
      (nx.pairsW || []).forEach(function (p, i) {
        wWin.push(mTok('W', colNo, i + 1, true));
        wLose.push(mTok('W', colNo, i + 1, false));
      });
      (nx.byesW || []).forEach(function (b) { wWin.push(b); });
      (nx.pairsL || []).forEach(function (p, i) {
        lWin.push(mTok('L', colNo, i + 1, true));
        [p[0], p[1]].forEach(function (x) { if (x && x.__k) used[x.__k] = 1; });
      });
      (nx.byesL || []).forEach(function (b) { lWin.push(b); });
      var hasW = (nx.pairsW || []).length > 0 || (nx.byesW || []).length > 0;
      var keep = (de.pending || []).filter(function (x) { return !used[x.__k]; });
      if (hasW) {
        de.w = wWin;
        de.pending = wLose.concat(keep);
      } else {
        de.pending = keep;
      }
      de.l = lWin;
    }

    var cols = [first];
    advance(first, 1);

    var gf = null;
    for (var g = 0; g < 80; g++) {
      var nx = F.doubleElimNext(de, { gfMode: stage.gfMode || 'reset' });
      if (nx.finished) break;
      if (nx.gf) { gf = nx; break; }
      cols.push(nx);
      advance(nx, cols.length);
    }
    return { cols: cols, gf: gf, split: fs.split, wSize: fs.wSize, lSize: fs.lSize };
  };

  E.generateDoubleElimRound = function (t) {
    var stage = t.stages[t.currentStage];
    if (!stage || stage.type !== 'double_elim') return { ok: false, msg: '非双败阶段' };
    E.ensureParticipants(t);
    E.settleDropped(t, stage);
    if (!stage.de) {
      // 首轮：退赛者直接不进对阵表（否则会在胜者组里占一个位置）
      var dead0 = E.droppedMap(t);
      var seeded = stage.participants.filter(function (id) { return !dead0[id]; });
      if (!(parseInt(stage.drawSeed, 10) > 0)) stage.drawSeed = U.randomSeed();
      // 分组起跑：排名前 N 进胜者组，其余从败者组打起（未设置则全部进胜者组）
      var fr = E.deFirstRound(t, stage, seeded);
      var cross = !!stage.deCrossDrop;
      var halfOf = {};
      if (cross) {
        // 半区按「首轮对阵位」平分：座位表上半段 = 上半区，下半段 = 下半区。
        // 这样上下半区就是对阵图上的上、下两半，符合通行的 crossover 口径
        //（上半区胜者组的败者交叉掉进下半区败者组，反之亦然）。
        var slotArr = fr.slotsW || [];
        var halfN = Math.floor(slotArr.length / 2);
        slotArr.forEach(function (id, idx) { if (id) halfOf[id] = (idx < halfN) ? 0 : 1; });
        // 从败者组起跑的人（deSplitTop）也要有归属：按座位表顺序接到后半段
        (fr.lSeeds || []).forEach(function (id) { if (!(id in halfOf)) halfOf[id] = 1; });
      }
      stage.de = F.createDEState(fr.wSeeds, fr.wSize, { cross: cross, halfOf: halfOf });
      if (fr.split) stage.de.l = fr.lSeeds.slice();
      stage.bracketSize = fr.wSize;
      stage.deSplit = fr.split;
      var ms0 = fr.matches;
      ms0.forEach(function (m) { E.evaluate(m, E.fmtOfMatch(t, stage, m), stage.tie); });
      stage.roundsData.push({ index: 0, matches: ms0, committed: false });
      stage.status = 'running';
      return { ok: true, roundIndex: 0 };
    }

    // 关键：双败的胜者组 / 败者组归属只有在「结算本轮」后才推进。
    // 这里先自动结算上一轮（幂等），避免用户直接点「生成下一轮」时
    // 用旧状态又生成一遍同样的对阵（这会让败者组永远不出现）。
    var pc = E.deCommitPending(t, stage);
    if (!pc.ok) return pc;

    // 结算之后，把已退赛的人从胜者组 / 败者组 / 待注入 名单里彻底剔除，
    // 否则他们会被当成"还活着"继续排在后面的轮次里。
    E.dePurgeDropped(t, stage);

    var nx = F.doubleElimNext(stage.de, { gfMode: stage.gfMode });
    if (nx.finished) { stage.status = 'finished'; return { ok: false, msg: '双败淘汰已全部结束' }; }

    var rIdx = stage.roundsData.length;
    var ms = [];
    function pushW(p) {
      if (p[0] && p[1]) { var m = E.mkMatch(rIdx, p[0], p[1], null); m.bracket = 'W'; ms.push(m); }
      else { var bm = E.mkMatch(rIdx, p[0] || p[1], null, null); bm.bracket = 'W'; bm.isBye = true; ms.push(bm); }
    }
    function pushL(p, half) {
      if (p[0] && p[1]) { var m = E.mkMatch(rIdx, p[0], p[1], null); m.bracket = 'L'; m.lbHalf = half; ms.push(m); }
      else { var bm = E.mkMatch(rIdx, p[0] || p[1], null, null); bm.bracket = 'L'; bm.lbHalf = half; bm.isBye = true; ms.push(bm); }
    }
    if (stage.de.cross) {
      nx.lbTop.forEach(function (p) { pushL(p, 'T'); });
      nx.lbBot.forEach(function (p) { pushL(p, 'B'); });
      (nx.byesLT || []).forEach(function (b) { var m = E.mkMatch(rIdx, b, null, null); m.bracket = 'L'; m.lbHalf = 'T'; m.isBye = true; ms.push(m); });
      (nx.byesLB || []).forEach(function (b) { var m = E.mkMatch(rIdx, b, null, null); m.bracket = 'L'; m.lbHalf = 'B'; m.isBye = true; ms.push(m); });
      if (nx.lbCrossPair) {
        var cm = E.mkMatch(rIdx, nx.lbCrossPair[0], nx.lbCrossPair[1], null);
        cm.bracket = 'L'; cm.isLBCross = true; ms.push(cm);
      }
      nx.pairsW.forEach(function (p) { pushW(p); });
      (nx.byesW || []).forEach(function (b) { var m = E.mkMatch(rIdx, b, null, null); m.bracket = 'W'; m.isBye = true; ms.push(m); });
    } else {
      nx.pairsW.forEach(function (p) {
        var m = E.mkMatch(rIdx, p[0], p[1], null);
        m.bracket = 'W';
        ms.push(m);
      });
      nx.pairsL.forEach(function (p) { var m = E.mkMatch(rIdx, p[0], p[1], null); m.bracket = 'L'; ms.push(m); });
      nx.byesW.forEach(function (b) { var m = E.mkMatch(rIdx, b, null, null); m.bracket = 'W'; m.isBye = true; ms.push(m); });
      nx.byesL.forEach(function (b) { var m = E.mkMatch(rIdx, b, null, null); m.bracket = 'L'; m.isBye = true; ms.push(m); });
    }

    // 总决赛：加赛局 / 让局 / 可升格决赛 的标记
    if (nx.gf) {
      var gfm = ms.filter(function (m) { return m.bracket === 'W' && !m.isBye; })[0];
      if (gfm) {
        gfm.isGF = true;
        gfm.gfRound = nx.gfReset ? 'reset' : 'first';
        if (stage.gfMode === 'elevate') {
          // 一场定胜负、比分累计：A = 胜者组冠军，B = 败者组冠军（pairsW 顺序）
          var ec = E.gfElevCfg(t, stage);
          gfm.gfElev = { base: ec.base, up: ec.up, side: 'B' };
        } else if (!nx.gfReset && stage.gfMode === 'handicap') {
          var hg = Math.max(1, parseInt(stage.gfHandicap, 10) || 1);
          gfm.gfAdv = { side: (stage.gfAdvSide === 'L') ? 'B' : 'A', games: hg };
        }
      }
    }

    if (!ms.length) { stage.status = 'finished'; return { ok: false, msg: '双败淘汰已全部结束' }; }
    ms.forEach(function (m) { E.evaluate(m, E.fmtOfMatch(t, stage, m), stage.tie); });
    // 轮空标记（与其它赛制一致，供后续阶段的轮空规则参考）
    ms.forEach(function (m) {
      if (!m.isBye) return;
      var pb = t.players.filter(function (x) { return x.id === (m.playerA || m.playerB); })[0];
      if (pb) pb.hasBye = true;
    });
    stage.roundsData.push({ index: rIdx, matches: ms, isGF: !!nx.gf, gfReset: !!nx.gfReset, isLBCross: !!nx.lbCrossPair, committed: false });
    return { ok: true, roundIndex: rIdx, isGF: !!nx.gf, gfReset: !!nx.gfReset, isLBCross: !!nx.lbCrossPair };
  };

  /* ---- 双败：把退赛者从状态机里剔除 ---- */
  E.dePurgeDropped = function (t, stage) {
    if (!stage || !stage.de) return 0;
    var dead = E.droppedMap(t);
    var n = 0;
    ['w', 'l', 'pending', 'lTop', 'lBot', 'pendingTop', 'pendingBot'].forEach(function (k) {
      if (!Array.isArray(stage.de[k])) return;
      var before = stage.de[k].length;
      stage.de[k] = stage.de[k].filter(function (id) { return !dead[id]; });
      n += before - stage.de[k].length;
    });
    return n;
  };

  /* ---- 双败：结算（推进胜者组/败者组归属），幂等 ---- */
  E.deCommitPending = function (t, stage) {
    if (!stage || stage.type !== 'double_elim' || !stage.de) return { ok: true };
    var rd = stage.roundsData[stage.roundsData.length - 1];
    if (!rd || rd.committed) return { ok: true };
    var chk = E.roundComplete(t, stage, rd);
    if (!chk.ok) return { ok: false, msg: '请先完成本轮全部比赛：' + chk.msg };
    var r = F.doubleElimCommit(stage.de, rd, { drawBothLose: !!stage.drawBothLose });
    if (!r.ok) return r;
    rd.committed = true;
    return { ok: true };
  };

  E.deFinished = function (stage) {
    if (!stage || stage.type !== 'double_elim' || !stage.de) return false;
    var de = stage.de;
    var rd = stage.roundsData[stage.roundsData.length - 1];
    if (rd && !rd.committed) {
      de = U.clone(de);
      F.doubleElimCommit(de, U.clone(rd), { drawBothLose: !!stage.drawBothLose });
    }
    return !!F.doubleElimNext(de, { gfMode: stage.gfMode }).finished;
  };

  // 双败：提交本轮（界面「结算本轮」按钮）
  E.commitDoubleElimRound = function (t) {
    var stage = t.stages[t.currentStage];
    if (!stage) return { ok: false, msg: '无当前阶段' };
    var r = E.deCommitPending(t, stage);
    if (r.ok) return { ok: true, msg: '本轮已结算，可生成下一轮' };
    return r;
  };

  // ============ 小组赛：组内双败 ============
  /**
   * 组内双败：每组一棵独立的双败树（胜者组 + 败者组 + 一场组内总决赛）。
   * 与阶段级双败共用同一套状态机，只是状态存在 g.de 里、轮次混在阶段轮次中。
   * @return {any:bool, blocked:bool, msg}
   */
  E.generateGroupDE = function (t, stage, g, gi, rIdx, outMatches) {
    if (!g) return { any: false };

    // 1) 先把本组「上一轮」结算掉（同一个阶段轮次里可能混着别的小组）
    if (g.de && !g.finished) {
      var last = null;
      for (var w = stage.roundsData.length - 1; w >= 0; w--) {
        if ((stage.roundsData[w].matches || []).some(function (m) { return m.group === gi; })) { last = stage.roundsData[w]; break; }
      }
      if (last) {
        last.dgc = last.dgc || {};
        if (!last.dgc[gi]) {
          var sub = (last.matches || []).filter(function (m) { return m.group === gi; });
          // 平局在「双方都输」模式下也算打完了（两人各记一负一起掉进败者组 / 一起淘汰）
          var blOk = !!stage.drawBothLose;
          var notDone = sub.filter(function (m) {
            if (m.isBye || m.voided) return false;
            if (m.result && m.result.winner) return false;
            if (blOk && m.result && m.result.settled && m.playerA && m.playerB) return false;
            return true;
          });
          if (notDone.length) {
            return { blocked: true, msg: '「' + g.name + '」上一轮还有 ' + notDone.length + ' 场没打完' };
          }
          if (sub.some(function (m) { return m.isGroupFinal; })) {
            g.finished = true;        // 组内总决赛已打完
            return { any: false };
          }
          F.doubleElimCommit(g.de, { matches: sub }, { drawBothLose: !!stage.drawBothLose });
          last.dgc[gi] = true;
        }
      }
    }
    if (g.finished) return { any: false };

    var alive = (g.players || []).filter(function (id) {
      return (stage.eliminated || []).indexOf(id) < 0 && (stage.clinched || []).indexOf(id) < 0;
    });
    if (alive.length < 2) {
      if (g.de) g.finished = true;
      return { any: false };
    }

    var ms = [];
    if (!g.de) {
      var seeded = E.rankOrderIds(t, stage, alive);
      var size = U.nextPow2(seeded.length);
      g.de = F.createDEState(seeded, size);
      g.bracketSize = size;
      var slots = E.bracketSlots(seeded, size, seeded);
      F.bracketFirstRound(slots).forEach(function (p) {
        var m = E.mkMatch(rIdx, p[0], p[1], gi);
        m.bracket = 'W';
        if (!p[1]) m.isBye = true;
        ms.push(m);
      });
    } else {
      var nx = F.doubleElimNext(g.de, { gfMode: 'none' });
      if (nx.finished) { g.finished = true; return { any: false }; }
      if (nx.gf) {
        var fm = E.mkMatch(rIdx, nx.pairsW[0][0], nx.pairsW[0][1], gi);
        fm.bracket = 'W';
        fm.isGroupFinal = true;
        ms.push(fm);
      } else {
        (nx.pairsW || []).forEach(function (p) {
          var m = E.mkMatch(rIdx, p[0], p[1], gi);
          m.bracket = 'W';
          ms.push(m);
        });
        (nx.pairsL || []).forEach(function (p) {
          var m = E.mkMatch(rIdx, p[0], p[1], gi);
          m.bracket = 'L';
          ms.push(m);
        });
        (nx.byesW || []).forEach(function (b) {
          var m = E.mkMatch(rIdx, b, null, gi);
          m.bracket = 'W'; m.isBye = true;
          ms.push(m);
        });
        (nx.byesL || []).forEach(function (b) {
          var m = E.mkMatch(rIdx, b, null, gi);
          m.bracket = 'L'; m.isBye = true;
          ms.push(m);
        });
      }
    }

    if (!ms.length) return { any: false };
    ms.forEach(function (m) {
      E.evaluate(m, E.fmtOfMatch(t, stage, m), stage.tie);
      outMatches.push(m);
    });
    return { any: true };
  };

  // 组内双败是否已打完（含「总决赛已分出胜负」与「状态机已无下一轮」）
  E.groupDEFinished = function (stage, g) {
    if (!g) return false;
    if (g.finished) return true;
    if (!g.de) return false;
    var gi = stage.groups ? stage.groups.indexOf(g) : -1;
    var playedFinal = (stage.roundsData || []).some(function (rd) {
      return (rd.matches || []).some(function (m) {
        return m.group === gi && m.isGroupFinal && m.decided;
      });
    });
    if (playedFinal) return true;
    return !!F.doubleElimNext(U.clone(g.de), { gfMode: 'none' }).finished;
  };

  // ============ 小组赛 ============
  E.buildGroups = function (t, stage, fresh) {
    var method = stage.groupMethod || 'snake';
    // 手动分组：已有分组则保持不动
    if (method === 'manual' && stage.groups && stage.groups.length) return stage.groups;

    var ids = stage.participants.slice();
    // 按种子排序（种子为 0 视为无种子，排最后）
    ids.sort(function (a, b) {
      var pa = t.players.filter(function (x) { return x.id === a; })[0] || {};
      var pb = t.players.filter(function (x) { return x.id === b; })[0] || {};
      var sa = pa.seed || 9999, sb = pb.seed || 9999;
      if (sa !== sb) return sa - sb;
      return 0;
    });
    // fresh = 重新抽签（不复用存档种子，保证每次结果不同）
    var rng = U.makeRng(fresh ? U.randomSeed() : (t.seed + stage.index * 31337));
    // 手动分组以蛇形为初稿，交由用户调整
    var raw = F.splitGroups(ids, stage.groupCount, method === 'manual' ? 'snake' : method, rng);
    return raw.map(function (g, i) {
      return {
        id: U.uid('g'),
        name: String.fromCharCode(65 + i) + ' 组',
        players: g,
        finished: false
      };
    });
  };

  // 手动分组：把选手移到指定小组
  E.moveToGroup = function (t, stage, playerId, groupIdx) {
    if (!stage.groups || !stage.groups.length) return { ok: false, msg: '尚未建立分组' };
    groupIdx = parseInt(groupIdx, 10);
    if (isNaN(groupIdx) || groupIdx < 0 || groupIdx >= stage.groups.length) {
      return { ok: false, msg: '小组不存在' };
    }
    if (stage.roundsData && stage.roundsData.length) {
      return { ok: false, msg: '已开始比赛，无法再调整分组' };
    }
    var from = -1;
    stage.groups.forEach(function (g, i) {
      var idx = g.players.indexOf(playerId);
      if (idx >= 0) { g.players.splice(idx, 1); from = i; }
    });
    if (from === groupIdx) {
      // 原位放回
      stage.groups[groupIdx].players.push(playerId);
      return { ok: true };
    }
    stage.groups[groupIdx].players.push(playerId);
    return { ok: true, msg: '已调整分组' };
  };

  E.generateGroupRound = function (t, stage) {
    var rIdx = stage.roundsData.length;
    var matches = [];
    var any = false;
    // 手动编排：循环赛 / 瑞士轮 组内由用户在「对阵与录入」页按组点选配对
    if ((stage.pairMode || 'auto') === 'manual' &&
      (stage.groupType === 'round_robin' || stage.groupType === 'swiss')) {
      var pending = [], pendingIdx = [];
      for (var gi = 0; gi < stage.groups.length; gi++) {
        var gg = stage.groups[gi];
        if (gg.finished) continue;
        var galive = gg.players.filter(function (id) {
          return (stage.eliminated || []).indexOf(id) < 0 &&
            (stage.clinched || []).indexOf(id) < 0;
        });
        if (galive.length >= 2) { pending.push(gg.name); pendingIdx.push(gi); }
      }
      return {
        ok: false, needManual: true, groups: pending, groupIdx: pendingIdx,
        msg: pending.length
          ? ('本小组赛按「手动编排」配对，请点「手动编排本轮」，按组点选配对后确认（待编排：' + pending.join('、') + '）')
          : '所有小组的本轮都无需编排'
      };
    }
    for (var gi = 0; gi < stage.groups.length; gi++) {
      var g = stage.groups[gi];
      if (g.finished) continue;
      // 组内双败：每组一棵独立双败树，直接在这里出对阵
      if (stage.groupType === 'double_elim') {
        var gde = E.generateGroupDE(t, stage, g, gi, rIdx, matches);
        if (gde.blocked) return { ok: false, msg: gde.msg || '请先完成上一轮的小组比赛' };
        if (gde.any) any = true;
        continue;
      }
      var alive = g.players.filter(function (id) {
        return (stage.eliminated || []).indexOf(id) < 0 &&
          (stage.clinched || []).indexOf(id) < 0;
      });
      var prs = [];

      if (stage.groupType === 'round_robin') {
        if (!g.rrGenerated) {
          g.rrGenerated = F.roundRobinRounds(g.players.slice(), stage.groupCycles || 1);
        }
        var rrIdx = 0;
        for (var q = 0; q < rIdx; q++) {
          if (stage.roundsData[q].matches.some(function (m) { return m.group === gi; })) rrIdx++;
        }
        if (rrIdx < g.rrGenerated.length) prs = g.rrGenerated[rrIdx];
      } else if (stage.groupType === 'swiss') {
        var stats = E.buildStats(t, stage, g.players.slice(), gi);
        var entries = alive.map(function (id) {
          var p = t.players.filter(function (x) { return x.id === id; })[0] || {};
          return { id: id, points: stats[id] ? stats[id].points : 0, seed: p.seed || 9999, hasBye: !!p.hasBye };
        });
        entries.sort(function (a, b) {
          if (b.points !== a.points) return b.points - a.points;
          return (a.seed || 9999) - (b.seed || 9999);
        });
        var rng = U.makeRng(t.seed + stage.index * 7919 + gi * 31 + rIdx * 104729);
        var rs = F.swissPairing(entries, E.playedSet(t, stage, gi), rng, {
          byeRule: t.byeRule,
          roundIndex: rIdx
        });
        prs = rs.pairs;
        if (rs.bye) {
          var bm = E.mkMatch(rIdx, rs.bye, null, gi);
          bm.isBye = true;
          matches.push(bm);
          any = true;
        }
      } else if (stage.groupType === 'single_elim') {
        if (rIdx === 0) {
          var seeded = g.players.slice().sort(function (a, b) {
            var pa = t.players.filter(function (x) { return x.id === a; })[0] || {};
            var pb = t.players.filter(function (x) { return x.id === b; })[0] || {};
            return (pa.seed || 9999) - (pb.seed || 9999);
          });
          var size = U.nextPow2(seeded.length);
          prs = F.bracketFirstRound(F.layoutSeeds(seeded, size));
        } else {
          var lastG = null;
          for (var w = stage.roundsData.length - 1; w >= 0; w--) {
            if (stage.roundsData[w].matches.some(function (m) { return m.group === gi; })) { lastG = stage.roundsData[w]; break; }
          }
          if (lastG) {
            var ws = lastG.matches.filter(function (m) { return m.group === gi; }).map(function (m) {
              if (m.isBye) return m.playerA || m.playerB;
              if (!m.result || !m.result.winner) return null;
              return (m.result.winner === 'A') ? m.playerA : m.playerB;
            }).filter(Boolean);
            if (ws.length > 1) prs = F.chunkPairs(ws);
          }
        }
      } else if (stage.groupType === 'double_elim') {
        // 组内双败：简化为使用组内独立状态（存于 g.de）
        return { ok: false, msg: '小组内暂不支持双败淘汰，请选择循环赛/瑞士轮/单败淘汰' };
      }

      // 循环赛的对阵是首轮一次性预生成的，里面固定写着全部组员；
      // 已提前晋级 / 提前淘汰的人不该再出场，涉及他的对阵整场略过
      if (alive.length < g.players.length) {
        prs = prs.filter(function (p) {
          return (!p[0] || alive.indexOf(p[0]) >= 0) && (!p[1] || alive.indexOf(p[1]) >= 0);
        });
      }

      prs.forEach(function (p) {
        var m = E.mkMatch(rIdx, p[0], p[1], gi);
        if (!p[1]) m.isBye = true;
        matches.push(m);
        any = true;
      });
    }

    if (!any) return { ok: false, msg: '各小组对阵已全部结束' };
    matches.forEach(function (m) { E.evaluate(m, E.fmtOfMatch(t, stage, m), stage.tie); });
    stage.roundsData.push({ index: rIdx, matches: matches });
    stage.status = 'running';
    return { ok: true, roundIndex: rIdx };
  };

  /* ============ 辅助：存活选手 / 已交手记录 ============ */
  // 已退赛 / 取消资格（active === false）的选手集合
  E.droppedMap = function (t) {
    var map = {};
    (t.players || []).forEach(function (p) { if (p.active === false) map[p.id] = 1; });
    return map;
  };

  /**
   * 把「含退赛选手且还没定案」的比赛判给对手（不战而胜）。
   * 已定案的比赛一律不动 —— 历史成绩不能因为事后退赛被改写。
   * 两名选手都退赛时，这场比赛作废（voided），不算任何人胜负。
   */
  E.settleDropped = function (t, stage) {
    if (!stage || !stage.roundsData) return 0;
    var dead = E.droppedMap(t);
    if (!Object.keys(dead).length) return 0;
    var changed = 0;
    stage.roundsData.forEach(function (rd) {
      (rd.matches || []).forEach(function (m) {
        if (!m || m.isBye) return;
        var aDead = !!(m.playerA && dead[m.playerA]);
        var bDead = !!(m.playerB && dead[m.playerB]);
        if (!aDead && !bDead) return;
        if (m.result && m.result.settled) return;      // 已经打出成绩的，保留原样
        if (aDead && bDead) {
          m.override = null;
          m.voided = true;
          m.woReason = '双方均已退赛';
          E.evaluate(m, E.fmtOfMatch(t, stage, m), stage.tie);
          m.result = null; m.decided = true;
          changed++;
          return;
        }
        m.override = aDead ? 'B' : 'A';
        m.woReason = '对手退赛';
        E.evaluate(m, E.fmtOfMatch(t, stage, m), stage.tie);
        changed++;
      });
    });
    return changed;
  };

  /**
   * 本阶段还能继续打的人：
   * 排除「已淘汰」「已提前晋级」「已退赛 / 取消资格」——
   * 提前晋级者本阶段不再出场，但仍保留在 participants 里参与排名与对手分统计；
   * 退赛者同理留在名单里算历史成绩，但绝不再排进新的对阵。
   */
  E.aliveInStage = function (t, stage) {
    var el = stage.eliminated || [], cl = stage.clinched || [];
    var dead = E.droppedMap(t);
    return (stage.participants || []).filter(function (id) {
      return el.indexOf(id) < 0 && cl.indexOf(id) < 0 && !dead[id];
    });
  };

  /* ============ 提前晋级 / 提前淘汰 ============ */
  // 只有积分制阶段（瑞士轮 / 循环赛 / 小组赛）适用；淘汰赛本身即"输即出局"
  E.clinchSupported = function (stage) {
    return !!(stage && (stage.type === 'swiss' || stage.type === 'round_robin' || stage.type === 'groups'));
  };

  E.clinchCfg = function (stage) {
    var c = (stage && stage.clinch) || {};
    return {
      enabled: !!c.enabled && E.clinchSupported(stage),
      basis: (c.basis === 'game') ? 'game' : 'match',
      winTarget: Math.max(0, parseInt(c.winTarget, 10) || 0),
      lossTarget: Math.max(0, parseInt(c.lossTarget, 10) || 0),
      bonus: parseFloat(c.bonus) || 0,
      bonusPerEarly: parseFloat(c.bonusPerEarly) || 0
    };
  };

  /**
   * 按「每轮结束时的累计战绩」固化提前晋级 / 提前淘汰名单。
   * 幂等：已判定过的人不会重复判定；回退时随 history 快照一起恢复。
   * 对手分不需要额外处理 —— 选手停止出场后仍留在 participants 中，
   * Buchholz 每轮都按对手的「当前积分」重算，所以对手后续赢分，
   * 提前晋级 / 提前淘汰者的对手分照样会跟着变。
   */
  E.ensureClinch = function (t, stage) {
    if (!stage) return { clinched: [], eliminated: [] };
    if (!Array.isArray(stage.clinched)) stage.clinched = [];
    if (!Array.isArray(stage.eliminated)) stage.eliminated = [];
    if (!stage.clinchRound || typeof stage.clinchRound !== 'object') stage.clinchRound = {};
    if (!stage.elimRound || typeof stage.elimRound !== 'object') stage.elimRound = {};

    var c = E.clinchCfg(stage);
    if (!c.enabled || (!c.winTarget && !c.lossTarget)) {
      return { clinched: stage.clinched, eliminated: stage.eliminated };
    }

    var ids = (stage.participants || []).slice();
    (stage.roundsData || []).forEach(function (rd) {
      // 只对「整轮已出成绩」的轮次判定，避免半轮结算造成误判
      if (!E.roundComplete(t, stage, rd).ok) return;
      var stats = E.buildStats(t, stage, ids, null, rd.index);
      ids.forEach(function (id) {
        if (stage.clinched.indexOf(id) >= 0) return;
        if (stage.eliminated.indexOf(id) >= 0) return;
        var s = stats[id];
        if (!s) return;
        var w = (c.basis === 'game') ? s.gamesWon : s.wins;
        var l = (c.basis === 'game') ? s.gamesLost : s.losses;
        // 同一轮同时触线时优先判晋级（对选手更有利，也避免"晋级即淘汰"的矛盾）
        if (c.winTarget > 0 && w >= c.winTarget) {
          stage.clinched.push(id);
          stage.clinchRound[id] = rd.index;
          return;
        }
        if (c.lossTarget > 0 && l >= c.lossTarget) {
          stage.eliminated.push(id);
          stage.elimRound[id] = rd.index;
        }
      });
    });
    return { clinched: stage.clinched, eliminated: stage.eliminated };
  };

  // 提前晋级的"提前轮数"（用于按轮次加权加分）
  E.clinchEarlyBy = function (stage, id) {
    var plan = E.plannedRounds(stage, (stage.participants || []).length);
    var r = stage.clinchRound ? stage.clinchRound[id] : undefined;
    if (r === undefined || r === null) return 0;
    if (!plan) return 0;
    return Math.max(0, plan - 1 - r);
  };

  // 提前晋级者进入下一阶段可获得的加分
  // 注意：只有真正「提前」（在最后一轮之前就锁定）才加分，
  // 最后一轮才达标的属于正常晋级，不加分。
  E.clinchBonusOf = function (stage, id) {
    var c = E.clinchCfg(stage);
    if (!c.enabled) return 0;
    if ((stage.clinched || []).indexOf(id) < 0) return 0;
    var early = E.clinchEarlyBy(stage, id);
    if (early <= 0) return 0;
    var v = c.bonus + c.bonusPerEarly * early;
    return Math.round(v * 1000) / 1000;
  };

  // 是否属于「真正的提前晋级」（在阶段最后一轮之前锁定）
  E.isEarlyClinch = function (stage, id) {
    if ((stage.clinched || []).indexOf(id) < 0) return false;
    return E.clinchEarlyBy(stage, id) > 0;
  };

  // 是否属于「真正的提前淘汰」（在最后一轮之前就出局）
  E.isEarlyElim = function (stage, id) {
    if ((stage.eliminated || []).indexOf(id) < 0) return false;
    var r = stage.elimRound ? stage.elimRound[id] : undefined;
    if (r === undefined || r === null) return false;   // 按名次裁人 / 旧机制
    var plan = E.plannedRounds(stage, (stage.participants || []).length);
    if (!plan) return true;
    return r < plan - 1;
  };

  E.playedSet = function (t, stage, groupIdx) {
    var set = {};
    (stage.roundsData || []).forEach(function (rd) {
      (rd.matches || []).forEach(function (m) {
        if (groupIdx !== null && groupIdx !== undefined && m.group !== groupIdx) return;
        if (m.playerA && m.playerB) set[U.pairKey(m.playerA, m.playerB)] = true;
      });
    });
    return set;
  };

  /* ============ 瑞士轮：轮空挑选 / 随机配对 / 手动编排 ============ */
  /**
   * 按「轮空规则」从本轮名单里挑一个人轮空。
   * entries 需已按积分降序排好（与 swissPairing 的输入一致）。
   */
  E.pickBye = function (entries, rule, roundIndex, rng) {
    if (!entries || !entries.length) return null;
    var list = entries, i, cand = [];
    var r = rng || Math.random;
    rule = rule || 'randomFirst';
    if (rule === 'manual') rule = 'lowest';   // 手动模式下由界面指定，这里退化为最低分
    var isFirst = (roundIndex === 0);
    if (rule === 'random' || (rule === 'randomFirst' && isFirst)) {
      for (i = 0; i < list.length; i++) if (!list[i].hasBye) cand.push(i);
      if (!cand.length) for (i = 0; i < list.length; i++) cand.push(i);
      return list[cand[Math.floor(r() * cand.length)]].id;
    }
    for (i = list.length - 1; i >= 0; i--) {
      if (!list[i].hasBye) return list[i].id;
    }
    return list[list.length - 1].id;
  };

  /** 把重复交手的配对局部换一下（贪心，尽量消除，不保证 100%） */
  E.avoidRepeatPairs = function (pairs, playedSet) {
    function dup(p) { return !!(p && p[0] && p[1] && playedSet[U.pairKey(p[0], p[1])]); }
    var arr = pairs.map(function (p) { return p.slice(); });
    for (var i = 0; i < arr.length; i++) {
      if (!dup(arr[i])) continue;
      var fixed = false;
      for (var j = 0; j < arr.length && !fixed; j++) {
        if (j === i) continue;
        for (var s = 0; s < 2 && !fixed; s++) {
          var a = arr[i][0], b = arr[i][1], c = arr[j][s], d = arr[j][1 - s];
          var ni = [a, c], nj = [b, d];
          if (!dup(ni) && !dup(nj) && a !== c) { arr[i] = ni; arr[j] = nj; fixed = true; }
        }
      }
    }
    return arr;
  };

  /**
   * 随机配对：先按轮空规则挑一个人轮空，其余打乱两两配对，
   * 再尽量把「本阶段已交手过」的组合换开。
   */
  E.randomSwissPairs = function (t, stage, entries, playedSet, roundIndex) {
    var list = (entries || []).slice();
    var byes = [];
    var rng = U.makeRng((t && t.seed ? t.seed : 1) + (roundIndex + 1) * 15485863 + U.randomSeed());
    if (list.length % 2 === 1) {
      var bid = E.pickBye(list, t.byeRule, roundIndex, rng);
      if (bid) { byes.push(bid); list = list.filter(function (e) { return e.id !== bid; }); }
    }
    var ids = list.map(function (e) { return e.id; });
    ids = U.shuffle(ids, rng);            // shuffle 返回新数组，必须接住
    var pairs = [];
    for (var i = 0; i + 1 < ids.length; i += 2) pairs.push([ids[i], ids[i + 1]]);
    pairs = E.avoidRepeatPairs(pairs, playedSet || {});
    return { pairs: pairs, byes: byes };
  };

  /** 本轮可编排的选手名单（未淘汰、未提前晋级、未退赛） */
  E.manualPool = function (t, stage, groupIdx) {
    stage = stage || t.stages[t.currentStage];
    if (stage.type === 'groups' && groupIdx != null && stage.groups && stage.groups[groupIdx]) {
      var g = stage.groups[groupIdx];
      return g.players.filter(function (id) {
        return (stage.eliminated || []).indexOf(id) < 0 &&
          (stage.clinched || []).indexOf(id) < 0;
      });
    }
    return E.aliveInStage(t, stage).slice();
  };

  /** 小组赛：还有哪些组需要（且能）编排本轮 —— 手动编排时界面靠它列组 */
  E.groupArrangePending = function (stage) {
    var out = [];
    if (!stage || stage.type !== 'groups') return out;
    (stage.groups || []).forEach(function (g, gi) {
      if (g.finished) return;
      var alive = (g.players || []).filter(function (id) {
        return (stage.eliminated || []).indexOf(id) < 0 && (stage.clinched || []).indexOf(id) < 0;
      });
      if (alive.length >= 2) out.push({ idx: gi, name: g.name, count: alive.length });
    });
    return out;
  };

  /** 当前阶段/小组能不能进入手动编排（瑞士轮 / 循环赛 / 小组内循环赛·瑞士轮） */
  E.canManualArrange = function (t, stage, rd, opts) {
    opts = opts || {};
    stage = stage || t.stages[t.currentStage];
    if (!stage) return { ok: false, msg: '无当前阶段' };
    // 淘汰赛的「手动」是首轮位摆放（drawMode='manual'），不在这里处理
    if (stage.type === 'single_elim' || stage.type === 'double_elim') {
      return { ok: false, msg: '淘汰赛的手动编排请用设置里的「手动摆放首轮位」，在生成首轮前排好座位' };
    }
    if (stage.type === 'round_robin') {
      if ((stage.pairMode || 'auto') !== 'manual') {
        return { ok: false, msg: '循环赛需把「每轮配对方式」设为「手动编排」才能手动点选配对' };
      }
    } else if (stage.type === 'groups') {
      if ((stage.pairMode || 'auto') !== 'manual') {
        return { ok: false, msg: '小组赛需把「每轮配对方式」设为「手动编排」才能手动点选配对（按组分别编排）' };
      }
      if (opts.groupIdx == null || !stage.groups || !stage.groups[opts.groupIdx]) {
        return { ok: false, msg: '请先选择要编排的小组', pending: E.groupArrangePending(stage) };
      }
    } else if (stage.type !== 'swiss') {
      return { ok: false, msg: '手动编排仅支持瑞士轮 / 循环赛 / 小组赛' };
    }
    var pool = E.manualPool(t, stage, opts.groupIdx);
    if (pool.length < 2) return { ok: false, msg: '可出赛选手不足 2 人' };
    var lastRd = null;
    if (opts.groupIdx != null) {
      // 小组赛：只看「本组」的最后一轮（各组的轮次是各自独立的，不能拿别组的轮次来卡）
      for (var q = stage.roundsData.length - 1; q >= 0; q--) {
        var cand = stage.roundsData[q];
        if (cand.group === opts.groupIdx ||
          (cand.matches || []).some(function (m) { return m.group === opts.groupIdx; })) { lastRd = cand; break; }
      }
    } else {
      lastRd = stage.roundsData[stage.roundsData.length - 1];
    }
    if (lastRd) {
      var rc = E.roundComplete(t, stage, lastRd);
      if (!rc.ok) return { ok: false, msg: '请先完成上一轮：' + rc.msg };
    }
    // 小组赛：告诉界面还有哪些组需要编排（手动模式下每组各自落一轮）
    var pending = (stage.type === 'groups') ? E.groupArrangePending(stage) : null;
    return { ok: true, replace: false, roundIndex: stage.roundsData.length, groupIdx: opts.groupIdx, pending: pending };
  };

  /**
   * 淘汰赛「手动摆放首轮位」：告诉界面要摆几个位、候选有谁、现在是怎样的座位。
   * 只在首轮尚未生成时可用（生成了就先「回退一步」）。
   * @return { ok, size, slots:[id|null], pool:[id], split, lCount, msg }
   */
  E.manualSlots = function (t, stage) {
    stage = stage || (t && t.stages[t.currentStage]);
    if (!stage) return { ok: false, msg: '无当前阶段' };
    if (stage.type !== 'single_elim' && stage.type !== 'double_elim') {
      return { ok: false, msg: '只有单败 / 双败淘汰赛需要摆放首轮位' };
    }
    if ((stage.drawMode || 'seed') !== 'manual') {
      return { ok: false, msg: '请先在阶段设置里把「首轮编排方式」改成「手动摆放首轮位」' };
    }
    if ((stage.roundsData || []).length) {
      return { ok: false, msg: '首轮对阵已经生成。想重新摆放，请先「回退一步」把首轮清掉' };
    }
    var dead = E.droppedMap(t);
    var alive = E.aliveInStage(t, stage).filter(function (id) { return !dead[id]; });
    if (alive.length < 2) return { ok: false, msg: '可出赛选手不足 2 人' };
    var seeded = alive.slice().sort(function (a, b) {
      var pa = t.players.filter(function (x) { return x.id === a; })[0] || {};
      var pb = t.players.filter(function (x) { return x.id === b; })[0] || {};
      return (pa.seed || 9999) - (pb.seed || 9999);
    });

    var size, pool, splitOn = false, lCount = 0;
    if (stage.type === 'single_elim') {
      var plan = E.elimPlan(seeded.length, E.elimTarget(t, stage));
      size = Math.max(2, plan.size);
      pool = seeded;
    } else {
      // 双败：只摆「胜者组」的座位表；启用了「前 N 名从胜者组起跑」时，
      // 进胜者组的人由排名决定（pool = 排名前 N），败者组那边仍按种子排。
      var sp = E.deSplitOf(t, stage, seeded);
      size = U.nextPow2(Math.max(2, sp.w.length));
      pool = sp.w.slice();
      splitOn = !!sp.on;
      lCount = splitOn ? sp.l.length : 0;
    }

    var cur = null;
    if (stage.bracketSlots && stage.bracketSlots.length === size) cur = stage.bracketSlots.slice();
    if (!cur) {
      // 用标准种子位当「初始建议」，用户在此基础上拖动即可
      cur = E.bracketSlots(pool, size, E.rankOrderIds(t, stage, pool));
    }
    // 已被退赛的人从座位上清掉，避免出现幽灵选手
    cur = cur.map(function (id) { return (id && pool.indexOf(id) >= 0) ? id : null; });

    return {
      ok: true, size: size, slots: cur, pool: pool, seeded: seeded,
      split: splitOn, lCount: lCount,
      byes: size - pool.length,
      msg: (stage.type === 'double_elim' ? '胜者组座位表' : '首轮座位表') +
        '：' + size + ' 个位置，' + pool.length + ' 人参赛，其中 ' + (size - pool.length) + ' 个轮空位'
    };
  };

  /**
   * 手动编排：把用户点好的配对写成这一轮。
   * @param pairs [[a,b], ...]（不允许同一人出现两次）
   * @param byeId 轮空的人（人数为奇数时必填；偶数时应为空）
   */
  E.commitManualRound = function (t, stageIndex, pairs, byeId, opts) {
    opts = opts || {};
    var si = (stageIndex === undefined) ? t.currentStage : stageIndex;
    var stage = t.stages[si];
    if (!stage) return { ok: false, msg: '无此阶段' };
    if (stage.type !== 'swiss' && stage.type !== 'round_robin' && stage.type !== 'groups') {
      return {
        ok: false,
        msg: '淘汰赛不能逐轮配桌（下一轮对手由胜负决定），请用设置里的「手动摆放首轮位」排首轮座位'
      };
    }
    var gi = (stage.type === 'groups') ? opts.groupIdx : null;
    if (stage.type === 'groups' && (gi == null || !stage.groups || !stage.groups[gi])) {
      return { ok: false, msg: '请先选择要编排的小组' };
    }
    var alive = E.manualPool(t, stage, gi);
    var pool = {};
    alive.forEach(function (id) { pool[id] = true; });

    var used = [], clean = [];
    (pairs || []).forEach(function (p) {
      if (!p || !p[0] || !p[1]) return;
      clean.push([p[0], p[1]]);
    });
    for (var i = 0; i < clean.length; i++) {
      for (var s = 0; s < 2; s++) {
        var id = clean[i][s];
        if (!pool[id]) return { ok: false, msg: '「' + E.nameOf(t, id) + '」不在本轮可出赛名单里（可能已退赛 / 已淘汰 / 已提前晋级）' };
        if (used.indexOf(id) >= 0) return { ok: false, msg: '「' + E.nameOf(t, id) + '」被安排了两次，请检查' };
        used.push(id);
      }
    }
    byeId = byeId || null;
    if (byeId) {
      if (!pool[byeId]) return { ok: false, msg: '轮空的人不在本轮名单里' };
      if (used.indexOf(byeId) >= 0) return { ok: false, msg: '轮空的人已经被安排了比赛' };
    }
    var needBye = (alive.length % 2 === 1);
    if (needBye && !byeId) return { ok: false, msg: '本轮 ' + alive.length + ' 人（奇数），请指定 1 人轮空' };
    if (!needBye && byeId) return { ok: false, msg: '本轮 ' + alive.length + ' 人（偶数），不需要轮空' };
    var covered = used.length + (byeId ? 1 : 0);
    if (covered !== alive.length) {
      return { ok: false, msg: '还有 ' + (alive.length - covered) + ' 人没有安排，请先把所有人排进对阵或轮空' };
    }
    if (!clean.length) return { ok: false, msg: '至少要安排 1 桌对阵' };

    // 顶层（瑞士轮 / 循环赛）：允许在没有成绩时覆盖最后一轮；小组：每组独立落一轮
    var rIdx, newRd, ms;
    if (stage.type !== 'groups' && opts.replace) {
      var oldRd = E.currentRound(stage);
      var ck = E.canArrangeRound(t, stage, oldRd);
      if (!ck.ok) return ck;
      rIdx = oldRd.index;
      ms = clean.map(function (p) { return E.mkMatch(rIdx, p[0], p[1], gi); });
      if (byeId) {
        var bm2 = E.mkMatch(rIdx, byeId, null, gi);
        bm2.isBye = true;
        ms.push(bm2);
      }
      ms.forEach(function (m) { E.evaluate(m, E.fmtOfMatch(t, stage, m), stage.tie); });
      newRd = { index: rIdx, matches: ms, manual: true, group: gi };
      stage.roundsData[stage.roundsData.length - 1] = newRd;
    } else {
      rIdx = stage.roundsData.length;
      ms = clean.map(function (p) { return E.mkMatch(rIdx, p[0], p[1], gi); });
      if (byeId) {
        var bm = E.mkMatch(rIdx, byeId, null, gi);
        bm.isBye = true;
        ms.push(bm);
      }
      ms.forEach(function (m) { E.evaluate(m, E.fmtOfMatch(t, stage, m), stage.tie); });
      newRd = { index: rIdx, matches: ms, manual: true, group: gi };
      stage.roundsData.push(newRd);
    }
    stage.status = 'running';
    if (byeId) {
      var pb = t.players.filter(function (x) { return x.id === byeId; })[0];
      if (pb) pb.hasBye = true;
    }
    var where = (stage.type === 'groups') ? (stage.groups[gi].name + ' · ') : '';
    return { ok: true, msg: '已生成' + where + '第 ' + (rIdx + 1) + ' 轮：' + clean.length + ' 桌' + (byeId ? '，' + E.nameOf(t, byeId) + ' 轮空' : '') };
  };

  /* ============ 手动编排 / 随机抽签 ============ */
  E.currentRound = function (stage) {
    if (!stage || !stage.roundsData || !stage.roundsData.length) return null;
    return stage.roundsData[stage.roundsData.length - 1];
  };

  // 本轮是否还能改对阵：必须是最后一轮，且尚无任何成绩
  E.canArrangeRound = function (t, stage, rd) {
    stage = stage || t.stages[t.currentStage];
    rd = rd || E.currentRound(stage);
    if (!stage) return { ok: false, msg: '无当前阶段' };
    if (!rd) return { ok: false, msg: '尚未生成对阵' };
    if (rd.index !== stage.roundsData.length - 1) return { ok: false, msg: '只能编排最后一轮' };
    if (stage.status === 'finished' || t.status === 'finished') return { ok: false, msg: '比赛已结束，无法编排' };
    var ms = rd.matches || [];
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      if (m.isBye) continue;
      if ((m.games || []).length || m.decided || m.override) {
        return { ok: false, msg: '本轮已录入成绩，如需重排请先撤销录入或回退一步' };
      }
    }
    return { ok: true };
  };

  // 本轮涉及的选手（保持出现顺序）
  E.roundPool = function (rd) {
    var ids = [];
    (rd.matches || []).forEach(function (m) {
      if (m.playerA && ids.indexOf(m.playerA) < 0) ids.push(m.playerA);
      if (m.playerB && ids.indexOf(m.playerB) < 0) ids.push(m.playerB);
    });
    return ids;
  };

  // 重算轮次中的轮空标记与成绩（保留尚未填人的空桌）
  E.refreshRound = function (t, stage, rd) {
    rd.matches = rd.matches || [];
    rd.matches.forEach(function (m) {
      m.__empty = !(m.playerA || m.playerB);
      m.isBye = !!((m.playerA && !m.playerB) || (!m.playerA && m.playerB));
      if (m.isBye) { m.games = []; m.override = null; }
      E.evaluate(m, E.fmtOfMatch(t, stage, m), stage.tie);
    });
    return rd;
  };

  /**
   * 随机重排本轮：在「本轮现有选手池」内重新随机配对
   * 小组赛按各自小组内部重排，不会跨组
   */
  E.randomizeRound = function (t, stageIndex) {
    var stage = t.stages[stageIndex === undefined ? t.currentStage : stageIndex];
    var rd = E.currentRound(stage);
    var chk = E.canArrangeRound(t, stage, rd);
    if (!chk.ok) return chk;

    var rng = U.makeRng(U.randomSeed());
    var buckets = {}, order = [];
    if (stage.type === 'groups') {
      (rd.matches || []).forEach(function (m) {
        var k = (m.group === null || m.group === undefined) ? '_' : String(m.group);
        if (!buckets[k]) { buckets[k] = []; order.push(k); }
        [m.playerA, m.playerB].forEach(function (id) {
          if (id && buckets[k].indexOf(id) < 0) buckets[k].push(id);
        });
      });
    } else {
      buckets['_'] = E.roundPool(rd);
      order.push('_');
    }

    var out = [];
    order.forEach(function (k) {
      var gi = (k === '_') ? null : parseInt(k, 10);
      var pool = U.shuffle(buckets[k], rng);
      for (var i = 0; i + 1 < pool.length; i += 2) out.push([pool[i], pool[i + 1], gi]);
      if (pool.length % 2 === 1) out.push([pool[pool.length - 1], null, gi]);
    });
    if (!out.length) return { ok: false, msg: '本轮没有可重排的选手' };

    rd.matches = out.map(function (p) {
      var m = E.mkMatch(rd.index, p[0], p[1], p[2]);
      if (!p[1]) m.isBye = true;
      return m;
    });
    E.refreshRound(t, stage, rd);
    return { ok: true, msg: '已随机重排本轮：' + rd.matches.length + ' 桌' };
  };

  /**
   * 手动指派某桌的选手；若该选手已在别桌，则两边自动对调
   * slot: 'A' | 'B'，playerId 为空表示清空（清空后对手轮空）
   */
  E.setMatchSlot = function (t, matchId, slot, playerId) {
    var stage = t.stages[t.currentStage];
    var rd = E.currentRound(stage);
    var chk = E.canArrangeRound(t, stage, rd);
    if (!chk.ok) return chk;

    var m = null;
    (rd.matches || []).forEach(function (x) { if (x.id === matchId) m = x; });
    if (!m) return { ok: false, msg: '未找到该桌对阵' };

    playerId = playerId || null;
    var oldId = (slot === 'A') ? m.playerA : m.playerB;
    if (oldId === playerId) return { ok: true };

    if (playerId) {
      var other = null, otherSlot = null;
      (rd.matches || []).forEach(function (x) {
        if (x === m) return;
        if (x.playerA === playerId) { other = x; otherSlot = 'A'; }
        else if (x.playerB === playerId) { other = x; otherSlot = 'B'; }
      });
      // 双败：胜者组与败者组不能互相调人（会打乱两组归属）
      if (other && stage.type === 'double_elim' && other.bracket !== m.bracket) {
        return { ok: false, msg: '双败淘汰中，胜者组与败者组的选手不能互换' };
      }
      if (other) {
        // 对调：把本桌原选手放到对方位置
        if (otherSlot === 'A') other.playerA = oldId; else other.playerB = oldId;
        if (stage.type === 'groups') other.group = m.group;
      }
    }
    if (slot === 'A') m.playerA = playerId; else m.playerB = playerId;
    E.refreshRound(t, stage, rd);
    return { ok: true };
  };

  // 新增一张空桌（等待选择选手）
  E.addMatchToRound = function (t) {
    var stage = t.stages[t.currentStage];
    var rd = E.currentRound(stage);
    var chk = E.canArrangeRound(t, stage, rd);
    if (!chk.ok) return chk;
    var gi = null;
    if (stage.type === 'groups' && rd.matches.length) gi = rd.matches[0].group;
    var m = E.mkMatch(rd.index, null, null, gi);
    m.__empty = true;
    rd.matches.push(m);
    return { ok: true, msg: '已新增一张空桌' };
  };

  // 删除一张桌（选手回到未安排池）
  E.removeMatchFromRound = function (t, matchId) {
    var stage = t.stages[t.currentStage];
    var rd = E.currentRound(stage);
    var chk = E.canArrangeRound(t, stage, rd);
    if (!chk.ok) return chk;
    rd.matches = (rd.matches || []).filter(function (m) { return m.id !== matchId; });
    return { ok: true, msg: '已删除该桌' };
  };

  // 本轮尚未安排上场的选手
  E.unassignedInRound = function (t, stage, rd) {
    var pool = E.aliveInStage(t, stage);
    var used = E.roundPool(rd);
    return pool.filter(function (id) { return used.indexOf(id) < 0; });
  };

  /* ============ 轮次完成检查 ============ */
  E.roundComplete = function (t, stage, rd) {
    var ms = rd.matches || [];
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      if (m.isBye) continue;
      if (!m.playerA && !m.playerB) continue;   // 编排过程中的空桌
      if (!m.decided) {
        var na = E.nameOf(t, m.playerA), nb = E.nameOf(t, m.playerB);
        return { ok: false, msg: '未完成：' + na + ' vs ' + nb };
      }
    }
    return { ok: true };
  };

  E.nameOf = function (t, id) {
    if (!id) return '（轮空）';
    var p = t.players.filter(function (x) { return x.id === id; })[0];
    return p ? p.name : '（未知）';
  };

  /* ============ 结束一轮：处理中途淘汰 ============ */
  E.finishRound = function (t) {
    var stage = t.stages[t.currentStage];
    if (!stage || !stage.roundsData.length) return { ok: false, msg: '无进行中的轮次' };
    var rd = stage.roundsData[stage.roundsData.length - 1];
    var chk = E.roundComplete(t, stage, rd);
    if (!chk.ok) return chk;

    // 编排过程中残留的空桌，收尾时清理
    rd.matches = (rd.matches || []).filter(function (m) { return m.playerA || m.playerB; });

    if (stage.type === 'double_elim') {
      var r = E.deCommitPending(t, stage);
      if (!r.ok) return r;
    }

    // 中途淘汰
    var extraMsg = '';
    if (stage.elim && stage.elim.enabled) {
      var afterRound = parseInt(stage.elim.afterRound, 10) || 0;
      if (rd.index === afterRound) {
        var keep = Math.max(1, parseInt(stage.elim.keep, 10) || 1);
        var st;
        if (stage.type === 'groups') {
          // 每组保留前 N 名
          for (var gi = 0; gi < stage.groups.length; gi++) {
            st = E.standings(t, { stageIndex: stage.index, groupIdx: gi });
            st.slice(keep).forEach(function (s) {
              if (stage.eliminated.indexOf(s.id) < 0) stage.eliminated.push(s.id);
            });
          }
        } else {
          st = E.standings(t, { stageIndex: stage.index });
          st.slice(keep).forEach(function (s) {
            if (stage.eliminated.indexOf(s.id) < 0) stage.eliminated.push(s.id);
          });
        }
        extraMsg = '（按名次裁至前 ' + keep + ' 名）';
      }
    }

    // 提前晋级 / 提前淘汰：按本轮结束后的累计战绩自动判定
    if (E.clinchSupported(stage) && E.clinchCfg(stage).enabled) {
      var nCl = (stage.clinched || []).length, nEl = (stage.eliminated || []).length;
      E.ensureClinch(t, stage);
      var dCl = (stage.clinched || []).length - nCl;
      var dEl = (stage.eliminated || []).length - nEl;
      if (dCl > 0) extraMsg += '；本轮新增 ' + dCl + ' 人提前晋级';
      if (dEl > 0) extraMsg += '；本轮新增 ' + dEl + ' 人被淘汰';
    }
    return { ok: true, msg: '本轮已完成' + extraMsg };
  };

  /* ============ 阶段是否结束 ============ */
  E.stageFinished = function (t, stage) {
    // 阶段尚未初始化参赛名单 → 视为未开始（否则会误判为已结束）
    if (!stage.participants || !stage.participants.length) return false;

    if (stage.type === 'double_elim') {
      if (!stage.de) return false;
      return E.deFinished(stage);
    }
    if (stage.type === 'groups') {
      // 所有小组都不再能生成新对阵
      if (!stage.groups || !stage.groups.length) return false;
      var ccfgG = E.clinchCfg(stage);
      if (ccfgG.enabled && (ccfgG.winTarget || ccfgG.lossTarget) && stage.roundsData.length) {
        var elG = stage.eliminated || [], clG = stage.clinched || [];
        return stage.groups.every(function (g) {
          if (g.finished) return true;
          var n = (g.players || []).filter(function (id) {
            return elG.indexOf(id) < 0 && clG.indexOf(id) < 0;
          }).length;
          return n <= 1;
        });
      }
      return stage.groups.every(function (g) { return !!g.finished; });
    }

    // 提前晋级 / 提前淘汰：还没打之前不做判断；打起来之后剩余未定者不足 2 人即视为结束
    var ccfg = E.clinchCfg(stage);
    if (ccfg.enabled && (ccfg.winTarget || ccfg.lossTarget) && stage.roundsData.length) {
      if (E.aliveInStage(t, stage).length <= 1) return true;
    }

    var plan = E.plannedRounds(stage, (stage.participants || []).length);
    if (plan === null) return false;
    return stage.roundsData.length >= plan;
  };

  // 标记小组结束
  E.refreshGroupFinished = function (t, stage) {
    if (stage.type !== 'groups' || !stage.groups) return;
    var plan = E.plannedRounds(
      { type: stage.groupType, rounds: stage.groupRounds, cycles: stage.groupCycles },
      0
    );
    stage.groups.forEach(function (g, gi) {
      if (stage.groupType === 'double_elim') {
        // 组内双败：状态机打完 / 组内总决赛已分出胜负 → 本组结束
        if (E.groupDEFinished(stage, g)) g.finished = true;
        return;
      }
      var pr = E.plannedRounds(
        { type: stage.groupType, rounds: stage.groupRounds, cycles: stage.groupCycles },
        g.players.length
      );
      var played = stage.roundsData.filter(function (rd) {
        return rd.matches.some(function (m) { return m.group === gi; });
      }).length;
      if (pr !== null && played >= pr) g.finished = true;
      // 提前晋级 / 提前淘汰：组内剩余未定者不足 2 人，本组自然结束
      var ccfg = E.clinchCfg(stage);
      if (ccfg.enabled && (ccfg.winTarget || ccfg.lossTarget)) {
        var aliveN = (g.players || []).filter(function (id) {
          return (stage.eliminated || []).indexOf(id) < 0 && (stage.clinched || []).indexOf(id) < 0;
        }).length;
        if (aliveN <= 1 && stage.roundsData.length) g.finished = true;
      }
      if (stage.groupType === 'single_elim') {
        // 单败：当只剩 1 人时结束
        var last = null;
        for (var w = stage.roundsData.length - 1; w >= 0; w--) {
          if (stage.roundsData[w].matches.some(function (m) { return m.group === gi; })) { last = stage.roundsData[w]; break; }
        }
        if (last) {
          var cnt = last.matches.filter(function (m) { return m.group === gi; }).length;
          if (cnt === 1 && last.matches.filter(function (m) { return m.group === gi; })[0].decided) g.finished = true;
        }
      }
    });
  };

  /* ============ 淘汰赛最终名次（按 bracket 结果，而非仅积分） ============ */
  E.seedOf = function (t, id) {
    var p = t.players.filter(function (x) { return x.id === id; })[0];
    return (p && p.seed) ? p.seed : 9999;
  };

  /**
   * 淘汰赛最终名次（按 bracket 结果，而非仅积分）
   * - 单败：决赛胜者=冠军，决赛负者=亚军；有季军赛时季军赛胜者=第3
   * - 双败：总决赛胜者=冠军，总决赛负者=亚军，败者组决赛负者=第3
   *   其余人按「被淘汰的轮次」倒序 —— 双败看第二次输、单败看第一次输
   */
  /**
   * 淘汰赛最终名次。
   * 统一按「负场数 → 最后一次获胜轮次 → 种子序」排序，因此同时适用于：
   *   ① 打完整棵对阵树的单败 / 双败；
   *   ② 被 maxRounds 提前掐断的阶段性淘汰赛（此时不存在"决赛"，不能取最后一场）。
   * 旧实现取「最后一场」当决赛，在只有一轮时会把该轮第一场误判为决赛，
   * 导致同一轮的胜者排在负者之后、赢了比赛反而晋不了级。
   */
  E.computeElimRanking = function (t, stage) {
    var rds = stage.roundsData || [];
    if (!rds.length) return null;

    var bothLose = !!(stage.drawBothLose);   // 平局 = 双方都输
    var lossCount = {}, lastWin = {}, seen = {};
    var third = null, k, m, w, l;
    var gfMatches = [];
    var gfDraw = null;                       // 总决赛打成平局时的两位参赛者

    function touch(id) {
      if (!id || seen[id]) return;
      seen[id] = true; lossCount[id] = 0; lastWin[id] = -1;
    }
    (stage.participants || []).forEach(touch);
    rds.forEach(function (rd) { (rd.matches || []).forEach(function (x) { touch(x.playerA); touch(x.playerB); }); });

    for (k = 0; k < rds.length; k++) {
      var ms = rds[k].matches || [];
      for (var j = 0; j < ms.length; j++) {
        m = ms[j];
        touch(m.playerA); touch(m.playerB);
        // 季军赛单独处理：它只决定第 3、4 名，不参与主干排序
        if (m.isThird) {
          if (m.result && m.result.winner) third = m;
          continue;
        }
        // 总决赛单独记录：冠军 / 亚军由总决赛结果直接决定
        if (rds[k].isGF || m.isGF) {
          if (m.result && m.result.winner) gfMatches.push(m);
          else if (bothLose && m.result && m.result.settled && m.playerA && m.playerB) {
            // 总决赛平局：两边各记一负。胜者组冠军是第 1 负（活下来），
            // 败者组冠军已是第 2 负（当场淘汰）
            gfDraw = m;
            if (lossCount[m.playerA] !== undefined) lossCount[m.playerA] += 1;
            if (lossCount[m.playerB] !== undefined) lossCount[m.playerB] += 1;
          }
          continue;
        }
        if (!m.result || !m.result.winner) {
          // 平局且开了「双方都输」：两边各记一负，谁也不算赢
          if (bothLose && m.result && m.result.settled && m.playerA && m.playerB) {
            if (lossCount[m.playerA] !== undefined) lossCount[m.playerA] += 1;
            if (lossCount[m.playerB] !== undefined) lossCount[m.playerB] += 1;
          }
          continue;   // 未决出不计
        }
        w = m.result.winner === 'A' ? m.playerA : m.playerB;
        l = m.result.winner === 'A' ? m.playerB : m.playerA;
        if (w && lastWin[w] !== undefined && rds[k].index > lastWin[w]) lastWin[w] = rds[k].index;
        if (l && lossCount[l] !== undefined) lossCount[l] += 1;
      }
    }

    var ids = Object.keys(lossCount);
    ids.sort(function (a, b) {
      if (lossCount[a] !== lossCount[b]) return lossCount[a] - lossCount[b];
      if (lastWin[a] !== lastWin[b]) return lastWin[b] - lastWin[a];
      return E.seedOf(t, a) - E.seedOf(t, b);
    });

    // 有总决赛 → 最后一场总决赛的胜者 = 冠军、负者 = 亚军。
    // 不能只靠负场数：无优势制下双方可能同为 1 负，会排错。
    if (gfMatches.length) {
      var last = gfMatches[gfMatches.length - 1];
      var champ = last.result.winner === 'A' ? last.playerA : last.playerB;
      var runner = last.result.winner === 'A' ? last.playerB : last.playerA;
      if (champ) {
        ids = ids.filter(function (x) { return x !== champ && x !== runner; });
        if (runner) ids.unshift(runner);
        ids.unshift(champ);
      }
    }

    // 总决赛打成平局（双方都输）：总负场少的一方是冠军，另一方是亚军。
    // 正常情况下胜者组冠军 1 负、败者组冠军 2 负，所以仍是胜者组冠军夺冠、败者组冠军居亚。
    if (!gfMatches.length && gfDraw) {
      var dA = gfDraw.playerA, dB = gfDraw.playerB;
      var dc = (lossCount[dA] <= lossCount[dB]) ? dA : dB;
      var dr = (dc === dA) ? dB : dA;
      ids = ids.filter(function (x) { return x !== dA && x !== dB; });
      if (dr) ids.unshift(dr);
      ids.unshift(dc);
    }

    // 有季军争夺战时，把这两人固定到第 3、4 位
    if (third) {
      var tw = third.result.winner === 'A' ? third.playerA : third.playerB;
      var tl = third.result.winner === 'A' ? third.playerB : third.playerA;
      var i1 = ids.indexOf(tw), i2 = ids.indexOf(tl);
      if (i2 >= 0) ids.splice(i2, 1);
      if (i1 >= 0) ids.splice(i1, 1);
      ids.splice(2, 0, tw, tl);
    }

    return ids;
  };

  /* ============ 完整对阵图（结构化，未定的格子写清「谁打上来的」） ============
   * 与 bracketGraph 的区别：bracketGraph 只反映「已经生成的比赛」，
   * 这里按阶段配置把整棵树一次性算出来，没打的格子也给出明确来源标签，
   * 例如「第 2 轮 第 1 场胜者」「胜者组第 1 轮 第 3 场败者」「败者组第 2 轮 第 1 场胜者」。
   * 返回 { type, rows:[{key,name,cols:[{name,sub,cards,note}]}], totalCols, banner }
   *   card = { key, title, a, b, winTo, loseTo, isBye, live, done, m }
   *   slot = { id, text, score, advA, isBye, pending }
   */
  E.bracketPlan = function (t, stage) {
    if (!stage) return null;
    var isDE = (stage.type === 'double_elim');
    var n = (stage.participants || []).length;
    var nm = function (id) { return id ? (E.nameOf(t, id) || '?') : ''; };
    var Wgroups = [], Lgroups = [], gfMs = [], thirdMs = [];

    (stage.roundsData || []).forEach(function (rd) {
      var w = [], l = [];
      (rd.matches || []).forEach(function (m) {
        if (m.isThird) { thirdMs.push(m); return; }
        if (rd.isGF || m.isGF) { gfMs.push(m); return; }
        (m.bracket === 'L' ? l : w).push(m);
      });
      if (w.length) Wgroups.push(w);
      if (l.length) Lgroups.push(l);
    });

    /* ---- 把一个实际比赛变成卡片；没有比赛就用来源标签 ---- */
    var deadMap = E.droppedMap(t);
    function card(key, title, srcA, srcB, m) {
      var a, b;
      if (m) {
        var rg = m.result || {};
        var wi = (m.result && m.result.winner) ? (m.result.winner === 'A' ? m.playerA : m.playerB) : null;
        var shown = !!m.decided && !m.isBye;
        a = {
          id: m.playerA || null, text: m.playerA ? nm(m.playerA) : (m.isBye ? '轮空' : srcA),
          score: rg.gamesA || 0, adv: rg.advA || 0, win: !!wi && wi === m.playerA,
          isBye: !!m.isBye, shown: shown, dropped: !!(m.playerA && deadMap[m.playerA])
        };
        b = {
          id: m.playerB || null, text: m.playerB ? nm(m.playerB) : (m.isBye ? '—' : srcB),
          score: rg.gamesB || 0, adv: rg.advB || 0, win: !!wi && wi === m.playerB,
          isBye: !!m.isBye, shown: shown, dropped: !!(m.playerB && deadMap[m.playerB])
        };
      } else {
        a = { id: null, text: srcA, score: 0, adv: 0, win: false, pending: true, dropped: false };
        b = { id: null, text: srcB, score: 0, adv: 0, win: false, pending: true, dropped: false };
      }
      var elevTag = '';
      if (m && m.gfElev) {
        var en = E.gfElevNeed(m);
        elevTag = (en > m.gfElev.base) ? ('已升格 · 需 ' + en + ' 胜') : ('需 ' + en + ' 胜');
      }
      return {
        key: key, title: title, a: a, b: b,
        isBye: !!(m && m.isBye), done: !!(m && m.decided), m: m || null,
        wo: (m && m.woReason) || '', voided: !!(m && m.voided), elev: elevTag,
        winTo: '', loseTo: ''
      };
    }

    function takeGroup(groups, idx, count) {
      var g = groups[idx] || [];
      var out = new Array(count);
      if (!g.length) return out;
      var i;
      if (g.length === count) {
        for (i = 0; i < count; i++) out[i] = g[i];
        return out;
      }
      // 数量不一致（轮空被合并等）：先放真打的，再放轮空
      var real = g.filter(function (m) { return !m.isBye; });
      var bye = g.filter(function (m) { return m.isBye; });
      for (i = 0; i < count; i++) out[i] = real[i] || bye[i - real.length] || null;
      return out;
    }

    if (!isDE) {
      /* ---------------- 单败 ---------------- */
      var T = stage.elimTarget || E.elimTarget(t, stage);
      var plan = E.elimPlan(n, T);
      var R = stage.elimRounds || plan.rounds;
      var size = stage.elimSize || plan.size;
      if (R < 1) {
        return { type: 'single', rows: [], totalCols: 0, banner: '参赛人数不足 2 人，无法生成对阵。' };
      }
      // 座位：已经生成就用真实对阵还原，否则按种子位现算（开赛前也能看到完整对阵）
      var seats = [], i, k;
      if (Wgroups[0] && Wgroups[0].length) {
        Wgroups[0].forEach(function (m) {
          if (m.isBye) seats.push(m.playerA || m.playerB, null);
          else seats.push(m.playerA, m.playerB);
        });
      } else {
        var seeded = (stage.participants || []).slice().sort(function (x, y) {
          return E.seedOf(t, x) - E.seedOf(t, y);
        });
        seats = E.drawSlots(t, stage, seeded, size);
      }
      var cols = [];
      // 列名：打到冠军时保留「半决赛 / 决赛」的俗称，按晋级人数收口时统一用「第 N 轮」
      function colName(r) {
        if (r < 1) return '';
        if (T <= 1) {
          if (r === R) return '决赛';
          if (r === R - 1) return '半决赛';
        }
        if (r === R && T > 1) return '第 ' + r + ' 轮 · 晋级轮';
        return '第 ' + r + ' 轮';
      }
      // 逐轮把座位两两配对：两边都有人才是「一场比赛」，只有一边就把该选手直接放进下一轮（轮空）
      var level = seats.map(function (pid) { return pid ? { kind: 'p', id: pid } : null; });
      function srcText(node) {
        if (!node) return '';
        if (node.kind === 'p') return nm(node.id);
        return colName(node.round) + ' 第 ' + node.idx + ' 场胜者';
      }
      for (var rr = 1; rr <= R; rr++) {
        var name = colName(rr);
        var cards = [], nextLevel = [];
        var realMs = (Wgroups[rr - 1] || []).filter(function (m) { return !m.isBye; });
        var mi = 0, alive = 0;
        for (i = 0; i < level.length; i += 2) {
          var A = level[i], B = level[i + 1];
          if (!A && !B) { nextLevel.push(null); continue; }
          if (!A || !B) { nextLevel.push(A || B); alive += 1; continue; }  // 轮空 → 直接晋级
          var m = realMs[mi] || null;
          var cd = card('S|' + rr + '|' + mi, name + ' 第 ' + (mi + 1) + ' 场',
            srcText(A), srcText(B), m);
          cards.push(cd);
          nextLevel.push({ kind: 'm', round: rr, idx: mi + 1, card: cd });
          mi++; alive += 2;
        }
        cols.push({
          name: name,
          sub: '本轮 ' + alive + ' 人 · ' + cards.length + ' 场',
          cards: cards
        });
        level = nextLevel;
      }
      // 去向：胜者进下一轮对应的那一格；负者淘汰；最后一轮按目标人数收口
      cols.forEach(function (col, ci) {
        col.cards.forEach(function (cd, mi2) {
          if (ci === cols.length - 1) {
            cd.winTo = (T <= 1) ? '夺冠（无后续比赛）' : ('晋级下一阶段（本阶段取 ' + T + ' 人）');
            cd.loseTo = '淘汰';
            return;
          }
          // 下一轮哪一格来收这一场的胜者：找下一列里引用了「本轮 第 mi2+1 场胜者」的卡片
          var want = col.name + ' 第 ' + (mi2 + 1) + ' 场胜者';
          var hit = null;
          cols[ci + 1].cards.forEach(function (nx, ni) {
            if (!hit && (nx.a.text === want || nx.b.text === want)) hit = ni + 1;
          });
          cd.winTo = cols[ci + 1].name + ' 第 ' + (hit || (Math.floor(mi2 / 2) + 1)) + ' 场';
          cd.loseTo = '淘汰';
        });
      });
      var banner = '本阶段 ' + n + ' 人 → 取 ' + T + ' 人：共 <b>' + R + ' 轮</b>，'
        + '对阵表规模 ' + size + ' 位，首轮 ' + (size - n) + ' 人轮空'
        + ((size - n) > 0 ? '（轮空者直接在下一轮出场）' : '') + '。'
        + '<br>首轮编排：' + E.drawLabel(stage) + (stage.roundsData && stage.roundsData.length ? '' : '（尚未生成，生成时抽签）');
      return {
        type: 'single',
        banner: banner,
        totalCols: cols.length,
        rows: [{ key: 'W', name: '淘汰赛', cols: cols }],
        third: thirdMs[0] || null
      };
    }

    /* ---------------- 双败 ---------------- */
    // 分组起跑（前 N 名进胜者组、其余从败者组打起）不是标准二叉树，
    // 用状态机骨架推演出完整结构来画，避免「按公式硬画」和实际对阵对不上。
    var splitTop = E.deSplitTopOf(t, stage);
    if (splitTop >= 2) {
      return splitDEPlan(splitTop);
    }

    function splitDEPlan(top) {
      var ids = (stage.participants || []).slice();
      var sk = E.deSkeleton(t, stage, ids);
      var rounds = stage.roundsData || [];
      function realOf(c, br, byeOnly) {
        var rd = rounds[c - 1];
        if (!rd) return [];
        return (rd.matches || []).filter(function (x) {
          if (x.isGF || x.isThird) return false;
          if ((x.bracket === 'L') !== (br === 'L')) return false;
          return (!!x.isBye) === !!byeOnly;
        });
      }
      function tokLabel(tk) {
        if (!tk) return '';
        if (tk.kind === 'p') return nm(tk.id) || '?';
        return (tk.br === 'W' ? '胜者组' : '败者组') + '第 ' + tk.col + ' 轮 第 ' + tk.idx + ' 场'
          + (tk.win ? '胜者' : '败者');
      }
      var all = [], wCards = [], lCards = [], tokKey = {};

      function pushCard(cd, toks, outWin, outLose) {
        cd._toks = toks;
        cd._outW = outWin;
        cd._outL = outLose;
        all.push(cd);
        return cd;
      }

      sk.cols.forEach(function (col, ci) {
        var c = ci + 1;
        var wname = '胜者组第 ' + c + ' 轮';
        var realW = realOf(c, 'W', false), realWB = realOf(c, 'W', true);
        var wc = [];
        (col.pairsW || []).forEach(function (pair, i) {
          var cd = card('SW|' + c + '|' + i, wname + ' 第 ' + (i + 1) + ' 场',
            tokLabel(pair[0]), tokLabel(pair[1]), realW[i] || null);
          pushCard(cd, pair, 'W|' + c + '|' + (i + 1) + '|1', 'W|' + c + '|' + (i + 1) + '|0');
          tokKey['W|' + c + '|' + (i + 1) + '|1'] = cd;
          tokKey['W|' + c + '|' + (i + 1) + '|0'] = cd;
          pair.forEach(function (tk) { if (tk && tk.kind === 'p') tokKey['P|' + tk.id] = cd; });
          wc.push(cd);
        });
        (col.byesW || []).forEach(function (tk, i) {
          var cd = card('SWB|' + c + '|' + i, wname + ' 轮空', tokLabel(tk), '轮空', realWB[i] || null);
          pushCard(cd, [tk], null, null);
          if (tk && tk.kind === 'p') tokKey['P|' + tk.id] = cd;
          wc.push(cd);
        });
        if (wc.length) {
          wCards.push({
            name: wname,
            sub: '本轮 ' + ((col.pairsW || []).length * 2 + (col.byesW || []).length) + ' 人 · ' + wc.length + ' 桌',
            cards: wc
          });
        }

        var lname = '败者组第 ' + c + ' 轮';
        var realL = realOf(c, 'L', false), realLB = realOf(c, 'L', true);
        var lc = [];
        (col.pairsL || []).forEach(function (pair, i) {
          var cd = card('SL|' + c + '|' + i, lname + ' 第 ' + (i + 1) + ' 场',
            tokLabel(pair[0]), tokLabel(pair[1]), realL[i] || null);
          pushCard(cd, pair, 'L|' + c + '|' + (i + 1) + '|1', 'L|' + c + '|' + (i + 1) + '|0');
          tokKey['L|' + c + '|' + (i + 1) + '|1'] = cd;
          tokKey['L|' + c + '|' + (i + 1) + '|0'] = cd;
          pair.forEach(function (tk) { if (tk && tk.kind === 'p') tokKey['P|' + tk.id] = cd; });
          lc.push(cd);
        });
        (col.byesL || []).forEach(function (tk, i) {
          var cd = card('SLB|' + c + '|' + i, lname + ' 轮空', tokLabel(tk), '轮空', realLB[i] || null);
          pushCard(cd, [tk], null, null);
          if (tk && tk.kind === 'p') tokKey['P|' + tk.id] = cd;
          lc.push(cd);
        });
        if (lc.length) {
          lCards.push({
            name: lname,
            sub: '本轮 ' + ((col.pairsL || []).length * 2 + (col.byesL || []).length) + ' 人 · ' + lc.length + ' 桌',
            cards: lc
          });
        }
      });

      // 总决赛
      var mode = stage.gfMode || 'reset';
      var gf1 = null, gf2 = null;
      gfMs.forEach(function (x) { if (x.gfRound === 'reset') gf2 = x; else gf1 = x; });
      var gfPair = (sk.gf && sk.gf.pairsW && sk.gf.pairsW[0]) || [null, null];
      var elevCfg = (mode === 'elevate') ? E.gfElevCfg(t, stage) : null;
      var gfCols = [{
        name: '总决赛',
        sub: (mode === 'elevate')
          ? ('一场定胜负 · 比分累计：先到 ' + elevCfg.base + ' 局；败者组冠军先到 ' + elevCfg.base
            + ' 局后升为 ' + elevCfg.up + ' 局')
          : (mode === 'reset' ? '加赛制：败者组冠军需赢两场' : '一场定胜负'),
        cards: [card('GF|1|0', '总决赛 第 1 场', tokLabel(gfPair[0]), tokLabel(gfPair[1]), gf1)]
      }];
      if (mode === 'reset') {
        gfCols.push({
          name: '加赛局',
          sub: '仅当败者组冠军赢下首场才进行',
          cards: [card('GF|2|0', '加赛局 第 1 场', '胜者组冠军', '败者组冠军', gf2)]
        });
      }

      // 去向：胜者往右走（查这张卡的「胜者占位」画在哪一列），负者掉败者组，败者组再输就淘汰
      all.forEach(function (cd) {
        var isW = (cd.key || '').indexOf('SW') === 0 || (cd.key || '').indexOf('SL') === 0;
        var br = (cd.key || '').indexOf('SL') === 0 ? 'L' : 'W';
        if (!cd._outW && cd._toks && cd._toks[0] && cd._toks[0].kind === 'p') {
          // 轮空卡：这位选手下一轮出现在哪张卡
          var nxCard = tokKey['P|' + cd._toks[0].id];
          cd.winTo = (nxCard && nxCard !== cd) ? nxCard.title : (br === 'W' ? '下一轮' : '下一轮');
          cd.loseTo = '—';
          return;
        }
        var nxt = (cd._outW && tokKey[cd._outW]) ? tokKey[cd._outW].title : null;
        var lose = (cd._outL && tokKey[cd._outL]) ? tokKey[cd._outL].title : null;
        cd.winTo = nxt || '总决赛 第 1 场';
        cd.loseTo = lose || (isW ? '淘汰' : '淘汰');
        delete cd._toks; delete cd._outW; delete cd._outL;
      });
      gfCols.forEach(function (col, ci) {
        col.cards.forEach(function (cd) {
          cd.winTo = '夺冠（无后续比赛）';
          cd.loseTo = (ci === 0 && gfCols.length > 1)
            ? ((mode === 'elevate') ? '进入升格决赛' : '进入加赛局')
            : '亚军';
        });
      });

      var rest = n - top;
      var banner = '本阶段 ' + n + ' 人：按排名 <b>前 ' + top + ' 名从胜者组起跑</b>'
        + '（对阵表 ' + sk.wSize + ' 位），其余 <b>' + rest + ' 人直接进入败者组</b>'
        + '（已先算一负，组内先打一轮）。<br>'
        + '也是「输两场才淘汰」：败者组起跑者再输一场即出局；胜者组的人掉进败者组后仍有第二次机会。'
        + '<br>首轮编排：' + E.drawLabel(stage);
      return {
        type: 'double',
        banner: banner,
        totalCols: Math.max(wCards.length + gfCols.length, lCards.length),
        rows: [
          { key: 'W', name: '胜者组', cols: wCards, gf: gfCols },
          { key: 'L', name: '败者组', cols: lCards }
        ],
        third: null
      };
    }

    var sizeDE = stage.bracketSize || U.nextPow2(Math.max(2, n));
    var m = Math.round(Math.log2(sizeDE));
    // 2 人双败时只有「胜者组决赛 + 总决赛」，没有败者组轮次（以前强制 m=2 会算出 0.5 场比赛 → 数组越界）
    if (m < 1) m = 1;
    var wbCols = [], lbCols = [], k2;
    var wbCount = function (r) { return sizeDE / Math.pow(2, r); };
    var lbCounts = [];
    for (k2 = 1; k2 <= Math.max(0, 2 * m - 2); k2++) {
      if (k2 === 1) lbCounts[k2] = Math.max(1, sizeDE / 4);
      else lbCounts[k2] = (k2 % 2 === 0) ? lbCounts[k2 - 1] : Math.max(1, lbCounts[k2 - 1] / 2);
    }
    var lbCount = function (k) { return lbCounts[k] || 1; };

    // 胜者组
    var wbSlots = [];
    if (Wgroups[0] && Wgroups[0].length) {
      wbSlots = Wgroups[0];
    } else {
      var seededDE = (stage.participants || []).slice().sort(function (x, y) {
        return E.seedOf(t, x) - E.seedOf(t, y);
      });
      var sl2 = E.drawSlots(t, stage, seededDE, sizeDE);
      for (i = 0; i + 1 < sl2.length; i += 2) {
        wbSlots.push({
          playerA: sl2[i], playerB: sl2[i + 1],
          isBye: !(sl2[i] && sl2[i + 1]), result: null, decided: false
        });
      }
    }
    for (var wr = 1; wr <= m; wr++) {
      var wc = wbCount(wr);
      var wg = (wr === 1) ? wbSlots : takeGroup(Wgroups, wr - 1, wc);
      var wname = (wr === m) ? '胜者组决赛' : (wr === m - 1 ? '胜者组半决赛' : ('胜者组第 ' + wr + ' 轮'));
      var wprev = (wr === 1) ? '' : ((wr - 1 === m) ? '胜者组决赛'
        : (wr - 1 === m - 1 ? '胜者组半决赛' : ('胜者组第 ' + (wr - 1) + ' 轮')));
      var wcards = [];
      for (i = 0; i < wc; i++) {
        var wa = (wr === 1) ? '种子位' : (wprev + ' 第 ' + (2 * i + 1) + ' 场胜者');
        var wb = (wr === 1) ? '种子位' : (wprev + ' 第 ' + (2 * i + 2) + ' 场胜者');
        wcards.push(card('W|' + wr + '|' + i, wname + ' 第 ' + (i + 1) + ' 场', wa, wb, wg[i] || null));
      }
      wbCols.push({
        name: wname,
        sub: '剩 ' + wc * 2 + ' 人 · ' + wc + ' 场',
        cards: wcards
      });
    }

    // 败者组
    var lbMax = 2 * m - 2;
    var wbLoseTo = {};   // '胜者组轮次|场序号(0-based)' -> '败者组第 X 轮 第 Y 场'
    for (k2 = 1; k2 <= lbMax; k2++) {
      var lc = lbCount(k2);
      var lg = takeGroup(Lgroups, k2 - 1, lc);
      var lname = (k2 === lbMax) ? '败者组决赛' : ('败者组第 ' + k2 + ' 轮');
      var lprev = (k2 === 1) ? '' : ((k2 - 1 === lbMax) ? '败者组决赛' : ('败者组第 ' + (k2 - 1) + ' 轮'));
      var lcards = [];
      for (i = 0; i < lc; i++) {
        var la, lb;
        if (k2 === 1) {
          // 首轮败者组：胜者组第 1 轮的两个败者
          la = '胜者组第 1 轮 第 ' + (2 * i + 1) + ' 场败者';
          lb = '胜者组第 1 轮 第 ' + (2 * i + 2) + ' 场败者';
          wbLoseTo['1|' + (2 * i)] = lname + ' 第 ' + (i + 1) + ' 场';
          wbLoseTo['1|' + (2 * i + 1)] = lname + ' 第 ' + (i + 1) + ' 场';
        } else if (k2 % 2 === 0) {
          // 偶数轮：败者组上一轮胜者 vs 胜者组第 (k/2+1) 轮的败者
          var jj = k2 / 2;
          la = lprev + ' 第 ' + (2 * i + 1) + ' 场胜者';
          lb = '胜者组第 ' + (jj + 1) + ' 轮 第 ' + (i + 1) + ' 场败者';
          wbLoseTo[(jj + 1) + '|' + i] = lname + ' 第 ' + (i + 1) + ' 场';
        } else {
          // 奇数轮：败者组上一轮的两个胜者
          la = lprev + ' 第 ' + (2 * i + 1) + ' 场胜者';
          lb = lprev + ' 第 ' + (2 * i + 2) + ' 场胜者';
        }
        lcards.push(card('L|' + k2 + '|' + i, lname + ' 第 ' + (i + 1) + ' 场', la, lb, lg[i] || null));
      }
      lbCols.push({
        name: lname,
        sub: '剩 ' + (lc * 2) + ' 人 · ' + lc + ' 场',
        cards: lcards
      });
    }

    // 总决赛（放最右）
    var mode = stage.gfMode || 'reset';
    var gfName = '总决赛';
    var gf1 = null, gf2 = null;
    gfMs.forEach(function (x) {
      if (x.gfRound === 'reset') gf2 = x; else gf1 = x;
    });
    var gfCols = [];
    var elevCfg = (mode === 'elevate') ? E.gfElevCfg(t, stage) : null;
    gfCols.push({
      name: gfName,
      sub: (mode === 'elevate')
        ? ('一场定胜负 · 比分累计：先到 ' + elevCfg.base + ' 局；败者组冠军先到 ' + elevCfg.base
          + ' 局后升为 ' + elevCfg.up + ' 局')
        : (mode === 'reset' ? '加赛制：败者组冠军需赢两场' : '一场定胜负'),
      cards: [card('GF|1|0', gfName + ' 第 1 场', '胜者组决赛胜者', '败者组决赛胜者', gf1)]
    });
    if (mode === 'reset') {
      gfCols.push({
        name: '加赛局',
        sub: '仅当败者组冠军赢下首场才进行',
        cards: [card('GF|2|0', '加赛局 第 1 场', '胜者组冠军', '败者组冠军', gf2)]
      });
    }

    // 去向：胜者往右走，负者掉进败者组（查映射表），败者组再输就淘汰
    wbCols.forEach(function (col, ci) {
      col.cards.forEach(function (cd, mi) {
        cd.winTo = (ci === wbCols.length - 1)
          ? '总决赛 第 1 场'
          : (wbCols[ci + 1].name + ' 第 ' + (Math.floor(mi / 2) + 1) + ' 场');
        cd.loseTo = wbLoseTo[(ci + 1) + '|' + mi] || '淘汰';
      });
    });
    lbCols.forEach(function (col, ci) {
      col.cards.forEach(function (cd, mi) {
        cd.winTo = (ci === lbCols.length - 1)
          ? '总决赛 第 1 场'
          : (lbCols[ci + 1].name + ' 第 ' + (Math.floor(mi / 2) + 1) + ' 场');
        cd.loseTo = '淘汰';
      });
    });
    gfCols.forEach(function (col, ci) {
      col.cards.forEach(function (cd) {
        cd.winTo = '夺冠（无后续比赛）';
        cd.loseTo = (ci === 0 && gfCols.length > 1)
          ? ((mode === 'elevate') ? '进入升格决赛' : '进入加赛局')
          : '亚军';
      });
    });

    return {
      type: 'double',
      banner: '本阶段 ' + n + ' 人：对阵表 ' + sizeDE + ' 位，胜者组 ' + m + ' 轮、败者组 ' + lbMax + ' 轮，'
        + '负两场淘汰，最后是总决赛。<br>首轮编排：' + E.drawLabel(stage),
      totalCols: Math.max(wbCols.length + gfCols.length, lbCols.length),
      rows: [
        { key: 'W', name: '胜者组', cols: wbCols, gf: gfCols },
        { key: 'L', name: '败者组', cols: lbCols }
      ],
      third: thirdMs[0] || null
    };
  };

  /* ============ 合并对阵图：多个淘汰赛阶段接成一条完整路径 ============
   * 常见赛程是「八强淘汰 → 四强淘汰 → 决赛」，每个阶段各有一张对阵图。
   * 这里按阶段顺序把它们并到同一个视图里，并列出阶段之间谁晋级过去了，
   * 于是从第一场一直看到总冠军可以在一个视图里横向走完。
   * 返回 { ok, stages:[{si,name,type,plan,cols,people,target,advanced,advancedNames,
   *                     champion,championName,finished,status}], totalCols, champion, ... }
   */
  E.elimStageIndexes = function (t) {
    var out = [];
    ((t && t.stages) || []).forEach(function (st, si) {
      if (st.type === 'single_elim' || st.type === 'double_elim') {
        if ((st.roundsData || []).length) out.push(si);
      }
    });
    return out;
  };

  E.mergedBracketPlan = function (t) {
    if (!t) return { ok: false, stages: [], totalCols: 0, note: '没有赛事数据' };
    var list = [], totalCols = 0;
    E.elimStageIndexes(t).forEach(function (si) {
      var st = t.stages[si];
      var plan = null;
      try { plan = E.bracketPlan(t, st); } catch (e) { plan = null; }
      if (!plan || !plan.rows || !plan.rows.length) return;
      var target = E.elimTarget(t, st);
      var ranking = null;
      try { ranking = E.computeElimRanking(t, st); } catch (e) { ranking = null; }
      var done = (st.status === 'finished');
      // 只有「打到冠军」且阶段已结束，才有真正的阶段冠军
      var champ = (done && target === 1 && ranking && ranking.length) ? ranking[0] : null;
      var cols = Math.max(1, plan.totalCols || 1);
      totalCols += cols;
      list.push({
        si: si,
        name: st.name || ('阶段 ' + (si + 1)),
        type: st.type,
        plan: plan,
        cols: cols,
        people: (st.participants || []).length,
        target: target,
        advanced: (st.advanced || []).slice(),
        advancedNames: (st.advanced || []).map(function (id) { return E.nameOf(t, id) || '?'; }),
        champion: champ,
        championName: champ ? (E.nameOf(t, champ) || '?') : '',
        finished: done,
        status: st.status || 'pending'
      });
    });
    var last = list.length ? list[list.length - 1] : null;
    return {
      ok: list.length > 0,
      stages: list,
      totalCols: totalCols,
      champion: (last && last.champion) || null,
      championName: (last && last.championName) || '',
      championStage: last ? last.si : null,
      note: list.length > 1
        ? ('共 ' + list.length + ' 个淘汰赛阶段、' + totalCols + ' 列对阵：从左往右看，前一阶段的晋级者接着出现在下一阶段。')
        : '本赛事只有 1 个淘汰赛阶段，无需合并。'
    };
  };

  /* ============ 对阵图数据（单败 / 双败的树状图） ============ */
  /**
   * @return { type, cols:[[info]], sections:[{key,name,cols}], gf:[info], third:[info] }
   * info = { id, a, b, aId, bId, scoreA, scoreB, winnerId, decided, isBye, round }
   */
  E.bracketGraph = function (t, stage) {
    var rds = stage.roundsData || [];
    var isDE = (stage.type === 'double_elim');
    var nm = function (id) { return id ? (E.nameOf(t, id) || '?') : '—'; };

    function info(m) {
      var rg = m.result || {};
      return {
        id: m.id,
        aId: m.playerA || null, bId: m.playerB || null,
        a: nm(m.playerA), b: nm(m.playerB),
        scoreA: rg.gamesA || 0,
        scoreB: rg.gamesB || 0,
        advA: rg.advA || 0,
        advB: rg.advB || 0,
        winnerId: (m.result && m.result.winner)
          ? (m.result.winner === 'A' ? m.playerA : m.playerB) : null,
        decided: !!m.decided,
        isBye: !!m.isBye,
        isThird: !!m.isThird,
        isGF: !!m.isGF,
        gfRound: m.gfRound || null,
        gfAdv: m.gfAdv || null,
        round: m.round
      };
    }
    function colLabel(count, idxFromEnd) {
      if (idxFromEnd === 0) return '决赛';
      if (idxFromEnd === 1) return '半决赛';
      var n = Math.pow(2, idxFromEnd);
      return '1/' + n + ' 决赛';
    }

    var gf = [], third = [];
    var colsW = [], colsL = [];

    rds.forEach(function (rd) {
      var ms = rd.matches || [];
      if (rd.isGF) {
        ms.forEach(function (m) { gf.push(info(m)); });
        return;
      }
      ms.forEach(function (m) {
        if (m.isThird) { third.push(info(m)); return; }
        var arr = (m.bracket === 'L') ? colsL : colsW;
        var idx = m.round;
        while (arr.length <= idx) arr.push([]);
        arr[idx].push(info(m));
      });
    });

    // 去掉没有比赛的空列（例如败者组第 1 轮还没有人）
    colsW = colsW.filter(function (c) { return c.length > 0; });
    colsL = colsL.filter(function (c) { return c.length > 0; });

    // 列名：按「本阶段应有的总轮数」编号，而不是按已经生成了几列，
    // 否则只打了 1/4 决赛时会把这一列错标成「半决赛 / 决赛」
    var totalW = E.plannedRounds(stage, (stage.participants || []).length);
    if (!totalW) {
      totalW = stage.bracketSize ? Math.round(Math.log2(stage.bracketSize)) : colsW.length;
    }
    if (totalW < colsW.length) totalW = colsW.length;
    var namesW = colsW.map(function (c, i) { return colLabel(c.length, totalW - 1 - i); });
    // 败者组按自己的推进顺序编号（首轮败者组就是「第 1 轮」，不跟随全局轮次）
    var namesL = colsL.map(function (c, i) { return '败者组 第 ' + (i + 1) + ' 轮'; });

    if (isDE) {
      return {
        type: 'double',
        cols: colsW, colNames: namesW,
        sections: [
          { key: 'W', name: '胜者组', cols: colsW, colNames: namesW },
          { key: 'L', name: '败者组', cols: colsL, colNames: namesL }
        ],
        gf: gf, third: third
      };
    }
    return {
      type: 'single',
      cols: colsW, colNames: namesW,
      sections: [{ key: 'W', name: '淘汰赛', cols: colsW, colNames: namesW }],
      gf: [], third: third
    };
  };

  /* ============ 晋级路径：每场胜者 / 负者去哪一场 ============
   * 不依赖固定槽位：直接按「同一选手在后续轮次里再次出现」反查落点，
   * 因此单败、双败（含轮空、败者组跳轮、总决赛加赛）都能算准。
   * 返回 { labels:{matchId:名称}, win:{matchId:去向}, lose:{matchId:去向}, isDE }
   */
  E.bracketPaths = function (t, stage) {
    var rds = stage.roundsData || [];
    var isDE = (stage.type === 'double_elim');

    var meta = {};     // matchId -> { rd, m, i, bracket }
    var appear = {};   // playerId -> [ {round, matchId, slot, bracket} ]
    var wRounds = [], lRounds = [];

    rds.forEach(function (rd) {
      (rd.matches || []).forEach(function (m, i) {
        var br = m.bracket || 'W';
        meta[m.id] = { rd: rd, m: m, i: i, bracket: br };
        if (rd.isGF) {
          // 总决赛单独成区，不参与胜/败者组轮次编号
        } else if (m.isThird) {
          // 季军赛不参与
        } else if (br === 'L') {
          if (lRounds.indexOf(rd.index) < 0) lRounds.push(rd.index);
        } else {
          if (wRounds.indexOf(rd.index) < 0) wRounds.push(rd.index);
        }
        [[m.playerA, 'A'], [m.playerB, 'B']].forEach(function (p) {
          if (!p[0]) return;
          (appear[p[0]] = appear[p[0]] || []).push({
            round: rd.index, matchId: m.id, slot: p[1], bracket: br
          });
        });
      });
    });

    wRounds.sort(function (a, b) { return a - b; });
    lRounds.sort(function (a, b) { return a - b; });

    var nPart = (stage.participants || []).length;
    var totalW = E.plannedRounds(stage, nPart);
    if (!totalW) totalW = stage.bracketSize ? Math.round(Math.log2(stage.bracketSize)) : wRounds.length;
    if (totalW < wRounds.length) totalW = wRounds.length;

    function wName(round) {
      var idx = wRounds.indexOf(round);
      var left = totalW - 1 - (idx < 0 ? 0 : idx);
      if (left <= 0) return '决赛';
      if (left === 1) return '半决赛';
      return '1/' + Math.pow(2, left) + ' 决赛';
    }
    function lName(round) {
      var idx = lRounds.indexOf(round);
      return '败者组第 ' + (idx < 0 ? 1 : idx + 1) + ' 轮';
    }

    // 同一轮内同组别的桌号（按生成顺序）
    var seq = {};
    Object.keys(meta).forEach(function (mid) {
      var mm = meta[mid];
      var key = mm.rd.index + '|' + mm.bracket + '|' + (mm.rd.isGF ? 'GF' : (mm.m.isThird ? 'T' : ''));
      seq[key] = (seq[key] || 0) + 1;
      mm.seat = seq[key];
    });

    var labels = {};
    Object.keys(meta).forEach(function (mid) {
      var mm = meta[mid], m = mm.m;
      var base;
      if (mm.rd.isGF) base = (m.gfRound === 'reset') ? '总决赛 · 加赛局' : '总决赛';
      else if (m.isThird) base = '季军争夺战';
      else if (mm.bracket === 'L') base = lName(mm.rd.index);
      else base = wName(mm.rd.index);
      labels[mid] = base + ' 第 ' + mm.seat + ' 场';
    });

    function nextOf(id, afterRound, bracketFilter) {
      var arr = appear[id] || [];
      for (var k = 0; k < arr.length; k++) {
        if (arr[k].round > afterRound) {
          if (bracketFilter && arr[k].bracket !== bracketFilter) continue;
          return arr[k];
        }
      }
      return null;
    }

    var win = {}, lose = {};

    // 「真正的终点」判定：只有打到本阶段的最后一轮，胜者才算夺冠/阶段结束；
    // 后续轮次只是还没生成时，必须显示「下一轮（待生成）」，不能谎报成夺冠。
    var plan = E.plannedRounds(stage, nPart);
    var natural = nPart > 1 ? Math.ceil(Math.log2(nPart)) : 1;
    var truncated = !!(plan && plan < natural);
    var finished = (stage.status === 'finished') || !!(stage.finalRank && stage.finalRank.length);

    function isLastRound(mm) {
      if (mm.rd.isGF) return true;
      if (plan) return mm.rd.index >= plan - 1;
      return false;
    }
    function winTerminal(mm) {
      if (mm.rd.isGF) return '夺冠（无后续比赛）';
      if (mm.m.isThird) return '本场胜者列第 3 名';
      if (isLastRound(mm) || finished) {
        return truncated ? '本阶段结束（无后续比赛）' : '夺冠（无后续比赛）';
      }
      return '下一轮（待生成）';
    }
    function loseTerminal(mm, loserId) {
      if (mm.rd.isGF) return '亚军';
      if (mm.m.isThird) return '本场负者列第 4 名';
      if (isDE) {
        // 双败：输满两场才真的出局；只输一场又暂时没有下一场 = 还在等下一轮
        return ((lossCnt[loserId] || 0) >= 2) ? '淘汰' : '下一轮（待生成）';
      }
      return '淘汰';
    }

    // 先统计每人已负场数（双败判「是否真的被淘汰」要用）
    var bothLose = !!(stage && stage.drawBothLose);   // 平局 = 双方都输
    var lossCnt = {};
    Object.keys(meta).forEach(function (mid) {
      var m = meta[mid].m, rg = m.result || {};
      if (m.isBye) return;
      if (!rg.winner) {
        // 平局且开了「双方都输」：两边各记一负
        if (bothLose && rg.settled && m.playerA && m.playerB) {
          lossCnt[m.playerA] = (lossCnt[m.playerA] || 0) + 1;
          lossCnt[m.playerB] = (lossCnt[m.playerB] || 0) + 1;
        }
        return;
      }
      var lid = (rg.winner === 'A') ? m.playerB : m.playerA;
      if (lid) lossCnt[lid] = (lossCnt[lid] || 0) + 1;
    });

    Object.keys(meta).forEach(function (mid) {
      var mm = meta[mid], m = mm.m, rg = m.result || {};
      if (m.isBye) {
        var bw = m.playerA || m.playerB;
        var bn = bw ? nextOf(bw, mm.rd.index) : null;
        win[mid] = bn ? labels[bn.matchId] : '';
        lose[mid] = '';
        return;
      }
      var wId = rg.winner ? (rg.winner === 'A' ? m.playerA : m.playerB) : null;
      var lId = rg.winner ? (rg.winner === 'A' ? m.playerB : m.playerA) : null;

      if (wId) {
        var nw = nextOf(wId, mm.rd.index);
        win[mid] = nw ? labels[nw.matchId] : winTerminal(mm);
      } else if (bothLose && rg.settled && m.playerA && m.playerB) {
        // 平局 = 双方都输：这一场没有胜者，两人都往「负」的方向走
        win[mid] = '平局：双方各记一负';
      } else {
        // 未决出：给结构性提示
        if (mm.rd.isGF) win[mid] = '本次总决赛胜者即冠军';
        else if (m.isThird) win[mid] = '胜者列第 3 名';
        else win[mid] = '待定';
      }

      if (lId) {
        var nl = nextOf(lId, mm.rd.index);
        lose[mid] = nl ? labels[nl.matchId] : loseTerminal(mm, lId);
      } else if (bothLose && rg.settled && m.playerA && m.playerB) {
        // 平局双方都输：两支大的人各自按负场归宿
        if (mm.rd.isGF) {
          lose[mid] = '平局双负：冠军由负场少的一方获得';
        } else if (isDE && mm.bracket === 'W') {
          var nlA = nextOf(m.playerA, mm.rd.index) || nextOf(m.playerB, mm.rd.index);
          lose[mid] = nlA ? labels[nlA.matchId] : '掉入败者组';
        } else if (isDE) {
          var deadA = (lossCnt[m.playerA] || 0) >= 2, deadB = (lossCnt[m.playerB] || 0) >= 2;
          lose[mid] = (deadA || deadB) ? '淘汰（负满两场）' : '下一轮（待生成）';
        } else {
          lose[mid] = '淘汰';
        }
      } else {
        if (mm.rd.isGF) lose[mid] = '本次总决赛负者为亚军';
        else if (m.isThird) lose[mid] = '负者列第 4 名';
        else if (isDE && mm.bracket === 'W') lose[mid] = '掉入败者组';
        else lose[mid] = '待定';
      }
    });

    return { labels: labels, win: win, lose: lose, isDE: isDE };
  };

  /* ============ 阶段结束：计算晋级 ============ */
  E.finishStage = function (t) {
    var stage = t.stages[t.currentStage];
    if (!stage) return { ok: false, msg: '无当前阶段' };
    E.refreshGroupFinished(t, stage);

    // 双败：先把最后一轮结算掉，保证 de 状态与对阵一致
    if (stage.type === 'double_elim') E.deCommitPending(t, stage);

    // 淘汰赛：按 bracket 结果生成最终名次
    if (stage.type === 'single_elim' || stage.type === 'double_elim') {
      stage.finalRank = E.computeElimRanking(t, stage);
    }

    var advanced = [], i;
    if (stage.type === 'groups') {
      var per = Math.max(1, parseInt(stage.adv.perGroup, 10) || 1);
      for (var gi = 0; gi < stage.groups.length; gi++) {
        var stg = E.standings(t, { stageIndex: stage.index, groupIdx: gi });
        for (i = 0; i < Math.min(per, stg.length); i++) advanced.push(stg[i].id);
      }
    } else {
      var stFull = E.standings(t, { stageIndex: stage.index });
      var ptsMap = {};
      stFull.forEach(function (s) { ptsMap[s.id] = s.points; });

      // 淘汰赛：按对阵名次（冠军 > 亚军 > …）决定晋级，而不是按积分。
      // 否则在某些记分方式下（负者也得分、按局计分等）会出现
      // 「赢了比赛却因积分不够而被漏掉晋级」的情况。
      var orderIds;
      if ((stage.type === 'single_elim' || stage.type === 'double_elim') &&
          stage.finalRank && stage.finalRank.length) {
        orderIds = stage.finalRank.slice();
      } else {
        orderIds = stFull.map(function (s) { return s.id; });
      }
      var st = orderIds.map(function (id) { return { id: id, points: ptsMap[id] || 0 }; });

      var type = stage.adv.type;
      var isElimStage = (stage.type === 'single_elim' || stage.type === 'double_elim');
      if (type === 'count') {
        var cnt = Math.max(1, parseInt(stage.adv.count, 10) || 1);
        for (i = 0; i < Math.min(cnt, st.length); i++) advanced.push(st[i].id);
      } else if (type === 'count_tie') {
        // 固定人数晋级：先取满 N 人，再把与第 N 名同分的人一并带上（可能出现 N+ 人）
        var cntT = Math.max(1, parseInt(stage.adv.count, 10) || 1);
        var cutPts = (cntT <= st.length) ? st[cntT - 1].points : null;
        for (i = 0; i < st.length; i++) {
          if (i < cntT) advanced.push(st[i].id);
          // 淘汰赛按对阵名次裁人，同分没有意义（也不该把已经输掉的人捞回来）
          else if (!isElimStage && cutPts !== null && st[i].points === cutPts) advanced.push(st[i].id);
        }
      } else if (type === 'score') {
        var line = parseFloat(stage.adv.score) || 0;
        for (i = 0; i < st.length; i++) if (st[i].points >= line) advanced.push(st[i].id);
      } else {
        advanced = st.map(function (s) { return s.id; });
      }
    }

    // 已被淘汰的人（提前淘汰 / 按名次裁人）一律不晋级，
    // 否则「全部晋级」或「按积分线」会把输够场数的人又带进下一阶段
    advanced = advanced.filter(function (id) {
      return (stage.eliminated || []).indexOf(id) < 0;
    });

    // 提前晋级者已用战绩锁定席位：不论晋级方式（人数线 / 积分线）如何，
    // 一律进入下一阶段，并按当前排名顺序排列（避免追加到末尾打乱种子序）
    if (E.clinchSupported(stage) && E.clinchCfg(stage).enabled) {
      var orderIdx = {};
      E.standings(t, { stageIndex: stage.index }).forEach(function (s, i) { orderIdx[s.id] = i; });
      (stage.clinched || []).forEach(function (id) {
        if (advanced.indexOf(id) < 0) advanced.push(id);
      });
      advanced.sort(function (a, b) {
        var ia = (orderIdx[a] === undefined) ? 9999 : orderIdx[a];
        var ib = (orderIdx[b] === undefined) ? 9999 : orderIdx[b];
        return ia - ib;
      });
    }

    stage.advanced = advanced;
    stage.status = 'finished';

    // 下一阶段
    if (t.currentStage + 1 < t.stages.length) {
      // 提前晋级加分：写入下一阶段的携带分（不修改选手的全局初始分）
      var cb = {};
      if (E.clinchSupported(stage) && E.clinchCfg(stage).enabled) {
        (stage.clinched || []).forEach(function (id) {
          var v = E.clinchBonusOf(stage, id);
          if (v) cb[id] = v;
        });
      }
      t.currentStage += 1;
      var next = t.stages[t.currentStage];
      // 直接从这个阶段开始打的选手，一并进名单（排在晋级者之后）
      next.participants = E.withLatecomers(t, t.currentStage, advanced);
      next.carryBonus = cb;
      next.clinched = [];
      next.clinchRound = {};
      next.elimRound = {};
      next.status = 'pending';
      next.roundsData = [];
      next.eliminated = [];
      next.advanced = [];
      next.de = null;
      next.groups = null;
      t.status = 'running';
      return { ok: true, msg: '阶段结束，已晋级 ' + advanced.length + ' 人进入下一阶段' };
    }
    t.status = 'finished';
    return { ok: true, msg: '赛事全部结束' };
  };

  /* =========================================================
     五、比赛计时器：每场限时 → 到点自动结算未打完的比赛
     ========================================================= */
  // 计时器配置（全局，缺字段时用默认值补齐）
  E.tmCfg = function (t) {    var c = Object.assign(M.defaultTimer(), (t && t.timer) || {});
    c.enabled = !!c.enabled;
    c.minutes = parseFloat(c.minutes);
    if (!(c.minutes > 0)) c.minutes = 30;
    c.autoSettle = (c.autoSettle === undefined) ? true : !!c.autoSettle;
    if (['draw', 'seed', 'keep'].indexOf(c.tieAction) < 0) c.tieAction = 'draw';
    return c;
  };

  // 每场限时换算成秒
  E.tmLimitSec = function (t, minutes) {
    var c = E.tmCfg(t);
    var m = (minutes === undefined || minutes === null) ? c.minutes : parseFloat(minutes);
    if (!(m > 0)) m = c.minutes;
    return Math.max(1, Math.round(m * 60));
  };

  // 是否正在走表（startedAt 可能是 0，必须用 null / undefined 判断）
  function tmRunning(tm) {
    return !!(tm && tm.startedAt !== null && tm.startedAt !== undefined && tm.startedAt !== false);
  }

  /**
   * 某场比赛的计时状态
   * @return {on, running, limit, elapsed, remain, expired, over}
   */
  E.tmState = function (m, now) {
    now = (now === undefined || now === null) ? Date.now() : now;
    var tm = m && m.tm;
    if (!tm || !(parseFloat(tm.limit) > 0)) {
      return { on: false, running: false, limit: 0, elapsed: 0, remain: 0, expired: false, over: false };
    }
    var limit = parseFloat(tm.limit) || 0;
    var elapsed = (parseFloat(tm.spent) || 0);
    if (tmRunning(tm)) elapsed += Math.max(0, (now - tm.startedAt) / 1000);
    var remain = limit - elapsed;
    return {
      on: true,
      running: tmRunning(tm),
      limit: limit,
      elapsed: Math.round(elapsed * 10) / 10,
      remain: Math.max(0, Math.round(remain * 10) / 10),
      expired: remain <= 0,
      over: !!tm.over
    };
  };

  // 开表（已在走表则原样返回；limit 只在第一次写入）
  E.tmStart = function (m, limitSec, now) {
    now = (now === undefined || now === null) ? Date.now() : now;
    if (!m) return null;
    if (!m.tm) m.tm = { limit: limitSec || 0, spent: 0, startedAt: null, over: false };
    if (!(parseFloat(m.tm.limit) > 0)) m.tm.limit = limitSec || 0;
    if (!tmRunning(m.tm) && !m.tm.over) m.tm.startedAt = now;
    return E.tmState(m, now);
  };

  // 停表（把已走的时间累计进 spent）
  E.tmPause = function (m, now) {
    now = (now === undefined || now === null) ? Date.now() : now;
    if (!m || !m.tm) return null;
    if (tmRunning(m.tm)) {
      m.tm.spent = (parseFloat(m.tm.spent) || 0) + Math.max(0, (now - m.tm.startedAt) / 1000);
      m.tm.startedAt = null;
    }
    return E.tmState(m, now);
  };

  // 归零（换场 / 重开）
  E.tmReset = function (m, limitSec) {
    if (!m) return null;
    m.tm = {
      limit: limitSec || (m.tm && m.tm.limit) || 0,
      spent: 0, startedAt: null, over: false
    };
    return E.tmState(m, 0);
  };

  // 归零并立即开表
  E.tmRestart = function (m, limitSec, now) {
    E.tmReset(m, limitSec);
    return E.tmStart(m, limitSec, now);
  };

  // 淘汰赛 / 小组内淘汰赛：到点判平局时必须指定一个人赢
  function isElimLike(stage) {
    if (!stage) return false;
    if (stage.type === 'single_elim' || stage.type === 'double_elim') return true;
    return stage.type === 'groups' && stage.groupType === 'single_elim';
  }

  // 平分时按种子号判定（种子越小越强；没有种子就用列表顺序）
  function seedPick(t, ia, ib) {
    var pa = t.players.filter(function (x) { return x.id === ia; })[0] || {};
    var pb = t.players.filter(function (x) { return x.id === ib; })[0] || {};
    var sa = parseFloat(pa.seed) || 0, sb = parseFloat(pb.seed) || 0;
    if (sa > 0 && sb > 0) return sa <= sb ? 'A' : 'B';
    if (sa > 0 && !(sb > 0)) return 'A';
    if (sb > 0 && !(sa > 0)) return 'B';
    var ia2 = t.players.indexOf(pa), ib2 = t.players.indexOf(pb);
    return (ia2 >= 0 && ib2 >= 0 && ib2 < ia2) ? 'B' : 'A';
  }

  /**
   * 结算一场「没打完」的比赛（计时器到点 / 裁判中途结束）
   *   · 领先方获胜（大比分 = 已打的局数 + 让局先计）
   *   · 平分时按 tieAction：draw 记平局 / seed 种子靠前者胜 / keep 不结算继续打
   *   · 淘汰赛强制有人晋级（tieAction=draw 也按种子判）
   *   · 结果标记 unfinished=true，计分时优先查「未打完」的大比分档位
   */
  E.settleUnfinished = function (t, stage, m, opts) {
    opts = opts || {};
    if (!m) return { ok: false, msg: '未找到该场比赛' };
    if (m.isBye) return { ok: false, msg: '轮空场次无需结算' };
    if (m.decided) {
      return {
        ok: false,
        msg: (m.result && m.result.unfinished)
          ? '该场已经按「未打完」结算过（要改可先撤销）'
          : '该场已经分出了胜负，不需要再结算'
      };
    }
    var p = E.progress(m);
    var advA = 0, advB = 0;
    if (m.gfAdv && m.gfAdv.games > 0) {
      if (m.gfAdv.side === 'A') advA = m.gfAdv.games; else advB = m.gfAdv.games;
    }
    var ea = p.a + advA, eb = p.b + advB;
    var winner = (ea > eb) ? 'A' : (eb > ea ? 'B' : null);
    var cfg = E.tmCfg(t);
    var tieAction = opts.tieAction || cfg.tieAction;
    if (winner === null) {
      if (tieAction === 'keep' && !isElimLike(stage)) {
        return { ok: false, keep: true, msg: '双方局数相同，按设置继续比赛（不停表）' };
      }
      if (isElimLike(stage) || tieAction === 'seed') {
        winner = seedPick(t, m.playerA, m.playerB);
      }
    }
    if (m.tm) { E.tmPause(m, opts.now); m.tm.over = true; m.tm.startedAt = null; }
    m.result = {
      winner: winner, gamesA: p.a, gamesB: p.b, draws: p.d, settled: true,
      advA: advA, advB: advB,
      unfinished: true,
      endReason: opts.reason || 'timeout'
    };
    m.decided = true;
    m.overtime = false;
    m.override = null;
    return { ok: true, winner: winner, a: ea, b: eb, msg: '已结算为未打完（' + ea + ' : ' + eb + '）' };
  };

  /**
   * 扫描全部阶段，把所有到点且未结算的比赛自动结算掉
   * @return [{stageIndex, matchId, a, b, winner}] 本次自动结算的比赛
   */
  E.tmTick = function (t, now) {
    now = (now === undefined || now === null) ? Date.now() : now;
    var done = [];
    if (!t || !Array.isArray(t.stages)) return done;
    var cfg = E.tmCfg(t);
    if (!cfg.autoSettle) return done;
    t.stages.forEach(function (stage, si) {
      (stage.roundsData || []).forEach(function (rd) {
        (rd.matches || []).forEach(function (m) {
          if (!m || !m.tm || !tmRunning(m.tm) || m.decided) return;
          var st = E.tmState(m, now);
          if (!st.expired) return;
          var r = E.settleUnfinished(t, stage, m, { reason: 'timeout', now: now });
          if (r.ok) {
            done.push({
              stageIndex: si, matchId: m.id, winner: r.winner, a: r.a, b: r.b,
              nameA: E.nameOf(t, m.playerA), nameB: E.nameOf(t, m.playerB)
            });
          }
        });
      });
    });
    return done;
  };

  /* ============ 回退 ============ */
  E.snapshot = function (t) {
    var snap = U.clone({
      stages: t.stages, currentStage: t.currentStage, status: t.status,
      players: t.players, seed: t.seed
    });
    t.history.push(snap);
    if (t.history.length > 200) t.history.shift();
  };

  E.rollback = function (t) {
    if (!t.history || !t.history.length) return { ok: false, msg: '没有可回退的步骤' };
    var snap = t.history.pop();
    t.stages = snap.stages;
    t.currentStage = snap.currentStage;
    t.status = snap.status;
    t.players = snap.players;
    t.seed = snap.seed;
    return { ok: true, msg: '已回退一步' };
  };

  /* =========================================================
     赛季积分
     —— 纯函数，不改动赛事数据；UI 只负责渲染
     ========================================================= */

  // 姓名归一化：跨赛事认人（全角空格、大小写、多余空白都不影响）
  E.nameKey = function (name) {
    return String(name === null || name === undefined ? '' : name)
      .replace(/\u3000/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  };

  // 单个阶段的名次与战绩（淘汰赛按对阵结果顺序，其余按积分榜）
  E.stageResults = function (t, si) {
    var stage = (t.stages || [])[si];
    if (!stage) return [];
    var isElim = (stage.type === 'single_elim' || stage.type === 'double_elim');
    if (isElim) {
      var ids = [];
      try { ids = E.computeElimRanking(t, stage) || []; } catch (e) { ids = []; }
      var w = {}, l = {};
      (stage.roundsData || []).forEach(function (rd) {
        (rd.matches || []).forEach(function (m) {
          if (m.isBye || m.voided || !m.result) return;
          if (!m.result.winner) return;
          var wid = (m.result.winner === 'A') ? m.playerA : m.playerB;
          var lid = (m.result.winner === 'A') ? m.playerB : m.playerA;
          if (wid) w[wid] = (w[wid] || 0) + 1;
          if (lid) l[lid] = (l[lid] || 0) + 1;
        });
      });
      return ids.map(function (id, i) {
        return {
          id: id, name: E.nameOf(t, id), rank: i + 1,
          wins: w[id] || 0, losses: l[id] || 0, draws: 0,
          matches: (w[id] || 0) + (l[id] || 0),
          // v1.14.1：这个阶段的「晋级下一阶段」名单里有没有他（给晋级分用）
          adv: (stage.advanced || []).indexOf(id) >= 0
        };
      });
    }
    var st = [];
    try { st = E.standings(t, { stageIndex: si }) || []; } catch (e) { st = []; }
    return st.map(function (s) {
      return {
        id: s.id, name: s.name, rank: s.rank,
        wins: s.wins, losses: s.losses, draws: s.draws, matches: s.matches,
        adv: (stage.advanced || []).indexOf(s.id) >= 0
      };
    });
  };

  // 整站名次：最后一个阶段的人排在前面，被更早淘汰的依次排在后面
  E.tournamentResults = function (t) {
    var lastSi = -1;
    (t.stages || []).forEach(function (s, i) {
      if ((s.roundsData || []).length) lastSi = i;
    });
    if (lastSi < 0) return [];
    var seen = {}, out = [];
    var agg = {};
    // 整站口径的「晋级」：打进了最后一个阶段（单阶段赛事则看该阶段自己的晋级名单）
    var lastIds = {};
    E.stageResults(t, lastSi).forEach(function (r) { lastIds[r.id] = 1; });
    var lastAdv = {};
    (((t.stages[lastSi] || {}).advanced) || []).forEach(function (id) { lastAdv[id] = 1; });
    function advOf(id) {
      return (lastSi > 0) ? !!lastIds[id] : !!lastAdv[id];
    }
    for (var si = 0; si <= lastSi; si++) {
      E.stageResults(t, si).forEach(function (r) {
        var a = agg[r.id] || (agg[r.id] = { wins: 0, losses: 0, draws: 0, matches: 0 });
        a.wins += r.wins; a.losses += r.losses; a.draws += r.draws; a.matches += r.matches;
      });
    }
    for (var k = lastSi; k >= 0; k--) {
      E.stageResults(t, k).forEach(function (r) {
        if (seen[r.id]) return;
        seen[r.id] = 1;
        var a = agg[r.id] || { wins: r.wins, losses: r.losses, draws: r.draws, matches: r.matches };
        out.push({
          id: r.id, name: r.name, rank: out.length + 1,
          wins: a.wins, losses: a.losses, draws: a.draws, matches: a.matches, lastStage: k,
          adv: advOf(r.id)
        });
      });
    }
    return out;
  };

  E.tournamentDone = function (t) {
    if (!t) return false;
    if (t.status === 'finished') return true;
    var si = t.currentStage || 0;
    if (si < (t.stages || []).length - 1) return false;
    var st = t.stages[si];
    if (!st) return true;
    try { return !!E.stageFinished(t, st); } catch (e) { return false; }
  };

  E.stageDoneForSeason = function (t, stage, si) {
    if (!stage) return false;
    if (stage.status === 'finished') return true;
    if (si < (t.currentStage || 0)) return true;
    try { return !!E.stageFinished(t, stage); } catch (e) { return false; }
  };

  /**
   * 赛季的计分方案（v2.4）
   *   'site'   —— 各站赛事用它自己的积分榜算分，赛季只加总（推荐，默认）
   *   'single' —— 赛季自己定一套计分方法，所有计分单元都用它
   *   'stage'  —— 每个阶段（计分单元）各有一套计分方法，互不影响
   */
  E.seasonPlan = function (season) {
    var r = (season && season.rule) || {};
    if (r.source !== 'season') return 'site';
    return (r.plan === 'stage') ? 'stage' : 'single';
  };

  /**
   * 列出赛季的计分单元
   *   rule.unit = 'tournament' → 每站赛事一个单元
   *   rule.unit = 'stage'      → 赛事内每个有对阵的阶段各一个单元
   *   plan = 'stage'           → 恒定按「阶段」分单元
   */
  E.seasonUnits = function (season, tlist) {
    var out = [];
    var plan = E.seasonPlan(season);
    var src = (plan === 'site') ? 'tournament' : 'season';
    // source='tournament' 时赛季只加总，单元恒为「站」；站内怎么算由该站自己的积分规则决定
    var unit = (src === 'season')
      ? ((plan === 'stage' || (season.rule && season.rule.unit === 'stage')) ? 'stage' : 'tournament')
      : 'tournament';
    (tlist || []).forEach(function (t) {
      var stages = t.stages || [];
      if (unit === 'stage') {
        stages.forEach(function (s, si) {
          if (!(s.roundsData || []).length) return;
          var done = E.stageDoneForSeason(t, s, si);
          out.push({
            key: 't:' + t.id + '#' + si, tid: t.id, si: si,
            tname: t.name, sname: s.name || ('第 ' + (si + 1) + ' 阶段'),
            label: t.name + ' · ' + (s.name || ('第 ' + (si + 1) + ' 阶段')),
            status: done ? 'finished' : 'running'
          });
        });
      } else {
        var has = stages.some(function (s) { return (s.roundsData || []).length; });
        if (!has) return;
        var done2 = E.tournamentDone(t);
        out.push({
          key: 't:' + t.id, tid: t.id, si: null,
          tname: t.name, sname: '',
          label: t.name,
          status: done2 ? 'finished' : 'running'
        });
      }
    });
    var includeRunning = !!(season && season.rule && season.rule.includeRunning);
    out.forEach(function (u) {
      u.counted = (u.status === 'finished') || includeRunning;
    });
    return out;
  };

  /**
   * 某个单元最终生效的规则（默认值 + 单元覆盖）
   * v2.4：单元覆盖里写了的字段就生效（方式 / 名次档位 / 胜场分 / 叠加），
   *       没写就跟随统一规则 —— 这样「每个阶段分别设置」才能真正改分值，
   *       而老赛季那种「只覆盖叠加方式」的存档行为保持不变。
   */
  E.seasonRuleFor = function (season, unit) {
    var base = (season && season.rule) || {};
    var ov = ((base.overrides || {})[unit.key]) || {};
    var rank = Object.assign({}, base.rank || {});
    if (Array.isArray(rank.tiers)) {
      rank.tiers = rank.tiers.map(function (t) { return Object.assign({}, t); });
    }
    if (ov.rank) {
      if (Array.isArray(ov.rank.tiers) && ov.rank.tiers.length) {
        rank.tiers = ov.rank.tiers.map(function (t) { return Object.assign({}, t); });
      }
      if (ov.rank.step !== undefined && ov.rank.step !== null) rank.step = ov.rank.step;
      if (ov.rank.floor !== undefined && ov.rank.floor !== null) rank.floor = ov.rank.floor;
      if (ov.rank.top) rank.top = Object.assign({}, rank.top || {}, ov.rank.top);
    }
    rank.top = Object.assign({}, (base.rank || {}).top || {}, (ov.rank || {}).top || {});
    return {
      mode: (['rank', 'win'].indexOf(ov.mode) >= 0 ? ov.mode : base.mode) || 'rank',
      stack: (typeof ov.stack === 'boolean') ? ov.stack : (base.stack !== false),
      resetScope: ov.resetScope || base.resetScope || 'participants',
      rank: rank,
      win: Object.assign({}, base.win || {}, ov.win || {})
    };
  };

  /**
   * 取（必要时创建）某个阶段的独立计分规则。
   * 逐阶段模式下每个单元都持有一份完整规则：方式 + 分值 + 叠加方式，
   * 这样界面才能「每个阶段都真的能改」，引擎也只看这一份。
   */
  E.seasonStageRule = function (season, key) {
    var r = (season && season.rule) || {};
    r.overrides = r.overrides || {};
    var ov = r.overrides[key];
    if (!ov || typeof ov !== 'object') { ov = {}; r.overrides[key] = ov; }
    ov.on = true;
    if (['rank', 'win'].indexOf(ov.mode) < 0) ov.mode = (r.mode === 'win') ? 'win' : 'rank';
    ov.rank = ov.rank || {};
    if (!Array.isArray(ov.rank.tiers) || !ov.rank.tiers.length) {
      ov.rank.tiers = ((r.rank && r.rank.tiers) || []).map(function (t) { return Object.assign({}, t); });
    }
    if (ov.rank.step === undefined) ov.rank.step = (r.rank && r.rank.step !== undefined) ? r.rank.step : 3;
    if (ov.rank.floor === undefined) ov.rank.floor = (r.rank && r.rank.floor !== undefined) ? r.rank.floor : 5;
    ov.win = Object.assign({}, r.win || {}, ov.win || {});
    if (typeof ov.stack !== 'boolean') ov.stack = (r.stack !== false);
    return ov;
  };

  // 逐阶段模式：把所有单元的独立规则补齐（返回新建的数量，供界面决定是否落盘）
  E.seasonSyncStageRules = function (season, units) {
    if (E.seasonPlan(season) !== 'stage') return 0;
    var r = season.rule;
    r.overrides = r.overrides || {};
    var made = 0;
    (units || []).forEach(function (u) {
      if (!r.overrides[u.key] || typeof r.overrides[u.key] !== 'object') made++;
      E.seasonStageRule(season, u.key);
    });
    return made;
  };

  /**
   * 名次 → 分数（赛季 / 赛事共用的唯一口径）
   * 新口径（v1.14.0）：档位是「区间」——{from, to, pts}，第 2~3 名同属一档、同分。
   *   名次落在某档区间内 → 直接取该档分；
   *   落在档位之间的空档 → 从「上一个更低的档位（to 小于该名次）」按 step 递减；
   *   低于第一档 → 从第一档往上加（越靠前分越高）。
   * 旧口径（rank.top）继续支持：没有 tiers 时按名次点值 + step 递减。
   */
  E.rankPoints = function (rule, rank) {
    var rk = parseInt(rank, 10);
    if (!(rk >= 1)) return 0;
    var R = (rule && rule.rank) || {};
    var step = parseFloat(R.step);
    var floor = parseFloat(R.floor);
    if (!(step >= 0)) step = 0;
    if (!(floor >= 0)) floor = 0;

    var tiers = Array.isArray(R.tiers) ? R.tiers : null;
    if (tiers && tiers.length) {
      var list = tiers.slice().sort(function (a, b) { return a.from - b.from || a.to - b.to; });
      // 1) 直接落在某档区间内
      for (var i = 0; i < list.length; i++) {
        var t = list[i];
        var f = parseInt(t.from, 10), e = parseInt(t.to, 10);
        if (!(f >= 1)) continue;
        if (!(e >= f)) e = f;
        if (rk >= f && rk <= e) return Math.max(0, parseFloat(t.pts) || 0);
      }
      // 2) 档位之间的空档 / 最后一档之后：从上一个更低档的末尾按 step 递减
      var prev = null;
      for (var j = 0; j < list.length; j++) {
        var tj = list[j];
        if ((parseInt(tj.to, 10) || parseInt(tj.from, 10)) < rk) prev = tj; else break;
      }
      if (prev) {
        var pe = parseInt(prev.to, 10) || parseInt(prev.from, 10);
        var pv = parseFloat(prev.pts) || 0;
        return Math.max(floor, pv - (rk - pe) * step);
      }
      // 3) 比第一档还靠前（第一档 from > 1 时）
      var first = list[0];
      var ff = parseInt(first.from, 10) || 1;
      return (parseFloat(first.pts) || 0) + (ff - rk) * step;
    }

    // ---- 旧口径：rank.top ----
    var top = R.top || {};
    var keys = Object.keys(top).map(function (k) { return parseInt(k, 10); })
      .filter(function (n) { return n >= 1; }).sort(function (a, b) { return a - b; });
    if (!keys.length) return 0;
    var maxR = keys[keys.length - 1];
    var baseVal = parseFloat(top[maxR]);
    if (!(baseVal >= 0)) baseVal = 0;
    if (top[rk] !== undefined && top[rk] !== null && top[rk] !== '') {
      var v = parseFloat(top[rk]);
      if (v >= 0) return v;
    }
    var ref = rk;                       // 从最近的已定义档位往下扣
    if (rk <= maxR) {
      for (var k2 = keys.length - 1; k2 >= 0; k2--) {
        if (keys[k2] <= rk) { ref = keys[k2]; break; }
      }
      var bv = parseFloat(top[ref]);
      if (!(bv >= 0)) bv = 0;
      return Math.max(floor, bv - (rk - ref) * step);
    }
    return Math.max(floor, baseVal - (rk - maxR) * step);
  };

  /**
   * 这个名次在积分规则里是否被标为「晋级下一阶段」
   * 只是标注：不改动谁能进下一阶段（那是阶段自己的「晋级」设置管的）。
   */
  E.rankAdv = function (rule, rank) {
    var rk = parseInt(rank, 10);
    if (!(rk >= 1)) return false;
    var R = (rule && rule.rank) || {};
    var tiers = Array.isArray(R.tiers) ? R.tiers : [];
    for (var i = 0; i < tiers.length; i++) {
      var t = tiers[i];
      var f = parseInt(t.from, 10), e = parseInt(t.to, 10);
      if (!(f >= 1)) continue;
      if (!(e >= f)) e = f;
      if (rk >= f && rk <= e) return !!t.adv;
    }
    return false;
  };

  // 规则里是否存在任何「晋级」标注（用于决定积分榜要不要显示这一列）
  E.rankAdvOn = function (rule) {
    var tiers = (rule && rule.rank && rule.rank.tiers) || [];
    for (var i = 0; i < tiers.length; i++) if (tiers[i] && tiers[i].adv) return true;
    return false;
  };

  // 旧名（赛季积分首发时的名字），保留别名避免外部脚本失效
  E.seasonRankPoints = function (rule, rank) { return E.rankPoints(rule, rank); };

  // 胜场 → 分数
  E.winPoints = function (rule, w, d, l) {
    var W = (rule && rule.win) || {};
    function num(x) { var n = parseFloat(x); return n >= 0 || n < 0 ? n : 0; }
    return num(W.base) + (parseInt(w, 10) || 0) * num(W.perWin)
      + (parseInt(d, 10) || 0) * num(W.perDraw) + (parseInt(l, 10) || 0) * num(W.perLoss);
  };
  E.seasonWinPoints = function (rule, w, d, l) { return E.winPoints(rule, w, d, l); };

  /**
   * 一条名次记录 → 分数（按该规则的方式）
   * v2.0：计分方式是三选一
   *   mode='rank' → 按名次分档给分
   *   mode='win'  → 按胜 / 平 / 负给分
   *   mode='adv'  → 按是否晋级下一阶段给分（yes / no），不和前两种相加
   * 晋级判定来自这条记录的 adv 字段（阶段实际晋级名单算出来的）。
   */
  E.ptsOf = function (rule, r) {
    if (!rule || !r) return 0;
    if (rule.mode === 'adv') {
      var A = rule.adv || {};
      var yes = parseFloat(A.yes), no = parseFloat(A.no);
      if (isNaN(yes)) yes = 0;
      if (isNaN(no)) no = 0;
      return (r.adv === true) ? yes : no;
    }
    return rule.mode === 'win'
      ? E.winPoints(rule, r.wins, r.draws, r.losses)
      : E.rankPoints(rule, r.rank);
  };

  // 规则是不是「按是否晋级下一阶段给分」
  E.ptsAdvOn = function (rule) {
    return !!(rule && rule.mode === 'adv');
  };

  /**
   * 某场赛事在某个阶段生效的积分规则
   * si = null → 整站规则；si = 阶段序号 → 该阶段若单独设置过就用它（完整独立的一套）
   */
  E.ptsRuleFor = function (t, si) {
    var base = (t && t.ptsRule) || null;
    if (!base) return null;
    if (si !== null && si !== undefined) {
      var ov = (base.stageOv || {})[String(si)];
      if (ov && typeof ov === 'object') return ov;
    }
    return base;
  };

  /**
   * 赛事内部积分榜（「直接在比赛里设置积分榜体系」的落地）
   *   unit = tournament → 整站算一次，名次取整站最终名次
   *   unit = stage      → 每个打过比赛的阶段各算一次，按各阶段自己的规则给分
   * @return {on, units, rows:[{id,name,pos,total,stops,best,units:{key:{pts,rank,...}}}], warnings}
   */
  E.tournamentPoints = function (t) {
    var out = { on: !!(t && t.ptsRule && t.ptsRule.on), units: [], rows: [], warnings: [] };
    if (!t || !out.on) return out;
    var base = t.ptsRule;
    var stages = t.stages || [];

    if (base.unit === 'stage') {
      stages.forEach(function (s, si) {
        if (!(s.roundsData || []).length) return;
        out.units.push({
          key: 's' + si, si: si,
          label: s.name || ('第 ' + (si + 1) + ' 阶段'),
          status: E.stageDoneForSeason(t, s, si) ? 'finished' : 'running',
          rule: E.ptsRuleFor(t, si)
        });
      });
    } else {
      var has = stages.some(function (s) { return (s.roundsData || []).length; });
      if (has) {
        out.units.push({
          key: 'all', si: null, label: '整站',
          status: E.tournamentDone(t) ? 'finished' : 'running',
          rule: E.ptsRuleFor(t, null)
        });
      }
    }

    var rows = {}, order = [];
    out.units.forEach(function (u) {
      var rule = u.rule || base;
      u.mode = rule.mode;
      /* 阶段之间怎么合（v2.0）：阶段自己设了 ptsStack 就听阶段的，
         没设（inherit）才跟随赛事默认 rule.stack。
           stack = 与上一阶段叠加
           reset = 不叠加：只有晋级到本阶段的人重新起算，本阶段的分单独给 */
      var stageNav = (u.si === null) ? null : stages[u.si];
      var stackOn = (stageNav && stageNav.ptsStack === 'stack') ? true
        : (stageNav && stageNav.ptsStack === 'reset') ? false
          : !!rule.stack;
      u.stack = stackOn;
      u.stageStack = stageNav ? (stageNav.ptsStack || 'inherit') : 'inherit';
      var res = (u.si === null) ? E.tournamentResults(t) : E.stageResults(t, u.si);
      if (!res.length) { out.warnings.push(u.label + '：还没有可用名次'); return; }

      var parts = {};
      res.forEach(function (r) { parts[E.nameKey(r.name) || ('id:' + r.id)] = 1; });

      // 不叠加：该阶段重新起算（默认只重置进入该阶段的人）
      if (!stackOn) {
        order.forEach(function (k) {
          if (rule.resetScope === 'all' || parts[k]) {
            rows[k].total = 0; rows[k].stops = 0; rows[k].best = 0; rows[k].units = {};
          }
        });
      }

      res.forEach(function (r) {
        var key = E.nameKey(r.name) || ('id:' + r.id);
        var row = rows[key];
        if (!row) {
          row = rows[key] = { key: key, name: r.name, id: r.id, total: 0, stops: 0, best: 0, units: {} };
          order.push(key);
        }
        row.id = r.id;
        var pts = E.ptsOf(rule, r);
        var advOn = E.ptsAdvOn(rule);
        var basePts = advOn ? 0
          : ((rule.mode === 'win')
            ? E.winPoints(rule, r.wins, r.draws, r.losses)
            : E.rankPoints(rule, r.rank));
        var advPts = advOn ? pts : 0;
        row.total += pts;
        row.stops += 1;
        if (r.rank && (!row.best || r.rank < row.best)) row.best = r.rank;
        row.units[u.key] = {
          pts: pts, rank: r.rank, wins: r.wins, losses: r.losses, draws: r.draws,
          adv: !!r.adv, advPts: advPts, basePts: basePts,
          label: u.label, si: u.si
        };
      });
    });

    var list = order.map(function (k) { return rows[k]; });
    list.sort(function (a, b) {
      if (b.total !== a.total) return b.total - a.total;
      if ((a.best || 999) !== (b.best || 999)) return (a.best || 999) - (b.best || 999);
      if (b.stops !== a.stops) return b.stops - a.stops;
      return String(a.name).localeCompare(String(b.name));
    });
    list.forEach(function (r, i) {
      r.pos = (i > 0 && list[i - 1].total === r.total) ? list[i - 1].pos : i + 1;
    });
    out.rows = list;
    return out;
  };

  /**
   * 赛季积分表
   *   source='tournament' → 各站赛事用自己的积分榜规则算分，赛季只做加总
   *   source='season'     → 老模式：赛季统一一套分值覆盖各站
   * @return {ok, source, units, rows:[{key,name,pos,total,stops,best,units:{key:{pts,rank,...}}}], warnings}
   */
  E.seasonTable = function (season, tlist) {
    var plan = E.seasonPlan(season);
    if (plan === 'site') {
      var a = E.seasonTableBySite(season, tlist);
      a.plan = 'site';
      return a;
    }
    var b = E.seasonTableByRule(season, tlist);
    b.plan = plan;
    return b;
  };

  /**
   * 赛季 = 各站赛事积分之和（推荐口径）
   * 每站先用自己的 ptsRule 算出「本赛事积分榜」，赛季只负责把同一个人的各站分数加起来。
   */
  E.seasonTableBySite = function (season, tlist) {
    var units = E.seasonUnits(season, tlist);
    var byT = {};
    (tlist || []).forEach(function (t) { byT[t.id] = t; });
    var rows = {}, order = [], warnings = [];

    units.forEach(function (u) {
      var t = byT[u.tid];
      if (!t) return;
      var srule = E.seasonRuleFor(season, u);   // 赛季层只管叠加 / 重置 / 是否计入
      u.mode = 'site';
      u.stack = srule.stack;
      u.ptsOn = !!(t.ptsRule && t.ptsRule.on);
      u.siteUnit = (t.ptsRule && t.ptsRule.unit === 'stage') ? 'stage' : 'tournament';
      u.siteMode = (t.ptsRule && t.ptsRule.mode) || 'rank';
      if (!u.counted) return;

      var tp = E.tournamentPoints(t);
      if (!tp.on) { warnings.push(u.label + '：没有启用赛事积分榜，本站暂不计分'); return; }
      if (!tp.rows.length) { warnings.push(u.label + '：还没有可用名次'); return; }

      var parts = {};
      tp.rows.forEach(function (r) { parts[r.key] = 1; });

      // 不叠加：这一站重新起算（默认只重置参加这一站的人）
      if (!srule.stack) {
        order.forEach(function (k) {
          if (srule.resetScope === 'all' || parts[k]) {
            rows[k].total = 0; rows[k].stops = 0; rows[k].best = 0; rows[k].units = {};
          }
        });
      }

      tp.rows.forEach(function (r) {
        var row = rows[r.key];
        if (!row) {
          row = rows[r.key] = { key: r.key, name: r.name, id: r.id, total: 0, stops: 0, best: 0, units: {} };
          order.push(r.key);
        }
        row.id = r.id;
        row.total += r.total;
        row.stops += 1;
        if (r.pos && (!row.best || r.pos < row.best)) row.best = r.pos;
        row.units[u.key] = {
          pts: r.total, rank: r.pos, siteStops: r.stops, unitStops: tp.units.length,
          label: u.label, tid: u.tid, si: null
        };
      });
    });

    var list = order.map(function (k) { return rows[k]; });
    list.sort(function (a, b) {
      if (b.total !== a.total) return b.total - a.total;
      if ((a.best || 999) !== (b.best || 999)) return (a.best || 999) - (b.best || 999);
      if (b.stops !== a.stops) return b.stops - a.stops;
      return String(a.name).localeCompare(String(b.name));
    });
    list.forEach(function (r, i) {
      r.pos = (i > 0 && list[i - 1].total === r.total) ? list[i - 1].pos : i + 1;
    });

    return {
      ok: true, source: 'tournament', units: units, rows: list, warnings: warnings,
      counted: units.filter(function (u) { return u.counted; }).length
    };
  };

  /** 赛季统一规则模式（老口径，保留兼容） */
  E.seasonTableByRule = function (season, tlist) {
    var units = E.seasonUnits(season, tlist);
    var byT = {};
    (tlist || []).forEach(function (t) { byT[t.id] = t; });
    var rows = {}, order = [], warnings = [];

    units.forEach(function (u) {
      var t = byT[u.tid];
      if (!t) return;
      var rule = E.seasonRuleFor(season, u);
      u.mode = rule.mode;
      u.stack = rule.stack;
      if (!u.counted) return;

      var res = (u.si === null) ? E.tournamentResults(t) : E.stageResults(t, u.si);
      if (!res.length) { warnings.push(u.label + '：还没有可用名次'); return; }

      var parts = {};
      res.forEach(function (r) { parts[E.nameKey(r.name) || ('id:' + r.id)] = 1; });

      // 不叠加：该单元重新起算（默认只重置进入该单元的人）
      if (!rule.stack) {
        order.forEach(function (k) {
          if (rule.resetScope === 'all' || parts[k]) {
            rows[k].total = 0;
            rows[k].stops = 0;
            rows[k].best = 0;
            rows[k].units = {};
          }
        });
      }

      res.forEach(function (r) {
        var key = E.nameKey(r.name) || ('id:' + r.id);
        var row = rows[key];
        if (!row) {
          row = rows[key] = {
            key: key, name: r.name, id: r.id,
            total: 0, stops: 0, best: 0, units: {}
          };
          order.push(key);
        }
        row.id = r.id;
        var pts = E.ptsOf(rule, r);
        row.total += pts;
        row.stops += 1;
        if (r.rank && (!row.best || r.rank < row.best)) row.best = r.rank;
        row.units[u.key] = {
          pts: pts, rank: r.rank, wins: r.wins, losses: r.losses, draws: r.draws,
          label: u.label, tid: u.tid, si: u.si
        };
      });
    });

    var list = order.map(function (k) { return rows[k]; });
    list.sort(function (a, b) {
      if (b.total !== a.total) return b.total - a.total;
      if ((a.best || 999) !== (b.best || 999)) return (a.best || 999) - (b.best || 999);
      if (b.stops !== a.stops) return b.stops - a.stops;
      return String(a.name).localeCompare(String(b.name));
    });
    list.forEach(function (r, i) {
      r.pos = (i > 0 && list[i - 1].total === r.total) ? list[i - 1].pos : i + 1;
    });

    return {
      ok: true, source: 'season', units: units, rows: list, warnings: warnings,
      counted: units.filter(function (u) { return u.counted; }).length
    };
  };

})(window);
