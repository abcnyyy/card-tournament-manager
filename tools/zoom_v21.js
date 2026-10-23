/* v1.11 放大截图：合并对阵图整块（16 人三阶段淘汰赛 + 双败收尾），2x 缩放 */
const path = require('path'), fs = require('fs');
const { launch, connect } = require('./headless');
const PORT = 9427;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = path.join(__dirname, 'smoke_out');
const BUILD = fs.readFileSync(path.join(__dirname, 'build_v21_scene.js'), 'utf8');

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

  await conn.send('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1000, deviceScaleFactor: 1, mobile: false });
  await ev(BUILD);
  await sleep(400);
  await ev('location.reload()');
  await sleep(2000);
  await waitTMS();
  await ev(`(function(){var t=document.querySelector('.tab[data-view="standing"]');if(t)t.click();return 1})()`);
  await sleep(900);

  // 先量出合并图真实宽度，把视口撑到能放下整条链，避免右侧「总冠军」被裁
  let need = await ev(`(function(){
    var f=document.querySelector('#view-standing .mflow');
    var el=document.querySelector('.bracket-wrap.merged');
    if(!f||!el) return null;
    return {w: f.scrollWidth + el.getBoundingClientRect().x + 60};
  })()`);
  const WIDTH = Math.max(1800, Math.ceil(need ? need.w : 1800));
  await conn.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  let box = await ev(`(function(){
    var el=document.querySelector('.bracket-wrap.merged');
    if(!el) return null;
    var r=el.getBoundingClientRect();
    return {x:r.x, y:r.y+window.scrollY, w:Math.max(r.width, el.scrollWidth), h:Math.max(r.height, el.scrollHeight)};
  })()`);
  if (!box) throw new Error('没找到合并对阵图容器');
  await conn.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: Math.ceil(box.y + box.h + 80), deviceScaleFactor: 2, mobile: false
  });
  await sleep(600);
  await ev('window.scrollTo(0,0)');
  await sleep(400);
  box = await ev(`(function(){
    var el=document.querySelector('.bracket-wrap.merged');
    var r=el.getBoundingClientRect();
    return {x:r.x, y:r.y+window.scrollY, w:Math.max(r.width, el.scrollWidth), h:Math.max(r.height, el.scrollHeight)};
  })()`);
  const shot = await conn.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: box.w + 24, height: box.h + 30, scale: 1 }
  });
  fs.writeFileSync(path.join(OUT, 'v21_merged_zoom.png'), Buffer.from(shot.data, 'base64'));
  console.log('zoom KB', Math.round(shot.data.length / 1024), 'w', Math.round(box.w), 'h', Math.round(box.h));
  env.child.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
