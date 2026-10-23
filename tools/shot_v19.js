/**
 * v1.9.0 截图（无头，零窗口）
 * 生成：设置页各处、手动编排面板、手机版界面
 */
const path = require('path'), fs = require('fs');
const { launch, connect } = require('./headless');
const PORT = 9489;
const OUT = path.join(__dirname, 'smoke_out');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const env = await launch(PORT, path.join(__dirname, '..', 'app'));
  const conn = await connect(PORT);
  await conn.send('Runtime.enable'); await conn.send('Page.enable');
  const ev = async e => {
    const r = await conn.send('Runtime.evaluate', { expression: e, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result && r.result.value;
  };
  const shot = async n => {
    const r = await conn.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, n), Buffer.from(r.data, 'base64'));
    console.log('  saved', n);
  };
  // 滚到指定文字所在行，并留一点上边距
  const scrollTo = async re => {
    await ev(`(function(){
      var re=${re};
      var els=[].slice.call(document.querySelectorAll('h4, .fld, .hint, .card'));
      for(var i=0;i<els.length;i++){
        if(re.test(els[i].textContent)){ els[i].scrollIntoView({block:'center'}); return 1; }
      }
      return 0;
    })()`);
    await sleep(350);
  };

  await ev('location.reload()'); await sleep(1700);

  /* ---------- 场景 1：瑞士轮配对方式 ---------- */
  await ev(`(function(){
    var M=TMS.model,S=TMS.store;
    S.loadIndex().slice().forEach(function(x){S.remove(x.id)});
    var t=M.createTournament('v19 瑞士轮 12 人');
    for(var i=1;i<=12;i++)t.players.push(M.createPlayer('选手'+i,i));
    var a=M.defaultStage(0),b=M.defaultStage(1);
    a.type='swiss';a.rounds=4;a.pairMode='manual';
    b.type='swiss';b.rounds=3;b.inherit={enabled:true,ratio:50,fromStage:null,tie:false};
    t.stages=[a,b];t.currentStage=0;t.status='running';
    TMS.engine.ensureParticipants(t);
    S.put(t);TMS.current=t;return 1})()`);
  await ev('location.reload()'); await sleep(1700);
  await ev(`document.querySelector('[data-view="setup"]').click()`); await sleep(450);
  await scrollTo('/每轮配对方式/');
  await shot('v19_setup_pair.png');

  /* ---------- 场景 2：淘汰赛编排方式 ---------- */
  await ev(`(function(){
    var sels=[].slice.call(document.querySelectorAll('select'));var s=null;
    sels.forEach(function(x){var t=[].slice.call(x.options).map(function(o){return o.textContent});
      if(t.some(function(y){return /单败淘汰|双败淘汰/.test(y)})) s=s||x;});
    s.value='single_elim';s.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
  await sleep(500);
  await ev(`(function(){
    var sels=[].slice.call(document.querySelectorAll('select'));var s=null;
    sels.forEach(function(x){var t=[].slice.call(x.options).map(function(o){return o.textContent});
      if(t.some(function(y){return /按种子号编排|分档抽签|完全随机抽签/.test(y)})) s=s||x;});
    s.value='tier';s.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
  await sleep(500);
  await scrollTo('/首轮编排方式/');
  await shot('v19_setup_draw.png');

  /* ---------- 场景 3：继承积分 + 同时继承小分 ---------- */
  await ev(`document.querySelectorAll('[data-act="gotoStage"]')[1].click()`);
  await sleep(500);
  await ev(`(function(){
    var rows=[].slice.call(document.querySelectorAll('.fld'));
    for(var i=0;i<rows.length;i++){
      var lab=rows[i].querySelector('label');
      if(!lab || !/继承上一阶段积分/.test(lab.textContent)) continue;
      var cb=rows[i].querySelector('input[type=checkbox]');
      if(cb && !cb.checked){cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));}
      return 1;
    }
    return 0})()`);
  await sleep(500);
  await ev(`(function(){
    var rows=[].slice.call(document.querySelectorAll('.fld'));
    for(var i=0;i<rows.length;i++){
      var lab=rows[i].querySelector('label');
      if(!lab || !/同时继承小分/.test(lab.textContent)) continue;
      var cb=rows[i].querySelector('input[type=checkbox]');
      if(cb && !cb.checked){cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));}
      return 1;
    }
    return 0})()`);
  await sleep(500);
  await scrollTo('/分数继承/');
  await shot('v19_setup_inherit.png');

  /* ---------- 场景 4：手动编排面板 ---------- */
  await ev(`(function(){
    var M=TMS.model,S=TMS.store;
    S.loadIndex().slice().forEach(function(x){S.remove(x.id)});
    var t=M.createTournament('v19 手动编排');
    for(var i=1;i<=9;i++)t.players.push(M.createPlayer('选手'+i,i));
    var a=M.defaultStage(0);
    a.type='swiss';a.rounds=3;a.pairMode='manual';a.adv={type:'all'};
    t.stages=[a];t.currentStage=0;t.status='running';
    TMS.engine.ensureParticipants(t);
    S.put(t);TMS.current=t;return 1})()`);
  await ev('location.reload()'); await sleep(1700);
  await ev(`document.querySelector('[data-view="matches"]').click()`); await sleep(450);
  await ev(`(function(){var b=document.querySelector('[data-act="genRound"]');if(b)b.click();return 1})()`);
  await sleep(600);
  // 先排两桌，让面板看起来有内容
  await ev(`(function(){var b=document.querySelector('[data-act="dRandom"]');if(b)b.click();return 1})()`);
  await sleep(400);
  await ev(`(function(){var b=document.querySelector('[data-act="dBreak"]');if(b)b.click();return 1})()`);
  await sleep(400);
  await ev(`(function(){var cs=[].slice.call(document.querySelectorAll('.arrcard .chip'));cs[0].click();return 1})()`);
  await sleep(250);
  await ev(`(function(){var cs=[].slice.call(document.querySelectorAll('.arrcard .chip'));
    for(var i=0;i<cs.length;i++){if(!cs[i].classList.contains('used')&&!cs[i].classList.contains('sel')){cs[i].click();break;}}
    return 1})()`);
  await sleep(450);
  await ev(`(function(){var c=document.querySelector('.arrcard');if(c)c.scrollIntoView({block:'start'});window.scrollBy(0,-140);return 1})()`);
  await sleep(350);
  await shot('v19_manual_arrange.png');

  /* ---------- 场景 5：手机版 ---------- */
  await conn.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true
  });
  await sleep(600);
  await ev(`window.scrollTo(0,0)`);
  await sleep(300);
  await shot('v19_mobile_matches.png');
  await ev(`document.querySelector('[data-view="standing"]').click()`);
  await sleep(600);
  await ev(`window.scrollTo(0,0)`);
  await sleep(300);
  await shot('v19_mobile_standing.png');

  await conn.send('Emulation.clearDeviceMetricsOverride');
  await sleep(300);
  console.log('done');
  try { conn.close(); } catch (e) {}
  try { env.child.kill(); } catch (e) {}
  process.exit(0);
})();
