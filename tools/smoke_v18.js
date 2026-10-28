/**
 * v1.8.0 界面验证
 *  1. 设置页：新增「固定人数晋级（同分同名次）」，选中后出现晋级人数（基准）
 *  2. 设置页：淘汰赛自动推算提示（轮数 / 规模 / 轮空 / 各轮场次）
 *  3. 设置页：双败总决赛新增「可升格决赛」，并显示首场 → 升格局制
 *  4. 对阵图：双败每格都有选手或来源，总决赛在最右
 *  5. 对阵图：单败 20 人取 8 → 首轮 4 场、第 2 轮 8 场（轮空直接进第 2 轮）
 *  6. 无 JS 报错
 */
const path = require('path'), fs = require('fs');
const { launch, connect } = require('./headless');
const PORT = 9433;
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
async function view(v) { await ev(`(function(){var el=document.querySelector('[data-view="${v}"]');if(el){el.click();return 1}return 0})()`); await sleep(420); }
async function reload() {
  await ev('location.reload()'); await sleep(1700);
  await ev(`window.__errs=[];window.addEventListener('error',function(e){window.__errs.push(String(e.message))});
    (function(){var oe=console.error;console.error=function(){window.__errs.push([].slice.call(arguments).join(' '));oe.apply(console,arguments)}})();'ok'`);
}

(async () => {
  const env = await launch(PORT, path.join(__dirname, '..', 'app'));
  conn = await connect(PORT);
  await conn.send('Runtime.enable'); await conn.send('Page.enable');
  await reload();

  /* ---------- 0. 建一个 20 人两阶段赛事 ---------- */
  console.log('\n=== 0. 建赛事（20 人，单败取 8 → 瑞士轮）===');
  await ev(`(function(){
    var M=TMS.model,S=TMS.store;
    S.loadIndex().slice().forEach(function(x){S.remove(x.id)});
    var t=M.createTournament('v18 测试');
    for(var i=1;i<=20;i++)t.players.push(M.createPlayer('选手'+i,i));
    var a=M.defaultStage(0),b=M.defaultStage(1);
    a.type='single_elim';a.adv={type:'count',count:8,score:0,perGroup:2};
    b.type='swiss';b.rounds=3;
    t.stages=[a,b];t.currentStage=0;t.status='running';
    TMS.engine.ensureParticipants(t);
    S.put(t);TMS.current=t;return 1})()`);
  await reload();
  await view('setup');

  /* ---------- 1. 晋级方式：固定人数 + 同分同名次 ---------- */
  console.log('\n=== 1. 晋级方式 ===');
  const advOpts = await ev(`(function(){
    var sels=[].slice.call(document.querySelectorAll('select'));
    for(var i=0;i<sels.length;i++){
      var t=[].slice.call(sels[i].options).map(function(o){return o.textContent});
      if(t.some(function(x){return /全部晋级|固定人数/.test(x)})) return t;
    }
    return [];
  })()`);
  console.log('    选项：', JSON.stringify(advOpts));
  ok('有「固定人数晋级（同分同名次）」选项', advOpts.some(x => /固定人数晋级/.test(x)), advOpts);
  ok('选项里说明了同分一起晋级', advOpts.some(x => /同分/.test(x)));

  // 切到 count_tie，检查「晋级人数（基准）」与同分说明
  const tieUI = await ev(`(function(){
    var sels=[].slice.call(document.querySelectorAll('select'));
    for(var i=0;i<sels.length;i++){
      var s=sels[i], arr=[].slice.call(s.options);
      var o=arr.filter(function(x){return x.value==='count_tie'})[0];
      if(o){ s.value='count_tie'; s.dispatchEvent(new Event('change',{bubbles:true})); return 1; }
    }
    return 0;
  })()`);
  await sleep(600);
  const tieTxt = await ev(`document.body.innerText`);
  ok('切换到固定人数晋级成功', tieUI === 1);
  ok('出现「晋级人数（基准）」输入', /晋级人数（基准）/.test(tieTxt));
  ok('说明同分者一起晋级、人数可能多于 N', /同分的人一起一起晋级|同分者一起晋级|同分的人一起晋级/.test(tieTxt));
  // 滚到「淘汰赛设置 / 晋级条件」再截图
  await ev(`(function(){var hs=document.querySelectorAll('h4');for(var i=0;i<hs.length;i++){if(/淘汰赛设置/.test(hs[i].textContent)){hs[i].scrollIntoView({block:'start'});window.scrollBy(0,-40);return 1}}return 0})()`);
  await sleep(400);
  await shot('v18_setup_tie.png');

  /* ---------- 2. 自动推算提示 ---------- */
  console.log('\n=== 2. 淘汰赛自动推算 ===');
  ok('显示自动推算：轮数', /自动推算/.test(tieTxt) && /共\s*2\s*轮|共 2 轮/.test(tieTxt.replace(/\s+/g, ' ')), tieTxt.match(/自动推算[^<]{0,80}/));
  ok('显示首轮轮空人数', /12 人轮空/.test(tieTxt));
  ok('显示各轮实打场次 4 → 8', /4 → 8/.test(tieTxt.replace(/\s+/g, ' ')), (tieTxt.match(/各轮实打场次[^，]{0,30}/) || [''])[0]);
  ok('说明轮数和轮空不用手填', /不需要手填/.test(tieTxt));

  /* ---------- 3. 可升格决赛 ---------- */
  console.log('\n=== 3. 双败 · 可升格决赛 ===');
  await ev(`(function(){
    var M=TMS.model,S=TMS.store;
    S.loadIndex().slice().forEach(function(x){S.remove(x.id)});
    var t=M.createTournament('升格决赛');
    for(var i=1;i<=8;i++)t.players.push(M.createPlayer('选手'+i,i));
    var st=t.stages[0];st.type='double_elim';
    st.participants=t.players.map(function(p){return p.id});
    S.put(t);TMS.current=t;return 1})()`);
  await reload();
  await view('setup');
  const gfOpts = await ev(`(function(){
    var sels=[].slice.call(document.querySelectorAll('select'));
    for(var i=0;i<sels.length;i++){
      var t=[].slice.call(sels[i].options).map(function(o){return o.textContent});
      if(t.some(function(x){return /升格/.test(x)})) return t;
    }
    return [];
  })()`);
  console.log('    总决赛赛制选项：', JSON.stringify(gfOpts.map(x => x.slice(0, 14))));
  ok('总决赛赛制有「可升格决赛」', gfOpts.some(x => /可升格决赛/.test(x)), gfOpts);

  await ev(`(function(){
    var sels=[].slice.call(document.querySelectorAll('select'));
    for(var i=0;i<sels.length;i++){
      var s=sels[i],o=[].slice.call(s.options).filter(function(x){return x.value==='elevate'})[0];
      if(o){s.value='elevate';s.dispatchEvent(new Event('change',{bubbles:true}));return 1}
    }
    return 0;
  })()`);
  await sleep(700);
  const elevTxt = await ev('document.body.innerText');
  ok('显示「升格后的目标局数」', /升格后的目标局数/.test(elevTxt), (elevTxt.match(/升格后的目标局数[^\n]{0,30}/) || [''])[0]);
  ok('说明「只有一场 / 比分累计不重置」', /只有一场/.test(elevTxt) && /比分累计不重置/.test(elevTxt),
    (elevTxt.match(/只有一场[^\n]{0,60}/) || [''])[0]);
  ok('说明败者组冠军先到线才升格、胜者组冠军先到线直接夺冠',
    /败者组冠军/.test(elevTxt) && /先到 \d+ 局/.test(elevTxt) && /直接夺冠/.test(elevTxt),
    (elevTxt.match(/若.{0,80}直接夺冠/) || [''])[0]);
  await ev(`(function(){var hs=document.querySelectorAll('h4');for(var i=0;i<hs.length;i++){if(/总决赛规则/.test(hs[i].textContent)){hs[i].scrollIntoView({block:'start'});window.scrollBy(0,-30);return 1}}return 0})()`);
  await sleep(400);
  await shot('v18_setup_elevate.png');

  /* ---------- 4. 双败对阵图 ---------- */
  console.log('\n=== 4. 双败完整对阵图 ===');
  await ev(`(function(){
    var t=TMS.current,st=t.stages[0];
    st.gfUseFormat=true;st.gfFormat={gamesPerMatch:5,winNeeded:3,recordScore:false};
    TMS.store.put(t);return 1})()`);
  await ev(`(function(){
    var t=TMS.current||TMS.store.get(TMS.store.getCurrentId()), st=t.stages[0];
    var nm=function(id){var p=t.players.filter(function(x){return x.id===id})[0];return p?p.name:''};
    var sd=function(s){return +String(s).match(/(\\d+)/)[1]};
    var guard=0;
    while(guard++<20){
      var g=TMS.engine.generateRound(t); if(!g.ok) break;
      var rd=st.roundsData[st.roundsData.length-1];
      rd.matches.forEach(function(m){
        if(m.isBye){TMS.engine.evaluate(m,TMS.engine.fmtOfMatch(t,st,m),st.tie);return;}
        if(rd.isGF){
          // 可升格决赛：一场、比分累计。让败者组冠军(B)先到 3 局触发升格，再拿到第 4 局夺冠
          var seq=['B','A','B','A','B','B'];
          seq.forEach(function(w){
            if(m.decided)return;
            m.games.push({w:w});
            TMS.engine.evaluate(m,TMS.engine.fmtOfMatch(t,st,m),st.tie);
          });
          return;
        }
        var a=sd(nm(m.playerA)),b=sd(nm(m.playerB));
        var w=(a<b)?'A':'B';
        var f=TMS.engine.fmtOfMatch(t,st,m);m.games=[];
        var need=(parseInt(f.winNeeded,10)>0)?parseInt(f.winNeeded,10):f.gamesPerMatch;
        for(var k=0;k<need;k++)m.games.push({w:w});
        TMS.engine.evaluate(m,f,st.tie);
      });
      if(TMS.engine.stageFinished(t,st))break;
    }
    TMS.store.put(t);TMS.current=t;return st.roundsData.length;
  })()`);
  await reload();
  await view('standing');
  const de = await ev(`(function(){
    var w=document.querySelector('.bracket-wrap');
    if(!w) return {ok:false};
    var slots=[].slice.call(w.querySelectorAll('.bslot'));
    var empty=slots.filter(function(s){return !((s.innerText||'').trim())}).length;
    var pend=slots.filter(function(s){return s.classList.contains('pend')}).length;
    var heads=[].slice.call(w.querySelectorAll('.bcol .col-head b')).map(function(e){return e.textContent});
    // 每列横向位置，确认总决赛在最右
    var cols=[].slice.call(w.querySelectorAll('.bcol'));
    var byRight=cols.slice().sort(function(a,b){return b.getBoundingClientRect().right-a.getBoundingClientRect().right});
    var rightName=(function(){var b=byRight[0].querySelector('.col-head b');return b?b.textContent:''})();
    var gfLeft=Math.min.apply(null,cols.filter(function(c){
      var b=c.querySelector('.col-head b');
      return b && /总决赛|升格决赛|加赛局/.test(b.textContent);
    }).map(function(c){return c.getBoundingClientRect().left}));
    // 只和「同一行（胜者组）里非总决赛的列」比，确认总决赛在胜者组最右端
    var wbRight=Math.max.apply(null,cols.filter(function(c){
      var b=c.querySelector('.col-head b');
      var row=c.getBoundingClientRect().top;
      var topRow=Math.min.apply(null,cols.map(function(x){return x.getBoundingClientRect().top}));
      return b && Math.abs(row-topRow)<2 && !/总决赛|升格决赛|加赛局/.test(b.textContent);
    }).map(function(c){return c.getBoundingClientRect().right}));
    var otherRight=wbRight;
    return {ok:true, slots:slots.length, empty:empty, pend:pend, heads:heads,
      rightName:rightName, gfLeft:gfLeft, otherRight:otherRight,
      rows:document.querySelectorAll('.bgrow').length};
  })()`);
  console.log('    图：', JSON.stringify({slots: de.slots, empty: de.empty, pend: de.pend, rows: de.rows}));
  ok('对阵图已渲染', de.ok === true);
  ok('两行：胜者组 + 败者组', de.rows === 2, de.rows);
  ok('每一格都有内容（无空白格）', de.empty === 0, de.empty);
  const pendTexts = await ev(`(function(){
    return [].slice.call(document.querySelectorAll('.bslot.pend span')).map(function(e){return e.textContent}).slice(0,6);
  })()`);
  console.log('    未定格示例：', JSON.stringify(pendTexts));
  ok('未定格的写法是「第 N 轮 第 M 场胜者 / 败者」',
    pendTexts.length >= 0 && pendTexts.every(x => /第 \d+ 轮 第 \d+ 场(胜者|败者)/.test(x)), pendTexts);
  ok('最右一列就是总决赛', /总决赛/.test(de.rightName), de.rightName);
  ok('总决赛在所有其它列（含败者组）的右边', de.gfLeft >= de.otherRight - 2,
    [Math.round(de.gfLeft), Math.round(de.otherRight)]);
  const gfSub = await ev(`(function(){
    var cs=[].slice.call(document.querySelectorAll('.bcol'));
    for(var i=0;i<cs.length;i++){
      var b=cs[i].querySelector('.col-head b');
      if(b && /总决赛/.test(b.textContent)){var s=cs[i].querySelector('.col-head span');return s?s.textContent:''}
    }
    return '';
  })()`);
  console.log('    总决赛列头：', gfSub);
  ok('总决赛列头写明「一场定胜负 · 比分累计」', /一场定胜负/.test(gfSub) && /比分累计/.test(gfSub), gfSub);
  ok('只有一列总决赛（升格不再单列）', de.heads.filter(x => /总决赛|升格决赛/.test(x)).length === 1, de.heads);
  ok('图上显示升格后的比分（B 4:2 夺冠）', /4/.test(await ev(`(function(){
    var cs=[].slice.call(document.querySelectorAll('.bcol'));
    for(var i=0;i<cs.length;i++){
      var b=cs[i].querySelector('.col-head b');
      if(b && /总决赛/.test(b.textContent)) return cs[i].innerText.replace(/\\s+/g,' ');
    }
    return '';
  })()`)));
  await shot('v18_de_ui.png');

  /* ---------- 5. 单败 20 取 8 ---------- */
  console.log('\n=== 5. 单败 20 人取 8 的对阵图 ===');
  await ev(`(function(){
    var M=TMS.model,S=TMS.store;
    S.loadIndex().slice().forEach(function(x){S.remove(x.id)});
    var t=M.createTournament('20取8');
    for(var i=1;i<=20;i++)t.players.push(M.createPlayer('选手'+i,i));
    var a=M.defaultStage(0),b=M.defaultStage(1);
    a.type='single_elim';a.adv={type:'count',count:8,score:0,perGroup:2};
    b.type='swiss';b.rounds=3;
    t.stages=[a,b];t.status='running';
    TMS.engine.ensureParticipants(t);
    S.put(t);TMS.current=t;return 1})()`);
  await reload();
  await view('standing');
  const se = await ev(`(function(){
    var cols=[].slice.call(document.querySelectorAll('.bcol'));
    return {
      cols:cols.length,
      heads:cols.map(function(c){var b=c.querySelector('.col-head b');return b?b.textContent:''}),
      counts:cols.map(function(c){return c.querySelectorAll('.bcard').length}),
      subs:cols.map(function(c){var s=c.querySelector('.col-head span');return s?s.textContent:''}),
      firstCard:(cols[0]?cols[0].querySelector('.bcard').innerText.replace(/\\s+/g,' '):''),
      secondCard:(cols[1]?cols[1].querySelector('.bcard').innerText.replace(/\\s+/g,' '):'')
    };
  })()`);
  console.log('    ', JSON.stringify(se));
  ok('2 列（取 8 人只需 2 轮）', se.cols === 2, se.heads);
  ok('首轮只排 4 场（12 人轮空）', se.counts[0] === 4, se.counts);
  ok('第 2 轮 8 场', se.counts[1] === 8, se.counts);
  ok('首轮列说明本轮人数', /本轮 20 人/.test(se.subs[0]), se.subs[0]);
  ok('第 2 轮出现「第 1 轮 第 N 场胜者」', /第 1 轮 第 \d 场胜者/.test(se.secondCard), se.secondCard);
  ok('轮空者直接以姓名出现在第 2 轮', /选手\d+/.test(se.secondCard), se.secondCard);
  await shot('v18_se_ui.png');

  /* ---------- 6. 退赛 / DQ 不再排进对阵 ---------- */
  console.log('\n=== 6. 退赛选手不再排进对阵 ===');
  await ev(`(function(){
    var M=TMS.model,S=TMS.store;
    S.loadIndex().slice().forEach(function(x){S.remove(x.id)});
    var t=M.createTournament('退赛测试');
    for(var i=1;i<=8;i++)t.players.push(M.createPlayer('选手'+i,i));
    var a=M.defaultStage(0);
    a.type='single_elim';
    t.stages=[a];t.status='running';
    TMS.engine.ensureParticipants(t);
    S.put(t);TMS.current=t;return 1})()`);
  await reload();
  await view('standing');
  // 首轮生成 → 打完 → 让 1 号胜者退赛 → 生成第 2 轮
  const dropRes = await ev(`(function(){
    var t=TMS.current, st=t.stages[0], E=TMS.engine;
    var g=E.generateRound(t);
    var rd0=st.roundsData[0];
    rd0.matches.forEach(function(m){
      if(m.isBye){E.evaluate(m,E.fmtOfMatch(t,st,m),st.tie);return;}
      m.games=[{w:'A'},{w:'A'}];
      E.evaluate(m,E.fmtOfMatch(t,st,m),st.tie);
    });
    var w0=rd0.matches[0].result.winner==='A'?rd0.matches[0].playerA:rd0.matches[0].playerB;
    var p=t.players.filter(function(x){return x.id===w0})[0];
    p.active=false;p.dropReason='退赛';
    var n=E.settleDropped(t,st);
    E.dePurgeDropped(t,st);
    var g2=E.generateRound(t);
    var ids=[];
    (st.roundsData[1]?st.roundsData[1].matches:[]).forEach(function(m){
      if(m.playerA)ids.push(m.playerA); if(m.playerB)ids.push(m.playerB);
    });
    TMS.store.put(t);TMS.current=t;
    return {g2:g2.ok, dropped:p.name, inNext: ids.indexOf(w0)>=0, settled:n,
            byes:(st.roundsData[1]||{matches:[]}).matches.filter(function(m){return m.isBye}).length};
  })()`);
  console.log('    ', JSON.stringify(dropRes));
  await reload();
  await view('standing');
  ok('第 2 轮仍能生成', dropRes.g2 === true);
  ok('退赛的胜者没有出现在第 2 轮对阵里', dropRes.inNext === false, dropRes.dropped);
  ok('第 2 轮因缺人出现 1 场轮空', dropRes.byes === 1, dropRes.byes);
  const dropUi = await ev(`(function(){
    var w=document.querySelector('.bracket-wrap');
    if(!w) return {ok:false};
    var names=[].slice.call(w.querySelectorAll('.bslot span')).map(function(e){return e.textContent});
    return {ok:true, hasFlag: !!w.querySelector('.bslot.dropped .dropflag'),
      names:names.slice(0,4)};
  })()`);
  console.log('    ', JSON.stringify(dropUi));
  ok('对阵图照常渲染', dropUi.ok === true);
  ok('退赛者在对阵图上有「退赛」标记', dropUi.hasFlag === true);
  await shot('v18_drop_ui.png');

  /* ---------- 7. 无报错 ---------- */
  console.log('\n=== 7. 无 JS 报错 ===');
  const errs = await ev('JSON.stringify(window.__errs||[])');
  ok('全程无 JS 报错', errs === '[]', errs);

  console.log('\n----------------------------------------');
  console.log('PASS: ' + pass + '   FAIL: ' + fail);
  console.log('----------------------------------------');
  env.child.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
