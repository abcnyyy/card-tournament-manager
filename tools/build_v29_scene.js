/* v2.1 界面验收场景
   A. nvn 团体赛：2 队 × 3 人（用来验「每方上场人数」——队员 3 人、只上 2 人）
   B. KOF 团体赛：2 队 × 3 人（赢者留场、输者换人）
   在页面里直接 eval，依赖 TMS.model / TMS.store / TMS.engine */
(function () {
  var M = TMS.model, S = TMS.store, E = TMS.engine;
  S.loadIndex().slice().forEach(function (x) { try { S.remove(x.id); } catch (e) {} });

  function mk(name, mode) {
    var t = M.createTournament(name);
    t.team = { on: true, mode: mode, size: 3, playSize: 0, winNeeded: 0, fmt: null };
    t.format = { gamesPerMatch: 3, winNeeded: 2, recordScore: false, sets: 1, setRule: 'sets', setsToWin: 0 };
    [['红队', ['红-1', '红-2', '红-3']], ['白队', ['白-1', '白-2', '白-3']]].forEach(function (tm, i) {
      var p = M.createPlayer(tm[0], i + 1);
      p.isTeam = true;
      p.members = tm[1].map(function (n, k) { return { id: 'mb_' + i + '_' + k, name: n, seed: k + 1 }; });
      t.players.push(p);
    });
    var st = M.defaultStage(0);
    st.type = 'single_elim';
    st.name = '第 1 阶段 · 决赛';
    st.adv = { type: 'count', count: 1, score: 0, perGroup: 1 };
    st.tie = 'sudden_death';
    t.stages = [st];
    t.currentStage = 0;
    t.status = 'running';
    E.ensureParticipants(t);
    E.generateRound(t);
    S.put(t);
    return t;
  }

  mk('nvn 上场人数赛', 'nvn');
  mk('KOF 拳皇赛', 'kof');
})();
