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
