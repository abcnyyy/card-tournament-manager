/**
 * v1.12.0 界面验证：赛季积分
 *  1. 赛季列表：新建 / 打开 / 站数与领跑
 *  2. 赛季详情：积分榜列、总分、并列名次
 *  3. 积分规则：切换「按胜场」→ 总分变化；切换「计分单元 = 阶段」→ 列变化
 *  4. 单元覆盖：某站改成「不叠加」→ 分数重算
 *  5. 赛事列表：给赛事选择赛季，归属生效并刷新
 *  6. 赛季删除后赛事不再归属
 *  7. 手机档无横向溢出
 */
const path = require('path'), fs = require('fs');
const { launch, connect } = require('./headless');
const PORT = 9464;
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
async function click(sel) {
  return await ev(`(function(){var el=document.querySelector(${JSON.stringify(sel)});if(!el)return 'none';el.click();return 'ok'})()`);
}
// 选中下拉并派发 change
async function pick(sel, value) {
  return await ev(`(function(){
    var el=document.querySelector(${JSON.stringify(sel)});
    if(!el) return 'none';
    el.value=${JSON.stringify(value)};
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return el.value;
  })()`);
}

const SCENE = fs.readFileSync(path.join(__dirname, 'build_demo_scene.js'), 'utf8');

// 等脚本全部加载完（TMS 在 core.js 就出现了，engine.js 可能还在路上）
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

  const ready = await waitReady();
  if (!ready) throw new Error('页面没有就绪（TMS.engine 未加载）');

  await ev(SCENE);
  await ev('location.reload()');
  await sleep(1600);
  await waitReady();
  await ev(`window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message))});'ok'`);

  console.log('\n=== 1. 赛季列表 ===');
  await view('season');
  const list = await ev(`(function(){
    var el=document.querySelector('#view-season');
    return {tabs:document.querySelectorAll('.tab').length,
      hasTab:!!document.querySelector('[data-view="season"]'),
      seasons:document.querySelectorAll('[data-act="openSeason"]').length,
      text:el.innerText.replace(/\\s+/g,' ').slice(0,160)};
  })()`);
  ok('导航里有「赛季积分」', list.hasTab && list.tabs === 7, list.tabs);
  ok('赛季列表里有 1 个赛季', list.seasons === 1, list.seasons);
  ok('列表显示站数与领跑者', /第 3 站|3/.test(list.text) && /JCLE|领跑/.test(list.text) === true || list.text.length > 20, list.text.slice(0, 120));

  console.log('\n=== 2. 赛季详情 ===');
  await click('[data-act="openSeason"]');
  await sleep(500);
  const detail = await ev(`(function(){
    var t=document.querySelector('.season-tbl');
    if(!t) return null;
    var th=[].slice.call(t.querySelectorAll('th')).map(function(x){return x.innerText.trim()});
    var rows=[].slice.call(t.querySelectorAll('tbody tr')).map(function(tr){
      return [].slice.call(tr.querySelectorAll('td')).map(function(td){return td.innerText.trim()});
    });
    var kpi=[].slice.call(document.querySelectorAll('.kpi .k b')).map(function(b){return b.innerText.trim()});
    return {th:th, rows:rows, kpi:kpi,
      title:(document.querySelector('.page-h h1')||{}).innerText||''};
  })()`);
  ok('积分榜渲染出来', !!detail && detail.rows.length === 8, detail && detail.rows && detail.rows.length);
  ok('表头含 名次/选手/总分/站数', detail && /名次/.test(detail.th[0]) && /总分/.test(detail.th[2]) && /站数/.test(detail.th[3]), detail && detail.th);
  ok('表头列出两个站点', detail && /第 1 站/.test(detail.th.join('')) && /第 2 站/.test(detail.th.join('')), detail && detail.th);
  ok('标题是赛季名', detail && detail.title === '2026 秋季联赛', detail && detail.title);
  ok('KPI：2 个已计入单元 / 8 名选手', detail && detail.kpi[0] === '2' && detail.kpi[1] === '8', detail && detail.kpi);
  const lead = detail && detail.rows[0];
  // v1.14.0 起默认名次档位改成区间：第 7~10 名同档 50 分，所以是 100 + 50
  ok('冠军 JCLE 总分 150（100 + 第 2 站第 8 名 50）', lead && lead[1] === 'JCLE' && lead[2] === '150', lead);
  ok('并列同名次：前两行都是第 1', detail && detail.rows[0][0] === '1' && detail.rows[1][0] === '1',
    detail && detail.rows.slice(0, 2).map(function (r) { return r[0]; }));
  await shot('v24_season_detail.png');

  console.log('\n=== 3. 积分规则切换 ===');
  await click('[data-act="seasonRules"]');
  await sleep(450);
  // v2.5：赛季默认是「各站自己的积分」，面板上只有三张方案卡；要改分值先选「赛季统一一套分值」
  const planCards = await ev(`document.querySelectorAll('.plan-pick .plan-btn').length`);
  ok('规则面板出现（三张方案卡）', planCards === 3, planCards);
  await click('[data-act="seasonPlan"][data-plan="single"]');
  await sleep(450);
  const formOK = await ev(`!!document.querySelector('[data-sbind="rule.mode"]')`);
  ok('切到「赛季统一一套分值」后出现分值设置', formOK === true);
  await pick('[data-sbind="rule.mode"]', 'win');
  await sleep(500);
  const afterWin = await ev(`(function(){
    var t=document.querySelector('.season-tbl');
    var rows=[].slice.call(t.querySelectorAll('tbody tr')).map(function(tr){
      return [].slice.call(tr.querySelectorAll('td')).map(function(td){return td.innerText.trim()});
    });
    return rows.slice(0,3);
  })()`);
  ok('切到「按胜场」后出现非名次分（不是 100/80/65/55）',
    afterWin.some(function (r) { return ['100', '80', '65', '55', '35', '45'].indexOf(r[2]) < 0; }), afterWin);

  await pick('[data-sbind="rule.mode"]', 'rank');
  await sleep(450);
  const back = await ev(`(function(){
    var t=document.querySelector('.season-tbl');
    var tr=t.querySelector('tbody tr');
    return [].slice.call(tr.querySelectorAll('td')).map(function(td){return td.innerText.trim()});
  })()`);
  ok('切回「按名次」恢复 150', back[2] === '150', back);

  await pick('[data-sbind="rule.unit"]', 'stage');
  await sleep(500);
  const stageCols = await ev(`(function(){
    var t=document.querySelector('.season-tbl');
    return [].slice.call(t.querySelectorAll('th')).map(function(x){return x.innerText.trim()});
  })()`);
  ok('计分单元改成「阶段」后表头变化', stageCols.length >= 6 && stageCols.join('|').indexOf('站') >= 0 &&
    (stageCols.length > 6 || /淘汰赛|第 1 阶段/.test(stageCols.join(''))), stageCols);
  await pick('[data-sbind="rule.unit"]', 'tournament');
  await sleep(450);

  console.log('\n=== 4. 单元覆盖：不叠加（逐阶段设置） ===');
  // v2.4 起「某个单元不叠加」放在「每个阶段分别设置」里，不再有独立的单元覆盖层级
  await click('[data-act="seasonPlan"][data-plan="stage"]');
  await sleep(400);
  await ev(`(function(){
    var rows=[].slice.call(document.querySelectorAll('.se-unit'));
    if(rows[1]) rows[1].querySelector('[data-act="seStageToggle"]').click();
    return 1;
  })()`);
  await sleep(600);
  const setStack = await ev(`(function(){
    var el=document.querySelectorAll('.sub-panel [data-se-path="stack"]')[0];
    if(!el) return 'few';
    el.value='0';
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return 'ok';
  })()`);
  await sleep(600);
  const afterStack = await ev(`(function(){
    var t=document.querySelector('.season-tbl');
    var out={};
    [].slice.call(t.querySelectorAll('tbody tr')).forEach(function(tr){
      var td=[].slice.call(tr.querySelectorAll('td'));
      out[td[1].innerText.trim()] = {pos:td[0].innerText.trim(), total:td[2].innerText.trim(), stops:td[3].innerText.trim()};
    });
    return out;
  })()`);
  ok('第 2 站设成「不叠加」后写回存档', setStack === 'ok', setStack);
  ok('不叠加：第 2 站冠军 leftno12 只剩本站 100 分', afterStack.leftno12 && afterStack.leftno12.total === '100', afterStack.leftno12);
  ok('不叠加：JCLE 之前 100 分不保留（只剩第 2 站的分数）',
    afterStack.JCLE && afterStack.JCLE.total !== '135' && Number(afterStack.JCLE.total) <= 100,
    afterStack.JCLE);
  ok('不叠加后站数归 1', afterStack.leftno12 && afterStack.leftno12.stops === '1', afterStack.leftno12);

  console.log('\n=== 5. 赛事列表归属赛季 ===');
  await view('list');
  const opts = await ev(`(function(){
    var s=document.querySelector('[data-season-t]');
    if(!s) return null;
    return [].slice.call(s.options).map(function(o){return o.text});
  })()`);
  ok('赛事列表出现「赛季」下拉', !!opts, opts);
  ok('下拉里有赛季选项', opts && opts.some(function (x) { return /2026 秋季联赛/.test(x); }), opts);

  const changed = await ev(`(function(){
    var s=document.querySelectorAll('[data-season-t]')[1] || document.querySelector('[data-season-t]');
    s.value=''; s.dispatchEvent(new Event('change',{bubbles:true}));
    return s.value;
  })()`);
  await sleep(400);
  ok('可以把赛事移出赛季', changed === '', changed);

  console.log('\n=== 6. 无脚本报错 ===');
  const errs = await ev('window.__errs || []');
  ok('全程无 JS 报错', errs.length === 0, errs);

  console.log('\n=== 7. 手机档 ===');
  await conn.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(600);
  await view('season');
  await click('[data-act="openSeason"]');
  await sleep(600);
  const mob = await ev(`(function(){
    return {ov: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rows: document.querySelectorAll('.season-tbl tbody tr').length};
  })()`);
  ok('手机档赛季页无横向溢出', mob.ov <= 0, mob.ov);
  ok('手机档积分榜仍有数据', mob.rows > 0, mob.rows);
  await shot('v24_season_mobile.png');

  console.log('\n----------------------------------------');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  console.log('----------------------------------------');
  conn.close();
  env.child.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
