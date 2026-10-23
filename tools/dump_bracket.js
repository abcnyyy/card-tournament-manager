const path=require('path');
const {launch,connect}=require('./headless');
const PORT=9405; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const DUMP = `(function(){
  function cardText(b){
    var lab=(b.querySelector('.blab')||{}).innerText||'(no-label)';
    var rows=[].slice.call(b.querySelectorAll('.brow')).map(function(r){return r.innerText.replace(/\\s+/g,' ')});
    var p=[].slice.call(b.querySelectorAll('.bpath span')).map(function(s){return s.innerText});
    return lab+' | '+rows.join(' / ')+' || '+p.join(' ; ');
  }
  var out=[];
  [].slice.call(document.querySelectorAll('.bracket-sec')).forEach(function(sec){
    var o={name:(sec.querySelector('.sec-name')||{}).innerText, cols:[]};
    [].slice.call(sec.querySelectorAll('.bracket-col')).forEach(function(c){
      o.cols.push({h:(c.querySelector('.col-name')||{}).innerText,
        cards:[].slice.call(c.querySelectorAll('.bcard')).map(cardText)});
    });
    out.push(o);
  });
  return out;
})()`;
(async()=>{
  const env=await launch(PORT,path.join(__dirname,'..','app'));
  const conn=await connect(PORT);
  await conn.send('Runtime.enable');await conn.send('Page.enable');
  const ev=async e=>{const r=await conn.send('Runtime.evaluate',{expression:e,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails.exception));return r.result.value};
  for(let i=0;i<40;i++){if(await ev('typeof TMS')!=='undefined')break;await sleep(200)}
  await ev(`(function(){var M=TMS.model,S=TMS.store;S.loadIndex().slice().forEach(function(x){S.remove(x.id)});
    var t=M.createTournament('dump');for(var i=1;i<=8;i++)t.players.push(M.createPlayer('选手'+i,i));
    var st=t.stages[0];st.type='double_elim';st.gfMode='reset';st.participants=t.players.map(function(p){return p.id});S.put(t);return 1})()`);
  await ev('location.reload()');await sleep(1000);
  for(let i=0;i<40;i++){if(await ev('typeof TMS')!=='undefined')break;await sleep(200)}
  await ev(`(function(){var S=TMS.store,E=TMS.engine;var t=TMS.current,st=t.stages[0];
    var nm=function(id){var p=t.players.filter(function(x){return x.id===id})[0];return p?p.name:''};
    var sd=function(s){return +String(s).match(/(\\d+)/)[1]};
    var g=0;while(g++<20){var r=E.generateRound(t);if(!r.ok)break;var rd=st.roundsData[st.roundsData.length-1];
      rd.matches.forEach(function(m){if(m.isBye){E.evaluate(m,E.fmtOfMatch(t,st,m),st.tie);return}
        var a=sd(nm(m.playerA)),b=sd(nm(m.playerB));var w=(a<b)?'A':'B';if(rd.isGF&&!rd.gfReset)w='B';
        var f=E.fmtOfMatch(t,st,m);m.games=[];var need=(parseInt(f.winNeeded,10)>0)?parseInt(f.winNeeded,10):f.gamesPerMatch;
        for(var k=0;k<need;k++)m.games.push({w:w});E.evaluate(m,f,st.tie)});
      if(E.stageFinished(t,st))break}
    S.put(t);TMS.current=t;document.querySelector('.tab[data-view="standing"]').click();return 1})()`);
  await sleep(600);
  const dump=await ev(DUMP);
  dump.forEach(s=>{
    console.log('\n## '+s.name);
    s.cols.forEach(c=>{
      console.log(' ['+c.h+']');
      c.cards.forEach(t=>console.log('   '+t));
    });
  });
  env.child.kill();process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
