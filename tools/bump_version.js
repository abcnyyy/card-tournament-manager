/* 版本号统一升级脚本（UTF-8 安全，避免 PowerShell 默认编码把中文写坏）
   用法：node tools/bump_version.js 3.0
   会改：package.json / app/index.html / android/app/build.gradle
   另外提示需要手工改的两处文档标题（使用说明 中英）。 */
const fs = require('fs');
const path = require('path');

const arg = process.argv[2];
if (!arg || !/^\d+\.\d+$/.test(arg)) {
  console.error('用法: node tools/bump_version.js <主.次>   例：node tools/bump_version.js 3.0');
  process.exit(1);
}
const root = path.join(__dirname, '..');
const parts = arg.split('.');
const semver = parts[0] + '.' + parts[1] + '.0';          // package.json 用三段
const code = (parseInt(parts[0], 10) * 10) + parseInt(parts[1], 10);  // versionCode：3.0 -> 30

function rw(rel, fn) {
  const p = path.join(root, rel);
  const before = fs.readFileSync(p, 'utf8');
  const after = fn(before);
  if (after === before) { console.log('  - ' + rel + '（没变化，检查匹配）'); return; }
  fs.writeFileSync(p, after, 'utf8');
  console.log('  ✔ ' + rel);
}

rw('package.json', t => t.replace(/"version":\s*"[^"]+"/, '"version": "' + semver + '"'));
rw('app/index.html', t => t.replace(/id="sideFoot">v[\d.]+</, 'id="sideFoot">v' + arg + '<'));
rw('android/app/build.gradle', t => t
  .replace(/versionCode\s+\d+/, 'versionCode ' + code)
  .replace(/versionName\s+"[^"]+"/, 'versionName "' + arg + '"'));

console.log('\n记得手工同步文档标题：');
console.log('  使用说明.md      # 卡牌赛事编排 · 使用说明（v' + arg + '）');
console.log('  使用说明.en.md   # Card Tournament Manager · User Manual (v' + arg + ')');
console.log('  然后 python tools/md2html.py 使用说明.md 使用说明.html');
console.log('       python tools/md2html.py 使用说明.en.md 使用说明.en.html');
console.log('  README 的下载链接与文件名（card-tournament-manager-' + semver + '-*.exe/apk）也要改。');
