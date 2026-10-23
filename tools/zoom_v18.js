/* v1.8 放大截图：只看双败对阵图区域（2x 缩放） */
const path = require('path'), fs = require('fs');
const { launch, connect } = require('./headless');
const PORT = 9423;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = path.join(__dirname, 'smoke_out');

const PLAY = `(function(opt){
  var t=TMS.current||TMS.store.get(TMS.store.getCurrentId()), st=t.stages[0];
  var nm=function(id){var p=t.players.filter(function(x){return x.id===id})[0];return p?p.name:''};
  var sd=function(s){return +String(s).match(/(\\d+)/)[1]};
  var guard=0;
  while(guard++<40){
    if(st.roundsData.length>=opt.rounds) break;
    var g=TMS.engine.generateRound(t); if(!g.ok) break;
    var rd=st.roundsData[st.roundsData.length-1];
    rd.matches.forEach(function(m){
      if(m.isBye){TMS.engine.evaluate(m,TMS.engine.fmtOfMatch(t,st,m),st.tie);return;}
      var a=sd(nm(m.playerA)),b=sd(nm(m.playerB));
      var w=(a<b)?'A':'B';
      if(rd.isGF && m.gfRound!=='reset') w='B';
      var f=TMS.engine.fmtOfMatch(t,st,m);m.games=[];
      var need=(parseInt(f.winNeeded,10)>0)?parseInt(f.winNeeded,10):f.gamesPerMatch;
      for(var k=0;k<need;k++)m.games.push({w:w});
      TMS.engine.evaluate(m,f,st.tie);
    });
  }
  TMS.store.put(t); TMS.current=t;
  var tab=document.querySelector('.tab[data-view="standing"]');
  if(tab)tab.click();
  return 1;
})`;

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
    var M=TMS.model,S=TMS.store;
    S.loadIndex().slice().forEach(function(x){S.remove(x.id)});
    var t=M.createTournament('双败·升格决赛');for(var i=1;i<=8;i++)t.players.push(M.createPlayer('选手'+i,i));
    var st=t.stages[0];st.type='double_elim';st.gfMode='elevate';
    st.gfUseFormat=true;st.gfFormat={gamesPerMatch:5,winNeeded:3,recordScore:false};
    st.participants=t.players.map(function(p){return p.id});
    S.put(t); TMS.current=t;return 1})()`);
  await ev('location.reload()'); await sleep(1200); await waitTMS();
  await ev(PLAY + '(7)');
  await sleep(700);

  // 先固定宽度量一次高度，再把视口撑到刚好放下整张图（避免二次回流后裁掉底部）
  const WIDTH = 1500;
  await conn.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  let box = await ev(`(function(){
    var el=document.querySelector('.bracket-wrap');
    if(!el) return null;
    var r=el.getBoundingClientRect();
    return {x:r.x, y:r.y+window.scrollY, w:r.width, h:r.height};
  })()`);
  if (!box) throw new Error('没找到对阵图容器');
  await conn.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: Math.ceil(box.y + box.h + 60), deviceScaleFactor: 2, mobile: false
  });
  await sleep(500);
  await ev('window.scrollTo(0,0)');
  await sleep(300);
  // 撑高视口后重新量一次，取两者较大值，确保底部的「胜/负」两行不被裁
  box = await ev(`(function(){
    var el=document.querySelector('.bracket-wrap');
    var r=el.getBoundingClientRect();
    return {x:r.x, y:r.y+window.scrollY, w:r.width, h:Math.max(r.height, el.scrollHeight)};
  })()`);
  const shot = await conn.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: box.w + 24, height: box.h + 30, scale: 1 }
  });
  fs.writeFileSync(path.join(OUT, 'v18_de_zoom.png'), Buffer.from(shot.data, 'base64'));
  console.log('zoom KB', Math.round(shot.data.length / 1024), 'w', Math.round(box.w), 'h', Math.round(box.h));
  env.child.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
