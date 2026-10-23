/* 生成「16 人三阶段」赛事（16 进 8 → 8 进 4 → 四强双败），供 zoom_v21.js 截图用 */
(function () {
  var M = TMS.model, S = TMS.store, E = TMS.engine;
  S.loadIndex().slice().forEach(function (x) { S.remove(x.id); });
  var t = M.createTournament('合并对阵图 · 16 人三阶段');
  for (var i = 1; i <= 16; i++) t.players.push(M.createPlayer('选手' + i, i));

  function mk(si, type, name, target) {
    var s = M.defaultStage(si);
    s.type = type; s.name = name;
    s.adv = { type: 'count', count: target, score: 0, perGroup: 1 };
    return s;
  }
  var a = mk(0, 'single_elim', '16 进 8', 8);
  a.participants = t.players.map(function (p) { return p.id; });
  var b = mk(1, 'single_elim', '8 进 4', 4);
  var c = mk(2, 'double_elim', '四强双败', 1);
  t.stages = [a, b, c];
  t.currentStage = 0; t.status = 'running';
  E.ensureParticipants(t);

  function runStage(si) {
    t.currentStage = si;
    for (var g = 0; g < 20; g++) {
      var r = E.generateRound(t);
      if (!r.ok) break;
      var st = t.stages[si];
      var rd = st.roundsData[st.roundsData.length - 1];
      rd.matches.forEach(function (m) {
        if (m.isBye) { E.evaluate(m, E.fmtOfMatch(t, st, m), st.tie); return; }
        var na = parseInt(String(E.nameOf(t, m.playerA)).replace(/[^0-9]/g, ''), 10) || 99;
        var nb = parseInt(String(E.nameOf(t, m.playerB)).replace(/[^0-9]/g, ''), 10) || 99;
        var w = (na <= nb) ? 'A' : 'B';
        var f = E.fmtOfMatch(t, st, m);
        var need = (parseInt(f.winNeeded, 10) > 0) ? parseInt(f.winNeeded, 10) : f.gamesPerMatch;
        m.games = [];
        for (var k = 0; k < need; k++) m.games.push({ w: w, a: 1, b: 0 });
        E.evaluate(m, f, st.tie);
      });
      E.finishRound(t);
      if (E.stageFinished(t, st)) break;
    }
    E.finishStage(t);
    E.ensureParticipants(t);
  }
  runStage(0); runStage(1); runStage(2);

  S.put(t);
  TMS.current = t;
  return 'built';
})();
