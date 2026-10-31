/**
 * 一键跑测试
 *   node tools/run_tests.js           核心引擎 / 纯逻辑（tools/test_*.js，纯 Node，秒级）
 *   node tools/run_tests.js --smoke   追加界面冒烟（tools/smoke_*.js，需要能起无头 Edge）
 *   node tools/run_tests.js --all     = 上面两个都跑
 *
 * 注意：沙箱环境下无头浏览器起不来（Chromium 需要命名管道，会被拒），
 *       冒烟套件会报「窗口未就绪」。这不是代码问题，换一个不受限的终端再跑即可。
 *
 * 子进程用 stdio:'inherit'，不抢管道 —— 受限环境里 piped stdio 会被拒绝。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SELF = __filename;
const toolsDir = __dirname;

function list(prefix) {
  return fs.readdirSync(toolsDir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.js') && path.join(toolsDir, f) !== SELF)
    .sort();
}

function run(files, label) {
  const failed = [];
  console.log('\n===== ' + label + '（' + files.length + ' 套）=====');
  files.forEach((f, i) => {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [path.join(toolsDir, f)], { stdio: 'inherit' });
    const ms = Date.now() - t0;
    const ok = r.status === 0;
    console.log((ok ? '  ✔ ' : '  ✘ ') + f + '  (' + ms + 'ms)');
    if (!ok) failed.push(f);
    // 每套都打分隔线，长输出里也能看清边界
    console.log('  ── ' + (i + 1) + '/' + files.length + ' ──');
  });
  return failed;
}

const argv = process.argv.slice(2);
const wantSmoke = argv.indexOf('--smoke') >= 0 || argv.indexOf('--all') >= 0;
const wantCore = argv.indexOf('--smoke') < 0;

let failed = [];
if (wantCore) failed = failed.concat(run(list('test_'), '核心逻辑测试'));
if (wantSmoke) failed = failed.concat(run(list('smoke_'), '界面冒烟'));

console.log('\n========================================');
if (failed.length) {
  console.log('失败 ' + failed.length + ' 套：');
  failed.forEach(f => console.log('  - ' + f));
  process.exit(1);
} else {
  console.log('全部通过');
}
