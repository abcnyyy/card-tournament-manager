/* v2.5 界面验收场景
   ① 一个「各站自己的积分」赛季：两站都是单败淘汰赛，各自启用不同的积分规则
      - 第 1 站：按胜场，每胜 7 分
      - 第 2 站：按名次（默认档位）
   ② 用来验证：赛季页能看到每站的规则摘要、能点「改规则」跳到赛事设置、能导出 JPG / PDF
   依赖 TMS.model / TMS.store / TMS.engine，在页面里直接 eval */
(function () {
  var M = TMS.model, S = TMS.store, E = TMS.engine;
  S.loadIndex().slice().forEach(function (x) { try { S.remove(x.id); } catch (e) {} });
  S.loadSeasons().slice().forEach(function (x) { try { S.delSeason(x.id); } catch (e) {} });

  function setRes(m, winner) {
    if (m.isBye || !m.playerA || !m.playerB) return;
    m.games = [{ w: winner }];
    E.evaluate(m, { gamesPerMatch: 1, winNeeded: 1, recordScore: false }, 'sudden_death');
  }

  function mkStop(name, names, pts) {
    var t = M.createTournament(name);
    names.forEach(function (n, i) { t.players.push(M.createPlayer(n, i + 1)); });
    t.status = 'running';
    var s = M.defaultStage(0);
    s.type = 'single_elim';
    s.name = '淘汰赛';
    s.participants = t.players.map(function (p) { return p.id; });
    s.adv = { type: 'count', count: 1, score: 0, perGroup: 1 };
    s.format = { gamesPerMatch: 1, winNeeded: 1, recordScore: false };
    s.useFormat = true;
    t.stages = [s];
    t.currentStage = 0;
    for (var r = 0; r < 2; r++) {
      var g = E.generateRound(t);
      if (!g.ok) break;
      var rd = s.roundsData[s.roundsData.length - 1];
      rd.matches.forEach(function (m) {
        var pa = t.players.filter(function (x) { return x.id === m.playerA; })[0] || {};
        var pb = t.players.filter(function (x) { return x.id === m.playerB; })[0] || {};
        setRes(m, (pa.seed || 99) <= (pb.seed || 99) ? 'A' : 'B');
      });
      E.finishRound(t, s);
    }
    s.status = 'finished';
    t.status = 'finished';
    t.ptsRule = Object.assign(M.defaultPtsRule(), pts);
    S.put(t);
    return t;
  }

  var se = M.defaultSeason('2026 测试联赛');
  S.putSeason(se);

  var t1 = mkStop('春季站', ['JCLE', '左手', '阿岚', '小满'],
    { on: true, unit: 'tournament', mode: 'win', win: { perWin: 7, perDraw: 0, perLoss: 0, base: 0 } });
  var t2 = mkStop('夏季站', ['阿岚', 'JCLE', '小满', '左手'],
    { on: true, unit: 'tournament', mode: 'rank' });

  [t1, t2].forEach(function (t) { t.seasonId = se.id; S.put(t); });
  S.setCurrentId(t1.id);
  window.__v33 = { seasonId: se.id, t1: t1.id, t2: t2.id };
})();
