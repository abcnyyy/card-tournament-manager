/* ============================================================
   core.js —— 工具函数 / 数据模型 / 本地持久化
   纯本地运行，无任何外部依赖
   ============================================================ */
(function (global) {
  'use strict';
  var TMS = global.TMS = global.TMS || {};

  /* ---------------- 工具函数 ---------------- */
  var util = {};

  util.uid = function (prefix) {
    return (prefix || 'id') + '_' +
      Math.random().toString(36).slice(2, 8) +
      (Date.now() % 100000).toString(36);
  };

  // mulberry32 —— 可复现的伪随机数发生器（种子存档后可审计对阵生成）
  util.makeRng = function (seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  util.randomSeed = function () { return (Math.floor(Math.random() * 4294967295) + 1) >>> 0; };

  util.shuffle = function (arr, rng) {
    var a = arr.slice(), i, j, t;
    var r = rng || Math.random;
    for (i = a.length - 1; i > 0; i--) {
      j = Math.floor(r() * (i + 1));
      t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  };

  util.clone = function (o) { return o === undefined ? o : JSON.parse(JSON.stringify(o)); };

  util.pad2 = function (n) { return String(n).length < 2 ? '0' + n : String(n); };
  util.now = function () {
    var d = new Date();
    return d.getFullYear() + '-' + util.pad2(d.getMonth() + 1) + '-' + util.pad2(d.getDate()) +
      ' ' + util.pad2(d.getHours()) + ':' + util.pad2(d.getMinutes());
  };

  util.esc = function (s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  // 数字格式化：去掉无意义的小数尾巴（3 → "3"，3.50 → "3.5"）
  util.fmt = function (n) {
    var v = (typeof n === 'number') ? n : (parseFloat(n) || 0);
    if (isNaN(v)) v = 0;
    return String(Math.round(v * 1000) / 1000);
  };

  util.pairKey = function (a, b) {
    if (a === b) return 'X';
    return a < b ? a + '|' + b : b + '|' + a;
  };

  util.nextPow2 = function (n) {
    var p = 1;
    while (p < n) p *= 2;
    return p;
  };

  // 秒数 → 12:34 / 1:02:03（计时器倒计时显示用）
  util.clock = function (sec) {
    var s = Math.max(0, Math.round(parseFloat(sec) || 0));
    var hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    return (hh > 0 ? (hh + ':' + util.pad2(mm)) : String(mm)) + ':' + util.pad2(ss);
  };

  // 姓名列表解析：支持 换行 / 逗号 / 分号 / 制表符 / 空格 分隔
  util.parseNames = function (text) {
    if (!text) return [];
    var raw = String(text).split(/\r\n|\r|\n|,|，|;|；|\t/);
    var out = [], seen = {};
    for (var i = 0; i < raw.length; i++) {
      var n = String(raw[i]).trim();
      if (!n) continue;
      if (seen[n]) continue;
      seen[n] = 1;
      out.push(n);
    }
    return out;
  };

  /**
   * 导出通道能力检测：
   *   'electron' —— 桌面版（原生保存对话框，可自选目录）
   *   'android'  —— 手机版（系统"保存到"选择器）
   *   ''         —— 浏览器（用 <a download>，部分 WebView 不支持）
   */
  util.nativeKind = function () {
    if (global.tmsNative && typeof global.tmsNative.saveFile === 'function') return 'electron';
    if (global.TmsNative && typeof global.TmsNative.saveFile === 'function') return 'android';
    return '';
  };

  /**
   * 统一的「保存文件」入口。
   * @param filename 建议的文件名（含扩展名）
   * @param content  文本内容
   * @param mime     类型，如 text/csv;charset=utf-8
   * @param cb       可选回调 cb({ok, msg, canceled, path})
   */
  util.saveFile = function (filename, content, mime, cb) {
    var kind = util.nativeKind();
    mime = mime || 'text/plain;charset=utf-8';
    try {
      if (kind === 'electron') {
        global.tmsNative.saveFile(filename, content, mime).then(function (r) {
          if (cb) cb(r || { ok: true });
        }, function (e) {
          if (cb) cb({ ok: false, msg: '保存失败：' + (e && e.message ? e.message : e) });
        });
        return true;
      }
      if (kind === 'android') {
        global.TmsNative.saveFile(filename, content, mime);
        if (cb) cb({ ok: true, msg: '已打开「保存到」选择器，选好位置即可' });
        return true;
      }
      var blob = new Blob([content], { type: mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 400);
      if (cb) cb({ ok: true, msg: '已开始下载：' + filename });
      return true;
    } catch (e) {
      if (cb) cb({ ok: false, msg: '导出失败：' + e.message });
      return false;
    }
  };

  // 兼容旧调用
  util.download = function (filename, content, mime) {
    return util.saveFile(filename, content, mime);
  };

  TMS.util = util;

  /* ---------------- 常量与默认值 ---------------- */
  var C = TMS.const = {};

  C.STAGE_TYPES = [
    { key: 'swiss',        name: '瑞士轮',       desc: '每轮按积分相近者配对，不打散，适合大人数' },
    { key: 'single_elim',  name: '单败淘汰',     desc: '输一场即出局，轮数 = log2(人数)' },
    { key: 'double_elim',  name: '双败淘汰',     desc: '输两场才出局，含胜者组与败者组' },
    { key: 'round_robin',  name: '循环赛',       desc: '所有选手互相交手 N 次' },
    { key: 'groups',       name: '小组赛',       desc: '分若干小组各自比赛，按条件晋级' }
  ];

  C.ADV_TYPES = [
    { key: 'all',       name: '全部晋级' },
    { key: 'count',     name: '按名次人数晋级' },
    { key: 'count_tie', name: '固定人数晋级（同分同名次，同分者一起晋级）' },
    { key: 'score',     name: '按积分线晋级' }
  ];

  // 瑞士轮 / 循环赛的配对方式
  C.PAIR_MODES = [
    { key: 'auto',   name: '自动配对（积分相近者优先，不重复交手）' },
    { key: 'random', name: '随机配对（每轮重新抽签）' },
    { key: 'manual', name: '手动编排（生成时自己点选配对）' }
  ];

  // 淘汰赛首轮编排方式
  C.DRAW_MODES = [
    { key: 'seed',   name: '按种子号编排（强手分散，标准种子位）' },
    { key: 'tier',   name: '分档抽签（按种子分档，档内随机）' },
    { key: 'random', name: '完全随机抽签（全部选手打乱）' }
  ];

  C.TIEBREAKERS = [
    { key: 'points',      name: '积分' },
    { key: 'buchholz',    name: '对手分总和 (Buchholz)' },
    { key: 'h2h',         name: '相互胜负关系' },
    { key: 'gamesDiff',   name: '净胜局数' },
    { key: 'gamesWon',    name: '赢下局数' },
    { key: 'gamesLost',   name: '输掉局数（越少越靠前）' },
    { key: 'wins',        name: '胜场数' },
    { key: 'progressive', name: '累进分（每轮后积分累加）' },
    { key: 'cumulative',  name: '累计小分' },
    { key: 'cumDiff',     name: '净小分（累计小分 − 对手小分）' },
    { key: 'stagePoints', name: '上一阶段得分' },
    { key: 'seed',        name: '初始种子序' },
    { key: 'manual',      name: '手动指定' }
  ];

  // 计时器到点时双方局数相同怎么判
  C.TIMER_TIES = [
    { key: 'draw', name: '记为平局（双方按「未打完」档位得分）' },
    { key: 'seed', name: '种子号靠前者获胜' },
    { key: 'keep', name: '不结算，继续打（停表由裁判决定）' }
  ];

  C.SCORE_MODES = [
    { key: 'result',    name: '按胜负平轮空积分（自定义分值）' },
    { key: 'scoreline', name: '按大比分逐档设分（列出所有可能比分分别设分）' },
    { key: 'games',     name: '按赢下局数计分（每局分值）' },
    { key: 'points',    name: '按小分累加（需记录每局比分）' },
    { key: 'formula',   name: '自定义公式（表达式）' }
  ];

  // 轮空一律由系统自动判定，不需要人工指定
  C.BYE_RULES = [
    { key: 'randomFirst', name: '自动：首轮随机，之后给最低分（每人最多轮空一次）' },
    { key: 'lowest',      name: '自动：始终给当前积分最低者' },
    { key: 'random',      name: '自动：每轮随机抽一人' },
    { key: 'manual',      name: '自动排好后，我自己在「手动编排」里改' }
  ];

  C.ELIM_TIE = [
    { key: 'sudden_death', name: '自动加赛决胜局（推荐）' },
    { key: 'draw_ok',      name: '允许平局（不用于淘汰赛）' },
    { key: 'manual',       name: '由裁判手动指定晋级者' }
  ];

  // 双败淘汰：总决赛规则
  C.GF_MODES = [
    { key: 'reset',    name: '加赛制（败者组冠军赢下首场后需再加赛一场）' },
    { key: 'elevate',  name: '可升格决赛（一场定胜负·比分累计，败者组冠军先到获胜局数后升格）' },
    { key: 'none',     name: '无优势（一场定胜负，谁赢谁夺冠）' },
    { key: 'handicap', name: '让局（一方开局先计若干局）' }
  ];

  /* ---------------- 数据模型工厂 ---------------- */
  var M = TMS.model = {};

  M.defaultFormat = function () {
    return {
      gamesPerMatch: 3,   // 每场比赛的局数
      winNeeded: 2,       // 赢多少局即获胜；0 表示不论赢几局都打满全部局数
      recordScore: false // 是否记录每局具体比分（用于"按小分"计分）
    };
  };

  /**
   * 比赛计时器（全局默认值）
   *   enabled    是否启用「每场限时」
   *   minutes    每场限时（分钟）
   *   autoSettle 到点是否自动结算未打完的比赛（false = 只变红提醒，由裁判手动点结算）
   *   tieAction  到点仍平分时怎么判：
   *              'draw' 记为平局（双方按未打完档位的平分分值得分）
   *              'seed' 种子号靠前者胜（淘汰赛强制用这一档，保证一定有人晋级）
   *              'keep' 不停表、继续打，直到分出胜负
   */
  M.defaultTimer = function () {
    return { enabled: false, minutes: 30, autoSettle: true, tieAction: 'draw' };
  };

  M.defaultScoring = function () {
    return {
      mode: 'result',  // result | scoreline | games | points | formula
      win: 3, draw: 1, lose: 0, bye: 3,   // result 模式
      // scoreline 模式：列出所有可能的大比分，逐个设「胜方得 / 负方得」
      // key 形如 "2-0"、"2-1"、"1-1"（大数在前），value {w: 胜方分, l: 负方分, d: 平局双方各得}
      scoreTable: {},
      perGame: 1,                           // games 模式：每赢一局得几分
      formula: 'w*3 + d*1',                // formula 模式：自定义表达式
      // tieMigrated=true 表示本存档已同步到最新版依据表；
      // 旧存档没有该字段时才补齐新增依据，且只补一次，避免覆盖用户手动删除的结果
      tieMigrated: true,
      tieOrder: ['points', 'buchholz', 'h2h', 'gamesDiff', 'gamesWon', 'gamesLost', 'wins',
        'progressive', 'cumulative', 'cumDiff', 'stagePoints', 'seed', 'manual'],
      manualOrder: {}                       // 手动指定的名次：playerId -> 序号
    };
  };

  M.defaultStage = function (index) {
    return {
      id: util.uid('st'),
      index: index || 0,
      name: '第 ' + ((index || 0) + 1) + ' 阶段',
      type: 'swiss',
      // 瑞士轮 / 循环赛
      rounds: 5,
      // 每轮配对方式：auto = 积分相近自动配；random = 完全随机；manual = 手动编排
      pairMode: 'auto',
      // 循环赛：循环次数
      cycles: 1,
      // ---- 阶段级局制与记分（未启用时沿用赛事全局设置）----
      useFormat: false,
      format: null,      // {gamesPerMatch, winNeeded, recordScore}
      useScoring: false,
      scoring: null,     // {mode, win, draw, lose, bye, perGame, formula}
      manualOrder: {},   // 本阶段手动名次
      // 小组赛
      groupCount: 4,
      groupMethod: 'snake',       // snake | random | manual
      groupType: 'round_robin',   // 小组内赛制
      groupRounds: 1,
      groupCycles: 1,
      // 分数继承
      //   tie = true 时，除了积分，还把上一阶段的「全部小分」一起带进本阶段：
      //   累计小分、净小分、赢局 / 输局（净胜局）、对手分、累进分，全部按同一比例折算
      inherit: { enabled: false, ratio: 100, fromStage: null, tie: false },
      // 晋级
      adv: { type: 'all', count: 8, score: 0, perGroup: 2 },
      // 中途淘汰（按轮次裁人：第 N 轮结束后只保留前 M 名）
      elim: { enabled: false, afterRound: 1, keep: 8 },
      // 提前晋级 / 提前淘汰：按战绩自动判定（瑞士轮 / 循环赛 / 小组赛）
      //   达到 winTarget 胜 → 提前锁定下一阶段席位，本阶段不再参赛
      //   达到 lossTarget 负 → 提前淘汰
      //   basis：match = 按比赛场次（大比分胜负）；game = 按小局（赢下/输掉局数）
      clinch: {
        enabled: false,
        basis: 'match',
        winTarget: 0,        // 0 = 不启用晋级线
        lossTarget: 0,       // 0 = 不启用淘汰线
        bonus: 0,            // 提前晋级者进入下一阶段时的加分
        bonusPerEarly: 0     // 每提前一轮额外加分（越早锁定加得越多）
      },
      // 淘汰赛平局处理
      tie: 'sudden_death',
      // 本阶段最多进行几轮（0 = 打完整棵对阵树）；用于「先筛一轮再进下一阶段」
      maxRounds: 0,
      // 淘汰赛首轮编排方式：seed = 按种子号；tier = 分档抽签；random = 完全随机抽签
      drawMode: 'seed',
      drawTiers: 4,        // 分档抽签的档数
      drawSeed: 0,         // 本次抽签的随机种子（0 = 还没抽过）
      // ---- 双败：分组起跑 ----
      // deSplitTop = 0：全部人从胜者组打起（传统双败）
      // deSplitTop = N：按本阶段排名取前 N 人从胜者组打起，其余 N+1 名以后
      //                 直接落在败者组（已经算「输过一场」），败者组内部先打一轮。
      // 典型用法：瑞士轮前 8 名进胜者组、9~16 名从败者组打起。
      deSplitTop: 0,
      deSplit: null,       // 实际生效的起跑结构 { top, wSize, rest }，生成对阵时写入
      // ---- 平局判定（双败）----
      // drawBothLose = true：本阶段的任何平局都不分胜负，而是<b>双方各记一负</b>
      //   · 胜者组平局 → 两人都掉进败者组
      //   · 败者组平局 → 两人都被淘汰（各吃到第 2 负）
      //   · 总决赛平局 → 胜者组冠军掉进败者组、败者组冠军被淘汰，只剩一人 → 其为冠军
      drawBothLose: false,
      // 淘汰赛自动规划（由「晋级人数 + 本阶段人数」算出，生成对阵时写入）
      elimTarget: null,    // 本阶段要留下的人数（= 晋级人数；最后一阶段为 1）
      elimRounds: null,    // 总轮数
      elimSize: null,      // 对阵表规模（含轮空位）
      elimByes: null,      // 首轮轮空人数
      // 是否设置季军争夺战（3-4 名决赛）
      thirdPlace: false,
      // ---- 双败淘汰：总决赛规则 ----
      // reset：加赛制（败者组冠军赢下首场后需再加赛一场）
      // none：无优势（一场定胜负，谁赢谁夺冠）
      // handicap：让局（一方开局先计若干局，另一方需多赢同样的局数）
      gfMode: 'reset',
      gfAdvSide: 'W',      // 让局时先计局数的一方：W = 胜者组冠军，L = 败者组冠军
      gfHandicap: 1,       // 先计的局数
      gfUseFormat: false,  // 总决赛是否单独设置局制
      gfFormat: { gamesPerMatch: 3, winNeeded: 2, recordScore: false },
      resetUseFormat: false, // 加赛局是否单独设置局制（可与总决赛首场不同）
      resetFormat: { gamesPerMatch: 1, winNeeded: 1, recordScore: false },
      // 可升格决赛：败者组冠军赢下首场后，第二场升级为更长的局制，双方都要重新达到新的获胜局数
      gfElevUseFormat: false,
      gfElevFormat: { gamesPerMatch: 5, winNeeded: 3, recordScore: false },
      // 运行时
      status: 'pending',   // pending | running | finished
      roundsData: [],      // [ {index, matches:[], byes:[]} ]
      currentRound: 0,
      groups: null,        // 小组赛分组： [ [playerId...], ... ]
      eliminated: [],      // 被淘汰的 playerId
      clinched: [],        // 提前晋级（已锁定下一阶段席位）的 playerId
      clinchRound: {},     // playerId -> 提前晋级发生在第几轮（从 0 计）
      elimRound: {},       // playerId -> 被淘汰发生在第几轮
      carryBonus: {},      // playerId -> 进入本阶段时的额外加分（上阶段提前晋级奖励）
      advanced: []         // 晋级到下一阶段的 playerId
    };
  };

  M.createPlayer = function (name, seed) {
    return {
      id: util.uid('p'),
      name: name,
      seed: seed || 0,           // 种子序号，0 = 无
      initialScore: 0,           // 初始携带分
      note: '',
      active: true,              // 是否仍在比赛中
      dropReason: '',            // 退赛 / 取消资格
      hasBye: false              // 是否已轮空过
    };
  };

  M.createTournament = function (name) {
    return {
      v: 2,
      id: util.uid('t'),
      name: name || '未命名赛事',
      createdAt: util.now(),
      seed: util.randomSeed(),
      players: [],
      format: M.defaultFormat(),
      scoring: M.defaultScoring(),      // 新建即已是完整依据表，无需再做破同依据迁移
      timer: M.defaultTimer(),          // 每场限时 / 到点自动结算
      byeRule: 'randomFirst',
      stages: [M.defaultStage(0)],
      currentStage: 0,
      status: 'setup',   // setup | running | finished
      history: []        // 回退栈
    };
  };

  /* ---------------- 持久化（多赛事） ---------------- */
  var S = TMS.store = {};
  var IDX_KEY = 'tms_index_v2';
  var CUR_KEY = 'tms_current_v2';
  var PREFIX = 'tms_t_';

  function readJSON(key, def) {
    try {
      var s = localStorage.getItem(key);
      return s ? JSON.parse(s) : def;
    } catch (e) { return def; }
  }
  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  }

  S.loadIndex = function () { return readJSON(IDX_KEY, []); };
  S.saveIndex = function (idx) { return writeJSON(IDX_KEY, idx); };

  S.get = function (id) {
    var t = readJSON(PREFIX + id, null);
    return t ? S.normalize(t) : null;
  };

  // 保存赛事并刷新索引
  S.put = function (t) {
    t.updatedAt = util.now();
    var ok = writeJSON(PREFIX + t.id, t);
    var idx = S.loadIndex();
    var meta = {
      id: t.id,
      name: t.name,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      players: (t.players || []).length,
      stages: (t.stages || []).length,
      status: t.status || 'setup'
    };
    var found = false;
    for (var i = 0; i < idx.length; i++) {
      if (idx[i].id === t.id) { idx[i] = meta; found = true; break; }
    }
    if (!found) idx.push(meta);
    S.saveIndex(idx);
    S.setCurrentId(t.id);
    return ok;
  };

  S.remove = function (id) {
    try { localStorage.removeItem(PREFIX + id); } catch (e) {}
    var idx = S.loadIndex().filter(function (x) { return x.id !== id; });
    S.saveIndex(idx);
    if (S.getCurrentId() === id) S.setCurrentId(idx.length ? idx[0].id : '');
    return true;
  };

  S.getCurrentId = function () { return localStorage.getItem(CUR_KEY) || ''; };
  S.setCurrentId = function (id) { try { localStorage.setItem(CUR_KEY, id || ''); } catch (e) {} };

  // 兼容旧版单赛事存档
  S.migrateLegacy = function () {
    var legacy = readJSON('tms_tournament_v2', null);
    if (!legacy) return;
    var t = S.normalize(legacy);
    S.put(t);
    try { localStorage.removeItem('tms_tournament_v2'); } catch (e) {}
  };

  // 当前赛事快捷读写
  S.save = function (t) { return S.put(t); };
  S.load = function () {
    var id = S.getCurrentId();
    if (id) {
      var t = S.get(id);
      if (t) return t;
    }
    var idx = S.loadIndex();
    if (idx.length) { var t2 = S.get(idx[0].id); if (t2) { S.setCurrentId(t2.id); return t2; } }
    return null;
  };
  S.clear = function () { try { localStorage.removeItem(PREFIX + S.getCurrentId()); } catch (e) {} };

  // 兼容旧存档：补齐缺失字段
  S.normalize = function (t) {
    if (!t) return t;
    // 旧存档本身不带 tieMigrated 标记（上面的 Object.assign 会把它盖成 true，故先取出来）
    var hadTieFlag = !!(t.scoring && Object.prototype.hasOwnProperty.call(t.scoring, 'tieMigrated'));
    t.format = Object.assign(M.defaultFormat(), t.format || {});
    t.scoring = Object.assign(M.defaultScoring(), t.scoring || {});
    if (!Array.isArray(t.scoring.tieOrder)) t.scoring.tieOrder = M.defaultScoring().tieOrder;
    // 旧存档补齐后来新增的破同依据（插在「种子序」之前，不改变原有优先级）。
    // 只迁移一次：否则用户手动删除的依据在每次打开存档时都会被重新塞回来。
    if (!hadTieFlag) {
      var def = M.defaultScoring().tieOrder;
      var cur = t.scoring.tieOrder;
      var seedIdx = cur.indexOf('seed');
      if (seedIdx < 0) seedIdx = cur.length;
      def.forEach(function (k) {
        if (cur.indexOf(k) < 0) cur.splice(seedIdx++, 0, k);
      });
      t.scoring.tieOrder = cur.filter(function (k, i) { return cur.indexOf(k) === i; });
      t.scoring.tieMigrated = true;
    }
    if (!t.scoring.manualOrder) t.scoring.manualOrder = {};
    if (!t.scoring.scoreTable || typeof t.scoring.scoreTable !== 'object') t.scoring.scoreTable = {};
    // 计时器（旧存档没有该字段）
    if (!t.timer || typeof t.timer !== 'object') t.timer = M.defaultTimer();
    else t.timer = Object.assign(M.defaultTimer(), t.timer);
    if (!(parseFloat(t.timer.minutes) > 0)) t.timer.minutes = 30;
    if (['draw', 'seed', 'keep'].indexOf(t.timer.tieAction) < 0) t.timer.tieAction = 'draw';
    if (!Array.isArray(t.stages)) t.stages = [M.defaultStage(0)];
    t.stages.forEach(function (s, i) {
      var d = M.defaultStage(i);
      s.id = s.id || d.id;
      s.index = i;
      if (s.inherit === undefined || s.inherit === null) s.inherit = Object.assign({}, d.inherit);
      else {
        s.inherit = Object.assign({}, d.inherit, s.inherit);
        if (typeof s.inherit.tie !== 'boolean') s.inherit.tie = false;
      }
      if (s.adv === undefined) s.adv = d.adv;
      if (!s.gfElevFormat || typeof s.gfElevFormat !== 'object') s.gfElevFormat = Object.assign({}, d.gfElevFormat);
      if (s.elim === undefined) s.elim = d.elim;
      if (!s.clinch || typeof s.clinch !== 'object') s.clinch = Object.assign({}, d.clinch);
      else s.clinch = Object.assign({}, d.clinch, s.clinch);
      if (!Array.isArray(s.roundsData)) s.roundsData = [];
      if (!Array.isArray(s.eliminated)) s.eliminated = [];
      if (!Array.isArray(s.clinched)) s.clinched = [];
      if (!s.clinchRound || typeof s.clinchRound !== 'object') s.clinchRound = {};
      if (!s.elimRound || typeof s.elimRound !== 'object') s.elimRound = {};
      if (!s.carryBonus || typeof s.carryBonus !== 'object') s.carryBonus = {};
      if (!Array.isArray(s.advanced)) s.advanced = [];
      if (s.groups === undefined) s.groups = null;
      if (s.groupMethod === undefined) s.groupMethod = 'snake';
      // 瑞士轮配对方式 / 淘汰赛抽签方式（旧存档默认：自动配对、按种子）
      if (s.pairMode === undefined || !s.pairMode) s.pairMode = 'auto';
      if (s.drawMode === undefined || !s.drawMode) s.drawMode = 'seed';
      if (!(parseInt(s.drawTiers, 10) > 0)) s.drawTiers = 4;
      if (s.drawSeed === undefined || s.drawSeed === null) s.drawSeed = 0;
      // 双败分组起跑：0 = 全部从胜者组开始
      if (!(parseInt(s.deSplitTop, 10) >= 0)) s.deSplitTop = 0;
      if (s.deSplit === undefined) s.deSplit = null;
      // 双败：平局判双方都输
      if (s.drawBothLose === undefined) s.drawBothLose = false;
      // 阶段级局制 / 记分（旧存档无此字段 → 沿用全局）
      if (s.useFormat === undefined) s.useFormat = false;
      if (s.useScoring === undefined) s.useScoring = false;
      if (s.useFormat && s.format) s.format = Object.assign(M.defaultFormat(), s.format);
      if (s.useFormat && !s.format) s.format = M.defaultFormat();
      if (s.useScoring && s.scoring) s.scoring = Object.assign(M.defaultScoring(), s.scoring);
      if (s.useScoring && !s.scoring) s.scoring = M.defaultScoring();
      if (!s.manualOrder || typeof s.manualOrder !== 'object') s.manualOrder = {};
      // 双败淘汰：总决赛规则（旧存档没有这些字段）
      if (s.gfMode === undefined || !s.gfMode) s.gfMode = 'reset';
      if (s.gfAdvSide === undefined) s.gfAdvSide = 'W';
      if (s.gfHandicap === undefined) s.gfHandicap = 1;
      if (s.gfUseFormat === undefined) s.gfUseFormat = false;
      if (s.gfUseFormat) s.gfFormat = Object.assign({ gamesPerMatch: 3, winNeeded: 2, recordScore: false }, s.gfFormat || {});
      if (!s.gfFormat || typeof s.gfFormat !== 'object') s.gfFormat = { gamesPerMatch: 3, winNeeded: 2, recordScore: false };
      if (s.resetUseFormat === undefined) s.resetUseFormat = false;
      if (s.resetUseFormat) s.resetFormat = Object.assign({ gamesPerMatch: 1, winNeeded: 1, recordScore: false }, s.resetFormat || {});
      if (!s.resetFormat || typeof s.resetFormat !== 'object') s.resetFormat = { gamesPerMatch: 1, winNeeded: 1, recordScore: false };
      // 清理旧版本遗留的「空比赛被写成 0:0 平局」脏数据
      (s.roundsData || []).forEach(function (rd) {
        (rd.matches || []).forEach(function (m) {
          if (m.isBye) return;
          if (m.tm && typeof m.tm !== 'object') m.tm = null;
          if (!m.result) return;
          var noGames = !(m.games && m.games.length);
          // 计时器到点 / 中途结束的「未打完」成绩是有效结果，不能当成脏数据清掉
          if (noGames && m.result.winner === null && !m.override && !m.result.unfinished) {
            m.result = null;
            m.decided = false;
          }
        });
      });
    });
    // 旧版手动名次存在赛事级，迁移到首阶段
    if (t.scoring.manualOrder && Object.keys(t.scoring.manualOrder).length &&
      t.stages[0] && (!t.stages[0].manualOrder || !Object.keys(t.stages[0].manualOrder).length)) {
      t.stages[0].manualOrder = Object.assign({}, t.scoring.manualOrder);
    }
    if (!Array.isArray(t.history)) t.history = [];
    if (t.players === undefined) t.players = [];
    t.players.forEach(function (p) {
      if (p.active === undefined) p.active = true;
      if (p.hasBye === undefined) p.hasBye = false;
      if (p.dropReason === undefined) p.dropReason = '';
    });
    return t;
  };

})(window);
