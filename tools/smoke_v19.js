/**
 * v1.9.0 界面验证
 *  1. 设置页：瑞士轮三种配对方式（自动 / 随机 / 手动）
 *  2. 设置页：淘汰赛三种首轮编排方式 + 分档数
 *  3. 设置页：继承积分时可选「同时继承小分」
 *  4. 对阵图：banner 标明首轮编排方式
 *  5. 手动编排面板：点两名选手成桌、确认生成
 *  6. 导出页：新增 PDF 按钮 + 原生保存提示
 *  7. 移动端（390×844）：底部标签栏、单列对阵卡、触摸目标够大
 *  8. 无 JS 报错
 */
const path = require('path'), fs = require('fs');
const { launch, connect } = require('./headless');
const PORT = 9449;
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
  await sleep(420);
}
async function reload() {
  await ev('location.reload()'); await sleep(1700);
  await ev(`window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message))});
    (function(){var oe=console.error;console.error=function(){window.__errs.push([].slice.call(arguments).join(' '));oe.apply(console,arguments)}})();'ok'`);
}

/* 找到选项文字匹配的 select */
const FIND_SEL = `function findSel(re){
  var sels=[].slice.call(document.querySelectorAll('select'));
  for(var i=0;i<sels.length;i++){
    var t=[].slice.call(sels[i].options).map(function(o){return o.textContent});
    if(t.some(function(x){return re.test(x)})) return sels[i];
  }
  return null;
}`;

(async () => {
  const env = await launch(PORT, path.join(__dirname, '..', 'app'));
  conn = await connect(PORT);
  await conn.send('Runtime.enable'); await conn.send('Page.enable');
  await reload();

  /* ---------- 0. 建一个 9 人瑞士轮 + 8 人淘汰赛 ---------- */
  console.log('\n=== 0. 建赛事 ===');
  await ev(`(function(){
    var M=TMS.model,S=TMS.store;
    S.loadIndex().slice().forEach(function(x){S.remove(x.id)});
    var t=M.createTournament('v19 瑞士轮');
    for(var i=1;i<=9;i++)t.players.push(M.createPlayer('选手'+i,i));
    var a=M.defaultStage(0),b=M.defaultStage(1);
    a.type='swiss';a.rounds=3;a.pairMode='manual';
    b.type='swiss';b.rounds=2;b.inherit={enabled:true,ratio:50,fromStage:null,tie:false};
    t.stages=[a,b];t.currentStage=0;t.status='running';
    TMS.engine.ensureParticipants(t);
    S.put(t);TMS.current=t;return 1})()`);
  await reload();
  await view('setup');

  /* ---------- 1. 瑞士轮配对方式 ---------- */
  console.log('\n=== 1. 瑞士轮三种配对方式 ===');
  const pairOpts = await ev(`(function(){${FIND_SEL}
    var s=findSel(/生成时自己点选配对/);
    return s?[].slice.call(s.options).map(function(o){return o.textContent}):[];
  })()`);
  console.log('    选项：', JSON.stringify(pairOpts));
  ok('有「每轮配对方式」下拉', pairOpts.length === 3, pairOpts);
  ok('含自动 / 随机 / 手动三种', pairOpts.some(x => /自动配对/.test(x)) &&
    pairOpts.some(x => /随机配对/.test(x)) && pairOpts.some(x => /手动编排/.test(x)), pairOpts);
  ok('说明里提到可以自己点选配对',
    /点选配对/.test(await ev('document.body.innerText')), true);
  await shot('v19_setup_pair.png');

  /* ---------- 2. 淘汰赛编排方式 ---------- */
  console.log('\n=== 2. 淘汰赛首轮编排方式 ===');
  // 切到第 1 阶段并把类型改成单败淘汰
  await ev(`(function(){
    var btns=[].slice.call(document.querySelectorAll('[data-act="gotoStage"]'));
    if(btns[0]) btns[0].click();
    return btns.length;
  })()`);
  await sleep(450);
  await ev(`(function(){${FIND_SEL}
    var s=findSel(/单败淘汰|双败淘汰/);
    if(!s) return 0;
    s.value='single_elim';
    s.dispatchEvent(new Event('change',{bubbles:true}));
    return 1;
  })()`);
  await sleep(500);
  const drawOpts = await ev(`(function(){${FIND_SEL}
    var s=findSel(/按种子号编排|分档抽签|完全随机抽签/);
    return s?[].slice.call(s.options).map(function(o){return o.textContent}):[];
  })()`);
  console.log('    选项：', JSON.stringify(drawOpts));
  ok('有「编排方式」下拉（4 种，v2.2 新增手动摆放）', drawOpts.length === 4, drawOpts);
  ok('含 v2.2 新增的「手动摆放首轮位」', drawOpts.some(x => x.indexOf('手动摆放首轮位') >= 0), drawOpts);
  ok('含种子 / 分档 / 随机三种', drawOpts.some(x => /种子/.test(x)) &&
    drawOpts.some(x => /分档/.test(x)) && drawOpts.some(x => /随机/.test(x)), drawOpts);

  // 选分档 → 出现分档数
  await ev(`(function(){${FIND_SEL}
    var s=findSel(/按种子号编排|分档抽签|完全随机抽签/);
    s.value='tier';s.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
  await sleep(420);
  const tierUI = await ev(`(function(){
    var txt=document.body.innerText;
    return {has:/分档数/.test(txt), tip:/档内抽签|每档/.test(txt)};
  })()`);
  ok('选分档后出现「分档数」', tierUI.has === true, tierUI);
  ok('提示说明档内随机', tierUI.tip === true, tierUI);
  await shot('v19_setup_draw.png');

  /* ---------- 3. 继承积分 + 继承小分 ---------- */
  console.log('\n=== 3. 继承积分 / 继承小分 ===');
  // 切到第 2 阶段（索引 1，有继承设置）
  await ev(`(function(){
    var btns=[].slice.call(document.querySelectorAll('[data-act="gotoStage"]'));
    if(btns[1]) btns[1].click();
    return btns.length;
  })()`);
  await sleep(450);
  // 通用：按 label 文字找到那一行的复选框并勾上
  const CHECK_BY_LABEL = `function tick(labelRe){
    var rows=[].slice.call(document.querySelectorAll('.fld'));
    for(var i=0;i<rows.length;i++){
      var lab=rows[i].querySelector('label');
      if(!lab || !labelRe.test(lab.textContent)) continue;
      var cb=rows[i].querySelector('input[type=checkbox]');
      if(!cb) continue;
      if(!cb.checked){ cb.checked=true; cb.dispatchEvent(new Event('change',{bubbles:true})); }
      return 1;
    }
    return 0;
  }`;
  const inhTxt1 = await ev('document.body.innerText');
  ok('有「继承上一阶段积分」勾选', /继承上一阶段积分/.test(inhTxt1), true);

  // 勾选继承 → 出现比例与「同时继承小分」
  const ticked1 = await ev(`(function(){${CHECK_BY_LABEL}
    return tick(/继承上一阶段积分/);
  })()`);
  ok('能勾上「继承上一阶段积分」', ticked1 === 1, ticked1);
  await sleep(500);
  const inhTxt2 = await ev('document.body.innerText');
  ok('勾选继承后出现比例', /继承比例/.test(inhTxt2), true);
  ok('勾选继承后出现「同时继承小分」', /同时继承小分/.test(inhTxt2), true);
  ok('说明写明继承哪些小分', /累计小分/.test(inhTxt2) && /净胜局/.test(inhTxt2) && /对手分/.test(inhTxt2),
    (inhTxt2.match(/同时继承小分[\s\S]{0,160}/) || [''])[0]);

  // 勾上「同时继承小分」，写回存档
  const ticked2 = await ev(`(function(){${CHECK_BY_LABEL}
    var r = tick(/同时继承小分/);
    return {r:r, tie:TMS.current.stages[1].inherit.tie === true};
  })()`);
  ok('能勾上「同时继承小分」', ticked2.r === 1, ticked2);
  ok('勾选后写入存档 inherit.tie = true', ticked2.tie === true, ticked2);
  await shot('v19_setup_inherit.png');

  /* ---------- 4. 对阵图 banner 编排方式 ---------- */
  console.log('\n=== 4. 对阵图标注编排方式 ===');
  await ev(`(function(){
    var M=TMS.model,S=TMS.store;
    S.loadIndex().slice().forEach(function(x){S.remove(x.id)});
    var t=M.createTournament('v19 抽签');
    for(var i=1;i<=8;i++)t.players.push(M.createPlayer('选手'+i,i));
    var a=M.defaultStage(0);
    a.type='single_elim';a.adv={type:'count',count:1,score:0,perGroup:2};
    a.drawMode='random';a.drawSeed=12345;
    t.stages=[a];t.currentStage=0;t.status='running';
    TMS.engine.ensureParticipants(t);
    var r=TMS.engine.generateRound(t);
    S.put(t);TMS.current=t;return r&&r.ok;
  })()`);
  await reload();
  await view('standing');
  const banner = await ev(`(function(){
    var b=document.querySelector('.bplan-bar');
    return b?b.innerText.replace(/\\s+/g,' '):'';
  })()`);
  console.log('    banner：', banner);
  ok('对阵图顶部有编排说明', /首轮编排/.test(banner), banner);
  ok('写明了「完全随机抽签」', /完全随机抽签/.test(banner), banner);
  await shot('v19_bracket_draw.png');

  /* ---------- 5. 手动编排面板 ---------- */
  console.log('\n=== 5. 手动编排面板 ===');
  await ev(`(function(){
    var M=TMS.model,S=TMS.store;
    S.loadIndex().slice().forEach(function(x){S.remove(x.id)});
    var t=M.createTournament('v19 手动');
    for(var i=1;i<=8;i++)t.players.push(M.createPlayer('选手'+i,i));
    var a=M.defaultStage(0);
    a.type='swiss';a.rounds=3;a.pairMode='manual';a.adv={type:'all'};
    t.stages=[a];t.currentStage=0;t.status='running';
    TMS.engine.ensureParticipants(t);
    S.put(t);TMS.current=t;return 1})()`);
  await reload();
  await view('matches');
  // 点「生成首轮对阵」→ 应该打开手动编排面板而不是直接生成
  await ev(`(function(){
    var b=document.querySelector('[data-act="genRound"]');
    if(b) b.click();return 1})()`);
  await sleep(600);
  const arrOpen = await ev(`(function(){
    return {panel:!!document.querySelector('.arrcard'),
      chips:document.querySelectorAll('.arrcard .chip').length,
      rounds: TMS.current.stages[0].roundsData.length};
  })()`);
  console.log('    面板：', JSON.stringify(arrOpen));
  ok('打开手动编排面板', arrOpen.panel === true, arrOpen);
  ok('列出 8 名可出赛选手', arrOpen.chips === 8, arrOpen.chips);
  ok('没有偷偷生成轮次', arrOpen.rounds === 0, arrOpen.rounds);

  // 点两名选手 → 组成一桌（每次点击后列表会重绘，需重新取元素）
  await ev(`(function(){
    var cs=[].slice.call(document.querySelectorAll('.arrcard .chip'));
    cs[0].click();return 1})()`);
  await sleep(300);
  await ev(`(function(){
    var cs=[].slice.call(document.querySelectorAll('.arrcard .chip.sel, .arrcard .chip'));
    // 优先点已选中的下一个未使用选手
    var pick=null;
    for(var i=0;i<cs.length;i++){ if(!cs[i].classList.contains('used') && !cs[i].classList.contains('sel')){pick=cs[i];break;} }
    (pick||cs[1]).click();return 1})()`);
  await sleep(420);
  const draftState = await ev(`(function(){
    return {pairs:document.querySelectorAll('.arr-pair').length,
      bar:(document.querySelector('.arr-bar')||{}).innerText||''};
  })()`);
  console.log('    草稿：', JSON.stringify(draftState));
  ok('点两名选手后组成 1 桌', draftState.pairs === 1, draftState.pairs);
  ok('计数显示 1 桌 / 2 人', /1\s*桌/.test(draftState.bar) && /2\s*\/\s*8/.test(draftState.bar.replace(/\s+/g, ' ')), draftState.bar);
  await shot('v19_manual_arrange.png');

  // 随机配对 → 4 桌，然后确认
  await ev(`(function(){var b=document.querySelector('[data-act="dRandom"]');if(b)b.click();return 1})()`);
  await sleep(450);
  const randState = await ev(`document.querySelectorAll('.arr-pair').length`);
  ok('「随机配对」一次排满 4 桌', randState === 4, randState);

  await ev(`(function(){var b=document.querySelector('[data-act="dConfirm"]');if(b)b.click();return 1})()`);
  await sleep(700);
  const committed = await ev(`(function(){
    var st=TMS.current.stages[0];
    var rd=st.roundsData[0];
    return {rounds:st.roundsData.length, matches:rd?rd.matches.length:0, manual:rd?!!rd.manual:false,
      cards:document.querySelectorAll('.match').length, panel:!!document.querySelector('.arrcard')};
  })()`);
  console.log('    确认后：', JSON.stringify(committed));
  ok('确认后生成第 1 轮', committed.rounds === 1, committed.rounds);
  ok('本轮 4 桌', committed.matches === 4, committed.matches);
  ok('标记为手动编排', committed.manual === true, committed.manual);
  ok('页面上出现 4 张对阵卡', committed.cards === 4, committed.cards);

  /* ---------- 6. 导出页 ---------- */
  console.log('\n=== 6. 导出页 ===');
  await view('export');
  const exUI = await ev(`(function(){
    var txt=document.body.innerText;
    var acts=[].slice.call(document.querySelectorAll('[data-act]')).map(function(b){return b.getAttribute('data-act')});
    return {pdf:acts.filter(function(a){return /^pdf/.test(a)}),
      txt:txt, hasPdfBtn:/导出.*PDF/.test(txt)};
  })()`);
  console.log('    PDF 按钮：', JSON.stringify(exUI.pdf));
  ok('导出页有 3 个导出 PDF 按钮', exUI.pdf.length === 3, exUI.pdf);
  ok('按钮文案含「导出…PDF」', exUI.hasPdfBtn === true, exUI.hasPdfBtn);
  ok('提示里说明保存位置', /另存为|保存到|下载目录/.test(exUI.txt), (exUI.txt.match(/桌面版|手机版|浏览器/g) || []));
  await shot('v19_export.png');

  /* ---------- 7. 移动端布局 ---------- */
  console.log('\n=== 7. 移动端 390×844 ===');
  await conn.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true
  });
  await sleep(700);
  const mobile = await ev(`(function(){
    var tabs=document.querySelector('.tabs');
    var side=document.querySelector('.sidebar');
    var tab=document.querySelector('.tab');
    var btn=document.querySelector('.btn');
    var cs=getComputedStyle(tabs);
    var tr=tabs.getBoundingClientRect();
    return {
      tabPos: getComputedStyle(side).position,
      tabTop: Math.round(side.getBoundingClientRect().top),
      winH: window.innerHeight,
      tabH: tab?Math.round(tab.getBoundingClientRect().height):0,
      btnH: btn?Math.round(btn.getBoundingClientRect().height):0,
      tabsWrap: cs.flexWrap,
      tabsOverflow: cs.overflowX,
      tabsScrollable: tabs.scrollWidth > tabs.clientWidth + 1,
      tabCount: document.querySelectorAll('.tab').length,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  })()`);
  console.log('    移动端：', JSON.stringify(mobile));
  ok('导航区吸顶（sticky）', mobile.tabPos === 'sticky', mobile.tabPos);
  ok('导航在视口顶部', mobile.tabTop <= 2, mobile.tabTop);
  ok('标签一行不换行 + 可横滑', mobile.tabsWrap === 'nowrap' && mobile.tabsOverflow === 'auto', [mobile.tabsWrap, mobile.tabsOverflow]);
  ok('标签是胶囊按钮（≥28px 高）', mobile.tabH >= 28, mobile.tabH);
  ok('按钮高度 ≥ 34px（好点）', mobile.btnH >= 34, mobile.btnH);
  ok('页面没有横向溢出', mobile.overflowX <= 0, mobile.overflowX);
  await shot('v19_mobile_export.png');

  await view('matches');
  const mCard = await ev(`(function(){
    var ml=document.querySelector('.matchlist');
    if(!ml) return {n:0};
    var cs=getComputedStyle(ml);
    var cols=cs.gridTemplateColumns.split(' ').filter(Boolean);
    return {cols:cols.length, width:Math.round(ml.getBoundingClientRect().width),
      winW:window.innerWidth, cards:document.querySelectorAll('.match').length};
  })()`);
  console.log('    对阵列表：', JSON.stringify(mCard));
  ok('对阵卡片单列铺满', mCard.cols === 1 && mCard.width <= mCard.winW, mCard);
  await shot('v19_mobile_matches.png');

  /* 还原桌面视口 */
  await conn.send('Emulation.clearDeviceMetricsOverride');
  await sleep(400);

  /* ---------- 8. 无报错 ---------- */
  console.log('\n=== 8. 无 JS 报错 ===');
  const errs = await ev('window.__errs || []');
  console.log('    errors:', JSON.stringify(errs));
  ok('无 JS 报错', errs.length === 0, errs);

  console.log('\n================');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  console.log('================');
  try { conn.close(); } catch (e) {}
  try { env.child.kill(); } catch (e) {}
  process.exit(fail ? 1 : 0);
})();
