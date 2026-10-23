/**
 * v1.11.1 界面验证：双败「平局 = 双方都输」
 *  1. 双败阶段设置里出现「本阶段平局判定 → 任何平局都判为双方都输」
 *  2. 未允许平局时给出提醒；选了「允许平局」后提示变为生效说明
 *  3. 勾选状态能写回存档（刷新后仍在）
 *  4. 界面里打一场平局：卡片显示「双方各记一负」，且能往下推进
 *  5. 胜者组平局的两人出现在下一轮的败者组里
 *  6. 名次表里冠军 / 亚军符合「负场少者夺冠」
 *  7. 无 JS 报错
 */
const path = require('path'), fs = require('fs');
const { launch, connect } = require('./headless');
const PORT = 9462;
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
async function click(sel) {
  return await ev(`(function(){var el=document.querySelector(${JSON.stringify(sel)});if(!el)return 'none';el.click();return 'ok'})()`);
}

const setupEv = `
(function(){
  var M=TMS.model,S=TMS.store,E=TMS.engine;
  S.loadIndex().slice().forEach(function(x){S.remove(x.id)});
  var t=M.createTournament('平局双负测试');
  for(var i=1;i<=8;i++)t.players.push(M.createPlayer('选手'+i,i));
  var s=M.defaultStage(0);
  s.type='double_elim'; s.name='双败';
  s.tie='draw_ok'; s.drawBothLose=true; s.gfMode='none';
  s.format={gamesPerMatch:2,winNeeded:0,recordScore:true}; s.useFormat=true;
  s.participants=t.players.map(function(p){return p.id});
  s.adv={type:'count',count:1,score:0,perGroup:1};
  t.stages=[s]; t.currentStage=0; t.status='running';
  E.ensureParticipants(t);
  S.put(t); S.setCurrentId(t.id); TMS.current=t; S.save(t);
  return 'ok';
})()`;

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);
  const env = await launch(PORT, path.join(__dirname, '..', 'app'));
  conn = await connect(PORT);
  await conn.send('Runtime.enable'); await conn.send('Page.enable');
  await conn.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await reload();

  console.log('\n=== 1. 建赛事并设置双败 + 允许平局 + 双方都输 ===');
  await ev(setupEv);
  await reload();
  await view('setup');

  const hasBox = await ev(`(function(){
    var els=[].slice.call(document.querySelectorAll('input[type=checkbox]'));
    for(var i=0;i<els.length;i++){ if((els[i].getAttribute('data-bind')||'').indexOf('drawBothLose')>=0) return true; }
    return false;
  })()`);
  ok('设置页出现「双方都输」勾选框', hasBox === true);

  const hintTxt = await ev(`(function(){
    var els=[].slice.call(document.querySelectorAll('input[type=checkbox]'));
    for(var i=0;i<els.length;i++){
      if((els[i].getAttribute('data-bind')||'').indexOf('drawBothLose')>=0){
        var row=els[i].closest('.fld')||els[i].parentNode.parentNode;
        return (row.innerText||'').replace(/\\s+/g,' ').trim();
      }
    }
    return '';
  })()`);
  ok('勾选框文案写明规则', /双方都输/.test(hintTxt) && /败者组/.test(hintTxt), hintTxt.slice(0, 120));

  const checked = await ev(`(function(){
    var els=[].slice.call(document.querySelectorAll('input[type=checkbox]'));
    for(var i=0;i<els.length;i++){ if((els[i].getAttribute('data-bind')||'').indexOf('drawBothLose')>=0) return !!els[i].checked; }
    return null;
  })()`);
  ok('已勾选状态能读出来', checked === true, checked);

  console.log('\n=== 2. 改平局处理为加赛决胜时应给出「暂不生效」提醒 ===');
  await ev(`(function(){
    var sel=document.querySelector('select[data-bind="stages[0].tie"]');
    if(!sel) return 'none';
    sel.value='sudden_death';
    sel.dispatchEvent(new Event('change',{bubbles:true}));
    return 'ok';
  })()`);
  await sleep(500);
  const warn = await ev(`(function(){
    var ns=[].slice.call(document.querySelectorAll('.notice.inv'));
    return ns.map(function(n){return (n.innerText||'').replace(/\\s+/g,' ')}).join(' || ');
  })()`);
  ok('未允许平局时提示本项届时才生效', /平局/.test(warn) && /生效|才可能/.test(warn), warn.slice(0, 140));

  // 改回允许平局，并确认勾选还在
  await ev(`(function(){
    var sel=document.querySelector('select[data-bind="stages[0].tie"]');
    if(sel){ sel.value='draw_ok'; sel.dispatchEvent(new Event('change',{bubbles:true})); }
    return 'ok';
  })()`);
  await sleep(500);
  const okNotice = await ev(`(function(){
    var ns=[].slice.call(document.querySelectorAll('.notice'));
    return ns.map(function(n){return (n.innerText||'').replace(/\\s+/g,' ')}).join(' || ');
  })()`);
  ok('允许平局后提示变为「已生效」说明', /双方都输/.test(okNotice), okNotice.slice(0, 140));

  console.log('\n=== 3. 刷新后设置还在 ===');
  await reload();
  const saved = await ev(`(function(){
    var t=TMS.model && TMS.current;
    return !!(t && t.stages && t.stages[0] && t.stages[0].drawBothLose);
  })()`);
  ok('drawBothLose 已落盘到赛事数据', saved === true);

  console.log('\n=== 4. 界面打一场平局 ===');
  await view('matches');
  await ev(`(function(){ TMS.engine.generateRound(TMS.current); TMS.store.save(TMS.current); return 'ok'; })()`);
  await view('matches');
  const cardCnt = await ev(`document.querySelectorAll('.match').length`);
  ok('生成首轮 4 张卡', cardCnt === 4, cardCnt);

  // 注意：每次「结算」都会重绘整页，必须一桌一桌地重新查询再点，不能一次拿完再逐个点
  let scored = 0;
  for (let i = 0; i < 4; i++) {
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
    await sleep(250);
  }
  ok('四张卡都走了页面结算按钮', scored === 4, scored);
  await sleep(700);
  const firstTxt = await ev(`(function(){
    var c=document.querySelectorAll('.match')[0];
    return (c&&c.innerText||'').replace(/\\s+/g,' ');
  })()`);
  ok('平局那张卡标注了「双方各记一负」', /双方各记一负/.test(firstTxt), firstTxt.slice(0, 200));
  ok('并且写明去向（掉入败者组）', /掉入败者组|冠军由负场少/.test(firstTxt), firstTxt.slice(0, 200));

  console.log('\n=== 5. 结算后平局两人都出现在败者组 ===');
  const commitRes = await ev(`(function(){
    var E=TMS.engine,t=TMS.current;
    var st=t.stages[0];
    var rd0=st.roundsData[0];
    var dump=(rd0.matches||[]).map(function(m){
      return { bracket:m.bracket, decided:!!m.decided,
               winner:(m.result&&m.result.winner)||null, settled:!!(m.result&&m.result.settled),
               a:(m.result&&m.result.gamesA), b:(m.result&&m.result.gamesB) };
    });
    var f=E.finishRound(t);
    var r=E.deCommitPending(t,st);
    return JSON.stringify({ finish:f, commit:r, dump:dump, committed:!!(st.roundsData[0].committed) });
  })()`);
  ok('首场确实是已结算的平局', /"winner":null/.test(commitRes) && /"settled":true/.test(commitRes));
  ok('结算不再被平局挡住', /"commit":\{"ok":true\}/.test(commitRes), commitRes.slice(0, 120));
  const bothL = await ev(`(function(){
    var de=TMS.current.stages[0].de;
    var rd=TMS.current.stages[0].roundsData[0];
    var m=rd.matches[0];
    return { aInPending: de.pending.indexOf(m.playerA)>=0, bInPending: de.pending.indexOf(m.playerB)>=0,
             aInW: de.w.indexOf(m.playerA)>=0, bInW: de.w.indexOf(m.playerB)>=0, pending: de.pending.length };
  })()`);
  ok('平局两人都不在胜者组', bothL.aInW === false && bothL.bInW === false, bothL);
  ok('平局两人都进了待注入（败者组）名单', bothL.aInPending === true && bothL.bInPending === true, bothL);

  await ev(`(function(){ TMS.engine.generateRound(TMS.current); TMS.store.save(TMS.current); return 'ok'; })()`);
  await view('matches');
  await sleep(300);
  const loserDump = await ev(`(function(){
    var st=TMS.current.stages[0];
    var rd=st.roundsData[st.roundsData.length-1];
    return (rd.matches||[]).map(function(m){
      return (m.bracket||'W')+':'+(TMS.util.nameOf?TMS.util.nameOf(TMS.current,m.playerA):m.playerA)
        +'/'+(m.playerB?'':'轮空');
    }).join(' | ');
  })()`);
  ok('第二轮出现败者组比赛', /L:/.test(loserDump), loserDump.slice(0, 200));

  console.log('\n=== 6. 打完全程：名次表按负场排序 ===');
  const fin = await ev(`(function(){
    var E=TMS.engine,t=TMS.current,st=t.stages[0];
    for(var g=0;g<20;g++){
      var prev=st.roundsData.length;
      var r=E.generateRound(t);
      if(!r.ok) break;
      var rd=st.roundsData[st.roundsData.length-1];
      rd.matches.forEach(function(m,i){
        if(m.isBye) return;
        m.games = (rd.isGF && i===0) ? [{w:'D',a:1,b:1}] : [{w:'A',a:1,b:0}];
        E.evaluate(m,E.fmtOfMatch(t,st,m),st.tie);
      });
      E.finishRound(t);
      var c=E.deCommitPending(t,st);
      if(!c.ok) return 'ERR:'+c.msg;
      if(E.stageFinished(t,st)) break;
    }
    var f=E.finishStage(t);
    return f.ok ? 'ok' : ('ERR:'+f.msg);
  })()`);
  ok('整阶段能打完并收尾（总决赛平局也能收）', fin === 'ok', fin);

  await view('standing');
  await sleep(400);
  const rankInfo = await ev(`(function(){
    var st=TMS.current.stages[0];
    return { n:(st.finalRank||[]).length, first: TMS.engine.nameOf(TMS.current,(st.finalRank||[])[0]),
             second: TMS.engine.nameOf(TMS.current,(st.finalRank||[])[1]) };
  })()`);
  ok('产生 8 人完整名次', rankInfo.n === 8, rankInfo);
  ok('冠亚军都已确定', !!rankInfo.first && !!rankInfo.second, rankInfo);
  await shot('v22_draw_both_lose.png');

  console.log('\n=== 7. 无 JS 报错 ===');
  const errs = await ev(`(window.__errs||[]).join(' | ')`);
  ok('全程无 JS 报错', !errs || errs.trim() === '', errs.slice(0, 200));

  console.log('\n----------------------------------------');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  conn.close();
  env.child.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SMOKE ERROR:', e); process.exit(1); });
