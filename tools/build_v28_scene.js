/* v2.0 界面验收场景（第二轮）
   A. nvn 团体赛：4 队 × 3 人，阶段允许平局（用于「平这盘」）
      —— 每个回合可以换不同队员、比分会是 2:1 之类
   B. 征服赛团体赛：4 队 × 3 人
   C. 三阶段积分赛事：8 人，前两阶段已打完并晋级，
      积分方式 = 按是否晋级下一阶段给分（unit=stage，默认叠加）
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

  function mkTeamT(name, mode, tie) {
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
    st.tie = tie || 'sudden_death';
    t.stages = [st];
    t.currentStage = 0;
    t.status = 'running';
    return t;
  }

  var ta = mkTeamT('nvn 回合赛 · 4 队', 'nvn', 'draw_ok');
  var tb = mkTeamT('征服赛 · 4 队', 'conquest', 'sudden_death');

  /* ---------------- C. 三阶段积分赛事 ---------------- */
  var NAMES = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛'];
  var tc = M.createTournament('晋级分 · 8 人三阶段');
  NAMES.forEach(function (n, i) { tc.players.push(M.createPlayer(n, i + 1)); });
  var byName = {};
  tc.players.forEach(function (p) { byName[p.name] = p.id; });

  var c0 = M.defaultStage(0);
  c0.type = 'swiss'; c0.name = '第 1 阶段 · 8 人瑞士轮'; c0.rounds = 1;
  c0.adv = { type: 'count', count: 4, score: 0, perGroup: 2 };
  var c1 = M.defaultStage(1);
  c1.type = 'swiss'; c1.name = '第 2 阶段 · 4 人循环'; c1.rounds = 1;
  c1.adv = { type: 'count', count: 2, score: 0, perGroup: 1 };
  var c2 = M.defaultStage(2);
  c2.type = 'swiss'; c2.name = '第 3 阶段 · 决赛'; c2.rounds = 1;
  c2.adv = { type: 'count', count: 1, score: 0, perGroup: 1 };
  tc.stages = [c0, c1, c2];
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

  S.put(ta); S.put(tb); S.put(tc);

  E.ensureParticipants(ta); E.generateRound(ta);
  E.ensureParticipants(tb); E.generateRound(tb);

  // 三个阶段各自手工打完（每阶段 1 轮，A 方全胜）
  function playStage(stage, pairs, advNames, tag) {
    stage.participants = [];
    pairs.forEach(function (pr) { stage.participants.push(pr[0], pr[1]); });
    stage.participants = stage.participants.filter(function (v, i, a) { return a.indexOf(v) === i; });
    var fmt = M.normalizeFormat({ gamesPerMatch: 1, winNeeded: 1, sets: 1, setRule: 'sets', setsToWin: 0 });
    stage.roundsData = [{ index: 0, matches: [] }];
    pairs.forEach(function (pr, i) {
      var m = { id: tag + i, round: 0, playerA: pr[0], playerB: pr[1], games: [{ w: 'A', a: 1, b: 0 }], result: null };
      E.evaluate(m, fmt, stage.tie);
      stage.roundsData[0].matches.push(m);
    });
    stage.advanced = advNames.map(function (n) { return byName[n]; });
    stage.status = 'finished';
  }
  playStage(c0,
    [[byName['甲'], byName['辛']], [byName['乙'], byName['庚']],
     [byName['丙'], byName['己']], [byName['丁'], byName['戊']]],
    ['甲', '乙', '丙', '丁'], 'c0m');
  playStage(c1,
    [[byName['甲'], byName['丁']], [byName['乙'], byName['丙']]],
    ['甲', '乙'], 'c1m');
  playStage(c2,
    [[byName['甲'], byName['乙']]],
    ['甲'], 'c2m');

  S.put(ta); S.put(tb); S.put(tc);
  S.setCurrentId(ta.id);
  return ta.id;
})();
