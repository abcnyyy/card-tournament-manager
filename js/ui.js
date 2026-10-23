/* ============================================================
   ui.js —— 界面渲染与交互
   ============================================================ */
(function (global) {
  'use strict';
  var TMS = global.TMS;
  var U = TMS.util, E = TMS.engine, M = TMS.model, C = TMS.const, F = TMS.formats, X = TMS.exporter, S = TMS.store;

  var T = null;                 // 当前打开的赛事
  var curView = 'setup';
  var editStage = 0;
  var stView = { stageIndex: 0, groupIdx: -1, bracketMerged: true };
  var showHistory = false;
  var arrangeOn = false;
  var groupOpen = false;
  // 对阵页：正在查看的轮次 / 阶段（-1 = 当前最新一轮 / 当前阶段）
  //   轮次：可随时回看并补录之前任何一轮
  //   阶段：只允许回看已经结束的旧阶段（只读）
  var viewRound = -1;
  var viewStageIdx = -1;
  var exSel = { stage: 0, round: -1, group: -1 };
  var pendingFileAction = null;

  function esc(s) { return U.esc(s); }

  /* ================= 通用小工具 ================= */

  /* 卡片容器 */
  function card(title, body, cls) {
    return '<div class="card' + (cls ? ' ' + cls : '') + '">' +
      (title ? '<h2>' + title + '</h2>' : '') + body + '</div>';
  }

  /* 表单行：标签 + 控件 + 说明 */
  function fld(label, control, hint) {
    return '<div class="fld">' +
      '<label>' + label + '</label>' +
      '<div class="fld-ctl">' + control +
      (hint ? '<div class="hint">' + hint + '</div>' : '') +
      '</div></div>';
  }

  /* 输入框：自动绑定到赛事数据的某个路径 */
  function inp(type, path, value, extra) {
    var bind = ' data-bind="' + path + '"';
    if (type === 'checkbox') {
      return '<input type="checkbox"' + bind + (value ? ' checked' : '') + (extra || '') + '>';
    }
    var v = (value === undefined || value === null) ? '' : value;
    return '<input type="' + type + '"' + bind + ' value="' + esc(String(v)) + '"' + (extra || '') + '>';
  }

  /* 下拉框：options 支持 [{key,name}] 或 ['a','b'] */
  function sel(path, options, value, required) {
    var h = '<select data-bind="' + path + '">';
    (options || []).forEach(function (o) {
      var k = (o && o.key !== undefined) ? o.key : o;
      var n = (o && o.name !== undefined) ? o.name : o;
      h += '<option value="' + esc(String(k)) + '"' +
        (String(k) === String(value) ? ' selected' : '') + '>' + esc(String(n)) + '</option>';
    });
    h += '</select>';
    if (required && !value) h = h.replace('<select', '<select style="border-color:#000"');
    return h;
  }
  /* ---------- 页内对话框（替代 window.confirm / window.prompt）----------
     打包后的桌面端与 Android WebView 上，原生弹窗不一定会出现（点了像没反应），
     所以统一用页面内的黑白模态框，通过回调返回结果。 */
  function modal(opts) {
    var wrap = document.getElementById('modalWrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'modalWrap';
      document.body.appendChild(wrap);
    }
    var isInput = !!opts.input;
    wrap.innerHTML =
      '<div class="mask"></div>' +
      '<div class="modal">' +
      '<div class="modal-title">' + esc(opts.title || '') + '</div>' +
      (opts.text ? '<div class="modal-text">' + esc(opts.text) + '</div>' : '') +
      (isInput
        ? '<input class="modal-input" id="modalInput" value="' + esc(opts.value || '') +
          '" placeholder="' + esc(opts.placeholder || '') + '">'
        : '') +
      '<div class="modal-foot">' +
      '<button class="btn" id="modalCancel">取消</button>' +
      '<button class="btn primary" id="modalOk">' + esc(opts.okText || '确定') + '</button>' +
      '</div></div>';
    wrap.style.display = 'block';

    function close() { wrap.style.display = 'none'; wrap.innerHTML = ''; }
    function done(v) { close(); if (opts.onDone) opts.onDone(v); }

    document.getElementById('modalCancel').onclick = function () { done(null); };
    document.querySelector('.mask').onclick = function () { done(null); };
    var input = document.getElementById('modalInput');
    document.getElementById('modalOk').onclick = function () {
      done(isInput ? (input ? input.value : '') : true);
    };
    if (input) {
      input.focus(); input.select();
      input.onkeydown = function (e) {
        if (e.key === 'Enter') { e.preventDefault(); done(input.value); }
        else if (e.key === 'Escape') { e.preventDefault(); done(null); }
      };
    }
  }
  // 确认框：ask('标题', '正文', function(ok){ ... })
  function ask(title, text, cb, okText) {
    modal({ title: title, text: text, okText: okText, onDone: function (v) { cb(!!v); } });
  }
  // 输入框：askInput('标题', 默认值, function(valueOrNull){ ... })
  function askInput(title, value, cb, placeholder, okText) {
    modal({
      title: title, input: true, value: value, placeholder: placeholder, okText: okText,
      onDone: function (v) { cb(v === null ? null : String(v)); }
    });
  }

  function toast(text, isError) {
    var el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:9999;' +
      'border:3px solid #000;padding:10px 18px;font-weight:800;box-shadow:5px 5px 0 #000;max-width:85vw;' +
      (isError ? 'background:#000;color:#fff;' : 'background:#fff;color:#000;');
    clearTimeout(el._t);
    el.style.display = 'block';
    el._t = setTimeout(function () { el.style.display = 'none'; }, 2800);
  }

  function getPath(obj, path) {
    var parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    var cur = obj, i;
    for (i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }
  function setPath(obj, path, val) {
    var parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    var cur = obj, i;
    for (i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] === undefined || cur[parts[i]] === null) {
      cur[parts[i]] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      }
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = val;
  }

  function save() { if (T) S.put(T); }

  // 阶段编辑后同步「独立局制 / 独立记分」与手动分组
  function afterStageEdit(stage, path) {
    if (!stage) return;
    if (stage.useFormat) {
      stage.format = stage.format
        ? Object.assign(M.defaultFormat(), stage.format)
        : U.clone(T.format);
    } else {
      stage.format = null;
    }
    if (stage.useScoring) {
      if (!stage.scoring) {
        stage.scoring = Object.assign(M.defaultScoring(), U.clone(T.scoring));
        delete stage.scoring.manualOrder;
      } else {
        stage.scoring = Object.assign(M.defaultScoring(), stage.scoring);
      }
    } else {
      stage.scoring = null;
    }
    if (!stage.manualOrder) stage.manualOrder = {};

    // 小组数量 / 分组方式变化 → 重新建立分组（仅在尚未开赛时）
    if (stage.type === 'groups' && /groupCount$|groupMethod$|type$/.test(path || '') &&
      !(stage.roundsData || []).length) {
      stage.groups = null;
      if (stage.index === T.currentStage) {
        E.ensureParticipants(T);
        if (stage.participants && stage.participants.length) stage.groups = E.buildGroups(T, stage);
      }
    }
  }

  // 统一变更入口：先快照，再改，再保存+渲染
  function mutate(fn) {
    E.snapshot(T);
    var r;
    try { r = fn() || {}; }
    catch (e) { r = { ok: false, msg: '操作失败：' + e.message }; }
    save();
    if (r.msg) toast(r.msg, r.ok === false);
    render();
    return r;
  }

  function nameOf(id) { return E.nameOf(T, id); }
  function playerOf(id) { return T.players.filter(function (x) { return x.id === id; })[0] || {}; }

  /**
   * 退赛 / DQ 之后的即时处理：
   * 把当前阶段里「含退赛者且还没打完」的比赛判给对手（不战而胜），
   * 双败阶段还要把他从胜者组 / 败者组 / 待注入名单里剔除，
   * 这样后面生成的对阵、对阵图都不会再出现他。
   */
  function dropFollowUp() {
    var st = T.stages[T.currentStage];
    if (!st) return '';
    var n = E.settleDropped(T, st);
    E.dePurgeDropped(T, st);
    if (!n) return '';
    return '；已把 ' + n + ' 场没打完的比赛判给对手（不战而胜）';
  }

  /* ================= 视图〇：赛事列表 ================= */
  function renderList() {
    var idx = S.loadIndex();
    var h = '';

    h += card('新建 / 导入赛事',
      '<div class="row">' +
      '<input type="text" id="newTName" placeholder="新赛事名称" style="width:260px">' +
      '<button class="btn primary lg" data-act="newT">+ 新建赛事</button>' +
      '<button class="btn lg" data-act="loadT">导入 JSON 存档</button>' +
      '</div>' +
      '<div class="hint" style="margin-top:6px">所有数据仅保存在本机浏览器中，不上传任何服务器。可随时导出 JSON 存档备份或迁移到其他设备。</div>'
    );

    var rows = '';
    idx.forEach(function (m) {
      var stTxt = m.status === 'finished' ? '已结束' : (m.status === 'running' ? '进行中' : '未开始');
      rows += '<tr>' +
        '<td><b>' + esc(m.name) + '</b></td>' +
        '<td class="num">' + m.players + '</td>' +
        '<td class="num">' + m.stages + '</td>' +
        '<td>' + stTxt + '</td>' +
        '<td class="mono">' + esc(m.updatedAt || m.createdAt || '') + '</td>' +
        '<td class="noprint">' +
        '<button class="btn sm primary" data-act="openT" data-id="' + m.id + '">打开</button> ' +
        '<button class="btn sm" data-act="dupT" data-id="' + m.id + '">复制</button> ' +
        '<button class="btn sm" data-act="exportT" data-id="' + m.id + '">导出</button> ' +
        '<button class="btn sm danger" data-act="delT" data-id="' + m.id + '">删除</button>' +
        '</td></tr>';
    });

    h += card('已有赛事（' + idx.length + '）',
      idx.length
        ? '<table class="compact"><thead><tr><th>赛事名称</th><th class="num">选手</th>' +
        '<th class="num">阶段</th><th>状态</th><th>更新时间</th><th class="noprint">操作</th></tr></thead><tbody>' +
        rows + '</tbody></table>'
        : '<div class="notice empty">还没有任何赛事。请输入名称后点击「新建赛事」，或导入已有的 JSON 存档。</div>'
    );

    return h;
  }

  /* --- 记分规则表单（赛事全局 / 阶段独立共用） --- */
  // 把 ranking key 转成中文名（找不到时直接返回 key）
  function getNameOfTie(key) {
    var list = (C && C.TIEBREAKERS) || [];
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i].name;
    return key;
  }

  function scoringHTML(prefix, sc, fmtArg, tieArg) {
    var h = fld('计分方式', sel(prefix + '.mode', C.SCORE_MODES, sc.mode, true));
    if (sc.mode === 'scoreline') {
      var sf2 = fmtArg || T.format;
      var lines = E.scoreLines(sf2, tieArg || null);
      var tbl = sc.scoreTable || {};
      h += '<div class="hint">下面是「<b>' + esc(fmtText(sf2)) + '</b>」这一局制下<b>所有可能出现的最终比分</b>，'
        + '逐个填分值即可。2:0 与 0:2 视为同一档，只列一次。</div>';
      h += '<table class="compact"><thead><tr>' +
        '<th class="num">最终比分</th><th class="num">胜方得</th><th class="num">负方得</th>' +
        '<th class="num">平局双方各得</th><th>说明</th></tr></thead><tbody>';
      lines.forEach(function (L) {
        var row = E.scoreRow(tbl, L.key, L.draw, sc);
        h += '<tr>' +
          '<td class="num"><b>' + L.a + ' : ' + L.b + '</b></td>' +
          (L.draw
            ? '<td class="num">—</td><td class="num">—</td>' +
              '<td class="num">' + inp('number', prefix + '.scoreTable.' + L.key + '.d', row.d, ' style="width:70px"') + '</td>'
            : '<td class="num">' + inp('number', prefix + '.scoreTable.' + L.key + '.w', row.w, ' style="width:70px"') + '</td>' +
              '<td class="num">' + inp('number', prefix + '.scoreTable.' + L.key + '.l', row.l, ' style="width:70px"') + '</td>' +
              '<td class="num">—</td>') +
          '<td class="hint">' + (L.draw
            ? '双方战平，各得相同分'
            : '胜者赢 ' + L.a + ' 局、负者赢 ' + L.b + ' 局') + '</td>' +
          '</tr>';
      });
      h += '</tbody></table>';
      /* ---- 未打完档位：计时器到点 / 中途结束（比分没打满就收场） ---- */
      var ulines = E.scoreUnfinishedLines(sf2);
      if (ulines.length) {
        h += '<h4 style="margin:12px 0 4px">未打完（计时器到点 / 中途结束）</h4>';
        h += '<div class="hint">比赛没打到「分出胜负」就被收场时，按这里的设置计分：'
          + '领先方 / 落后方分别得几分，局数相同时双方各得几分。'
          + '计时器到点自动结算的比赛、以及手动点「按未打完结算」的比赛都走这张表。</div>';
        h += '<table class="compact"><thead><tr>' +
          '<th class="num">已打比分</th><th class="num">领先方得</th><th class="num">落后方得</th>' +
          '<th class="num">平分双方各得</th><th>说明</th></tr></thead><tbody>';
        ulines.forEach(function (L) {
          var row = E.scoreRow(tbl, L.key, L.draw, sc);
          h += '<tr>' +
            '<td class="num"><b>' + L.a + ' : ' + L.b + '</b></td>' +
            (L.draw
              ? '<td class="num">—</td><td class="num">—</td>' +
                '<td class="num">' + inp('number', prefix + '.scoreTable.' + L.key + '.d', row.d, ' style="width:70px"') + '</td>'
              : '<td class="num">' + inp('number', prefix + '.scoreTable.' + L.key + '.w', row.w, ' style="width:70px"') + '</td>' +
                '<td class="num">' + inp('number', prefix + '.scoreTable.' + L.key + '.l', row.l, ' style="width:70px"') + '</td>' +
                '<td class="num">—</td>') +
            '<td class="hint">' + (L.draw
              ? (L.a === 0 ? '一局都没打（通常按双方各得处理）' : '局数相同，双方各得')
              : '领先 ' + L.a + ' 局、落后 ' + L.b + ' 局时收场') + '</td>' +
            '</tr>';
        });
        h += '</tbody></table>';
      }
      h += '<div class="hint" style="margin-top:6px">兜底分值：当实际比分不在上表内（例如后来改过局制）时使用。</div>';
      h += '<div class="grid4">' +
        fld('胜（兜底）', inp('number', prefix + '.win', sc.win)) +
        fld('平（兜底）', inp('number', prefix + '.draw', sc.draw)) +
        fld('负（兜底）', inp('number', prefix + '.lose', sc.lose)) +
        fld('轮空得', inp('number', prefix + '.bye', sc.bye)) +
        '</div>';
      return h;
    }
    if (sc.mode === 'result') {
      h += '<div class="grid4">' +
        fld('胜一场得', inp('number', prefix + '.win', sc.win)) +
        fld('平一场得', inp('number', prefix + '.draw', sc.draw)) +
        fld('负一场得', inp('number', prefix + '.lose', sc.lose)) +
        fld('轮空得', inp('number', prefix + '.bye', sc.bye)) +
        '</div>' +
        '<div class="hint">录入时可「直接填几比几」，系统自动判胜负并按这里的分值给分。</div>';
    } else if (sc.mode === 'games') {
      h += fld('每赢一局得分', inp('number', prefix + '.perGame', sc.perGame),
        '一场比赛得分 = 赢下的局数 × 该分值') +
        fld('轮空', inp('number', prefix + '.bye', sc.bye));
    } else if (sc.mode === 'points') {
      h += fld('轮空', inp('number', prefix + '.bye', sc.bye),
        '按小分累加：积分为该选手各局得分之和，需开启「记录每局具体比分」。');
    } else {
      h += '<div class="grid2">' +
        fld('积分公式', inp('text', prefix + '.formula', sc.formula, ' style="width:300px"')) +
        fld('轮空', inp('number', prefix + '.bye', sc.bye)) +
        '</div>';
      var vs = (E.FORMULA_VARS || []).map(function (v) {
        return '<span class="tag">' + esc(v.k) + ' = ' + esc(v.d) + '</span>';
      }).join(' ');
      h += '<div style="margin:6px 0">' + vs + '</div>';
      h += '<div class="hint">示例：<span class="mono">w*3+d</span>（胜3平1负0）· <span class="mono">gw</span>（每赢一局1分）· <span class="mono">w*3+d+gd*0.1</span>（净胜局加成）。支持 + - * / % ^ 与括号。</div>';
    }
    return h;
  }

  /* ================= 视图一：赛事设置 ================= */
  function renderSetup() {
    if (!T) return '';
    var f = T.format, sc = T.scoring, h = '';

    /* --- 基本信息 --- */
    h += card('基本信息',
      fld('赛事名称', inp('text', 'name', T.name, ' style="width:320px"')) +
      '<div class="hint">随机种子：<span class="mono">' + T.seed + '</span>（决定抽签结果，存档后可复现）</div>'
    );

    /* --- 局制 --- */
    h += card('局制（默认值，可被单个阶段覆盖）',
      fld('每场比赛局数', inp('number', 'format.gamesPerMatch', f.gamesPerMatch, ' min="1"')) +
      fld('获胜所需局数', inp('number', 'format.winNeeded', f.winNeeded, ' min="0"'),
        '先赢够该局数即结束整场比赛（剩余局不再进行）。填 <b>0</b> 表示不论赢几局都打满全部局数，最后按赢局多少判定。') +
      fld('记录每局具体比分', inp('checkbox', 'format.recordScore', f.recordScore),
        '开启后录入时可填每局具体比分数字，供「按小分累加 / 自定义公式」使用。') +
      '<div class="hint">若某个阶段需要不同的局制（例如小组赛 BO1、淘汰赛 BO5），在该阶段的「本阶段局制与记分」中勾选独立设置。</div>'
    );

    /* --- 记分规则 --- */
    h += card('记分规则（默认值，可被单个阶段覆盖）', scoringHTML('scoring', sc, T.format, null));

    /* --- 比赛计时器 --- */
    var tmCfg = E.tmCfg(T);
    var tmb = fld('启用每场限时',
      inp('checkbox', 'timer.enabled', tmCfg.enabled),
      '开启后，每场比赛都可以在对阵卡片上单独开表倒计时（可暂停、归零、重开）。');
    if (tmCfg.enabled) {
      tmb += '<div class="grid2">' +
        fld('每场限时（分钟）', inp('number', 'timer.minutes', tmCfg.minutes, ' min="1" step="1"'),
          '默认每场多少分钟，开表时写入该场（之后改这里不影响已在计时的场次）。') +
        fld('到点自动结算', inp('checkbox', 'timer.autoSettle', tmCfg.autoSettle),
          '不勾选 = 到点只标红提醒，由裁判手动结算。') +
        '</div>';
      tmb += fld('到点时双方局数相同', sel('timer.tieAction', C.TIMER_TIES, tmCfg.tieAction, true),
        '到点按当前大比分结算：领先方获胜；局数相同时按这里处理。'
        + '淘汰赛必须有人晋级，所以「记平局」在淘汰赛会自动改为按种子号判定。');
      tmb += '<div class="hint">到点结算的比赛会被标记为<b>未打完</b>：'
        + '计分走「记分规则 → 按大比分逐档设分 → 未打完」那张表，'
        + '排名按实际胜负（或平局）计入战绩，场次与小分都按已打的局照常统计。</div>';
    }
    h += card('比赛计时器', tmb);

    /* --- 排名依据 --- */
    var tb = '<div class="hint" style="margin-bottom:6px">同分时从上到下依次比较。' +
      '点「上」「下」调整优先级，点「移除」停用该项，不需要的依据都可以删掉。</div>';
    sc.tieOrder.forEach(function (key, i) {
      var name = key;
      for (var k = 0; k < C.TIEBREAKERS.length; k++) if (C.TIEBREAKERS[k].key === key) name = C.TIEBREAKERS[k].name;
      tb += '<div class="row" style="border:1px solid #000;padding:4px 8px;margin-bottom:3px">' +
        '<b>' + (i + 1) + '</b> <span style="flex:1;font-weight:700">' + esc(name) + '</span>' +
        '<button class="btn sm" data-act="tieUp" data-i="' + i + '">上</button>' +
        '<button class="btn sm" data-act="tieDown" data-i="' + i + '">下</button>' +
        '<button class="btn sm danger" data-act="tieRemove" data-i="' + i + '">移除</button>' +
        '</div>';
    });
    if (!sc.tieOrder.length) {
      tb += '<div class="row" style="border:1px dashed #000;padding:6px 8px">' +
        '<span class="hint">当前未启用任何排名依据，同分选手将保持录入顺序。</span></div>';
    }
    // 可添加的依据
    var avail = C.TIEBREAKERS.filter(function (x) { return sc.tieOrder.indexOf(x.key) < 0; });
    if (avail.length) {
      tb += '<div class="row" style="margin-top:6px">' +
        '<select id="tieAddSel" style="flex:1">' +
        avail.map(function (x) { return '<option value="' + esc(x.key) + '">' + esc(x.name) + '</option>'; }).join('') +
        '</select>' +
        '<button class="btn" data-act="tieAdd">添加依据</button>' +
        '</div>';
    }
    h += card('排名依据（Tiebreaker）', tb);

    /* --- 轮空规则 --- */
    h += card('轮空规则（人数为奇数时）',
      fld('轮空方式', sel('byeRule', C.BYE_RULES, T.byeRule, false)) +
      '<div class="hint">轮空由<b>系统自动判定</b>：生成轮次时按上面规则直接排好，并按记分规则里的「轮空分」自动计分，'
      + '不需要人工指定。若对某轮轮空人选不满意，可在「③ 对阵与录入 → 手动编排 / 随机抽签」里改。</div>'
    );

    /* --- 阶段设置 --- */
    h += card('赛程阶段（多阶段赛制）', stagePipelineHTML());

    h += '<div class="row"><button class="btn primary lg" data-act="saveSetup">保存设置</button>' +
      '<span class="hint">设置会自动保存；正式开赛后请勿随意修改当前阶段的规则。</span></div>';

    return h;
  }

  function stagePipelineHTML() {
    var h = '';
    h += '<div class="pipeline">';
    T.stages.forEach(function (s, i) {
      var cls = 'pipe-item' + (i === editStage ? ' current' : '') + (s.status === 'finished' ? ' done' : '');
      var badges = (s.useFormat ? ' · <b>独立局制</b>' : '') + (s.useScoring ? ' · <b>独立记分</b>' : '');
      h += '<div class="' + cls + '"><span class="t">' + esc(s.name) + '</span>' +
        esc(typeName(s.type)) + ' · ' + esc(roundDesc(s)) + badges + '</div>';
    });
    h += '</div>';

    h += '<div class="row" style="margin-bottom:10px">' +
      '<button class="btn" data-act="addStage">+ 添加阶段</button>' +
      '<button class="btn" data-act="copyStage">复制当前阶段</button>' +
      '<button class="btn danger" data-act="delStage">删除当前阶段</button>' +
      '</div>';

    h += '<div class="row" style="margin-bottom:10px"><label>编辑阶段：</label>';
    T.stages.forEach(function (s, i) {
      h += '<button class="btn sm ' + (i === editStage ? 'primary' : '') + '" data-act="gotoStage" data-i="' + i + '">' +
        esc(s.name) + '</button>';
    });
    h += '</div>';

    h += stageEditorHTML();
    return h;
  }

  function typeName(key) {
    for (var i = 0; i < C.STAGE_TYPES.length; i++) if (C.STAGE_TYPES[i].key === key) return C.STAGE_TYPES[i].name;
    return key;
  }

  function pairLabel(stage) {
    var m = (stage && stage.pairMode) || 'auto';
    if (m === 'random') return '随机配对（每轮重新抽签）';
    if (m === 'manual') return '手动编排（自己点选配对）';
    return '自动配对（积分相近者优先）';
  }

  function fmtText(f) {
    if (!f) return '';
    return f.winNeeded > 0
      ? ('每场 ' + f.gamesPerMatch + ' 局 · 先赢 ' + f.winNeeded + ' 局')
      : ('每场 ' + f.gamesPerMatch + ' 局 · 打满');
  }

  function scoringText(sc) {
    if (!sc) return '';
    var short = { result: '胜负平积分', scoreline: '大比分逐档设分', games: '赢局计分', points: '小分累加', formula: '自定义公式' };
    var name = short[sc.mode] || sc.mode;
    var extra = '';
    if (sc.mode === 'result') extra = '（胜 ' + sc.win + ' / 平 ' + sc.draw + ' / 负 ' + sc.lose + ' / 轮空 ' + sc.bye + '）';
    else if (sc.mode === 'scoreline') {
      var ks = Object.keys(sc.scoreTable || {}).sort();
      extra = ks.length
        ? '（' + ks.map(function (k) {
            var r = sc.scoreTable[k] || {};
            return k.replace('-', ':') + '→' + (('d' in r) ? ('各' + r.d) : (r.w + '/' + r.l));
          }).join('，') + '）'
        : '（尚未设置各比分分值）';
    }
    else if (sc.mode === 'games') extra = '（每赢 1 局 ' + sc.perGame + ' 分）';
    else if (sc.mode === 'formula') extra = '（' + sc.formula + '）';
    return name + extra;
  }

  function roundDesc(s) {
    switch (s.type) {
      case 'swiss': return (s.rounds || 1) + ' 轮';
      case 'round_robin': return (s.cycles || 1) + ' 循环';
      case 'single_elim': return '单败' + (s.thirdPlace ? '（含季军赛）' : '');
      case 'double_elim': return '双败' +
        ((parseInt(s.deSplitTop, 10) || 0) >= 2 ? '（前 ' + s.deSplitTop + ' 名进胜者组）' : '');
      case 'groups': return (s.groupCount || 1) + ' 组 · ' + typeName(s.groupType);
    }
    return '';
  }

  function stageEditorHTML() {
    var i = editStage, s = T.stages[i];
    if (!s) return '';
    var p = 'stages[' + i + ']';
    var h = '<div style="border:2px solid #000;padding:10px">';

    h += fld('阶段名称', inp('text', p + '.name', s.name, ' style="width:240px"'));
    h += fld('赛制类型', sel(p + '.type', C.STAGE_TYPES, s.type, true));

    if (s.type === 'swiss') {
      h += fld('轮数', inp('number', p + '.rounds', s.rounds, ' min="1"'),
        '推荐轮数 ≈ ⌈log₂(人数)⌉，人数多时可适当增加。');
      h += fld('每轮配对方式', sel(p + '.pairMode', C.PAIR_MODES, s.pairMode || 'auto', true),
        '自动配对：积分相近者优先、尽量避免重复交手；随机配对：每轮重新抽签；'
        + '手动编排：生成轮次时由你在「③ 对阵与录入」页自己点选配对。'
        + '三种方式都可以在生成后、录成绩前再手动微调。');
    } else if (s.type === 'round_robin') {
      h += fld('循环次数', inp('number', p + '.cycles', s.cycles, ' min="1"'),
        '1 = 单循环（每人交手一次）；2 = 双循环（主客场各一次）。');
    } else if (s.type === 'groups') {
      h += '<div class="grid3">' +
        fld('小组数量', inp('number', p + '.groupCount', s.groupCount, ' min="1"')) +
        fld('分组方式', sel(p + '.groupMethod', [
          { key: 'snake', name: '蛇形排列（按种子）' },
          { key: 'random', name: '随机抽签' },
          { key: 'manual', name: '手动分组' }
        ], s.groupMethod || 'snake', false)) +
        fld('小组内赛制', sel(p + '.groupType', [
          { key: 'round_robin', name: '循环赛' },
          { key: 'swiss', name: '瑞士轮' },
          { key: 'single_elim', name: '单败淘汰' },
          { key: 'double_elim', name: '双败淘汰' }
        ], s.groupType, true)) +
        fld('每组晋级人数', inp('number', p + '.adv.perGroup', s.adv.perGroup, ' min="1"')) +
        '</div>';
      if (s.groupType === 'round_robin') {
        h += fld('组内循环次数', inp('number', p + '.groupCycles', s.groupCycles || 1, ' min="1"'));
      } else if (s.groupType === 'swiss') {
        h += fld('组内轮数', inp('number', p + '.groupRounds', s.groupRounds || 3, ' min="1"'));
      } else if (s.groupType === 'single_elim') {
        h += fld('季军争夺战', inp('checkbox', p + '.thirdPlace', !!s.thirdPlace),
          '小组内单败淘汰时，是否安排半决赛负者对决产生第 3、4 名。');
      } else if (s.groupType === 'double_elim') {
        h += '<div class="hint">组内双败：每组各自一棵双败树（胜者组 + 败者组 + 一场组内总决赛），'
          + '输两场才在组内出局；组内总决赛为一场定胜负。组内名次按积分排，'
          + '再按「每组晋级人数」取人。</div>';
      }
      if (s.groupMethod === 'manual') {
        h += '<div class="hint">手动分组在「③ 对阵与录入」页的「分组设置」中调整；开赛时会先自动生成一份蛇形初稿。</div>';
      }
    }

    if (s.type === 'single_elim') {
      h += fld('最多进行轮数', inp('number', p + '.maxRounds', s.maxRounds || 0, ' min="0"'),
        '0 = 打完整棵对阵树直到决出冠军；设为 1 表示只打第一轮，再由「晋级条件」决定谁进入下一阶段。');
    }

    // ---- 本阶段局制与记分（可覆盖赛事全局）----
    var effF = E.fmtOf(T, s), effS = E.scOf(T, s);
    h += '<h4>本阶段局制与记分</h4>';
    h += '<div class="hint" style="margin-bottom:6px">当前生效：<b>' + esc(fmtText(effF)) + '</b> · <b>' +
      esc(scoringText(effS)) + '</b></div>';
    h += fld('独立局制',
      '<label><input type="checkbox" data-bind="' + p + '.useFormat"' + (s.useFormat ? ' checked' : '') +
      '> 本阶段单独设置局制</label>',
      '例如小组赛 BO1、淘汰赛 BO5，就分别在不同阶段勾选并设置。');
    if (s.useFormat) {
      var sf = Object.assign(M.defaultFormat(), s.format || effF);
      h += '<div class="grid3">' +
        fld('每场局数', inp('number', p + '.format.gamesPerMatch', sf.gamesPerMatch, ' min="1"')) +
        fld('获胜所需局数', inp('number', p + '.format.winNeeded', sf.winNeeded, ' min="0"')) +
        fld('记录每局比分', inp('checkbox', p + '.format.recordScore', sf.recordScore)) +
        '</div>';
    }
    h += fld('独立记分',
      '<label><input type="checkbox" data-bind="' + p + '.useScoring"' + (s.useScoring ? ' checked' : '') +
      '> 本阶段单独设置记分方式</label>',
      '例如小组赛按胜负积分、淘汰赛不计分。');
    if (s.useScoring) {
      var stageTie = s.tie || 'sudden_death';
      h += scoringHTML(p + '.scoring', Object.assign(M.defaultScoring(), s.scoring || effS), effF, stageTie);
      h += '<div class="hint">同分排序依据（Tiebreaker）仍统一使用上方「排名依据」。</div>';
    }

    // 平局处理（所有赛制通用）
    h += fld('平局处理', sel(p + '.tie', C.ELIM_TIE, s.tie || 'sudden_death', false),
      '打满全部局数后出现平局时如何处理。淘汰赛一般选「自动加赛决胜」；'
      + '循环赛 / 瑞士轮若允许平局，请选「允许平局」，平局才会按平局分（或大比分表中的平局档）计入。');

    // 平局判定为「双方都输」：瑞士轮 / 循环赛 / 小组赛 / 双败淘汰都可设置
    var deStage = (s.type === 'double_elim' || (s.type === 'groups' && s.groupType === 'double_elim'));
    if (s.type === 'swiss' || s.type === 'round_robin' || s.type === 'groups' || deStage) {
      var blTip;
      if (deStage) {
        blTip = '勾选后，本阶段出现的<b>任何平局都不分胜负、双方各记一负</b>：'
          + '<br>· <b>胜者组</b>平局 → 两人一起掉进败者组；'
          + '<br>· <b>败者组</b>平局 → 两人各自吃到第 2 负，<b>双双淘汰</b>；'
          + '<br>· <b>总决赛</b>平局 → 胜者组冠军是第 1 负（掉进败者组）、败者组冠军已是第 2 负当场淘汰，'
          + '场上只剩一人，即本阶段冠军；'
          + '<br>· 不勾选（默认）：双败不允许平局，平局的场次会卡住直到改判或加赛。';
      } else {
        blTip = '勾选后，本阶段出现的<b>任何平局都不按平局计分</b>，而是<b>双方各记一负</b>'
          + '（两人都拿「负场分」，战绩表里不会再出现「平」这一项）。'
          + '积分榜、导出表、提前晋级 / 提前淘汰的判定都按「双方都输」来算，相当于这场谁也没赢；'
          + '<br>· <b>小分不受影响</b>：赢局 / 输局 / 净胜局 / 净小分 / 累进分仍按真实比分记录；'
          + '<br>· 不勾选（默认）：平局照常按「平局分」计入，双方各记一场平。';
      }
      h += fld('本阶段平局判定',
        '<label><input type="checkbox" data-bind="' + p + '.drawBothLose"'
        + (s.drawBothLose ? ' checked' : '') + '> 任何平局都判为 <b>双方都输</b></label>',
        blTip);
      var tieNow = s.tie || 'sudden_death';
      var tieLabel = ((C.ELIM_TIE || []).filter(function (x) { return x.key === tieNow; })[0] || {}).name || tieNow;
      if (tieNow !== 'draw_ok') {
        h += '<div class="notice inv">当前「平局处理」是「' + tieLabel + '」，只有把平局处理改成'
          + '「允许平局（平局即最终结果）」后才可能出现平局，本项届时才生效。</div>';
      } else {
        h += '<div class="notice">已允许平局：本阶段的平局将来会按「双方都输」处理'
          + (deStage ? '，名次表与对阵图上都会把这场标为平局双负。'
            : '，战绩里双方各记一负、积分按负场分计。') + '</div>';
      }
    }

    // 淘汰赛相关：季军赛
    if (s.type === 'single_elim') {
      h += '<h4>淘汰赛设置</h4>';
      h += fld('季军争夺战', inp('checkbox', p + '.thirdPlace', !!s.thirdPlace),
        '决赛之外，额外安排一场半决赛负者之间的对决，产生明确的第 3、4 名。'
        + (s.adv && (s.adv.type === 'count' || s.adv.type === 'count_tie') && s.adv.count > 1
          ? '<br><b>注意</b>：本阶段按人数晋级（不只取冠军），季军赛不会安排。' : ''));
      // 轮数 / 轮空自动推算预览
      if (s.type === 'single_elim' || s.type === 'double_elim') {
        var np = (s.participants && s.participants.length) ? s.participants.length
          : (i === 0 ? T.players.filter(function (x) { return x.active !== false; }).length
            : ((T.stages[i - 1].advanced || []).length || 0));
        if (s.type === 'single_elim') {
          var tg = E.elimTarget(T, s);
          if (np >= 2 && tg >= np) {
            h += '<div class="notice inv">晋级人数（' + tg + '）不小于本阶段人数（' + np + '），没有淘汰可打，请调小晋级人数。</div>';
          } else if (np >= 2) {
            var pl = E.elimPlan(np, tg);
            var real = pl.perRound.slice();
            if (real.length) real[0] = Math.max(1, np - pl.size / 2);   // 首轮真正要打的场次（其余是轮空）
            h += '<div class="notice"><b>自动推算</b>：本阶段 ' + np + ' 人，要留下 '
              + (tg <= 1 ? '1 人（冠军）' : tg + ' 人') + ' → 共 <b>' + pl.rounds + ' 轮</b>，'
              + '对阵表 ' + pl.size + ' 位、首轮 <b>' + pl.byes + ' 人轮空</b>，'
              + '各轮实打场次 ' + real.join(' → ') + '，每轮后剩 ' + pl.survivors.join(' → ') + ' 人。'
              + '<br>轮数和轮空都是算出来的，不需要手填。</div>';
          }
        } else {
          var topDE = Math.max(0, parseInt(s.deSplitTop, 10) || 0);
          var wN = (topDE >= 2 && np >= topDE + 2) ? topDE : np;
          var sz = U.nextPow2(Math.max(2, wN));
          h += '<div class="notice"><b>自动推算</b>：本阶段 ' + np + ' 人 → '
            + ((wN !== np)
              ? ('前 ' + wN + ' 人进胜者组（对阵表 ' + sz + ' 位、首轮 ' + (sz - wN) + ' 人轮空），'
                + '其余 ' + (np - wN) + ' 人直接进败者组；')
              : ('对阵表 ' + sz + ' 位、首轮 ' + (sz - np) + ' 人轮空；'))
            + '胜者组 ' + Math.round(Math.log2(sz)) + ' 轮、败者组约 '
            + (2 * Math.round(Math.log2(sz)) - 2) + ' 轮。双败以冠军为终点，按 2 的幂自动补齐规模。</div>';
        }
      }
    }

    // 淘汰赛：首轮编排方式（单败 / 双败通用）
    if (s.type === 'single_elim' || s.type === 'double_elim') {
      h += '<h4>首轮编排方式</h4>';
      h += fld('编排方式', sel(p + '.drawMode', C.DRAW_MODES, s.drawMode || 'seed', true),
        '按种子号：标准种子位，1 号与末位同区、强手分散；'
        + '分档抽签：先按种子分档，<b>档内随机</b>（同档的人互换位置，强弱分布不变）；'
        + '完全随机抽签：所有选手一起打乱。');
      if ((s.drawMode || 'seed') === 'tier') {
        h += fld('分档数', inp('number', p + '.drawTiers', s.drawTiers || 4, ' min="2" max="32"'),
          '例如 16 人分 4 档 → 每档 4 人，档内抽签决定谁碰谁。档数越多越接近随机；'
          + '2 档就是「强档 vs 弱档」的分档抽签。');
      }
      h += '<div class="hint">抽签在点「生成首轮对阵」时自动进行；生成后、开打前可点「重新抽签」换一次结果。' +
        '轮空人数由「本阶段人数 + 晋级人数」算出，抽签只改变谁碰谁，不改变轮空数量。' +
        '<b>轮空归谁不会变</b>：按上阶段排名该拿轮空的人，随机 / 分档抽签都不会把他抽离轮空位。</div>';
    }

    // 双败：分组起跑（前 N 名进胜者组、其余从败者组打起）
    if (s.type === 'double_elim') {
      var npS = (s.participants && s.participants.length) ? s.participants.length
        : (i === 0 ? T.players.filter(function (x) { return x.active !== false; }).length
          : ((T.stages[i - 1].advanced || []).length || 0));
      var topS = Math.max(0, parseInt(s.deSplitTop, 10) || 0);
      h += '<h4>双败 · 分组起跑</h4>';
      h += fld('排名前几名从胜者组打起',
        inp('number', p + '.deSplitTop', topS, ' min="0" max="' + Math.max(2, npS) + '"'),
        '0 = 全部人从胜者组开始（传统双败）。<br>'
        + '填 N（≥2）= 按本阶段排名，<b>前 N 人从胜者组</b>打起，第 N+1 名及以后<b>直接进入败者组</b>；'
        + '从败者组起跑的人已经算「输过一场」，在败者组再输一场即出局。<br>'
        + '例：瑞士轮取 16 人进双败，这里填 8 → 前 8 名进胜者组、9~16 名从败者组打起。');
      if (topS >= 2) {
        if (npS < topS + 2) {
          h += '<div class="notice inv">本阶段约 ' + npS + ' 人，前 ' + topS
            + ' 名之外的选手不足 2 人，起跑设置不会生效（需要至少 ' + (topS + 2) + ' 人）。</div>';
        } else {
          h += '<div class="notice">按当前设置：前 <b>' + topS + '</b> 人进胜者组（对阵表 '
            + U.nextPow2(topS) + ' 位），其余 <b>' + (npS - topS) + '</b> 人直接进败者组先打一轮。</div>';
        }
      }
    }

    // 双败：总决赛规则
    if (s.type === 'double_elim') {
      h += '<h4>双败淘汰 · 总决赛规则</h4>';
      h += fld('总决赛赛制', sel(p + '.gfMode', C.GF_MODES, s.gfMode || 'reset', true),
        '加赛制：败者组冠军必须先赢下首场，才触发第二场加赛；'
        + '可升格决赛：只打一场、比分累计不重置，败者组冠军先到原获胜局数后目标升格（如先到 3 局→升为 4 局）；'
        + '无优势：一场定胜负；让局：一方开局先计若干局。');
      if ((s.gfMode || 'reset') === 'handicap') {
        h += '<div class="grid2">' +
          fld('先计局数的一方', sel(p + '.gfAdvSide', [
            { key: 'W', name: '胜者组冠军先计（让给败者组冠军）' },
            { key: 'L', name: '败者组冠军先计' }
          ], s.gfAdvSide || 'W', true)) +
          fld('先计局数', inp('number', p + '.gfHandicap', s.gfHandicap || 1, ' min="1"'),
            '例如总局制为「先赢 3 局」，此处填 1，则先计方再赢 2 局即夺冠，另一方需赢满 3 局。') +
          '</div>';
      }
      h += fld('总决赛独立局制',
        '<label><input type="checkbox" data-bind="' + p + '.gfUseFormat"' + (s.gfUseFormat ? ' checked' : '') +
        '> 总决赛单独设置局制（例如阶段 BO3、总决赛 BO5）</label>');
      if (s.gfUseFormat) {
        var gf = s.gfFormat || { gamesPerMatch: 3, winNeeded: 2, recordScore: false };
        h += '<div class="grid3">' +
          fld('每场局数', inp('number', p + '.gfFormat.gamesPerMatch', gf.gamesPerMatch, ' min="1"')) +
          fld('获胜所需局数', inp('number', p + '.gfFormat.winNeeded', gf.winNeeded, ' min="0"')) +
          fld('记录每局比分', inp('checkbox', p + '.gfFormat.recordScore', !!gf.recordScore)) +
          '</div>';
      }
      if ((s.gfMode || 'reset') === 'elevate') {
        var ecv = E.gfElevCfg(T, s);
        var ef = s.gfElevFormat || { gamesPerMatch: 7, winNeeded: 4, recordScore: false };
        h += fld('升格后的目标局数',
          '<label><input type="checkbox" data-bind="' + p + '.gfElevUseFormat"' + (s.gfElevUseFormat ? ' checked' : '') +
          '> 手动指定（不勾选 = 自动取「原获胜局数 + 1」）</label>',
          '只有一场，<b>比分累计不重置</b>：双方先到 ' + ecv.base + ' 局者赢下这场比赛，'
          + '但若<b>败者组冠军</b>先到 ' + ecv.base + ' 局，则目标升为 ' + ecv.up + ' 局，'
          + '双方带着原比分继续打到 ' + ecv.up + ' 局；若<b>胜者组冠军</b>先到 ' + ecv.base
          + ' 局，则不升格，直接夺冠。');
        if (s.gfElevUseFormat) {
          h += '<div class="grid3">' +
            fld('升格后获胜所需局数', inp('number', p + '.gfElevFormat.winNeeded', ecv.up, ' min="2"'),
              '必须大于原获胜局数（' + ecv.base + '）。') +
            fld('每场最多局数', inp('number', p + '.gfElevFormat.gamesPerMatch', Math.max(ef.gamesPerMatch, ecv.up * 2 - 1), ' min="1"'),
              'BO 制总场数，自动不小于「' + ecv.up + ' 胜」需要的 ' + (ecv.up * 2 - 1) + ' 局。') +
            fld('记录每局比分', inp('checkbox', p + '.gfElevFormat.recordScore', !!ef.recordScore)) +
            '</div>';
        }
      }
      if ((s.gfMode || 'reset') === 'reset') {
        h += fld('加赛局独立局制',
          '<label><input type="checkbox" data-bind="' + p + '.resetUseFormat"' + (s.resetUseFormat ? ' checked' : '') +
          '> 加赛局单独设置局制（可与总决赛首场不同，例如首场 BO5、加赛 BO1）</label>');
        if (s.resetUseFormat) {
          var rf = s.resetFormat || { gamesPerMatch: 1, winNeeded: 1, recordScore: false };
          h += '<div class="grid3">' +
            fld('每场局数', inp('number', p + '.resetFormat.gamesPerMatch', rf.gamesPerMatch, ' min="1"')) +
            fld('获胜所需局数', inp('number', p + '.resetFormat.winNeeded', rf.winNeeded, ' min="0"')) +
            fld('记录每局比分', inp('checkbox', p + '.resetFormat.recordScore', !!rf.recordScore)) +
            '</div>';
        } else {
          h += '<div class="hint">未勾选时，加赛局沿用总决赛（或阶段）的局制。</div>';
        }
      }
      h += '<div class="hint">双败流程：首轮全部进入胜者组；负一场者掉入败者组，负两场即淘汰；'
        + '胜者组冠军与败者组冠军进行总决赛。每轮录入完结果后请点「结算本轮」，系统才会推进两组归属。</div>';
    }

    // 晋级条件（最后一个阶段不需要）
    var isLast = (i === T.stages.length - 1);
    h += '<h4>晋级条件</h4>';
    if (isLast) {
      h += '<div class="hint">这是最后一个阶段，结束后即为最终排名。</div>';
    } else if (s.type === 'groups') {
      h += '<div class="hint">每个小组按组内排名取前 <b>' + (s.adv.perGroup || 1) + '</b> 名晋级下一阶段。</div>';
    } else {
      h += fld('晋级方式', sel(p + '.adv.type', C.ADV_TYPES, s.adv.type, true));
      if (s.adv.type === 'count') {
        h += fld('晋级人数', inp('number', p + '.adv.count', s.adv.count, ' min="1"'));
      } else if (s.adv.type === 'count_tie') {
        h += fld('晋级人数（基准）', inp('number', p + '.adv.count', s.adv.count, ' min="1"'),
          '先取满这么多人；如果<b>第 N 名有同分者</b>，同分的人一起晋级，所以最终人数可能多于 N。');
      } else if (s.adv.type === 'score') {
        h += fld('晋级积分线', inp('number', p + '.adv.score', s.adv.score), '本阶段积分 ≥ 该分数者晋级');
      }
    }

    // 分数继承（首阶段无）
    if (i > 0) {
      h += '<h4>分数继承</h4>';
      h += fld('继承上一阶段积分', inp('checkbox', p + '.inherit.enabled', !!(s.inherit && s.inherit.enabled)));
      if (s.inherit && s.inherit.enabled) {
        h += fld('继承比例（%）', inp('number', p + '.inherit.ratio', s.inherit.ratio, ' min="0" max="100"'),
          '100 = 全额带入下一阶段；50 = 带入一半。积分与小分都用这一个比例。');
        h += fld('同时继承小分',
          inp('checkbox', p + '.inherit.tie', !!s.inherit.tie),
          '勾选后，上一阶段的 <b>全部小分</b> 都按同一比例带入本阶段：'
          + '累计小分、净小分、赢局 / 输局（净胜局）、对手分、累进分。'
          + '本阶段打出的成绩继续往上累加，破同分时直接生效（排名页不再单独标注）。<br>'
          + '不勾选 = 只带积分（小分从 0 重新计算）。');
      }
    }

    // 提前晋级 / 提前淘汰（按战绩自动判定）
    if (E.clinchSupported(s)) {
      var cg = s.clinch || {};
      h += '<h4>提前晋级 / 提前淘汰</h4>';
      h += fld('启用自动判定',
        inp('checkbox', p + '.clinch.enabled', !!cg.enabled),
        '达到 N 胜即<strong>提前锁定下一阶段席位</strong>（本阶段不再参赛）；达到 N 负即<strong>提前淘汰</strong>。'
        + '每轮成绩全部录入后自动判定，可随时在「排名」页看到结果。');
      if (cg.enabled) {
        h += fld('判定依据',
          sel(p + '.clinch.basis', [
            { key: 'match', name: '按比赛场次（大比分 胜 / 负）' },
            { key: 'game', name: '按小局（赢下 / 输掉的局数）' }
          ], cg.basis || 'match', true),
          '按场次：赢 3 场即晋级、输 3 场即淘汰（大比分制）。<br>'
          + '按小局：累计赢下 6 局即晋级、累计输掉 6 局即淘汰（小局制，轮空不计局）。');
        h += '<div class="grid2">' +
          fld('达到几胜 → 提前晋级',
            inp('number', p + '.clinch.winTarget', cg.winTarget === undefined ? 0 : cg.winTarget, ' min="0"'),
            '0 = 不设晋级线') +
          fld('达到几负 → 提前淘汰',
            inp('number', p + '.clinch.lossTarget', cg.lossTarget === undefined ? 0 : cg.lossTarget, ' min="0"'),
            '0 = 不设淘汰线') +
          '</div>';
        h += '<div class="grid2">' +
          fld('提前晋级者下一阶段加分',
            inp('number', p + '.clinch.bonus', cg.bonus === undefined ? 0 : cg.bonus, ' min="0"'),
            '0 = 不加分') +
          fld('每提前一轮额外加分',
            inp('number', p + '.clinch.bonusPerEarly', cg.bonusPerEarly === undefined ? 0 : cg.bonusPerEarly, ' min="0"'),
            '越早锁定，起手分越高') +
          '</div>';
        h += '<div class="hint">'
          + '<b>举例</b>：5 轮制、晋级线 3 胜、基础加分 2、每提前一轮 +1。第 3 轮拿到第 3 胜 → 提前 2 轮 → '
          + '下一阶段起手 +4（2 + 1×2）。加分只写入下一阶段，不改选手的全局初始分。'
          + '<br><b>排序规则</b>：已提前晋级者整体排在未定者之前（同为提前晋级时，越早锁定越靠前）；'
          + '已提前淘汰者整体排在最后（同为提前淘汰时，越晚出局越靠前）。'
          + '<br><b>对手分照样会变</b>：提前晋级 / 淘汰的选手不再出场，但仍保留在排行榜里，'
          + '其对手分按对手的实时积分重算，所以对手后面继续赢分，他的对手分也会跟着涨。'
          + '<br><b>晋级保证</b>：提前晋级者无论用「按人数」还是「按积分线」晋级，都会进入下一阶段。'
          + '</div>';
      }
    }

    // 中途淘汰（按轮次裁人，旧机制）
    h += '<h4>中途淘汰（按名次裁人）</h4>';
    h += fld('启用中途淘汰', inp('checkbox', p + '.elim.enabled', !!(s.elim && s.elim.enabled)),
      '指定某一轮结束后，只保留排名前 N 名，其余人立即退出本阶段。'
      + '与上面的「按战绩自动判定」可以同时使用。');
    if (s.elim && s.elim.enabled) {
      h += '<div class="grid2">' +
        fld('第几轮结束后淘汰', inp('number', p + '.elim.afterRound', s.elim.afterRound, ' min="0"'),
          '从 0 开始计数：填 0 = 第 1 轮结束后裁人。') +
        fld('保留前几名', inp('number', p + '.elim.keep', s.elim.keep, ' min="1"')) +
        '</div>';
    }

    h += '</div>';
    return h;
  }

  /* ================= 视图二：选手管理 ================= */
  function renderPlayers() {
    if (!T) return '';
    var h = '';

    h += card('批量导入选手',
      '<textarea id="bulkNames" placeholder="每行一个名字；也可用逗号、分号、制表符分隔&#10;例如：&#10;张三&#10;李四&#10;王五"></textarea>' +
      '<div class="row" style="margin-top:8px">' +
      '<button class="btn primary" data-act="bulkImport">导入名单</button>' +
      '<button class="btn" data-act="bulkImportFile">从文件导入 (txt/csv)</button>' +
      '<button class="btn" data-act="exportNames">导出名单</button>' +
      '<button class="btn" data-act="autoSeed">按当前顺序编种子号</button>' +
      '<button class="btn danger" data-act="clearPlayers">清空全部</button>' +
      '</div>'
    );

    var rows = '';
    T.players.forEach(function (p, i) {
      rows += '<tr>' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td><input type="text" data-player="' + p.id + '" data-field="name" value="' + esc(p.name) + '" style="width:140px"></td>' +
        '<td class="num"><input type="number" data-player="' + p.id + '" data-field="seed" value="' + p.seed + '" style="width:64px"></td>' +
        '<td class="num"><input type="number" data-player="' + p.id + '" data-field="initialScore" value="' + p.initialScore + '" style="width:72px"></td>' +
        '<td><input type="text" data-player="' + p.id + '" data-field="note" value="' + esc(p.note) + '" style="width:120px"></td>' +
        '<td>' + (p.active === false ? '<b>' + esc(p.dropReason || '已退出') + '</b>' : '在赛') + '</td>' +
        '<td class="noprint">' +
        (p.active === false
          ? '<button class="btn sm" data-act="restorePlayer" data-id="' + p.id + '">恢复</button>'
          : '<button class="btn sm" data-act="dropPlayer" data-id="' + p.id + '">退赛</button>' +
          '<button class="btn sm" data-act="dqPlayer" data-id="' + p.id + '">取消资格</button>') +
        ' <button class="btn sm danger" data-act="delPlayer" data-id="' + p.id + '">删除</button>' +
        '</td></tr>';
    });

    h += card('选手列表（' + T.players.length + ' 人）',
      T.players.length
        ? '<table class="compact"><thead><tr><th class="num">#</th><th>姓名</th><th class="num">种子</th>' +
        '<th class="num">初始分</th><th>备注</th><th>状态</th><th class="noprint">操作</th></tr></thead><tbody>' +
        rows + '</tbody></table>'
        : '<div class="notice empty">尚未导入任何选手。请在上方文本框粘贴名单后点击「导入名单」。</div>'
    );

    h += '<div class="row"><button class="btn" data-act="addPlayer">+ 添加单个选手</button>' +
      '<span class="hint">种子号用于初始排位（蛇形分组 / 淘汰赛 bracket 位置），0 或留空表示无种子。</span></div>';

    return h;
  }

  /* ================= 视图三：对阵与录入 ================= */

  function groupName(stage, gi) {
    if (gi === null || gi === undefined) return '';
    if (stage.groups && stage.groups[gi]) return stage.groups[gi].name;
    return '第 ' + (gi + 1) + ' 组';
  }

  // 某一桌可选的选手
  function slotOptions(stage, rd, m) {
    var ids;
    if (stage.type === 'groups' && m.group !== null && m.group !== undefined && stage.groups) {
      ids = (stage.groups[m.group].players || []).slice();
    } else if ((stage.type === 'single_elim' || stage.type === 'double_elim') && rd.index > 0) {
      ids = E.roundPool(rd);              // 淘汰赛后段只能在本轮败者/胜者池内调整
    } else {
      ids = E.aliveInStage(T, stage);
    }
    ids.sort(function (a, b) { return (playerOf(a).seed || 9999) - (playerOf(b).seed || 9999); });
    return ids;
  }

  function slotSelect(stage, rd, m, slot) {
    var cur = (slot === 'A') ? m.playerA : m.playerB;
    var used = E.roundPool(rd);
    var h = '<select data-pair="' + m.id + '" data-slot="' + slot + '" style="width:100%">' +
      '<option value="">（空 / 轮空）</option>';
    slotOptions(stage, rd, m).forEach(function (id) {
      var other = (id !== cur) && (used.indexOf(id) >= 0);
      h += '<option value="' + esc(id) + '"' + (id === cur ? ' selected' : '') + '>' +
        (other ? '↔ ' : '') + esc(nameOf(id)) + '</option>';
    });
    h += '</select>';
    return h;
  }

  /* ============ 手动编排（点选式，手机上也点得准） ============ */
  var draft = null;      // { stageIndex, replace, pairs:[[a,b]], bye, sel:[] }

  function draftFromRound(stage, rd) {
    var pairs = [], bye = null;
    (rd && rd.matches ? rd.matches : []).forEach(function (m) {
      if (m.isBye) { bye = m.playerA || m.playerB; return; }
      if (m.playerA && m.playerB) pairs.push([m.playerA, m.playerB]);
      else if (m.playerA || m.playerB) bye = m.playerA || m.playerB;
    });
    return { pairs: pairs, bye: bye, sel: [] };
  }

  function ensureDraft(stage, can) {
    if (draft && draft.stageIndex === T.currentStage) return draft;
    draft = {
      stageIndex: T.currentStage,
      replace: !!can.replace,
      pairs: can.replace ? draftFromRound(stage, E.currentRound(stage)).pairs : [],
      bye: can.replace ? draftFromRound(stage, E.currentRound(stage)).bye : null,
      sel: []
    };
    return draft;
  }

  function arrangePanelHTML(stage, rd, arr) {
    var can = E.canManualArrange(T, stage);
    if (!can.ok) {
      return '<div class="card"><h3>手动编排</h3>' +
        '<div class="notice inv">' + esc(can.msg) + '</div>' +
        '<div class="hint">淘汰赛的首轮请用设置里的「编排方式」（按种子 / 分档抽签 / 随机抽签）生成；'
        + '生成后想改，点「重新抽签」即可。</div></div>';
    }
    var d = ensureDraft(stage, can);
    var pool = E.manualPool(T, stage);
    var stats = E.buildStats(T, stage, stage.participants || [], null);
    var usedMap = {};
    d.pairs.forEach(function (p) { usedMap[p[0]] = 1; usedMap[p[1]] = 1; });
    if (d.bye) usedMap[d.bye] = 1;
    var num = can.roundIndex + 1;

    var h = '<div class="card arrcard"><h3>手动编排 · 第 ' + num + ' 轮</h3>';
    h += '<div class="hint" style="margin:-4px 0 10px">'
      + '点两名选手组成一桌（再点一下可以取消选择）；点已配对的选手可以把他拆出来重排。'
      + '人数为奇数时要指定 1 人轮空。</div>';

    h += '<div class="arr-bar">' +
      '<button class="btn primary" data-act="dRandom">随机配对</button>' +
      '<button class="btn" data-act="dAuto">按积分自动配</button>' +
      '<button class="btn" data-act="dClear">清空重来</button>' +
      '<span class="hint">已排 <b>' + d.pairs.length + '</b> 桌 · 已安排 <b>' + (Object.keys(usedMap).length) + '</b> / ' + pool.length + ' 人</span>' +
      '</div>';

    // 选手池
    h += '<div class="arr-sec-title">本轮可出赛（' + pool.length + ' 人）</div>';
    h += '<div class="chips">';
    pool.forEach(function (id) {
      var p = playerOf(id);
      var st = stats[id] || {};
      var cls = 'chip' + (usedMap[id] ? ' used' : '') + (d.sel.indexOf(id) >= 0 ? ' sel' : '');
      h += '<button class="' + cls + '" data-act="dPick" data-id="' + esc(id) + '">' +
        '<span class="chip-name">' + esc(p.name || '') + '</span>' +
        '<span class="chip-sub">' + (st.points === undefined ? '' : (st.points + ' 分')) + '</span>' +
        '</button>';
    });
    h += '</div>';

    // 已配对
    h += '<div class="arr-sec-title">对阵（' + d.pairs.length + ' 桌）</div>';
    if (!d.pairs.length) {
      h += '<div class="notice empty">还没有配对。点上面两个名字就会组成一桌。</div>';
    } else {
      h += '<div class="arr-pairs">';
      d.pairs.forEach(function (p, i) {
        h += '<div class="arr-pair"><span class="tno">' + (i + 1) + '</span>' +
          '<span class="pp">' + esc(nameOf(p[0])) + '</span>' +
          '<span class="vs">VS</span>' +
          '<span class="pp">' + esc(nameOf(p[1])) + '</span>' +
          '<button class="btn sm" data-act="dBreak" data-i="' + i + '">拆开</button></div>';
      });
      h += '</div>';
    }

    // 轮空
    h += '<div class="arr-sec-title">轮空</div>';
    if (d.bye) {
      h += '<div class="arr-pair"><span class="pp">' + esc(nameOf(d.bye)) + '</span>' +
        '<span class="vs">轮空</span><span class="spacer"></span>' +
        '<button class="btn sm" data-act="dBye" data-id="">取消轮空</button></div>';
    } else {
      h += '<div class="hint">未指定。' + (pool.length % 2 === 1 ? '<b>本轮人数为奇数，必须指定 1 人轮空。</b>' : '本轮人数为偶数，不需要轮空。') + '</div>';
    }

    h += '<div class="row" style="margin-top:12px">' +
      '<button class="btn primary lg" data-act="dConfirm">确认本轮对阵</button>' +
      '<span class="hint">确认后即生成本轮，可直接录成绩；没录成绩前还能再回来改。</span>' +
      '</div>';

    // 逐桌微调（原来的下拉方式，适合精确替换）
    if (rd) {
      h += '<details class="arr-detail"><summary>逐桌微调（下拉替换，B 留空 = 轮空）</summary>';
      h += '<table class="compact"><thead><tr><th class="num">桌号</th><th>选手 A</th><th>选手 B</th><th class="noprint">操作</th></tr></thead><tbody>';
      (rd.matches || []).forEach(function (m, i) {
        h += '<tr><td class="num">' + (i + 1) + '</td>' +
          '<td>' + slotSelect(stage, rd, m, 'A') + '</td>' +
          '<td>' + slotSelect(stage, rd, m, 'B') + '</td>' +
          '<td class="noprint"><button class="btn sm danger" data-act="delTable" data-id="' + m.id + '">删除</button></td></tr>';
      });
      h += '</tbody></table></details>';
    }

    h += '</div>';
    return h;
  }

  function groupEditorHTML(stage) {
    var methodName = { snake: '蛇形排列', random: '随机抽签', manual: '手动分组' }[stage.groupMethod || 'snake'];
    var h = '<div class="card"><h3>分组设置</h3>';
    if (!stage.groups || !stage.groups.length) {
      h += '<div class="notice empty">尚未生成分组。可先生成一份初始分组，再手动调整。</div>' +
        '<div class="row">' +
        '<button class="btn primary" data-act="redrawGroups" data-mode="snake">按蛇形生成分组</button>' +
        '<button class="btn" data-act="redrawGroups" data-mode="random">随机抽签生成分组</button>' +
        '</div></div>';
      return h;
    }
    h += '<div class="row" style="margin-bottom:8px">' +
      '<button class="btn" data-act="redrawGroups" data-mode="snake">按蛇形重新分组</button>' +
      '<button class="btn" data-act="redrawGroups" data-mode="random">随机抽签重新分组</button>' +
      '<span class="hint">当前方式：<b>' + esc(methodName) + '</b> · 第一轮开始后不可再调整</span>' +
      '</div>';
    var giOf = {};
    stage.groups.forEach(function (g, i) { (g.players || []).forEach(function (id) { giOf[id] = i; }); });
    h += '<table class="compact"><thead><tr><th class="num">#</th><th>选手</th>' +
      '<th class="num">种子</th><th>所在小组</th></tr></thead><tbody>';
    (stage.participants || []).forEach(function (id, idx) {
      var p = playerOf(id);
      h += '<tr><td class="num">' + (idx + 1) + '</td><td><b>' + esc(p.name) + '</b></td>' +
        '<td class="num">' + (p.seed || '—') + '</td><td>' +
        '<select data-member="' + id + '">' +
        stage.groups.map(function (g, i) {
          return '<option value="' + i + '"' + (giOf[id] === i ? ' selected' : '') + '>' + esc(g.name) + '</option>';
        }).join('') +
        '</select></td></tr>';
    });
    h += '</tbody></table>' +
      '<div class="hint" style="margin-top:6px">手动改动任意一名选手的小组后，分组方式会自动切换为「手动分组」。</div>';
    h += '</div>';
    return h;
  }

  function renderMatches() {
    if (!T) return '';
    if (!T.players.length) {
      return '<div class="notice empty">请先在「② 选手管理」中导入参赛选手。</div>';
    }
    // 正在查看的阶段：默认当前阶段；也可以回看已经打完的旧阶段（只读）
    var si = (viewStageIdx >= 0 && viewStageIdx < T.stages.length) ? viewStageIdx : T.currentStage;
    var stage = T.stages[si];
    if (!stage) return '<div class="notice">无阶段数据</div>';
    var isCur = (si === T.currentStage);
    REND_STAGE = stage;
    REND_RO = !isCur;               // 旧阶段只读

    E.ensureParticipants(T);
    LIVE_CACHE = {};          // 每次渲染重新统计实时战绩
    CUR_PATHS = isElimStage(stage) ? E.bracketPaths(T, stage) : null;

    var totalRounds = E.plannedRounds(stage, (stage.participants || []).length);
    var cur = stage.roundsData.length;
    // 正在查看的轮次：默认最新一轮；点轮次条可随时回看之前任何一轮
    var picked = (viewRound >= 0 && viewRound < cur) ? viewRound : cur - 1;
    var rd = stage.roundsData[picked];
    var lastRd = stage.roundsData[cur - 1];
    var incomplete = lastRd ? E.roundComplete(T, stage, lastRd) : { ok: true };
    var fmt = E.fmtOf(T, stage), sc = E.scOf(T, stage);

    var h = '';
    h += '<div class="statusbar">' +
      '<span><span class="k">赛事：</span><span class="v">' + esc(T.name) + '</span></span>' +
      '<span><span class="k">' + (isCur ? '当前阶段：' : '查看阶段：') + '</span><span class="v">' + esc(stage.name) + '（' + esc(typeName(stage.type)) + '）' +
      (isCur ? '' : ' · 历史') + '</span></span>' +
      '<span><span class="k">轮次：</span><span class="v">' + cur + ' / ' + (totalRounds === null ? '动态' : totalRounds) + '</span></span>' +
      '<span><span class="k">参赛：</span><span class="v">' + (stage.participants || []).length + ' 人</span></span>' +
      '<span><span class="k">状态：</span><span class="v">' + statusText(stage) + '</span></span>' +
      '</div>';
    h += '<div class="statusbar">' +
      '<span><span class="k">本阶段局制：</span><span class="v">' + esc(fmtText(fmt)) +
      (stage.useFormat ? '（独立）' : '（沿用全局）') + '</span></span>' +
      '<span><span class="k">本阶段记分：</span><span class="v">' + esc(scoringText(sc)) +
      (stage.useScoring ? '（独立）' : '（沿用全局）') + '</span></span>' +
      '<span><span class="k">' + (isElimStage(stage) ? '首轮编排：' : '每轮配对：') + '</span><span class="v">' +
      esc(isElimStage(stage) ? E.drawLabel(stage) : pairLabel(stage)) + '</span></span>' +
      '</div>';

    /* ---- 阶段 / 轮次切换条：随时回看之前任何一轮，或已结束的旧阶段 ---- */
    if (T.stages.length > 1) h += stageBarHTML(si);
    if (cur > 0) h += roundBarHTML(stage, picked, cur);

    if (picked >= 0 && picked !== cur - 1) {
      h += '<div class="notice noprint"><b>正在查看第 ' + (rd.index + 1) + ' 轮（历史轮次）</b>：' +
        '可以直接补录 / 改判，改完点「回到最新轮」继续。' +
        (isElimStage(stage)
          ? '淘汰赛已结算过的轮次，建议先用「回退一步」退回到该轮再改，否则后面已生成的轮次会和新结果错位。'
          : '') +
        '</div>';
    }
    if (!isCur) {
      h += '<div class="notice inv"><b>正在查看旧阶段「' + esc(stage.name) + '」</b>：' +
        '已结束的旧阶段只供回看（只读），不能在这里录入。如需修改，请先用「回退一步」退回该阶段。</div>';
    }

    var canGen = isCur && incomplete.ok && !E.stageFinished(T, stage);
    var arr = E.canArrangeRound(T, stage, lastRd);
    var manCan = E.canManualArrange(T, stage);
    var isDE = (stage.type === 'double_elim');
    if (isCur) {
      var finBtn;
      if (isDE) {
        // 双败：本轮结果录完后点「结算本轮」推进胜者组/败者组归属
        var committed = !!(lastRd && lastRd.committed);
        finBtn = '<button class="btn" data-act="finishRound"' +
          (lastRd && !committed ? '' : ' disabled') + '>' +
          (committed ? '本轮已结算' : '结算本轮') + '</button>';
      } else {
        // 成绩全部录完（incomplete.ok = true）才允许结算本轮，
        // 否则中途淘汰 / 提前晋级判定会永远等不到这一下点击
        finBtn = '<button class="btn' + (lastRd && incomplete.ok ? ' primary' : '') + '" data-act="finishRound"' +
          (lastRd && incomplete.ok ? '' : ' disabled') + '>' +
          (lastRd && incomplete.ok ? '完成本轮（结算）' : '完成本轮') + '</button>';
      }
      h += '<div class="row noprint" style="margin-bottom:12px">' +
        '<button class="btn primary lg" data-act="genRound"' + (canGen ? '' : ' disabled') + '>' +
        (cur === 0 ? '生成首轮对阵' : (isDE ? '生成下一轮（胜者组 / 败者组）' : '生成下一轮')) + '</button>' +
        finBtn +
        '<button class="btn" data-act="finishStage"' + (lastRd ? '' : ' disabled') + '>结束本阶段并晋级</button>' +
        '<button class="btn" data-act="rollback"' + (T.history.length ? '' : ' disabled') + '>回退一步</button>' +
        '<button class="btn" data-act="printRound">打印本轮</button>' +
        (E.tmCfg(T).enabled
          ? '<button class="btn" data-act="tmStartAll">全轮开始计时</button>' +
            '<button class="btn" data-act="tmPauseAll">全轮暂停</button>'
          : '') +
        (isElimStage(stage) && lastRd ? '<button class="btn" data-act="redrawDraw">重新抽签</button>' : '') +
        (isElimStage(stage) && E.elimStageIndexes(T).length > 1
          ? '<button class="btn" data-act="gotoMerged">查看合并对阵图</button>' : '') +
        (manCan.ok ? '<button class="btn' + (arrangeOn ? ' primary' : '') + '" data-act="toggleArrange">' +
          (arrangeOn ? '收起手动编排' : '手动编排本轮') + '</button>' : '') +
        '</div>';
    } else {
      h += '<div class="row noprint" style="margin-bottom:12px">' +
        '<button class="btn primary" data-act="latestStage">回到当前阶段</button>' +
        '<button class="btn" data-act="gotoMerged">查看合并对阵图</button>' +
        '<button class="btn" data-act="printRound">打印本轮</button>' +
        '</div>';
    }

    if (isCur && lastRd && !incomplete.ok) {
      h += '<div class="notice inv">本轮尚有未完成的比赛：' + esc(incomplete.msg) + '</div>';
    }
    if (isCur && E.stageFinished(T, stage)) {
      h += '<div class="notice inv">' +
        ((lastRd && !incomplete.ok)
          ? '本阶段的计划轮次已排满；本轮成绩录完后点「结束本阶段并晋级」即可。'
          : '本阶段对阵已全部结束，请点击「结束本阶段并晋级」。') +
        '</div>';
    }

    if (isCur && stage.type === 'groups' && !stage.roundsData.length) {
      h += '<div class="row noprint" style="margin-bottom:10px">' +
        '<button class="btn' + (groupOpen ? ' primary' : '') + '" data-act="toggleGroups">' +
        (groupOpen ? '收起分组' : '分组设置 / 手动调整') + '</button>' +
        '<span class="hint">分组方式：蛇形 / 随机抽签 / 手动调整，均在此处。</span>' +
        '</div>';
      if (groupOpen) h += groupEditorHTML(stage);
    }

    if (isCur && arrangeOn) h += arrangePanelHTML(stage, lastRd, arr);
    if (!stage.roundsData.length) {
      h += '<div class="notice empty">尚未生成对阵。点上方「生成首轮对阵」，或点「手动编排本轮」自己点选配对。</div>';
    } else {
      h += renderRound(stage, rd, isCur && picked === cur - 1);
    }
    return h;
  }

  /* ---- 阶段切换条：旧阶段可以随时点开回看（只读） ---- */
  function stageBarHTML(si) {
    var h = '<div class="navbar noprint"><span class="nlabel">阶段</span>';
    T.stages.forEach(function (s, i) {
      var has = (s.roundsData || []).length > 0;
      var isCur = (i === T.currentStage);
      h += '<button class="rchip' + (i === si ? ' on' : '') + (!has ? ' off' : '') + '"' +
        ' data-act="pickStage" data-i="' + i + '"' + (has ? '' : ' disabled') + '>' +
        esc(s.name) + '<i>' + (isCur ? '当前' : (has ? '已结束' : '未开始')) + '</i></button>';
    });
    h += '</div>';
    return h;
  }

  /* ---- 轮次切换条：每一轮都能点回去看 / 补录 ---- */
  function roundBarHTML(stage, picked, cur) {
    var h = '<div class="navbar noprint"><span class="nlabel">轮次</span>';
    for (var i = 0; i < cur; i++) {
      var r = stage.roundsData[i];
      var done = true;
      try { done = E.roundComplete(T, stage, r).ok; } catch (e) { done = true; }
      var sub = (i === cur - 1) ? '最新' : (done ? '已录完' : '有未完场');
      h += '<button class="rchip' + (i === picked ? ' on' : '') + '" data-act="pickRound" data-i="' + i + '">' +
        '第 ' + (r.index + 1) + ' 轮' + (r.isGF ? ' · 总决赛' : '') + '<i>' + sub + '</i></button>';
    }
    h += '<button class="btn sm" data-act="latestRound"' + (picked === cur - 1 ? ' disabled' : '') +
      '>回到最新轮</button>';
    h += '</div>';
    return h;
  }

  function renderRound(stage, rd, isCurrent) {
    var h = '<div class="card"><h3>第 ' + (rd.index + 1) + ' 轮' +
      (rd.isGF ? ' · 总决赛' : '') + (isCurrent ? ' · 当前' : '') + '</h3>';
    // 本卡片使用的战绩口径：截至本轮结束（含本轮已录入的结果）
    CUR_LIVE = liveStatsFor(stage, rd);
    h += '<div class="hint noprint" style="margin:-4px 0 8px">' +
      '选手名<strong>下方</strong>一行是<strong>实时战绩</strong>：胜 / 负 / 平 · 本阶段积分 · 当前名次' +
      (isCurrent ? '（含本轮已录入的结果，录完即刻刷新）' : '（截至本轮结束）') +
      '；进行中的比赛只更新比分，分出胜负后才计入战绩与积分；已提前晋级 / 已淘汰会加标记。</div>';

    var byGroup = {}, order = [];
    (rd.matches || []).forEach(function (m) {
      var k = (m.group === null || m.group === undefined) ? '_' : String(m.group);
      if (!byGroup[k]) { byGroup[k] = []; order.push(k); }
      byGroup[k].push(m);
    });

    order.forEach(function (k) {
      var label = '';
      if (k !== '_' && stage.groups) label = stage.groups[parseInt(k, 10)].name;
      if (label) h += '<h4>' + esc(label) + '</h4>';

      var ms = byGroup[k];
      if (stage.type === 'double_elim' ||
          ((stage.groupType === 'single_elim' || stage.groupType === 'double_elim') && k !== '_')) {
        var w = ms.filter(function (m) { return m.bracket === 'W' && !m.isThird; });
        var l = ms.filter(function (m) { return m.bracket === 'L'; });
        var t = ms.filter(function (m) { return m.isThird; });
        var wGf = ms.filter(function (m) { return m.isGF; })[0];
        var wLabel = '胜者组';
        if (rd.isGF) {
          if (rd.gfReset) wLabel = (stage.gfMode === 'reset') ? '总决赛 · 加赛局' : '总决赛';
          else if (wGf && wGf.gfElev && E.gfElevNeed(wGf) > wGf.gfElev.base) {
            wLabel = '总决赛 · 已升格（需 ' + E.gfElevNeed(wGf) + ' 胜）';
          } else wLabel = '总决赛';
        }
        if (w.length) h += '<div style="font-weight:800;margin:6px 0 4px">' + wLabel + '</div>' + matchGrid(w);
        if (l.length) h += '<div style="font-weight:800;margin:10px 0 4px">败者组</div>' + matchGrid(l);
        if (t.length) h += '<div style="font-weight:800;margin:10px 0 4px">季军争夺战</div>' + matchGrid(t);
      } else {
        h += matchGrid(ms);
      }
    });

    h += '</div>';
    return h;
  }

  function matchGrid(ms) {
    var h = '<div class="matchlist">';
    var seat = 0;
    ms.forEach(function (m) {
      if (m.__empty) return;      // 编排中的空桌不在正式对阵里显示
      seat++;
      h += matchCard(m, seat);
    });
    h += '</div>';
    return h;
  }

  /* ============ 对阵页：实时战绩（胜 / 负 / 平 / 积分 / 名次） ============
   * 以「截至本轮（含）」为口径计算：
   *  - 当前轮：含已经录完的本轮结果，录入即刻变化 → 实时
   *  - 历史轮：截断到该轮结束，回看时看到的是当时的战绩
   */
  var LIVE_CACHE = {};
  var CUR_LIVE = {};
  var CUR_PATHS = null;      // 当前阶段（淘汰赛）的晋级路径
  var REND_STAGE = null;     // 正在渲染的阶段（回看旧阶段时 != 当前阶段）
  var REND_RO = false;       // 正在渲染的阶段是否只读（旧阶段只读）

  function liveStatsFor(stage, rd) {
    if (!stage) return {};
    var si = T.stages.indexOf(stage);
    var upTo = rd ? rd.index : null;
    var key = si + '|' + (upTo === null ? 'all' : upTo);
    if (LIVE_CACHE[key]) return LIVE_CACHE[key];

    var map = {};
    function absorb(list) {
      (list || []).forEach(function (s) { map[s.id] = s; });
    }
    try {
      if (stage.type === 'groups' && stage.groups && stage.groups.length) {
        stage.groups.forEach(function (g, gi) {
          absorb(E.standings(T, { stageIndex: si, groupIdx: gi, upToRound: upTo }));
        });
        // 小组可能被手工改动过，兜底补一次全员（不带小组）
        if (!Object.keys(map).length) {
          absorb(E.standings(T, { stageIndex: si, upToRound: upTo }));
        }
      } else {
        absorb(E.standings(T, { stageIndex: si, upToRound: upTo }));
      }
    } catch (e) { /* 阶段尚未开始时忽略 */ }

    LIVE_CACHE[key] = map;
    return map;
  }

  function recHTML(s, id) {
    if (!s) {
      var p0 = playerOf(id);
      if (!p0 || !p0.id) return '';
      return '<span class="rk">暂无战绩</span>';
    }
    var h = '<span class="seg"><b>' + s.wins + '</b> 胜 <b>' + s.losses + '</b> 负 <b>' +
      s.draws + '</b> 平</span>';
    h += '<span class="seg pts"><b>' + U.fmt(s.points) + '</b> 分</span>';
    if (s.rank) h += '<span class="rk">第 ' + s.rank + ' 名</span>';
    if (s.clinched) h += '<span class="tag inv">已提前晋级</span>';
    else if (s.eliminated) h += '<span class="tag">已淘汰</span>';
    else if (s.active === false) h += '<span class="tag">' + esc(s.dropReason || '退赛') + '</span>';
    return h;
  }

  function matchCard(m, seat) {
    var na = nameOf(m.playerA), nb = nameOf(m.playerB);
    var r = m.result || { gamesA: 0, gamesB: 0, winner: null };
    var winA = (r.winner === 'A'), winB = (r.winner === 'B');
    var stage = REND_STAGE || T.stages[T.currentStage];
    var fmt = E.fmtOfMatch(T, stage, m), sc = E.scOf(T, stage);
    var rd = rd_of_match(m);
    var advA = (m.gfAdv && m.gfAdv.side === 'A') ? m.gfAdv.games : 0;
    var advB = (m.gfAdv && m.gfAdv.side === 'B') ? m.gfAdv.games : 0;

    var h = '<div class="match ' + (m.decided ? 'done' : 'pending') + '">';

    var headParts = [seat ? ('第 ' + seat + ' 桌') : ('M' + (m.round + 1))];
    if (m.isThird) headParts.push('季军赛');
    else if (m.isBye) headParts.push('轮空');
    else if (rd_isGF(rd)) {
      if (m.gfElev && E.gfElevNeed(m) > m.gfElev.base) {
        headParts.push('总决赛 · 已升格（需 ' + E.gfElevNeed(m) + ' 胜）');
      } else if (m.gfRound === 'reset') {
        headParts.push(stage.gfMode === 'elevate' ? '总决赛 · 升格决赛' : '总决赛 · 加赛局');
      } else {
        headParts.push('总决赛');
      }
    }
    else if (m.bracket === 'L') headParts.push('败者组');
    else if (stage.type === 'single_elim' || stage.type === 'double_elim') headParts.push('胜者组');
    if (m.gfAdv) headParts.push((advA ? na : nb) + ' 先计 ' + m.gfAdv.games + ' 局');

    var statusTxt;
    if (m.isBye) statusTxt = '轮空自动晋级';
    else if (m.overtime) statusTxt = '加赛中（需分出胜负）';
    else if (m.decided) {
      if (r.winner) statusTxt = '胜者：' + (winA ? na : nb);
      else if (stage.drawBothLose) {
        if (stage.type === 'double_elim' || (stage.type === 'groups' && stage.groupType === 'double_elim')) {
          statusTxt = '平局 · 双方各记一负' + (rd_isGF(rd)
            ? '（冠军由负场少的一方获得）'
            : (m.bracket === 'L' ? '（两人均被淘汰）' : '（两人都掉入败者组）'));
        } else {
          statusTxt = '平局 · 双方各记一负（都按负场分计，战绩不记平局）';
        }
      } else statusTxt = '平局';
    }
    else statusTxt = '进行中 ' + (m.games || []).length + '/' + E.matchMaxGames(m, fmt) + ' 局';
    if (m.override) statusTxt += '（手动指定）';
    if (m.result && m.result.unfinished) {
      statusTxt += m.result.endReason === 'timeout' ? '（计时器到点 · 未打完）' : '（未打完）';
    }

    h += '<div class="match-head"><span>' + esc(headParts.join(' · ')) + '</span><span>' + esc(statusTxt) + '</span></div>';

    // 淘汰赛：直接在对阵卡片上标出胜者 / 负者的下一场比赛
    if (CUR_PATHS && !m.isBye) {
      var pw = CUR_PATHS.win[m.id], pl = CUR_PATHS.lose[m.id];
      h += '<div class="matchpath">' +
        '<span>胜者 → ' + esc(pw || '待定') + '</span>' +
        '<span>负者 → ' + esc(pl || '待定') + '</span>' +
        '</div>';
    }

    if (m.isBye) {
      h += '<div class="match-body"><div class="side" style="flex:1">' +
        '<div class="pname">' + esc(na || nb) + '</div>' +
        (recHTML(CUR_LIVE[m.playerA || m.playerB], m.playerA || m.playerB)
          ? '<div class="prec">' + recHTML(CUR_LIVE[m.playerA || m.playerB], m.playerA || m.playerB) + '</div>' : '') +
        '<div class="psub">本轮轮空，直接获得轮空积分</div></div></div>';
      h += '</div>';
      return h;
    }

    var dispA = (r.gamesA || 0) + advA;
    var dispB = (r.gamesB || 0) + advB;
    h += '<div class="match-body">';
    h += '<div class="side ' + (winA ? 'win' : '') + '">' +
      '<div class="pname">' + esc(na) + '</div>' +
      '<div class="prec">' + recHTML(CUR_LIVE[m.playerA], m.playerA) + '</div>' +
      '<div class="psub">' + esc(subOf(m.playerA)) + '</div>' +
      '</div>';
    h += '<div class="center-col"><div class="bigscore">' + dispA + ' : ' + dispB + '</div>' +
      '<div style="font-size:12px;font-weight:700">' + ((m.games || []).length) + ' 局已打' +
      ((m.gfAdv && (advA || advB)) ? '（含先计）' : '') + '</div></div>';
    h += '<div class="side ' + (winB ? 'win' : '') + '">' +
      '<div class="pname">' + esc(nb) + '</div>' +
      '<div class="prec">' + recHTML(CUR_LIVE[m.playerB], m.playerB) + '</div>' +
      '<div class="psub">' + esc(subOf(m.playerB)) + '</div>' +
      '</div>';
    h += '</div>';

    if ((m.games || []).length) {
      var g = '<div class="games" style="padding:6px 10px;border-top:1px dashed #000">';
      (m.games).forEach(function (game, i) {
        var s = game.w === 'A' ? ('A 胜 ' + na) : (game.w === 'B' ? ('B 胜 ' + nb) : '平局');
        if (typeof game.a === 'number' && typeof game.b === 'number') s += ' (' + game.a + ':' + game.b + ')';
        g += '<span class="gamechip">G' + (i + 1) + ' ' + esc(s) + '</span>';
      });
      g += '</div>';
      h += g;
    }

    var canAdd = E.canAddGame(m, fmt, stage.tie);
    if (!REND_RO) {                      // 旧阶段只读：不渲染任何录入控件
    h += '<div class="match-foot noprint">';
    h += tmRowHTML(m);

    /* ---- 快捷结算：直接填「几比几」，自动判胜负并按规则算分 ---- */
    if (sc.mode === 'points') {
      h += '<div class="quickrow"><span class="hint">当前为「按小分累加」计分，需逐局录入具体比分。</span></div>';
    } else {
      var W = Math.max(0, parseInt(fmt.winNeeded, 10) || 0);
      var N = Math.max(1, parseInt(fmt.gamesPerMatch, 10) || 1);
      var capA = W > 0 ? W : N, capB = capA;
      if (m.gfAdv) {
        var needG = W > 0 ? W : (Math.floor(N / 2) + 1);
        capA = needG - advA; capB = needG - advB;
      }
      var tip;
      if (sc.mode === 'result') tip = '胜 +' + sc.win + ' / 负 +' + sc.lose;
      else if (sc.mode === 'games') tip = '每赢 1 局 +' + sc.perGame;
      else if (sc.mode === 'scoreline') {
        var parts = [];
        E.scoreLines(fmt, stage.tie).forEach(function (L) {
          var rr = E.scoreRow(sc.scoreTable, L.key, L.draw, sc);
          parts.push(L.a + ':' + L.b + '→' + (L.draw ? ('各' + rr.d) : (rr.w + '/' + rr.l)));
        });
        tip = parts.join('　');
      }
      else tip = '按公式计算';
      var hasGames = (m.games || []).length > 0;
      h += '<div class="quickrow">' +
        '<span class="qlabel">直接填比分</span>' +
        '<input class="inline-num" type="number" min="0" max="' + capA + '" id="qa_' + m.id + '"' +
        ' value="' + (hasGames ? (r.gamesA || 0) : '') + '" placeholder="0">' +
        '<span class="qcolon">:</span>' +
        '<input class="inline-num" type="number" min="0" max="' + capB + '" id="qb_' + m.id + '"' +
        ' value="' + (hasGames ? (r.gamesB || 0) : '') + '" placeholder="0">' +
        '<button class="btn sm primary" data-act="applyScore" data-id="' + m.id + '">结算</button>' +
        '<span class="hint">填双方各赢几局（回车即结算）· ' + tip + '</span>' +
        '</div>';
    }

    h += '<div class="quickrow">';
    if (fmt.recordScore) {
      h += '<span style="font-size:13px;font-weight:700">比分 ' +
        '<input class="inline-num" type="number" id="sa_' + m.id + '" placeholder="A">' +
        ' : <input class="inline-num" type="number" id="sb_' + m.id + '" placeholder="B"></span>';
    }
    h += '<button class="btn sm" data-act="addGame" data-id="' + m.id + '" data-w="A"' + (canAdd ? '' : ' disabled') + '>' + esc(na) + ' 胜</button>';
    h += '<button class="btn sm" data-act="addGame" data-id="' + m.id + '" data-w="B"' + (canAdd ? '' : ' disabled') + '>' + esc(nb) + ' 胜</button>';
    h += '<button class="btn sm" data-act="addGame" data-id="' + m.id + '" data-w="D"' + (canAdd ? '' : ' disabled') + '>平局</button>';
    h += '<button class="btn sm" data-act="undoGame" data-id="' + m.id + '"' + ((m.games || []).length ? '' : ' disabled') + '>撤销上局</button>';
    if (isElimStage(stage) && m.decided && r.winner === null) {
      h += '<button class="btn sm" data-act="override" data-id="' + m.id + '" data-w="A">指定 ' + esc(na) + ' 晋级</button>';
      h += '<button class="btn sm" data-act="override" data-id="' + m.id + '" data-w="B">指定 ' + esc(nb) + ' 晋级</button>';
    }
    if (m.override) h += '<button class="btn sm" data-act="clearOverride" data-id="' + m.id + '">取消指定</button>';
    h += '</div>';   // quickrow（逐局按钮行）

    h += '</div>';   // match-foot
    }                // !REND_RO
    h += '</div>';   // match 卡片
    return h;
  }

  /* ---- 比赛卡片上的计时器一行：倒计时 + 开表 / 暂停 / 加时 / 归零 + 按未打完结算 ---- */
  function tmRowHTML(m) {
    var now = Date.now();
    var st = E.tmState(m, now);
    var limit = st.on ? st.limit : E.tmLimitSec(T);
    var h = '<div class="tmrow">';
    var txt = st.on ? U.clock(st.remain) : U.clock(limit);
    var cls = 'tmclock' + (st.running ? ' run' : '') +
      ((st.expired && !m.decided) ? ' expired' : '') + (st.on ? '' : ' off');
    h += '<span class="' + cls + '" data-tm="' + m.id + '">' + esc(txt) + '</span>';
    var tip = st.on
      ? (m.decided ? '已收场' : (st.running ? '计时中' : (st.expired ? '已到点' : '已暂停')))
      : ('限时 ' + U.clock(limit));
    if (st.on) tip += ' · 已用 ' + U.clock(st.elapsed);
    h += '<span class="hint">' + esc(tip) + '</span>';
    if (!m.decided) {
      if (!st.on) {
        h += '<button class="btn sm" data-act="tmStart" data-id="' + m.id + '">开始计时</button>';
      } else if (st.running) {
        h += '<button class="btn sm" data-act="tmPause" data-id="' + m.id + '">暂停</button>';
      } else {
        h += '<button class="btn sm" data-act="tmStart" data-id="' + m.id + '">继续</button>';
      }
      h += '<button class="btn sm" data-act="tmAdd" data-id="' + m.id + '" data-min="5">+5 分钟</button>' +
        '<button class="btn sm" data-act="tmReset" data-id="' + m.id + '">归零</button>' +
        '<button class="btn sm danger" data-act="tmSettle" data-id="' + m.id + '">按未打完结算</button>';
    } else if (m.result && m.result.unfinished) {
      h += '<button class="btn sm" data-act="tmUndoFinish" data-id="' + m.id + '">撤销未打完</button>';
    }
    h += '</div>';
    return h;
  }

  function rd_of_match(m) {
    var stage = REND_STAGE || T.stages[T.currentStage];
    for (var i = 0; i < stage.roundsData.length; i++) {
      if (stage.roundsData[i].matches.indexOf(m) >= 0) return stage.roundsData[i];
    }
    return null;
  }
  function rd_isGF(rd) { return !!(rd && rd.isGF); }

  function isElimStage(stage) {
    return stage.type === 'single_elim' || stage.type === 'double_elim' ||
      (stage.type === 'groups' && stage.groupType === 'single_elim');
  }

  function subOf(id) {
    var p = playerOf(id);
    var s = [];
    if (p.seed) s.push('种子 ' + p.seed);
    if (p.initialScore) s.push('初始分 ' + p.initialScore);
    return s.join(' · ') || '—';
  }

  function statusText(stage) {
    if (stage.status === 'finished') return '已结束';
    if (stage.status === 'running') return '进行中';
    return '未开始';
  }

  /* ================= 视图四：排名 ================= */
  function renderStanding() {
    if (!T) return '';
    if (!T.players.length) return '<div class="notice empty">暂无选手数据。</div>';

    var si = Math.min(stView.stageIndex, T.stages.length - 1);
    if (si < 0) si = 0;
    var stage = T.stages[si];
    if (!stage) return '';

    var gi = stView.groupIdx;
    if (stage.type !== 'groups') gi = null;

    var h = '';
    h += '<div class="row noprint" style="margin-bottom:12px">' +
      '<label>阶段：</label><select data-act2="stStage">' +
      T.stages.map(function (s, i) {
        return '<option value="' + i + '"' + (i === si ? ' selected' : '') + '>' + esc(s.name) + '</option>';
      }).join('') + '</select>';

    if (stage.type === 'groups' && stage.groups && stage.groups.length) {
      h += '<label>小组：</label><select data-act2="stGroup">' +
        '<option value="-1"' + (stView.groupIdx < 0 ? ' selected' : '') + '>全部（总排名）</option>' +
        stage.groups.map(function (g, i) {
          return '<option value="' + i + '"' + (stView.groupIdx === i ? ' selected' : '') + '>' + esc(g.name) + '</option>';
      }).join('') + '</select>';
    }
    h += '<button class="btn" data-act="printStanding">打印排名</button>';
    h += '</div>';

    /* ---- 对阵图：多个淘汰赛阶段可以合并成一张看完整路径 ---- */
    var elimIdx = E.elimStageIndexes(T);
    var mergedOn = (elimIdx.length > 1 && stView.bracketMerged !== false);
    var isElim = (stage.type === 'single_elim' || stage.type === 'double_elim');
    if (elimIdx.length > 1) {
      h += '<div class="row noprint" style="margin-bottom:10px">' +
        '<span class="hint" style="font-weight:800">对阵图：</span>' +
        '<button class="btn sm' + (mergedOn ? ' primary' : '') + '" data-act="bracketMode" data-mode="merged">' +
        '合并全部 ' + elimIdx.length + ' 个阶段</button>' +
        '<button class="btn sm' + (!mergedOn ? ' primary' : '') + '" data-act="bracketMode" data-mode="stage">只看所选阶段</button>' +
        '<button class="btn sm" data-act="printMerged">打印合并对阵图</button>' +
        '<button class="btn sm" data-act="pdfMerged">存 PDF</button>' +
        '</div>';
    }
    if (mergedOn) {
      h += mergedBracketHTML(T);
    } else if (isElim) {
      h += bracketHTML(T, si);
    }

    if (isElim) {
      h += card(esc(stage.name) + ' 名次（按对阵结果）', elimRankTable(T, si));
      return h;
    }

    // 提前晋级 / 提前淘汰：状态概览
    var ccfg = E.clinchCfg(stage);
    if (ccfg.enabled && (ccfg.winTarget || ccfg.lossTarget)) {
      var unit = (ccfg.basis === 'game') ? ' 局' : ' 场';
      var nCl = 0, nLate = 0;
      (stage.clinched || []).forEach(function (id) {
        if (E.isEarlyClinch(stage, id)) nCl++; else nLate++;
      });
      var nEl = (stage.eliminated || []).length;
      var nAlive = E.aliveInStage(T, stage).length;
      h += '<div class="notice" style="margin-bottom:12px">' +
        '<b>提前晋级 / 提前淘汰已启用</b>：' +
        (ccfg.winTarget ? ('达到 <b>' + ccfg.winTarget + unit + '</b> 即提前晋级') : '未设晋级线') + '；' +
        (ccfg.lossTarget ? ('达到 <b>' + ccfg.lossTarget + unit + '</b> 即提前淘汰') : '未设淘汰线') + '。' +
        '<br>当前：已提前晋级 <b>' + nCl + '</b> 人' +
        (nLate ? ('（另有 <b>' + nLate + '</b> 人末轮达标晋级）') : '') +
        ' · 已淘汰 <b>' + nEl + '</b> 人 · 仍待定 <b>' + nAlive + '</b> 人。' +
        ((ccfg.bonus || ccfg.bonusPerEarly)
          ? ('<br>提前晋级者进入下一阶段的加分：基础 +' + U.fmt(ccfg.bonus) +
            (ccfg.bonusPerEarly ? ('，每提前一轮再 +' + U.fmt(ccfg.bonusPerEarly)) : '') + '。')
          : '') +
        '<br><span class="hint">提前晋级者不再出场，但仍计入排名与对手分；对手后续赢分，他的对手分也会跟着上涨。</span>' +
        '</div>';
    }

    if (stage.type === 'groups' && stage.groups && stage.groups.length && gi === null) {
      stage.groups.forEach(function (g, i) {
        h += card(esc(g.name) + '（' + g.players.length + ' 人）', standingsTable(T, si, i));
      });
      h += card('总排名', standingsTable(T, si, null));
    } else {
      h += card(esc(stage.name) + ' 排名', standingsTable(T, si, gi));
    }

    return h;
  }

  /* ---------- 淘汰赛名次表（按对阵结果，而不是按积分） ---------- */
  function elimRankTable(t, si) {
    var stage = t.stages[si];
    var order = (stage.finalRank && stage.finalRank.length)
      ? stage.finalRank.slice()
      : E.computeElimRanking(t, stage);
    if (!order || !order.length) {
      return '<div class="notice empty">还没有可显示的名次，先在对阵页生成并完成比赛。</div>';
    }
    var finished = E.stageFinished(t, stage) || stage.status === 'finished';
    var st = E.standings(t, { stageIndex: si });
    var byId = {};
    st.forEach(function (s) { byId[s.id] = s; });
    // 只取前 N 人（没打到冠军）时，名次表要写「晋级 / 淘汰」，而不是「冠军 / 亚军」
    var cut = E.elimTarget(t, stage);
    var partial = (stage.type === 'single_elim' && cut > 1);

    var h = '';
    if (!finished && !partial) {
      h += '<div class="notice inv">本阶段尚未打完，下面是<strong>临时名次</strong>；'
        + '冠军 / 亚军等名次会在最后一场分出胜负后确定。</div>';
    }
    if (partial) {
      h += '<div class="notice">本阶段按人数晋级：前 <b>' + cut + '</b> 个名次进入下一阶段，'
        + '不设冠军。下表按淘汰的先后排列（越早出局越靠后）。</div>';
    }
    h += '<table class="compact"><thead><tr>' +
      '<th class="num">名次</th><th>选手</th><th class="num">场次</th>' +
      '<th class="num">胜</th><th class="num">负</th><th class="num">赢局-输局</th><th>结果</th>' +
      '</tr></thead><tbody>';
    order.forEach(function (id, i) {
      var s = byId[id] || { name: E.nameOf(t, id), matches: 0, wins: 0, losses: 0, gamesWon: 0, gamesLost: 0 };
      var label = '', cls = '';
      var hasThirdMatch = (stage.type === 'double_elim') || !!stage.thirdPlace;
      if (partial) {
        if (i < cut) { label = finished ? '晋级' : '晋级区'; cls = finished ? 'champ' : ''; }
        else label = '淘汰';
      } else if (i === 0) { label = finished ? '冠军' : '待定（争冠中）'; cls = finished ? 'champ' : ''; }
      else if (i === 1) { label = finished ? '亚军' : '待定（争冠中）'; cls = finished ? 'runner' : ''; }
      else if (i === 2 && order.length >= 4) {
        if (stage.type !== 'double_elim' && stage.thirdPlace && !finished) label = '待定（争季军）';
        else label = hasThirdMatch ? '季军' : '半决赛负者';
      }
      else if (i === 3 && order.length >= 4 && !hasThirdMatch) { label = '半决赛负者'; }
      else if (!s.active) { label = s.dropReason || '退赛'; }
      // 轮空在对阵图里不作为比赛出现，这里也把轮空从「场次 / 胜」里扣掉，
      // 否则会出现「只打了一场却显示 2 胜」
      var byeCnt = s.byes || 0;
      var playedN = Math.max(0, (s.matches || 0) - byeCnt);
      var winN = Math.max(0, (s.wins || 0) - byeCnt);
      h += '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' +
        '<td class="num"><b>' + (i + 1) + '</b></td>' +
        '<td><b>' + esc(s.name) + '</b></td>' +
        '<td class="num">' + playedN + '</td>' +
        '<td class="num">' + winN + '</td>' +
        '<td class="num">' + s.losses + '</td>' +
        '<td class="num">' + s.gamesWon + '-' + s.gamesLost + '</td>' +
        '<td>' + esc(label) + '</td>' +
        '</tr>';
    });
    h += '</tbody></table>';
    if (partial) {
      h += '<div class="hint">本阶段打满 ' + (stage.elimRounds || '?') + ' 轮后留下 ' + cut
        + ' 人，全部进入下一阶段；其余按被淘汰的轮次由后往前排列。</div>';
    } else {
      h += '<div class="hint">淘汰赛名次按对阵结果确定：决赛胜者为冠军，负者为亚军'
        + (stage.type === 'double_elim' ? '；败者组决赛负者为季军' : (stage.thirdPlace ? '；季军赛胜者为季军' : ''))
        + '，其余按被淘汰的轮次由后往前排列。</div>';
    }
    return h;
  }

  /* ---------- 淘汰赛对阵图 ---------- */
  /* ---------------- 对阵图（按「完整树」渲染，未定的格子写清来源） ---------------- */
  function slotHTML(s) {
    var cls = 'bslot' + (s.win ? ' win' : '') + (s.pending ? ' pend' : '') + (s.isBye ? ' bye' : '')
      + (s.dropped ? ' dropped' : '');
    var sc = '';
    var val = (s.score || 0) + (s.adv || 0);
    // 打过的比赛一定要显示比分（0 也要显示），没打的才留空
    if (s.id && s.shown) {
      sc = '<b>' + val + '</b>' + (s.adv ? '<i class="advtag">+先计' + s.adv + '</i>' : '');
    }
    var tag = s.dropped ? '<i class="dropflag">退赛</i>' : '';
    return '<div class="' + cls + '"><span>' + esc(s.text || '—') + tag + '</span>' + sc + '</div>';
  }

  function planCardHTML(cd) {
    var h = '<div class="bcard' + (cd.isBye ? ' bye' : '') + (cd.done ? ' done' : '')
      + (cd.voided ? ' voided' : '') + '">';
    h += '<div class="blab">' + esc(cd.title)
      + (cd.wo ? '<i class="wotag">' + esc(cd.wo) + '</i>' : '')
      + (cd.elev ? '<i class="elevtag">' + esc(cd.elev) + '</i>' : '') + '</div>';
    h += slotHTML(cd.a) + slotHTML(cd.b);
    h += '<div class="bpath">' +
      '<span class="pw">胜 → ' + esc(cd.winTo || '待定') + '</span>' +
      '<span class="pl">负 → ' + esc(cd.loseTo || '待定') + '</span>' +
      '</div>';
    h += '</div>';
    return h;
  }

  function bcolHTML(col, gridColumn, gridRow) {
    var h = '<div class="bcol" style="grid-column:' + gridColumn + ';grid-row:' + gridRow + '">' +
      '<div class="col-head"><b>' + esc(col.name) + '</b>' +
      (col.sub ? '<span>' + esc(col.sub) + '</span>' : '') + '</div>' +
      '<div class="col-body">';
    col.cards.forEach(function (cd) { h += planCardHTML(cd); });
    h += '</div></div>';
    return h;
  }

  /* 对阵图的「行」：单败 1 行；双败 2 行（胜者组 + 败者组，总决赛压在最右） */
  function planRowsHTML(plan, brief) {
    var total = Math.max(1, plan.totalCols || 1);
    var tpl = 'repeat(' + total + ', 200px)';
    var h = '';
    if (plan.type === 'double') {
      var rowW = plan.rows[0], rowL = plan.rows[1];
      var gf = rowW.gf || [];
      h += '<div class="bracket-sec"><div class="sec-name">胜者组'
        + (brief ? '' : '（赢一场留在上面，输一场掉下去）') + '</div>';
      h += '<div class="bgrow" style="grid-template-columns:' + tpl + '">';
      rowW.cols.forEach(function (col, ci) { h += bcolHTML(col, ci + 1, 1); });
      // 总决赛固定压在最右边，不单独放一行
      gf.forEach(function (col, gi) {
        h += bcolHTML(col, total - gf.length + gi + 1, 1);
      });
      h += '</div></div>';
      h += '<div class="bracket-sec"><div class="sec-name">败者组' + (brief ? '' : '（再输一场即淘汰）') + '</div>';
      h += '<div class="bgrow" style="grid-template-columns:' + tpl + '">';
      rowL.cols.forEach(function (col, ci) { h += bcolHTML(col, ci + 1, 2); });
      h += '</div></div>';
    } else {
      h += '<div class="bgrow" style="grid-template-columns:' + tpl + '">';
      plan.rows[0].cols.forEach(function (col, ci) { h += bcolHTML(col, ci + 1, 1); });
      h += '</div>';
    }
    return h;
  }

  /* 季军争夺战（只有单败、且本阶段打到冠军时才存在） */
  function thirdHTML(plan) {
    if (!plan.third) return '';
    return '<div class="bracket-sec"><div class="sec-name">季军争夺战</div>' +
      '<div class="bgrow" style="grid-template-columns:200px">' +
      '<div class="bcol"><div class="col-head"><b>3-4 名</b></div><div class="col-body">' +
      planCardHTML({
        key: 'third', title: '季军赛 第 1 场',
        a: { id: plan.third.playerA, text: plan.third.playerA ? nameOf(plan.third.playerA) : '半决赛负者' },
        b: { id: plan.third.playerB, text: plan.third.playerB ? nameOf(plan.third.playerB) : '半决赛负者' },
        winTo: '季军（第 3 名）', loseTo: '第 4 名', done: !!plan.third.decided
      }) +
      '</div></div></div></div>';
  }

  /* ---------- 合并对阵图：多个淘汰赛阶段横向接成一整条路径 ---------- */
  function mergedStageHTML(item, no, total, isLast) {
    var plan = item.plan;
    var h = '<div class="mstage">';
    h += '<div class="mhead">' +
      '<span class="mno">' + no + '</span>' +
      '<span class="mtt"><b>' + esc(item.name) + '</b>' +
      '<i>' + item.people + ' 人 · ' + (item.target > 1 ? ('取 ' + item.target + ' 人') : '打到冠军') +
      ' · ' + (item.finished ? '已结束' : (item.status === 'running' ? '进行中' : '未开始')) + '</i></span>' +
      '<button class="btn sm noprint" data-act="mergedFocus" data-i="' + item.si + '">只看本阶段</button>' +
      '</div>';
    h += planRowsHTML(plan, true);
    h += thirdHTML(plan);
    if (isLast && item.championName) {
      h += '<div class="mfoot mchamp">总冠军：<b>' + esc(item.championName) + '</b></div>';
    } else if (item.championName) {
      h += '<div class="mfoot">阶段冠军：<b>' + esc(item.championName) + '</b></div>';
    }
    h += '</div>';
    return h;
  }

  function mergedLinkHTML(item) {
    var names = item.advancedNames || [];
    var label = item.target > 1 ? ('晋级 ' + item.target + ' 人') : '冠军';
    var txt = names.length ? names.join(' · ') : (item.finished ? '—' : '待产生');
    return '<div class="mlink">' +
      '<div class="mtop">' + esc(label) + '</div>' +
      '<div class="mnames">' + esc(txt) + '</div>' +
      '<div class="marrow">▶</div>' +
      '</div>';
  }

  function mergedBracketHTML(t) {
    var mp = null;
    try { mp = E.mergedBracketPlan(t); } catch (e) { mp = null; }
    if (!mp || !mp.ok) {
      return card('合并对阵图', '<div class="notice empty">还没有任何淘汰赛阶段生成对阵。</div>');
    }
    var h = '<div class="bracket-wrap merged">';
    h += '<div class="mbar"><b>合并对阵图</b> · ' + esc(mp.note) +
      (mp.championName ? ' · <span class="mchamp">总冠军：' + esc(mp.championName) + '</span>' : '') +
      '</div>';
    h += '<div class="mflow">';
    mp.stages.forEach(function (item, i) {
      h += mergedStageHTML(item, i + 1, mp.stages.length, i === mp.stages.length - 1);
      if (i < mp.stages.length - 1) h += mergedLinkHTML(item);
    });
    h += '</div>';
    h += '<div class="hint">读法：从左往右是「阶段 1 → 阶段 2 → …」，同一阶段内按轮次向右推进；'
      + '两个阶段之间的竖条写着<b>这个阶段晋级了谁</b>，他们会出现在下一阶段的第 1 列。'
      + (mp.stages.length > 1 ? '想单独细看某个阶段，点该阶段标题右侧的「只看本阶段」。' : '')
      + '</div>';
    h += '</div>';
    return card('合并对阵图（' + mp.stages.length + ' 个淘汰赛阶段）', h);
  }

  function bracketHTML(t, si) {
    var stage = t.stages[si];
    var plan = null;
    try { plan = E.bracketPlan(t, stage); } catch (e) { plan = null; }
    if (!plan || !plan.rows || !plan.rows.length) {
      return card('对阵图', '<div class="notice empty">还没有生成对阵</div>');
    }
    var total = Math.max(1, plan.totalCols || 1);
    var h = '<div class="bracket-wrap">';
    if (plan.banner) h += '<div class="bplan-bar">' + plan.banner + '</div>';

    h += planRowsHTML(plan, false);
    h += thirdHTML(plan);
    h += '</div>';

    var mode = stage.gfMode || 'reset';
    var deHint = '';
    if (stage.type === 'double_elim') {
      if (mode === 'reset') {
        deHint = '总决赛为「加赛制」：败者组冠军要先赢下首场，再赢一场加赛才能夺冠。';
      } else if (mode === 'elevate') {
        var ecv = E.gfElevCfg(t, stage);
        deHint = '总决赛为「可升格决赛」：<b>只有一场</b>，比分累计不重置，先到 ' + ecv.base + ' 局者为胜；'
          + '若<b>败者组冠军</b>先到 ' + ecv.base + ' 局，则目标升为 ' + ecv.up + ' 局，'
          + '双方带着原比分继续打到 ' + ecv.up + ' 局；若<b>胜者组冠军</b>先到 ' + ecv.base
          + ' 局，则不升格，直接夺冠。';
      } else if (mode === 'none') {
        deHint = '总决赛为「无优势」：一场定胜负，谁赢谁夺冠。';
      } else {
        deHint = '总决赛为「让局」：' + ((stage.gfAdvSide === 'L') ? '败者组冠军' : '胜者组冠军') +
          ' 先计 ' + (stage.gfHandicap || 1) + ' 局。';
      }
    }
    h += '<div class="hint">读法：每一格都写清了<b>选手</b>或<b>来源</b>——'
      + '灰字斜体是还没打出来的格子，例如「第 1 轮 第 2 场胜者」「胜者组第 1 轮 第 3 场败者」「败者组第 2 轮 第 1 场胜者」。'
      + '卡片顶部是场次编号，底部两行是<b>晋级路径</b>：<span class="pw">胜 →</span> 下一场在哪，<span class="pl">负 →</span> 掉到哪（「淘汰」表示没有下一场）。'
      + (stage.type === 'double_elim' ? '双败的<b>总决赛在最右边</b>，与胜者组同一行。' + deHint : '')
      + '</div>';
    var titleFmt = fmtText(E.fmtOf(t, stage));
    if (stage.type === 'double_elim' && (stage.gfUseFormat || mode === 'elevate')) {
      titleFmt += ' · 总决赛 ' + fmtText(E.gfFmtOf(t, stage, false));
    }
    return card('对阵图（' + esc(titleFmt) + '）', h);
  }

  function standingsTable(t, si, gi) {
    var stage = t.stages[si];
    var st = E.standings(t, { stageIndex: si, groupIdx: (gi === null ? undefined : gi) });
    if (!st.length) return '<div class="notice empty">暂无排名数据</div>';

    var showCarry = !!(stage.inherit && stage.inherit.enabled);
    // 破同依据里用到了的项目才在表里显示，避免表格过宽
    var order = (E.scOf(t, stage).tieOrder || []);
    var showProg = order.indexOf('progressive') >= 0;
    var showPrev = order.indexOf('stagePoints') >= 0 && si > 0;
    var showCumDiff = order.indexOf('cumDiff') >= 0;
    var inhNote = '';
    if (showCarry && si > 0) {
      var rt = parseFloat(stage.inherit.ratio);
      if (!(rt >= 0)) rt = 0;
      // 小分继承静默生效，排名页不再提示（只说明积分继承比例）
      inhNote = '<div class="hint" style="margin-bottom:8px">本阶段已继承上一阶段<b>积分 ' + U.fmt(rt) + '%</b>。</div>';
    }
    var h = inhNote + '<table class="compact"><thead><tr>' +
      '<th class="num">名次</th><th>选手</th><th class="num">积分</th>' +
      (showCarry ? '<th class="num">继承分</th>' : '') +
      '<th class="num">场次</th><th class="num">胜</th><th class="num">平</th><th class="num">负</th>' +
      '<th class="num">赢局-输局</th><th class="num">净胜局</th>' +
      '<th class="num">累计小分</th>' +
      (showCumDiff ? '<th class="num">净小分</th>' : '') +
      (showProg ? '<th class="num">累进分</th>' : '') +
      (showPrev ? '<th class="num">上阶段分</th>' : '') +
      '<th class="num">对手分</th>' +
      '<th>状态</th>' +
      '<th class="noprint">手动调序</th>' +
      '</tr></thead><tbody>';

    st.forEach(function (s, idx) {
      var status = [];
      if (s.clinched) {
        var early = E.clinchEarlyBy(stage, s.id);
        var bo = E.clinchBonusOf(stage, s.id);
        if (early > 0) {
          status.push('提前晋级（提前 ' + early + ' 轮）' + (bo ? ' · 下阶段 +' + U.fmt(bo) : ''));
        } else {
          status.push('晋级（末轮达标）');
        }
      } else if (s.eliminated) {
        if (E.isEarlyElim(stage, s.id)) {
          status.push('提前淘汰（第 ' + (s.elimRound + 1) + ' 轮）');
        } else if (s.elimRound !== null && s.elimRound !== undefined) {
          status.push('淘汰（末轮出局）');
        } else {
          status.push('淘汰');
        }
      } else if ((stage.advanced || []).indexOf(s.id) >= 0) status.push('晋级');
      if (!s.active) status.push(s.dropReason || '退赛');
      h += '<tr class="' + (E.isEarlyClinch(stage, s.id) ? 'row-clinch'
        : (E.isEarlyElim(stage, s.id) ? 'row-elim' : '')) + '">' +
        '<td class="num' + (s.rank === 1 ? ' rank-1' : '') + '">' + s.rank + '</td>' +
        '<td><b>' + esc(s.name) + '</b></td>' +
        '<td class="num"><b>' + U.fmt(s.points) + '</b></td>' +
        (showCarry ? '<td class="num">' + U.fmt(s.carry) + '</td>' : '') +
        '<td class="num">' + s.matches + '</td>' +
        '<td class="num">' + s.wins + '</td>' +
        '<td class="num">' + s.draws + '</td>' +
        '<td class="num">' + s.losses + '</td>' +
        '<td class="num">' + s.gamesWon + '-' + s.gamesLost + '</td>' +
        '<td class="num">' + (s.gamesDiff > 0 ? '+' : '') + s.gamesDiff + '</td>' +
        '<td class="num">' + U.fmt(s.cumulative) + '</td>' +
        (showCumDiff ? '<td class="num">' + ((s.cumDiff > 0 ? '+' : '') + U.fmt(s.cumDiff)) + '</td>' : '') +
        (showProg ? '<td class="num">' + U.fmt(s.progressive) + '</td>' : '') +
        (showPrev ? '<td class="num">' + U.fmt(s.stagePoints) + '</td>' : '') +
        '<td class="num">' + U.fmt(s.buchholz) + '</td>' +
        '<td>' + esc(status.join(' / ')) + '</td>' +
        '<td class="noprint">' +
        '<button class="btn sm" data-act="moveUp" data-stage="' + si + '" data-id="' + s.id + '"' + (idx === 0 ? ' disabled' : '') + '>上</button>' +
        '<button class="btn sm" data-act="moveDown" data-stage="' + si + '" data-id="' + s.id + '"' + (idx === st.length - 1 ? ' disabled' : '') + '>下</button>' +
        '</td>' +
        '</tr>';
    });
    h += '</tbody></table>';
    return h;
  }

  /* ================= 视图五：导出 ================= */
  function renderExport() {
    if (!T) return '';
    var si = Math.min(exSel.stage, T.stages.length - 1);
    if (si < 0) si = 0;
    var stage = T.stages[si];
    if (!stage) return '';
    var rounds = stage.roundsData || [];
    var groupIdx = (stage.type === 'groups' && stage.groups && exSel.group >= 0) ? exSel.group : -1;
    var roundIdx = exSel.round;

    var h = '';
    h += card('导出范围',
      '<div class="row">' +
      '<label>阶段</label><select data-act2="exStage">' +
      T.stages.map(function (s, i) {
        return '<option value="' + i + '"' + (i === si ? ' selected' : '') + '>' + esc(s.name) + '（' + esc(typeName(s.type)) + '）</option>';
      }).join('') + '</select>' +
      '<label>轮次</label><select data-act2="exRound">' +
      '<option value="-1"' + (roundIdx < 0 ? ' selected' : '') + '>全部轮次</option>' +
      rounds.map(function (rd) {
        return '<option value="' + rd.index + '"' + (rd.index === roundIdx ? ' selected' : '') + '>' +
          esc(X.roundLabel(rd.index)) + (rd.isGF ? '（总决赛）' : '') + '</option>';
      }).join('') + '</select>' +
      (stage.type === 'groups' && stage.groups && stage.groups.length
        ? '<label>小组</label><select data-act2="exGroup">' +
        '<option value="-1"' + (groupIdx < 0 ? ' selected' : '') + '>全部小组</option>' +
        stage.groups.map(function (g, i) {
          return '<option value="' + i + '"' + (groupIdx === i ? ' selected' : '') + '>' + esc(g.name) + '</option>';
        }).join('') + '</select>' : '') +
      '</div>' +
      '<div class="hint" style="margin-top:6px">当前选择：<b>' + esc(X.scopeLabel(T, { stageIndex: si, groupIdx: groupIdx < 0 ? undefined : groupIdx })) +
      (roundIdx < 0 ? ' · 全部轮次' : ' · ' + esc(X.roundLabel(roundIdx))) + '</b>' +
      '（共 ' + rounds.length + ' 轮）</div>'
    );

    var natKind = U.nativeKind();
    var natTip = (natKind === 'electron')
      ? '桌面版点导出会弹出系统「另存为」，可以自己选保存位置（默认在「文档」）。'
      : (natKind === 'android'
        ? '手机版点导出会弹出系统「保存到」，可以选手机里的任意文件夹（下载 / 文档 / 网盘）。'
        : '浏览器里会直接下载到默认下载目录。');

    h += card('对阵',
      '<div class="hint" style="margin-bottom:10px">导出所选阶段的某一轮或全部轮次对阵。CSV 可直接用 Excel / WPS 打开，含大比分、逐局与胜者。</div>' +
      '<div class="row">' +
      '<button class="btn lg" data-act="printSelRound">打印所选对阵</button>' +
      '<button class="btn lg" data-act="pdfSelRound">导出对阵 PDF</button>' +
      '<button class="btn lg primary" data-act="csvSelRound">导出对阵 CSV</button>' +
      '</div>'
    );

    h += card('排名',
      '<div class="hint" style="margin-bottom:10px">轮次选择「全部轮次」= 当前最新排名；选择某一轮 = 该轮结束后的排名快照（不含之后的比赛）。</div>' +
      '<div class="row">' +
      '<button class="btn lg" data-act="printSelStanding">打印所选排名</button>' +
      '<button class="btn lg" data-act="pdfSelStanding">导出排名 PDF</button>' +
      '<button class="btn lg primary" data-act="csvSelStanding">导出排名 CSV</button>' +
      '</div>'
    );

    h += card('整站报告与存档',
      '<div class="row">' +
      '<button class="btn" data-act="printFull">打印最终完整报告（全阶段）</button>' +
      '<button class="btn" data-act="pdfFull">导出完整报告 PDF</button>' +
      '<button class="btn" data-act="csvAllRounds">导出全部阶段对阵 CSV</button>' +
      '<button class="btn" data-act="saveJSON">导出 JSON 存档</button>' +
      '<button class="btn" data-act="loadT">导入 JSON 存档</button>' +
      '</div>' +
      '<div class="hint" style="margin-top:6px">' + esc(natTip) +
      ' 打印时也可以在系统对话框里选「另存为 PDF」。</div>'
    );

    h += card('选手名单',
      '<div class="row"><button class="btn" data-act="exportNames">导出选手名单 (txt)</button>' +
      '<button class="btn" data-act="bulkImportFile">从文件导入选手 (txt/csv)</button></div>'
    );

    return h;
  }

  /* ================= 主渲染 ================= */
  function render() {
    TMS.current = T;

    var sub = document.getElementById('topbarSub');
    if (sub) {
      if (!T) {
        sub.textContent = '未打开赛事';
      } else {
        var stg = T.stages[T.currentStage];
        sub.textContent = T.name + ' · ' + T.players.length + ' 名选手 · ' +
          T.stages.length + ' 个阶段' + (stg ? ' · 当前：' + stg.name + '（' + statusText(stg) + '）' : '');
      }
    }

    if (!T) curView = 'list';

    document.querySelectorAll('.tab').forEach(function (t) {
      var v = t.getAttribute('data-view');
      var disabled = (!T && v !== 'list');
      t.disabled = disabled;
      t.classList.toggle('active', v === curView);
    });
    document.querySelectorAll('.view').forEach(function (v) { v.style.display = 'none'; });

    var map = {
      list: renderList,
      setup: renderSetup, players: renderPlayers, matches: renderMatches,
      standing: renderStanding, export: renderExport
    };
    var el = document.getElementById('view-' + curView);
    if (el) { el.style.display = ''; el.innerHTML = map[curView](); }
  }

  /* ================= 交互 ================= */
  function findMatch(id) {
    var stage = T.stages[T.currentStage], out = null;
    (stage.roundsData || []).forEach(function (rd) {
      (rd.matches || []).forEach(function (m) { if (m.id === id) out = m; });
    });
    return out;
  }

  var acts = {
    /* ---- 赛事列表 ---- */
    newT: function () {
      var el = document.getElementById('newTName');
      var name = (el && el.value.trim()) || '我的赛事';
      T = M.createTournament(name);
      S.put(T);
      TMS.current = T;
      editStage = 0; stView = { stageIndex: 0, groupIdx: -1, bracketMerged: true }; showHistory = false; arrangeOn = false; viewRound = -1; viewStageIdx = -1; exSel = { stage: 0, round: -1, group: -1 };
      curView = 'setup'; render();
      toast('已新建赛事：' + name);
    },
    openT: function (el) {
      var id = el.getAttribute('data-id');
      var t = S.get(id);
      if (!t) { toast('读取赛事失败', true); return; }
      T = t; S.setCurrentId(id); TMS.current = T;
      editStage = 0; stView = { stageIndex: T.currentStage || 0, groupIdx: -1, bracketMerged: true }; showHistory = false; arrangeOn = false; viewRound = -1; viewStageIdx = -1; exSel = { stage: T.currentStage || 0, round: -1, group: -1 };
      curView = 'setup'; render();
    },
    dupT: function (el) {
      var id = el.getAttribute('data-id');
      var src = S.get(id);
      if (!src) return;
      var t = U.clone(src);
      t.id = U.uid('t');
      t.name = src.name + ' 副本';
      t.status = 'setup';
      t.currentStage = 0;
      t.history = [];
      t.stages.forEach(function (s, i) {
        s.id = U.uid('st'); s.index = i; s.status = 'pending';
        s.roundsData = []; s.eliminated = []; s.advanced = []; s.groups = null; s.de = null; s.participants = [];
      });
      S.put(t);
      render();
      toast('已复制赛事');
    },
    exportT: function (el) {
      var t = S.get(el.getAttribute('data-id'));
      if (!t) return;
      X.exportJSON(t, t.name + '_存档.json', function (r) {
        if (!r || r.canceled) return;
        toast(r.msg || (r.ok ? '存档已导出' : '导出失败'), r.ok === false);
      });
    },
    delT: function (el) {
      var id = el.getAttribute('data-id');
      var idx = S.loadIndex();
      var meta = idx.filter(function (x) { return x.id === id; })[0];
      ask('删除赛事', '确定删除赛事「' + (meta ? meta.name : id) + '」？该赛事的全部对阵与成绩将无法恢复。',
        function (yes) {
          if (!yes) return;
          S.remove(id);
          if (T && T.id === id) { T = null; TMS.current = null; }
          curView = 'list'; render();
          toast('已删除赛事');
        }, '删除');
    },
    goList: function () { curView = 'list'; render(); },

    /* ---- 存档 ---- */
    saveT: function () { save(); toast('已保存到本机'); },
    loadT: function () { pendingFileAction = 'json'; document.getElementById('fileInput').click(); },

    /* ---- 选手 ---- */
    bulkImport: function () {
      var ta = document.getElementById('bulkNames');
      if (!ta) return;
      var names = U.parseNames(ta.value);
      if (!names.length) { toast('未识别到任何姓名', true); return; }
      mutate(function () {
        var added = 0;
        names.forEach(function (n) {
          if (!T.players.some(function (p) { return p.name === n; })) {
            T.players.push(M.createPlayer(n, T.players.length + 1));
            added++;
          }
        });
        return { ok: true, msg: '导入完成：新增 ' + added + ' 人，跳过重名 ' + (names.length - added) + ' 人' };
      });
      var ta2 = document.getElementById('bulkNames');
      if (ta2) ta2.value = '';
    },
    bulkImportFile: function () { pendingFileAction = 'names'; document.getElementById('fileInput').click(); },
    exportNames: function () {
      X.exportPlayerList(T, function (r) {
        if (!r || r.canceled) return;
        toast(r.msg || (r.ok ? '名单已导出' : '导出失败'), r.ok === false);
      });
    },
    autoSeed: function () {
      mutate(function () {
        T.players.forEach(function (p, i) { p.seed = i + 1; });
        return { ok: true, msg: '已按当前顺序为 ' + T.players.length + ' 名选手编写种子号' };
      });
    },
    clearPlayers: function () {
      ask('清空选手', '确定清空全部选手？将同时清除已生成的对阵与成绩。', function (yes) {
        if (!yes) return;
        mutate(function () {
          T.players = [];
          T.stages.forEach(function (s) {
            s.participants = []; s.roundsData = []; s.status = 'pending';
            s.eliminated = []; s.advanced = []; s.groups = null; s.de = null;
          });
          T.currentStage = 0; T.status = 'setup'; T.history = [];
          return { ok: true, msg: '已清空选手列表' };
        });
      }, '清空');
    },
    addPlayer: function () {
      askInput('添加选手', '', function (n) {
        if (n === null || !n.trim()) return;
        mutate(function () {
          T.players.push(M.createPlayer(n.trim(), T.players.length + 1));
          return { ok: true, msg: '已添加：' + n.trim() };
        });
      }, '输入姓名后回车', '添加');
    },
    delPlayer: function (el) {
      var id = el.getAttribute('data-id');
      var p = playerOf(id);
      if (!p.name) return;
      ask('删除选手', '确定删除选手「' + p.name + '」？', function (yes) {
        if (!yes) return;
        mutate(function () {
          T.players = T.players.filter(function (x) { return x.id !== id; });
          return { ok: true, msg: '已删除：' + p.name };
        });
      }, '删除');
    },
    dropPlayer: function (el) {
      var id = el.getAttribute('data-id');
      var p = playerOf(id);
      if (!p.name) return;
      // 页内输入框（不用 window.prompt：打包环境下原生弹窗不一定出现，点了会像没反应）
      askInput('标记退赛：' + p.name, '退赛', function (r) {
        if (r === null) return;
        mutate(function () {
          var q = playerOf(id);
          if (q.id) { q.active = false; q.dropReason = r.trim() || '退赛'; }
          var extra = dropFollowUp();
          return { ok: true, msg: '已标记退赛：' + (q.name || '') + extra + '（可在「恢复」中撤回）' };
        });
      }, '退赛原因（可留空，直接回车即可）', '标记退赛');
    },
    dqPlayer: function (el) {
      var id = el.getAttribute('data-id');
      var p = playerOf(id);
      if (!p.name) return;
      ask('取消资格', '确定取消「' + p.name + '」的比赛资格（DQ）？已完成的成绩会保留。', function (yes) {
        if (!yes) return;
        mutate(function () {
          var q = playerOf(id);
          if (q.id) { q.active = false; q.dropReason = '取消资格'; }
          var extra = dropFollowUp();
          return { ok: true, msg: '已取消资格：' + (q.name || '') + extra };
        });
      }, '取消资格');
    },
    restorePlayer: function (el) {
      var id = el.getAttribute('data-id');
      mutate(function () {
        var p = playerOf(id);
        if (p.id) { p.active = true; p.dropReason = ''; }
        return { ok: true, msg: '已恢复参赛：' + (p.name || '') };
      });
    },

    /* ---- 对阵 ---- */
    genRound: function () {
      viewRound = -1; viewStageIdx = -1;      // 生成新一轮后回到最新一轮
      var stage = T.stages[T.currentStage];
      if (stage && stage.type === 'swiss' && (stage.pairMode || 'auto') === 'manual') {
        arrangeOn = true;
        if (!draft || draft.stageIndex !== T.currentStage) draft = null;
        render();
        toast('本阶段按「手动编排」配对：点两名选手组成一桌，配好后点「确认本轮对阵」', true);
        return;
      }
      mutate(function () { return E.generateRound(T); });
    },
    finishRound: function () {
      viewRound = -1;
      mutate(function () { return E.finishRound(T); });
    },
    finishStage: function () {
      viewRound = -1; viewStageIdx = -1;
      var stage = T.stages[T.currentStage];
      if (stage) {
        var rd = stage.roundsData[stage.roundsData.length - 1];
        if (rd && !E.roundComplete(T, stage, rd).ok) {
          ask('结束本阶段', '本轮仍有未完成的比赛，确定强制结束本阶段吗？', function (yes) {
            if (yes) mutate(function () { return E.finishStage(T); });
          }, '强制结束');
          return;
        }
      }
      mutate(function () { return E.finishStage(T); });
    },
    rollback: function () {
      var r = E.rollback(T);
      save();
      viewRound = -1; viewStageIdx = -1;
      if (r.msg) toast(r.msg, r.ok === false);
      render();
    },
    /* ---- 计时器：每场限时 · 到点自动结算未打完的比赛 ---- */
    tmStart: function (el) {
      var m = findMatch(el.getAttribute('data-id'));
      if (!m) { toast('未找到该场比赛', true); return; }
      E.tmStart(m, E.tmLimitSec(T), Date.now());
      save(); render();
    },
    tmPause: function (el) {
      var m = findMatch(el.getAttribute('data-id'));
      if (!m) { toast('未找到该场比赛', true); return; }
      E.tmPause(m, Date.now());
      save(); render();
    },
    tmAdd: function (el) {
      var m = findMatch(el.getAttribute('data-id'));
      if (!m) { toast('未找到该场比赛', true); return; }
      var min = parseFloat(el.getAttribute('data-min')) || 5;
      if (!m.tm) E.tmStart(m, E.tmLimitSec(T), Date.now());
      m.tm.limit = (parseFloat(m.tm.limit) || 0) + min * 60;
      save(); render();
      toast('已加时 ' + U.fmt(min) + ' 分钟');
    },
    tmReset: function (el) {
      var m = findMatch(el.getAttribute('data-id'));
      if (!m) { toast('未找到该场比赛', true); return; }
      E.tmReset(m, E.tmLimitSec(T));
      save(); render();
    },
    tmStartAll: function () {
      var stage = T.stages[T.currentStage];
      var rd = stage && stage.roundsData[stage.roundsData.length - 1];
      if (!rd) { toast('还没有可计时的轮次', true); return; }
      var n = 0, lim = E.tmLimitSec(T);
      (rd.matches || []).forEach(function (m) {
        if (m.isBye || m.decided) return;
        if (E.tmState(m, Date.now()).running) return;
        E.tmStart(m, lim, Date.now());
        n++;
      });
      save(); render();
      toast(n ? ('本轮 ' + n + ' 场已开始计时') : '本轮没有可计时的比赛');
    },
    tmPauseAll: function () {
      var stage = T.stages[T.currentStage];
      var rd = stage && stage.roundsData[stage.roundsData.length - 1];
      if (!rd) return;
      var n = 0;
      (rd.matches || []).forEach(function (m) {
        if (m.tm && m.tm.startedAt) { E.tmPause(m, Date.now()); n++; }
      });
      save(); render();
      toast(n ? ('已暂停 ' + n + ' 场计时') : '没有正在计时的比赛');
    },
    tmSettle: function (el) {
      var id = el.getAttribute('data-id');
      mutate(function () {
        var m = findMatch(id);
        if (!m) return { ok: false, msg: '未找到该场比赛' };
        var stage = T.stages[T.currentStage];
        var r = E.settleUnfinished(T, stage, m, { reason: 'manual', now: Date.now() });
        if (!r.ok) return r;
        var wn = (r.winner === 'A') ? nameOf(m.playerA) : ((r.winner === 'B') ? nameOf(m.playerB) : '平局');
        return { ok: true, msg: '已按未打完结算：' + r.a + ' : ' + r.b + '　' + (r.winner ? wn + ' 胜' : '双方平局') };
      });
    },
    tmUndoFinish: function (el) {
      var id = el.getAttribute('data-id');
      mutate(function () {
        var m = findMatch(id);
        if (!m) return { ok: false, msg: '未找到该场比赛' };
        if (!m.result || !m.result.unfinished) return { ok: false, msg: '这不是「未打完」的成绩' };
        m.result = null;
        m.decided = false;
        m.overtime = false;
        if (m.tm) { m.tm.over = false; m.tm.startedAt = null; }
        var stage = T.stages[T.currentStage];
        E.evaluate(m, E.fmtOfMatch(T, stage, m), stage.tie);
        return { ok: true, msg: '已撤销未打完结算，可以继续录入比分' };
      });
    },
    /* 快捷结算：直接填「几比几」，自动判胜负并按记分规则算分 */
    applyScore: function (el) {
      var id = el.getAttribute('data-id');
      mutate(function () {
        var m = findMatch(id);
        if (!m) return { ok: false, msg: '未找到该场比赛' };
        var stage = T.stages[T.currentStage];
        var fmt = E.fmtOfMatch(T, stage, m), sc = E.scOf(T, stage);
        var ia = document.getElementById('qa_' + m.id);
        var ib = document.getElementById('qb_' + m.id);
        var a = parseInt(ia ? ia.value : '', 10);
        var b = parseInt(ib ? ib.value : '', 10);

        if (isNaN(a) || isNaN(b)) return { ok: false, msg: '请填写双方各赢了几局' };
        if (a < 0 || b < 0) return { ok: false, msg: '局数不能为负数' };

        var N = Math.max(1, parseInt(fmt.gamesPerMatch, 10) || 1);
        var W = Math.max(0, parseInt(fmt.winNeeded, 10) || 0);
        var capA = W > 0 ? W : N, capB = capA, isAdv = false;
        if (m.gfAdv) {
          isAdv = true;
          var needG = W > 0 ? W : (Math.floor(N / 2) + 1);
          var advA = (m.gfAdv.side === 'A') ? m.gfAdv.games : 0;
          var advB = (m.gfAdv.side === 'B') ? m.gfAdv.games : 0;
          capA = needG - advA; capB = needG - advB;
        }

        if (a + b === 0) return { ok: false, msg: '比分不能是 0 : 0，至少打一局' };
        if (a > capA || b > capB) {
          return { ok: false, msg: '单方赢局上限：' + nameOf(m.playerA) + ' ' + capA + ' 局、' + nameOf(m.playerB) + ' ' + capB + ' 局' };
        }
        if (isAdv) {
          if (a + b > capA + capB - 1) return { ok: false, msg: '本场最多 ' + (capA + capB - 1) + ' 局' };
        } else {
          if (a + b > N) return { ok: false, msg: '比分合计 ' + (a + b) + ' 局，超过本场局数上限（' + N + ' 局）' };
          if (W === 0 && a + b !== N) {
            return { ok: false, msg: '本场设为打满 ' + N + ' 局，比分合计应为 ' + N };
          }
        }

        // 按 A、B 交错重建局面（只记胜负，不记每局小分）
        m.games = [];
        var maxn = Math.max(a, b), k;
        for (k = 0; k < maxn; k++) {
          if (k < a) m.games.push({ w: 'A', a: null, b: null });
          if (k < b) m.games.push({ w: 'B', a: null, b: null });
        }
        m.override = null;
        E.evaluate(m, fmt, stage.tie);

        if (m.overtime) {
          return { ok: true, msg: '比分为 ' + a + ' : ' + b + '，属平局，按规则需加赛决胜' };
        }
        if (!m.decided) {
          return { ok: true, msg: '已记录 ' + a + ' : ' + b + '，比赛尚未打完' };
        }
        var wn = m.result && m.result.winner === 'A' ? nameOf(m.playerA)
          : (m.result && m.result.winner === 'B' ? nameOf(m.playerB) : '平局');
        var pts = '';
        if (sc.mode === 'result') {
          pts = '（胜 +' + sc.win + ' / 负 +' + sc.lose + '）';
        } else if (sc.mode === 'games') {
          pts = '（每赢 1 局 +' + sc.perGame + '）';
        }
        var scoreTxt = a + ' : ' + b;
        if (m.gfAdv) {
          scoreTxt = (a + (m.gfAdv.side === 'A' ? m.gfAdv.games : 0)) + ' : ' +
            (b + (m.gfAdv.side === 'B' ? m.gfAdv.games : 0)) + '（含先计 ' + m.gfAdv.games + ' 局）';
        }
        return { ok: true, msg: '已记录 ' + scoreTxt + '　' + wn + ' 胜' + pts };
      });
    },
    addGame: function (el) {
      var id = el.getAttribute('data-id'), w = el.getAttribute('data-w');
      mutate(function () {
        var m = findMatch(id);
        if (!m) return { ok: false, msg: '未找到该场比赛' };
        var stage = T.stages[T.currentStage];
        var fmt = E.fmtOfMatch(T, stage, m);
        if (!E.canAddGame(m, fmt, stage.tie)) return { ok: false, msg: '本场已结束，无法继续录入' };
        var g = { w: w, a: null, b: null };
        if (fmt.recordScore) {
          var ia = document.getElementById('sa_' + m.id), ib = document.getElementById('sb_' + m.id);
          if (ia && ia.value !== '') g.a = parseFloat(ia.value);
          if (ib && ib.value !== '') g.b = parseFloat(ib.value);
        }
        m.games.push(g);
        E.evaluate(m, fmt, stage.tie);
        return { ok: true };
      });
    },
    undoGame: function (el) {
      var id = el.getAttribute('data-id');
      mutate(function () {
        var m = findMatch(id);
        if (!m || !(m.games || []).length) return { ok: false, msg: '没有可撤销的局' };
        m.games.pop();
        m.override = null;
        var stage = T.stages[T.currentStage];
        E.evaluate(m, E.fmtOfMatch(T, stage, m), stage.tie);
        return { ok: true };
      });
    },
    override: function (el) {
      var id = el.getAttribute('data-id'), w = el.getAttribute('data-w');
      mutate(function () {
        var m = findMatch(id);
        if (!m) return { ok: false, msg: '未找到该场比赛' };
        var stage = T.stages[T.currentStage];
        m.override = w;
        E.evaluate(m, E.fmtOfMatch(T, stage, m), stage.tie);
        return { ok: true, msg: '已手动指定晋级者' };
      });
    },
    clearOverride: function (el) {
      var id = el.getAttribute('data-id');
      mutate(function () {
        var m = findMatch(id);
        if (!m) return { ok: false, msg: '未找到该场比赛' };
        var stage = T.stages[T.currentStage];
        m.override = null;
        E.evaluate(m, E.fmtOfMatch(T, stage, m), stage.tie);
        return { ok: true, msg: '已取消手动指定' };
      });
    },
    toggleHistory: function () { showHistory = !showHistory; render(); },

    /* ---- 对阵页导航：随时切到之前任何一轮 / 已结束的旧阶段 ---- */
    pickRound: function (el) {
      var i = parseInt(el.getAttribute('data-i'), 10);
      var stage = T.stages[(viewStageIdx >= 0 && viewStageIdx < T.stages.length) ? viewStageIdx : T.currentStage];
      if (!stage || !(i >= 0) || i >= stage.roundsData.length) return;
      viewRound = i;
      render();
      window.scrollTo(0, 0);
      var rd = stage.roundsData[i];
      if (i !== stage.roundsData.length - 1) {
        toast('已切换到第 ' + (rd.index + 1) + ' 轮（可直接补录 / 改判）');
      }
    },
    latestRound: function () {
      viewRound = -1;
      render();
    },
    pickStage: function (el) {
      var i = parseInt(el.getAttribute('data-i'), 10);
      if (!(i >= 0) || i >= T.stages.length) return;
      if (!((T.stages[i].roundsData || []).length)) { toast('该阶段还没有生成对阵', true); return; }
      viewStageIdx = (i === T.currentStage) ? -1 : i;
      viewRound = -1;
      arrangeOn = false; draft = null;
      render();
      window.scrollTo(0, 0);
    },
    latestStage: function () {
      viewStageIdx = -1;
      viewRound = -1;
      render();
    },
    /* 跳到排名页看合并对阵图 */
    gotoMerged: function () {
      curView = 'standing';
      stView.stageIndex = T.currentStage;
      stView.bracketMerged = true;
      render();
      window.scrollTo(0, 0);
    },
    bracketMode: function (el) {
      stView.bracketMerged = (el.getAttribute('data-mode') === 'merged');
      render();
    },
    /* 合并图里点「只看本阶段」：换到该阶段的单张对阵图 */
    mergedFocus: function (el) {
      var i = parseInt(el.getAttribute('data-i'), 10);
      if (!(i >= 0) || i >= T.stages.length) return;
      stView.stageIndex = i;
      stView.groupIdx = -1;
      stView.bracketMerged = false;
      render();
      window.scrollTo(0, 0);
    },
    toggleArrange: function () {
      arrangeOn = !arrangeOn;
      if (!arrangeOn) draft = null;
      render();
    },
    /* ---- 手动编排（点选式） ---- */
    dPick: function (el) {
      var id = el.getAttribute('data-id');
      var stage = T.stages[T.currentStage];
      var can = E.canManualArrange(T, stage);
      if (!can.ok) { toast(can.msg, true); return; }
      var d = ensureDraft(stage, can);
      var pi = -1;
      d.pairs.forEach(function (p, i) { if (p[0] === id || p[1] === id) pi = i; });
      if (pi >= 0) { d.pairs.splice(pi, 1); d.sel = []; render(); return; }
      var si = d.sel.indexOf(id);
      if (si >= 0) { d.sel.splice(si, 1); render(); return; }
      if (d.bye === id) d.bye = null;
      d.sel.push(id);
      if (d.sel.length >= 2) {
        d.pairs.push([d.sel[0], d.sel[1]]);
        d.sel = [];
      }
      render();
    },
    dBreak: function (el) {
      var i = parseInt(el.getAttribute('data-i'), 10);
      if (draft && draft.pairs[i]) { draft.pairs.splice(i, 1); draft.sel = []; render(); }
    },
    dBye: function (el) {
      if (!draft) return;
      var id = el.getAttribute('data-id') || '';
      draft.bye = id || null;
      if (id) draft.sel = draft.sel.filter(function (x) { return x !== id; });
      render();
    },
    dClear: function () {
      if (draft) { draft.pairs = []; draft.bye = null; draft.sel = []; }
      render();
    },
    dRandom: function () {
      var stage = T.stages[T.currentStage];
      var can = E.canManualArrange(T, stage);
      if (!can.ok) { toast(can.msg, true); return; }
      var d = ensureDraft(stage, can);
      var ids = U.shuffle(E.manualPool(T, stage), U.makeRng(U.randomSeed()));
      var pairs = [], i;
      for (i = 0; i + 1 < ids.length; i += 2) pairs.push([ids[i], ids[i + 1]]);
      var played = E.playedSet(T, stage, null);
      d.pairs = E.avoidRepeatPairs(pairs, played);
      d.bye = (ids.length % 2 === 1) ? ids[ids.length - 1] : null;
      d.sel = [];
      render();
      toast('已随机配对 ' + d.pairs.length + ' 桌，可继续手动调整后确认');
    },
    dAuto: function () {
      var stage = T.stages[T.currentStage];
      var can = E.canManualArrange(T, stage);
      if (!can.ok) { toast(can.msg, true); return; }
      var d = ensureDraft(stage, can);
      var stats = E.buildStats(T, stage, stage.participants || [], null);
      var pool = E.manualPool(T, stage).slice().sort(function (a, b) {
        var pa = stats[a] ? stats[a].points : 0, pb = stats[b] ? stats[b].points : 0;
        if (pb !== pa) return pb - pa;
        return (playerOf(a).seed || 9999) - (playerOf(b).seed || 9999);
      });
      var bye = null;
      if (pool.length % 2 === 1) {
        var entries = pool.map(function (id) {
          var p = playerOf(id);
          return { id: id, hasBye: !!p.hasBye };
        });
        bye = E.pickBye(entries, T.byeRule, stage.roundsData.length, U.makeRng(U.randomSeed()));
        pool = pool.filter(function (x) { return x !== bye; });
      }
      var pairs = [], i;
      for (i = 0; i + 1 < pool.length; i += 2) pairs.push([pool[i], pool[i + 1]]);
      d.pairs = E.avoidRepeatPairs(pairs, E.playedSet(T, stage, null));
      d.bye = bye;
      d.sel = [];
      render();
      toast('已按积分配对 ' + d.pairs.length + ' 桌，可继续手动调整后确认');
    },
    dConfirm: function () {
      var stage = T.stages[T.currentStage];
      var can = E.canManualArrange(T, stage);
      if (!can.ok) { toast(can.msg, true); return; }
      var d = ensureDraft(stage, can);
      var pairs = d.pairs.slice(), bye = d.bye;
      var r = mutate(function () {
        return E.commitManualRound(T, T.currentStage, pairs, bye, { replace: can.replace });
      });
      if (r && r.ok) { draft = null; arrangeOn = false; render(); }
    },
    redrawDraw: function () {
      var stage = T.stages[T.currentStage];
      if (!stage) return;
      var go = function () { mutate(function () { return E.redrawStage(T); }); };
      ask('重新抽签', '将按当前编排方式（' + E.drawLabel(stage) + '）重新抽一次首轮对阵，' +
        '已经录入的成绩不会被清掉（首轮开打后无法重抽）。确定吗？', function (yes) { if (yes) go(); }, '重新抽签');
    },
    randomRound: function () { mutate(function () { return E.randomizeRound(T); }); },
    addTable: function () { mutate(function () { return E.addMatchToRound(T); }); },
    delTable: function (el) {
      mutate(function () { return E.removeMatchFromRound(T, el.getAttribute('data-id')); });
    },
    toggleGroups: function () { groupOpen = !groupOpen; render(); },
    redrawGroups: function (el) {
      var mode = el.getAttribute('data-mode') || 'snake';
      mutate(function () {
        var stage = T.stages[T.currentStage];
        if ((stage.roundsData || []).length) return { ok: false, msg: '已开始比赛，无法重新分组' };
        E.ensureParticipants(T);
        if (!(stage.participants || []).length) return { ok: false, msg: '尚无参赛选手' };
        stage.groupMethod = mode;
        stage.groups = null;
        stage.groups = E.buildGroups(T, stage, true);
        groupOpen = true;
        return { ok: true, msg: mode === 'random' ? '已随机抽签分组' : '已按蛇形分组' };
      });
    },

    /* ---- 排名 ---- */
    moveUp: function (el) {
      var si = parseInt(el.getAttribute('data-stage'), 10), id = el.getAttribute('data-id');
      mutate(function () {
        var stage = T.stages[si];
        if (!stage.manualOrder) stage.manualOrder = {};
        var order = stage.manualOrder;
        if (T.scoring.tieOrder.indexOf('manual') < 0) T.scoring.tieOrder.push('manual');
        E.standings(T, { stageIndex: si }).forEach(function (s, i) {
          if (order[s.id] === undefined) order[s.id] = i;
        });
        order[id] = order[id] - 1.5;
        return { ok: true, msg: '已上移（手动序优先）' };
      });
    },
    moveDown: function (el) {
      var si = parseInt(el.getAttribute('data-stage'), 10), id = el.getAttribute('data-id');
      mutate(function () {
        var stage = T.stages[si];
        if (!stage.manualOrder) stage.manualOrder = {};
        var order = stage.manualOrder;
        if (T.scoring.tieOrder.indexOf('manual') < 0) T.scoring.tieOrder.push('manual');
        E.standings(T, { stageIndex: si }).forEach(function (s, i) {
          if (order[s.id] === undefined) order[s.id] = i;
        });
        order[id] = order[id] + 1.5;
        return { ok: true, msg: '已下移' };
      });
    },

    /* ---- 阶段编辑 ---- */
    gotoStage: function (el) { editStage = parseInt(el.getAttribute('data-i'), 10); render(); },
    addStage: function () {
      mutate(function () {
        var s = M.defaultStage(T.stages.length);
        s.rounds = 3;
        T.stages.push(s);
        editStage = T.stages.length - 1;
        return { ok: true, msg: '已添加阶段' };
      });
    },
    copyStage: function () {
      mutate(function () {
        var src = T.stages[editStage];
        var s = U.clone(src);
        s.id = U.uid('st');
        s.index = T.stages.length;
        s.name = src.name + ' 副本';
        s.status = 'pending'; s.roundsData = []; s.eliminated = []; s.advanced = [];
        s.groups = null; s.de = null; s.participants = [];
        T.stages.push(s);
        editStage = T.stages.length - 1;
        return { ok: true, msg: '已复制阶段' };
      });
    },
    delStage: function () {
      if (T.stages.length <= 1) { toast('至少需要一个阶段', true); return; }
      ask('删除阶段', '确定删除阶段「' + T.stages[editStage].name + '」？', function (yes) {
        if (!yes) return;
        mutate(function () {
          T.stages.splice(editStage, 1);
          T.stages.forEach(function (s, i) { s.index = i; });
          if (T.currentStage >= T.stages.length) T.currentStage = T.stages.length - 1;
          editStage = Math.min(editStage, T.stages.length - 1);
          return { ok: true, msg: '已删除阶段' };
        });
      }, '删除');
    },
    tieUp: function (el) {
      mutate(function () {
        var i = parseInt(el.getAttribute('data-i'), 10);
        if (i <= 0) return { ok: false };
        var o = T.scoring.tieOrder;
        var t = o[i]; o[i] = o[i - 1]; o[i - 1] = t;
        return { ok: true };
      });
    },
    tieDown: function (el) {
      mutate(function () {
        var i = parseInt(el.getAttribute('data-i'), 10);
        var o = T.scoring.tieOrder;
        if (i >= o.length - 1) return { ok: false };
        var t = o[i]; o[i] = o[i + 1]; o[i + 1] = t;
        return { ok: true };
      });
    },
    tieRemove: function (el) {
      mutate(function () {
        var i = parseInt(el.getAttribute('data-i'), 10);
        var o = T.scoring.tieOrder;
        if (i < 0 || i >= o.length) return { ok: false };
        var nm = getNameOfTie(o[i]);
        o.splice(i, 1);
        return { ok: true, msg: '已停用依据：' + nm };
      });
    },
    tieAdd: function () {
      var selEl = document.getElementById('tieAddSel');
      if (!selEl || !selEl.value) return;
      var key = selEl.value;
      mutate(function () {
        var o = T.scoring.tieOrder;
        if (o.indexOf(key) >= 0) return { ok: false };
        o.push(key);
        return { ok: true, msg: '已添加依据：' + getNameOfTie(key) };
      });
    },
    saveSetup: function () { save(); toast('设置已保存'); }
  };

  /* 导出动作 */
  function extendActs() {
    function exDone(r) {
      if (!r || r.canceled) return;
      toast(r.msg || (r.ok ? '导出完成' : '导出失败'), r.ok === false);
    }
    acts.printRound = function () {
      // 打印「当前正在看的那一轮」：回看历史轮次时打印历史轮次，而不是最新一轮
      var si = (viewStageIdx >= 0 && viewStageIdx < T.stages.length) ? viewStageIdx : T.currentStage;
      var stage = T.stages[si];
      if (!stage || !stage.roundsData.length) { toast('尚未生成对阵', true); return; }
      var k = (viewRound >= 0 && viewRound < stage.roundsData.length) ? viewRound : stage.roundsData.length - 1;
      X.printHTML(X.matchupsHTML(T, {
        stageIndex: si,
        roundIndex: stage.roundsData[k].index
      }), exDone);
    };
    /* 合并对阵图：多个淘汰赛阶段合成一份，可打印 / 存 PDF */
    acts.printMerged = function () {
      if (!E.elimStageIndexes(T).length) { toast('本赛事还没有淘汰赛阶段的对阵', true); return; }
      X.printHTML(X.mergedBracketHTML(T), exDone);
    };
    acts.pdfMerged = function () {
      if (!E.elimStageIndexes(T).length) { toast('本赛事还没有淘汰赛阶段的对阵', true); return; }
      X.savePDF(X.mergedBracketHTML(T), T.name + '_淘汰赛合并对阵图.pdf', exDone);
    };
    acts.printAll = function () {
      X.printHTML(X.matchupsHTML(T, { stageIndex: T.currentStage }), exDone);
    };
    acts.printStanding = function () {
      var si = Math.min(stView.stageIndex, T.stages.length - 1);
      X.printHTML(X.standingsHTML(T, {
        stageIndex: si,
        groupIdx: (stView.groupIdx >= 0 ? stView.groupIdx : undefined)
      }), exDone);
    };
    // 整站完整报告正文（打印 / PDF 共用）
    function fullReportHTML() {
      var h = '';
      h += '<h1 style="font-size:22px;margin:0 0 4px">' + esc(T.name) + '</h1>';
      h += '<div style="font-size:12px;margin-bottom:10px">生成时间：' + esc(U.now()) + '</div>';
      for (var i = 0; i < T.stages.length; i++) {
        h += X.standingsHTML(T, { stageIndex: i });
        h += X.matchupsHTML(T, { stageIndex: i });
      }
      return h;
    }
    acts.printFull = function () { X.printHTML(fullReportHTML(), exDone); };
    acts.printFinal = acts.printFull;
    acts.pdfFull = function () {
      X.savePDF(fullReportHTML(), T.name + '_完整报告.pdf', exDone);
    };
    acts.saveJSON = function () {
      X.exportJSON(T, T.name + '_存档.json', exDone);
    };

    /* ---- 细粒度导出：按所选阶段 / 轮次 / 小组 ---- */
    function exOpts() {
      var si = Math.min(exSel.stage, T.stages.length - 1);
      var st = T.stages[si];
      var o = { stageIndex: si };
      if (exSel.round >= 0) o.roundIndex = exSel.round;
      if (st && st.type === 'groups' && exSel.group >= 0) o.groupIdx = exSel.group;
      return o;
    }
    function exFileTag() {
      var si = Math.min(exSel.stage, T.stages.length - 1);
      var st = T.stages[si];
      var tag = (st ? st.name : '阶段') + (exSel.round >= 0 ? ('第' + (exSel.round + 1) + '轮') : '全部轮次');
      if (st && st.type === 'groups' && exSel.group >= 0 && st.groups) tag += st.groups[exSel.group].name;
      return T.name + '_' + tag;
    }
    function exUpTo() {
      return exSel.round >= 0 ? exSel.round : null;
    }

    function exDone(r) {
      if (!r) return;
      if (r.canceled) return;
      toast(r.msg || (r.ok ? '导出完成' : '导出失败'), r.ok === false);
    }

    acts.printSelRound = function () {
      var si = Math.min(exSel.stage, T.stages.length - 1);
      var st = T.stages[si];
      if (!st || !st.roundsData.length) { toast('该阶段尚未生成对阵', true); return; }
      X.printHTML(X.matchupsHTML(T, exOpts()), exDone);
    };
    acts.pdfSelRound = function () {
      var si = Math.min(exSel.stage, T.stages.length - 1);
      var st = T.stages[si];
      if (!st || !st.roundsData.length) { toast('该阶段尚未生成对阵', true); return; }
      X.savePDF(X.matchupsHTML(T, exOpts()), exFileTag() + '_对阵.pdf', exDone);
    };
    acts.csvSelRound = function () {
      var si = Math.min(exSel.stage, T.stages.length - 1);
      var st = T.stages[si];
      if (!st || !st.roundsData.length) { toast('该阶段尚未生成对阵', true); return; }
      X.downloadCSV(exFileTag() + '_对阵.csv', X.matchupsCSV(T, exOpts()), exDone);
    };
    acts.printSelStanding = function () {
      X.printHTML(X.standingsHTML(T, {
        stageIndex: Math.min(exSel.stage, T.stages.length - 1),
        groupIdx: (exSel.group >= 0 ? exSel.group : undefined),
        upToRound: exUpTo()
      }), exDone);
    };
    acts.pdfSelStanding = function () {
      X.savePDF(X.standingsHTML(T, {
        stageIndex: Math.min(exSel.stage, T.stages.length - 1),
        groupIdx: (exSel.group >= 0 ? exSel.group : undefined),
        upToRound: exUpTo()
      }), exFileTag() + '_排名.pdf', exDone);
    };
    acts.csvSelStanding = function () {
      X.downloadCSV(exFileTag() + '_排名' + (exSel.round >= 0 ? '（截至第' + (exSel.round + 1) + '轮）' : '') + '.csv',
        X.standingsCSV(T, {
          stageIndex: Math.min(exSel.stage, T.stages.length - 1),
          groupIdx: (exSel.group >= 0 ? exSel.group : undefined),
          upToRound: exUpTo()
        }), exDone);
    };
    acts.csvAllRounds = function () {
      var parts = [];
      for (var i = 0; i < T.stages.length; i++) {
        var csv = X.matchupsCSV(T, { stageIndex: i }).replace(/^\ufeff/, '');
        var rows = csv.split('\r\n');
        parts.push(i === 0 ? rows.join('\r\n') : rows.slice(1).join('\r\n'));
      }
      X.downloadCSV(T.name + '_全阶段对阵.csv', '\ufeff' + parts.join('\r\n'), exDone);
    };
  }

  function bindGlobal() {
    document.addEventListener('click', function (e) {
      var tab = e.target.closest('.tab');
      if (tab) {
        if (tab.disabled) return;
        curView = tab.getAttribute('data-view');
        render();
        window.scrollTo(0, 0);
        return;
      }
      var el = e.target.closest('[data-act]');
      if (!el) return;
      var a = el.getAttribute('data-act');
      if (acts[a]) { e.preventDefault(); acts[a](el, e); }
    });

    document.getElementById('btnNew').addEventListener('click', function () { acts.newT(); });    document.getElementById('btnSave').addEventListener('click', function () { acts.saveT(); });
    document.getElementById('btnLoad').addEventListener('click', function () { acts.loadT(); });
    document.getElementById('btnList').addEventListener('click', function () { acts.goList(); });

    // 比分输入框按回车直接结算
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var id = e.target && e.target.id;
      if (!id) return;
      var mid = null;
      if (id.indexOf('qa_') === 0 || id.indexOf('qb_') === 0) mid = id.slice(3);
      if (mid) {
        var btn = document.querySelector('[data-act="applyScore"][data-id="' + mid + '"]');
        if (btn) { e.preventDefault(); btn.click(); }
      }
    });

    document.addEventListener('change', function (e) {
      var el = e.target.closest('[data-bind]');
      if (el) {
        var path = el.getAttribute('data-bind'), v;
        if (el.type === 'checkbox') v = el.checked;
        else if (el.type === 'number') v = parseFloat(el.value) || 0;
        else v = el.value;
        setPath(T, path, v);
        var mst = /^stages\[(\d+)\]/.exec(path);
        if (mst) afterStageEdit(T.stages[parseInt(mst[1], 10)], path);
        save();
        render();
        return;
      }
      var el4 = e.target.closest('[data-pair]');
      if (el4) {
        var pmid = el4.getAttribute('data-pair'), pslot = el4.getAttribute('data-slot');
        mutate(function () { return E.setMatchSlot(T, pmid, pslot, el4.value); });
        return;
      }
      var el5 = e.target.closest('[data-member]');
      if (el5) {
        var memberId = el5.getAttribute('data-member');
        mutate(function () {
          var stage = T.stages[T.currentStage];
          var r = E.moveToGroup(T, stage, memberId, el5.value);
          if (r.ok) stage.groupMethod = 'manual';
          return r;
        });
        return;
      }
      var el2 = e.target.closest('[data-player]');
      if (el2) {
        var pid = el2.getAttribute('data-player'), f = el2.getAttribute('data-field');
        var p = playerOf(pid);
        if (p.id) {
          p[f] = (f === 'seed' || f === 'initialScore') ? (parseFloat(el2.value) || 0) : el2.value;
          save(); render();
        }
        return;
      }
      var el3 = e.target.closest('[data-act2]');
      if (el3) {
        var k = el3.getAttribute('data-act2');
        if (k === 'stStage') { stView.stageIndex = parseInt(el3.value, 10); stView.groupIdx = -1; render(); }
        if (k === 'stGroup') { stView.groupIdx = parseInt(el3.value, 10); render(); }
        if (k === 'exStage') { exSel.stage = parseInt(el3.value, 10); exSel.round = -1; exSel.group = -1; render(); }
        if (k === 'exRound') { exSel.round = parseInt(el3.value, 10); render(); }
        if (k === 'exGroup') { exSel.group = parseInt(el3.value, 10); render(); }
      }
    });

    /* ---- 计时器心跳：每秒刷新倒计时显示；到点自动结算未打完的比赛 ---- */
    function tmFind(id) {
      if (!T || !T.stages) return null;
      for (var si = 0; si < T.stages.length; si++) {
        var rds = T.stages[si].roundsData || [];
        for (var r = 0; r < rds.length; r++) {
          var ms = rds[r].matches || [];
          for (var k = 0; k < ms.length; k++) if (ms[k].id === id) return ms[k];
        }
      }
      return null;
    }
    function tmTickUI() {
      if (!T || !T.stages) return;
      var now = Date.now();
      var els = document.querySelectorAll('[data-tm]');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var m = tmFind(el.getAttribute('data-tm'));
        if (!m) continue;
        var st = E.tmState(m, now);
        if (!st.on) continue;
        el.textContent = U.clock(st.remain);
        el.className = 'tmclock' + (st.running ? ' run' : '') +
          ((st.expired && !m.decided) ? ' expired' : '');
      }
      var done = E.tmTick(T, now);
      if (done.length) {
        save();
        render();
        toast('计时器到点，已自动结算 ' + done.length + ' 场未打完的比赛');
      }
    }
    setInterval(tmTickUI, 1000);

    // 关闭 / 刷新页面时把正在走的表暂停，免得离线这段时间被算成比赛时长
    window.addEventListener('beforeunload', function () {
      if (!T || !T.stages) return;
      var now = Date.now(), n = 0;
      T.stages.forEach(function (st) {
        (st.roundsData || []).forEach(function (rd) {
          (rd.matches || []).forEach(function (m) {
            if (m && m.tm && m.tm.startedAt) { E.tmPause(m, now); n++; }
          });
        });
      });
      // 只有在确实停了表时才写盘，避免无谓地覆盖存档
      if (n > 0) save();
    });

    document.getElementById('fileInput').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      if (pendingFileAction === 'json') {
        X.readJSONFile(file, function (err, obj) {
          if (err) { toast('存档解析失败：' + err.message, true); return; }
          if (!obj || !obj.players) { toast('这不是有效的赛事存档', true); return; }
          T = S.normalize(obj);
          S.put(T);
          TMS.current = T;
          editStage = 0; stView = { stageIndex: T.currentStage || 0, groupIdx: -1, bracketMerged: true }; arrangeOn = false; viewRound = -1; viewStageIdx = -1;
          curView = 'setup'; render();
          toast('已载入存档：' + T.name);
        });
      } else if (pendingFileAction === 'names') {
        var fr = new FileReader();
        fr.onload = function () {
          var names = U.parseNames(fr.result);
          if (!names.length) { toast('文件中未识别到姓名', true); return; }
          mutate(function () {
            var added = 0;
            names.forEach(function (n) {
              if (!T.players.some(function (p) { return p.name === n; })) {
                T.players.push(M.createPlayer(n, T.players.length + 1));
                added++;
              }
            });
            return { ok: true, msg: '从文件导入：新增 ' + added + ' 人' };
          });
        };
        fr.readAsText(file, 'utf-8');
      }
      e.target.value = '';
    });
  }

  /* ================= 启动 ================= */
  function boot() {
    S.migrateLegacy();
    T = S.load();          // 从当前 id 或索引首个载入
    if (T) {
      S.setCurrentId(T.id);
      curView = 'setup';
      exSel = { stage: T.currentStage || 0, round: -1, group: -1 };
    } else {
      curView = 'list';
    }
    TMS.current = T;
    extendActs();
    bindGlobal();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window);
