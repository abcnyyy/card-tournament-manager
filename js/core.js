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

  /**
   * 保存二进制文件（JPG / PDF）：content 是 base64 字符串
   *   electron → 主进程写 Buffer；android → 原生桥解码后写入；浏览器 → Blob 下载
   */
  util.saveBinary = function (filename, base64, mime, cb) {
    var kind = util.nativeKind();
    mime = mime || 'application/octet-stream';
    try {
      if (kind === 'electron' && global.tmsNative && typeof global.tmsNative.saveBinary === 'function') {
        global.tmsNative.saveBinary(filename, base64, mime).then(function (r) {
          if (cb) cb(r || { ok: true });
        }, function (e) {
          if (cb) cb({ ok: false, msg: '保存失败：' + (e && e.message ? e.message : e) });
        });
        return true;
      }
      if (kind === 'android' && global.TmsNative && typeof global.TmsNative.saveBase64 === 'function') {
        global.TmsNative.saveBase64(filename, base64, mime);
        if (cb) cb({ ok: true, msg: '已打开「保存到」选择器，选好位置即可' });
        return true;
      }
      var bin = global.atob(base64);
      var u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      var blob = new Blob([u8], { type: mime });
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
    { key: 'random', name: '完全随机抽签（全部选手打乱）' },
    { key: 'manual', name: '手动摆放首轮位（自己把选手摆进对阵位）' }
  ];

  /* 破同（小分）依据
     注意：'stageP<阶段下标>' 是「逐阶段得分」家族（v2.3），由界面按赛程动态生成，
     例如 stageP0 = 第 1 阶段得分、stageP1 = 第 2 阶段得分……
     旧的 'stagePoints'（上一阶段得分）仍然保留，等价于 stageP<(当前阶段-1)>。 */
  C.TIEBREAKERS = [
    { key: 'points',      name: '积分' },
    { key: 'forfeit',     name: '判负次数（越少越靠前）' },
    { key: 'warnings',    name: '警告次数（越少越靠前）' },
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
      recordScore: false, // 是否记录每局具体比分（用于"按小分"计分）
      /* ---- 回合（v1.14.0）：局之上再套一层「回合」 ---- */
      // sets = 每场分几个回合，每个回合用同一套局制。
      //   1 = 不分回合（与旧版本完全一致）
      //   3 + 每回合「五局三胜」= 三场五局三胜决出这场胜负
      sets: 1,
      // setRule = 回合之间怎么定这场胜负：
      //   sets   赢下回合数（默认，3 回合 → 先赢 2 回合）
      //   games  总大比分（各回合赢局数相加，多者胜）
      //   points 总得分（各回合小分相加，多者胜）
      setRule: 'sets',
      // setsToWin = 需要赢几个回合才算赢；0 = 自动取「过半」
      setsToWin: 0
    };
  };

  // 局制归一化：补齐回合相关字段，避免旧存档 / 手填对象缺字段
  M.normalizeFormat = function (f) {
    var d = M.defaultFormat();
    f = Object.assign({}, d, f || {});
    if (!(parseInt(f.gamesPerMatch, 10) >= 1)) f.gamesPerMatch = 1;
    if (!(parseInt(f.winNeeded, 10) >= 0)) f.winNeeded = 0;
    if (!(parseInt(f.sets, 10) >= 1)) f.sets = 1;
    f.sets = Math.min(99, parseInt(f.sets, 10) || 1);
    if (['sets', 'games', 'points'].indexOf(f.setRule) < 0) f.setRule = 'sets';
    if (!(parseInt(f.setsToWin, 10) >= 0)) f.setsToWin = 0;
    f.recordScore = !!f.recordScore;
    return f;
  };

  /* ---- 团体赛（v1.14.0 引入，v2.1 统一口径）：参赛单位是「队伍」 ----
     结构：**一桌 = 一场比赛**。一场团体赛 = 若干场对局，每场双方各派一名队员打。
           每场用团体局制定胜负；团体赛的大比分 = 赢下的场数；场内的局分只进小分。
           nvn      双方同时开打（场数 = 上场人数），全部打完比赢下场数
           conquest 赢过的人不能再上（必须换人），对手可选换不换；
                    一队所有上场队员都各赢下一场才算赢
           kof      输的下场、赢的留场，直到对方上场队员全被击败
     录入：每场都先定上场队员（排阵），再录成绩；
           nvn 必须先排好整场所有对局的对阵才能录。
     mode      nvn / conquest / kof
     size      每队人数（队伍没维护队员时的兜底人数）
     playSize  每方上场人数，0 = 全员上场（队员不一定等于队伍人数时用这个限制）
     winNeeded 已废弃（v2.0 起胜负完全按规则判定），字段保留仅供旧存档读取
  */
  M.defaultTeam = function () {
    return {
      on: false,
      mode: 'nvn',
      size: 3,
      playSize: 0,
      winNeeded: 0,
      // 每一场对局用什么局制：null = 沿用赛事常规局制
      fmt: null
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
      // 判负 / 警告也是破同依据（v2.3）：先比判负、再比警告
      penTieMigrated: true,
      tieOrder: ['points', 'forfeit', 'warnings', 'buchholz', 'h2h', 'gamesDiff', 'gamesWon', 'gamesLost', 'wins',
        'progressive', 'cumulative', 'cumDiff', 'stagePoints', 'seed', 'manual'],
      manualOrder: {}                       // 手动指定的名次：playerId -> 序号
    };
  };

  /* ---- 逐阶段得分（v2.3）：破同依据里的「第 N 阶段得分」 ---- */
  // 键名形如 stageP0 / stageP1 ……（数字 = 阶段下标，0 表示第 1 阶段）
  M.stageTieKey = function (i) {
    var n = parseInt(i, 10);
    return 'stageP' + (isNaN(n) || n < 0 ? 0 : n);
  };
  M.stageTieIdx = function (key) {
    var m = /^stageP(\d+)$/.exec(String(key === undefined || key === null ? '' : key));
    return m ? parseInt(m[1], 10) : -1;
  };
  // 某个破同键的中文名（含逐阶段得分）
  M.tieName = function (key) {
    var i = M.stageTieIdx(key);
    if (i >= 0) return '第 ' + (i + 1) + ' 阶段得分';
    for (var k = 0; k < C.TIEBREAKERS.length; k++) {
      if (C.TIEBREAKERS[k].key === key) return C.TIEBREAKERS[k].name;
    }
    return key;
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
      /* 本阶段的积分怎么和上一阶段合（v2.0，只在积分规则「计分单元 = 每个阶段各算一次」时生效）
           'inherit' 跟随赛事默认（ptsRule.stack）
           'stack'   与上一阶段的积分叠加（累加）
           'reset'   不叠加：只有晋级到本阶段的人重新起算，本阶段的分单独给 */
      ptsStack: 'inherit',
      manualOrder: {},   // 本阶段手动名次
      // 小组赛
      groupCount: 4,
      groupMethod: 'snake',       // snake | random | manual
      groupType: 'round_robin',   // 小组内赛制
      groupRounds: 1,
      groupCycles: 1,
      // 分数继承
      //   stats = true（默认）时，场次 / 胜 / 平 / 负 / 轮空 / 赢局 / 输局 按原值带进本阶段
      //   tie = true 时，再把「小分」一起带：累计小分、净小分、对手分、累进分，按同一比例折算
      inherit: { enabled: false, ratio: 100, fromStage: null, tie: false, stats: true },
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
      // 手动摆放首轮位：drawMode='manual' 时，由用户把选手摆进 bracket 位置
      // （数组长度 = 对阵表规模 size，按位置顺序；null = 轮空位）
      bracketSlots: null,
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
      // ---- 双败：半区互换（crossover）----
      // deCrossDrop = true：按 bracket 位置把全场平分为上下两个半区；
      //   胜者组某半区的败者交叉掉入「另一个」半区的败者组，
      //   两个败者组半区在总决赛前汇合决出败者组冠军。
      //   仅双败淘汰、且不建议与 deSplitTop（分组起跑）同时开启。
      deCrossDrop: false,
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
      hasBye: false,             // 是否已轮空过
      // v1.14.0：从第几个阶段开始参赛（0 = 从第一阶段开始）。
      // 用来让「种子 / 直邀选手 / 上届前四」直接从后续阶段打起。
      startStage: 0
    };
  };

  /* ---------------- 赛事积分榜体系 ----------------
     积分规则定义在**赛事**里：这场赛事打完，每个名次（或每个胜场）值多少分。
     赛季页只负责把各站赛事的积分加起来，不再单独定义分值。
       mode  : 计分方式（三选一）
                 rank = 按最终名次给分
                 win  = 按胜场 / 平 / 负给分
                 adv  = 按是否晋级下一阶段给分（v2.0 起是独立的计分方式，不与前两种混算）
       unit  : tournament = 整站只算一次；stage = 站内每个阶段各算一次
       rank.top : { 名次: 分数 }，可以有很多档（前 10 / 前 20 / 前 32 都行）；
                  没列出的名次按 step 从最近的低档往下递减，不低于 floor
       adv      : 按是否晋级下一阶段给分（mode='adv' 时生效）
                  { yes, no }  yes = 晋级到下一阶段得多少分，no = 没晋级得多少分
                  晋级判定看**阶段实际晋级名单**（阶段「晋级条件」算出来的那批人）
       stack / resetScope : 阶段之间默认怎么合；单个阶段可用 stage.ptsStack 覆盖
       stageOv  : { '阶段序号': <完整的独立积分规则> } 阶段单独设置时不跟随赛事默认
   ---------------------------------------------------------- */
  M.defaultPtsRule = function () {
    return {
      on: false,
      mode: 'rank',
      unit: 'tournament',
      rank: {
        /* 名次档位（v1.14.0 改为「几个名次一档」）：
           {from, to, pts, adv}
             from / to  这一档覆盖第 from 名 ~ 第 to 名，同档同分
             pts        这一档的分数
             adv        这一档是否「晋级下一阶段」（只在积分榜上标注，不改晋级名单） */
        tiers: [
          { from: 1, to: 1, pts: 100, adv: true },
          { from: 2, to: 3, pts: 80, adv: true },
          { from: 4, to: 6, pts: 65, adv: true },
          { from: 7, to: 10, pts: 50, adv: true },
          { from: 11, to: 16, pts: 35, adv: false },
          { from: 17, to: 24, pts: 20, adv: false }
        ],
        // 未覆盖到的名次：从最近的低档按 step 递减，不低于 floor
        step: 3,
        floor: 5
      },
      win: { perWin: 10, perDraw: 5, perLoss: 0, base: 0 },
      /* 按是否晋级下一阶段给分（v2.0）：一种独立的计分方式（mode='adv'）。
         晋级判定用「阶段实际晋级名单」，不是名次档位上的勾选。
         这两个分值只在 mode='adv' 时生效，不会和名次分 / 胜场分相加。 */
      adv: { yes: 100, no: 0 },
      stack: true,
      resetScope: 'participants',
      stageOv: {}
    };
  };

  // 旧存档的 rank.top（{名次:分数}）→ 转成等价的档位表
  M.topToTiers = function (top) {
    var keys = Object.keys(top || {}).map(function (k) { return parseInt(k, 10); })
      .filter(function (n) { return n >= 1; }).sort(function (a, b) { return a - b; });
    return keys.map(function (n) {
      return { from: n, to: n, pts: parseFloat(top[n]) || 0, adv: false };
    });
  };

  // 档位表的归一化：排序、纠正 from/to、清掉空行
  M.normalizeTiers = function (tiers) {
    if (!Array.isArray(tiers)) return [];
    var out = [];
    tiers.forEach(function (t) {
      if (!t || typeof t !== 'object') return;
      var from = parseInt(t.from, 10), to = parseInt(t.to, 10);
      var pts = parseFloat(t.pts);
      if (!(from >= 1)) return;
      if (!(to >= from)) to = from;
      if (!(pts >= 0)) pts = 0;
      out.push({ from: from, to: Math.min(9999, to), pts: pts, adv: !!t.adv });
    });
    out.sort(function (a, b) { return a.from - b.from || a.to - b.to; });
    return out;
  };

  // 积分规则归一化：补齐字段、把名次档位的键统一成数字字符串
  M.normalizePtsRule = function (r) {
    var d = M.defaultPtsRule();
    var src = (r && r.rank) || {};
    // 判断「来源里到底给了哪种口径」，避免默认档位把旧口径的 top 顶掉
    var hadTiers = Array.isArray(src.tiers) && src.tiers.length > 0;
    var hadTop = src.top && typeof src.top === 'object' && Object.keys(src.top).length > 0;
    r = Object.assign({}, d, r || {});
    r.rank = Object.assign({}, d.rank, src);
    if (!hadTiers) {
      // 老口径 rank.top → 新口径 rank.tiers（迁完仍保留 top，兼容旧的读取方）
      r.rank.tiers = hadTop ? M.topToTiers(src.top)
        : d.rank.tiers.map(function (t) { return Object.assign({}, t); });
    }
    r.rank.tiers = M.normalizeTiers(r.rank.tiers);
    if (!r.rank.tiers.length) r.rank.tiers = d.rank.tiers.map(function (t) { return Object.assign({}, t); });
    if (!(parseFloat(r.rank.step) >= 0)) r.rank.step = d.rank.step;
    if (!(parseFloat(r.rank.floor) >= 0)) r.rank.floor = d.rank.floor;
    r.win = Object.assign({}, d.win, r.win || {});
    /* 晋级分（v2.0）：从「附加开关」改成独立计分方式。
       旧存档里 adv.on=true 的规则一律迁移成 mode='adv'（只拿晋级分），
       避免出现「选着按名次、实际又偷偷加了晋级分」这种看不懂的口径。 */
    var advSrc = (r.adv && typeof r.adv === 'object') ? r.adv : {};
    if (advSrc.on === true && ['rank', 'win'].indexOf(r.mode) >= 0) r.mode = 'adv';
    var advYes = parseFloat(advSrc.yes), advNo = parseFloat(advSrc.no);
    r.adv = {
      yes: isFinite(advYes) ? advYes : d.adv.yes,
      no: isFinite(advNo) ? advNo : d.adv.no
    };
    if (['rank', 'win', 'adv'].indexOf(r.mode) < 0) r.mode = 'rank';
    if (['tournament', 'stage'].indexOf(r.unit) < 0) r.unit = 'tournament';
    if (typeof r.stack !== 'boolean') r.stack = true;
    if (['participants', 'all'].indexOf(r.resetScope) < 0) r.resetScope = 'participants';
    if (typeof r.on !== 'boolean') r.on = false;
    if (!r.stageOv || typeof r.stageOv !== 'object') r.stageOv = {};
    Object.keys(r.stageOv).forEach(function (k) {
      var ov = r.stageOv[k];
      if (!ov || typeof ov !== 'object') { delete r.stageOv[k]; return; }
      r.stageOv[k] = M.normalizePtsRule(ov);
      r.stageOv[k].on = true;
    });
    return r;
  };

  M.createTournament = function (name) {
    return {
      v: 2,
      id: util.uid('t'),
      name: name || '未命名赛事',
      createdAt: util.now(),
      seed: util.randomSeed(),
      seasonId: null,
      players: [],
      format: M.defaultFormat(),
      scoring: M.defaultScoring(),      // 新建即已是完整依据表，无需再做破同依据迁移
      timer: M.defaultTimer(),          // 每场限时 / 到点自动结算
      team: M.defaultTeam(),            // 团体赛（v1.14.0）：默认关闭
      ptsRule: M.defaultPtsRule(),      // 本赛事的积分榜体系（赛季只做加总）
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
  /* 写盘：失败时记下原因（最常见的失败是 localStorage 配额满了）。
     v2.6.1：以前这里把异常吞掉只返回 false，调用方又都不看返回值，
     结果「保存失败」在界面上表现为「已保存」，一刷新全丢。 */
  S.lastError = '';
  function writeJSON(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
      S.lastError = '';
      return true;
    } catch (e) {
      S.lastError = (e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || '')))
        ? '本机存储空间已满（浏览器 / 应用大约 5MB）。请先导出存档备份，然后删掉不用的赛事或清空回退记录再保存。'
        : ('保存失败：' + (e && e.message ? e.message : e));
      return false;
    }
  }

  S.loadIndex = function () { return readJSON(IDX_KEY, []); };
  S.saveIndex = function (idx) { return writeJSON(IDX_KEY, idx); };

  S.get = function (id) {
    var t = readJSON(PREFIX + id, null);
    return t ? S.normalize(t) : null;
  };

  // 保存赛事并刷新索引
  // v2.6.1：新增 opts.quiet —— 给「顺手改别的赛事（赛季归属等）」的调用方用：
  //   以前 S.put 一律把 currentId 改成被保存的那一场，于是在列表页给赛事 B 改赛季归属后，
  //   刷新会直接打开 B，而且内存里的旧 A 下一次保存还会把 B 的改动覆盖回去。
  //   现在这类调用走 S.putQuiet / S.put(t,{quiet:true})，不碰指针；正常保存仍是老行为（写谁就打开谁）。
  S.put = function (t, opts) {
    if (!t || !t.id) return false;
    t.updatedAt = util.now();
    var ok = writeJSON(PREFIX + t.id, t);
    if (!ok) return false;                 // 赛事本体都没写进去，就别动索引（否则索引指向空数据）
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
    if (!(opts && opts.quiet)) S.setCurrentId(t.id);
    return true;
  };

  // 保存但不改「当前赛事」指针（改别人的赛季归属、批量修数据时用）
  S.putQuiet = function (t) { return S.put(t, { quiet: true }); };

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

  /* ---------------- 赛季：把多个赛事归入一个赛季并累计积分 ----------------
     source = 'tournament' —— 赛季只做加总：每站赛事用它自己的 ptsRule 算分，
                              赛季页不定义分值（新赛季默认走这种）
     source = 'season'     —— 老模式：赛季统一一套分值，覆盖各站赛事自己的规则
     ---------------------------------------------------------- */
  M.defaultSeasonRule = function () {
    return {
      source: 'tournament',
      // ★ v2.4：计分方案（取消原来的「默认设置 + 逐单元覆盖」两层结构）
      //   'single' = 整个赛季只用一套计分方法（下面 unit 决定是「每站一次」还是「每阶段一次」）
      //   'stage'  = 每个计分单元（每个阶段）各自一套计分方法，互不影响
      //   仅 source='season' 时生效；source='tournament' 时恒按各站自己的积分加总
      plan: 'single',
      // v2.5：用户是否在界面上「主动选过」计分方案。
      //   没有这个标记 = 从没选过（老存档 / 从 v2.4 迁移过来的），一律按各站自己的积分算；
      //   点过方案按钮才会置 true，之后不再被自动改口径。
      planLock: false,
      // unit: tournament = 每站赛事算一次分；stage = 赛事内每个阶段各算一次
      unit: 'tournament',
      stack: true,              // 是否与之前的计分单元累加
      mode: 'rank',             // rank = 按名次；win = 按胜场
      // 名次分档：与赛事积分榜同一口径（几个名次一档），之后按 step 递减，不低于 floor
      rank: {
        tiers: M.defaultPtsRule().rank.tiers.map(function (t) { return Object.assign({}, t); }),
        step: 3, floor: 5
      },
      win: { perWin: 10, perDraw: 5, perLoss: 0, base: 0 },
      resetScope: 'participants', // 不叠加时：participants 只重置进入该单元的人 / all 全榜重置
      includeRunning: false,      // 进行中的单元是否先计入
      // 逐单元（逐阶段）规则：plan='stage' 时每个 key 是一套完整规则（和上面同结构）
      // key: 't:<tid>' 或 't:<tid>#<阶段序号>'
      overrides: {}
    };
  };

  M.defaultSeason = function (name) {
    return {
      v: 1,
      id: util.uid('se'),
      name: name || '未命名赛季',
      note: '',
      createdAt: util.now(),
      updatedAt: util.now(),
      rule: M.defaultSeasonRule()
    };
  };

  /**
   * 赛季规则是不是「出厂默认值」（用户从没改过分值）
   * 用来识别 v2.4 迁移时被动写进 plan='single' 的赛季 —— 这种要放回「各站自己的积分」。
   */
  M.seasonRuleIsDefault = function (rule, d) {
    if (!rule) return true;
    d = d || M.defaultSeasonRule();
    if ((rule.mode || 'rank') !== d.mode) return false;
    if ((rule.unit || 'tournament') !== d.unit) return false;
    if (rule.stack === false) return false;
    if ((rule.resetScope || 'participants') !== 'participants') return false;
    if (rule.includeRunning) return false;
    var rk = rule.rank || {}, dk = d.rank || {};
    var a = rk.tiers || [], b = dk.tiers || [];
    var sameTiers = function (x, y) {
      if (x.length !== y.length) return false;
      for (var i = 0; i < x.length; i++) {
        if (parseInt(x[i].from, 10) !== parseInt(y[i].from, 10)) return false;
        if (parseInt(x[i].to, 10) !== parseInt(y[i].to, 10)) return false;
        if (parseFloat(x[i].pts) !== parseFloat(y[i].pts)) return false;
        if (!!x[i].adv !== !!y[i].adv) return false;
      }
      return true;
    };
    var tiersOk;
    if (sameTiers(a, b) && parseFloat(rk.step) === parseFloat(dk.step) && parseFloat(rk.floor) === parseFloat(dk.floor)) {
      tiersOk = true;
    } else {
      // 老版本（v1.14 之前）的出厂档位：4 档 100/80/65/55，每降 1 名扣 5、最低 5
      var legacy = [
        { from: 1, to: 1, pts: 100, adv: false }, { from: 2, to: 2, pts: 80, adv: false },
        { from: 3, to: 3, pts: 65, adv: false }, { from: 4, to: 4, pts: 55, adv: false }
      ];
      tiersOk = sameTiers(a, legacy) && parseFloat(rk.step) === 5 && parseFloat(rk.floor) === 5;
    }
    if (!tiersOk) return false;
    var w = rule.win || {}, dw = d.win || {};
    var keys = ['perWin', 'perDraw', 'perLoss', 'base'];
    for (var j = 0; j < keys.length; j++) {
      if (parseFloat(w[keys[j]]) !== parseFloat(dw[keys[j]])) return false;
    }
    return true;
  };

  S.normalizeSeason = function (s) {
    if (!s) return s;
    var d = M.defaultSeasonRule();
    // 旧赛季没有 source 字段 → 保持原来的「赛季统一规则」行为，不能悄悄改口径
    var rawSource = (s.rule && s.rule.source) || '';
    // plan 也必须先取原始值：Object.assign 会把默认的 'single' 盖进来
    var rawPlan = (s.rule && s.rule.plan) || '';
    s.rule = Object.assign({}, d, s.rule || {});
    var srcRank = (s.rule && s.rule.rank) || {};
    var hadTiers = Array.isArray(srcRank.tiers) && srcRank.tiers.length > 0;
    var hadTop = srcRank.top && typeof srcRank.top === 'object' && Object.keys(srcRank.top).length > 0;
    s.rule.rank = Object.assign({}, d.rank, srcRank);
    // 老赛季的 rank.top → 新档位表（行为不变：每个名次单独一档）
    if (!hadTiers) {
      s.rule.rank.tiers = hadTop ? M.topToTiers(srcRank.top)
        : d.rank.tiers.map(function (t) { return Object.assign({}, t); });
    }
    s.rule.rank.tiers = M.normalizeTiers(s.rule.rank.tiers);
    if (!s.rule.rank.tiers.length) s.rule.rank.tiers = d.rank.tiers.map(function (t) { return Object.assign({}, t); });
    s.rule.win = Object.assign({}, d.win, s.rule.win || {});
    if (!s.rule.overrides || typeof s.rule.overrides !== 'object') s.rule.overrides = {};
    // 逐单元规则：只做清洗，不补齐（旧的「只改叠加方式」覆盖要能继续跟随统一规则）
    Object.keys(s.rule.overrides).forEach(function (k) {
      var ov = s.rule.overrides[k];
      if (!ov || typeof ov !== 'object') { delete s.rule.overrides[k]; return; }
      if (['rank', 'win'].indexOf(ov.mode) < 0) delete ov.mode;
      if (typeof ov.stack !== 'boolean') delete ov.stack;
      if (!ov.rank || typeof ov.rank !== 'object') delete ov.rank;
      else if (Array.isArray(ov.rank.tiers) && ov.rank.tiers.length) ov.rank.tiers = M.normalizeTiers(ov.rank.tiers);
      if (!ov.win || typeof ov.win !== 'object') delete ov.win;
      if (!Object.keys(ov).length) delete s.rule.overrides[k];
    });
    if (['tournament', 'stage'].indexOf(s.rule.unit) < 0) s.rule.unit = 'tournament';
    if (['rank', 'win'].indexOf(s.rule.mode) < 0) s.rule.mode = 'rank';
    if (typeof s.rule.stack !== 'boolean') s.rule.stack = true;
    if (['participants', 'all'].indexOf(s.rule.resetScope) < 0) s.rule.resetScope = 'participants';
    if (typeof s.rule.includeRunning !== 'boolean') s.rule.includeRunning = false;
    if (!(parseFloat(s.rule.rank.step) >= 0)) s.rule.rank.step = d.rank.step;
    if (!(parseFloat(s.rule.rank.floor) >= 0)) s.rule.rank.floor = d.rank.floor;
    s.rule.source = (['tournament', 'season'].indexOf(rawSource) >= 0) ? rawSource : 'season';
    // plan（v2.4 引入，v2.5 修正判据）
    //   ★ 老存档 / v2.4 迁移过来的赛季没有 planLock，默认回到「各站自己的积分」：
    //     这样赛事自己的积分榜才真正生效（以前会被强制判成 single，把各站规则整个忽略）。
    //   ★ 只有这几种情况才保留「赛季自己定分值」：
    //       - 用户主动点过方案按钮（planLock === true）
    //       - plan='stage' 且确实配了逐阶段规则（真在逐阶段设分值）
    //       - plan='single' 且分值被改过（不是出厂默认值）
    var hasUnitRule = Object.keys(s.rule.overrides).some(function (k) {
      var o = s.rule.overrides[k] || {};
      return ['rank', 'win'].indexOf(o.mode) >= 0 || o.rank || o.win;
    });
    if (s.rule.planLock === true) {
      s.rule.plan = (rawPlan === 'stage') ? 'stage' : (rawPlan === 'single' ? 'single' : 'site');
    } else if (rawPlan === 'stage' && hasUnitRule) {
      s.rule.plan = 'stage';   // 真的在逐阶段设分值，动它等于毁掉配置
    } else if (rawPlan === 'single' && !M.seasonRuleIsDefault(s.rule, d)) {
      s.rule.plan = 'single';  // 分值被改过 = 用户确实在用统一计分
    } else if (rawPlan === '' && hasUnitRule) {
      s.rule.plan = 'stage';   // v2.3 老存档：以前只配过逐单元规则，按逐阶段接住
    } else {
      s.rule.plan = 'site';
    }
    // site 必须走 source='tournament'（E.seasonPlan 的唯一判据），两者保持一致
    s.rule.source = (s.rule.plan === 'site') ? 'tournament' : 'season';
    if (s.rule.plan === 'stage') s.rule.unit = 'stage';
    return s;
  };

  var SEASON_IDX = 'tms_season_index';
  var SEASON_PREFIX = 'tms_season_';

  S.loadSeasons = function () { return readJSON(SEASON_IDX, []); };
  S.saveSeasons = function (list) { return writeJSON(SEASON_IDX, list); };
  S.getSeason = function (id) {
    var s = readJSON(SEASON_PREFIX + id, null);
    return s ? S.normalizeSeason(s) : null;
  };
  S.putSeason = function (s) {
    if (!s || !s.id) return false;
    s.updatedAt = util.now();
    var ok = writeJSON(SEASON_PREFIX + s.id, s);
    var idx = S.loadSeasons();
    var meta = { id: s.id, name: s.name, createdAt: s.createdAt, updatedAt: s.updatedAt };
    var found = false;
    for (var i = 0; i < idx.length; i++) {
      if (idx[i].id === s.id) { idx[i] = meta; found = true; break; }
    }
    if (!found) idx.push(meta);
    S.saveSeasons(idx);
    return ok;
  };
  S.delSeason = function (id) {
    try { localStorage.removeItem(SEASON_PREFIX + id); } catch (e) {}
    S.saveSeasons(S.loadSeasons().filter(function (x) { return x.id !== id; }));
    // 解除赛事归属，避免悬空引用（只改归属，不切当前赛事）
    S.loadIndex().forEach(function (m) {
      var t = S.get(m.id);
      if (t && t.seasonId === id) { t.seasonId = null; S.putQuiet(t); }
    });
    return true;
  };
  // 某个赛季下所有赛事（按创建时间排序，积分靠先后顺序累计）
  S.tournamentsOfSeason = function (seasonId) {
    var out = [];
    S.loadIndex().forEach(function (m) {
      var t = S.get(m.id);
      if (t && t.seasonId === seasonId) out.push(t);
    });
    out.sort(function (a, b) {
      return String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
        String(a.id).localeCompare(String(b.id));
    });
    return out;
  };

  // 兼容旧存档：补齐缺失字段
  S.normalize = function (t) {
    if (!t) return t;
    // 旧存档本身不带 tieMigrated 标记（上面的 Object.assign 会把它盖成 true，故先取出来）
    var hadTieFlag = !!(t.scoring && Object.prototype.hasOwnProperty.call(t.scoring, 'tieMigrated'));
    var hadPenFlag = !!(t.scoring && Object.prototype.hasOwnProperty.call(t.scoring, 'penTieMigrated'));
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
    // v2.3：判负 / 警告 进入破同依据（插在「积分」之后，判负先于警告）。
    // 同样只补一次，避免用户手动删掉后被反复塞回来。
    if (!hadPenFlag) {
      var pAt = t.scoring.tieOrder.indexOf('points');
      pAt = pAt < 0 ? 0 : pAt + 1;
      ['forfeit', 'warnings'].forEach(function (k) {
        if (t.scoring.tieOrder.indexOf(k) < 0) { t.scoring.tieOrder.splice(pAt, 0, k); pAt++; }
      });
      t.scoring.penTieMigrated = true;
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
        // v2.6：老存档没有「继承战绩」字段，按开启处理（胜场 / 负场 / 小局一定带上）
        if (typeof s.inherit.stats !== 'boolean') s.inherit.stats = true;
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
      // 双败：半区互换
      if (s.deCrossDrop === undefined) s.deCrossDrop = false;
      // 手动摆放首轮位
      if (s.bracketSlots === undefined) s.bracketSlots = null;
      // 阶段级局制 / 记分（旧存档无此字段 → 沿用全局）
      if (s.useFormat === undefined) s.useFormat = false;
      if (s.useScoring === undefined) s.useScoring = false;
      if (s.useFormat && s.format) s.format = M.normalizeFormat(s.format);
      if (s.useFormat && !s.format) s.format = M.normalizeFormat(null);
      if (s.useScoring && s.scoring) s.scoring = Object.assign(M.defaultScoring(), s.scoring);
      if (s.useScoring && !s.scoring) s.scoring = M.defaultScoring();
      // 阶段积分的叠加方式（旧存档无此字段 → 跟随赛事默认）
      if (['inherit', 'stack', 'reset'].indexOf(s.ptsStack) < 0) s.ptsStack = 'inherit';
      if (!s.manualOrder || typeof s.manualOrder !== 'object') s.manualOrder = {};
      // 双败淘汰：总决赛规则（旧存档没有这些字段）
      if (s.gfMode === undefined || !s.gfMode) s.gfMode = 'reset';
      if (s.gfAdvSide === undefined) s.gfAdvSide = 'W';
      if (s.gfHandicap === undefined) s.gfHandicap = 1;
      if (s.gfUseFormat === undefined) s.gfUseFormat = false;
      if (s.gfUseFormat) s.gfFormat = M.normalizeFormat(s.gfFormat);
      if (!s.gfFormat || typeof s.gfFormat !== 'object') s.gfFormat = M.normalizeFormat(null);
      if (s.resetUseFormat === undefined) s.resetUseFormat = false;
      if (s.resetUseFormat) s.resetFormat = M.normalizeFormat(Object.assign({ gamesPerMatch: 1, winNeeded: 1 }, s.resetFormat || {}));
      if (!s.resetFormat || typeof s.resetFormat !== 'object') s.resetFormat = M.normalizeFormat({ gamesPerMatch: 1, winNeeded: 1 });
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
    // 赛季归属（旧存档没有该字段 → 不属于任何赛季）
    if (t.seasonId === undefined) t.seasonId = null;
    // 赛事积分榜体系（旧存档没有该字段 → 默认关闭，不影响原有赛季口径）
    t.ptsRule = M.normalizePtsRule(t.ptsRule);
    // 团体赛设置（旧存档没有 → 关闭）
    t.team = Object.assign(M.defaultTeam(), t.team || {});
    if (['nvn', 'conquest', 'kof'].indexOf(t.team.mode) < 0) t.team.mode = 'nvn';
    if (!(parseInt(t.team.size, 10) >= 1)) t.team.size = 3;
    t.team.size = Math.min(99, parseInt(t.team.size, 10) || 3);
    if (!(parseInt(t.team.playSize, 10) >= 0)) t.team.playSize = 0;
    t.team.playSize = Math.min(99, parseInt(t.team.playSize, 10) || 0);
    if (!(parseInt(t.team.winNeeded, 10) >= 0)) t.team.winNeeded = 0;
    if (t.team.fmt) t.team.fmt = M.normalizeFormat(t.team.fmt);
    /* 团体赛：一桌 = 一场。旧存档的每条 games 没有场次号 → 按顺序补上 s，
       并补一个空的排阵表 slots（旧数据的上场队员已写在 games 的 pa / pb 里）。 */
    if (t.team.on) {
      t.stages.forEach(function (s0) {
        (s0.roundsData || []).forEach(function (rd) {
          (rd.matches || []).forEach(function (m) {
            if (!Array.isArray(m.slots)) m.slots = [];
            var next = 0;
            (m.games || []).forEach(function (g) {
              if (g.s === undefined || g.s === null || g.s === '') g.s = next;
              var cur = parseInt(g.s, 10);
              if (!(cur >= 0)) cur = next;
              next = Math.max(next, cur + 1);
            });
          });
        });
      });
    }
    if (t.format) t.format = M.normalizeFormat(t.format);
    /* ---- 字段类型校验（v2.6.1）----
       以前只补默认值、不校验类型：导入一个 players 不是数组的存档会直接抛
       TypeError（界面显示"存档解析失败"，T 却已经被改成半成品），
       而且 id / seed 里可以塞任意字符串（会拼进 HTML 属性，形成注入点）。 */
    if (!Array.isArray(t.players)) t.players = [];
    var sawIds = {};
    t.players = t.players.filter(function (p) {
      if (!p || typeof p !== 'object') return false;   // 丢掉坏数据，别让整个存档打不开
      return true;
    });
    t.players.forEach(function (p) {
      // id：只允许字母数字下划线短横（拼进 data-* / id= 时才安全），非法的一律重发
      if (!/^[\w-]{1,40}$/.test(String(p.id || '')) || sawIds[p.id]) p.id = util.uid('p');
      sawIds[p.id] = 1;
      if (typeof p.name !== 'string') p.name = String(p.name === undefined ? '' : p.name);
      p.seed = Math.max(0, parseInt(p.seed, 10) || 0);
      p.initialScore = parseFloat(p.initialScore);
      if (!isFinite(p.initialScore)) p.initialScore = 0;
    });
    if (!/^[\w-]{1,40}$/.test(String(t.id || ''))) t.id = util.uid('t');
    t.seed = (parseInt(t.seed, 10) >>> 0) || util.randomSeed();
    t.players.forEach(function (p) {
      if (p.active === undefined) p.active = true;
      if (p.hasBye === undefined) p.hasBye = false;
      if (p.dropReason === undefined) p.dropReason = '';
      if (!(parseInt(p.startStage, 10) >= 0)) p.startStage = 0;
      p.startStage = parseInt(p.startStage, 10) || 0;
      // 团体赛：队员列表（个人赛不会用到）
      if (Array.isArray(p.members)) {
        p.members = p.members.filter(function (mb) {
          if (!mb || typeof mb !== 'object') return false;
          if (!/^[\w-]{1,40}$/.test(String(mb.id || ''))) mb.id = util.uid('mb');
          if (!(parseInt(mb.seed, 10) >= 0)) mb.seed = 0;
          if (typeof mb.name !== 'string') mb.name = String(mb.name === undefined ? '' : mb.name);
          return true;
        });
      }
    });
    return t;
  };

  /* 存档导入校验：只做「能不能安全地用」这一步，具体字段清洗交给 S.normalize。
     @return {ok, msg, idHit}  idHit = 已经存在同 id 的赛事（界面要问用户覆盖还是另存） */
  S.validateImport = function (obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { ok: false, msg: '这不是有效的赛事存档（内容不是对象）' };
    }
    if (!Array.isArray(obj.players)) return { ok: false, msg: '存档里没有选手名单（players 不是数组）' };
    if (obj.stages !== undefined && !Array.isArray(obj.stages)) {
      return { ok: false, msg: '存档里的阶段数据已损坏（stages 不是数组）' };
    }
    var idHit = false;
    if (obj.id) {
      var idx = S.loadIndex();
      idHit = idx.some(function (x) { return x.id === obj.id; });
    }
    return { ok: true, msg: '', idHit: idHit };
  };

})(window);
