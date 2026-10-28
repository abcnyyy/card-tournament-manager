/* v2.3 界面验收场景
   1. 破同阶段分：3 个阶段（前两段已结算、第 3 段进行中），
      破同表里开了「上一阶段得分 + 第 1 阶段得分 + 第 2 阶段得分 + 判负 + 警告」
   2. 纪律判负：8 人瑞士轮第 1 轮已打完（4 胜 4 负），用来现场记警告 / 判负
   依赖 TMS.model / TMS.store / TMS.engine，在页面里直接 eval */
(function () {
  var M = TMS.model, S = TMS.store, E = TMS.engine;
  S.loadIndex().slice().forEach(function (x) { try { S.remove(x.id); } catch (e) {} });

  function mkTour(name, n) {
    var t = M.createTournament(name);
    for (var i = 1; i <= n; i++) t.players.push(M.createPlayer('P' + i, i));
    var st = M.defaultStage(0);
    st.name = '第 1 阶段';
    st.adv = { type: 'count', count: 1, score: 0, perGroup: 1 };
    st.tie = 'sudden_death';
    t.stages = [st];
    t.currentStage = 0;
    t.status = 'running';
    return t;
  }

  // A 边全胜地把一轮打完
  function playRound(t, st) {
    var rd = st.roundsData[st.roundsData.length - 1];
    if (!rd) return;
    (rd.matches || []).forEach(function (m) {
      if (m.isBye || !m.playerA || !m.playerB) return;
      m.games = [{ w: 'A' }];
      E.evaluate(m, { gamesPerMatch: 1, winNeeded: 1, recordScore: false }, st.tie);
    });
    E.finishRound(t);
  }

  /* 1. 破同阶段分：3 阶段 */
  (function () {
    var t = mkTour('破同阶段分', 8);
    var s1 = t.stages[0];
    s1.name = '第 1 阶段'; s1.type = 'swiss'; s1.rounds = 2;
    var s2 = M.defaultStage(1);
    s2.name = '第 2 阶段'; s2.type = 'swiss'; s2.rounds = 1;
    var s3 = M.defaultStage(2);
    s3.name = '第 3 阶段'; s3.type = 'swiss'; s3.rounds = 3;
    t.stages = [s1, s2, s3];
    // 三个阶段都用同一批 8 人（不设晋级名额，避免「第二阶段只剩 1 人」）
    var ids = t.players.map(function (p) { return p.id; });
    s1.adv = { type: 'all', count: 8, score: 0, perGroup: 2 };
    s2.adv = { type: 'all', count: 8, score: 0, perGroup: 2 };
    s3.adv = { type: 'all', count: 8, score: 0, perGroup: 2 };
    s2.participants = ids.slice();
    s3.participants = ids.slice();

    [0, 1].forEach(function (si) {
      t.currentStage = si;
      var st = t.stages[si];
      E.ensureParticipants(t, st);
      var total = Math.max(1, parseInt(st.rounds, 10) || 1);
      for (var r = 0; r < total; r++) {
        E.generateRound(t);
        playRound(t, st);
      }
      st.status = 'finished';
    });

    // 第 3 阶段：只打 1 轮，保持进行中
    t.currentStage = 2;
    var st3 = t.stages[2];
    E.ensureParticipants(t, st3);
    E.generateRound(t);
    playRound(t, st3);

    t.scoring.tieOrder = ['points', 'forfeit', 'warnings', 'stagePoints',
      'stageP0', 'stageP1', 'seed'];
    t.status = 'running';
    S.put(t);
  })();

  /* 2. 纪律判负：第 1 轮已打完，等界面记警告 / 判负 */
  (function () {
    var t = mkTour('纪律判负', 8);
    var st = t.stages[0];
    st.type = 'swiss'; st.rounds = 3;
    E.ensureParticipants(t);
    E.generateRound(t);
    playRound(t, st);
    t.status = 'running';
    S.put(t);
  })();
})();
