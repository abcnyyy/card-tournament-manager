/**
 * v1.13.0 界面验证：积分体系放进赛事、赛季只做加总
 *  1. 赛事设置：积分榜卡片 / 开关 / 名次档位（几个名次一档）
 *  2. 档位编辑：迁移旧 top / 加一档 / 延伸最后一档 / 晋级标注
 *  3. 排名页：本赛事积分榜
 *  4. 赛季页：各站积分加总（两站分值不同）
 *  5. 联动：改赛事分值 → 排名页与赛季页同时变化
 *  6. 计分单元改成按阶段 + 某阶段单独设成按胜场
 *  7. 赛季切到「统一规则」再切回
 *  8. 无脚本报错 + 手机档无横向溢出
 */
const path = require('path'), fs = require('fs');
const { launch, connect } = require('./headless');
const PORT = 9466;
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
async function pick(sel, value) {
  return await ev(`(function(){
    var el=document.querySelector(${JSON.stringify(sel)});
    if(!el) return 'none';
    el.value=${JSON.stringify(value)};
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return el.value;
  })()`);
}
// 页内弹窗：填输入框并点确定
async function modalOk(text) {
  return await ev(`(function(){
    var i=document.getElementById('modalInput');
    if(!i) return 'noinput';
    i.value=${JSON.stringify(String(text))};
    var b=document.getElementById('modalOk');
    if(!b) return 'nobtn';
    b.click();
    return 'ok';
  })()`);
}
// v1.14.0：名次档位改成「几个名次一档」的区间编辑，统计 .tier-row 行数
async function tiers() {
  return await ev(`(function(){var l=document.querySelector('#view-setup .tier-list');
    return l?l.querySelectorAll('.tier-row').length:0})()`);
}
// 积分榜表头（用于判断「晋级」列有没有出现/消失）
async function boardHead() {
  return await ev(`(function(){
    var cards=[].slice.call(document.querySelectorAll('#view-standing .card'));
    var c=cards.filter(function(x){return /赛事积分榜/.test(x.innerText)})[0];
    if(!c) return null;
    var t=c.querySelector('table');
    if(!t) return [];
    return [].slice.call(t.querySelectorAll('thead th')).map(function(x){return x.innerText.trim()});
  })()`);
}
// 排名页「赛事积分榜」的表格内容
async function boardRows() {
  return await ev(`(function(){
    var cards=[].slice.call(document.querySelectorAll('#view-standing .card'));
    var c=cards.filter(function(x){return /赛事积分榜/.test(x.innerText)})[0];
    if(!c) return null;
    var t=c.querySelector('table');
    if(!t) return [];
    return [].slice.call(t.querySelectorAll('tbody tr')).map(function(tr){
      return [].slice.call(tr.querySelectorAll('td')).map(function(td){return td.innerText.trim()});
    });
  })()`);
}
async function seasonRows() {
  return await ev(`(function(){
    var t=document.querySelector('.season-tbl');
    if(!t) return null;
    return {
      th:[].slice.call(t.querySelectorAll('th')).map(function(x){return x.innerText.trim()}),
      rows:[].slice.call(t.querySelectorAll('tbody tr')).map(function(tr){
        return [].slice.call(tr.querySelectorAll('td')).map(function(td){return td.innerText.trim()});
      })
    };
  })()`);
}
// 打开指定名字的赛季（先回到赛季列表，避免已经在详情页里）
async function openSeasonByName(name) {
  await view('season');
  await sleep(400);
  await ev(`(function(){var b=document.querySelector('[data-act="seasonBack"]'); if(b) b.click(); return 1})()`);
  await sleep(400);
  return await ev(`(function(){
    var trs=[].slice.call(document.querySelectorAll('#view-season tbody tr'));
    var tr=trs.filter(function(r){return r.innerText.indexOf(${JSON.stringify(name)})>=0})[0];
    if(!tr) return 'none';
    tr.querySelector('[data-act="openSeason"]').click();
    return 'ok';
  })()`);
}
function byName(rows, n) { return (rows || []).filter(function (r) { return r[1] === n; })[0] || []; }

const SCENE1 = fs.readFileSync(path.join(__dirname, 'build_demo_scene.js'), 'utf8');
const SCENE2 = fs.readFileSync(path.join(__dirname, 'build_v25_scene.js'), 'utf8');

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
  await ev(SCENE1);
  await ev(SCENE2);
  await ev('location.reload()');
  await sleep(1700);
  await waitReady();
  await ev(`window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message)+' @ '+e.lineno)});'ok'`);

  console.log('\n=== 1. 赛事设置：积分榜卡片 ===');
  await view('setup');
  const setup = await ev(`(function(){
    var cards=[].slice.call(document.querySelectorAll('#view-setup .card'));
    var c=cards.filter(function(x){return /赛事积分榜/.test(x.innerText)})[0];
    if(!c) return null;
    return {
      hasSwitch: !!c.querySelector('[data-bind="ptsRule.on"]'),
      checked: !!(c.querySelector('[data-bind="ptsRule.on"]')||{}).checked,
      tiers: c.querySelectorAll('.tier-row').length,
      unit: (c.querySelector('[data-bind="ptsRule.unit"]')||{}).value,
      mode: (c.querySelector('[data-bind="ptsRule.mode"]')||{}).value,
      stageRows: c.querySelectorAll('[data-act="ptsStageEdit"]').length,
      text: c.innerText.replace(/\\s+/g,' ').slice(0,120)
    };
  })()`);
  ok('设置页出现「赛事积分榜」卡片', !!setup, setup);
  ok('开关默认已开启（场景里启用过）', setup && setup.checked === true, setup && setup.checked);
  ok('名次档位 8 行（场景配了前 8 名，单名次一档）', setup && setup.tiers === 8, setup && setup.tiers);
  ok('计分单元 = 整站', setup && setup.unit === 'tournament', setup && setup.unit);
  ok('列出每个阶段可单独设置', setup && setup.stageRows === 1, setup && setup.stageRows);
  await shot('v25_pts_setup.png');

  console.log('\n=== 2. 名次档位（几个名次一档） ===');
  const t0 = await ev(`(function(){
    var rows=[].slice.call(document.querySelectorAll('#view-setup .tier-row'));
    return rows.map(function(r){
      var i=r.querySelectorAll('input');
      return [i[0].value, i[1].value, i[2].value, !!i[3].checked];
    });
  })()`);
  ok('旧 top 口径迁移成单名次档位（第 1 档 = 第 1~1 名 100 分）',
    t0.length === 8 && t0[0][0] === '1' && t0[0][1] === '1' && t0[0][2] === '100', t0[0]);
  ok('第 8 档 = 第 8~8 名 26 分', t0[7] && t0[7][0] === '8' && t0[7][2] === '26', t0[7]);

  await click('[data-act="ptsTierAdd"]');
  await sleep(400);
  const t1 = await tiers();
  ok('「+ 加一档」→ 9 档', t1 === 9, t1);
  const t1last = await ev(`(function(){
    var rows=[].slice.call(document.querySelectorAll('#view-setup .tier-row'));
    var r=rows[rows.length-1], i=r.querySelectorAll('input');
    return [i[0].value, i[1].value, i[2].value];
  })()`);
  ok('新档接在第 9 名，按步长 2 递减为 24 分',
    t1last[0] === '9' && t1last[1] === '9' && t1last[2] === '24', t1last);

  for (var ai = 0; ai < 4; ai++) { await click('[data-act="ptsTierAdd"]'); await sleep(300); }
  const t2 = await tiers();
  ok('再加 4 档 → 13 档', t2 === 13, t2);

  await click('[data-act="ptsFill"][data-prefix="ptsRule"]');
  await sleep(250);
  const hasModal = await ev(`!!document.getElementById('modalInput')`);
  ok('「延伸最后一档」弹出输入框', hasModal === true);
  await modalOk('16');
  await sleep(500);
  const t3 = await ev(`(function(){
    var rows=[].slice.call(document.querySelectorAll('#view-setup .tier-row'));
    var r=rows[rows.length-1], i=r.querySelectorAll('input');
    return {n:rows.length, from:i[0].value, to:i[1].value, pts:i[2].value};
  })()`);
  ok('延伸后最后一档覆盖到第 16 名（档位行数不变）',
    t3.n === 13 && t3.from === '13' && t3.to === '16', t3);
  const cover = await ev(`(function(){
    var rows=[].slice.call(document.querySelectorAll('#view-setup .tier-row'));
    var seg=rows.map(function(r){var i=r.querySelectorAll('input');return [+i[0].value, +i[1].value]});
    seg.sort(function(a,b){return a[0]-b[0]});
    var okAll=true, expect=1;
    seg.forEach(function(x){ if(x[0]!==expect) okAll=false; expect=x[1]+1; });
    return {okAll:okAll, covered:expect-1, seg:seg};
  })()`);
  ok('13 档连续覆盖第 1~16 名，无空档无重叠', cover.okAll === true && cover.covered === 16, cover);

  /* 晋级标注：勾上第一档 → 积分榜多一列「晋级」，取消后列消失 */
  await ev(`(function(){
    var cb=document.querySelector('#view-setup .tier-row input[type=checkbox]');
    cb.checked=true; cb.dispatchEvent(new Event('change',{bubbles:true})); return 1})()`);
  await sleep(500);
  const advModel = await ev(`(function(){
    var t=TMS.current.ptsRule.rank.tiers;
    return {n:t.length, adv0:!!t[0].adv, adv1:!!t[1].adv};
  })()`);
  ok('勾「晋级」写进 tier.adv（只动这一档）',
    advModel.adv0 === true && advModel.adv1 === false, advModel);

  await view('standing');
  await sleep(500);
  const headAdv = await boardHead();
  const b1a = await boardRows();
  ok('积分榜出现「晋级」列', Array.isArray(headAdv) && headAdv.indexOf('晋级') >= 0, headAdv);
  ok('第 1 名标「晋级」', byName(b1a, 'P1')[2] === '晋级', byName(b1a, 'P1'));
  ok('第 2 名不标（未勾）', byName(b1a, 'P2')[2] !== '晋级', byName(b1a, 'P2'));

  await view('setup');
  await sleep(400);
  await ev(`(function(){
    var cb=document.querySelector('#view-setup .tier-row input[type=checkbox]');
    cb.checked=false; cb.dispatchEvent(new Event('change',{bubbles:true})); return 1})()`);
  await sleep(500);
  await view('standing');
  await sleep(450);
  const headNoAdv = await boardHead();
  ok('取消勾选后「晋级」列消失', Array.isArray(headNoAdv) && headNoAdv.indexOf('晋级') < 0, headNoAdv);
  await view('setup');
  await sleep(400);

  console.log('\n=== 3. 排名页积分榜 ===');
  await view('standing');
  await sleep(500);
  const b1 = await boardRows();
  ok('排名页出现「赛事积分榜」', Array.isArray(b1) && b1.length === 8, b1 && b1.length);
  ok('第一名是 P1', b1 && b1[0] && b1[0][1] === 'P1', b1 && b1[0]);
  ok('P1 积分 = 100', b1 && b1[0] && b1[0][2] === '100', b1 && b1[0]);
  ok('P2 积分 = 80', byName(b1, 'P2')[2] === '80', byName(b1, 'P2'));
  const boardMeta = await ev(`(function(){
    var cards=[].slice.call(document.querySelectorAll('#view-standing .card'));
    var c=cards.filter(function(x){return /赛事积分榜/.test(x.innerText)})[0];
    return {
      title: c.querySelector('h3').innerText.replace(/\\s+/g,' '),
      hasCSV: !!c.querySelector('[data-act="ptsCSV"]'),
      hint: c.innerText.replace(/\\s+/g,' ').slice(0,80)
    };
  })()`);
  ok('标题标出「按名次 · 整站一次」', /按名次/.test(boardMeta.title) && /整站/.test(boardMeta.title), boardMeta.title);
  ok('有导出积分榜 CSV 按钮', boardMeta.hasCSV === true);
  await shot('v25_pts_standing.png');

  console.log('\n=== 4. 赛季只做加总 ===');
  const opened1 = await openSeasonByName('2026 积分联赛');
  await sleep(600);
  ok('能打开「2026 积分联赛」', opened1 === 'ok', opened1);
  const se1 = await seasonRows();
  ok('赛季积分榜渲染', !!se1 && se1.rows.length === 8, se1 && se1.rows && se1.rows.length);
  ok('表头列出两站', se1 && /第 1 站/.test(se1.th.join('')) && /第 2 站/.test(se1.th.join('')), se1 && se1.th);
  ok('P1 = 100(第1站) + 5(第2站第8) = 105', byName(se1.rows, 'P1')[2] === '105', byName(se1.rows, 'P1'));
  ok('P2 = 80 + 10 = 90', byName(se1.rows, 'P2')[2] === '90', byName(se1.rows, 'P2'));
  ok('P3 = 65 + 15 = 80', byName(se1.rows, 'P3')[2] === '80', byName(se1.rows, 'P3'));
  ok('两站分值不同也能各算各的（不是同一套分值）',
    byName(se1.rows, 'P1')[5] === '100' && byName(se1.rows, 'P1')[6] === '5',
    byName(se1.rows, 'P1'));
  const seMeta = await ev(`(function(){
    return {head:(document.querySelector('.page-h p')||{}).innerText||'',
      kpi:[].slice.call(document.querySelectorAll('.kpi .k b')).map(function(b){return b.innerText.trim()}),
      text:(function(){var c=[].slice.call(document.querySelectorAll('#view-season .card')).filter(function(x){return /计分规则/.test(x.innerText)})[0]; return c?c.innerText.replace(/\\s+/g,' '):''})()};
  })()`);
  ok('页头标「各站积分加总」', /各站积分加总/.test(seMeta.head), seMeta.head);
  ok('KPI 计分来源 = 各站自定', seMeta.kpi[2] === '各站自定', seMeta.kpi);
  ok('规则摘要说明「只做加总」', /只做加总/.test(seMeta.text), seMeta.text.slice(0, 160));
  await shot('v25_season_site.png');

  console.log('\n=== 5. 改赛事分值 → 排名与赛季联动 ===');
  await view('list');
  await ev(`(function(){
    var trs=[].slice.call(document.querySelectorAll('#view-list tbody tr'));
    var tr=trs.filter(function(r){return /积分赛 · 第 1 站/.test(r.innerText)})[0];
    tr.querySelector('[data-act="openT"]').click();
    return 'ok';
  })()`);
  await sleep(500);
  await view('setup');
  await sleep(400);
  await pick('[data-bind="ptsRule.rank.tiers[0].pts"]', '200');
  await sleep(500);
  await view('standing');
  await sleep(450);
  const b2 = await boardRows();
  ok('改第 1 名分值为 200 → 排名页 P1 = 200', byName(b2, 'P1')[2] === '200', byName(b2, 'P1'));
  await openSeasonByName('2026 积分联赛');
  await sleep(600);
  const se2 = await seasonRows();
  ok('赛季同步：P1 = 200 + 5 = 205', byName(se2.rows, 'P1')[2] === '205', byName(se2.rows, 'P1'));
  ok('P1 仍排第一', se2.rows[0][1] === 'P1', se2.rows[0]);

  console.log('\n=== 6. 按阶段计分 + 阶段单独设置 ===');
  await view('setup');
  await sleep(400);
  await pick('[data-bind="ptsRule.unit"]', 'stage');
  await sleep(500);
  const stageArea = await ev(`(function(){
    var cards=[].slice.call(document.querySelectorAll('#view-setup .card'));
    var c=cards.filter(function(x){return /赛事积分榜/.test(x.innerText)})[0];
    return {stack: !!c.querySelector('[data-bind="ptsRule.stack"]'),
      editBtns: c.querySelectorAll('[data-act="ptsStageEdit"]').length};
  })()`);
  ok('改成按阶段后出现「阶段叠加」开关', stageArea.stack === true, stageArea);
  await click('[data-act="ptsStageEdit"]');
  await sleep(500);
  const ovPanel = await ev(`(function(){
    var p=document.querySelector('.sub-panel');
    if(!p) return null;
    return {tag:/单独设置/.test(document.getElementById('view-setup').innerText),
      mode:(p.querySelector('[data-bind="ptsRule.stageOv.0.mode"]')||{}).value,
      tiers:p.querySelectorAll('.tier-row').length};
  })()`);
  ok('展开阶段独立规则面板', !!ovPanel, ovPanel);
  ok('该阶段标记为「单独设置」', ovPanel && ovPanel.tag === true);
  ok('独立规则默认复制赛事规则（按名次 + 8 档以上）',
    ovPanel && ovPanel.mode === 'rank' && ovPanel.tiers >= 8, ovPanel);
  await pick('[data-bind="ptsRule.stageOv.0.mode"]', 'win');
  await sleep(500);
  await view('standing');
  await sleep(450);
  const b3 = await boardRows();
  // 8 人单败里冠军 3 胜 × 每胜 10 = 30
  ok('阶段改按胜场后 P1 = 3 胜 × 10 = 30', byName(b3, 'P1')[2] === '30', byName(b3, 'P1'));
  await view('setup');
  await sleep(400);
  await click('[data-act="ptsStageReset"]');
  await sleep(500);
  const afterReset = await ev(`(function(){
    var c=[].slice.call(document.querySelectorAll('#view-setup .card')).filter(function(x){return /赛事积分榜/.test(x.innerText)})[0];
    return {panel: !!document.querySelector('.sub-panel'), reset: c.querySelectorAll('[data-act="ptsStageReset"]').length};
  })()`);
  ok('恢复默认后展开面板收起', afterReset.panel === false, afterReset.panel);
  ok('恢复默认后不再显示「恢复默认」按钮', afterReset.reset === 0, afterReset.reset);
  await view('standing');
  await sleep(450);
  const b4 = await boardRows();
  ok('恢复默认后回到按名次（P1 = 200）', byName(b4, 'P1')[2] === '200', byName(b4, 'P1'));

  console.log('\n=== 7. 赛季切换计分来源 ===');
  await openSeasonByName('2026 积分联赛');
  await sleep(600);
  await click('[data-act="seasonRules"]');
  await sleep(500);
  const srcBtn = await ev(`!!document.querySelector('[data-act="seasonSrc"][data-src="season"]')`);
  ok('加总模式里能切到「统一规则」', srcBtn === true);
  await click('[data-act="seasonSrc"][data-src="season"]');
  await sleep(300);
  await ev(`(function(){var b=document.getElementById('modalOk'); if(b) b.click(); return 1})()`);
  await sleep(600);
  const unified = await ev(`(function(){
    return {mode: !!document.querySelector('[data-sbind="rule.mode"]'),
      head:(document.querySelector('.page-h p')||{}).innerText||''};
  })()`);
  ok('切换后出现「赛季统一规则」表单', unified.mode === true, unified);
  ok('页头不再写「各站积分加总」', !/各站积分加总/.test(unified.head), unified.head);
  await shot('v25_season_unified.png');

  await ev(`(function(){
    var b=document.querySelector('[data-act="seasonSrc"][data-src="tournament"]');
    if(!b) return 'none'; b.click(); return 'ok';
  })()`);
  await sleep(600);
  const backAgg = await ev(`(function(){
    return {head:(document.querySelector('.page-h p')||{}).innerText||'',
      form: !!document.querySelector('[data-act="seasonSrc"][data-src="season"]')};
  })()`);
  ok('能切回「各站自己的积分规则」', /各站积分加总/.test(backAgg.head), backAgg.head);

  console.log('\n=== 8. 无脚本报错 / 手机档 ===');
  const errs = await ev('window.__errs || []');
  ok('全程无 JS 报错', errs.length === 0, errs);

  await conn.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  await view('setup');
  await sleep(500);
  const mob = await ev(`(function(){
    return {ov: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tiers: document.querySelectorAll('#view-setup .tier-row').length,
      cardW: (function(){var c=[].slice.call(document.querySelectorAll('#view-setup .card')).filter(function(x){return /赛事积分榜/.test(x.innerText)})[0]; return c?c.getBoundingClientRect().width:0})()};
  })()`);
  ok('手机档设置页无横向溢出', mob.ov <= 0, mob.ov);
  ok('手机档档位行仍在（自动换行）', mob.tiers >= 8, mob.tiers);
  ok('手机档卡片没有超出屏幕', mob.cardW > 0 && mob.cardW <= 390, mob.cardW);
  await shot('v25_pts_mobile.png');

  console.log('\n----------------------------------------');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  console.log('----------------------------------------');
  conn.close();
  env.child.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
