/* v2.0 界面验收场景
   A. 征服赛制团体赛：4 队 × 3 人（单败淘汰，已生成第 1 轮对阵）
   B. nvn 团体赛：4 队 × 3 人（用于批量录入）
   C. 晋级制赛事：8 人 / 2 阶段，第 1 阶段已打完并晋级 4 人；
      积分方式是「按是否晋级下一阶段给分」（v2.0 起是独立计分方式）
   D. 个人赛：8 人瑞士轮 1 轮（用于常显快捷录入）
   在页面里直接 eval，依赖 TMS.model / TMS.store / TMS.engine */
(function () {
  var M = TMS.model, S = TMS.store, E = TMS.engine;
  S.loadIndex().slice().forEach(function (x) { try { S.remove(x.id); } catch (e) {} });

  var SQUADS = [
    ['红队', ['红-1', '红-2', '红-3']],
    ['蓝队', ['蓝-1', '蓝-2', '蓝-3']],
    ['绿队', ['绿-1', '绿-2', '绿-3']],
    ['白队', ['白-1', '白-2', '白-3']]
  ];

  function mkTeamT(name, mode) {
    var t = M.createTournament(name);
    t.team = { on: true, mode: mode, size: 3, winNeeded: 0, fmt: null };
    t.format = { gamesPerMatch: 1, winNeeded: 1, recordScore: false, sets: 1, setRule: 'sets', setsToWin: 0 };
    SQUADS.forEach(function (tm, i) {
      var p = M.createPlayer(tm[0], i + 1);
      p.isTeam = true;
      p.members = tm[1].map(function (n, k) { return { id: 'mb_' + i + '_' + k, name: n, seed: k + 1 }; });
      t.players.push(p);
    });
    var st = M.defaultStage(0);
    st.type = 'single_elim';
    st.name = '第 1 阶段 · 四队淘汰';
    st.adv = { type: 'count', count: 1, score: 0, perGroup: 1 };
    t.stages = [st];
    t.currentStage = 0;
    t.status = 'running';
    return t;
  }

  var ta = mkTeamT('征服赛 · 4 队', 'conquest');
  var tb = mkTeamT('批量赛 · 4 队 nvn', 'nvn');

  /* ---- C. 晋级分赛事（第 1 阶段已结束） ---- */
  var NAMES = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛'];
  var tc = M.createTournament('晋级制 · 8 人两阶段');
  NAMES.forEach(function (n, i) { tc.players.push(M.createPlayer(n, i + 1)); });
  var c1 = M.defaultStage(0);
  c1.type = 'swiss'; c1.name = '第 1 阶段 · 瑞士轮'; c1.rounds = 1;
  c1.adv = { type: 'count', count: 4, score: 0, perGroup: 2 };
  var c2 = M.defaultStage(1);
  c2.type = 'single_elim'; c2.name = '第 2 阶段 · 四强';
  c2.adv = { type: 'count', count: 1, score: 0, perGroup: 1 };
  tc.stages = [c1, c2];
  tc.currentStage = 0;
  tc.status = 'running';
  tc.ptsRule = {
    on: true, mode: 'adv', unit: 'stage', stack: true,
    rank: {
      tiers: [
        { from: 1, to: 1, pts: 100, adv: true },
        { from: 2, to: 3, pts: 80, adv: true },
        { from: 4, to: 6, pts: 65, adv: false },
        { from: 7, to: 10, pts: 50, adv: false }
      ],
      step: 3, floor: 5
    },
    win: { perWin: 10, perDraw: 5, perLoss: 0, base: 0 },
    adv: { yes: 30, no: 5 },
    resetScope: 'participants', stageOv: {}
  };

  /* ---- D. 个人赛（快捷录入用） ---- */
  var td = M.createTournament('个人 · 8 人瑞士轮');
  td.format = { gamesPerMatch: 3, winNeeded: 2, recordScore: false, sets: 1, setRule: 'sets', setsToWin: 0 };
  NAMES.forEach(function (n, i) { td.players.push(M.createPlayer(n, i + 1)); });
  var d1 = M.defaultStage(0);
  d1.type = 'swiss'; d1.name = '第 1 阶段 · 瑞士轮'; d1.rounds = 1;
  d1.adv = { type: 'count', count: 4, score: 0, perGroup: 2 };
  td.stages = [d1];
  td.currentStage = 0;
  td.status = 'running';

  S.put(ta); S.put(tb); S.put(tc); S.put(td);

  [ta, tb, tc, td].forEach(function (t) { E.ensureParticipants(t); E.generateRound(t); });

  /* 把 C 的第 1 阶段打完并晋级 4 人 */
  var fmtC = E.fmtOf(tc, tc.stages[0]);
  tc.stages[0].roundsData[0].matches.forEach(function (m) {
    if (m.isBye || !m.playerA || !m.playerB) return;
    m.games = [{ w: 'A', a: 1, b: 0 }, { w: 'A', a: 1, b: 0 }];
    E.evaluate(m, fmtC, null);
  });
  E.finishStage(tc);

  S.put(ta); S.put(tb); S.put(tc); S.put(td);
  S.setCurrentId(tc.id);
  return tc.id;
})();
