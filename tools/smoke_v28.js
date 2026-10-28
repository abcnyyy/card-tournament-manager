/**
 * v2.0 界面验证（第二轮）
 *  1. nvn 团体赛：每个回合可以换不同队员（选谁上就记谁）
 *  2. nvn：所有盘打完才结束，比分会是 2:1 之类
 *  3. nvn：有平盘时「平这盘」按钮 + 平局判定
 *  4. 征服：赢 2 盘不算赢，全员各赢一盘才结束
 *  5. 积分：计分方式三选一（按是否晋级是独立方式）
 *  6. 积分：阶段级「叠加 / 不叠加」下拉 + 积分榜重算
 *  7. 手机档无横向溢出
 *  8. 无脚本报错
 */
const path = require('path'), fs = require('fs');
const { launch, connect } = require('./headless');
const PORT = 9469;
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
async function openT(name) {
  await view('list');
  await sleep(350);
  return await ev(`(function(){
    var trs=[].slice.call(document.querySelectorAll('#view-list tbody tr'));
    var tr=trs.filter(function(r){return r.innerText.indexOf(${JSON.stringify(name)})>=0})[0];
    if(!tr) return 'none';
    tr.querySelector('[data-act="openT"]').click();
    return 'ok';
  })()`);
}
// 第 i 张对阵卡上的某个按钮
async function cardBtn(i, act, w) {
  const sel = '[data-act="' + act + '"]' + (w ? '[data-w="' + w + '"]' : '');
  return await ev(`(function(){
    var c=document.querySelectorAll('.match.mrow')[${i}];
    if(!c) return 'none';
    var b=c.querySelector(${JSON.stringify(sel)});
    if(!b) return 'nobtn';
    if(b.disabled) return 'disabled';
    b.click(); return 'ok';
  })()`);
}
// 第 i 张对阵卡上的队员下拉 / 输入框
async function cardVal(i, prefix, value) {
  return await ev(`(function(){
    var c=document.querySelectorAll('.match.mrow')[${i}];
    if(!c) return 'none';
    var el=c.querySelector('select[id^=${JSON.stringify(prefix)}]') || c.querySelector('input[id^=${JSON.stringify(prefix)}]');
    if(!el) return 'noel';
    ${value === null || value === undefined
      ? "return el.value;"
      : "el.value=" + JSON.stringify(String(value)) + ";el.dispatchEvent(new Event('change',{bubbles:true}));return el.value;"}
  })()`);
}
async function cardInfo(i) {
  return await ev(`(function(){
    var c=document.querySelectorAll('.match.mrow')[${i}];
    if(!c) return null;
    return {label:((c.querySelector('.mquick.team .qlabel')||{}).innerText||''),
      score:((c.querySelector('.bscore')||{}).innerText||'').replace(/\\s+/g,''),
      status:((c.querySelector('.mstat')||{}).innerText||'').replace(/\\s+/g,''),
      hint:((c.querySelector('.mquick.team .hint')||{}).innerText||''),
      rows:c.querySelectorAll('.boards .brow').length,
      hasDraw:!!c.querySelector('[data-act="addBoard"][data-w="D"]')};
  })()`);
}
function matchInfo(ti) {
  return ev(`(function(){
    var m=TMS.current.stages[0].roundsData[0].matches[${ti}];
    return {n:(m.games||[]).length, s:(m.games||[]).map(function(g){return g.s}),
      w:(m.games||[]).map(function(g){return g.w||'-'}),
      pa:(m.games||[]).map(function(g){return g.pa||'-'}),
      pb:(m.games||[]).map(function(g){return g.pb||'-'}),
      decided:!!m.decided, overtime:!!m.overtime,
      ga:(m.result||{}).gamesA, gb:(m.result||{}).gamesB,
      draws:(m.result||{}).draws, winner:(m.result||{}).winner,
      settled:(m.result||{}).settled};
  })()`);
}

const SCENE = fs.readFileSync(path.join(__dirname, 'build_v28_scene.js'), 'utf8');

async function waitReady() {
  for (let i = 0; i < 80; i++) {
    const st = await ev(`(function(){
      return (document.readyState === 'complete') && typeof TMS === 'object' &&
        !!TMS.engine && !!TMS.model && !!TMS.store && !!TMS.exporter;
    })()`);
    if (st === true) return true;
    await sleep(150);
  }
  return false;
}

(async () => {
  const env = await launch(PORT, path.join(__dirname, '..', 'app'));
  conn = await connect(PORT);
  await conn.send('Runtime.enable');
  await conn.send('Page.enable');

  if (!await waitReady()) throw new Error('页面没有就绪（TMS.engine 未加载）');
  await ev(SCENE);
  await ev('location.reload()');
  await sleep(1700);
  await waitReady();
  await ev(`window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message)+' @ '+e.lineno)});'ok'`);

  /* ================= 1. nvn：一场一桌，先排阵再录，可以换不同队员 ================= */
  console.log('\n=== 1. nvn：先排阵，再一场一场录 ===');
  ok('场景里有「nvn 回合赛」', (await openT('nvn 回合赛')) === 'ok');
  await view('matches');
  await sleep(500);

  async function bBtn(ci, si, w) {
    return await ev(`(function(){
      var c=document.querySelectorAll('.match.mrow')[${ci}];
      if(!c) return 'none';
      var b=c.querySelector('[data-act="addBoard"][data-s="${si}"][data-w="${w}"]');
      if(!b) return 'nobtn';
      if(b.disabled) return 'disabled';
      b.click(); return 'ok';
    })()`);
  }
  // 把第 si 场的某一侧换成某个队员
  async function setSlot(ci, si, side, id) {
    return await ev(`(function(){
      var c=document.querySelectorAll('.match.mrow')[${ci}];
      var rows=[].slice.call(c.querySelectorAll('.teamtab .tt-row'));
      var row=rows.filter(function(r){return !r.classList.contains('done')})[${si}] || rows[${si}];
      if(!row) return 'norow';
      var sels=[].slice.call(row.querySelectorAll('select'));
      var s=sels.filter(function(x){return x.getAttribute('data-tslot')==='${side}'})[0];
      if(!s) return 'nosel';
      s.value=${JSON.stringify('')}||'';
      s.value=${JSON.stringify(id)};
      s.dispatchEvent(new Event('change',{bubbles:true}));
      return s.value;
    })()`);
  }

  const n0 = await ev(`(function(){
    var c=document.querySelectorAll('.match.mrow')[0];
    var tab=c.querySelector('.teamtab');
    var rows=tab?[].slice.call(tab.querySelectorAll('.tt-row')):[];
    return {n:rows.length, no:(rows[0]||{}).innerText||'',
      sub:(tab||{}).innerText||'',
      off:!!(c.querySelector('[data-act="addBoard"]')||{}).disabled};
  })()`);
  ok('一场团体赛列出 3 场对局（一桌 = 一场）', n0.n === 3, n0.n);
  ok('第一行标「第 1 场」', /第 1 场/.test(n0.no), n0.no);
  ok('说明写「nvn 同时进行」「先把上场队员排好」', /nvn/.test(n0.sub) && /排好/.test(n0.sub), n0.sub);
  ok('未排阵时不能录成绩', n0.off === true);

  // 排阵：第 1 场 红-2 vs 白-3；第 2 场 红-1 vs 白-2；第 3 场 红-3 vs 白-1
  ok('排第 1 场 A 方（红-2）', (await setSlot(0, 0, 'a', 'mb_0_1')) === 'mb_0_1');
  await sleep(350);
  ok('排第 1 场 B 方（白-3）', (await setSlot(0, 0, 'b', 'mb_3_2')) === 'mb_3_2');
  await sleep(350);
  ok('排第 2 场 A 方（红-1）', (await setSlot(0, 1, 'a', 'mb_0_0')) === 'mb_0_0');
  await sleep(350);
  ok('排第 2 场 B 方（白-2）', (await setSlot(0, 1, 'b', 'mb_3_1')) === 'mb_3_1');
  await sleep(350);
  ok('排第 3 场 A 方（红-3）', (await setSlot(0, 2, 'a', 'mb_0_2')) === 'mb_0_2');
  await sleep(350);
  ok('排第 3 场 B 方（白-1）', (await setSlot(0, 2, 'b', 'mb_3_0')) === 'mb_3_0');
  await sleep(500);
  const lined = await ev(`(function(){
    var m=TMS.current.stages[0].roundsData[0].matches[0];
    var c=document.querySelector('.match.mrow');
    return {slots:(m.slots||[]).map(function(x){return x.pa+'>'+x.pb}).join(','),
      off:!!(c.querySelector('[data-act="addBoard"]')||{}).disabled};
  })()`);
  ok('三场对阵按手动排的记下来（每人一场）',
    lined.slots === 'mb_0_1>mb_3_2,mb_0_0>mb_3_1,mb_0_2>mb_3_0', lined.slots);
  ok('排完阵后成绩按钮放开', lined.off === false);

  ok('第 1 场红队胜', (await bBtn(0, 0, 'A')) === 'ok'); await sleep(450);
  ok('第 2 场白队胜', (await bBtn(0, 1, 'B')) === 'ok'); await sleep(450);
  const mid = await ev(`(function(){
    var m=TMS.current.stages[0].roundsData[0].matches[0];
    var c=document.querySelector('.match.mrow');
    return {decided:!!m.decided, ga:(m.result||{}).gamesA, gb:(m.result||{}).gamesB,
      st:(c.querySelector('.mstat')||{}).innerText||''};
  })()`);
  ok('1:1 还没结束（nvn 要打完全部场次）', mid.decided === false && mid.ga === 1 && mid.gb === 1, mid);

  // 第 3 场平局（阶段允许平局）
  ok('第 3 场判平（draw_ok 阶段有「平」按钮）', (await bBtn(0, 2, 'D')) === 'ok');
  await sleep(550);
  const fin = await ev(`(function(){
    var m=TMS.current.stages[0].roundsData[0].matches[0];
    var c=document.querySelector('.match.mrow');
    return {decided:!!m.decided, win:(m.result||{}).winner,
      ga:(m.result||{}).gamesA, gb:(m.result||{}).gamesB,
      drawn:(m.result||{}).draws,
      rows:c.querySelectorAll('.teamtab .tt-row.done').length,
      score:((c.querySelector('.bscore')||{}).innerText||'').replace(/\\s+/g,''),
      st:(c.querySelector('.mstat')||{}).innerText||'',
      pa:(m.games||[]).map(function(g){return g.pa}).join(','),
      pb:(m.games||[]).map(function(g){return g.pb}).join(',')};
  })()`);
  ok('三场打完、含一场平局 → 结算为平局', fin.decided === true && fin.win === null && fin.drawn === 1, fin);
  ok('大比分 1:1（平局不占赢场）', fin.ga === 1 && fin.gb === 1, fin);
  ok('对阵表里三场都有结果', fin.rows === 3, fin.rows);
  ok('主行显示 1 : 1', /1:1/.test(fin.score), fin.score);
  ok('三场派的是三对不同队员',
    fin.pa === 'mb_0_1,mb_0_0,mb_0_2' && fin.pb === 'mb_3_2,mb_3_1,mb_3_0', [fin.pa, fin.pb]);
  await shot('v28_nvn_rounds.png');

  /* ================= 2. 征服：全员各赢一场才结束 ================= */
  console.log('\n=== 2. 征服：全员各赢一场才结束 ===');
  ok('场景里有「征服赛」', (await openT('征服赛')) === 'ok');
  await view('matches');
  await sleep(500);
  const c0 = await ev(`(function(){
    var c=document.querySelectorAll('.match.mrow')[0];
    var tab=c.querySelector('.teamtab');
    var row=tab.querySelector('.tt-row');
    var sa=c.querySelector('select[id^="tsa_"]'), sb=c.querySelector('select[id^="tsb_"]');
    return {n:tab.querySelectorAll('.tt-row').length, no:(row.querySelector('.tt-n')||{}).innerText||'',
      ta:sa?sa.value:'', tb:sb?sb.value:'',
      sub:tab.innerText};
  })()`);
  ok('征服赛一开始只列当前这一场', c0.n === 1, c0.n);
  ok('征服赛说明「赢过的人必须换下」', /赢过/.test(c0.sub) && /换/.test(c0.sub), c0.sub);
  ok('默认双方第 1 位队员', c0.ta === 'mb_0_0' && c0.tb === 'mb_3_0', [c0.ta, c0.tb]);
  ok('不允许平局的阶段没有「平」按钮',
    (await ev(`!!document.querySelector('[data-act="addBoard"][data-w="D"]')`)) === false);

  ok('第 1 场红队胜', (await bBtn(0, 0, 'A')) === 'ok'); await sleep(450);
  ok('第 2 场红队胜（自动换下一位）', (await bBtn(0, 1, 'A')) === 'ok'); await sleep(450);
  const cc1 = await ev(`(function(){
    var m=TMS.current.stages[0].roundsData[0].matches[0];
    var c=document.querySelector('.match.mrow');
    return {decided:!!m.decided, n:(m.games||[]).length,
      pa:(m.games||[]).map(function(g){return g.pa}).join(','),
      rows:c.querySelectorAll('.teamtab .tt-row.done').length,
      nextNo:((c.querySelector('.teamtab .tt-row:not(.done) .tt-n')||{}).innerText||''),
      sub:(c.querySelector('.teamtab')||{}).innerText||''};
  })()`);
  ok('赢 2 场还不算赢（还有队员没出线）', cc1.decided === false && cc1.n === 2, cc1);
  ok('两个不同的队员各赢一场', cc1.pa === 'mb_0_0,mb_0_1', cc1.pa);
  ok('对阵表里保留前两场的结果（能看出第几场谁上、结果如何）', cc1.rows === 2, cc1.rows);
  ok('下一场自动排到第 3 位队员', /第 3 场/.test(cc1.nextNo), cc1.nextNo);

  ok('第 3 场红队胜 → 全员出线', (await bBtn(0, 2, 'A')) === 'ok'); await sleep(600);
  const cc2 = await ev(`(function(){
    var m=TMS.current.stages[0].roundsData[0].matches[0];
    var c=document.querySelector('.match.mrow');
    return {decided:!!m.decided, win:(m.result||{}).winner,
      ga:(m.result||{}).gamesA, gb:(m.result||{}).gamesB,
      pa:(m.games||[]).map(function(g){return g.pa}).join(','),
      score:((c.querySelector('.bscore')||{}).innerText||'').replace(/\\s+/g,'')};
  })()`);
  ok('三位队员各赢一场 → 红队获胜 3:0',
    cc2.decided === true && cc2.win === 'A' && cc2.ga === 3 && cc2.gb === 0, cc2);
  ok('三场派了三位不同队员', cc2.pa === 'mb_0_0,mb_0_1,mb_0_2', cc2.pa);
  ok('主行显示 3 : 0', /3:0/.test(cc2.score), cc2.score);
  await shot('v28_conquest.png');

  /* ================= 4. 积分：计分方式三选一 ================= */
  console.log('\n=== 4. 积分：按是否晋级是独立计分方式 ===');
  ok('场景里有「晋级分」赛事', (await openT('晋级分')) === 'ok');
  await view('setup');
  await sleep(550);
  const p0 = await ev(`(function(){
    var box=[].slice.call(document.querySelectorAll('#view-setup [data-bind]'));
    function by(p){return box.filter(function(i){return i.getAttribute('data-bind')===p})[0]}
    var mode=by('ptsRule.mode'), yes=by('ptsRule.adv.yes'), no=by('ptsRule.adv.no');
    var txt=document.getElementById('view-setup').innerText;
    return {mode:mode?mode.value:null,
      opts:mode?[].slice.call(mode.options).map(function(o){return o.value}):[],
      yes:yes?yes.value:null, no:no?no.value:null,
      hasAdvSwitch:!!by('ptsRule.adv.on'),
      hasStackSwitch:!!by('ptsRule.adv.add'),
      hasRankTier:/名次分档/.test(txt),
      hasWinBox:!!by('ptsRule.win.perWin'),
      txt:txt};
  })()`);
  ok('计分方式下拉就是三选一（rank / win / adv）',
    p0.opts.join(',') === 'rank,win,adv', p0.opts);
  ok('场景用的是「按是否晋级」', p0.mode === 'adv', p0.mode);
  ok('晋级分 30 / 未晋级 5', p0.yes === '30' && p0.no === '5', [p0.yes, p0.no]);
  ok('晋级分不再是「开关 + 叠加」两个独立项', p0.hasAdvSwitch === false && p0.hasStackSwitch === false, p0);
  ok('选晋级分时不显示名次分档 / 胜场分', p0.hasRankTier === false && p0.hasWinBox === false, p0);
  ok('说明里写了「最后一个阶段没有下一阶段可晋级」怎么办',
    /最后一个阶段/.test(p0.txt), true);

  /* ================= 5. 阶段级叠加 ================= */
  console.log('\n=== 5. 积分：阶段级叠加 / 不叠加 ===');
  const stk0 = await ev(`(function(){
    var s=document.querySelector('[data-bind="stages[0].ptsStack"]');
    return {val:s?s.value:null, opts:s?[].slice.call(s.options).map(function(o){return o.textContent.trim()}):[]};
  })()`);
  ok('阶段编辑器里有「本阶段的积分怎么合」下拉',
    stk0.val === 'inherit' && stk0.opts.length === 3, stk0);
  ok('下拉文案带出赛事默认（当前：叠加）', /当前：叠加/.test(stk0.opts[0]), stk0.opts[0]);

  const t0 = await ev(`(function(){
    var tp=TMS.engine.tournamentPoints(TMS.current);
    var o={}; tp.rows.forEach(function(r){o[r.name]=r.total}); return o;
  })()`);
  ok('默认叠加：甲 = 30+30+30 = 90', t0['甲'] === 90, t0['甲']);
  ok('乙 = 30+30+5 = 65', t0['乙'] === 65, t0['乙']);
  ok('第 1 阶段就被淘汰的人只有 5 分', t0['戊'] === 5, t0['戊']);

  // 第 3 阶段设「不叠加」
  await ev(`(function(){var el=document.querySelector('[data-act="gotoStage"][data-i="2"]');if(el)el.click();return 1})()`);
  await sleep(550);
  await ev(`(function(){
    var el=document.querySelector('[data-bind="stages[2].ptsStack"]');
    if(!el) return 'none';
    el.value='reset'; el.dispatchEvent(new Event('change',{bubbles:true})); return el.value;
  })()`);
  await sleep(550);
  const stkSet = await ev(`TMS.current.stages[2].ptsStack`);
  ok('第 3 阶段改成「不叠加」写回存档', stkSet === 'reset', stkSet);
  const t1 = await ev(`(function(){
    var tp=TMS.engine.tournamentPoints(TMS.current);
    var o={}; tp.rows.forEach(function(r){o[r.name]=r.total}); return o;
  })()`);
  ok('不叠加：甲只算第 3 阶段这一笔 = 30', t1['甲'] === 30, t1['甲']);
  ok('不叠加：乙只算未晋级的 5 分', t1['乙'] === 5, t1['乙']);
  ok('不叠加不影响没进这一阶段的人（丙仍是 35）', t1['丙'] === 35, t1['丙']);
  await shot('v28_stage_stack.png');

  // 赛事默认改成不叠加 → 未设置的阶段跟着变
  await ev(`(function(){
    var el=document.querySelector('[data-bind="ptsRule.stack"]');
    if(!el) return 'none';
    el.checked=false; el.dispatchEvent(new Event('change',{bubbles:true})); return 1;
  })()`);
  await sleep(550);
  await ev(`(function(){var el=document.querySelector('[data-act="gotoStage"][data-i="0"]');if(el)el.click();return 1})()`);
  await sleep(550);
  const inhTxt = await ev(`(function(){
    var s=document.querySelector('[data-bind="stages[0].ptsStack"]');
    return s?[].slice.call(s.options).map(function(o){return o.textContent.trim()})[0]:null;
  })()`);
  ok('取消赛事默认叠加后，下拉文案跟着变「当前：不叠加」', /当前：不叠加/.test(inhTxt || ''), inhTxt);
  const t2 = await ev(`(function(){
    var tp=TMS.engine.tournamentPoints(TMS.current);
    var o={}; tp.rows.forEach(function(r){o[r.name]=r.total}); return o;
  })()`);
  ok('改为默认不叠加后，丙只算第 2 阶段的 5 分', t2['丙'] === 5, t2['丙']);

  /* ================= 6. 积分榜展示 ================= */
  console.log('\n=== 6. 排名页积分榜 ===');
  await view('standing');
  await sleep(650);
  const sb = await ev(`(function(){
    var txt=document.getElementById('view-standing').innerText;
    var tp=TMS.engine.tournamentPoints(TMS.current);
    return {txt:txt, n:tp.rows.length,
      modes:tp.units.map(function(u){return u.mode}),
      advMark:/按是否晋级/.test(txt),
      advTag:/已晋级/.test(txt),
      stacks:tp.units.map(function(u){return u.stageStack})};
  })()`);
  ok('积分榜统计到 8 人', sb.n === 8, sb.n);
  ok('标题栏标出「按是否晋级」', sb.advMark === true);
  ok('晋级者打「已晋级」标签', sb.advTag === true);
  ok('每个阶段单元都标了用的计分方式', sb.modes.join(',') === 'adv,adv,adv', sb.modes);
  ok('阶段叠加方式按阶段记录（默认 / 默认 / 不叠加）',
    sb.stacks.join(',') === 'inherit,inherit,reset', sb.stacks);
  await shot('v28_pts_board.png');

  /* ================= 7. 手机档 ================= */
  console.log('\n=== 7. 手机档 390×844 ===');
  await openT('nvn 回合赛');
  await view('matches');
  await sleep(450);
  await conn.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(900);
  const mob = await ev(`(function(){
    var c=document.querySelector('.match.mrow');
    var q=c.querySelector('.teamtab');
    var r=q?q.getBoundingClientRect():{width:0,right:0};
    var sels=q?[].slice.call(q.querySelectorAll('select')):[];
    var over=sels.filter(function(x){return x.getBoundingClientRect().right>window.innerWidth+0.5}).length;
    return {ov:document.documentElement.scrollWidth-document.documentElement.clientWidth,
      qW:Math.round(r.width), qRight:Math.round(r.right), winW:window.innerWidth,
      cardW:Math.round(c.getBoundingClientRect().width),
      rows:q?q.querySelectorAll('.tt-row').length:0, overSel:over,
      label:(q&&q.querySelector('.tt-n')||{}).innerText||''};
  })()`);
  ok('手机档无横向溢出', mob.ov <= 0, mob.ov);
  ok('团体对阵表在屏幕内', mob.qW > 0 && mob.qRight <= mob.winW, mob);
  ok('手机档里没有下拉越界', mob.overSel === 0, mob);
  await ev(`(function(){var c=document.querySelector('.match.mrow');c.scrollIntoView({block:'start'});return 1})()`);
  await sleep(450);
  await shot('v28_mobile_team.png');
  await conn.send('Emulation.clearDeviceMetricsOverride');
  await sleep(400);

  /* ================= 8. 无报错 ================= */
  console.log('\n=== 8. 无 JS 报错 ===');
  const errs = await ev('window.__errs || []');
  console.log('    errors:', JSON.stringify(errs));
  ok('全程无 JS 报错', errs.length === 0, errs);

  console.log('\n----------------------------------------');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  console.log('----------------------------------------');
  conn.close();
  env.child.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('EXCEPTION: ' + e.message); process.exit(2); });
