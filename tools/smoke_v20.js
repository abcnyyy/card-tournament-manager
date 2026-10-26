/**
 * v1.10.0 界面验证
 *  1. 设置页：比赛计时器卡片（限时 / 到点自动结算 / 平分处理）
 *  2. 记分规则：大比分设置里的「未打完」档位表格
 *  3. 对阵卡片：倒计时 + 开始计时 / 暂停 / 归零 / 按未打完结算
 *  4. 计时器到点 → 心跳自动结算（卡片标「未打完」）
 *  5. 排名：未打完的场次计入战绩；不再提示「小分继承」
 *  6. 移动端 390×844：计时器一行不溢出
 *  7. 无 JS 报错
 */
const path = require('path'), fs = require('fs');
const { launch, connect } = require('./headless');
const PORT = 9459;
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
  await sleep(420);
}
async function reload() {
  await ev('location.reload()'); await sleep(1700);
  await ev(`window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message))});
    (function(){var oe=console.error;console.error=function(){window.__errs.push([].slice.call(arguments).join(' '));oe.apply(console,arguments)}})();'ok'`);
}
const CHECK_BY_LABEL = `function tick(labelRe){
  var rows=[].slice.call(document.querySelectorAll('.fld'));
  for(var i=0;i<rows.length;i++){
    var lab=rows[i].querySelector('label');
    if(!lab || !labelRe.test(lab.textContent)) continue;
    var cb=rows[i].querySelector('input[type=checkbox]');
    if(!cb) continue;
    if(!cb.checked){ cb.checked=true; cb.dispatchEvent(new Event('change',{bubbles:true})); }
    return 1;
  }
  return 0;
}`;

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);
  const env = await launch(PORT, path.join(__dirname, '..', 'app'));
  conn = await connect(PORT);
  await conn.send('Runtime.enable'); await conn.send('Page.enable');
  await reload();

  /* ---------- 0. 建赛事（8 人瑞士轮，启用计时器 + 大比分逐档设分） ---------- */
  console.log('\n=== 0. 建赛事 ===');
  await ev(`(function(){
    var M=TMS.model,S=TMS.store;
    S.loadIndex().slice().forEach(function(x){S.remove(x.id)});
    var t=M.createTournament('v20 计时器');
    for(var i=1;i<=8;i++)t.players.push(M.createPlayer('选手'+i,i));
    var a=M.defaultStage(0);
    a.type='swiss';a.rounds=3;a.adv={type:'all'};
    t.stages=[a];t.currentStage=0;t.status='running';
    t.timer={enabled:true,minutes:20,autoSettle:true,tieAction:'draw'};
    t.scoring.mode='scoreline';
    t.scoring.scoreTable={'2-0':{w:3,l:0},'2-1':{w:2,l:1}};
    TMS.engine.ensureParticipants(t);
    S.put(t);TMS.current=t;return 1})()`);
  await reload();

  /* ---------- 1. 设置页：计时器卡片 ---------- */
  console.log('\n=== 1. 设置页 · 比赛计时器 ===');
  await view('setup');
  let txt = await ev('document.body.innerText');
  ok('有「比赛计时器」卡片', /比赛计时器/.test(txt), true);
  ok('有「启用每场限时」勾选', /启用每场限时/.test(txt), true);
  ok('启用后显示每场限时（分钟）', /每场限时（分钟）/.test(txt), true);
  ok('显示「到点自动结算」', /到点自动结算/.test(txt), true);
  ok('显示平分处理下拉', /到点时双方局数相同/.test(txt), true);
  const tieOpts = await ev(`(function(){
    var sels=[].slice.call(document.querySelectorAll('select'));
    for(var i=0;i<sels.length;i++){
      var t=[].slice.call(sels[i].options).map(function(o){return o.textContent});
      if(t.some(function(x){return /平局/.test(x)}) && t.some(function(x){return /种子号/.test(x)}))
        return t;
    }
    return [];
  })()`);
  console.log('    平分选项：', JSON.stringify(tieOpts));
  ok('平分处理含 平局 / 种子 / 继续打 三项', tieOpts.length === 3, tieOpts);
  ok('提示说明走「未打完」档位计分', /未打完/.test(txt), true);
  await shot('v20_setup_timer.png');

  /* ---------- 2. 记分规则里的「未打完」档位 ---------- */
  console.log('\n=== 2. 大比分设置 · 未打完档位 ===');
  const unTable = await ev(`(function(){
    var hs=[].slice.call(document.querySelectorAll('h4'));
    var h=null;
    for(var i=0;i<hs.length;i++) if(/未打完/.test(hs[i].textContent)) h=hs[i];
    if(!h) return {found:false};
    var tbl=h.nextElementSibling;
    while(tbl && tbl.tagName!=='TABLE') tbl=tbl.nextElementSibling;
    if(!tbl) return {found:true, table:false};
    var keys=[].slice.call(tbl.querySelectorAll('input')).map(function(i){return i.getAttribute('data-bind')});
    return {found:true, table:true, rows:tbl.querySelectorAll('tbody tr').length, keys:keys};
  })()`);
  console.log('    未打完表格：', JSON.stringify(unTable));
  ok('记分规则里有「未打完」小节', unTable.found === true, unTable);
  ok('未打完档位有表格', unTable.table === true, unTable);
  ok('BO3 列出 3 个未打完档位（1-1 / 1-0 / 0-0）', unTable.rows === 3, unTable.rows);
  ok('输入框绑定 u: 前缀的键', (unTable.keys || []).some(function(k) { return /u:1-0/.test(k); }), unTable.keys);
  await shot('v20_setup_unfinished.png');

  /* ---------- 3. 对阵卡片：计时器一行 ---------- */
  console.log('\n=== 3. 对阵卡片 · 计时器 ===');
  await ev(`(function(){
    var t=TMS.current;
    TMS.engine.generateRound(t);
    TMS.store.put(t);return 1})()`);
  await reload();
  await view('matches');
  const tmUI = await ev(`(function(){
    var row=document.querySelector('.tmrow');
    if(!row) return {row:false};
    return {
      row:true,
      clock:(row.querySelector('.tmclock')||{}).textContent||'',
      acts:[].slice.call(row.querySelectorAll('[data-act]')).map(function(b){return b.getAttribute('data-act')}),
      tip:row.innerText.replace(/\\s+/g,' ')
    };
  })()`);
  console.log('    计时器行：', JSON.stringify(tmUI));
  ok('每张对阵卡有计时器一行', tmUI.row === true, tmUI);
  ok('默认显示限时 20:00', tmUI.clock === '20:00', tmUI.clock);
  ok('有「开始计时」按钮', (tmUI.acts || []).indexOf('tmStart') >= 0, tmUI.acts);
  ok('有「+5 分钟 / 归零 / 按未打完结算」', (tmUI.acts || []).indexOf('tmAdd') >= 0 &&
    (tmUI.acts || []).indexOf('tmReset') >= 0 && (tmUI.acts || []).indexOf('tmSettle') >= 0, tmUI.acts);
  ok('顶部工具条有「全轮开始计时」', /全轮开始计时/.test(await ev('document.body.innerText')), true);

  /* 点「全轮开始计时」→ 4 场都在走表 */
  await ev(`(function(){var b=document.querySelector('[data-act="tmStartAll"]');if(b)b.click();return 1})()`);
  await sleep(600);
  const allRun = await ev(`(function(){
    var t=TMS.current, st=t.stages[0], rd=st.roundsData[0];
    var run=rd.matches.filter(function(m){return m.tm && m.tm.startedAt}).length;
    var cls=[].slice.call(document.querySelectorAll('.tmclock')).map(function(e){return e.className});
    return {run:run, total:rd.matches.length, running:cls.filter(function(c){return /run/.test(c)}).length};
  })()`);
  console.log('    全轮计时：', JSON.stringify(allRun));
  ok('「全轮开始计时」让 4 场都开表', allRun.run === 4 && allRun.total === 4, allRun);
  ok('倒计时显示为运行态', allRun.running === 4, allRun.running);
  await shot('v20_matches_timer.png');

  /* 暂停单场 */
  await ev(`(function(){var b=document.querySelector('[data-act="tmPause"]');if(b)b.click();return 1})()`);
  await sleep(400);
  const paused = await ev(`(function(){
    var t=TMS.current, rd=t.stages[0].roundsData[0];
    return rd.matches.filter(function(m){return m.tm && m.tm.startedAt}).length;
  })()`);
  ok('「暂停」让该场停表（剩 3 场在走）', paused === 3, paused);

  /* ---------- 4. 手动「按未打完结算」 ---------- */
  console.log('\n=== 4. 手动按未打完结算 ===');
  await ev(`(function(){
    var t=TMS.current, st=t.stages[0], rd=st.roundsData[0], m=rd.matches[0];
    m.games=[{w:'A',a:1,b:0}];
    TMS.engine.evaluate(m, TMS.engine.fmtOfMatch(t,st,m), st.tie);
    TMS.store.put(t);return 1})()`);
  await reload();
  await view('matches');
  await ev(`(function(){var b=document.querySelector('[data-act="tmSettle"]');if(b)b.click();return 1})()`);
  await sleep(700);
  const settled = await ev(`(function(){
    var t=TMS.current, m=t.stages[0].roundsData[0].matches[0];
    return {decided:!!m.decided, unfinished:!!(m.result&&m.result.unfinished),
      winner:m.result&&m.result.winner, reason:m.result&&m.result.endReason,
      txt:document.body.innerText};
  })()`);
  console.log('    结算结果：', JSON.stringify({ decided: settled.decided, unfinished: settled.unfinished, winner: settled.winner, reason: settled.reason }));
  ok('手动结算成功', settled.decided === true && settled.unfinished === true, settled);
  ok('按当前比分歧胜（A 1:0）', settled.winner === 'A', settled.winner);
  ok('标记 endReason = manual', settled.reason === 'manual', settled.reason);
  ok('卡片状态写「未打完」', /未打完/.test(settled.txt), (settled.txt.match(/第 1 桌[^\n]*/) || [''])[0]);
  // v1.14.0 起录入区默认收起，「撤销未打完」按钮在 DOM 里但不可见，改用 DOM 查询断言
  const undoBtnTxt = await ev(`(function(){var b=document.querySelector('[data-act="tmUndoFinish"]');
    return b?b.textContent.trim():null})()`);
  ok('出现「撤销未打完」按钮', /撤销未打完/.test(undoBtnTxt || ''), undoBtnTxt);
  await shot('v20_match_unfinished.png');

  /* 撤销 */
  await ev(`(function(){var b=document.querySelector('[data-act="tmUndoFinish"]');if(b)b.click();return 1})()`);
  await sleep(600);
  const undone = await ev(`(function(){
    var m=TMS.current.stages[0].roundsData[0].matches[0];
    return {decided:!!m.decided, unfinished:!!(m.result&&m.result.unfinished), games:(m.games||[]).length};
  })()`);
  ok('撤销后回到进行中，比分保留', undone.decided === false && undone.games === 1, undone);

  /* ---------- 5. 计时器到点自动结算（心跳） ---------- */
  console.log('\n=== 5. 到点自动结算 ===');
  await ev(`(function(){
    var t=TMS.current, st=t.stages[0], rd=st.roundsData[0];
    t.timer.autoSettle=true;
    var m=rd.matches[1];
    m.games=[{w:'B',a:0,b:1}];
    TMS.engine.evaluate(m, TMS.engine.fmtOfMatch(t,st,m), st.tie);
    TMS.engine.tmRestart(m, 60, Date.now());  // 重设限时 60 秒并开表
    m.tm.startedAt = Date.now() - 65000;      // 假装已经打了 65 秒（限时 60 秒）
    TMS.store.put(t);return 1})()`);
  await sleep(1800);                            // 等心跳（1 秒一次）跑一轮
  const auto = await ev(`(function(){
    var m=TMS.current.stages[0].roundsData[0].matches[1];
    return {decided:!!m.decided, unfinished:!!(m.result&&m.result.unfinished),
      winner:m.result&&m.result.winner, reason:m.result&&m.result.endReason,
      errs:window.__errs||[]};
  })()`);
  console.log('    自动结算：', JSON.stringify({ decided: auto.decided, unfinished: auto.unfinished, winner: auto.winner, reason: auto.reason }));
  ok('到点后心跳自动结算这场比赛', auto.decided === true, auto);
  ok('自动结算标记为 timeout + unfinished', auto.reason === 'timeout' && auto.unfinished === true, auto);
  ok('落后方反超时按当前比分判 B 胜', auto.winner === 'B', auto.winner);

  /* ---------- 6. 排名：未打完计入战绩 + 不再提示小分继承 ---------- */
  console.log('\n=== 6. 排名页 ===');
  await view('standing');
  const rankTxt = await ev('document.body.innerText');
  ok('排名表出现', /名次/.test(rankTxt), true);
  const rankRow = await ev(`(function(){
    var m=TMS.current.stages[0].roundsData[0].matches[1];
    var t=TMS.current;
    var st=TMS.engine.standings(t,{stageIndex:0});
    var a=st.filter(function(x){return x.id===m.playerA})[0];
    var b=st.filter(function(x){return x.id===m.playerB})[0];
    return {al:a&&a.losses, am:a&&a.matches, bw:b&&b.wins, bm:b&&b.matches, w:m.result&&m.result.winner};
  })()`);
  console.log('    未打完场次的战绩：', JSON.stringify(rankRow));
  ok('未打完的胜方（B）记 1 胜 1 场', rankRow.w === 'B' && rankRow.bw === 1 && rankRow.bm === 1, rankRow);
  ok('未打完的负方（A）记 1 负 1 场', rankRow.al === 1 && rankRow.am === 1, rankRow);

  // 第二阶段开启「继承小分」，排名页不该再提示
  await ev(`(function(){
    var M=TMS.model,S=TMS.store;
    var t=TMS.current;
    var b=M.defaultStage(1);
    b.type='swiss';b.rounds=2;b.adv={type:'all'};
    b.inherit={enabled:true,ratio:100,fromStage:0,tie:true};
    b.participants=t.stages[0].participants.slice();
    t.stages.push(b);t.currentStage=1;
    S.put(t);TMS.current=t;return 1})()`);
  await reload();
  await view('standing');
  // 排名页有自己的阶段选择器，切到第 2 阶段才看得到「继承」说明
  await ev(`(function(){
    var s=document.querySelector('select[data-act2="stStage"]');
    if(!s) return 0;
    s.value='1';
    s.dispatchEvent(new Event('change',{bubbles:true}));
    return 1;
  })()`);
  await sleep(600);
  const inhTxt = await ev('document.body.innerText');
  ok('排名页不再提「小分继承」', !/已包含从上一阶段继承/.test(inhTxt) && !/同时继承/.test(inhTxt),
    (inhTxt.match(/继承[^\n]{0,40}/g) || []).slice(0, 3));
  ok('仍显示「继承积分 100%」', /继承上一阶段/.test(inhTxt) && /100%/.test(inhTxt), true);
  await shot('v20_standing_inherit.png');

  /* ---------- 7. 移动端 ---------- */
  console.log('\n=== 7. 移动端 390×844 ===');
  await ev(`(function(){TMS.current.currentStage=0;TMS.store.put(TMS.current);return 1})()`);
  await reload();
  await view('matches');
  await conn.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(700);
  // v1.14.0：计时器在长行卡片的明细区里，默认收起 —— 先点开第一张卡再量尺寸
  await ev(`(function(){var b=document.querySelector('[data-act="toggleMore"]');if(b)b.click();return 1})()`);
  await sleep(500);
  const mob = await ev(`(function(){
    var row=document.querySelector('.mrow.open .tmrow') || document.querySelector('.tmrow');
    return {
      opened: !!document.querySelector('.mrow.open'),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rowW: row?Math.round(row.getBoundingClientRect().width):0,
      clockW: row?Math.round(row.querySelector('.tmclock').getBoundingClientRect().width):0,
      winW: window.innerWidth
    };
  })()`);
  console.log('    移动端计时器：', JSON.stringify(mob));
  ok('移动端没有横向溢出', mob.overflowX <= 0, mob.overflowX);
  ok('计时器一行不超出屏幕', mob.rowW > 0 && mob.rowW <= mob.winW, mob);
  await shot('v20_mobile_timer.png');
  await conn.send('Emulation.clearDeviceMetricsOverride');
  await sleep(400);

  /* ---------- 8. 无报错 ---------- */
  console.log('\n=== 8. 无 JS 报错 ===');
  const errs = await ev('window.__errs || []');
  console.log('    errors:', JSON.stringify(errs));
  ok('无 JS 报错', errs.length === 0, errs);

  console.log('\n================');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  console.log('================');
  try { conn.close(); } catch (e) {}
  try { env.child.kill(); } catch (e) {}
  process.exit(fail ? 1 : 0);
})();
