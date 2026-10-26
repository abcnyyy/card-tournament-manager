/**
 * 视觉验收截图（零窗口）
 *   node tools/shot.js matches 1440 1000        # 单个视图
 *   node tools/shot.js setup,matches,standing   # 多个视图
 *   node tools/shot.js matches 390 844 mobile   # 手机档
 * 输出：tools/smoke_out/ui_<视图>[_mobile].png
 */
const path = require('path'), fs = require('fs');
const { launch, connect } = require('./headless');

const PORT = 9431;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = path.join(__dirname, 'smoke_out');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

const views = (process.argv[2] || 'setup').split(',').map(s => s.trim()).filter(Boolean);
const W = parseInt(process.argv[3], 10) || 1440;
const H = parseInt(process.argv[4], 10) || 1000;
const mobile = process.argv[5] === 'mobile';
const SCENE_FILE = process.argv[6] || 'build_demo_scene.js';
const EXTRA = process.argv[7] || '';
const SCENE = fs.readFileSync(path.join(__dirname, SCENE_FILE), 'utf8');

(async () => {
  const env = await launch(PORT, path.join(__dirname, '..', 'app'));
  const conn = await connect(PORT);
  await conn.send('Runtime.enable');
  await conn.send('Page.enable');
  const ev = async expr => {
    const r = await conn.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error(JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    }
    return r.result.value;
  };

  await conn.send('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: mobile ? 2 : 1, mobile: !!mobile
  });
  await sleep(400);
  // 等脚本全部就绪，避免 core.js 已加载、engine.js 还没到时注入场景
  for (let i = 0; i < 80; i++) {
    const ok = await ev(`(document.readyState==='complete') && typeof TMS==='object' && !!TMS.engine && !!TMS.exporter`);
    if (ok === true) break;
    await sleep(150);
  }
  await ev(SCENE);
  await sleep(200);
  await ev('location.reload()');
  await sleep(1800);
  for (let i = 0; i < 60; i++) {
    const ok = await ev(`(document.readyState==='complete') && typeof TMS==='object' && !!TMS.engine`);
    if (ok === true) break;
    await sleep(150);
  }

  const errors = [];
  conn.send('Log.enable').catch(() => {});

  for (const v of views) {
    await ev(`(function(){var b=document.querySelector('.tab[data-view="${v}"]'); if(b) b.click(); return !!b})()`);
    await sleep(650);
    if (EXTRA) { await ev(EXTRA); await sleep(600); }
    const err = await ev(`(function(){
      var out=[];
      if(!document.querySelector('#view-${v}')) out.push('缺视图容器');
      if(document.body.scrollWidth > window.innerWidth+2) out.push('横向溢出 '+document.body.scrollWidth+'>'+window.innerWidth);
      var el=document.querySelector('#view-${v}');
      if(el && !el.innerText.trim()) out.push('内容为空');
      return out;
    })()`);
    if (err && err.length) errors.push(v + ': ' + err.join(' / '));
    const shot = await conn.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const name = 'ui_' + v + (mobile ? '_mobile' : '') + '.png';
    fs.writeFileSync(path.join(OUT, name), Buffer.from(shot.data, 'base64'));
    console.log('saved', name);
  }

  if (errors.length) { console.log('WARN:', errors.join(' | ')); }
  conn.close();
  env.child.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
