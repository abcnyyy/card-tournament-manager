/**
 * v2.6.1 界面验证：回合（sets）设定到底有没有生效
 *  1. 设置页把「每场比赛回合数」改成 2 / 「需赢几个回合」=2 → 存档写入 + 卡片出现「回合 1」标签
 *  2. 打 1:1 → 卡片显示「加赛回合 3」，并且还能继续录入（按钮不灰）
 *  3. 加赛打完 → 出结果（2:1），不再卡住
 *  4. 阶段独立局制：勾上独立局制并把回合数改成 3 → 该阶段的比赛按 3 回合算
 *  5. 团体赛：设置页的「回合数」输入被禁用，并写明只对个人赛生效
 *  6. 无 JS 报错
 * 用法：node tools/smoke_v35.js   （需要能起无头浏览器的环境）
 */
const path = require('path'), fs = require('fs');
const { launch, connect } = require('./headless');
const PORT = 9455;
const OUT = path.join(__dirname, 'smoke_out');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let conn = null;
async function ev(expr) {
  const r = await conn.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false });
  if (r.exceptionDetails) throw new Error('页内异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r.result && r.result.value;
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

/* 造一个 2 人赛 + 回合设成 2（每回合 1 局、先赢 2 回合） */
const BUILD = `(function(){
  var M=TMS.model,S=TMS.store,E=TMS.engine;
  var t=M.createTournament('回合验证');
  for(var i=1;i<=2;i++) t.players.push(M.createPlayer('选手'+i,i));
  t.format=Object.assign(M.defaultFormat(),{gamesPerMatch:1,winNeeded:0,sets:2,setRule:'sets',setsToWin:2});
  t.stages[0].type='swiss';
  S.put(t);
  E.ensureParticipants(t);
  E.generateRound(t);
  S.put(t);                     // 生成对阵之后再存一次，别让刷新把对阵丢了
  return {id:t.id, matches:t.stages[0].roundsData[0].matches.length};
})()`;

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const env = await launch(PORT, path.join(__dirname, '..', 'app'));
  conn = await connect(PORT);
  await ev(`window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message))});
    (function(){var oe=console.error;console.error=function(){window.__errs.push([].slice.call(arguments).join(' '));oe.apply(console,arguments)}})();'ok'`);

  console.log('\n=== 1. 设置页写入回合数 ===');
  await ev(BUILD);
  await ev('location.reload()'); await sleep(1800);
  // reload 之后原来的监听器没了，要重新装（否则 __errs 是 undefined，最后一条会假红）
  await ev(`window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message))});'ok'`);
  await view('setup');
  const setupInfo = await ev(`(function(){
    var rows=[].slice.call(document.querySelectorAll('#view-setup .fld'));
    var r=rows.filter(function(x){return /每场比赛回合数/.test(x.textContent)})[0];
    var inp=r&&r.querySelector('input');
    // 用界面路径改：先改回合数、再改需赢几个回合
    var t=TMS.current;
    return {val:inp?inp.value:'', sets:t.format.sets, label:(rows.filter(function(x){return /每回合比赛局数/.test(x.textContent)})[0]||{}).textContent||''};
  })()`);
  ok('设置页显示回合数 = 2', String(setupInfo.sets) === '2' && String(setupInfo.val) === '2', setupInfo);
  ok('局制标签跟着变成「每回合比赛局数」', /每回合比赛局数/.test(setupInfo.label), setupInfo.label.slice(0, 30));

  console.log('\n=== 2. 录入页显示回合 ===');
  await view('matches');
  const cardInfo = await ev(`(function(){
    var c=document.querySelector('.match.mrow')||document.querySelector('.match');
    var txt=c?c.innerText:'';
    return {hasSet: /回合\\s*1/.test(txt), txt: txt.replace(/\\s+/g,' ').slice(0,140)};
  })()`);
  ok('卡片出现「回合 1」相关标签', cardInfo.hasSet === true, cardInfo.txt);

  console.log('\n=== 3. 打成 1:1 → 加赛回合（走界面按钮） ===');
  const clickWin = async (w) => {
    await ev(`(function(){var el=document.querySelector('[data-act="addGame"][data-w="${w}"]');if(el)el.click();return 1})()`);
    await sleep(500);
  };
  await clickWin('A');       // 第 1 回合 A 胜
  await clickWin('B');       // 第 2 回合 B 胜 → 1:1
  const after11 = await ev(`(function(){
    var E=TMS.engine,T=TMS.current,st=T.stages[0];
    var m=st.roundsData[0].matches[0], fmt=E.fmtOfMatch(T,st,m);
    var el=document.querySelector('[data-act="addGame"]');
    var c=document.querySelector('.match.mrow')||document.querySelector('.match');
    var txt=c?c.innerText.replace(/\\s+/g,' '):'';
    return {decided:m.decided, overtime:m.overtime, canAdd:E.canAddGame(m,fmt,st.tie),
      curSet:E.curSet(m,fmt,st.tie), btnDisabled: el?!!el.disabled:null,
      hasOvertime:/加赛回合/.test(txt), txt:txt.slice(0,180)};
  })()`);
  ok('1:1 判为「需要加赛」', after11.decided === false && after11.overtime === true, after11);
  ok('1:1 之后还能继续录（以前这里是 false，比赛卡死）', after11.canAdd === true, after11);
  ok('当前回合 = 第 3 个（加赛）', after11.curSet === 2, after11);
  ok('界面按钮不再置灰', after11.btnDisabled === false, after11);
  ok('卡片标注「加赛回合」', after11.hasOvertime === true, after11.txt);

  console.log('\n=== 4. 加赛打完出结果 ===');
  await clickWin('A');       // 加赛回合 A 胜 → 2:1
  const done = await ev(`(function(){
    var T=TMS.current,st=T.stages[0],m=st.roundsData[0].matches[0];
    return {decided:!!m.decided, winner:m.result&&m.result.winner,
      a:m.result&&m.result.gamesA, b:m.result&&m.result.gamesB,
      games:(m.games||[]).length};
  })()`);
  ok('加赛打赢后判定结束', done.decided === true && done.winner === 'A', done);
  ok('大比分 = 2:1（共录了 3 个回合）', done.a === 2 && done.b === 1 && done.games === 3, done);

  console.log('\n=== 5. 阶段独立局制（回合数 3） ===');
  const stageOv = await ev(`(function(){
    var E=TMS.engine,T=TMS.current,st=T.stages[0],M=TMS.model;
    st.useFormat=true;
    st.format=Object.assign(M.defaultFormat(),{gamesPerMatch:1,winNeeded:1,sets:3,setRule:'sets',setsToWin:2});
    var f=E.fmtOf(T,st), fm=E.fmtOfMatch(T,st,st.roundsData[0].matches[0]);
    return {sets:f.sets, matchSets:fm.sets, need:E.setsNeeded(fm)};
  })()`);
  ok('阶段独立局制的回合数生效（3 回合 / 先赢 2）',
    stageOv.sets === 3 && stageOv.matchSets === 3 && stageOv.need === 2, stageOv);

  console.log('\n=== 6. 团体赛下回合数置灰 ===');
  const teamInfo = await ev(`(function(){
    var T=TMS.current;
    T.team.on=true;
    if(TMS.engine && TMS.engine.ensureParticipants) TMS.engine.ensureParticipants(T);
    TMS.store.put(T);
    // 触发重绘
    var tab=document.querySelector('[data-view="players"]'); if(tab) tab.click();
    var tab2=document.querySelector('[data-view="setup"]'); if(tab2) tab2.click();
    var rows=[].slice.call(document.querySelectorAll('#view-setup .fld'));
    var r=rows.filter(function(x){return /每场比赛回合数/.test(x.textContent)})[0];
    var inp=r&&r.querySelector('input');
    return {disabled: inp?!!inp.disabled:null, hint: r?r.textContent.replace(/\\s+/g,''):''};
  })()`);
  ok('团体赛下「回合数」输入被禁用', teamInfo.disabled === true, teamInfo);
  ok('说明里写明只对个人赛生效', /只对个人赛/.test(teamInfo.hint), teamInfo.hint.slice(0, 120));

  console.log('\n=== 7. 无 JS 报错 ===');
  const errs = await ev('window.__errs');
  ok('没有 JS 报错', Array.isArray(errs) && errs.length === 0, (errs||[]).join(' | '));

  conn.close();
  env.child.kill();
  console.log('\nPASS: ' + pass + '   FAIL: ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
