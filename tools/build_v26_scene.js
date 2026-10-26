/* v1.14.0 界面验收场景
   A. 回合制个人赛：8 人 / 2 阶段，一场 = 3 回合，每回合 1 局定胜负（先赢 2 回合）
      第 8 人设成「从第 2 阶段开始」（后进选手）
   B. 团体赛：4 队 × 3 人，nvn，单败淘汰已生成第 1 轮
   在页面里直接 eval，依赖 TMS.model / TMS.store / TMS.engine */
(function () {
  var M = TMS.model, S = TMS.store, E = TMS.engine;
  S.loadIndex().slice().forEach(function (x) { try { S.remove(x.id); } catch (e) {} });

  /* ================= A. 回合制个人赛 ================= */
  var NAMES = ['JCLE', 'kaibailan', 'Fiandre', 'iwsz000', 'ppppsssss', '杰森', '黑心博士', 'leftno12'];
  var ta = M.createTournament('回合制 · 8 人两阶段');
  ta.format = { gamesPerMatch: 1, winNeeded: 1, recordScore: false, sets: 3, setRule: 'sets', setsToWin: 2 };
  NAMES.forEach(function (n, i) {
    var p = M.createPlayer(n, i + 1);
    // 第 8 人从第 2 阶段开始打
    if (i === 7) p.startStage = 1;
    ta.players.push(p);
  });

  var s1 = M.defaultStage(0);
  s1.type = 'swiss'; s1.name = '第 1 阶段 · 瑞士轮'; s1.rounds = 1;
  s1.adv = { type: 'count', count: 4, score: 0, perGroup: 2 };
  var s2 = M.defaultStage(1);
  s2.type = 'single_elim'; s2.name = '第 2 阶段 · 四强'; s2.adv = { type: 'count', count: 1, score: 0, perGroup: 1 };
  ta.stages = [s1, s2];
  ta.currentStage = 0; ta.status = 'running';

  /* ================= B. 团体赛（nvn） ================= */
  var tb = M.createTournament('团体赛 · 4 队 nvn');
  tb.team = { on: true, mode: 'nvn', size: 3, winNeeded: 0, fmt: null };
  tb.format = { gamesPerMatch: 1, winNeeded: 1, recordScore: false };
  var TEAMS = [
    ['红队', ['红-1', '红-2', '红-3']],
    ['蓝队', ['蓝-1', '蓝-2', '蓝-3']],
    ['绿队', ['绿-1', '绿-2', '绿-3']],
    ['白队', ['白-1', '白-2', '白-3']]
  ];
  TEAMS.forEach(function (tm, i) {
    var p = M.createPlayer(tm[0], i + 1);
    p.isTeam = true;
    p.members = tm[1].map(function (n, k) { return { id: 'mb_' + i + '_' + k, name: n, seed: k + 1 }; });
    tb.players.push(p);
  });
  var ts = M.defaultStage(0);
  ts.type = 'single_elim'; ts.name = '第 1 阶段 · 四队淘汰'; ts.adv = { type: 'count', count: 1, score: 0, perGroup: 1 };
  tb.stages = [ts];
  tb.currentStage = 0; tb.status = 'running';

  /* ---- 生成对阵 ---- */
  S.put(ta); S.put(tb);

  E.ensureParticipants(ta); E.generateRound(ta);
  E.ensureParticipants(tb); E.generateRound(tb);

  S.put(ta); S.put(tb);
  S.setCurrentId(ta.id);
  return ta.id;
})();
