/**
 * v2.6 界面验证：分数继承补上「战绩」
 *  1. 设置页：出现「同时继承战绩」勾选，默认勾上；「同时继承小分」仍默认不勾
 *  2. 排名页：阶段 2 的场次 / 胜 / 平 / 负 / 赢局-输局 = 上一阶段原值（含继承提示）
 *  3. 关掉「继承战绩」→ 场次 / 胜负 / 局数归零，积分照旧
 *  4. 再勾回来 → 恢复
 *  5. 手机档（390 宽）不溢出
 *  6. 无 JS 报错
 */
const path = require('path'), fs = require('fs');
const { launch, connect } = require('./headless');
const PORT = 9457;
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

/* 读排名页表格：按表头名取值 */
const READ_TBL = `function readTbl(){
  var tbl=document.querySelector('#view-standing table.compact');
  if(!tbl) return null;
  var hs=[].slice.call(tbl.querySelectorAll('thead th')).map(function(th){return th.innerText.trim()});
  var rows=[].slice.call(tbl.querySelectorAll('tbody tr')).map(function(tr){
    var tds=[].slice.call(tr.children), o={};
    hs.forEach(function(h,i){ if(tds[i]) o[h]=tds[i].innerText.trim(); });
    return o;
  });
  return {hs:hs, rows:rows};
}`;

/* 按 label 文字勾选 / 取消复选框 */
const CHECK_BY_LABEL = `function tick(labelRe, want){
  var rows=[].slice.call(document.querySelectorAll('.fld'));
  for(var i=0;i<rows.length;i++){
    var lab=rows[i].querySelector('label');
    if(!lab || !labelRe.test(lab.textContent)) continue;
    var cb=rows[i].querySelector('input[type=checkbox]');
    if(!cb) continue;
    if(want === undefined) want = true;
    if(cb.checked !== want){ cb.checked=want; cb.dispatchEvent(new Event('change',{bubbles:true})); }
    return 1;
  }
  return 0;
}`;

(async () => {
  const env = await launch(PORT, path.join(__dirname, '..', 'app'));
  conn = await connect(PORT);
  await conn.send('Runtime.enable'); await conn.send('Page.enable');
  await reload();

  /* ---------- 0. 建两阶段赛事，第 1 阶段打满 ---------- */
  console.log('\n=== 0. 造数据：8 人瑞士轮 3 轮 → 决赛组 2 轮（继承 100%） ===');
  const built = await ev(`(function(){
    var M=TMS.model,S=TMS.store,E=TMS.engine;
    S.loadIndex().slice().forEach(function(x){S.remove(x.id)});
    var t=M.createTournament('v26 继承');
    for(var i=1;i<=8;i++)t.players.push(M.createPlayer('选手'+i,i));
    var a=M.defaultStage(0),b=M.defaultStage(1);
    a.type='swiss';a.rounds=3;a.adv={type:'count',count:8,score:0,perGroup:2};
    b.type='swiss';b.rounds=2;
    b.inherit={enabled:true,ratio:100,fromStage:null,tie:false,stats:true};
    t.stages=[a,b];t.currentStage=0;t.status='running';
    E.ensureParticipants(t);
    function num(id){var p=t.players.filter(function(x){return x.id===id})[0];return p?+String(p.name).replace('选手',''):0}
    for(var g=0;g<12;g++){
      var r=E.generateRound(t); if(!r.ok)break;
      var rd=a.roundsData[a.roundsData.length-1];
      (rd.matches||[]).forEach(function(m){
        if(m.isBye){m.games=[];E.evaluate(m,E.fmtOfMatch(t,a,m),a.tie);return;}
        var w=num(m.playerA)<num(m.playerB)?'A':'B';
        var f=E.fmtOfMatch(t,a,m);
        var need=(parseInt(f.winNeeded,10)>0)?parseInt(f.winNeeded,10):f.gamesPerMatch;
        m.games=[];
        for(var k=0;k<need;k++)m.games.push(w==='A'?{w:'A',a:2,b:1}:{w:'B',a:1,b:2});
        E.evaluate(m,f,a.tie);
      });
      if(!E.finishRound(t).ok)break;
      if(E.stageFinished(t,a))break;
    }
    E.finishStage(t);
    t.currentStage=1; E.ensureParticipants(t);
    S.put(t);
    var f1=E.stageFinalStats(t,0);
    var ids=a.participants.slice().sort(function(x,y){return num(x)-num(y)});
    var top=ids[0];
    return {rounds:a.roundsData.length, top:f1[top], topName:t.players.filter(function(p){return p.id===top})[0].name,
            ratio:t.stages[1].inherit.ratio, stats:t.stages[1].inherit.stats};
  })()`);
  console.log('    第 1 阶段轮数 ' + built.rounds + '，第一名 ' + built.topName + '：',
    JSON.stringify(built.top));
  ok('第 1 阶段打出了战绩', built.top.wins > 0 && built.top.gamesWon > 0, built.top);
  ok('第 2 阶段默认继承战绩（stats=true）', built.stats === true, built.stats);

  await reload();
  await view('setup');
  await ev(`(function(){var b=[].slice.call(document.querySelectorAll('[data-act="gotoStage"]'));if(b[1])b[1].click();return 1})()`);
  await sleep(450);

  /* ---------- 1. 设置页 ---------- */
  console.log('\n=== 1. 设置页「同时继承战绩」 ===');
  const setup = await ev(`(function(){
    var txt=document.getElementById('view-setup').innerText;
    var rows=[].slice.call(document.querySelectorAll('.fld'));
    var found=null, tie=null;
    rows.forEach(function(r){
      var lab=r.querySelector('label'); if(!lab)return;
      var cb=r.querySelector('input[type=checkbox]'); if(!cb)return;
      if(/同时继承战绩/.test(lab.textContent)) found={checked:cb.checked};
      if(/同时继承小分/.test(lab.textContent)) tie={checked:cb.checked};
    });
    return {
      has: /同时继承战绩/.test(txt),
      box: found, tie: tie,
      tip: (txt.match(/同时继承战绩[\\s\\S]{0,220}/) || [''])[0],
      ratioTip: (txt.match(/继承比例[\\s\\S]{0,160}/) || [''])[0]
    };
  })()`);
  ok('出现「同时继承战绩」勾选项', setup.has === true && !!setup.box, setup);
  ok('默认已勾上', setup.box && setup.box.checked === true, setup.box);
  ok('「同时继承小分」仍默认不勾', setup.tie && setup.tie.checked === false, setup.tie);
  ok('说明写明按原值累计', /原值/.test(setup.tip), setup.tip);
  ok('说明写明破同的胜场 / 赢局也含继承', /胜场数/.test(setup.tip) && /赢局数/.test(setup.tip), setup.tip);
  ok('比例说明讲清只管积分与小分', /只管/.test(setup.ratioTip), setup.ratioTip);
  await shot('v26_setup_inherit_stats.png');

  /* ---------- 2. 排名页：阶段 2 的战绩 = 上一阶段 ---------- */
  console.log('\n=== 2. 排名页（阶段 2）显示累计战绩 ===');
  await view('standing');
  await ev(`(function(){
    var s=document.querySelector('#view-standing select[data-act2="stStage"]');
    if(s && s.value!=='1'){ s.value='1'; s.dispatchEvent(new Event('change',{bubbles:true})); }
    return s?s.value:'none';
  })()`);
  await sleep(550);
  const st2 = await ev(`(function(){${READ_TBL}
    var r=readTbl();
    var hint=(document.querySelector('#view-standing .hint')||{}).innerText||'';
    return {tbl:r, hint:hint.trim()};
  })()`);
  const row2 = st2.tbl && st2.tbl.rows.filter(r => r['选手'] === built.topName)[0];
  console.log('    表头：', st2.tbl && st2.tbl.hs.join(' | '));
  console.log('    第 1 名：', JSON.stringify(row2));
  ok('排名页有表格', !!st2.tbl, null);
  ok('场次 = 上一阶段场次', row2 && String(row2['场次']) === String(built.top.matches), [row2 && row2['场次'], built.top.matches]);
  ok('胜 = 上一阶段胜场', row2 && String(row2['胜']) === String(built.top.wins), [row2 && row2['胜'], built.top.wins]);
  ok('负 = 上一阶段负场', row2 && String(row2['负']) === String(built.top.losses), [row2 && row2['负'], built.top.losses]);
  ok('赢局-输局 = 上一阶段（含继承）',
    row2 && row2['赢局-输局'] === (built.top.gamesWon + '-' + built.top.gamesLost),
    [row2 && row2['赢局-输局'], built.top.gamesWon + '-' + built.top.gamesLost]);
  ok('排名页有继承提示', /继承/.test(st2.hint), st2.hint);
  ok('提示写明战绩按原值累计', /场次/.test(st2.hint) && /原值/.test(st2.hint), st2.hint);
  await shot('v26_standing_inherit.png');

  /* ---------- 3. 关掉继承战绩 ---------- */
  console.log('\n=== 3. 关掉「继承战绩」 ===');
  await view('setup');
  await ev(`(function(){var b=[].slice.call(document.querySelectorAll('[data-act="gotoStage"]'));if(b[1])b[1].click();return 1})()`);
  await sleep(420);
  const untick = await ev(`(function(){${CHECK_BY_LABEL}
    var r=tick(/同时继承战绩/, false);
    return {r:r, stats:TMS.current.stages[1].inherit.stats};
  })()`);
  ok('能取消勾选', untick.r === 1, untick);
  ok('取消后写入存档 stats = false', untick.stats === false, untick);

  await view('standing');
  await ev(`(function(){
    var s=document.querySelector('#view-standing select[data-act2="stStage"]');
    if(s && s.value!=='1'){ s.value='1'; s.dispatchEvent(new Event('change',{bubbles:true})); }
    return 1;
  })()`);
  await sleep(550);
  const st3 = await ev(`(function(){${READ_TBL}
    var r=readTbl();
    var hint=(document.querySelector('#view-standing .hint')||{}).innerText||'';
    return {tbl:r, hint:hint.trim()};
  })()`);
  const row3 = st3.tbl && st3.tbl.rows.filter(r => r['选手'] === built.topName)[0];
  console.log('    第 1 名：', JSON.stringify(row3));
  ok('关掉后场次归零', row3 && String(row3['场次']) === '0', row3 && row3['场次']);
  ok('关掉后胜 / 负归零', row3 && String(row3['胜']) === '0' && String(row3['负']) === '0',
    [row3 && row3['胜'], row3 && row3['负']]);
  ok('关掉后赢局-输局归零', row3 && row3['赢局-输局'] === '0-0', row3 && row3['赢局-输局']);
  ok('关掉后积分仍是继承来的', row3 && parseFloat(row3['积分']) === built.top.points,
    [row3 && row3['积分'], built.top.points]);
  ok('关掉后提示不再写「场次」', !/场次/.test(st3.hint), st3.hint);

  /* ---------- 4. 再勾回来 ---------- */
  console.log('\n=== 4. 重新勾上继承战绩 ===');
  await view('setup');
  await ev(`(function(){var b=[].slice.call(document.querySelectorAll('[data-act="gotoStage"]'));if(b[1])b[1].click();return 1})()`);
  await sleep(420);
  const retick = await ev(`(function(){${CHECK_BY_LABEL}
    var r=tick(/同时继承战绩/, true);
    return {r:r, stats:TMS.current.stages[1].inherit.stats};
  })()`);
  ok('能重新勾上', retick.r === 1 && retick.stats === true, retick);
  await view('standing');
  await ev(`(function(){
    var s=document.querySelector('#view-standing select[data-act2="stStage"]');
    if(s && s.value!=='1'){ s.value='1'; s.dispatchEvent(new Event('change',{bubbles:true})); }
    return 1;
  })()`);
  await sleep(550);
  const st4 = await ev(`(function(){${READ_TBL} return readTbl() })()`);
  const row4 = st4 && st4.rows.filter(r => r['选手'] === built.topName)[0];
  ok('勾回后胜场恢复', row4 && String(row4['胜']) === String(built.top.wins), [row4 && row4['胜'], built.top.wins]);

  /* ---------- 5. 手机档 ---------- */
  console.log('\n=== 5. 手机档 390×844 ===');
  await conn.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(500);
  await shot('v26_standing_mobile.png');
  const mob = await ev(`(function(){
    return { ov: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tbl: (function(){${READ_TBL} var r=readTbl(); return r?r.rows.length:0})() };
  })()`);
  ok('手机档不横向溢出', mob.ov <= 2, mob);
  ok('手机档表格还在', mob.tbl > 0, mob);
  await conn.send('Emulation.clearDeviceMetricsOverride');
  await sleep(300);

  /* ---------- 6. 无报错 ---------- */
  console.log('\n=== 6. 无 JS 报错 ===');
  const errs = await ev('window.__errs || []');
  ok('没有 JS 报错', (errs || []).length === 0, errs);

  console.log('\nPASS: ' + pass + '   FAIL: ' + fail);
  try { await conn.send('Browser.close'); } catch (e) { }
  process.exit(fail ? 1 : 0);
})().catch(async e => {
  console.error('崩了：', e && e.message || e);
  try { await conn.send('Browser.close'); } catch (x) { }
  process.exit(1);
});
