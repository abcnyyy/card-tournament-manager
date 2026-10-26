/**
 * v1.14.1 界面验证
 *  1. 常显快捷录入：不展开明细就能在行右侧填分 / 判胜负 / 撤销
 *  2. 征服赛制：赢过的人不能再上（候选里自动消失），负方默认继续、也可手动换人
 *  3. nvn 批量录入：面板列出所有未打的盘，一次提交
 *  4. 积分规则：按是否晋级下一阶段给分（开关 / 分值 / 叠加）
 *  5. 团体赛排名：大比分按场、个人小局只进小分
 *  6. 手机档无横向溢出
 *  7. 无脚本报错
 */
const path = require('path'), fs = require('fs');
const { launch, connect } = require('./headless');
const PORT = 9468;
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
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}
async function view(v) {
  await ev(`(function(){var el=document.querySelector('[data-view="${v}"]');if(el){el.click();return 1}return 0})()`);
  await sleep(450);
}
async function click(sel) {
  return await ev(`(function(){var el=document.querySelector(${JSON.stringify(sel)});if(!el)return 'none';el.click();return 'ok'})()`);
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
function fill(sel, v) {
  return `(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return 'none';e.value=${JSON.stringify(String(v))};return e.value})()`;
}

const SCENE = fs.readFileSync(path.join(__dirname, 'build_v27_scene.js'), 'utf8');

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

  /* ================= 1. 常显快捷录入（个人赛） ================= */
  console.log('\n=== 1. 个人赛：快捷录入常显在行右侧 ===');
  ok('场景里有「个人 · 8 人瑞士轮」', (await openT('个人 · 8')) === 'ok');
  await view('matches');
  await sleep(500);
  const q1 = await ev(`(function(){
    var c=document.querySelector('.match.mrow');
    var det=c.querySelector('.mrow-detail');
    var q=c.querySelector('.mquick');
    function vis(el){ if(!el) return false; var r=el.getBoundingClientRect(); return r.width>0 && r.height>0 }
    return {
      detailHidden:getComputedStyle(det).display==='none',
      hasQ:!!q, quickVisible:vis(q),
      qaW:vis(c.querySelector('input[id^="qa_"]')),
      apply:vis(c.querySelector('[data-act="applyScore"]')),
      winA:vis(c.querySelector('[data-act="addGame"][data-w="A"]')),
      winB:vis(c.querySelector('[data-act="addGame"][data-w="B"]')),
      draw:vis(c.querySelector('[data-act="addGame"][data-w="D"]')),
      undo:vis(c.querySelector('[data-act="undoGame"]'))
    };
  })()`);
  ok('明细区默认收起（不用展开）', q1.detailHidden === true, q1.detailHidden);
  ok('行内出现快捷录入区', q1.hasQ === true && q1.quickVisible === true, q1);
  ok('比分输入 + 结算 + 胜/平/撤销 全部可见',
    q1.qaW && q1.apply && q1.winA && q1.winB && q1.draw && q1.undo, q1);
  await shot('v27_quick_row.png');

  // 点「A 胜」两次 → 该场结束，比分 2:0
  await click('[data-act="addGame"][data-w="A"]');
  await sleep(400);
  await click('[data-act="addGame"][data-w="A"]');
  await sleep(550);
  const s1 = await ev(`(function(){
    var m=TMS.current.stages[0].roundsData[0].matches[0];
    var c=document.querySelector('.match.mrow');
    return {games:(m.games||[]).length, decided:!!m.decided,
      score:((c.querySelector('.bscore')||{}).innerText||'').replace(/\\s+/g,''),
      undoVisible:(function(){var u=c.querySelector('[data-act="undoGame"]');var r=u.getBoundingClientRect();return r.width>0&&r.height>0})()};
  })()`);
  ok('两下「A 胜」就打完这场（2:0，不用展开明细）',
    s1.games === 2 && s1.decided === true && /2:0/.test(s1.score), s1);
  ok('打完后仍能一键撤销上局', s1.undoVisible === true, s1);

  await click('[data-act="undoGame"]');
  await sleep(450);
  const s2 = await ev(`TMS.current.stages[0].roundsData[0].matches[0].games.length`);
  ok('撤销上局生效（回到 1 局）', s2 === 1, s2);

  /* ================= 2. 征服赛制 ================= */
  console.log('\n=== 2. 征服赛制：先定人、再录；赢者必须换人 ===');

  // 点第 ci 张卡上第 si 场的按钮 / 读某一行的下拉
  async function boardBtn(ci, si, w) {
    return await ev(`(function(){
      var c=document.querySelectorAll('.match.mrow')[${ci}];
      if(!c) return 'none';
      var b=c.querySelector('[data-act="addBoard"][data-s="${si}"][data-w="${w}"]');
      if(!b) return 'nobtn';
      if(b.disabled) return 'disabled';
      b.click(); return 'ok';
    })()`);
  }

  ok('场景里有「征服赛 · 4 队」', (await openT('征服赛')) === 'ok');
  await view('matches');
  await sleep(500);
  const c0 = await ev(`(function(){
    var c=document.querySelector('.match.mrow');
    var tab=c.querySelector('.teamtab');
    if(!tab) return {tab:false};
    var row=tab.querySelector('.tt-row');
    var sa=c.querySelector('select[id^="tsa_"]'), sb=c.querySelector('select[id^="tsb_"]');
    return {tab:true, rows:tab.querySelectorAll('.tt-row').length,
      ta:sa?sa.value:'', tb:sb?sb.value:'',
      firstNo:(row.querySelector('.tt-n')||{}).innerText||'',
      hint:/征服/.test(tab.innerText)};
  })()`);
  ok('团体赛卡片下有对阵表（一场一行）', c0.tab === true && c0.rows === 1, c0);
  ok('第一场标注「第 1 场」', /第 1 场/.test(c0.firstNo || ''), c0.firstNo);
  ok('征服赛先给出默认上场的人（双方第 1 位）', c0.ta === 'mb_0_0' && c0.tb === 'mb_3_0', c0);
  ok('说明写了征服规则（赢的人必须换下）', c0.hint === true);

  ok('录第 1 场（红队胜）', (await boardBtn(0, 0, 'A')) === 'ok');
  await sleep(500);
  const c1 = await ev(`(function(){
    var m=TMS.current.stages[0].roundsData[0].matches[0];
    var c=document.querySelector('.match.mrow');
    var sels=[].slice.call(c.querySelectorAll('.teamtab .tt-row:not(.done) select'));
    var sa=sels.filter(function(x){return /^tsa_/.test(x.id)})[0];
    var sb=sels.filter(function(x){return /^tsb_/.test(x.id)})[0];
    var opts=function(s){return s?[].slice.call(s.options).map(function(o){return o.value}).filter(Boolean):[]};
    return {n:(m.games||[]).length,
      doneRows:c.querySelectorAll('.teamtab .tt-row.done').length,
      optsA:opts(sa), optsB:opts(sb),
      ta:sa?sa.value:'', tb:sb?sb.value:'',
      nextNo:((c.querySelectorAll('.teamtab .tt-row:not(.done) .tt-n')[0]||{}).innerText||'')};
  })()`);
  ok('录完一场 → 自动出现第 2 场', c1.n === 1 && c1.doneRows === 1 && /第 2 场/.test(c1.nextNo), c1);
  ok('赢过的人从候选里消失（只剩另外两位）',
    c1.optsA.length === 2 && c1.optsA.indexOf('mb_0_0') < 0, c1.optsA);
  ok('下一场自动派第 2 位队员', c1.ta === 'mb_0_1', c1.ta);
  ok('负方三人仍全部可选（可以继续也可以换人）',
    c1.optsB.length === 3 && c1.optsB.indexOf('mb_3_0') >= 0, c1.optsB);
  ok('负方默认仍是刚才那位', c1.tb === 'mb_3_0', c1.tb);
  await shot('v27_conquest.png');

  /* ================= 3. nvn：先排阵，再逐场录 ================= */
  console.log('\n=== 3. nvn：先把整场对阵排好，再录成绩 ===');
  ok('场景里有「批量赛」', (await openT('批量赛')) === 'ok');
  await view('matches');
  await sleep(500);
  const b0 = await ev(`(function(){
    var c=document.querySelector('.match.mrow');
    var tab=c.querySelector('.teamtab');
    return {rows:tab?tab.querySelectorAll('.tt-row').length:0,
      off:!!(c.querySelector('[data-act="addBoard"]')||{}).disabled,
      auto:!!c.querySelector('[data-act="autoLineup"]')};
  })()`);
  ok('nvn 一开始就把 3 场都列出来（同时进行）', b0.rows === 3, b0);
  ok('没排阵前不能录成绩', b0.off === true, b0);
  ok('有「按名单排阵」按钮', b0.auto === true);

  await ev(`(function(){document.querySelector('[data-act="autoLineup"]').click();return 1})()`);
  await sleep(550);
  const b1 = await ev(`(function(){
    var m=TMS.current.stages[0].roundsData[0].matches[0];
    return {slots:(m.slots||[]).length,
      s0:(m.slots[0]||{}).pa+'-'+(m.slots[0]||{}).pb,
      s1:(m.slots[1]||{}).pa+'-'+(m.slots[1]||{}).pb,
      s2:(m.slots[2]||{}).pa+'-'+(m.slots[2]||{}).pb,
      off:!!(document.querySelector('[data-act="addBoard"]')||{}).disabled};
  })()`);
  ok('「按名单排阵」把 3 场全部排好', b1.slots === 3, b1);
  ok('第 1 场 红-1 vs 白-1、第 2 场 红-2 vs 白-2',
    b1.s0 === 'mb_0_0-mb_3_0' && b1.s1 === 'mb_0_1-mb_3_1', b1);
  ok('排完之后成绩按钮放开', b1.off === false, b1);

  // 已被第 3 场占用的队员，不会出现在第 2 场的候选里（nvn 一人一场）
  const dup = await ev(`(function(){
    var m=TMS.current.stages[0].roundsData[0].matches[0];
    var rows=[].slice.call(document.querySelectorAll('.teamtab .tt-row'));
    var sels=[].slice.call(rows[1].querySelectorAll('select'));
    var sb=sels.filter(function(x){return /^tsb_/.test(x.id)})[0];
    return {opts:[].slice.call(sb.options).map(function(o){return o.value}).filter(Boolean),
      guard:TMS.engine.teamCanField(TMS.current, m, 'B', 'mb_3_2', 1)};
  })()`);
  ok('第 2 场的候选里没有已被第 3 场占用的白-3',
    dup.opts.length === 1 && dup.opts[0] === 'mb_3_1', dup.opts);
  ok('引擎校验同样拦下（一人只能上一场）', dup.guard === false, dup.guard);

  // 先清空第 3 场的白方，再把第 2 场换成白-3
  await ev(`(function(){
    var c=document.querySelector('.match.mrow');
    var rows=[].slice.call(c.querySelectorAll('.teamtab .tt-row'));
    var sels=[].slice.call(rows[2].querySelectorAll('select'));
    var sb=sels.filter(function(x){return /^tsb_/.test(x.id)})[0];
    sb.value='';
    sb.dispatchEvent(new Event('change',{bubbles:true}));
    return 1;
  })()`);
  await sleep(500);
  const half = await ev(`(function(){
    var m=TMS.current.stages[0].roundsData[0].matches[0];
    return {pb3:(m.slots[2]||{}).pb,
      off:!!(document.querySelector('[data-act="addBoard"]')||{}).disabled,
      tip:/还要排好/.test(document.querySelector('.teamtab').innerText)};
  })()`);
  ok('清空一场的上场人 → 又变成「不能录」', half.off === true && half.pb3 === '', half);
  ok('提示里写明还差几场没排', half.tip === true, half);

  await ev(`(function(){
    var c=document.querySelector('.match.mrow');
    var rows=[].slice.call(c.querySelectorAll('.teamtab .tt-row'));
    var sels=[].slice.call(rows[1].querySelectorAll('select'));
    var sb=sels.filter(function(x){return /^tsb_/.test(x.id)})[0];
    sb.value='mb_3_2';
    sb.dispatchEvent(new Event('change',{bubbles:true}));
    return 1;
  })()`);
  await sleep(500);
  const swapped = await ev(`(function(){
    var m=TMS.current.stages[0].roundsData[0].matches[0];
    var rows=[].slice.call(document.querySelectorAll('.teamtab .tt-row'));
    var sels=[].slice.call(rows[2].querySelectorAll('select'));
    var sb=sels.filter(function(x){return /^tsb_/.test(x.id)})[0];
    return {s1:(m.slots[1]||{}).pa+'-'+(m.slots[1]||{}).pb,
      opts3:[].slice.call(sb.options).map(function(o){return o.value}).filter(Boolean)};
  })()`);
  ok('腾出来之后，第 2 场能换成白-3', swapped.s1 === 'mb_0_1-mb_3_2', swapped.s1);
  ok('第 3 场的候选只剩没被占用的白-2', swapped.opts3.join(',') === 'mb_3_1', swapped.opts3);

  await ev(`(function(){
    var c=document.querySelector('.match.mrow');
    var rows=[].slice.call(c.querySelectorAll('.teamtab .tt-row'));
    var sels=[].slice.call(rows[2].querySelectorAll('select'));
    var sb=sels.filter(function(x){return /^tsb_/.test(x.id)})[0];
    sb.value='mb_3_1';
    sb.dispatchEvent(new Event('change',{bubbles:true}));
    return 1;
  })()`);
  await sleep(550);
  const ready = await ev(`(function(){
    var m=TMS.current.stages[0].roundsData[0].matches[0];
    return {s2:(m.slots[2]||{}).pa+'-'+(m.slots[2]||{}).pb,
      off:!!(document.querySelector('[data-act="addBoard"]')||{}).disabled};
  })()`);
  ok('补齐第 3 场（红-3 vs 白-2）→ 又能录了',
    ready.s2 === 'mb_0_2-mb_3_1' && ready.off === false, ready);
  await shot('v27_nvn_lineup.png');

  // A 胜 / B 胜 / A 胜 → 2:1
  ok('第 1 场红队胜', (await boardBtn(0, 0, 'A')) === 'ok'); await sleep(400);
  ok('第 2 场白队胜', (await boardBtn(0, 1, 'B')) === 'ok'); await sleep(400);
  ok('第 3 场红队胜', (await boardBtn(0, 2, 'A')) === 'ok'); await sleep(550);
  const b2 = await ev(`(function(){
    var m=TMS.current.stages[0].roundsData[0].matches[0];
    var c=document.querySelector('.match.mrow');
    return {boards:(m.games||[]).length, decided:!!m.decided,
      w:(m.games||[]).map(function(g){return g.w}).join(','),
      pa:(m.games||[]).map(function(g){return g.pa}).join(','),
      score:((c.querySelector('.bscore')||{}).innerText||'').replace(/\\s+/g,'')};
  })()`);
  ok('三场分别录入，胜方 A/B/A', b2.boards === 3 && b2.w === 'A,B,A', b2);
  ok('三场派了三位不同队员', b2.pa === 'mb_0_0,mb_0_1,mb_0_2', b2.pa);
  ok('大比分 2:1（赢场数）', /2:1/.test(b2.score), b2.score);

  /* ================= 4. 晋级制计分 ================= */
  console.log('\n=== 4. 积分规则：按是否晋级下一阶段给分（独立计分方式） ===');
  ok('场景里有「晋级制」赛事', (await openT('晋级制')) === 'ok');
  await view('setup');
  await sleep(500);
  const p0 = await ev(`(function(){
    var box=[].slice.call(document.querySelectorAll('#view-setup [data-bind]'));
    function by(p){return box.filter(function(i){return i.getAttribute('data-bind')===p})[0]}
    var mode=by('ptsRule.mode'), yes=by('ptsRule.adv.yes'), no=by('ptsRule.adv.no');
    return {mode:mode?mode.value:null, yes:yes?yes.value:null, no:no?no.value:null,
      hasAdvOpt: mode ? [].slice.call(mode.options).some(function(o){return o.value==='adv'}) : false,
      hasRankTier: /名次分档/.test(document.getElementById('view-setup').innerText),
      text:/按是否晋级下一阶段给分/.test(document.getElementById('view-setup').innerText)};
  })()`);
  ok('设置页出现「按是否晋级下一阶段给分」', p0.text === true);
  ok('计分方式下拉里有「按是否晋级」这一项（不是单独的开关）', p0.hasAdvOpt === true);
  ok('场景的计分方式 = 按是否晋级，分值 30 / 5', p0.mode === 'adv' && p0.yes === '30' && p0.no === '5', p0);
  ok('选「按是否晋级」时不再显示名次分档', p0.hasRankTier === false);

  // 积分榜：晋级的人 = 30 分，没晋级 = 5 分（不与名次分相加）
  await view('standing');
  await sleep(600);
  const st1 = await ev(`(function(){
    var tp=TMS.engine.tournamentPoints(TMS.current);
    return {n:tp.rows.length,
      txt:document.getElementById('view-standing').innerText,
      totals:tp.rows.map(function(r){return [r.name, r.total]}),
      units:tp.rows.map(function(r){var u=r.units['s0']||{};return [r.name, u.pts, u.adv]})};
  })()`);
  ok('积分榜统计到 8 人', st1.n === 8, st1.n);
  ok('标题栏标出「按是否晋级」', /按是否晋级/.test(st1.txt), st1.txt && st1.txt.slice(0, 80));
  ok('页面上给晋级者打「已晋级」标签', /已晋级/.test(st1.txt));
  const advRows = (st1.units || []).filter(x => x[2] === true);
  const noAdvRows = (st1.units || []).filter(x => x[2] === false);
  ok('4 人晋级、4 人没晋级', advRows.length === 4 && noAdvRows.length === 4, st1.units);
  ok('晋级者 = 30 分（只算晋级分）', advRows.every(x => x[1] === 30), advRows);
  ok('没晋级的人 = 5 分', noAdvRows.every(x => x[1] === 5), noAdvRows);
  await shot('v27_pts_adv.png');

  // 计分方式改成「按名次」→ 变成名次分（晋级分不再参与）
  await view('setup');
  await sleep(450);
  await ev(`(function(){
    var el=document.querySelector('[data-bind="ptsRule.mode"]');
    el.value='rank'; el.dispatchEvent(new Event('change',{bubbles:true})); return 1})()`);
  await sleep(500);
  const st2 = await ev(`(function(){
    var tp=TMS.engine.tournamentPoints(TMS.current);
    return {totals:tp.rows.map(function(r){return r.total})};
  })()`);
  ok('改成按名次后回到名次分（不再是 30 / 5）',
    st2.totals.indexOf(30) < 0 && st2.totals.indexOf(5) < 0 &&
    st2.totals.indexOf(100) >= 0 && st2.totals.indexOf(65) >= 0, st2.totals);
  await ev(`(function(){
    var el=document.querySelector('[data-bind="ptsRule.mode"]');
    el.value='adv'; el.dispatchEvent(new Event('change',{bubbles:true})); return 1})()`);
  await sleep(400);

  /* ================= 5. 团体赛排名口径 ================= */
  console.log('\n=== 5. 团体赛排名：大比分按场、个人小局只进小分 ===');
  ok('切到「批量赛」', (await openT('批量赛')) === 'ok');
  await view('standing');
  await sleep(600);
  const t1 = await ev(`(function(){
    var txt=document.getElementById('view-standing').innerText;
    var tabs=[].slice.call(document.querySelectorAll('#view-standing table.compact'));
    var tab=tabs.filter(function(t){return /赢场-输场|个人小局/.test(t.innerText)})[0]||tabs[0];
    var ths=[].slice.call(tab.querySelectorAll('thead th')).map(function(t){return t.innerText.trim()});
    var rows=[].slice.call(tab.querySelectorAll('tbody tr')).map(function(r){
      return [].slice.call(r.querySelectorAll('td')).map(function(td){return td.innerText.trim()});
    });
    return {ths:ths, note:/大比分 = 赢下的场数/.test(txt), rows:rows};
  })()`);
  ok('团体赛名次表按「场」列名（队伍 / 赢场-输场）',
    t1.ths.indexOf('赢场-输场') >= 0 && t1.ths.indexOf('队伍') >= 0, t1.ths);
  ok('有说明：大比分 = 赢下的场数（个人小局只算小分）', t1.note === true);
  const winRow = t1.rows.filter(r => r[1] === '红队')[0] || [];
  ok('红队赢场 2-1（场数就是大比分）', winRow.join('|').indexOf('2-1') >= 0, winRow);
  await shot('v27_team_standing.png');

  /* ================= 6. 手机档 ================= */
  console.log('\n=== 6. 手机档 390×844 ===');
  await view('matches');
  await sleep(400);
  await conn.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(800);
  const mob = await ev(`(function(){
    var c=document.querySelector('.match.mrow');
    var q=c.querySelector('.teamtab');
    var r=q?q.getBoundingClientRect():{width:0,right:0};
    var rows=q?q.querySelectorAll('.tt-row').length:0;
    var sel=q?q.querySelector('select'):null;
    var sr=sel?sel.getBoundingClientRect():{right:0};
    return {ov:document.documentElement.scrollWidth-document.documentElement.clientWidth,
      qW:Math.round(r.width), qRight:Math.round(r.right), winW:window.innerWidth,
      cardW:Math.round(c.getBoundingClientRect().width), rows:rows,
      selRight:Math.round(sr.right)};
  })()`);
  ok('手机档无横向溢出', mob.ov <= 0, mob.ov);
  ok('团体对阵表在屏幕内', mob.qW > 0 && mob.qRight <= mob.winW, mob);
  ok('手机档里上场队员下拉也不越界', mob.selRight <= mob.winW, mob);
  await ev(`(function(){var c=document.querySelector('.match.mrow');c.scrollIntoView({block:'start'});return 1})()`);
  await sleep(450);
  await shot('v27_mobile.png');
  await conn.send('Emulation.clearDeviceMetricsOverride');
  await sleep(400);

  /* ================= 7. 无报错 ================= */
  console.log('\n=== 7. 无 JS 报错 ===');
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
