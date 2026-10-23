/**
 * v1.11.2 界面验证：瑞士轮 / 循环赛 / 小组赛「平局 = 双方都输」
 *  1. 瑞士轮、循环赛、小组赛的设置页都出现「本阶段平局判定」
 *  2. 单败淘汰不出现该选项；双败淘汰赛制本身仍在赛制下拉里（没被删）
 *  3. 瑞士轮里打成平局：卡片写「双方各记一负」，积分榜上两人是 1 负 0 平
 *  4. 关闭开关时同一场平局回到「记平」
 *  5. 无 JS 报错
 */
const path = require('path'), fs = require('fs');
const { launch, connect } = require('./headless');
const PORT = 9463;
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
async function reload() {
  await ev('location.reload()'); await sleep(1700);
  await ev(`window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message))});
    (function(){var oe=console.error;console.error=function(){window.__errs.push([].slice.call(arguments).join(' '));oe.apply(console,arguments)}})();'ok'`);
}

/* 建赛事：type / drawBothLose 由外部给 */
function mkEv(type, bothLose) {
  return `(function(){
  var M=TMS.model,S=TMS.store,E=TMS.engine;
  S.loadIndex().slice().forEach(function(x){S.remove(x.id)});
  var t=M.createTournament('平局双负·非淘汰');
  for(var i=1;i<=4;i++)t.players.push(M.createPlayer('选手'+i,i));
  var s=M.defaultStage(0);
  s.type='${type}'; s.tie='draw_ok'; s.drawBothLose=${bothLose};
  s.format={gamesPerMatch:2,winNeeded:0,recordScore:true}; s.useFormat=true;
  s.rounds=1;
  s.adv={type:'count',count:2,score:0,perGroup:1};
  t.stages=[s]; t.currentStage=0; t.status='running';
  E.ensureParticipants(t,s);
  S.put(t); S.setCurrentId(t.id); TMS.current=t; S.save(t);
  return 'ok';
})()`;
}
const hasBox = `(function(){
  var els=[].slice.call(document.querySelectorAll('input[type=checkbox]'));
  for(var i=0;i<els.length;i++){ if((els[i].getAttribute('data-bind')||'').indexOf('drawBothLose')>=0) return true; }
  return false;
})()`;
const boxText = `(function(){
  var els=[].slice.call(document.querySelectorAll('input[type=checkbox]'));
  for(var i=0;i<els.length;i++){
    if((els[i].getAttribute('data-bind')||'').indexOf('drawBothLose')>=0){
      var row=els[i].closest('.fld')||els[i].parentNode.parentNode;
      return (row.innerText||'').replace(/\\s+/g,' ').trim();
    }
  }
  return '';
})()`;
const typeOptions = `(function(){
  var sel=document.querySelector('select[data-bind="stages[0].type"]');
  if(!sel) return '';
  return [].slice.call(sel.options).map(function(o){return o.value}).join(',');
})()`;

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);
  const env = await launch(PORT, path.join(__dirname, '..', 'app'));
  conn = await connect(PORT);
  await conn.send('Runtime.enable'); await conn.send('Page.enable');
  await conn.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 950, deviceScaleFactor: 1, mobile: false });
  await reload();

  console.log('\n=== 1. 赛制下拉：双败淘汰仍在（没被删） ===');
  await ev(mkEv('swiss', true));
  await reload();
  await view('setup');
  const opts = await ev(typeOptions);
  ok('赛制下拉里仍有 double_elim', /double_elim/.test(opts), opts);
  ok('赛制下拉里仍有 single_elim', /single_elim/.test(opts), opts);

  console.log('\n=== 2. 瑞士轮 / 循环赛 / 小组赛都出现该选项 ===');
  let bSwiss = await ev(hasBox);
  ok('瑞士轮：出现「双方都输」勾选框', bSwiss === true);
  let txt = await ev(boxText);
  ok('瑞士轮：文案按负场分写（不是双败的去向文案）',
    /负场分/.test(txt) && !/掉进败者组/.test(txt), txt.slice(0, 120));

  const toType = async (tp) => {
    await ev(`(function(){
      var sel=document.querySelector('select[data-bind="stages[0].type"]');
      if(!sel) return 'none';
      sel.value='${tp}';
      sel.dispatchEvent(new Event('change',{bubbles:true}));
      return 'ok';
    })()`);
    await sleep(600);
  };
  await toType('round_robin');
  ok('循环赛：出现该选项', (await ev(hasBox)) === true);
  await toType('groups');
  ok('小组赛：出现该选项', (await ev(hasBox)) === true);
  await toType('single_elim');
  ok('单败淘汰：不出现该选项', (await ev(hasBox)) === false);
  await toType('double_elim');
  ok('双败淘汰：仍出现该选项', (await ev(hasBox)) === true);
  const deTxt = await ev(boxText);
  ok('双败淘汰：仍是原来的「掉组 / 淘汰」文案', /掉进败者组/.test(deTxt), deTxt.slice(0, 120));

  console.log('\n=== 3. 瑞士轮打一场平局 ===');
  await ev(mkEv('swiss', true));
  await reload();
  await view('setup');
  ok('刷新后仍是瑞士轮且开关已开', await ev(`(function(){
    var s=TMS.current.stages[0]; return s.type==='swiss' && s.drawBothLose===true;
  })()`) === true);

  await view('matches');
  await ev(`(function(){ TMS.engine.generateRound(TMS.current); TMS.store.save(TMS.current); return 'ok'; })()`);
  await view('matches');
  await sleep(400);
  const cnt = await ev(`document.querySelectorAll('.match').length`);
  ok('生成首轮 2 张卡', cnt === 2, cnt);

  let scored = 0;
  for (let i = 0; i < 2; i++) {
    const step = await ev(`(function(){
      var cards=[].slice.call(document.querySelectorAll('.match'));
      var card=cards[${i}];
      if(!card) return 'no-card';
      var qa=card.querySelector('input.inline-num[id^="qa_"]');
      var qb=card.querySelector('input.inline-num[id^="qb_"]');
      var btn=card.querySelector('[data-act="applyScore"]');
      if(!qa||!qb||!btn) return 'no-ctl';
      if(${i}===0){ qa.value='1'; qb.value='1'; } else { qa.value='2'; qb.value='0'; }
      qa.dispatchEvent(new Event('input',{bubbles:true}));
      qb.dispatchEvent(new Event('input',{bubbles:true}));
      btn.click();
      return 'ok';
    })()`);
    if (step === 'ok') scored++;
    await sleep(280);
  }
  ok('两桌都走了页面结算按钮', scored === 2, scored);
  await sleep(600);

  const card0 = await ev(`(function(){
    var c=document.querySelectorAll('.match')[0];
    return (c&&c.innerText||'').replace(/\\s+/g,' ');
  })()`);
  ok('平局那桌写明「双方各记一负」', /双方各记一负/.test(card0), card0.slice(0, 200));
  ok('并标注战绩不记平局', /战绩不记平局|负场分/.test(card0), card0.slice(0, 200));
  await shot('v23_swiss_draw_both_lose.png');

  console.log('\n=== 4. 积分榜：两人是 1 负 0 平 ===');
  await ev(`(function(){ TMS.engine.finishRound(TMS.current); TMS.store.save(TMS.current); return 'ok'; })()`);
  await view('standing');
  await sleep(500);
  const rows = await ev(`(function(){
    var E=TMS.engine,t=TMS.current;
    return E.standings(t,{stageIndex:0}).map(function(r){
      return { n:E.nameOf(t,r.id), m:r.matches, w:r.wins, d:r.draws, l:r.losses, p:r.points };
    });
  })()`);
  const drewPair = await ev(`(function(){
    var E=TMS.engine,t=TMS.current;
    var m=t.stages[0].roundsData[0].matches[0];
    return [E.nameOf(t,m.playerA), E.nameOf(t,m.playerB)];
  })()`);
  const drewRows1 = rows.filter(function (r) { return drewPair.indexOf(r.n) >= 0; });
  ok('打平的那两人各 1 负 0 平',
    drewRows1.length === 2 && drewRows1.every(function (r) { return r.l === 1 && r.d === 0; }), rows);
  ok('总积分只有 3 与 0（平局没给分）',
    rows.map(function (r) { return r.p; }).sort().join(',') === '0,0,0,3', rows.map(function (r) { return r.p; }));
  ok('没有人被记成平局', rows.every(function (r) { return r.d === 0; }), rows);
  const tbl = await ev(`(function(){
    var el=document.querySelector('.table-wrap')||document.body;
    return (el.innerText||'').replace(/\\s+/g,' ');
  })()`);
  ok('积分榜页面正常渲染出成绩行', /选手1/.test(tbl), tbl.slice(0, 160));

  console.log('\n=== 5. 关掉开关：同一场平局回到记平 ===');
  await ev(`(function(){
    var t=TMS.current,s=t.stages[0];
    s.drawBothLose=false; TMS.store.save(t); return 'ok';
  })()`);
  await reload();
  await view('standing');
  await sleep(400);
  const rows2 = await ev(`(function(){
    var E=TMS.engine,t=TMS.current;
    return E.standings(t,{stageIndex:0}).map(function(r){ return { d:r.draws, l:r.losses, p:r.points }; });
  })()`);
  const drewRows = rows2.filter(function (r) { return r.d === 1; });
  ok('关闭后：打平的两人各记 1 平 0 负',
    drewRows.length === 2 && drewRows.every(function (r) { return r.l === 0; }), rows2);
  ok('关闭后：平局分回到 1', rows2.filter(function (r) { return r.p === 1; }).length === 2, rows2);

  console.log('\n=== 6. 无 JS 报错 ===');
  const errs = await ev(`(window.__errs||[]).join(' | ')`);
  ok('全程无 JS 报错', !errs || errs.trim() === '', errs.slice(0, 200));

  console.log('\n----------------------------------------');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  conn.close();
  env.child.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SMOKE ERROR:', e); process.exit(1); });
