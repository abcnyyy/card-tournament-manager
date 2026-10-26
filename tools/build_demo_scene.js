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
