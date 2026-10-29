/**
 * v1.11.0 界面验证
 *  1. 合并对阵图：多个淘汰赛阶段并到一张图里（阶段块 / 衔接条 / 总冠军）
 *  2. 合并 ↔ 只看所选阶段 切换
 *  3. 「只看本阶段」跳转
 *  4. 轮次切换条：随时回看之前任何一轮，并可补录 / 改判
 *  5. 「回到最新轮」/「回到当前阶段」
 *  6. 旧阶段只读（不渲染录入控件 + 提示）
 *  7. 打印 / PDF 按钮就位
 *  8. 移动端 390×844 布局
 *  9. 无 JS 报错
 */
const path = require('path'), fs = require('fs');
const { launch, connect } = require('./headless');
const PORT = 9461;
const OUT = path.join(__dirname, 'smoke_out');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let conn = null;
async function ev(expr) {
  const r = await conn.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false });
  if (r.exceptionDetails) throw new Error('页内异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r.result && r.result.value;
}
async function shot(n) {
  const r = await conn.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, n), Buffer.from(r.data, 'base64'));
}
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}
async function view(v) {
  await ev(`(function(){var el=document.querySelector('[data-view="${v}"]');if(el){el.click();return 1}return 0})()`);
  await sleep(450);
}
async function reload() {
  await ev('location.reload()'); await sleep(1700);
  await ev(`window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message))});
    (function(){var oe=console.error;console.error=function(){window.__errs.push([].slice.call(arguments).join(' '));oe.apply(console,arguments)}})();'ok'`);
}
async function click(sel) {
  return await ev(`(function(){var el=document.querySelector(${JSON.stringify(sel)});if(!el)return 'none';el.click();return 'ok'})()`);
}
async function clickText(sel, text) {
  return await ev(`(function(){
    var els=[].slice.call(document.querySelectorAll(${JSON.stringify(sel)}));
    for(var i=0;i<els.length;i++){
      if(els[i].innerText.indexOf(${JSON.stringify(text)})>=0){ els[i].click(); return 'ok'; }
    }
    return 'none';
  })()`);
}

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);
  const env = await launch(PORT, path.join(__dirname, '..', 'app'));
  conn = await connect(PORT);
  await conn.send('Runtime.enable'); await conn.send('Page.enable');
  await conn.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await reload();

  /* ---------- 0. 建赛事：8 人 → 单败取 2 → 单败决赛（两阶段淘汰赛） ---------- */
  console.log('\n=== 0. 建两阶段淘汰赛 ===');
  await ev(`(function(){
    var M=TMS.model,S=TMS.store,E=TMS.engine;
    S.loadIndex().slice().forEach(function(x){S.remove(x.id)});
    var t=M.createTournament('合并对阵图测试');
    for(var i=1;i<=8;i++)t.players.push(M.createPlayer('选手'+i,i));
    var s0=M.defaultStage(0); s0.type='single_elim'; s0.name='八强赛';
    s0.adv={type:'count',count:2,score:0,perGroup:1};
    s0.participants=t.players.map(function(p){return p.id});
    var s1=M.defaultStage(1); s1.type='single_elim'; s1.name='决赛阶段';
    s1.adv={type:'count',count:1,score:0,perGroup:1};
    t.stages=[s0,s1]; t.currentStage=0; t.status='running';
    E.ensureParticipants(t);
    function playAll(st){ st.roundsData[st.roundsData.length-1].matches.forEach(function(m){
      if(m.isBye)return; m.games=[{w:'A',a:1,b:0},{w:'A',a:1,b:0}];
      E.evaluate(m,E.fmtOfMatch(t,st,m),st.tie); }); }
    E.generateRound(t); playAll(s0);
    E.finishRound(t); E.generateRound(t); playAll(s0);
    E.finishStage(t);
    E.generateRound(t); playAll(s1);
    E.finishStage(t);
    S.put(t);TMS.current=t;return 'built'})()`);
  await reload();
  ok('赛事已建好（2 个阶段都打完）', (await ev(`TMS.current.stages.filter(function(s){return s.roundsData.length>0}).length`)) === 2);

  /* ---------- 1. 排名页：合并对阵图 ---------- */
  console.log('\n=== 1. 合并对阵图 ===');
  await view('standing');
  const m1 = await ev(`(function(){
    var v=document.getElementById('view-standing');
    return {
      btnMerged: !!v.querySelector('[data-act="bracketMode"][data-mode="merged"]'),
      btnStage: !!v.querySelector('[data-act="bracketMode"][data-mode="stage"]'),
      btnPrint: !!v.querySelector('[data-act="imgMerged"]'),
      btnPdf: !!v.querySelector('[data-act="pdfMerged"]'),
      flow: !!v.querySelector('.mflow'),
      stages: v.querySelectorAll('.mstage').length,
      links: v.querySelectorAll('.mlink').length,
      final: ((v.querySelector('.mbar .mchamp')||{}).innerText||'').replace(/\\s+/g,' ').trim(),
      lastFoot: ((function(){var a=v.querySelectorAll('.mstage');var l=a[a.length-1];var f=l&&l.querySelector('.mfoot');return f?f.innerText:''})()||'').replace(/\\s+/g,' ').trim(),
      bar: ((v.querySelector('.mbar')||{}).innerText||'')
    };
  })()`);
  ok('有「合并全部 … 个阶段」按钮', m1.btnMerged === true, m1);
  ok('有「只看所选阶段」按钮', m1.btnStage === true, m1);
  ok('有「导出合并图 JPG / 存 PDF」按钮', m1.btnPrint === true && m1.btnPdf === true, [m1.btnPrint, m1.btnPdf]);
  ok('默认就渲染出合并视图（.mflow）', m1.flow === true, m1);
  ok('合并视图里有 2 个阶段块', m1.stages === 2, m1.stages);
  ok('阶段之间有 1 条晋级衔接条', m1.links === 1, m1.links);
  ok('顶部标题条标出总冠军', /总冠军/.test(m1.final) && /选手1/.test(m1.final), m1.final);
  ok('最后一个阶段块底部也写总冠军', /总冠军/.test(m1.lastFoot) && /选手1/.test(m1.lastFoot), m1.lastFoot);
  ok('顶部说明写清了阶段数与列数', /合并对阵图/.test(m1.bar) && /2 个淘汰赛阶段/.test(m1.bar), m1.bar);
  const stageText = await ev(`(function(){
    var v=document.getElementById('view-standing');
    return [].slice.call(v.querySelectorAll('.mstage')).map(function(s){return s.innerText.replace(/\\s+/g,' ').slice(0,80)});
  })()`);
  ok('阶段块标题含阶段名与人数', /八强赛/.test(stageText[0]) && /8 人/.test(stageText[0]), stageText);
  ok('第 2 个阶段块是决赛阶段', /决赛阶段/.test(stageText[1]), stageText[1]);
  const linkTxt = await ev(`(function(){
    var v=document.getElementById('view-standing');
    return (v.querySelector('.mlink')||{}).innerText.replace(/\\s+/g,' ').trim();
  })()`);
  ok('衔接条写「晋级 2 人 + 具体名字」', /晋级 2 人/.test(linkTxt) && /选手/.test(linkTxt), linkTxt);
  await shot('v21_merged_bracket.png');

  /* ---------- 2. 合并 ↔ 单阶段 ---------- */
  console.log('\n=== 2. 切换只看所选阶段 ===');
  ok('点「只看所选阶段」', (await click('[data-act="bracketMode"][data-mode="stage"]')) === 'ok');
  await sleep(450);
  const m2 = await ev(`(function(){
    var v=document.getElementById('view-standing');
    return {flow:!!v.querySelector('.mflow'), single:!!v.querySelector('.bracket-wrap:not(.merged)'),
      txt:(v.querySelector('.bplan-bar')||{}).innerText ? 'has-banner' : 'no-banner'};
  })()`);
  ok('单阶段视图：没有合并流', m2.flow === false, m2);
  ok('单阶段视图：出现单张对阵图', m2.single === true, m2);
  ok('切回合并', (await click('[data-act="bracketMode"][data-mode="merged"]')) === 'ok');
  await sleep(400);
  ok('又回到合并视图', (await ev(`!!document.querySelector('#view-standing .mflow')`)) === true);

  /* ---------- 3. 「只看本阶段」跳转 ---------- */
  console.log('\n=== 3. 「只看本阶段」跳转 ===');
  ok('点第 2 阶段的「只看本阶段」', (await ev(`(function(){
    var b=document.querySelectorAll('#view-standing .mstage [data-act="mergedFocus"]');
    if(!b[1]) return 'none';
    b[1].click(); return 'ok';
  })()`)) === 'ok');
  await sleep(500);
  const m3 = await ev(`(function(){
    var s=document.querySelector('#view-standing select[data-act2="stStage"]');
    return {name: s? s.options[s.selectedIndex].text : '',
      merged: !!document.querySelector('#view-standing .mflow'),
      single: !!document.querySelector('#view-standing .bracket-wrap:not(.merged)')};
  })()`);
  ok('排名页阶段切到该阶段', /决赛阶段/.test(m3.name), m3);
  ok('自动切成单张对阵图', m3.single === true && m3.merged === false, m3);

  /* ---------- 4. 轮次切换条 ---------- */
  console.log('\n=== 4. 对阵页 · 轮次切换 ===');
  // 再造一个 3 轮瑞士轮赛事（轮次多，方便验证切换）
  await ev(`(function(){
    var M=TMS.model,S=TMS.store,E=TMS.engine;
    var t=M.createTournament('轮次切换测试');
    for(var i=1;i<=8;i++)t.players.push(M.createPlayer('选手'+i,i));
    var s=M.defaultStage(0); s.type='swiss'; s.name='瑞士轮'; s.rounds=3;
    s.participants=t.players.map(function(p){return p.id});
    t.stages=[s]; t.currentStage=0; t.status='running';
    E.ensureParticipants(t);
    for(var r=0;r<3;r++){
      E.generateRound(t);
      var rd=s.roundsData[s.roundsData.length-1];
      rd.matches.forEach(function(m){ if(m.isBye)return; m.games=[{w:'A',a:1,b:0},{w:'A',a:1,b:0}]; E.evaluate(m,E.fmtOfMatch(t,s,m),s.tie); });
      if(r<2) E.finishRound(t);
    }
    S.put(t);TMS.current=t;return 1})()`);
  await reload();
  await view('matches');
  const r1 = await ev(`(function(){
    var v=document.getElementById('view-matches');
    return {bar:!!v.querySelector('.navbar'), chips:[].slice.call(v.querySelectorAll('[data-act="pickRound"]')).map(function(c){return c.innerText.replace(/\\s+/g,' ').trim()}),
      latest:v.querySelector('[data-act="latestRound"]')?1:0};
  })()`);
  ok('有轮次切换条', r1.bar === true, r1);
  ok('3 轮各有一个按钮', r1.chips.length === 3, r1.chips);
  ok('最新一轮标「最新」', /最新/.test(r1.chips[2]), r1.chips);
  ok('有「回到最新轮」按钮', r1.latest === 1);

  ok('点第 1 轮', (await clickText('[data-act="pickRound"]', '第 1 轮')) === 'ok');
  await sleep(500);
  const r2 = await ev(`(function(){
    var v=document.getElementById('view-matches');
    return {h3:(v.querySelector('.card h3')||{}).innerText,
      notice:((v.querySelector('.notice.noprint')||{}).innerText||'').replace(/\\s+/g,' ').trim(),
      foots:v.querySelectorAll('.match-foot').length,
      cards:v.querySelectorAll('.match').length,
      on:(v.querySelector('[data-act="pickRound"].on')||{}).innerText};
  })()`);
  ok('正在看第 1 轮', /第 1 轮/.test(r2.h3 || ''), r2.h3);
  ok('提示「历史轮次可以直接补录 / 改判」', /历史轮次/.test(r2.notice) && /补录/.test(r2.notice), r2.notice);
  ok('历史轮次仍然可以录入（有录入控件）', r2.foots === 4, r2.foots);
  ok('第 1 轮共 4 张卡', r2.cards === 4, r2.cards);
  ok('当前选中项是第 1 轮', /第 1 轮/.test(r2.on || ''), r2.on);
  await shot('v21_round_switch.png');

  /* 4.1 历史轮次改判 */
  const mid = await ev(`(function(){
    var v=document.getElementById('view-matches');
    var qa=v.querySelector('input[id^="qa_"]');
    return qa? qa.id.slice(3) : null;
  })()`);
  ok('拿到第 1 轮某场比赛的输入框', !!mid, mid);
  await ev(`(function(id){
    var v=document.getElementById('view-matches');
    document.getElementById('qa_'+id).value='1';
    document.getElementById('qb_'+id).value='2';
    v.querySelector('[data-act="applyScore"][data-id="'+id+'"]').click();
    return 1;
  })(${JSON.stringify(mid)})`);
  await sleep(700);
  const r3 = await ev(`(function(){
    var t=TMS.current, r0=t.stages[0].roundsData[0];
    var m=r0.matches.filter(function(x){return x.id===${JSON.stringify(mid)}})[0];
    return {res:m.result? (m.result.gamesA+':'+m.result.gamesB+'/'+m.result.winner) : 'x',
      view:(document.querySelector('#view-matches .card h3')||{}).innerText};
  })()`);
  ok('历史轮次改判已生效（1:2 → B 胜）', r3.res === '1:2/B', r3.res);
  ok('改判后仍停在原轮次', /第 1 轮/.test(r3.view || ''), r3.view);

  /* ---------- 5. 回到最新轮 ---------- */
  console.log('\n=== 5. 回到最新轮 ===');
  ok('点「回到最新轮」', (await click('[data-act="latestRound"]')) === 'ok');
  await sleep(450);
  const r4 = await ev(`(function(){
    var v=document.getElementById('view-matches');
    return {h3:(v.querySelector('.card h3')||{}).innerText, notice:!!v.querySelector('.notice.noprint'),
      disabled:(v.querySelector('[data-act="latestRound"]')||{}).disabled};
  })()`);
  ok('回到第 3 轮', /第 3 轮/.test(r4.h3 || ''), r4.h3);
  ok('历史提示消失', r4.notice === false, r4.notice);
  ok('已在最新轮时按钮禁用', r4.disabled === true, r4.disabled);

  /* ---------- 6. 旧阶段只读 ---------- */
  console.log('\n=== 6. 旧阶段只读 ===');
  await ev(`(function(){
    var M=TMS.model,S=TMS.store,E=TMS.engine;
    var t=M.createTournament('两阶段回看');
    for(var i=1;i<=8;i++)t.players.push(M.createPlayer('选手'+i,i));
    var s0=M.defaultStage(0); s0.type='single_elim'; s0.name='八强赛';
    s0.adv={type:'count',count:2,score:0,perGroup:1};
    s0.participants=t.players.map(function(p){return p.id});
    var s1=M.defaultStage(1); s1.type='single_elim'; s1.name='决赛阶段';
    s1.adv={type:'count',count:1,score:0,perGroup:1};
    t.stages=[s0,s1]; t.currentStage=0; t.status='running';
    E.ensureParticipants(t);
    function playAll(st){ st.roundsData[st.roundsData.length-1].matches.forEach(function(m){
      if(m.isBye)return; m.games=[{w:'A',a:1,b:0},{w:'A',a:1,b:0}]; E.evaluate(m,E.fmtOfMatch(t,st,m),st.tie); }); }
    E.generateRound(t); playAll(s0);
    E.finishRound(t); E.generateRound(t); playAll(s0);
    E.finishStage(t);
    E.generateRound(t);
    S.put(t);TMS.current=t;return 1})()`);
  await reload();
  await view('matches');
  const s1 = await ev(`(function(){
    var v=document.getElementById('view-matches');
    return {stageChips:[].slice.call(v.querySelectorAll('.navbar')[0].querySelectorAll('[data-act="pickStage"]')).map(function(c){return c.innerText.replace(/\\s+/g,' ').trim()}),
      navs:v.querySelectorAll('.navbar').length};
  })()`);
  ok('有阶段切换条（2 个阶段）', s1.stageChips.length === 2, s1.stageChips);
  ok('阶段按钮标注「已结束 / 当前」', /已结束/.test(s1.stageChips[0]) && /当前/.test(s1.stageChips[1]), s1.stageChips);
  await ev(`(function(){
    var v=document.getElementById('view-matches');
    v.querySelector('.navbar [data-act="pickStage"]').click(); return 1;
  })()`);
  await sleep(550);
  const s2 = await ev(`(function(){
    var v=document.getElementById('view-matches');
    return {h3:(v.querySelector('.card h3')||{}).innerText,
      foots:v.querySelectorAll('.match-foot').length,
      notice:((v.querySelector('.notice.inv')||{}).innerText||'').replace(/\\s+/g,' ').trim(),
      back:!!v.querySelector('[data-act="latestStage"]'),
      cards:v.querySelectorAll('.match').length};
  })()`);
  ok('旧阶段能打开并看到对阵', s2.cards > 0, s2.cards);
  ok('旧阶段不渲染任何录入控件', s2.foots === 0, s2.foots);
  ok('旧阶段给出「只读」提示', /只读/.test(s2.notice), s2.notice);
  ok('旧阶段轮次标题不带「· 当前」', !/· 当前/.test(s2.h3 || ''), s2.h3);
  ok('有「回到当前阶段」按钮', s2.back === true);
  await shot('v21_old_stage_readonly.png');
  ok('点「回到当前阶段」', (await click('[data-act="latestStage"]')) === 'ok');
  await sleep(450);
  const s3 = await ev(`(function(){
    var v=document.getElementById('view-matches');
    var inv=[].slice.call(v.querySelectorAll('.notice.inv')).map(function(e){return e.innerText}).join(' | ');
    return {foots:v.querySelectorAll('.match-foot').length, readonly:/只读/.test(inv)};
  })()`);
  ok('回到当前阶段后又能录入', s3.foots > 0, s3.foots);
  ok('只读提示消失', s3.readonly === false);

  /* ---------- 7. 对阵页 → 合并对阵图入口 ---------- */
  console.log('\n=== 7. 对阵页跳合并对阵图 ===');
  const jump = await ev(`!!document.querySelector('#view-matches [data-act="gotoMerged"]')`);
  ok('对阵页有「查看合并对阵图」按钮', jump === true);
  await click('#view-matches [data-act="gotoMerged"]');
  await sleep(720);
  const jump2 = await ev(`(function(){
    return {view:(document.querySelector('.tab.active')||{}).getAttribute('data-view'),
      flow:!!document.querySelector('#view-standing .mflow')};
  })()`);
  ok('跳到了排名页', jump2.view === 'standing', jump2.view);
  ok('并自动显示合并视图', jump2.flow === true);

  /* ---------- 8. 移动端 390×844 ---------- */
  console.log('\n=== 8. 移动端 390×844 ===');
  await conn.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  const m = await ev(`(function(){
    var w=document.querySelector('#view-standing .bracket-wrap.merged');
    var flow=document.querySelector('#view-standing .mflow');
    return {docW:document.documentElement.clientWidth, wrapW:w?w.clientWidth:0,
      scrollW:w?w.scrollWidth:0, flowW:flow?flow.scrollWidth:0,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2};
  })()`);
  ok('合并图在手机上横向滚动，不撑破页面', m.overflow === false && m.scrollW >= m.wrapW, m);
  await shot('v21_merged_mobile.png');

  await view('matches');
  const m2b = await ev(`(function(){
    var bar=document.querySelector('#view-matches .navbar');
    return {chipH:(document.querySelector('#view-matches [data-act="pickRound"]')||{}).offsetHeight,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      barScroll:bar? bar.scrollWidth > bar.clientWidth : false};
  })()`);
  ok('轮次按钮在手机上好点（高度 ≥ 36px）', (m2b.chipH || 0) >= 36, m2b.chipH);
  ok('页面不横向溢出', m2b.overflow === false, m2b);
  await shot('v21_round_bar_mobile.png');
  await conn.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  /* ---------- 9. 无报错 ---------- */
  console.log('\n=== 9. 无 JS 报错 ===');
  const errs = await ev('window.__errs');
  ok('全程无 JS 报错', !errs || errs.length === 0, errs);

  console.log('\n----------------------------------------');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  conn.close();
  env.child.kill();
  process.exit(fail ? 1 : 0);
})();
