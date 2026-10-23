const path=require('path'),fs=require('fs');
const {launch,connect}=require('./headless');
const PORT=9406; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const OUT=path.join(__dirname,'smoke_out');
(async()=>{
  const env=await launch(PORT,path.join(__dirname,'..','app'));
  const conn=await connect(PORT);
  await conn.send('Runtime.enable');await conn.send('Page.enable');
  const ev=async e=>{const r=await conn.send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails.exception));return r.result.value};
  const wait=async()=>{for(let i=0;i<40;i++){if(await ev('typeof TMS')!=='undefined')return;await sleep(200)}};
  const shot=async(name,h)=>{await conn.send('Emulation.setDeviceMetricsOverride',{width:1500,height:h,deviceScaleFactor:1,mobile:false});await sleep(400);
    const s=await conn.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(OUT,name),Buffer.from(s.data,'base64'));return Math.round(s.data.length/1024)};
  await wait();
  await ev(`(function(){var M=TMS.model,S=TMS.store;S.loadIndex().slice().forEach(function(x){S.remove(x.id)});
    var t=M.createTournament('单败路径');for(var i=1;i<=8;i++)t.players.push(M.createPlayer('选手'+i,i));
    var st=t.stages[0];st.type='single_elim';st.thirdPlace=true;st.participants=t.players.map(function(p){return p.id});S.put(t);return 1})()`);
  await ev('location.reload()');await sleep(1000);await wait();
  const st1=await ev(`(function(){var S=TMS.store,E=TMS.engine;var t=TMS.current,st=t.stages[0];
    var nm=function(id){var p=t.players.filter(function(x){return x.id===id})[0];return p?p.name:''};
    var sd=function(s){return +String(s).match(/(\\d+)/)[1]};
    for(var r=0;r<2;r++){
      var g=E.generateRound(t);if(!g.ok)break;var rd=st.roundsData[st.roundsData.length-1];
      rd.matches.forEach(function(m){if(m.isBye){E.evaluate(m,E.fmtOfMatch(t,st,m),st.tie);return}
        var a=sd(nm(m.playerA)),b=sd(nm(m.playerB));var w=(a<b)?'A':'B';
        var f=E.fmtOfMatch(t,st,m);m.games=[];var need=(parseInt(f.winNeeded,10)>0)?parseInt(f.winNeeded,10):f.gamesPerMatch;
        for(var k=0;k<need;k++)m.games.push({w:w});E.evaluate(m,f,st.tie)});
    }
    S.put(t);TMS.current=t;
    document.querySelector('.tab[data-view="matches"]').click();
    return {rounds:st.roundsData.length}})()`);
  console.log('state',JSON.stringify(st1));
  await sleep(700);
  console.log('matches KB',await shot('v17_matches_path.png',1200));
  await ev(`document.querySelector('.tab[data-view="standing"]').click()`);await sleep(700);
  const h=await ev('document.body.scrollHeight');
  console.log('bracket KB',await shot('v17_single_bracket.png',Math.min(h+40,4000)),'h',h);
  env.child.kill();process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
