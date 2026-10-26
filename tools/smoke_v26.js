/**
 * v1.14.0 界面验证
 *  1. 设置页 · 回合（一场 = 若干回合）
 *  2. 阶段编辑器 · 本阶段回合数（独立局制）
 *  3. 选手页 · 起始阶段下拉 + 后进选手不进第 1 阶段对阵
 *  4. 对阵卡片 · 长行布局（主行 + 折叠明细 + 录入比分按钮）
 *  5. 回合录入 · 逐回合推进与进度条
 *  6. 团体赛 · 设置卡片 / 队伍与队员 / 逐盘录入
 *  7. 团体赛 · 排名按队伍
 *  8. 手机档 · 长行两行布局、无横向溢出
 *  9. 无脚本报错
 */
const path = require('path'), fs = require('fs');
const { launch, connect } = require('./headless');
const PORT = 9467;
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
async function check(sel, on) {
  return await ev(`(function(){
    var el=document.querySelector(${JSON.stringify(sel)});
    if(!el) return 'none';
    el.checked=${on ? 'true' : 'false'};
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return el.checked;
  })()`);
}
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
async function openT(name) {
  await view('list');
  await sleep(300);
  return await ev(`(function(){
    var trs=[].slice.call(document.querySelectorAll('#view-list tbody tr'));
    var tr=trs.filter(function(r){return r.innerText.indexOf(${JSON.stringify(name)})>=0})[0];
    if(!tr) return 'none';
    tr.querySelector('[data-act="openT"]').click();
    return 'ok';
  })()`);
}

const SCENE = fs.readFileSync(path.join(__dirname, 'build_v26_scene.js'), 'utf8');

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

  /* ================= 1. 回合（赛事级默认局制） ================= */
  console.log('\n=== 1. 设置页 · 回合 ===');
  await view('setup');
  const rounds = await ev(`(function(){
    var q=function(s){var e=document.querySelector(s);return e?e.value:null};
    return {
      per: q('[data-bind="format.gamesPerMatch"]'),
      sets: q('[data-bind="format.sets"]'),
      rule: q('[data-bind="format.setRule"]'),
      need: q('[data-bind="format.setsToWin"]'),
      label: /每回合比赛局数/.test(document.getElementById('view-setup').innerText),
      tip: /三场五局三胜|打三场/.test(document.getElementById('view-setup').innerText)
    };
  })()`);
  ok('局制卡片按回合改口径（「每回合比赛局数」）', rounds.label === true, rounds.label);
  ok('回合数 = 3', rounds.sets === '3', rounds.sets);
  ok('判定依据 = 赢下回合数', rounds.rule === 'sets', rounds.rule);
  ok('需赢 2 回合', rounds.need === '2', rounds.need);
  ok('有「三个回合都打满」的说明', rounds.tip === true, rounds.tip);

  await pick('[data-bind="format.sets"]', '1');
  await sleep(500);
  const oneSet = await ev(`(function(){
    return {rule: !!document.querySelector('[data-bind="format.setRule"]'),
      label: /每场比赛局数/.test(document.getElementById('view-setup').innerText)};
  })()`);
  ok('回合数改 1 → 不再问「怎么定胜负」', oneSet.rule === false, oneSet);
  ok('回合数改 1 → 文案退回「每场比赛局数」', oneSet.label === true, oneSet.label);
  await pick('[data-bind="format.sets"]', '3');
  await sleep(500);
  const backSets = await ev(`!!document.querySelector('[data-bind="format.setRule"]')`);
  ok('改回 3 回合 → 判定依据回来', backSets === true);
  await shot('v26_setup_rounds.png');

  /* ================= 2. 阶段编辑器 · 本阶段回合数 ================= */
  console.log('\n=== 2. 阶段编辑器 · 独立回合数 ===');
  const cbR = await check('[data-bind="stages[0].useFormat"]', true);
  await sleep(500);
  const stFmt = await ev(`(function(){
    var q=function(s){var e=document.querySelector(s);return e?e.value:null};
    return {per:q('[data-bind="stages[0].format.gamesPerMatch"]'),
      sets:q('[data-bind="stages[0].format.sets"]'),
      rule:q('[data-bind="stages[0].format.setRule"]'),
      need:q('[data-bind="stages[0].format.setsToWin"]'),
      r1:!!document.querySelector('[data-bind="stages[0].format.recordScore"]')};
  })()`);
  ok('勾「本阶段单独设置局制」后出现回合数', cbR === true && stFmt.sets === '3', stFmt);
  ok('阶段局制默认复制赛事（1 局 / 先赢 2 回合）',
    stFmt.per === '1' && stFmt.need === '2' && stFmt.rule === 'sets', stFmt);
  await pick('[data-bind="stages[0].format.sets"]', '2');
  await sleep(500);
  const stNeed = await ev(`(function(){
    var e=document.querySelector('[data-bind="stages[0].format.setsToWin"]');
    return e?e.value:null;
  })()`);
  ok('阶段改成 2 回合后仍可设「需赢几个回合」', stNeed !== null, stNeed);
  await check('[data-bind="stages[0].useFormat"]', false);
  await sleep(500);
  const stNoFmt = await ev(`!!document.querySelector('[data-bind="stages[0].format.sets"]')`);
  ok('取消独立局制后回合字段收起', stNoFmt === false);

  /* ================= 3. 起始阶段 / 后进选手 ================= */
  console.log('\n=== 3. 起始阶段与后进选手 ===');
  await view('players');
  const psel = await ev(`(function(){
    var all=[].slice.call(document.querySelectorAll('select[data-field="startStage"]'));
    return {n:all.length, vals:all.map(function(x){return x.value}),
      head:[].slice.call(document.querySelectorAll('#view-players thead th')).map(function(x){return x.innerText.trim()}),
      opts:[].slice.call(all[0]?all[0].options:[]).map(function(o){return o.textContent.trim()})};
  })()`);
  ok('每位选手都有「起始阶段」下拉', psel.n === 8, psel.n);
  ok('表头有「起始阶段」列', psel.head.indexOf('起始阶段') >= 0, psel.head);
  ok('下拉列出两个阶段', psel.opts.length === 2, psel.opts);
  ok('第 8 人（leftno12）起始阶段 = 第 2 阶段',
    psel.vals.filter(function (v) { return v === '1'; }).length === 1, psel.vals);

  const lateInfo = await ev(`(function(){
    var t=TMS.current;
    var s0=TMS.engine.latecomers(t,0);          // 第 1 阶段的参赛者
    var s1=TMS.engine.latecomers(t,1);          // 从第 2 阶段才开始的人
    var late=t.players.filter(function(p){return p.name==='leftno12'})[0];
    var rd=t.stages[0].roundsData[0];
    return {s0:s0.length, s1:s1.length,
      s1name:(t.players.filter(function(p){return p.id===(s1[0]||{}).id})[0]||{}).name,
      inRound0: rd.matches.some(function(m){return m.playerA===late.id||m.playerB===late.id})};
  })()`);
  ok('第 1 阶段只收 startStage=0 的人（8-1=7）', lateInfo.s0 === 7, lateInfo.s0);
  ok('第 2 阶段把 leftno12 作为后进选手补进来',
    lateInfo.s1 === 1 && lateInfo.s1name === 'leftno12', lateInfo);
  ok('后进选手不出现在第 1 阶段对阵里', lateInfo.inRound0 === false, lateInfo.inRound0);

  // 改一位选手的起始阶段并存档
  const setStart = await ev(`(function(){
    var s=document.querySelectorAll('select[data-field="startStage"]')[0];
    s.value='1'; s.dispatchEvent(new Event('change',{bubbles:true}));
    return TMS.current.players[0].startStage;
  })()`);
  ok('下拉改成第 2 阶段写回存档', setStart === 1, setStart);
  await ev(`(function(){
    var s=document.querySelectorAll('select[data-field="startStage"]')[0];
    s.value='0'; s.dispatchEvent(new Event('change',{bubbles:true})); return 1})()`);
  await sleep(400);
  const backStart = await ev(`TMS.current.players[0].startStage`);
  ok('改回第 1 阶段', backStart === 0, backStart);
  await shot('v26_players_startstage.png');

  /* ================= 4. 长行对阵卡片 ================= */
  console.log('\n=== 4. 对阵卡片长行布局 ===');
  await view('matches');
  const row = await ev(`(function(){
    var cards=[].slice.call(document.querySelectorAll('.match.mrow'));
    var c=cards[0];
    if(!c) return null;
    var det=c.querySelector('.mrow-detail');
    var main=c.querySelector('.mrow-main');
    return {n:cards.length, main:!!main,
      seat:(c.querySelector('.mseat')||{}).innerText||'',
      score:((c.querySelector('.bscore')||{}).innerText||'').replace(/\\s+/g,''),
      btn:((c.querySelector('[data-act="toggleMore"]')||{}).innerText||'').trim(),
      detail:det?getComputedStyle(det).display:'none',
      sides:c.querySelectorAll('.mrow-main .mside').length,
      tags:c.querySelectorAll('.mrow-main .mtags .tag').length};
  })()`);
  ok('4 场对阵都渲染成 .match.mrow', row && row.n === 4, row && row.n);
  ok('主行有座位号 / 双方名字 / 比分', row && row.seat !== '' && row.sides === 2 && /:/.test(row.score), row);
  ok('主行右侧是「明细」按钮（录入已常显在行内）', row && row.btn === '明细', row && row.btn);
  ok('明细区默认收起', row && row.detail === 'none', row && row.detail);
  await shot('v26_matches_rows.png');

  await click('[data-act="toggleMore"]');
  await sleep(450);
  const opened = await ev(`(function(){
    var c=document.querySelector('.match.mrow');
    return {open:/open/.test(c.className), detail:getComputedStyle(c.querySelector('.mrow-detail')).display,
      btn:((c.querySelector('[data-act="toggleMore"]')||{}).innerText||'').trim(),
      hasEntry:!!c.querySelector('[data-act="addGame"]'),
      hasTimer:!!c.querySelector('.tmrow')};
  })()`);
  ok('点「明细」展开明细区', opened.open === true && opened.detail !== 'none', opened);
  ok('展开后按钮写「收起」', opened.btn === '收起', opened.btn);
  ok('展开后能看到逐局录入与计时器', opened.hasEntry === true && opened.hasTimer === true, opened);

  /* ================= 5. 回合录入 ================= */
  console.log('\n=== 5. 逐回合录入 ===');
  await click('[data-act="addGame"][data-w="A"]');
  await sleep(400);
  const g1 = await ev(`(function(){
    var m=TMS.current.stages[0].roundsData[0].matches[0];
    return {n:(m.games||[]).length, s:(m.games||[]).map(function(g){return g.s}),
      decided:!!m.decided, cur:TMS.engine.curSet(m, TMS.engine.fmtOfMatch(TMS.current, TMS.current.stages[0], m), TMS.current.stages[0].tie)};
  })()`);
  ok('第 1 局落在回合 1（s=0）', g1.n === 1 && g1.s[0] === 0, g1);
  ok('赢下回合 1 后进入回合 2', g1.cur === 1, g1.cur);
  const bar1 = await ev(`(function(){
    var c=document.querySelector('.match.mrow');
    var chips=[].slice.call(c.querySelectorAll('.setbar .setchip'));
    return {n:chips.length, done:chips.filter(function(c){return /done/.test(c.className)}).length,
      txt:chips.map(function(c){return c.innerText.replace(/\\s+/g,'')})};
  })()`);
  ok('回合进度条 3 段、已完成 1 段', bar1.n === 3 && bar1.done === 1, bar1);

  await click('[data-act="addGame"][data-w="A"]');
  await sleep(450);
  const g2 = await ev(`(function(){
    var m=TMS.current.stages[0].roundsData[0].matches[0];
    var chips=[].slice.call(document.querySelector('.match.mrow').querySelectorAll('.setbar .setchip'));
    return {n:(m.games||[]).length, s:(m.games||[]).map(function(g){return g.s}),
      decided:!!m.decided, setsA:(m.result||{}).setsA, setsB:(m.result||{}).setsB,
      rule:(m.result||{}).setRule, done:chips.filter(function(c){return /done/.test(c.className)}).length,
      status:((document.querySelector('.match.mrow .mstat')||{}).innerText||'').trim()};
  })()`);
  ok('第 2 局落在回合 2（s=1）', g2.s.join(',') === '0,1', g2.s);
  ok('先赢 2 回合即结束（2:0）', g2.decided === true && g2.setsA === 2 && g2.setsB === 0, g2);
  ok('结算口径记成「按回合」', g2.rule === 'sets', g2.rule);
  ok('进度条已完成 2 段', g2.done === 2, g2.done);
  ok('状态写「已结束」', /已结束|胜/.test(g2.status), g2.status);
  await shot('v26_sets_progress.png');

  /* ================= 6. 团体赛 ================= */
  console.log('\n=== 6. 团体赛（nvn） ===');
  const opened1 = await openT('团体赛 · 4 队 nvn');
  ok('能打开团体赛赛事', opened1 === 'ok', opened1);
  await view('setup');
  const tset = await ev(`(function(){
    var q=function(s){var e=document.querySelector(s);return e?{v:e.value,c:e.checked}:null};
    var txt=document.getElementById('view-setup').innerText;
    return {on:q('[data-bind="team.on"]'), mode:q('[data-bind="team.mode"]'),
      size:q('[data-bind="team.size"]'), play:q('[data-bind="team.playSize"]'),
      need:q('[data-bind="team.winNeeded"]'),
      tip:/赢下的/.test(txt) && /场数/.test(txt),
      allPlay:/所有场次一次打完/.test(txt),
      oneMatch:/一桌 = 一场比赛/.test(txt)};
  })()`);
  ok('设置页有「团体赛」开关且已开', tset.on && tset.on.c === true, tset.on);
  ok('团体赛赛制 = n 对 n', tset.mode && tset.mode.v === 'nvn', tset.mode);
  ok('每队人数 3', tset.size && tset.size.v === '3', tset.size);
  ok('有「每方上场人数」（队员不一定等于上场人数）', tset.play && tset.play.v === '0', tset.play);
  ok('nvn 不再有胜盘线（全部打完比赢场）', tset.need === null && tset.allPlay === true, tset);
  ok('说明「一桌 = 一场比赛」+「大比分 = 赢下的场数」', tset.oneMatch === true && tset.tip === true, tset);

  await pick('[data-bind="team.mode"]', 'kof');
  await sleep(500);
  const kof = await ev(`(function(){
    var txt=document.getElementById('view-setup').innerText;
    return {need:!!document.querySelector('[data-bind="team.winNeeded"]'),
      tip:/KOF/.test(txt) && /对方/.test(txt) && /击败/.test(txt)};
  })()`);
  ok('切到 KOF 后没有胜盘线', kof.need === false, kof.need);
  ok('KOF 说明「把对方全员击败」', kof.tip === true, kof.tip);
  await pick('[data-bind="team.mode"]', 'nvn');
  await sleep(500);

  await view('players');
  const tp = await ev(`(function(){
    return {head:[].slice.call(document.querySelectorAll('#view-players thead th')).map(function(x){return x.innerText.trim()}),
      members:document.querySelectorAll('[data-tmember]').length,
      addBtns:document.querySelectorAll('[data-act="addMember"]').length,
      first:(document.querySelector('[data-tmember]')||{}).value};
  })()`);
  ok('表头由「姓名」变「队伍」', tp.head.indexOf('队伍') >= 0 && tp.head.indexOf('队员') >= 0, tp.head);
  ok('4 队 × 3 人 = 12 个队员输入框', tp.members === 12, tp.members);
  ok('每队都有「+ 队员」按钮', tp.addBtns === 4, tp.addBtns);
  ok('队员名字已带入', tp.first === '红-1', tp.first);

  await click('[data-act="addMember"]');
  await sleep(300);
  await modalOk('红-4');
  await sleep(600);
  const added = await ev(`(function(){
    var p=TMS.current.players[0];
    return {n:p.members.length, last:p.members[p.members.length-1].name, boxes:document.querySelectorAll('[data-tmember]').length};
  })()`);
  ok('「+ 队员」弹出输入框并加进队伍', added.n === 4 && added.last === '红-4', added);
  ok('队员输入框多一个', added.boxes === 13, added.boxes);
  // 改队员名字
  await ev(`(function(){
    var el=document.querySelector('[data-tmember]');
    el.value='红队-1'; el.dispatchEvent(new Event('change',{bubbles:true})); return 1})()`);
  await sleep(500);
  const mbName = await ev(`TMS.current.players[0].members[0].name`);
  ok('队员改名写回存档', mbName === '红队-1', mbName);
  await shot('v26_team_players.png');

  await view('matches');
  await sleep(450);

  // 点第 ci 张卡上第 si 场的「某队胜」按钮
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

  const tentry = await ev(`(function(){
    var c=document.querySelector('.match.mrow');
    var tab=c.querySelector('.teamtab');
    if(!tab) return {tab:false};
    var rows=[].slice.call(tab.querySelectorAll('.tt-row'));
    return {tab:true,
      n:rows.length,
      firstNo:(rows[0].querySelector('.tt-n')||{}).innerText||'',
      selA:!!c.querySelector('select[id^="tsa_"]'),
      selB:!!c.querySelector('select[id^="tsb_"]'),
      btnDis:!!(c.querySelector('[data-act="addBoard"][data-w="A"]')||{}).disabled,
      tools:!!c.querySelector('[data-act="autoLineup"]'),
      score:((c.querySelector('.bscore')||{}).innerText||'').replace(/\\s+/g,''),
      hint:/先把|排好/.test(tab.innerText)};
  })()`);
  ok('团体赛卡片下方常显「团体对阵」表（不用点开明细）', tentry.tab === true && tentry.n === 3, tentry);
  ok('每行是一场对局（第 1 场）', /第 1 场/.test(tentry.firstNo || ''), tentry.firstNo);
  ok('每场都有双方上场队员下拉', tentry.selA && tentry.selB, tentry);
  ok('还没排阵时，「某队胜」按钮是禁用的（先定人再录）', tentry.btnDis === true, tentry);
  ok('有「按名单排阵」的快捷按钮', tentry.tools === true);
  ok('大比分单位是「场」', /场/.test(tentry.score), tentry.score);
  await shot('v26_team_entry.png');

  // nvn：硬点也不会录进去（按钮 disabled）
  ok('未排阵点不了成绩', (await boardBtn(0, 0, 'A')) === 'disabled');

  await ev(`(function(){document.querySelector('[data-act="autoLineup"]').click();return 1})()`);
  await sleep(550);
  const lined = await ev(`(function(){
    var m=TMS.current.stages[0].roundsData[0].matches[0];
    var c=document.querySelector('.match.mrow');
    var sels=[].slice.call(c.querySelectorAll('.teamtab .tt-row select'));
    return {slots:(m.slots||[]).length,
      a0:(m.slots[0]||{}).pa, b0:(m.slots[0]||{}).pb,
      a1:(m.slots[1]||{}).pa,
      selVals:sels.map(function(x){return x.value}),
      btnDis:!!(c.querySelector('[data-act="addBoard"][data-w="A"]')||{}).disabled};
  })()`);
  ok('「按名单排阵」把三场都排上了', lined.slots === 3 && lined.a0 && lined.b0, lined);
  ok('排阵按名单顺序（第 1 场红-1 vs 白-1、第 2 场红-2）',
    lined.a0 === 'mb_0_0' && lined.b0 === 'mb_3_0' && lined.a1 === 'mb_0_1', lined);
  ok('排好阵后成绩按钮可用', lined.btnDis === false, lined);

  ok('录第 1 场（红队胜）', (await boardBtn(0, 0, 'A')) === 'ok');
  await sleep(450);
  ok('录第 2 场（红队胜）', (await boardBtn(0, 1, 'A')) === 'ok');
  await sleep(500);
  const tb1 = await ev(`(function(){
    var m=TMS.current.stages[0].roundsData[0].matches[0];
    var c=document.querySelector('.match.mrow');
    return {n:(m.games||[]).length, decided:!!m.decided,
      ga:(m.result||{}).gamesA, gb:(m.result||{}).gamesB,
      done:c.querySelectorAll('.teamtab .tt-row.done').length,
      score:((c.querySelector('.bscore')||{}).innerText||'').replace(/\\s+/g,'')};
  })()`);
  ok('赢了 2 场但还没打完（nvn 要比完 3 场）', tb1.decided === false && tb1.ga === 2 && tb1.gb === 0, tb1);
  ok('已打完的行标成「结果行」', tb1.done === 2, tb1.done);

  ok('录第 3 场（红队胜）', (await boardBtn(0, 2, 'A')) === 'ok');
  await sleep(550);
  const tb2 = await ev(`(function(){
    var m=TMS.current.stages[0].roundsData[0].matches[0];
    var c=document.querySelector('.match.mrow');
    return {n:(m.games||[]).length, decided:!!m.decided,
      ga:(m.result||{}).gamesA, gb:(m.result||{}).gamesB,
      done:c.querySelectorAll('.teamtab .tt-row.done').length,
      score:((c.querySelector('.bscore')||{}).innerText||'').replace(/\\s+/g,''),
      stat:(c.querySelector('.mstat')||{}).innerText||'',
      pa:(m.games||[]).map(function(g){return g.pa}).join(','),
      pb:(m.games||[]).map(function(g){return g.pb}).join(',')};
  })()`);
  ok('打完 3 场 → 大比分 3:0 定胜负', tb2.decided === true && tb2.ga === 3 && tb2.gb === 0, tb2);
  ok('三场结果都留在对阵表里', tb2.done === 3, tb2.done);
  ok('主行比分显示 3 : 0（场）', /^3:0/.test(tb2.score), tb2.score);
  ok('状态写「胜者：红队」', /胜者：红队/.test(tb2.stat), tb2.stat);
  ok('每场都记了双方上场队员（三人各上一场）',
    tb2.pa === 'mb_0_0,mb_0_1,mb_0_2' && tb2.pb === 'mb_3_0,mb_3_1,mb_3_2', [tb2.pa, tb2.pb]);
  await shot('v26_team_nvn.png');

  /* ================= 7. 团体赛排名 ================= */
  console.log('\n=== 7. 团体赛排名按队伍 ===');
  await view('standing');
  await sleep(500);
  const tst = await ev(`(function(){
    var t=document.querySelector('#view-standing table');
    if(!t) return null;
    var rows=[].slice.call(t.querySelectorAll('tbody tr')).map(function(tr){
      return [].slice.call(tr.querySelectorAll('td')).map(function(td){return td.innerText.trim()});
    });
    return {n:rows.length, names:rows.map(function(r){return r[1]}), first:rows[0]};
  })()`);
  ok('排名表里是 4 支队伍', tst && tst.n === 4, tst && tst.n);
  ok('队名出现在排名里', tst && tst.names.indexOf('红队') >= 0 && tst.names.indexOf('蓝队') >= 0, tst && tst.names);
  ok('赢下比赛的队伍在第一位', tst && tst.first && tst.first[1] === '红队', tst && tst.first);
  await shot('v26_team_standing.png');

  /* ================= 8. 手机档 ================= */
  console.log('\n=== 8. 手机档 390×844 ===');
  await openT('回合制 · 8 人两阶段');
  await view('matches');
  await conn.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(800);
  const mob = await ev(`(function(){
    var c=document.querySelector('.match.mrow');
    var main=c.querySelector('.mrow-main');
    var cs=getComputedStyle(main);
    var btn=c.querySelector('[data-act="toggleMore"]');
    return {ov:document.documentElement.scrollWidth-document.documentElement.clientWidth,
      cardW:Math.round(c.getBoundingClientRect().width),
      winW:window.innerWidth,
      areas:cs.gridTemplateAreas,
      flow:cs.display,
      brk:(function(){var b=c.querySelector('.mbrk');return b?getComputedStyle(b).display:'none'})(),
      h:Math.round(main.getBoundingClientRect().height),
      btnW:Math.round(btn.getBoundingClientRect().width),
      btnRight:Math.round(btn.getBoundingClientRect().right),
      seatShown:!!c.querySelector('.mseat').offsetParent};
  })()`);
  ok('手机档无横向溢出', mob.ov <= 0, mob.ov);
  ok('卡片不超出屏幕', mob.cardW > 0 && mob.cardW <= mob.winW, mob);
  ok('主行在手机档切成多行（flex 换行 + 强制断行生效）',
    mob.flow === 'flex' && mob.brk === 'block' && mob.h > 70, mob);
  ok('「明细」按钮在屏幕内', mob.btnW > 0 && mob.btnRight <= mob.winW, mob);
  await shot('v26_mobile_rows.png');
  await conn.send('Emulation.clearDeviceMetricsOverride');
  await sleep(400);

  /* ================= 9. 无报错 ================= */
  console.log('\n=== 9. 无 JS 报错 ===');
  const errs = await ev('window.__errs || []');
  console.log('    errors:', JSON.stringify(errs));
  ok('全程无 JS 报错', errs.length === 0, errs);

  console.log('\n----------------------------------------');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  console.log('----------------------------------------');
  conn.close();
  env.child.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
