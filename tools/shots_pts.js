/* 视觉验收：滚动到含关键词的卡片再截图（零窗口） */
const path = require('path'), fs = require('fs');
const { launch, connect } = require('./headless');
const PORT = 9433;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = path.join(__dirname, 'smoke_out');
const view = process.argv[2] || 'setup';
const kw = process.argv[3] || '';
const outName = process.argv[4] || ('pts_' + view + '.png');
const W = parseInt(process.argv[5], 10) || 1400;
const H = parseInt(process.argv[6], 10) || 1000;
const SCENE = ['build_demo_scene.js', 'build_v25_scene.js']
  .map(f => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n');

(async () => {
  const env = await launch(PORT, path.join(__dirname, '..', 'app'));
  const conn = await connect(PORT);
  await conn.send('Runtime.enable');
  await conn.send('Page.enable');
  const ev = async expr => {
    const r = await conn.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  await conn.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  for (let i = 0; i < 80; i++) {
    if (await ev(`(document.readyState==='complete') && typeof TMS==='object' && !!TMS.engine && !!TMS.exporter`)) break;
    await sleep(150);
  }
  await ev(SCENE);
  await sleep(200);
  await ev('location.reload()');
  await sleep(1800);
  for (let i = 0; i < 60; i++) {
    if (await ev(`(document.readyState==='complete') && typeof TMS==='object' && !!TMS.engine`)) break;
    await sleep(150);
  }
  await ev(`(function(){var b=document.querySelector('.tab[data-view="${view}"]'); if(b) b.click(); return 1})()`);
  await sleep(650);
  if (process.env.EXTRA_JS) { await ev(process.env.EXTRA_JS); await sleep(600); }
  if (kw.indexOf('season:') === 0) {
    var nm = kw.slice(7);
    await ev(`(function(){
      var trs=[].slice.call(document.querySelectorAll('#view-${view} tbody tr'));
      var trs2=trs.filter(function(r){return r.innerText.indexOf(${JSON.stringify(nm)})>=0})[0];
      var b=trs2?trs2.querySelector('[data-act="openSeason"]'):document.querySelector('[data-act="openSeason"]');
      if(b) b.click(); return 1})()`);
    await sleep(650);
  } else if (kw) {
    const r = await ev(`(function(){
      var cs=[].slice.call(document.querySelectorAll('#view-${view} .card'));
      var c=cs.filter(function(x){return x.innerText.indexOf(${JSON.stringify(kw)})>=0})[0];
      if(!c) return 'notfound';
      c.scrollIntoView({block:'start'});
      window.scrollBy(0,-70);
      return Math.round(c.getBoundingClientRect().top);
    })()`);
    if (r === 'notfound') { console.log('WARN 未找到含「' + kw + '」的卡片'); }
    await sleep(400);
  }
  if (process.env.PRINT_TEXT) {
    console.log('TEXT:', await ev(`(function(){var c=[].slice.call(document.querySelectorAll('#view-${view} .card')).filter(function(x){return /口径说明/.test(x.innerText)})[0]; return c?c.innerText.replace(/\\s+/g,' '):'(none)'})()`));
  }
  const shot = await conn.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, outName), Buffer.from(shot.data, 'base64'));
  console.log('saved', outName, 'scrollY=', await ev('Math.round(window.scrollY)'));
  conn.close();
  env.child.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
