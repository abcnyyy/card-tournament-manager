/* ============================================================
   exporter.js —— 导出对阵 / 排名（打印·PDF·CSV）与 JSON 存档
   支持细化到「某一轮的对阵」与「某轮过后的排名快照」
   ============================================================ */
(function (global) {
  'use strict';
  var TMS = global.TMS;
  var U = TMS.util, E = TMS.engine;
  var X = TMS.exporter = {};

  function stageLabel(t, si) {
    var s = t.stages[si];
    return (s && s.name) ? s.name : ('第 ' + (si + 1) + ' 阶段');
  }

  function typeName(key) {
    for (var i = 0; i < TMS.const.STAGE_TYPES.length; i++) {
      if (TMS.const.STAGE_TYPES[i].key === key) return TMS.const.STAGE_TYPES[i].name;
    }
    return key;
  }

  X.roundLabel = function (roundIndex) {
    return '第 ' + (roundIndex + 1) + ' 轮';
  };

  X.scopeLabel = function (t, opts) {
    opts = opts || {};
    var si = (opts.stageIndex === undefined) ? t.currentStage : opts.stageIndex;
    var s = t.stages[si];
    var out = stageLabel(t, si);
    if (s && s.type === 'groups' && opts.groupIdx !== undefined && opts.groupIdx !== null && s.groups) {
      out += ' · ' + s.groups[opts.groupIdx].name;
    }
    return out;
  };

  /* ============ 排名表 HTML ============ */
  X.standingsHTML = function (t, opts) {
    opts = opts || {};
    var si = (opts.stageIndex === undefined) ? t.currentStage : opts.stageIndex;
    var stage = t.stages[si];
    if (!stage) return '<p>无阶段数据</p>';

    var gi = (opts.groupIdx === undefined) ? null : opts.groupIdx;
    var upTo = (opts.upToRound === undefined || opts.upToRound === null) ? null : opts.upToRound;
    var st = E.standings(t, { stageIndex: si, groupIdx: gi, upToRound: upTo });
    var advIds = (stage.advanced || []);
    var elimIds = (stage.eliminated || []);
    var clIds = (stage.clinched || []);
    var sc = E.scOf(t, stage);

    var h = '<h2 style="margin:0 0 8px;font-size:20px">' + U.esc(t.name) + ' · ' +
      U.esc(X.scopeLabel(t, opts)) + (upTo === null ? '' : ' · 截至第 ' + (upTo + 1) + ' 轮') +
      ' 排名</h2>';
    h += '<div style="font-size:13px;margin-bottom:8px">赛制：' + U.esc(typeName(stage.type)) +
      ' · 计分：' + U.esc(scoreName(sc)) +
      ' · 生成时间：' + U.esc(U.now()) + '</div>';
    h += '<table class="compact"><thead><tr>' +
      '<th class="num">名次</th><th>选手</th><th class="num">积分</th>' +
      (stage.inherit && stage.inherit.enabled ? '<th class="num">继承分</th>' : '') +
      '<th class="num">场次</th><th class="num">胜</th><th class="num">平</th><th class="num">负</th>' +
      '<th class="num">赢局-输局</th><th class="num">净胜局</th>' +
      '<th class="num">累计小分</th><th class="num">对手分</th><th>状态</th>' +
      '</tr></thead><tbody>';

    st.forEach(function (s) {
      var status = [];
      if (clIds.indexOf(s.id) >= 0) {
        var bo = E.clinchBonusOf(stage, s.id);
        if (E.isEarlyClinch(stage, s.id)) {
          status.push('提前晋级' + (bo ? '（下阶段 +' + U.fmt(bo) + '）' : ''));
        } else {
          status.push('晋级（末轮达标）');
        }
      } else if (elimIds.indexOf(s.id) >= 0) {
        status.push(E.isEarlyElim(stage, s.id) ? '提前淘汰' : '淘汰');
      }
      else if (advIds.indexOf(s.id) >= 0) status.push('晋级');
      if (!s.active) status.push(s.dropReason || '退赛');
      h += '<tr>' +
        '<td class="num">' + s.rank + '</td>' +
        '<td>' + U.esc(s.name) + '</td>' +
        '<td class="num"><b>' + U.fmt(s.points) + '</b></td>' +
        (stage.inherit && stage.inherit.enabled ? '<td class="num">' + U.fmt(s.carry) + '</td>' : '') +
        '<td class="num">' + s.matches + '</td>' +
        '<td class="num">' + s.wins + '</td>' +
        '<td class="num">' + s.draws + '</td>' +
        '<td class="num">' + s.losses + '</td>' +
        '<td class="num">' + s.gamesWon + '-' + s.gamesLost + '</td>' +
        '<td class="num">' + (s.gamesDiff > 0 ? '+' : '') + s.gamesDiff + '</td>' +
        '<td class="num">' + U.fmt(s.cumulative) + '</td>' +
        '<td class="num">' + U.fmt(s.buchholz) + '</td>' +
        '<td>' + U.esc(status.join(' / ')) + '</td>' +
        '</tr>';
    });
    h += '</tbody></table>';
    return h;
  };

  function scoreName(sc) {
    var short = { result: '胜负平积分', games: '赢局计分', points: '小分累加', formula: '自定义公式' };
    return short[sc.mode] || sc.mode;
  }

  /* ============ 对阵表 HTML ============ */
  X.matchupsHTML = function (t, opts) {
    opts = opts || {};
    var si = (opts.stageIndex === undefined) ? t.currentStage : opts.stageIndex;
    var stage = t.stages[si];
    if (!stage) return '<p>无阶段数据</p>';
    var onlyRound = (opts.roundIndex === undefined || opts.roundIndex === null) ? null : opts.roundIndex;
    var onlyGroup = (opts.groupIdx === undefined) ? null : opts.groupIdx;

    var h = '';
    if (!opts.noTitle) {
      h += '<h2 style="margin:0 0 8px;font-size:20px">' + U.esc(t.name) + ' · ' +
        U.esc(X.scopeLabel(t, opts)) + ' 对阵表' +
        (onlyRound === null ? '' : ' · ' + X.roundLabel(onlyRound)) + '</h2>';
      h += '<div style="font-size:13px;margin-bottom:8px">赛制：' + U.esc(typeName(stage.type)) +
        ' · 生成时间：' + U.esc(U.now()) + '</div>';
    }

    (stage.roundsData || []).forEach(function (rd) {
      if (onlyRound !== null && rd.index !== onlyRound) return;
      var grouped = {};
      var order = [];
      (rd.matches || []).forEach(function (m) {
        if (m.__empty) return;
        if (onlyGroup !== null && onlyGroup !== undefined && m.group !== onlyGroup) return;
        var k = (m.group === null || m.group === undefined) ? '_' : String(m.group);
        if (!grouped[k]) { grouped[k] = []; order.push(k); }
        grouped[k].push(m);
      });
      if (!order.length) return;
      h += '<h3 style="margin:12px 0 6px;font-size:17px">' + X.roundLabel(rd.index) +
        (rd.isGF ? (rd.gfReset ? '（总决赛 · 加赛局）' : '（总决赛）') : '') + '</h3>';
      order.forEach(function (k) {
        if (k !== '_' && stage.groups) {
          h += '<div style="font-weight:800;margin:6px 0 3px">' + U.esc(stage.groups[parseInt(k, 10)].name) + '</div>';
        } else if (rd.isGF) {
          h += X._tableFor(t, grouped[k], rd.gfReset ? '总决赛 · 加赛局' : '总决赛');
          return;
        } else if (stage.type === 'double_elim') {
          var w = grouped[k].filter(function (m) { return m.bracket === 'W'; });
          var l = grouped[k].filter(function (m) { return m.bracket === 'L'; });
          if (w.length) h += X._tableFor(t, w, '胜者组');
          if (l.length) h += X._tableFor(t, l, '败者组');
          return;
        }
        h += X._tableFor(t, grouped[k], '');
      });
    });
    if (!(stage.roundsData || []).length) h += '<p>尚未生成对阵</p>';
    return h;
  };

  X._tableFor = function (t, ms, label) {
    var h = '';
    if (label) h += '<div style="font-weight:800;margin:6px 0 3px">' + U.esc(label) + '</div>';
    h += '<table class="compact"><thead><tr>' +
      '<th class="num">桌号</th><th>选手 A</th><th class="num">大比分</th><th>选手 B</th>' +
      '<th>逐局</th><th>状态</th></tr></thead><tbody>';
    ms.forEach(function (m, i) {
      var na = E.nameOf(t, m.playerA);
      var nb = E.nameOf(t, m.playerB);
      var big = '—';
      if (m.result) {
        var advA = m.result.advA || 0, advB = m.result.advB || 0;
        big = (m.result.gamesA + advA) + ' : ' + (m.result.gamesB + advB);
        if (advA || advB) big += '（含先计 ' + (advA || advB) + ' 局）';
      }
      var games = (m.games || []).map(function (g, gi) {
        var s = (g.w === 'A') ? 'A' : (g.w === 'B') ? 'B' : 'D';
        if (typeof g.a === 'number' && typeof g.b === 'number') s += '(' + g.a + ':' + g.b + ')';
        return 'G' + (gi + 1) + ' ' + s;
      }).join('，');
      var st;
      if (m.isBye) st = '轮空';
      else if (m.decided) st = (m.result.winner ? '胜：' + ((m.result.winner === 'A') ? na : nb) : '平局');
      else if (m.overtime) st = '加赛中';
      else st = '未开始';
      if (m.result && m.result.unfinished) {
        st += (m.result.endReason === 'timeout') ? '（计时器到点 · 未打完）' : '（未打完）';
      }
      h += '<tr><td class="num">' + (i + 1) + '</td><td>' + U.esc(na) + '</td>' +
        '<td class="num"><b>' + U.esc(big) + '</b></td><td>' + U.esc(nb) + '</td>' +
        '<td>' + U.esc(games || '—') + '</td><td>' + U.esc(st) + '</td></tr>';
    });
    h += '</tbody></table>';
    return h;
  };

  /* ============ 合并对阵图（多个淘汰赛阶段合成一份，打印 / PDF 用） ============ */
  X.mergedBracketHTML = function (t) {
    var mp = E.mergedBracketPlan(t);
    var h = '<h1 style="font-size:22px;margin:0 0 4px">' + U.esc(t.name) + ' · 淘汰赛合并对阵图</h1>';
    h += '<div style="font-size:12px;margin-bottom:10px">' + U.esc(mp.note || '') +
      '　生成时间：' + U.esc(U.now()) + '</div>';
    if (!mp.ok) return h + '<p>还没有任何淘汰赛阶段生成对阵。</p>';

    mp.stages.forEach(function (it, i) {
      var nxt = mp.stages[i + 1] || null;
      h += '<h2 style="margin:16px 0 6px;font-size:19px">' + (i + 1) + '. ' + U.esc(it.name) +
        '（' + it.people + ' 人 · ' + (it.target > 1 ? ('取 ' + it.target + ' 人') : '打到冠军') +
        ' · ' + (it.finished ? '已结束' : (it.status === 'running' ? '进行中' : '未开始')) + '）</h2>';
      h += X.matchupsHTML(t, { stageIndex: it.si, noTitle: true });
      var link;
      if (nxt) {
        link = '本阶段晋级 ' + (it.advancedNames.length || it.target) + ' 人进入「' + nxt.name +
          '」：' + (it.advancedNames.join('、') || '待产生');
      } else {
        link = '本阶段为最后一个淘汰赛阶段' +
          (it.championName ? ('，冠军：' + it.championName) : '（尚未产生冠军）');
      }
      h += '<div style="border:2px solid #000;padding:6px 10px;margin:8px 0;font-weight:800;font-size:13px">' +
        U.esc(link) + '</div>';
    });

    if (mp.championName) {
      h += '<div style="border:3px solid #000;padding:10px;margin-top:14px;text-align:center;font-size:18px;font-weight:800">' +
        '总冠军：' + U.esc(mp.championName) + '</div>';
    }
    return h;
  };

  /* ============ CSV ============ */
  function cell(v) {
    var s = (v === undefined || v === null) ? '' : String(v);
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  X.toCSV = function (rows) {
    return '\ufeff' + rows.map(function (r) {
      return r.map(cell).join(',');
    }).join('\r\n');
  };

  // 对阵 CSV（可按阶段 / 轮次 / 小组筛选）
  X.matchupsCSV = function (t, opts) {
    opts = opts || {};
    var si = (opts.stageIndex === undefined) ? t.currentStage : opts.stageIndex;
    var stage = t.stages[si];
    if (!stage) return X.toCSV([['无阶段数据']]);
    var onlyRound = (opts.roundIndex === undefined || opts.roundIndex === null) ? null : opts.roundIndex;
    var onlyGroup = (opts.groupIdx === undefined) ? null : opts.groupIdx;

    var rows = [['阶段', '赛制', '轮次', '小组', '桌号', '选手A', '选手B', '大比分', '逐局', '状态', '胜者']];
    (stage.roundsData || []).forEach(function (rd) {
      if (onlyRound !== null && rd.index !== onlyRound) return;
      (rd.matches || []).forEach(function (m, i) {
        if (m.__empty) return;
        if (onlyGroup !== null && onlyGroup !== undefined && m.group !== onlyGroup) return;
        var na = E.nameOf(t, m.playerA), nb = E.nameOf(t, m.playerB);
        var games = (m.games || []).map(function (g, gi) {
          return 'G' + (gi + 1) + ((g.w === 'A') ? 'A' : (g.w === 'B') ? 'B' : 'D');
        }).join(' ');
        var win = '';
        if (m.isBye) win = na || nb;
        else if (m.decided && m.result) {
          win = m.result.winner === 'A' ? na : (m.result.winner === 'B' ? nb : '平局');
        }
        var stTxt = m.isBye ? '轮空' : (m.decided ? '已结束' : '未开始');
        if (m.result && m.result.unfinished) {
          stTxt = (m.result.endReason === 'timeout') ? '未打完（计时器到点）' : '未打完';
        }
        rows.push([
          stage.name, typeName(stage.type),
          X.roundLabel(rd.index) + (rd.isGF ? (rd.gfReset ? '（加赛局）' : '（总决赛）') : ''),
          (m.group === null || m.group === undefined) ? '' : (stage.groups ? stage.groups[m.group].name : ('第 ' + (m.group + 1) + ' 组')),
          i + 1, na, nb,
          m.result ? ((m.result.gamesA + (m.result.advA || 0)) + ':' + (m.result.gamesB + (m.result.advB || 0))) : '',
          games, stTxt, win
        ]);
      });
    });
    return X.toCSV(rows);
  };

  // 排名 CSV（可按阶段 / 小组 / 截至轮次）
  X.standingsCSV = function (t, opts) {
    opts = opts || {};
    var si = (opts.stageIndex === undefined) ? t.currentStage : opts.stageIndex;
    var stage = t.stages[si];
    if (!stage) return X.toCSV([['无阶段数据']]);
    var gi = (opts.groupIdx === undefined) ? null : opts.groupIdx;
    var upTo = (opts.upToRound === undefined || opts.upToRound === null) ? null : opts.upToRound;
    var st = E.standings(t, { stageIndex: si, groupIdx: gi, upToRound: upTo });

    var title = stage.name + (gi !== null ? (' ' + stage.groups[gi].name) : '') +
      (upTo === null ? '' : (' 截至第 ' + (upTo + 1) + ' 轮'));
    var rows = [[title + ' 排名'], ['名次', '选手', '积分', '场次', '胜', '平', '负',
      '判负', '警告',
      '赢局', '输局', '净胜局', '累计小分', '净小分', '累进分', '上阶段分', '对手分', '状态']];
    st.forEach(function (s) {
      var status = [];
      if ((stage.clinched || []).indexOf(s.id) >= 0) status.push('提前晋级');
      else if ((stage.eliminated || []).indexOf(s.id) >= 0) status.push('淘汰');
      else if ((stage.advanced || []).indexOf(s.id) >= 0) status.push('晋级');
      if (!s.active) status.push(s.dropReason || '退赛');
      rows.push([s.rank, s.name, U.fmt(s.points), s.matches, s.wins, s.draws, s.losses,
        s.forfeits || 0, s.warnings || 0,
        s.gamesWon, s.gamesLost, s.gamesDiff, U.fmt(s.cumulative), U.fmt(s.cumDiff),
        U.fmt(s.progressive), U.fmt(s.stagePoints), U.fmt(s.buchholz),
        status.join('/')]);
    });
    return X.toCSV(rows);
  };

  X.downloadCSV = function (filename, csv, cb) {
    return U.saveFile(filename || '导出.csv', csv, 'text/csv;charset=utf-8', cb);
  };

  /* ============ 打印 / 导出 PDF ============ */
  function printAreaWith(html) {
    var area = document.getElementById('printArea');
    if (!area) {
      area = document.createElement('div');
      area.id = 'printArea';
      document.body.appendChild(area);
    }
    area.innerHTML = html;
    return area;
  }

  X.printHTML = function (html, cb) {
    var kind = U.nativeKind();
    var area = printAreaWith(html);
    document.body.classList.add('printing');
    function done(r) {
      document.body.classList.remove('printing');
      area.innerHTML = '';
      if (cb) cb(r || { ok: true });
    }
    // 手机版：交系统打印面板（可选打印机或「另存为 PDF」）
    if (kind === 'android' && global.TmsNative && typeof global.TmsNative.printPage === 'function') {
      setTimeout(function () {
        try { global.TmsNative.printPage(); }
        catch (e) { /* 忽略 */ }
        setTimeout(function () { done({ ok: true, msg: '已打开系统打印面板' }); }, 2500);
      }, 120);
      return true;
    }
    setTimeout(function () {
      try {
        window.print();
        done({ ok: true, msg: '已打开打印对话框' });
      } catch (e) {
        done({ ok: false, msg: '打印失败：' + (e && e.message ? e.message : e) });
      }
    }, 80);
    return true;
  };

  /**
   * 导出 PDF：
   *   桌面版 → 主进程 printToPDF 直接生成 PDF 文件（弹保存框，不用打印机）
   *   手机版 → 系统打印面板（可选「另存为 PDF」）
   *   浏览器 → 系统打印对话框（选「另存为 PDF」）
   */
  X.savePDF = function (html, filename, cb) {
    var kind = U.nativeKind();
    var area = printAreaWith(html);
    document.body.classList.add('printing');
    function done(r) {
      document.body.classList.remove('printing');
      area.innerHTML = '';
      if (cb) cb(r || { ok: true });
    }
    if (kind === 'electron' && global.tmsNative && typeof global.tmsNative.savePDF === 'function') {
      setTimeout(function () {
        global.tmsNative.savePDF(filename || '导出.pdf').then(done, function (e) {
          done({ ok: false, msg: '导出 PDF 失败：' + (e && e.message ? e.message : e) });
        });
      }, 120);
      return true;
    }
    if (kind === 'android' && global.TmsNative && typeof global.TmsNative.printPage === 'function') {
      setTimeout(function () {
        try { global.TmsNative.printPage(); }
        catch (e) { /* 忽略 */ }
        setTimeout(done, 4000);
      }, 120);
      return true;
    }
    // 浏览器 / 不支持原生打印的 WebView
    setTimeout(function () {
      try { window.print(); }
      catch (e) { alert('打印失败：' + e.message); }
      done({ ok: true, msg: '已打开打印对话框（选「另存为 PDF」可保存文件）' });
    }, 60);
    return true;
  };

  /* ============ JSON 存档 ============ */
  X.exportJSON = function (t, filename, cb) {
    var data = JSON.stringify(t, null, 2);
    return U.saveFile(filename || (t.name + '_存档.json'), data, 'application/json;charset=utf-8', cb);
  };

  X.readJSONFile = function (file, cb) {
    var fr = new FileReader();
    fr.onload = function () {
      try { cb(null, JSON.parse(fr.result)); }
      catch (e) { cb(e, null); }
    };
    fr.onerror = function () { cb(new Error('读取失败'), null); };
    fr.readAsText(file, 'utf-8');
  };

  /* ============ 选手名单导出/导入（纯文本） ============ */
  X.exportPlayerList = function (t, cb) {
    var lines = t.players.map(function (p) { return p.name; }).join('\n');
    return U.saveFile('选手名单.txt', lines, 'text/plain;charset=utf-8', cb);
  };

})(window);
