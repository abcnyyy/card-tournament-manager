/**
 * 打包产物复验（零窗口，全程不开关任何可见窗口）
 *
 *  1. 从 dist/win-unpacked/resources/app.asar 解包到 tools/_asar/app
 *  2. 在 tools/_asar_run 里搭一个「影子工作区」：
 *       tools/_asar_run/app     → 指向解包产物的 junction（不复制文件）
 *       tools/_asar_run/tools   → tools 下所有测试脚本的副本
 *     这样测试脚本里的 ROOT = __dirname/.. 自然指向解包出来的那一份 app
 *  3. 在影子工作区里跑指定的关键套件
 *
 *  用法：
 *     node tools/verify_pack.js                              // 默认跑关键套件
 *     node tools/verify_pack.js test_v21.js smoke_v21.js     // 只跑指定套件
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'tools', '_asar');
const EXTAPP = path.join(EXT, 'app');
const RUN = path.join(ROOT, 'tools', '_asar_run');
const RUN_TOOLS = path.join(RUN, 'tools');
const RUN_APP = path.join(RUN, 'app');
const ASAR = path.join(ROOT, 'dist', 'win-unpacked', 'resources', 'app.asar');

const SUITES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['test_v21.js', 'smoke_v21.js', 'test_engine.js', 'test_bracket.js',
    'test_v18.js', 'test_v20.js', 'smoke_v18.js', 'smoke_v20.js'];

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

if (!fs.existsSync(ASAR)) { console.error('找不到 ' + ASAR + '，请先打包'); process.exit(1); }

/* 1. 解包 */
ensureDir(EXT);
const ex = spawnSync(process.execPath,
  [path.join(ROOT, 'node_modules', '@electron', 'asar', 'bin', 'asar.js'), 'extract', ASAR, EXT],
  { encoding: 'utf8' });
if (!fs.existsSync(path.join(EXTAPP, 'js', 'engine.js'))) {
  console.error('解包失败：' + (ex.stderr || ex.stdout || '')); process.exit(1);
}
console.log('解包 OK → tools/_asar/app');
console.log('  app/js :', fs.readdirSync(path.join(EXTAPP, 'js')).join(' '));
console.log('  package:', JSON.parse(fs.readFileSync(path.join(EXT, 'package.json'), 'utf8')).version, '\n');

/* 2. 搭影子工作区 */
ensureDir(RUN);
ensureDir(RUN_TOOLS);
for (const f of fs.readdirSync(path.join(ROOT, 'tools'))) {
  if (!/\.(js)$/.test(f)) continue;
  fs.copyFileSync(path.join(ROOT, 'tools', f), path.join(RUN_TOOLS, f));
}
if (!fs.existsSync(RUN_APP)) {
  try { fs.symlinkSync(EXTAPP, RUN_APP, 'junction'); }
  catch (e) { fs.cpSync(EXTAPP, RUN_APP, { recursive: true }); }
}

/* 3. 跑套件 */
let bad = 0;
for (const s of SUITES) {
  const f = path.join(RUN_TOOLS, s);
  if (!fs.existsSync(f)) { console.log(' -   ' + s + '（不存在，跳过）'); continue; }
  const r = spawnSync(process.execPath, [f], { encoding: 'utf8', cwd: RUN, timeout: 240000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const line = (out.split('\n').filter(l => /通过|PASS:|FAIL|失败/.test(l)).pop() || '(无摘要)').trim();
  const good = (r.status === 0) && !/FAIL [1-9]/.test(line);
  if (!good) bad++;
  console.log((good ? ' ✔ ' : ' ✘ ') + s.padEnd(18) + line);
  if (!good) {
    console.log(out.split('\n').filter(l => /FAIL|Error/.test(l)).slice(0, 12).map(l => '     ' + l).join('\n'));
  }
}

console.log('\n=== ' + (bad ? bad + ' 个套件失败' : '全部通过（基于 app.asar 解包产物）') + ' ===');
process.exit(bad ? 1 : 0);
