/**
 * v2.3 界面验收 —— ① 小分里的逐阶段得分 ② 对阵中的警告 / 判负
 *  1. 设置页「排名依据」：逐阶段得分逐项可加、判负在警告之前
 *  2. 排名页：第 1 / 第 2 阶段分、判负、警告 列都按需出现
 *  3. 对阵页：明细区能记警告 / 判负，主行显示徽标
 *  4. 记完判负后排名真的变化，刷新后不丢
 *  5. 手机档无横向溢出
 *  6. 全程无 JS 报错
 */
const path = require('path'), fs = require('fs');
const { launch, connect } = require('./headless');
const PORT = 9474;
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
async function click(sel) {
  return await ev(`(function(){
    var e=document.querySelector(${JSON.stringify(sel)});
    if(!e) return 'none';
    if(e.disabled) return 'disabled';
    e.click(); return 'ok';
  })()`);
}
async function count(sel) {
  return await ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
}
async function text(sel) {
  return await ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});return e?e.innerText:''})()`);
}
async function setPen(side, kind, val) {
  return await ev(`(function(){
    var el=document.querySelector('.penrow .pen-num[data-side="${side}"][data-kind="${kind}"]');
    if(!el) return 'none';
    el.value='${val}';
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return 'ok';
  })()`);
}

const SCENE = fs.readFileSync(path.join(__dirname, 'build_v31_scene.js'), 'utf8');

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

  /* ================= 1. 设置页：排名依据逐阶段化 ================= */
  console.log('\n=== 1. 排名依据（逐阶段得分 + 判负 / 警告） ===');
  ok('能打开「破同阶段分」', (await openT('破同阶段分')) === 'ok');
  await view('setup');
  await sleep(600);
  const tieTxt = await ev(`(function(){
    var rows=[].slice.call(document.querySelectorAll('.tie-row'));
    return rows.map(function(r){return r.innerText.replace(/\\s+/g,' ').trim()});
  })()`);
  ok('依据行数 = 7', tieTxt.length === 7, tieTxt);
  ok('含「判负次数」', tieTxt.some(x => x.indexOf('判负') >= 0), tieTxt);
  ok('含「警告次数」', tieTxt.some(x => x.indexOf('警告') >= 0), tieTxt);
  ok('含「第 1 阶段得分」', tieTxt.some(x => x.indexOf('第 1 阶段得分') >= 0), tieTxt);
  ok('含「第 2 阶段得分」', tieTxt.some(x => x.indexOf('第 2 阶段得分') >= 0), tieTxt);
  ok('含「上一阶段得分」', tieTxt.some(x => x.indexOf('上一阶段得分') >= 0), tieTxt);
  const iForf = tieTxt.findIndex(x => x.indexOf('判负') >= 0);
  const iWarn = tieTxt.findIndex(x => x.indexOf('警告') >= 0);
  ok('判负排在警告之前（先比判负再比警告）', iForf >= 0 && iWarn > iForf, { iForf, iWarn });
  const hint = await text('.tie-empty') + await ev(`(function(){
    var h=document.querySelectorAll('.card .hint');var s='';
    for(var i=0;i<h.length;i++){ if(h[i].innerText.indexOf('Tiebreaker')>=0||h[i].innerText.indexOf('同分时')>=0) s+=h[i].innerText; }
    return s;
  })()`);
  ok('说明里提到了逐阶段与判负优先', /第 N 阶段得分|阶段单独/.test(hint) && /判负/.test(hint), hint.slice(0, 80));
  await ev(`(function(){var r=document.querySelector('.tie-row');if(r)r.scrollIntoView({block:'center'});return 1})()`);
  await sleep(450);
  await shot('v31_setup_tie.png');

  /* 移除「第 1 阶段得分」→ 下拉里能再加回来 */
  const removed = await ev(`(function(){
    var rows=[].slice.call(document.querySelectorAll('.tie-row'));
    for(var i=0;i<rows.length;i++){
      if(rows[i].innerText.indexOf('第 1 阶段得分')>=0){ rows[i].querySelector('[data-act="tieRemove"]').click(); return 1; }
    }
    return 0;
  })()`);
  await sleep(500);
  ok('能移除「第 1 阶段得分」', removed === 1);
  const afterRm = await ev(`(function(){
    var o=TMS.store.get(TMS.store.getCurrentId()).scoring.tieOrder;
    var opts=[].slice.call(document.querySelectorAll('#tieAddSel option')).map(function(x){return x.value});
    return {len:o.length, has:o.indexOf('stageP0')>=0, inOpts:opts.indexOf('stageP0')>=0, opts:opts};
  })()`);
  ok('移除后依据少一项且不在列表里', afterRm.len === 6 && !afterRm.has, afterRm);
  ok('「添加依据」下拉里能重新选到第 1 阶段得分', afterRm.inOpts === true, afterRm.opts);
  // 加回来
  await ev(`(function(){
    var s=document.getElementById('tieAddSel');
    s.value='stageP0';
    document.querySelector('[data-act="tieAdd"]').click();
    return 1;
  })()`);
  await sleep(500);
  const back = await ev(`TMS.store.get(TMS.store.getCurrentId()).scoring.tieOrder`);
  ok('「第 1 阶段得分」已重新加入', back.indexOf('stageP0') >= 0, back.join(','));

  /* ================= 2. 排名页：逐阶段列 ================= */
  console.log('\n=== 2. 排名页逐阶段列 ===');
  await view('standing');
  await sleep(700);
  const head = await ev(`(function(){
    var t=document.querySelector('#view-standing table.compact thead tr');
    return t?[].slice.call(t.children).map(function(x){return x.innerText.trim()}):[];
  })()`);
  console.log('    表头:', JSON.stringify(head));
  ok('有「上阶段分」列', head.some(x => x.indexOf('上阶段分') >= 0), head);
  ok('有「第 1 阶段分」列', head.some(x => x.indexOf('第 1 阶段分') >= 0), head);
  ok('有「第 2 阶段分」列', head.some(x => x.indexOf('第 2 阶段分') >= 0), head);
  ok('有「判负」列', head.some(x => x.indexOf('判负') >= 0), head);
  ok('有「警告」列', head.some(x => x.indexOf('警告') >= 0), head);
  const spv = await ev(`(function(){
    var t=TMS.store.get(TMS.store.getCurrentId());
    var st=TMS.engine.standings(t,{stageIndex:2});
    return st.map(function(s){return {n:s.name, pts:s.points, sp0:(s.stagePts&&s.stagePts[0]), sp1:(s.stagePts&&s.stagePts[1])}});
  })()`);
  ok('第 1 / 第 2 阶段分都已算出', spv.length === 8 &&
    spv.every(x => typeof x.sp0 === 'number' && typeof x.sp1 === 'number'), spv.slice(0, 3));
  ok('逐阶段分互不相同（确实是各阶段的值）', spv[0].sp0 !== spv[0].sp1 || spv[1].sp0 !== spv[1].sp1,
    spv.slice(0, 3));
  await shot('v31_standing.png');

  /* ================= 3. 对阵页：记警告 / 判负 ================= */
  console.log('\n=== 3. 对阵页记警告 / 判负 ===');
  ok('能打开「纪律判负」', (await openT('纪律判负')) === 'ok');
  await view('matches');
  await sleep(600);
  const first = await ev(`(function(){
    var m=document.querySelector('.match.mrow');
    if(!m) return null;
    return {a:m.querySelector('.mside.side.a .pname').innerText.trim(),
            b:m.querySelector('.mside.side.b .pname').innerText.trim(),
            btn:!!m.querySelector('[data-act="toggleMore"]')};
  })()`);
  ok('有对阵卡片且能展开明细', !!first && first.btn === true, first);
  ok('展开明细', (await click('.match.mrow [data-act="toggleMore"]')) === 'ok');
  await sleep(500);
  ok('明细里有「警告 / 判负」区', await count('.penrow') >= 1, await count('.penrow'));
  ok('每场 4 个计数框（双方 × 警告 / 判负）', await count('.match.mrow.open .pen-num') === 4,
    await count('.match.mrow.open .pen-num'));
  const penTxt = await text('.match.mrow.open .penrow');
  ok('文案写明计入小分与先后顺序', /计入小分/.test(penTxt) && /判负/.test(penTxt) && /警告/.test(penTxt),
    penTxt.replace(/\s+/g, ' ').slice(0, 80));
  await shot('v31_pen.png');

  ok('给 A 记 1 次判负', (await setPen('a', 'forfeit', 1)) === 'ok');
  await sleep(600);
  const tagA = await ev(`(function(){
    var m=document.querySelector('.match.mrow');
    return [].slice.call(m.querySelectorAll('.mtags .tag')).map(function(x){return x.innerText.trim()}).join(' | ');
  })()`);
  ok('主行出现「判负 A×1」徽标', /判负 A×1/.test(tagA), tagA);
  ok('给 B 记 2 次警告', (await setPen('b', 'warn', 2)) === 'ok');
  await sleep(600);
  const tagB = await ev(`(function(){
    var m=document.querySelector('.match.mrow');
    return [].slice.call(m.querySelectorAll('.mtags .tag')).map(function(x){return x.innerText.trim()}).join(' | ');
  })()`);
  ok('主行出现「警告 B×2」徽标', /警告 B×2/.test(tagB), tagB);
  const saved = await ev(`(function(){
    var t=TMS.store.get(TMS.store.getCurrentId());
    var m=t.stages[0].roundsData[0].matches[0];
    return m.pen||null;
  })()`);
  ok('判负 / 警告已存进比赛数据', !!saved && saved.a.forfeit === 1 && saved.b.warn === 2, saved);
  await shot('v31_pen_tag.png');

  /* ================= 4. 排名随之变化 ================= */
  console.log('\n=== 4. 判负影响排名 ===');
  await view('standing');
  await sleep(700);
  const rank = await ev(`(function(){
    var t=TMS.store.get(TMS.store.getCurrentId());
    var st=TMS.engine.standings(t,{stageIndex:0});
    var rows=[].slice.call(document.querySelectorAll('#view-standing table.compact tbody tr')).map(function(r){
      var tds=[].slice.call(r.children).map(function(x){return x.innerText.trim()});
      return tds;
    });
    return {eng:st.map(function(s){return {n:s.name,r:s.rank,f:s.forfeits,w:s.warnings,pts:s.points}}),
            rows:rows.slice(0,4), top:rows[0]};
  })()`);
  const victim = rank.eng.filter(x => x.f === 1)[0];
  const vIdx = rank.eng.indexOf(victim);
  ok('引擎统计到判负者', !!victim, rank.eng);
  ok('判负者被排到同分组最后（判负优先于其它小分）', vIdx > 0, { vIdx, victim });
  ok('判负者的名次被单独拉开（不再与其它 3 分选手并列第 1）', victim && victim.r === vIdx + 1 && victim.r > 1,
    { r: victim && victim.r, vIdx });
  const warnOne = rank.eng.filter(x => x.w === 2)[0];
  ok('引擎统计到警告 2 次', !!warnOne, rank.eng);
  await shot('v31_standing_pen.png');

  /* ================= 5. 刷新后仍在 ================= */
  await ev('location.reload()');
  await sleep(1700);
  await waitReady();
  await ev(`window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message)+' @ '+e.lineno)});'ok'`);
  await openT('纪律判负');
  await view('matches');
  await sleep(600);
  const afterReload = await ev(`(function(){
    var t=TMS.store.get(TMS.store.getCurrentId());
    var m=t.stages[0].roundsData[0].matches[0];
    var tags=[].slice.call(document.querySelectorAll('.match.mrow .mtags .tag')).map(function(x){return x.innerText.trim()});
    return {pen:m.pen||null, tags:tags};
  })()`);
  ok('刷新后判负 / 警告仍在', !!afterReload.pen && afterReload.pen.a.forfeit === 1 &&
    afterReload.pen.b.warn === 2, afterReload.pen);
  ok('刷新后徽标仍在', afterReload.tags.join('|').indexOf('判负 A×1') >= 0, afterReload.tags);

  /* ================= 6. 手机档 ================= */
  console.log('\n=== 6. 手机档 ===');
  await conn.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true
  });
  await sleep(700);
  await ev(`(function(){
    var m=document.querySelector('.match.mrow');
    if(m && !m.classList.contains('open')) m.querySelector('[data-act="toggleMore"]').click();
    return 1;
  })()`);
  await sleep(500);
  const mob = await ev(`(function(){
    return {sw:document.documentElement.scrollWidth, cw:document.documentElement.clientWidth,
      pen:document.querySelectorAll('.pen-num').length};
  })()`);
  ok('手机档无横向溢出', mob.sw <= mob.cw + 1, mob);
  ok('手机档仍能看到判负输入框', mob.pen >= 4, mob.pen);
  await shot('v31_mobile.png');
  await conn.send('Emulation.clearDeviceMetricsOverride');

  const errs = await ev('(window.__errs||[]).join(" | ")');
  console.log('\n=== RESULT ===');
  console.log('页面报错：', errs || '(none)');
  ok('全程无 JS 报错', !errs || !errs.trim(), errs);
  console.log('\n合计: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
