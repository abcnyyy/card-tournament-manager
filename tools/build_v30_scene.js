/* v2.2 界面验收场景
   1. 瑞士轮手动配对（pairMode=manual，未生成对阵）
   2. 循环赛手动配对
   3. 小组赛手动配对（2 组，按组编排）
   4. 单败淘汰手动摆放首轮位（drawMode=manual，未生成对阵）
   5. 双败半区互换（deCrossDrop，已打 2 轮：胜者组第 2 轮 + 败者组第 1 轮）
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

  /* 1. 瑞士轮手动配对 */
  (function () {
    var t = mkTour('瑞士轮手动配对', 8);
    var st = t.stages[0];
    st.type = 'swiss'; st.rounds = 3; st.pairMode = 'manual';
    E.ensureParticipants(t);
    S.put(t);
  })();

  /* 2. 循环赛手动配对 */
  (function () {
    var t = mkTour('循环赛手动配对', 6);
    var st = t.stages[0];
    st.type = 'round_robin'; st.cycles = 1; st.pairMode = 'manual';
    E.ensureParticipants(t);
    S.put(t);
  })();

  /* 3. 小组赛手动配对（2 组 × 4 人，组内循环） */
  (function () {
    var t = mkTour('小组赛手动配对', 8);
    var st = t.stages[0];
    st.type = 'groups'; st.groupCount = 2; st.groupMethod = 'snake';
    st.groupType = 'round_robin'; st.groupCycles = 1; st.pairMode = 'manual';
    E.ensureParticipants(t);
    st.groups = E.buildGroups(t, st);
    S.put(t);
  })();

  /* 4. 单败淘汰手动摆放首轮位 */
  (function () {
    var t = mkTour('单败手动摆位', 8);
    var st = t.stages[0];
    st.type = 'single_elim'; st.drawMode = 'manual';
    E.ensureParticipants(t);
    S.put(t);
  })();

  /* 5. 双败半区互换：先打完第 1 轮，再生成第 2 轮（此时败者组出现） */
  (function () {
    var t = mkTour('双败半区互换', 8);
    var st = t.stages[0];
    st.type = 'double_elim'; st.drawMode = 'seed'; st.deCrossDrop = true; st.gfMode = 'reset';
    E.ensureParticipants(t);
    E.generateRound(t);
    var rd0 = st.roundsData[0];
    (rd0.matches || []).forEach(function (m) {
      if (m.isBye || !m.playerA || !m.playerB) return;
      m.games = [{ w: 'A' }];
      E.evaluate(m, m.fmt || { gamesPerMatch: 1, winNeeded: 1 }, 'sudden_death');
    });
    E.finishRound(t);
    E.generateRound(t);
    S.put(t);
  })();
})();
