/* 生成用于视觉验收的演示赛事：25 人 / 4 阶段 / 瑞士轮已打 3 轮（第 4 轮部分完成）
   在页面里直接 eval，依赖 TMS.model / TMS.store / TMS.engine */
(function () {
  var M = TMS.model, S = TMS.store, E = TMS.engine;
  S.loadIndex().slice().forEach(function (x) { try { S.remove(x.id); } catch (e) {} });

  var NAMES = ['JCLE', 'kaibailan', 'Fiandre', 'iwsz000', 'ppppsssss', '杰森', '黑心博士', 'leftno12',
    'loomo', '邪正人鬼', 'buluaisu', 'txz', 'Dadadada', '夜空', '一只猫', '老陈',
    '阿森', '小满', '橘子', '白夜', 'Neo', '千叶', '山岚', 'Yuki', '北辰'];

  var t = M.createTournament('2026 秋季联赛 · 第 3 站');
  t.format = { gamesPerMatch: 3, winNeeded: 2, recordScore: false };
  t.scoring.mode = 'result';
  t.scoring.win = 3; t.scoring.draw = 1; t.scoring.lose = 0; t.scoring.bye = 3;
  NAMES.forEach(function (n, i) { t.players.push(M.createPlayer(n, i + 1)); });

  function mk(si, type, name, advCount) {
    var s = M.defaultStage(si);
    s.type = type; s.name = name;
    s.adv = { type: 'count', count: advCount, score: 0, perGroup: 2 };
    return s;
  }
  var s1 = mk(0, 'swiss', '第 1 阶段 · 瑞士轮', 16);
  s1.rounds = 5;
  var s2 = mk(1, 'single_elim', '第 2 阶段 · 16 进 8', 8);
  var s3 = mk(2, 'single_elim', '第 3 阶段 · 8 进 4', 4);
  var s4 = mk(3, 'double_elim', '第 4 阶段 · 四强双败', 1);
  t.stages = [s1, s2, s3, s4];
  t.currentStage = 0;
  t.status = 'running';
  E.ensureParticipants(t);

  function strength(id) {
    var p = t.players.filter(function (x) { return x.id === id; })[0];
    return p ? p.seed : 99;
  }
  function playRound(stage, keepPending) {
    var rd = stage.roundsData[stage.roundsData.length - 1];
    rd.matches.forEach(function (m, idx) {
      if (m.isBye) { E.evaluate(m, E.fmtOfMatch(t, stage, m), stage.tie); return; }
      if (!m.playerA || !m.playerB) return;
      if (keepPending && idx >= 2) return;
      var w = (strength(m.playerA) <= strength(m.playerB)) ? 'A' : 'B';
      var f = E.fmtOfMatch(t, stage, m);
      var need = (parseInt(f.winNeeded, 10) > 0) ? parseInt(f.winNeeded, 10) : f.gamesPerMatch;
      m.games = [];
      for (var k = 0; k < need; k++) {
        m.games.push({ w: w, a: need - k, b: k });
      }
      E.evaluate(m, f, stage.tie);
    });
  }

  t.currentStage = 0;
  for (var r = 0; r < 3; r++) {
    var g = E.generateRound(t);
    if (!g.ok) break;
    playRound(s1, false);
    E.finishRound(t);
  }
  var g4 = E.generateRound(t);
  if (g4.ok) playRound(s1, true);

  /* ---- 追加两站已结束的赛事 + 一个赛季，用于赛季积分页 ---- */
  function makeStop(label, names, createdAt) {
    var tt = M.createTournament(label);
    tt.createdAt = createdAt;
    names.forEach(function (n, i) { tt.players.push(M.createPlayer(n, i + 1)); });
    var st = M.defaultStage(0);
    st.type = 'single_elim';
    st.name = '淘汰赛';
    st.participants = tt.players.map(function (p) { return p.id; });
    st.adv = { type: 'count', count: 1, score: 0, perGroup: 1 };
    tt.stages = [st];
    tt.currentStage = 0;
    tt.status = 'running';
    var rounds = Math.log2(names.length);
    for (var r = 0; r < rounds; r++) {
      var g = E.generateRound(tt);
      if (!g.ok) break;
      var rd = st.roundsData[st.roundsData.length - 1];
      rd.matches.forEach(function (m) {
        if (!m.playerA || !m.playerB) return;
        if (m.isBye) { E.evaluate(m, E.fmtOfMatch(tt, st, m), st.tie); return; }
        var a = tt.players.filter(function (x) { return x.id === m.playerA; })[0];
        var b = tt.players.filter(function (x) { return x.id === m.playerB; })[0];
        var w = (a.seed <= b.seed) ? 'A' : 'B';
        m.games = [{ w: w, a: 1, b: 0 }];
        E.evaluate(m, E.fmtOfMatch(tt, st, m), st.tie);
      });
      E.finishRound(tt);
    }
    st.status = 'finished';
    tt.status = 'finished';
    return tt;
  }

  var stop1 = makeStop('2026 秋季联赛 · 第 1 站', NAMES.slice(0, 8), '2026-08-01 10:00');
  var stop2 = makeStop('2026 秋季联赛 · 第 2 站', NAMES.slice(0, 8).reverse(), '2026-09-01 10:00');
  t.createdAt = '2026-10-01 10:00';

  var se = M.defaultSeason('2026 秋季联赛');
  se.createdAt = '2026-08-01 09:00';
  // 老口径场景：赛季自己定义一套分值（v1.12 的「赛季统一规则」）
  se.rule.source = 'season';
  S.putSeason(se);

  S.put(stop1); S.put(stop2);
  stop1.seasonId = se.id; S.put(stop1);
  stop2.seasonId = se.id; S.put(stop2);
  t.seasonId = se.id; S.put(t);

  S.put(t);
  S.setCurrentId(t.id);
  return t.id;
})();
/**
 * v1.13.0 演示场景：两站赛事各自定义积分体系 + 赛季只做加总
 * 需先注入 build_demo_scene.js（提供 25 人 / 4 阶段赛事 / 老口径赛季），
 * 再注入本脚本追加：
 *   · 赛季「2026 积分联赛」source = tournament（各站自己的积分榜加总）
 *   · 两站 8 人单败淘汰，分值不同（第 2 站明显更低），用来验证各站各算
 *
 * 期望结果（8 人单败，名次 = 名单顺序）：
 *   第 1 站：1→100 2→80 3→65 4→55 5→45 6→38 7→32 8→26
 *   第 2 站：1→50  2→40 3→30 4→25 5→20 6→15 7→10 8→5（名单反向）
 *   P1 = 100 + 5 = 105（第 1）
 *   P2 = 80 + 10 = 90（第 2）
 *   P3 = 65 + 15 = 80（第 3）
 */
(function () {
  var TMS = window.TMS, M = TMS.model, E = TMS.engine, S = TMS.store;

  function makeStop(name, names, createdAt, top) {
    var t = M.createTournament(name);
    t.createdAt = createdAt;
    names.forEach(function (n, i) { t.players.push(M.createPlayer(n, i + 1)); });
    t.status = 'running';
    t.ptsRule = M.normalizePtsRule({
      on: true, mode: 'rank', unit: 'tournament',
      rank: { top: top, step: 2, floor: 5 }
    });

    var s = M.defaultStage(0);
    s.type = 'single_elim';
    s.name = '淘汰赛';
    s.participants = t.players.map(function (p) { return p.id; });
    s.adv = { type: 'count', count: 1, score: 0, perGroup: 1 };
    s.format = { gamesPerMatch: 1, winNeeded: 1, recordScore: false };
    s.useFormat = true;
    t.stages = [s];
    t.currentStage = 0;

    var rounds = Math.log2(names.length);
    for (var r = 0; r < rounds; r++) {
      var g = E.generateRound(t);
      if (!g.ok) break;
      var rd = s.roundsData[s.roundsData.length - 1];
      rd.matches.forEach(function (m) {
        if (!m.playerA || !m.playerB) return;
        if (m.isBye) { E.evaluate(m, E.fmtOfMatch(t, s, m), s.tie); return; }
        var sa = t.players.filter(function (p) { return p.id === m.playerA; })[0];
        var sb = t.players.filter(function (p) { return p.id === m.playerB; })[0];
        m.games = [{ w: (sa.seed <= sb.seed ? 'A' : 'B'), a: 1, b: 0 }];
        E.evaluate(m, E.fmtOfMatch(t, s, m), s.tie);
      });
      E.finishRound(t);
    }
    s.status = 'finished';
    t.status = 'finished';
    return t;
  }

  var NAMES = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];
  var top1 = { 1: 100, 2: 80, 3: 65, 4: 55, 5: 45, 6: 38, 7: 32, 8: 26 };
  var top2 = { 1: 50, 2: 40, 3: 30, 4: 25, 5: 20, 6: 15, 7: 10, 8: 5 };

  var t1 = makeStop('积分赛 · 第 1 站', NAMES, '2026-09-05 10:00', top1);
  var t2 = makeStop('积分赛 · 第 2 站', NAMES.slice().reverse(), '2026-09-20 10:00', top2);

  var se = M.defaultSeason('2026 积分联赛');
  se.createdAt = '2026-09-01 09:00';
  se.rule.source = 'tournament';
  se.rule.stack = true;
  se.rule.includeRunning = false;
  S.putSeason(se);

  S.put(t1); S.put(t2);
  t1.seasonId = se.id; S.put(t1);
  t2.seasonId = se.id; S.put(t2);

  S.setCurrentId(t1.id);
  return se.id;
})();
