/**
 * v2.2 界面验收 —— ① 各赛制手动指定对阵 ② 双败半区互换
 *  1. 瑞士轮：生成首轮 → 打开点选面板 → 点两人成桌 → 确认
 *  2. 循环赛：随机配对 → 确认（不再一次性生成全部轮）
 *  3. 小组赛：按组分别编排（A 组排完自动切到 B 组）
 *  4. 单败淘汰：手动摆放首轮位（座位表换位 → 生成首轮，顺序与座位一致）
 *  5. 双败半区互换：设置开关 + 提示 + 败者组上/下半区标记
 *  6. 手机档无横向溢出
 *  7. 全程无 JS 报错
 */
const path = require('path'), fs = require('fs');
const { launch, connect } = require('./headless');
const PORT = 9472;
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
async function viewText() {
  return await ev(`document.getElementById('view-matches').innerText`);
}

const SCENE = fs.readFileSync(path.join(__dirname, 'build_v30_scene.js'), 'utf8');

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

  /* ================= 1. 瑞士轮：点选配对 ================= */
  console.log('\n=== 1. 瑞士轮手动配对 ===');
  ok('能打开「瑞士轮手动配对」', (await openT('瑞士轮手动配对')) === 'ok');
  await view('matches');
  await sleep(500);
  ok('有「生成首轮对阵」按钮', (await click('[data-act="genRound"]')) === 'ok');
  await sleep(600);
  ok('点生成 → 直接打开点选面板（不再自动配对）', await count('.arrcard') === 1);
  const af = await text('.arrcard');
  ok('面板说明是逐轮点选（不是首轮摆位）', /点两名选手组成一桌/.test(af), af.slice(0, 60));
  ok('选手芯片 8 个', await count('.arrcard .chip') === 8, await count('.arrcard .chip'));
  await ev(`(function(){
    var cs=[].slice.call(document.querySelectorAll('.arrcard .chip'));
    cs[0].click(); return 1;
  })()`);
  await sleep(350);
  ok('选 1 人后进入选中态', await count('.arrcard .chip.sel') === 1);
  await ev(`(function(){
    var cs=[].slice.call(document.querySelectorAll('.arrcard .chip'));
    cs.filter(function(c){return !c.classList.contains('sel')})[0].click(); return 1;
  })()`);
  await sleep(400);
  ok('再点 1 人 → 组成 1 桌', await count('.arrcard .arr-pair') === 1, await count('.arrcard .arr-pair'));
  ok('点「拆开」可以把这桌拆掉', (await click('[data-act="dBreak"]')) === 'ok');
  await sleep(400);
  ok('拆开后又回到 0 桌', await count('.arrcard .arr-pair') === 0, await count('.arrcard .arr-pair'));
  await shot('v30_arrange.png');
  ok('点「随机配对」补齐 4 桌', (await click('[data-act="dRandom"]')) === 'ok');
  await sleep(500);
  ok('随机后 4 桌', await count('.arrcard .arr-pair') === 4, await count('.arrcard .arr-pair'));
  ok('点「确认本轮对阵」', (await click('[data-act="dConfirm"]')) === 'ok');
  await sleep(700);
  ok('首轮已生成 4 桌', await count('.match.mrow') === 4, await count('.match.mrow'));
  ok('确认后面板自动收起', await count('.arrcard') === 0);
  await shot('v30_swiss.png');

  /* ================= 2. 循环赛：随机配对 ================= */
  console.log('\n=== 2. 循环赛手动配对 ===');
  ok('能打开「循环赛手动配对」', (await openT('循环赛手动配对')) === 'ok');
  await view('matches');
  await sleep(500);
  await click('[data-act="genRound"]');
  await sleep(600);
  ok('循环赛也能打开点选面板', await count('.arrcard') === 1);
  ok('点「随机配对」', (await click('[data-act="dRandom"]')) === 'ok');
  await sleep(500);
  ok('6 人 → 随机排出 3 桌', await count('.arrcard .arr-pair') === 3, await count('.arrcard .arr-pair'));
  await click('[data-act="dConfirm"]');
  await sleep(700);
  ok('确认后生成 3 桌对阵', await count('.match.mrow') === 3, await count('.match.mrow'));

  /* ================= 3. 小组赛：按组分别编排 ================= */
  console.log('\n=== 3. 小组赛按组编排 ===');
  ok('能打开「小组赛手动配对」', (await openT('小组赛手动配对')) === 'ok');
  await view('matches');
  await sleep(500);
  await click('[data-act="genRound"]');
  await sleep(600);
  ok('面板里有「编排哪个组」切换', await count('.arrcard .arr-groups') === 1);
  ok('两个小组各有一个切换按钮', await count('.arrcard .arr-groups .rchip') === 2,
    await count('.arrcard .arr-groups .rchip'));
  const gtxt = await text('.arrcard .arr-groups');
  ok('组按钮标明待编排人数（4 人）', /4 人/.test(gtxt), gtxt.slice(0, 60));
  await shot('v30_arr_group.png');
  await click('[data-act="dRandom"]');
  await sleep(450);
  await click('[data-act="dConfirm"]');
  await sleep(700);
  ok('排完 A 组 → 面板仍在（还有 B 组）', await count('.arrcard') === 1);
  const gtxt2 = await text('.arrcard');
  ok('自动切到下一个待编排的组', /4 人/.test(gtxt2), gtxt2.slice(0, 50));
  await click('[data-act="dRandom"]');
  await sleep(450);
  await click('[data-act="dConfirm"]');
  await sleep(700);
  ok('两个组都排完 → 面板收起', await count('.arrcard') === 0);
  ok('两个组各落 1 轮（轮次条 2 轮）', await count('#view-matches .rchip') === 2,
    await count('#view-matches .rchip'));
  ok('最新一轮只显示该组自己的 2 桌', await count('.match.mrow') === 2, await count('.match.mrow'));
  ok('最新一轮标题是组名（按组落轮）', /B 组|A 组/.test(await ev(`(function(){
    var h=document.querySelector('#view-matches .card h4');
    return h?h.innerText:'';
  })()`)), await ev(`(function(){var h=document.querySelector('#view-matches .card h4');return h?h.innerText:''})()`));
  const gt = await viewText();
  ok('对阵页按组分块显示（小组名作为小标题）', /A 组|B 组|第 1 组|第 2 组/.test(gt), gt.slice(0, 80));
  await shot('v30_groups.png');

  /* ================= 4. 单败淘汰：手动摆放首轮位 ================= */
  console.log('\n=== 4. 单败手动摆放首轮位 ===');
  ok('能打开「单败手动摆位」', (await openT('单败手动摆位')) === 'ok');
  await view('matches');
  await sleep(500);
  ok('有「手动摆放首轮位」按钮', await count('[data-act="toggleSlot"]') === 1);
  ok('点「生成首轮对阵」→ 打开座位表', (await click('[data-act="genRound"]')) === 'ok');
  await sleep(600);
  ok('座位表出现', await count('.arrcard') === 1);
  ok('8 个座位', await count('.arrcard .seat') === 8, await count('.arrcard .seat'));
  ok('座位默认已按种子位预填', await count('.arrcard .seat.on') === 8, await count('.arrcard .seat.on'));
  ok('候选芯片 8 个', await count('.arrcard .chip') === 8);

  // 换位：拿起 1 号位的人，放到 3 号位（两人互换）
  const before = await ev(`(function(){return [].slice.call(document.querySelectorAll('.arrcard .seat')).map(function(e){return e.innerText.trim()})})()`);
  await ev(`(function(){var s=document.querySelectorAll('.arrcard .seat');s[0].click();return 1})()`);
  await sleep(350);
  ok('点座位把人「拿起来」', await count('.arrcard .seat.pick') === 1);
  await ev(`(function(){var s=document.querySelectorAll('.arrcard .seat');s[2].click();return 1})()`);
  await sleep(400);
  const after = await ev(`(function(){return [].slice.call(document.querySelectorAll('.arrcard .seat')).map(function(e){return e.innerText.trim()})})()`);
  ok('两个座位的人互换', after[0] === before[2] && after[2] === before[0],
    { before: before.slice(0, 4), after: after.slice(0, 4) });
  await shot('v30_slots.png');

  ok('点「确认摆放并生成首轮」', (await click('[data-act="sConfirm"]')) === 'ok');
  await sleep(800);
  ok('首轮生成 4 桌', await count('.match.mrow') === 4, await count('.match.mrow'));
  ok('座位表收起', await count('.arrcard') === 0);
  const firstCard = await ev(`(function(){
    var c=document.querySelectorAll('.match.mrow')[0];
    return c?c.innerText.replace(/\\s+/g,' '):'';
  })()`);
  ok('第 1 桌 = 座位表前两个位置（摆放顺序生效）',
    firstCard.indexOf(after[0]) >= 0 && firstCard.indexOf(after[1]) >= 0,
    { card: firstCard.slice(0, 60), seat: after.slice(0, 2) });

  /* ================= 5. 双败半区互换 ================= */
  console.log('\n=== 5. 双败半区互换 ===');
  ok('能打开「双败半区互换」', (await openT('双败半区互换')) === 'ok');
  await view('matches');
  await sleep(600);
  const dt = await viewText();
  ok('对阵页有「半区互换」说明', /半区互换/.test(dt), dt.slice(0, 120));
  ok('败者组按上/下半区分块', /败者组 · (上|下)半区/.test(dt), dt.slice(0, 200));
  ok('存在败者组比赛卡（半区互换后败者组第 2 轮才出现）',
    await count('.msec.loser') >= 1, await count('.msec.loser'));
  await shot('v30_cross.png');

  // 设置页：开关存在且已勾选
  await view('setup');
  await sleep(600);
  const sw = await ev(`(function(){
    var e=document.querySelector('[data-bind="stages[0].deCrossDrop"]');
    var txt=document.getElementById('view-setup').innerText;
    return {has:!!e, on:!!(e&&e.checked), tip:/半区互换/.test(txt)};
  })()`);
  ok('阶段设置里有「启用半区互换」开关', sw.has === true);
  ok('开关状态与场景一致（已开启）', sw.on === true);
  ok('设置页有半区互换说明', sw.tip === true);

  // 编排方式下拉里有「手动摆放首轮位」
  const dm = await ev(`(function(){
    var s=document.querySelector('[data-bind="stage.drawMode"]')||document.querySelector('select[data-bind="stages[0].drawMode"]');
    if(!s) return null;
    return [].slice.call(s.options).map(function(o){return o.value+':'+o.text});
  })()`);
  ok('淘汰赛「编排方式」含手动摆放首轮位',
    !!dm && dm.some(x => x.indexOf('manual') === 0), dm);

  // 对阵图里有半区互换说明
  await view('standing');
  await sleep(600);
  const br = await ev(`document.getElementById('view-standing').innerText`);
  ok('对阵图说明里写了半区互换', /半区互换/.test(br), br.slice(0, 120));
  await shot('v30_cross_bracket.png');

  /* ================= 6. 手机档 ================= */
  console.log('\n=== 6. 手机档 390×844（编排面板） ===');
  await openT('单败手动摆位');
  await view('matches');
  await sleep(500);
  await conn.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(900);
  await click('[data-act="toggleSlot"]');
  await sleep(600);
  const mob = await ev(`(function(){
    var seats=[].slice.call(document.querySelectorAll('.arrcard .seat'));
    var over=seats.filter(function(x){return x.getBoundingClientRect().right>window.innerWidth+0.5}).length;
    var sm=seats.filter(function(x){return x.getBoundingClientRect().width<60}).length;
    return {ov:document.documentElement.scrollWidth-document.documentElement.clientWidth,
      over:over, narrow:sm, n:seats.length};
  })()`);
  ok('手机档无横向溢出', mob.ov <= 0, mob.ov);
  ok('座位按钮没有越界', mob.over === 0, mob);
  ok('座位按钮宽度可用（≥60px）', mob.narrow === 0, mob);
  await shot('v30_mobile.png');
  await conn.send('Emulation.clearDeviceMetricsOverride');
  await sleep(400);

  /* ================= 7. 无报错 ================= */
  console.log('\n=== 7. 无 JS 报错 ===');
  const errs = await ev(`window.__errs||[]`);
  if (errs && errs.length) console.log('    errors: ' + JSON.stringify(errs));
  ok('全程无 JS 报错', !errs || errs.length === 0);

  console.log('\n----------------------------------------');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  console.log('----------------------------------------');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
