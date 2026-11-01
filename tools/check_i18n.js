/**
 * 英文版漏翻检查（英文模式扫全部页面，一条中文都不该剩）
 *
 *   node tools/check_i18n.js          # 有残留就 exit 1（当冒烟 / CI 用）
 *   node tools/check_i18n.js --list   # 顺便把残留逐条打出来
 *
 * 真正的扫描逻辑在 tools/extract_i18n.js（无头浏览器跑真实界面）：
 *   阶段 1（--zh）收「中文原句」清单，跟词典做差集，补词条用；
 *   阶段 2（--check）在英文模式下扫，验证零残留。
 * 这个文件只是给 npm script 一个语义清楚的名字。
 */
const { spawnSync } = require('child_process');
const path = require('path');

const args = [path.join(__dirname, 'extract_i18n.js'), '--check'];
const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
