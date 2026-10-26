/**
 * 打印样式验收：把「排名 + 本轮对阵」塞进打印区，用无头浏览器输出 PDF
 *   node tools/print_check.js
 * 输出：tools/smoke_out/print_standings.pdf
 */
const path = require('path'), fs = require('fs');
const { launch, connect } = require('./headless');
const PORT = 9433;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = path.join(__dirname, 'smoke_out');

(async () => {
  const env = await launch(PORT, path.join(__dirname, '..', 'app'));
  const conn = await connect(PORT);
  await conn.send('Runtime.enable');
  const ev = async expr => {
    const r = await conn.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  for (let i = 0; i < 60; i++) {
    const ok = await ev(`(document.readyState==='complete') && typeof TMS==='object' && !!TMS.engine && !!TMS.exporter`);
    if (ok === true) break;
    await sleep(150);
  }
  await ev(fs.readFileSync(path.join(__dirname, 'build_demo_scene.js'), 'utf8'));
  await ev('location.reload()');
  await sleep(1800);
  for (let i = 0; i < 60; i++) {
    const ok = await ev(`(document.readyState==='complete') && typeof TMS==='object' && !!TMS.engine && !!TMS.exporter`);
    if (ok === true) break;
    await sleep(150);
  }

  const info = await ev(`(function(){
    var X=TMS.exporter, T=TMS.current;
    var pa=document.getElementById('printArea');
    if(!pa){ pa=document.createElement('div'); pa.id='printArea'; document.body.appendChild(pa); }
    pa.innerHTML = X.standingsHTML(T,{stageIndex:0}) + X.matchupsHTML(T,{stageIndex:0});
    document.body.classList.add('printing');
    return {len: pa.innerHTML.length, rows: pa.querySelectorAll('tbody tr').length};
  })()`);
  await sleep(500);
  // 用「模拟打印媒体」截图，等价于打印预览（比 PDF 更好目检）
  await conn.send('Emulation.setDeviceMetricsOverride', {
    width: 794, height: 1123, deviceScaleFactor: 1, mobile: false
  });
  await conn.send('Emulation.setEmulatedMedia', { media: 'print' });
  await sleep(600);
  const png = await conn.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(OUT, 'print_preview.png'), Buffer.from(png.data, 'base64'));

  const pdf = await conn.send('Page.printToPDF', {
    printBackground: false, paperWidth: 8.27, paperHeight: 11.69,
    marginTop: 0.4, marginBottom: 0.4, marginLeft: 0.4, marginRight: 0.4
  });
  fs.writeFileSync(path.join(OUT, 'print_standings.pdf'), Buffer.from(pdf.data, 'base64'));
  console.log('printed', info, '→ tools/smoke_out/print_standings.pdf');
  conn.close();
  env.child.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
