/* v2.4 界面验收场景
   ① 赛季：2 站赛事 × 2 阶段，全部打完 → 赛季积分榜有 4 个计分单元
   ② 提前晋级轮空：一个 9 人瑞士轮（奇数人数，每轮 1 人轮空）+ 一个 9 人循环赛
   依赖 TMS.model / TMS.store / TMS.engine，在页面里直接 eval */
(function () {
  var M = TMS.model, S = TMS.store, E = TMS.engine;
  S.loadIndex().slice().forEach(function (x) { try { S.remove(x.id); } catch (e) {} });

  function playAll(t, st, rounds) {
    for (var r = 0; r < rounds; r++) {
      var g = E.generateRound(t);
      if (!g.ok) break;
      var rd = st.roundsData[st.roundsData.length - 1];
      (rd.matches || []).forEach(function (m) {
        if (m.isBye || !m.playerA || !m.playerB) return;
        // 种子靠前者赢：结果稳定可预期
        var pa = t.players.filter(function (x) { return x.id === m.playerA; })[0] || {};
        var pb = t.players.filter(function (x) { return x.id === m.playerB; })[0] || {};
        m.games = [{ w: (pa.seed || 99) <= (pb.seed || 99) ? 'A' : 'B' }];
        E.evaluate(m, { gamesPerMatch: 1, winNeeded: 1, recordScore: false }, st.tie);
      });
      E.finishRound(t, st);
    }
  }

  function mkStop(name, players, createdAt, offset) {
    var t = M.createTournament(name);
    t.createdAt = createdAt;
    players.forEach(function (n, i) { t.players.push(M.createPlayer(n, (offset || 0) + i + 1)); });
    t.status = 'running';
    t.stages = [];
    for (var si = 0; si < 2; si++) {
      var s = M.defaultStage(si);
      s.name = '第 ' + (si + 1) + ' 阶段';
      s.type = 'single_elim';
      s.adv = { type: 'all', count: players.length, score: 0, perGroup: 2 };
      s.participants = t.players.map(function (p) { return p.id; });
      s.format = { gamesPerMatch: 1, winNeeded: 1, recordScore: false };
      s.useFormat = true;
      t.stages.push(s);
    }
    t.currentStage = 0;
    t.stages.forEach(function (s, si) {
      t.currentStage = si;
      E.ensureParticipants(t, s);
      playAll(t, s, Math.log2(players.length));
      s.status = 'finished';
    });
    t.currentStage = t.stages.length - 1;
    t.status = 'finished';
    return t;
  }

  // 两站赛季：每站 4 人、2 个阶段 → 4 个计分单元
  (function () {
    var se = M.defaultSeason('2026 秋季联赛');
    se.rule.source = 'tournament';       // 默认口径：各站自己的积分
    S.putSeason(se);
    var t1 = mkStop('春季站', ['P1', 'P2', 'P3', 'P4'], '2026-01-05 10:00', 0);
    var t2 = mkStop('夏季站', ['P2', 'P3', 'P4', 'P1'], '2026-06-05 10:00', 0);
    [t1, t2].forEach(function (t) {
      t.seasonId = se.id;
      // 每站开启自己的积分榜，赛季「各站加总」才有分
      t.ptsRule = M.defaultPtsRule();
      t.ptsRule.on = true;
      t.ptsRule.mode = 'rank';
      t.ptsRule.unit = 'stage';
      S.put(t);
    });
  })();

  // 轮空场景：9 人瑞士轮（第 1 轮已生成，能看到轮空）
  (function () {
    var t = M.createTournament('奇数人数瑞士轮');
    for (var i = 1; i <= 9; i++) t.players.push(M.createPlayer('S' + i, i));
    var st = t.stages[0];
    st.name = '第 1 阶段';
    st.type = 'swiss';
    st.rounds = 5;
    st.clinch = { enabled: true, basis: 'match', winTarget: 3, lossTarget: 3, bonus: 0, bonusPerEarly: 0 };
    t.status = 'running';
    E.ensureParticipants(t);
    E.generateRound(t);
    t.status = 'running';
    S.put(t);
  })();
})();
