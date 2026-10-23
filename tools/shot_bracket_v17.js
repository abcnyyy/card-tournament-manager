const path = require('path'), fs = require('fs');
const { launch, connect } = require('./headless');
const PORT = 9403;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = path.join(__dirname, 'smoke_out');
(async () => {
  const env = await launch(PORT, path.join(__dirname, '..', 'app'));
  const conn = await connect(PORT);
  await conn.send('Runtime.enable'); await conn.send('Page.enable');
  const ev = async expr => {
    const r = await conn.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const waitTMS = async () => { for (let i = 0; i < 40; i++) { if (await ev('typeof TMS') !== 'undefined') return; await sleep(200); } };
  await waitTMS();
  await ev(`(function(){
    var M=TMS.model,S=TMS.store,E=TMS.engine;
    S.loadIndex().slice().forEach(function(x){S.remove(x.id)});
    var t=M.createTournament('双败对阵图');for(var i=1;i<=8;i++)t.players.push(M.createPlayer('选手'+i,i));
    var st=t.stages[0];st.type='double_elim';st.gfMode='reset';st.participants=t.players.map(function(p){return p.id});S.put(t); TMS.current=t;return 1})()`);
  await ev('location.reload()'); await sleep(1200); await waitTMS();
  const res = await ev(`(function(){
    var S=TMS.store,E=TMS.engine;
    var t=TMS.current||S.get(S.getCurrentId()),st=t.stages[0];
    var nm=function(id){var p=t.players.filter(function(x){return x.id===id})[0];return p?p.name:''};
    var sd=function(s){return +String(s).match(/(\\d+)/)[1]};
    var guard=0;
    while(guard++<20){
      var g=E.generateRound(t); if(!g.ok) break;
      var rd=st.roundsData[st.roundsData.length-1];
      rd.matches.forEach(function(m){
        if(m.isBye){E.evaluate(m,E.fmtOfMatch(t,st,m),st.tie);return;}
        var a=sd(nm(m.playerA)),b=sd(nm(m.playerB));
        var w=(a<b)?'A':'B';
        if(rd.isGF && !rd.gfReset) w='B';           // 首场总决赛让败者组冠军赢 → 触发加赛
        var f=E.fmtOfMatch(t,st,m);m.games=[];
        var need=(parseInt(f.winNeeded,10)>0)?parseInt(f.winNeeded,10):f.gamesPerMatch;
        for(var k=0;k<need;k++)m.games.push({w:w});
        E.evaluate(m,f,st.tie);
      });
      if(E.stageFinished(t,st))break;
    }
    S.put(t); TMS.current=t;
    var tab=document.querySelector('.tab[data-view="standing"]');
    if(tab)tab.click();
    return {rounds:st.roundsData.length, gf:st.roundsData.filter(function(r){return r.isGF}).length};
  })()`);
  console.log('state', JSON.stringify(res));
  await sleep(800);
  const h = await ev('document.body.scrollHeight');
  await conn.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: Math.min(h + 40, 6000), deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  const shot = await conn.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, 'v17_bracket_path.png'), Buffer.from(shot.data, 'base64'));
  console.log('shot KB', Math.round(shot.data.length / 1024), 'height', h);
  env.child.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
