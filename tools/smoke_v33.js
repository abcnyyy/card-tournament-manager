/**
 * v2.5 界面验证
 *  1. 赛季默认按「各站自己的积分」算，每站行显示该站规则摘要 + 「改规则」入口
 *  2. 点「改规则」跳到该赛事的赛事设置，出现「← 返回赛季」，能回到赛季页
 *  3. 赛季导出：JPG / PDF（都不走打印机）
 *  4. 淘汰赛阶段导出格式 = 对阵图（不是排名表），瑞士轮仍出排名表
 *  5. 全程无 JS 报错 + 手机档无横向溢出
 */
const path = require('path'), fs = require('fs');
const { launch, connect } = require('./headless');
const PORT = 9466;
const OUT = path.join(__dirname, 'smoke_out');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let conn = null;
async function ev(expr, awaitPromise) {
  const r = await conn.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise });
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
  await ev(`(function(){var t=document.querySelector('[data-view="${v}"]');if(t)t.click();return 1})()`);
  await sleep(350);
}
async function click(sel) {
  const r = await ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return 'none';e.click();return 'ok'})()`);
  await sleep(420);
  return r;
}
async function waitReady() {
  for (let i = 0; i < 60; i++) {
    const st = await ev(`(document.readyState === 'complete') && typeof TMS === 'object' && !!TMS.engine && !!TMS.grab && !!TMS.pdf`);
    if (st === true) return true;
    await sleep(150);
  }
  return false;
}

const SCENE = fs.readFileSync(path.join(__dirname, 'build_v33_scene.js'), 'utf8');

(async () => {
  const env = await launch(PORT, path.join(__dirname, '..', 'app'));
  conn = await connect(PORT);
  await conn.send('Runtime.enable');
  await conn.send('Page.enable');

  if (!(await waitReady())) throw new Error('页面没有就绪');

  await ev(SCENE);
  await ev('location.reload()');
  await sleep(1600);
  await waitReady();
  await ev(`window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message))});'ok'`);
  // 拦截保存：导出动作不真的写盘，只把内容抓下来检查
  await ev(`(function(){
    window.__saved = [];
    TMS.util.saveBinary = function (name, b64, mime, cb) {
      window.__saved.push({ name: name, mime: mime, len: (b64||'').length, head: (b64||'').slice(0,8) });
      if (cb) cb({ ok: true, msg: 'stub' });
      return true;
    };
    return 'hooked';
  })()`);

  console.log('\n=== 1. 赛季：默认按各站自己的积分 ===');
  await view('season');
  await click('[data-act="openSeason"]');
  await sleep(400);
  // 「每站的积分规则」在可折叠的「积分规则」面板里，先确保它展开
  const opened = await ev(`(function(){
    if (!document.querySelector('.plan-pick')) { var b=document.querySelector('[data-act="seasonRules"]'); if (b) b.click(); }
    return !!document.querySelector('.plan-pick');
  })()`);
  await sleep(400);
  ok('积分规则面板能展开', opened === true);
  const s1 = await ev(`(function(){
    var sid = TMS.store.loadSeasons()[0].id; var se = TMS.store.getSeason(sid);
    // 只看面板内带「改规则」按钮的行（右栏「站点」列表里也有 .unit-row，但那是摘要，不含按钮）
    var btns = [].slice.call(document.querySelectorAll('#view-season [data-act="editStopPts"]'));
    var rows = btns.map(function(b){
      var r = b.closest('.unit-row'); var s = r ? r.querySelector('.hint') : null;
      return ((r?r.innerText:'') + ' | ' + (s?s.innerText:'')).replace(/\\s+/g,' ').trim();
    });
    return {
      plan: TMS.engine.seasonPlan(se),
      tbl: !!document.querySelector('.season-tbl'),
      rows: rows,
      editBtns: btns.length,
      btnText: btns.map(function(b){return b.innerText.trim()})
    };
  })()`);
  ok('赛季口径 = site（各站自己的积分）', s1.plan === 'site', s1.plan);
  ok('积分榜渲染出来', s1.tbl === true);
  ok('每站一个「改规则」按钮', s1.editBtns === 2, s1.editBtns);
  ok('第 1 站摘要写的是「每胜 7」', /每胜 7/.test(s1.rows.join(' ')), s1.rows);
  ok('第 2 站摘要写的是名次分（第1 100）', /第1 100|第1 100/.test(s1.rows.join(' ')), s1.rows);
  await shot('v25_season_site.png');

  console.log('\n=== 2. 从赛季页跳到「改这一站的规则」 ===');
  // 指定点「按胜场 · 每胜 7」那一站（春季站）的按钮，避免依赖单元顺序
  const springTid = await ev(`(function(){
    var bs = [].slice.call(document.querySelectorAll('#view-season [data-act="editStopPts"]'));
    for (var i = 0; i < bs.length; i++) {
      var r = bs[i].closest('.unit-row');
      if (r && /每胜 7/.test(r.innerText)) return bs[i].getAttribute('data-tid');
    }
    return '';
  })()`);
  ok('找到春季站的「改规则」按钮', !!springTid, springTid);
  const clicked = await click('[data-act="editStopPts"][data-tid="' + springTid + '"]');
  await sleep(500);
  ok('点了「改规则」', clicked === 'ok', clicked);
  const jump = await ev(`(function(){
    var v = document.getElementById('view-setup');
    var act = document.querySelector('.tab.active');
    var back = v.querySelector('[data-act="backToSeason"]');
    var card = document.getElementById('ptsCard');
    var on = v.querySelector('[data-bind="ptsRule.on"]');
    return {
      view: act ? act.getAttribute('data-view') : '',
      setupShown: v.style.display !== 'none' && !!act && act.getAttribute('data-view') === 'setup',
      back: !!back,
      card: !!card,
      onChecked: !!(on && on.checked),
      mode: (function(){var s=v.querySelector('[data-bind="ptsRule.mode"]');return s?s.value:''})(),
      title: TMS.current ? TMS.current.name : ''
    };
  })()`);
  ok('跳到了赛事设置页', jump.setupShown === true);
  ok('顶部有「返回赛季」', jump.back === true);
  ok('积分榜卡片在页面上（#ptsCard）', jump.card === true);
  ok('该站的积分榜是启用状态', jump.onChecked === true);
  ok('该站规则是「按胜场」', jump.mode === 'win', jump.mode);
  ok('打开的是第 1 站', jump.title === '春季站', jump.title);
  await shot('v25_jump_to_stop.png');

  await click('[data-act="backToSeason"]');
  await sleep(500);
  const back = await ev(`(function(){
    var v = document.getElementById('view-season');
    var act = document.querySelector('.tab.active');
    return {
      shown: v.style.display !== 'none' && !!act && act.getAttribute('data-view') === 'season',
      rulesOpen: !!document.querySelector('#view-season .plan-pick'),
      kpi: (document.querySelector('#view-season .kpi') || {}).innerText || ''
    };
  })()`);
  ok('能回到赛季页', back.shown === true, back);
  ok('回到赛季页自动展开积分规则面板', back.rulesOpen === true, back);
  ok('页头计分方式 = 各站自定', /各站自定/.test(back.kpi), back.kpi);

  console.log('\n=== 3. 赛季导出：JPG / PDF（不走打印机） ===');
  await ev(`window.__saved = []`);
  await click('[data-act="seasonImg"]');
  await sleep(1500);
  await click('[data-act="seasonPDF"]');
  await sleep(2500);
  const saved = await ev(`window.__saved`);
  const jpg = (saved || []).filter(function (x) { return /\.jpg$/.test(x.name); })[0];
  const pdf = (saved || []).filter(function (x) { return /\.pdf$/.test(x.name); })[0];
  ok('导出了 JPG 文件', !!jpg, saved);
  ok('JPG 是 image/jpeg 且内容不小', jpg && jpg.mime === 'image/jpeg' && jpg.len > 2000, jpg);
  ok('导出了 PDF 文件', !!pdf, saved);
  ok('PDF 以 %PDF 开头（JVBERi = base64）', pdf && pdf.head.indexOf('JVBERi') === 0, pdf && pdf.head);

  console.log('\n=== 4. 淘汰赛：导出格式是对阵图 ===');
  await view('list');
  await click('[data-act="openT"]');
  await sleep(400);
  await view('export');
  const ex = await ev(`(function(){
    var v = document.getElementById('view-export');
    var txt = v.innerText;
    return {
      isElim: /淘汰赛对阵图/.test(txt),
      hasBracketBtns: !!v.querySelector('[data-act="imgSelStanding"]'),
      noPrintBtn: !v.querySelector('[data-act="printSelStanding"]') && !v.querySelector('[data-act="printSelRound"]'),
      btnText: (v.querySelector('[data-act="imgSelStanding"]')||{}).innerText || ''
    };
  })()`);
  ok('淘汰赛阶段的导出卡片叫「淘汰赛对阵图」', ex.isElim === true);
  ok('按钮文字带「对阵图」', /对阵图/.test(ex.btnText), ex.btnText);
  ok('导出面板不再有「打印」按钮', ex.noPrintBtn === true);

  await ev(`window.__saved = []`);
  await click('[data-act="imgSelStanding"]');
  await sleep(2000);
  const saved2 = await ev(`window.__saved`);
  ok('导出对阵图 JPG 成功', (saved2 || []).length === 1 && /\.jpg$/.test(saved2[0].name), saved2);
  ok('文件名写明「对阵图」', (saved2[0] || {}).name && /对阵图/.test(saved2[0].name), (saved2[0] || {}).name);
  await shot('v25_export_elim.png');

  console.log('\n=== 5. 无脚本报错 ===');
  const errs = await ev('window.__errs || []');
  ok('全程无 JS 报错', errs.length === 0, errs);

  console.log('\n=== 6. 手机档 ===');
  await conn.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(600);
  await view('season');
  await click('[data-act="openSeason"]');
  await sleep(600);
  await ev(`(function(){
    if (!document.querySelector('#view-season .plan-pick')) { var b=document.querySelector('[data-act="seasonRules"]'); if (b) b.click(); }
    return 1;
  })()`);
  await sleep(500);
  const mob = await ev(`(function(){
    return { ov: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rows: document.querySelectorAll('.season-tbl tbody tr').length,
      btns: document.querySelectorAll('#view-season [data-act="editStopPts"]').length };
  })()`);
  ok('手机档赛季页无横向溢出', mob.ov <= 0, mob.ov);
  ok('手机档积分榜有数据', mob.rows > 0, mob.rows);
  ok('手机档也能看到「改规则」按钮', mob.btns === 2, mob.btns);
  await shot('v25_season_mobile.png');

  console.log('\n----------------------------------------');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  console.log('----------------------------------------');
  conn.close();
  env.child.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('崩了：', e.message); process.exit(2); });
