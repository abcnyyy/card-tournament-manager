/* v1.8 截图：完整对阵图（单败取 8 人 / 双败升格决赛） */
const path = require('path'), fs = require('fs');
const { launch, connect } = require('./headless');
const PORT = 9421;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = path.join(__dirname, 'smoke_out');

async function page(conn) {
  await conn.send('Runtime.enable'); await conn.send('Page.enable');
  const ev = async expr => {
    const r = await conn.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const waitTMS = async () => { for (let i = 0; i < 40; i++) { if (await ev('typeof TMS') !== 'undefined') return; await sleep(200); } };
  return { ev, waitTMS };
}

const PLAY = `(function(opt){
  var t=TMS.current||TMS.store.get(TMS.store.getCurrentId()), st=t.stages[0];
  var nm=function(id){var p=t.players.filter(function(x){return x.id===id})[0];return p?p.name:''};
  var sd=function(s){return +String(s).match(/(\\d+)/)[1]};
  var guard=0, doRounds=opt.rounds;
  while(guard++<40){
    if(st.roundsData.length>=doRounds) break;
    var g=TMS.engine.generateRound(t); if(!g.ok) break;
    var rd=st.roundsData[st.roundsData.length-1];
    rd.matches.forEach(function(m){
      if(m.isBye){TMS.engine.evaluate(m,TMS.engine.fmtOfMatch(t,st,m),st.tie);return;}
      var a=sd(nm(m.playerA)),b=sd(nm(m.playerB));
      var w=(a<b)?'A':'B';
      if(rd.isGF && !rd.gfReset) w='B';
      var f=TMS.engine.fmtOfMatch(t,st,m);m.games=[];
      var need=(parseInt(f.winNeeded,10)>0)?parseInt(f.winNeeded,10):f.gamesPerMatch;
      for(var k=0;k<need;k++)m.games.push({w:w});
      TMS.engine.evaluate(m,f,st.tie);
    });
    if(TMS.engine.stageFinished(t,st))break;
  }
  TMS.store.put(t); TMS.current=t;
  var tab=document.querySelector('.tab[data-view="standing"]');
  if(tab)tab.click();
  return {rounds:st.roundsData.length};
})`;

(async () => {
  const env = await launch(PORT, path.join(__dirname, '..', 'app'));
  const conn = await connect(PORT);
  const { ev, waitTMS } = await page(conn);
  await waitTMS();

  /* ---------- 1. 双败 8 人 · 可升格决赛 ---------- */
  await ev(`(function(){
    var M=TMS.model,S=TMS.store;
    S.loadIndex().slice().forEach(function(x){S.remove(x.id)});
    var t=M.createTournament('双败·升格决赛');for(var i=1;i<=8;i++)t.players.push(M.createPlayer('选手'+i,i));
    var st=t.stages[0];st.type='double_elim';st.gfMode='elevate';
    st.gfUseFormat=true;st.gfFormat={gamesPerMatch:5,winNeeded:3,recordScore:false};
    st.participants=t.players.map(function(p){return p.id});
    S.put(t); TMS.current=t;return 1})()`);
  await ev('location.reload()'); await sleep(1200); await waitTMS();
  let res = await ev(PLAY + '(3)');
  console.log('DE state', JSON.stringify(res));
  await sleep(600);
  let h = await ev('document.body.scrollHeight');
  await conn.send('Emulation.setDeviceMetricsOverride', { width: 1560, height: Math.min(h + 40, 6000), deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  let shot = await conn.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'v18_de_bracket.png'), Buffer.from(shot.data, 'base64'));
  console.log('v18_de_bracket height', h);

  /* ---------- 2. 单败 20 人 → 取 8 ---------- */
  await ev(`(function(){
    var M=TMS.model,S=TMS.store;
    S.loadIndex().slice().forEach(function(x){S.remove(x.id)});
    var t=M.createTournament('单败·20取8');
    for(var i=1;i<=20;i++)t.players.push(M.createPlayer('选手'+i,i));
    var a=M.defaultStage(0),b=M.defaultStage(1);
    a.type='single_elim'; a.adv={type:'count',count:8,score:0,perGroup:2};
    b.type='swiss'; b.rounds=3;
    t.stages=[a,b]; t.status='running';
    TMS.engine.ensureParticipants(t);
    S.put(t); TMS.current=t;return 1})()`);
  await ev('location.reload()'); await sleep(1200); await waitTMS();
  res = await ev(PLAY + '(1)');
  console.log('SE state', JSON.stringify(res));
  await sleep(600);
  h = await ev('document.body.scrollHeight');
  await conn.send('Emulation.setDeviceMetricsOverride', { width: 1560, height: Math.min(h + 40, 6000), deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  shot = await conn.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'v18_se_bracket.png'), Buffer.from(shot.data, 'base64'));
  console.log('v18_se_bracket height', h);

  env.child.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
