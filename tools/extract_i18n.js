/**
 * 英文版词条提取 / 漏翻检查（无头浏览器，无可见窗口）
 *
 *   node tools/extract_i18n.js            # 扫描并把结果写成 tools/i18n_scan.json + 控制台摘要
 *   node tools/extract_i18n.js --check    # 只统计「还剩多少中文」，有残留就 exit 1（当冒烟用）
 *
 * 做法：把界面切到英文（localStorage 写 tms_lang=en），造一批覆盖各种页面的赛事，
 *      逐个页签 / 面板 / 弹窗 / 导出报表扫一遍，收集仍然出现的中文串。
 *      dict 里已有词条的会被替换掉，所以「剩下的」就是漏翻的。
 *
 * 注意：ui.js 的当前赛事是模块内变量 T，只有「用 id 打开 + 刷新」这条路会真正切赛事，
 *       所以这里统一走 openT()（写 currentId 再 reload）。
 */
const path = require('path');
const fs = require('fs');
const { launch, connect } = require('./headless');

const PORT = 9452;
const OUT = path.join(__dirname, 'i18n_scan.json');
const checkOnly = process.argv.indexOf('--check') >= 0;
const zhMode = process.argv.indexOf('--zh') >= 0;   // 收集中文原文（补词条用）
const sleep = ms => new Promise(r => setTimeout(r, ms));

let conn = null;
async function ev(expr) {
  const r = await conn.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false });
  if (r.exceptionDetails) {
    throw new Error('页内异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  }
  return r.result && r.result.value;
}

const found = {};        // 中文串 -> { n, where }
function addAll(got, label) {
  if (!got) return;
  Object.keys(got).forEach(function (s) {
    if (!found[s]) found[s] = { n: 0, where: label };
    found[s].n += got[s];
  });
}
async function scan(label, sel) {
  const got = await ev('(function(sel){var r=sel?document.querySelector(sel):document.body;' +
    'return (r&&window.I18n&&I18n._collectUntranslated)?I18n._collectUntranslated(r):{};})(' +
    JSON.stringify(sel || '') + ')');
  addAll(got, label);
}
async function view(v, label) {
  await ev(`(function(){var el=document.querySelector('[data-view="${v}"]');if(el){el.click();return 1}return 0})()`);
  await sleep(420);
  await scan((label || v) + ':view', '#view-' + v);
  await scan((label || v) + ':shell', '.sidebar');
  await scan((label || v) + ':topbar', '.topbar');
}
async function openT(id, label) {
  await ev('(function(){TMS.store.setCurrentId(' + JSON.stringify(id) + ');location.reload();return 1})()');
  await sleep(1900);
  await scan(label + ':boot');
}

/* ============ 造数据：覆盖各种页面分支 ============ */
const BUILD = `(function(){
  var M=TMS.model,S=TMS.store,E=TMS.engine;
  function mk(name, n){
    var t=M.createTournament(name);
    for(var i=1;i<=n;i++) t.players.push(M.createPlayer('选手'+i, i));
    return t;
  }
  function playAll(t, st){
    for(var g=0; g<40; g++){
      if(E.stageFinished(t,st)) break;
      var r=E.generateRound(t);
      if(!r.ok) break;
      var rd=st.roundsData[st.roundsData.length-1];
      rd.matches.forEach(function(m){
        if(m.isBye){ E.evaluate(m,E.fmtOfMatch(t,st,m),st.tie); return; }
        var fmt=E.fmtOfMatch(t,st,m);
        m.games=[];
        var need=parseInt(fmt.winNeeded,10)||fmt.gamesPerMatch;
        for(var k=0;k<need;k++) m.games.push({ w: (m.playerA < m.playerB ? 'A':'B') });
        E.evaluate(m,fmt,st.tie);
      });
    }
  }

  /* A：瑞士轮 3 轮（开提前晋级/淘汰、计时器、积分榜）→ 单败（季军赛 + 继承） */
  var A = mk('英文演示 瑞士加淘汰', 16);
  A.timer.enabled = true;
  A.ptsRule.on = true;
  A.stages[0].type='swiss'; A.stages[0].rounds=3;
  A.stages[0].clinch = Object.assign({}, A.stages[0].clinch, {enabled:true, winTarget:3});
  A.stages[0].elim = Object.assign({}, A.stages[0].elim, {enabled:true, afterRound:2, keep:8});
  E.ensureParticipants(A);
  playAll(A, A.stages[0]);

  /* B：小组赛（两组循环）+ 决赛阶段 */
  var B = mk('英文演示 小组赛', 8);
  B.stages[0].type='groups'; B.stages[0].groupCount=2; B.stages[0].groupType='round_robin';
  B.stages[0].adv = Object.assign({}, B.stages[0].adv, {type:'count', count:4, perGroup:2});
  E.ensureParticipants(B);
  B.stages[0].groups = E.buildGroups(B, B.stages[0]);
  playAll(B, B.stages[0]);

  /* C：双败（半区互换 + 平局双败 + 加赛制） */
  var C = mk('英文演示 双败', 8);
  C.stages[0].type='double_elim';
  C.stages[0].deCrossDrop = true;
  C.stages[0].drawBothLose = true;
  C.stages[0].gfMode = 'reset';
  E.ensureParticipants(C);
  playAll(C, C.stages[0]);

  /* D：团体赛 nvn（一桌一场） */
  var D = mk('英文演示 团体赛', 4);
  D.team.on = true; D.team.mode='nvn'; D.team.size=3; D.team.playSize=3;
  D.players.forEach(function(p){
    p.isTeam = true;
    p.members = [1,2,3].map(function(k){ return {id: p.id+'_m'+k, name: p.name+'队员'+k}; });
  });
  D.stages[0].type='round_robin';
  E.ensureParticipants(D);
  E.generateRound(D);

  /* E：空赛事（设置页默认状态） */
  var E0 = mk('英文演示 空赛事', 0);

  /* F：两阶段（瑞士 → 淘汰）用来展示继承 / 晋级逻辑 */
  var F = mk('英文演示 两阶段', 12);
  F.stages[0].type='swiss'; F.stages[0].rounds=3;
  E.ensureParticipants(F);
  playAll(F, F.stages[0]);
  var s2 = M.defaultStage(1);
  s2.type='single_elim'; s2.name='淘汰赛'; s2.thirdPlace=true;
  s2.adv = Object.assign({}, s2.adv, {type:'count', count:4});
  s2.inherit = {enabled:true, ratio:50, tie:true, stats:true};
  F.stages.push(s2);
  E.finishStage(F, F.stages[0]);

  /* 赛季（把 A / B / F 归进去） */
  var se = M.defaultSeason('2026 英文赛季');
  se.id = 'se_en_demo';
  A.seasonId = se.id; B.seasonId = se.id; F.seasonId = se.id;
  S.putSeason(se);

  [A,B,C,D,E0,F].forEach(function(t){ S.putQuiet ? S.putQuiet(t) : S.put(t); });
  return {a:A.id, b:B.id, c:C.id, d:D.id, e:E0.id, f:F.id, se:se.id};
})()`;

(async () => {
  const env = await launch(PORT, path.join(__dirname, '..', 'app'));
  conn = await connect(PORT);

  // 1) 切语言（默认英文；--zh 时保持中文，用来收「原句」补词条）+ 清空本机数据
  await ev(`(function(){
    localStorage.setItem('tms_lang',${zhMode ? "'zh'" : "'en'"});
    Object.keys(localStorage).forEach(function(k){ if(/^tms_/.test(k) && k!=='tms_lang') localStorage.removeItem(k); });
    location.reload(); return 1;
  })()`);
  await sleep(2100);
  console.log('语言 =', await ev('window.I18n && I18n.lang'));

  // 2) 空状态
  await view('list', 'empty:list');
  await view('setup', 'empty:setup');
  await view('season', 'empty:season');

  // 3) 造数据
  const ids = await ev(BUILD);
  await sleep(400);

  // 4) 逐个赛事逐页签
  const cases = [
    { id: ids.a, tag: 'swiss' },
    { id: ids.b, tag: 'groups' },
    { id: ids.c, tag: 'doubleElim' },
    { id: ids.d, tag: 'team' },
    { id: ids.e, tag: 'emptyT' },
    { id: ids.f, tag: 'twoStage' }
  ];
  for (const cs of cases) {
    await openT(cs.id, cs.tag);
    for (const v of ['list', 'setup', 'players', 'matches', 'standing', 'export']) {
      await view(v, cs.tag + ':' + v);
      // 对阵页展开第一张卡片明细（明细区文案更多）
      if (v === 'matches') {
        await ev(`(function(){var b=document.querySelector('[data-act="toggleMore"]');if(b)b.click();return 1})()`);
        await sleep(400);
        await scan(cs.tag + ':matches:detail', '#view-matches');
      }
      // 设置页展开「阶段独立积分规则」面板
      if (v === 'setup') {
        await ev(`(function(){var b=document.querySelector('[data-act="ptsStageEdit"]');if(b)b.click();return 1})()`);
        await sleep(350);
        await scan(cs.tag + ':setup:ptsStage', '#view-setup');
        await ev(`(function(){var b=document.querySelector('[data-act="ptsStageReset"]');return 1})()`);
      }
    }
  }

  // 5) 赛季页（列表 + 规则面板）
  await openT(ids.f, 'season:open');
  await view('season', 'season');
  await ev(`(function(){var b=document.querySelector('[data-act="seasonRules"]');if(b)b.click();return 1})()`);
  await sleep(450);
  await scan('season:rules', '#view-season');
  await ev(`(function(){var b=document.querySelector('[data-act="seasonPlan"]');if(b)b.click();return 1})()`);
  await sleep(500);
  await scan('season:plan', '#view-season');

  // 6) 弹窗 / toast
  await ev(`(function(){var b=document.querySelector('[data-act="delT"]');if(b)b.click();return 1})()`);
  await sleep(400);
  await scan('modal:delT', '#modalWrap');
  await ev(`(function(){var b=document.getElementById('modalCancel');if(b)b.click();return 1})()`);
  await ev(`(function(){var b=document.getElementById('btnSave');if(b)b.click();return 1})()`);
  await sleep(320);
  await scan('toast', '#toast');

  // 7) 导出报表 HTML（grab 里也走同一套翻译）
  await ev(`(function(){
    var X=TMS.exporter, t=TMS.store.get(TMS.store.getCurrentId());
    var box=document.createElement('div'); box.id='i18n_probe';
    box.style.cssText='position:fixed;left:-40000px;top:0;width:1180px;background:#fff';
    box.innerHTML = X.standingsHTML(t,{stageIndex:0}) + X.matchupsHTML(t,{stageIndex:0}) + X.mergedBracketHTML(t);
    document.body.appendChild(box);
    if(window.I18n) I18n.apply(box);
    return 1;
  })()`);
  await sleep(300);
  await scan('export:report', '#i18n_probe');
  await ev(`(function(){var b=document.getElementById('i18n_probe');if(b)b.remove();return 1})()`);

  // 8) 汇总（过滤掉用户自己输入的名字，避免被当成词条）
  const CJK = /[\u4e00-\u9fff]/;
  const list = Object.keys(found)
    .filter(s => {
      // 用户自己填的名字（选手12 / 队员3 / 赛事名）不算漏翻：先把名字抹掉再看还剩不剩中文
      const t = s.replace(/\S*选手\s*\d+/g, 'X')
        .replace(/\S*队员\s*\d+/g, 'X')
        .replace(/英文演示\s*\S*/g, 'DEMO')
        .replace(/2026 英文赛季/g, 'SEASON');
      return CJK.test(t);
    })
    .map(s => ({ zh: s, n: found[s].n, where: found[s].where }))
    .sort((a, b) => b.n - a.n || a.zh.localeCompare(b.zh));

  if (!checkOnly) {
    fs.writeFileSync(OUT, JSON.stringify(list, null, 1), 'utf8');
    console.log('\n待翻译中文串：' + list.length + ' 条 → ' + OUT);
  } else {
    console.log('\n残留中文串：' + list.length + ' 条');
  }
  list.slice(0, 60).forEach(x => console.log('  [' + x.where + '] ' + x.zh));

  conn.close();
  env.child.kill();
  process.exit(checkOnly && list.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
