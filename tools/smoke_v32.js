/**
 * v2.4 界面验收
 *  1. 赛季「积分规则」：三种计分方式可选，只显示当前那一种的设置
 *  2. 统一计分：改分值 → 积分榜立刻变
 *  3. 每个阶段分别设置：每个阶段都能改「方式 + 分值」（原来改不动的 bug）
 *  4. 切回「各站自己的积分」
 *  5. 提前晋级/淘汰场景：奇数人数下轮空只有 1 个，且不是「谁都不是」的空轮空
 *  6. 手机档无横向溢出 / 全程无 JS 报错
 */
const path = require('path'), fs = require('fs');
const { launch, connect } = require('./headless');
const PORT = 9475;
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
  return await ev(`(function(){
    var e=document.querySelector(${JSON.stringify(sel)});
    if(!e) return 'none';
    if(e.disabled) return 'disabled';
    e.click(); return 'ok';
  })()`);
}
async function okModal() {
  const r = await ev(`(function(){var b=document.getElementById('modalOk'); if(!b) return 'none'; b.click(); return 'ok'})()`);
  await sleep(500);
  return r;
}
async function setVal(sel, val, type) {
  return await ev(`(function(){
    var el=document.querySelector(${JSON.stringify(sel)});
    if(!el) return 'none';
    ${type === 'checkbox'
      ? `el.checked=${JSON.stringify(!!val)};`
      : `el.value=${JSON.stringify(String(val))};`}
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return 'ok';
  })()`);
}
// 积分榜某人的总分
async function totalOf(name) {
  return await ev(`(function(){
    var trs=[].slice.call(document.querySelectorAll('.season-tbl tbody tr'));
    for(var i=0;i<trs.length;i++){
      var tds=trs[i].children;
      if(tds[1] && tds[1].innerText.trim()===${JSON.stringify(name)}) return parseFloat(tds[2].innerText);
    }
    return null;
  })()`);
}

const SCENE = fs.readFileSync(path.join(__dirname, 'build_v32_scene.js'), 'utf8');

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

  /* ================= 1. 打开赛季 ================= */
  console.log('\n=== 1. 赛季规则入口 ===');
  await view('season');
  await sleep(500);
  const opened = await ev(`(function(){
    var btn=document.querySelector('[data-act="openSeason"]');
    if(!btn) return 'none';
    btn.click(); return 'ok';
  })()`);
  await sleep(600);
  ok('能打开赛季「2026 秋季联赛」', opened === 'ok');
  ok('积分榜里有 P1', (await totalOf('P1')) !== null, await totalOf('P1'));

  await click('[data-act="seasonRules"]');
  await sleep(500);
  const plans = await ev(`(function(){
    return [].slice.call(document.querySelectorAll('.plan-btn')).map(function(b){
      return {p:b.getAttribute('data-plan'), on:b.className.indexOf('on')>=0, t:b.innerText.replace(/\\s+/g,' ').trim()};
    });
  })()`);
  ok('三种计分方式都能选', plans.length === 3, plans);
  ok('默认选中「各站自己的积分」', plans.filter(x => x.on)[0] && plans.filter(x => x.on)[0].p === 'site', plans);
  ok('方案按钮写清了各自作用（不是只有名字）',
    plans.every(x => x.t.length > 12), plans.map(x => x.t));
  await shot('v32_season_plan_site.png');

  /* ================= 2. 赛季统一计分 ================= */
  console.log('\n=== 2. 赛季统一计分（一套分值） ===');
  await click('[data-act="seasonPlan"][data-plan="single"]');
  await okModal();
  await sleep(600);
  const single = await ev(`(function(){
    return {mode: !!document.querySelector('[data-sbind="rule.mode"]'),
      unit: !!document.querySelector('[data-sbind="rule.unit"]'),
      tiers: document.querySelectorAll('.tier-row').length,
      stageRows: document.querySelectorAll('.se-unit').length,
      head:(document.querySelector('.page-h p')||{}).innerText||''};
  })()`);
  ok('出现「计分方法」下拉', single.mode === true, single);
  ok('出现「计分单元」下拉', single.unit === true, single);
  ok('出现名次档位表（可直接改分值）', single.tiers >= 6, single.tiers);
  ok('统一计分时不显示逐阶段卡片', single.stageRows === 0, single.stageRows);
  ok('页头不再写「各站积分加总」', !/各站积分加总/.test(single.head), single.head);

  // 把第 1 名改成 500 分 → 积分榜 P1 的分数应变大
  const before = await totalOf('P1');
  await setVal('[data-sbind="rule.rank.tiers[0].pts"]', 500);
  await sleep(600);
  const after = await totalOf('P1');
  ok('改第 1 名分值后积分榜立刻重算', after !== before && after >= 500, { before, after });

  /* ================= 3. 每个阶段分别设置 ================= */
  console.log('\n=== 3. 每个阶段分别设置 ===');
  await click('[data-act="seasonPlan"][data-plan="stage"]');
  await sleep(700);
  const stageView = await ev(`(function(){
    var rows=[].slice.call(document.querySelectorAll('.se-unit'));
    return {n:rows.length, names:rows.map(function(r){return r.innerText.replace(/\\s+/g,' ').trim()}), subs:document.querySelectorAll('.sub-panel').length};
  })()`);
  ok('每个计分单元（2 站 × 2 阶段 = 4）各一行', stageView.n === 4, stageView.names);
  ok('默认全部收起（不挤爆页面）', stageView.subs === 0, stageView.subs);

  // 展开第 1 个阶段
  await click('.se-unit [data-act="seStageToggle"]');
  await sleep(600);
  const panel = await ev(`(function(){
    var p=document.querySelector('.sub-panel');
    if(!p) return null;
    return {mode: !!p.querySelector('[data-se-path="mode"]'),
      stack: !!p.querySelector('[data-se-path="stack"]'),
      tiers: p.querySelectorAll('.tier-row').length,
      perWin: !!p.querySelector('[data-se-path="win.perWin"]')};
  })()`);
  ok('展开后有「计分方法」下拉', panel && panel.mode === true, panel);
  ok('展开后有「是否叠加」下拉', panel && panel.stack === true, panel);
  ok('展开后有名次档位（分值可改）', panel && panel.tiers >= 6, panel && panel.tiers);

  // 改成按胜场 → 出现胜场分输入
  await setVal('.sub-panel [data-se-path="mode"]', 'win');
  await sleep(600);
  const winPanel = await ev(`(function(){
    var p=document.querySelector('.sub-panel');
    return {perWin: !!p.querySelector('[data-se-path="win.perWin"]'), tiers: p.querySelectorAll('.tier-row').length};
  })()`);
  ok('改成「按胜场」后出现胜场分输入框（方式真的能改）', winPanel.perWin === true, winPanel);
  ok('改方式后档位表收起', winPanel.tiers === 0, winPanel.tiers);

  // 填一个夸张的分值，确认积分榜跟着变
  const beforeWin = await totalOf('P1');
  await setVal('.sub-panel [data-se-path="win.perWin"]', 200);
  await sleep(700);
  const afterWin = await totalOf('P1');
  ok('逐阶段改胜场分值后积分榜立刻重算', afterWin !== beforeWin, { beforeWin, afterWin });

  const saved = await ev(`(function(){
    var se=TMS.store.getSeason(TMS.store.getSeason('x')?'x':'');
    var list=TMS.store.loadSeasons();
    var s=TMS.store.getSeason(list[0].id);
    var keys=Object.keys(s.rule.overrides||{});
    var withWin=keys.filter(function(k){return (s.rule.overrides[k]||{}).mode==='win';});
    return {plan:s.rule.plan, keys:keys.length, win:withWin.length, sample: keys.length?s.rule.overrides[keys[0]]:null};
  })()`);
  ok('落盘：季度方案 = stage', saved.plan === 'stage', saved.plan);
  ok('落盘：每个阶段都有完整规则（含 rank/win）',
    saved.keys === 4 && !!saved.sample && !!saved.sample.rank && !!saved.sample.win, saved);
  ok('落盘：被改过的那个阶段 mode=win', saved.win === 1, saved.win);
  await shot('v32_season_stage.png');

  // 第 2 个阶段改档位分值
  await ev(`(function(){
    var rows=[].slice.call(document.querySelectorAll('.se-unit'));
    rows[1].querySelector('[data-act="seStageToggle"]').click(); return 1;
  })()`);
  await sleep(600);
  const beforeTier = await totalOf('P1');
  await setVal('.sub-panel [data-se-path="rank.tiers[0].pts"]', 777);
  await sleep(700);
  const tierChanged = await ev(`(function(){
    var list=TMS.store.loadSeasons();var s=TMS.store.getSeason(list[0].id);
    var keys=Object.keys(s.rule.overrides||{});
    var k=keys[1];
    return s.rule.overrides[k].rank.tiers[0].pts;
  })()`);
  ok('第 2 个阶段的名次分值也能单独改（落到第 2 个 key 上）', tierChanged === 777, tierChanged);
  ok('改第 2 个阶段后积分榜也重算', (await totalOf('P1')) !== beforeTier, beforeTier);

  /* ================= 4. 切回各站自己的积分 ================= */
  console.log('\n=== 4. 切回「各站自己的积分」 ===');
  await click('[data-act="seasonPlan"][data-plan="site"]');
  await okModal();
  await sleep(700);
  const backSite = await ev(`(function(){
    return {head:(document.querySelector('.page-h p')||{}).innerText||'',
      planOn:(document.querySelector('.plan-btn.on')||{}).getAttribute?document.querySelector('.plan-btn.on').getAttribute('data-plan'):''};
  })()`);
  ok('页头回到「各站积分加总」', /各站积分加总/.test(backSite.head), backSite.head);
  ok('选中状态回到「各站自己的积分」', backSite.planOn === 'site', backSite.planOn);

  /* ================= 5. 轮空（提前晋级 / 淘汰） ================= */
  console.log('\n=== 5. 奇数人数下的轮空 ===');
  await view('list');
  await sleep(400);
  const opened2 = await ev(`(function(){
    var trs=[].slice.call(document.querySelectorAll('#view-list tbody tr'));
    var tr=trs.filter(function(r){return r.innerText.indexOf('奇数人数瑞士轮')>=0})[0];
    if(!tr) return 'none';
    tr.querySelector('[data-act="openT"]').click(); return 'ok';
  })()`);
  await sleep(600);
  ok('能打开「奇数人数瑞士轮」', opened2 === 'ok');
  await view('matches');
  await sleep(700);
  const byeInfo = await ev(`(function(){
    var t=TMS.store.get(TMS.store.getCurrentId());
    var st=t.stages[0];
    var rd=st.roundsData[st.roundsData.length-1];
    var byes=(rd.matches||[]).filter(function(m){return m.isBye;});
    return {alive:TMS.engine.aliveInStage(t,st).length, byes:byes.length,
      empty: byes.filter(function(m){return !(m.playerA||m.playerB);}).length,
      cards: document.querySelectorAll('.match').length,
      byeCards: [].slice.call(document.querySelectorAll('.match')).filter(function(x){return /轮空|BYE/.test(x.innerText)}).length};
  })()`);
  ok('9 人瑞士轮第 1 轮：参赛 9 人', byeInfo.alive === 9, byeInfo);
  ok('只有 1 个轮空（= 9 % 2）', byeInfo.byes === 1, byeInfo);
  ok('没有「谁都不是」的空轮空', byeInfo.empty === 0, byeInfo);
  ok('对阵页上能看到轮空', byeInfo.byeCards >= 1, byeInfo.byeCards);
  await shot('v32_bye.png');

  /* ================= 6. 手机档 / 报错 ================= */
  console.log('\n=== 6. 手机档 / 无报错 ===');
  const errs = await ev('window.__errs || []');
  ok('全程无 JS 报错', errs.length === 0, errs);

  await conn.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  await view('season');
  await sleep(500);
  await ev(`(function(){var b=document.querySelector('[data-act="openSeason"]'); if(b) b.click(); return 1})()`);
  await sleep(700);
  // 规则面板可能已经是展开状态，别把它点回去
  if (await ev(`document.querySelectorAll('.plan-btn').length`) === 0) {
    await click('[data-act="seasonRules"]');
    await sleep(600);
  }
  const mob = await ev(`(function(){
    return {ov: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      plans: document.querySelectorAll('.plan-btn').length,
      planW: (function(){var b=document.querySelector('.plan-btn');return b?Math.round(b.getBoundingClientRect().width):0})()};
  })()`);
  ok('手机档赛季页无横向溢出', mob.ov <= 0, mob.ov);
  ok('手机档三个方案按钮都在', mob.plans === 3, mob.plans);
  ok('手机档方案按钮宽在屏内', mob.planW > 0 && mob.planW <= 390, mob.planW);
  await shot('v32_season_mobile.png');

  console.log('\n----------------------------------------');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  console.log('----------------------------------------');
  conn.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SMOKE 崩了:', e.message); process.exit(1); });
