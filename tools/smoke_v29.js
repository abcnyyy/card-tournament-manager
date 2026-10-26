/**
 * v2.1 界面验收 —— 团体赛「一桌 = 一场比赛」
 *  1. 设置页：每方上场人数（队员不一定等于上场人数）
 *  2. nvn：改上场人数 → 只打那么多场；排阵后才允许录
 *  3. nvn：逐场录完出结果（2:0），对阵表保留每场记录
 *  4. KOF：赢者留场、输者换人；打到对方全灭才结束
 *  5. 对阵表常显（已结束也保留）+ 打印不打印控件
 *  6. 手机档无横向溢出
 *  7. 全程无 JS 报错
 */
const path = require('path'), fs = require('fs');
const { launch, connect } = require('./headless');
const PORT = 9471;
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
async function bBtn(si, w) {
  return await ev(`(function(){
    var c=document.querySelectorAll('.match.mrow')[0];
    if(!c) return 'none';
    var b=c.querySelector('[data-act="addBoard"][data-s="${si}"][data-w="${w}"]');
    if(!b) return 'nobtn';
    if(b.disabled) return 'disabled';
    b.click(); return 'ok';
  })()`);
}
async function setSlot(si, side, id) {
  return await ev(`(function(){
    var c=document.querySelectorAll('.match.mrow')[0];
    var rows=[].slice.call(c.querySelectorAll('.teamtab .tt-row'));
    var row=rows.filter(function(r){return !r.classList.contains('done')})[${si}] || rows[${si}];
    if(!row) return 'norow';
    var sels=[].slice.call(row.querySelectorAll('select'));
    var s=sels.filter(function(x){return x.getAttribute('data-tslot')==='${side}'})[0];
    if(!s) return 'nosel';
    s.value=${JSON.stringify(id)};
    s.dispatchEvent(new Event('change',{bubbles:true}));
    return s.value;
  })()`);
}
async function tabInfo() {
  return await ev(`(function(){
    var c=document.querySelectorAll('.match.mrow')[0];
    var tab=c.querySelector('.teamtab');
    if(!tab) return {tab:false};
    var rows=[].slice.call(tab.querySelectorAll('.tt-row'));
    return {tab:true, n:rows.length,
      done:tab.querySelectorAll('.tt-row.done').length,
      nos:rows.map(function(r){return (r.querySelector('.tt-n')||{}).innerText||''}),
      txt:tab.innerText,
      off:!!(c.querySelector('[data-act="addBoard"]')||{}).disabled,
      noPrint:tab.classList.contains('noprint'),
      score:((c.querySelector('.bscore')||{}).innerText||'').replace(/\\\\s+/g,'')};
  })()`);
}

const SCENE = fs.readFileSync(path.join(__dirname, 'build_v29_scene.js'), 'utf8');

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
  await launch(PORT, path.join(__dirname, '..', 'app'));
  conn = await connect(PORT);
  await conn.send('Runtime.enable');
  await conn.send('Page.enable');

  if (!await waitReady()) throw new Error('页面没有就绪（TMS.engine 未加载）');
  await ev(SCENE);
  await ev('location.reload()');
  await sleep(1700);
  await waitReady();
  await ev(`window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message)+' @ '+e.lineno)});'ok'`);

  /* ================= 1. 设置页：每方上场人数 ================= */
  console.log('\n=== 1. 设置页：每方上场人数 ===');
  ok('能打开「nvn 上场人数赛」', (await openT('nvn 上场人数赛')) === 'ok');
  await view('setup');
  await sleep(400);
  const cfg0 = await ev(`(function(){
    var q=function(s){var e=document.querySelector(s);return e?e.value:null};
    var txt=document.getElementById('view-setup').innerText;
    return {play:q('[data-bind="team.playSize"]'), size:q('[data-bind="team.size"]'),
      tip:/队员不一定等于上场人数/.test(txt), one:/一桌 = 一场比赛/.test(txt),
      order:/先定人/.test(txt) && /再录成绩/.test(txt)};
  })()`);
  ok('有「每方上场人数」字段（默认 0 = 全员）', cfg0.play === '0', cfg0.play);
  ok('说明「队员不一定等于上场人数」', cfg0.tip === true);
  ok('说明「一桌 = 一场比赛」', cfg0.one === true);
  ok('说明录入顺序「先定人、再录成绩」', cfg0.order === true);

  // 改成 2：3 人的队只上 2 人
  await ev(`(function(){
    var e=document.querySelector('[data-bind="team.playSize"]');
    e.value='2'; e.dispatchEvent(new Event('change',{bubbles:true})); return 1;
  })()`);
  await sleep(600);
  await view('matches');
  await sleep(500);
  const t2 = await tabInfo();
  ok('上场人数改 2 → 只打 2 场（第 3 人这场不打）', t2.n === 2, t2.n);
  ok('提示里写「还要排好 2 场」', /还要排好剩下 2 场/.test(t2.txt), t2.txt.slice(0, 80));
  ok('没排阵前不能录成绩', t2.off === true);
  await shot('v29_play2.png');

  /* ================= 2. nvn：排阵 → 逐场录 → 出结果 ================= */
  console.log('\n=== 2. nvn：排阵 → 逐场录 ===');
  ok('排第 1 场 红-2 vs 白-3', (await setSlot(0, 'a', 'mb_0_1')) === 'mb_0_1');
  await sleep(350);
  ok('排第 1 场 B 方', (await setSlot(0, 'b', 'mb_1_2')) === 'mb_1_2');
  await sleep(350);
  ok('排第 2 场 红-3 vs 白-1', (await setSlot(1, 'a', 'mb_0_2')) === 'mb_0_2');
  await sleep(350);
  ok('排第 2 场 B 方', (await setSlot(1, 'b', 'mb_1_0')) === 'mb_1_0');
  await sleep(550);
  const ready = await tabInfo();
  ok('两场都排好了 → 可以录成绩', ready.off === false, ready);

  ok('第 1 场红队胜', (await bBtn(0, 'A')) === 'ok');
  await sleep(450);
  const one = await ev(`(function(){
    var m=TMS.current.stages[0].roundsData[0].matches[0];
    return {decided:!!m.decided, ga:(m.result||{}).gamesA, gb:(m.result||{}).gamesB};
  })()`);
  ok('只赢 1 场还没结束（nvn 打满再比）', one.decided === false && one.ga === 1, one);

  ok('第 2 场白队胜', (await bBtn(1, 'B')) === 'ok');
  await sleep(600);
  const two = await ev(`(function(){
    var m=TMS.current.stages[0].roundsData[0].matches[0];
    var c=document.querySelectorAll('.match.mrow')[0];
    return {decided:!!m.decided, win:(m.result||{}).winner,
      ga:(m.result||{}).gamesA, gb:(m.result||{}).gamesB,
      pa:(m.games||[]).map(function(g){return g.pa}).join(','),
      pb:(m.games||[]).map(function(g){return g.pb}).join(','),
      score:((c.querySelector('.bscore')||{}).innerText||'').replace(/\\\\s+/g,'')};
  })()`);
  ok('两场打完 1:1 → 按平局规则处理（sudden_death 要加赛）',
    two.decided === false, two);
  ok('两场分别是排好的那两个人',
    two.pa === 'mb_0_1,mb_0_2' && two.pb === 'mb_1_2,mb_1_0', [two.pa, two.pb]);
  ok('第 3 人没上场（上场人数 2）', two.pa.indexOf('mb_0_0') < 0, two.pa);

  // 加赛第 3 场（允许超出原定场数）
  const extra = await ev(`(function(){
    var c=document.querySelectorAll('.match.mrow')[0];
    var btns=[].slice.call(c.querySelectorAll('[data-act="addBoard"]'));
    return {n:btns.length, dis:btns.filter(function(b){return b.disabled}).length};
  })()`);
  ok('平局加赛：又出现可以录的场次', extra.n >= 2 && extra.dis === 0, extra);

  const exRow = await ev(`(function(){
    var c=document.querySelectorAll('.match.mrow')[0];
    var tab=c.querySelector('.teamtab');
    var rows=[].slice.call(tab.querySelectorAll('.tt-row'));
    var last=rows[rows.length-1];
    var sels=last?[].slice.call(last.querySelectorAll('select')):[];
    var sa=sels.filter(function(x){return x.getAttribute('data-tslot')==='a'})[0];
    return {no:(last.querySelector('.tt-n')||{}).innerText||'',
      optsA:sa?[].slice.call(sa.options).map(function(o){return o.value}).filter(Boolean):[],
      valA:sa?sa.value:'',
      ft:(tab.querySelector('.tt-ft')||{}).innerText||''};
  })()`);
  ok('加赛行标出「加赛 · 第 3 场」', /加赛/.test(exRow.no), exRow.no);
  ok('加赛可以重新派人（候选里三个人都在）', exRow.optsA.length === 3, exRow.optsA);
  ok('加赛行自动给出默认人选', exRow.valA === 'mb_0_0', exRow.valA);
  ok('表尾提示「加赛一场」定胜负', /加赛/.test(exRow.ft), exRow.ft);
  await shot('v29_nvn_done.png');

  // 加赛一场定胜负
  const exDone = await ev(`(function(){
    var c=document.querySelectorAll('.match.mrow')[0];
    var rows=[].slice.call(c.querySelectorAll('.teamtab .tt-row'));
    var last=rows[rows.length-1];
    var b=last.querySelector('[data-act="addBoard"][data-w="A"]');
    if(!b) return 'nobtn';
    if(b.disabled) return 'disabled';
    b.click(); return 'ok';
  })()`);
  ok('加赛一场可以录（按钮可用）', exDone === 'ok', exDone);
  await sleep(600);
  const exOut = await ev(`(function(){
    var m=TMS.current.stages[0].roundsData[0].matches[0];
    var c=document.querySelectorAll('.match.mrow')[0];
    return {decided:!!m.decided, win:(m.result||{}).winner,
      ga:(m.result||{}).gamesA, gb:(m.result||{}).gamesB,
      n:(m.games||[]).length,
      score:((c.querySelector('.bscore')||{}).innerText||'').replace(/\s+/g,''),
      st:(c.querySelector('.mstat')||{}).innerText||''};
  })()`);
  ok('加赛一场后定胜负（2:1）', exOut.decided === true && exOut.win === 'A' && exOut.ga === 2, exOut);
  ok('加赛结果留在表里（共 3 场记录）', exOut.n === 3, exOut.n);
  await shot('v29_overtime.png');

  /* ================= 3. KOF：赢者留场、输者换人 ================= */
  console.log('\n=== 3. KOF：赢者留场、输者换人 ===');
  ok('能打开「KOF 拳皇赛」', (await openT('KOF 拳皇赛')) === 'ok');
  await view('matches');
  await sleep(500);
  const k0 = await ev(`(function(){
    var c=document.querySelectorAll('.match.mrow')[0];
    var tab=c.querySelector('.teamtab');
    var sa=c.querySelector('select[id^="tsa_"]'), sb=c.querySelector('select[id^="tsb_"]');
    return {n:tab.querySelectorAll('.tt-row').length,
      ta:sa?sa.value:'', tb:sb?sb.value:'',
      txt:tab.innerText};
  })()`);
  ok('KOF 一开始只列当前这一场', k0.n === 1, k0.n);
  ok('KOF 说明「赢者留场、输者换人」', /赢者留场/.test(k0.txt) && /输者换人/.test(k0.txt), k0.txt.slice(0, 60));
  ok('默认双方第 1 位队员', k0.ta === 'mb_0_0' && k0.tb === 'mb_1_0', [k0.ta, k0.tb]);

  // 第 1 场：红队胜 → 红-1 留场，白队换人
  ok('第 1 场红队胜', (await bBtn(0, 'A')) === 'ok');
  await sleep(550);
  const k1 = await ev(`(function(){
    var m=TMS.current.stages[0].roundsData[0].matches[0];
    var c=document.querySelectorAll('.match.mrow')[0];
    var rows=[].slice.call(c.querySelectorAll('.teamtab .tt-row'));
    var cur=rows.filter(function(r){return !r.classList.contains('done')})[0]||{};
    var sels=[].slice.call(cur.querySelectorAll?cur.querySelectorAll('select'):[]);
    var sa=sels.filter(function(x){return x.getAttribute('data-tslot')==='a'})[0];
    var sb=sels.filter(function(x){return x.getAttribute('data-tslot')==='b'})[0];
    return {n:(m.games||[]).length, done:rows.length-1,
      no:(cur.querySelector?((cur.querySelector('.tt-n')||{}).innerText||''):''),
      ta:sa?sa.value:'', tb:sb?sb.value:'',
      optsA:sa?[].slice.call(sa.options).map(function(o){return o.value}).filter(Boolean):[],
      optsB:sb?[].slice.call(sb.options).map(function(o){return o.value}).filter(Boolean):[]};
  })()`);
  ok('录完一场 → 出现第 2 场', k1.n === 1 && /第 2 场/.test(k1.no || ''), k1.no);
  ok('赢者留场（红-1 仍在场上）', k1.ta === 'mb_0_0', k1.ta);
  ok('输者下场（白队换成白-2）', k1.tb === 'mb_1_1', k1.tb);
  ok('白-1 不再出现在候选里', k1.optsB.indexOf('mb_1_0') < 0, k1.optsB);
  ok('红队三人仍都可以上（赢了也没被淘汰）', k1.optsA.length === 3, k1.optsA);
  await shot('v29_kof.png');

  /* ================= 4. 已结束的对阵表仍然保留 ================= */
  console.log('\n=== 4. 对阵表（显示历史对阵） ===');
  await openT('nvn 上场人数赛');
  await view('matches');
  await sleep(500);
  const hist = await tabInfo();
  ok('已结束的比赛仍然显示完整对阵表', hist.tab === true && hist.done >= 2, hist);
  ok('每行都能看到「第 N 场」', hist.nos.filter(x => /第 \d+ 场/.test(x)).length === hist.n, hist.nos);
  ok('对阵表不是 noprint（打印时会打出来）', hist.noPrint === false);
  const printCss = await ev(`(function(){
    var hit=0;
    for (var i=0;i<document.styleSheets.length;i++){
      try{
        var rs=document.styleSheets[i].cssRules;
        for (var j=0;j<rs.length;j++){
          if (rs[j].media && String(rs[j].media.mediaText).indexOf('print')>=0 &&
              String(rs[j].cssText).indexOf('tt-btn')>=0) hit++;
        }
      }catch(e){}
    }
    return hit;
  })()`);
  ok('打印样式里把录入控件藏起来了', printCss > 0, printCss);
  await shot('v29_hist.png');

  /* ================= 5. 手机档 ================= */
  console.log('\n=== 5. 手机档 390×844 ===');
  await conn.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(900);
  const mob = await ev(`(function(){
    var c=document.querySelectorAll('.match.mrow')[0];
    var tab=c.querySelector('.teamtab');
    var sels=tab?[].slice.call(tab.querySelectorAll('select')):[];
    var over=sels.filter(function(x){return x.getBoundingClientRect().right>window.innerWidth+0.5}).length;
    return {ov:document.documentElement.scrollWidth-document.documentElement.clientWidth,
      tabW:Math.round(tab?tab.getBoundingClientRect().width:0),
      winW:window.innerWidth, overSel:over};
  })()`);
  ok('手机档无横向溢出', mob.ov <= 0, mob.ov);
  ok('对阵表在屏幕内', mob.tabW > 0 && mob.tabW <= mob.winW, mob);
  ok('手机档里没有控件越界', mob.overSel === 0, mob);
  await shot('v29_mobile.png');
  await conn.send('Emulation.clearDeviceMetricsOverride');
  await sleep(400);

  /* ================= 6. 无报错 ================= */
  console.log('\n=== 6. 无 JS 报错 ===');
  const errs = await ev(`window.__errs||[]`);
  if (errs && errs.length) console.log('    errors: ' + JSON.stringify(errs));
  ok('全程无 JS 报错', !errs || errs.length === 0);

  console.log('\n----------------------------------------');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  console.log('----------------------------------------');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
