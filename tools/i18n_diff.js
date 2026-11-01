/* 把「界面原文清单」和「现有词典」做差集：缺词条的才是要翻的 */
const fs = require('fs'), vm = require('vm');
const sb = { window: {}, console, localStorage: null, document: { documentElement: { setAttribute() {} } } };
sb.window = sb;
vm.createContext(sb);
vm.runInContext(fs.readFileSync('app/js/i18n.js', 'utf8'), sb);
vm.runInContext(fs.readFileSync('app/js/i18n.en.js', 'utf8'), sb);
const I = sb.I18n; I.set('en');

const scan = JSON.parse(fs.readFileSync('tools/i18n_scan.json', 'utf8'));
const todo = scan.filter(x => {
  const s = String(x.zh || '').trim();
  if (!s) return false;
  return I.t(s) === s;               // 翻译后没变 = 缺词条
});
fs.writeFileSync('tools/_i18n_todo.json', JSON.stringify(todo, null, 1), 'utf8');

const groups = {};
todo.forEach(x => { (groups[x.where] = groups[x.where] || []).push(x.zh); });
let out = [];
Object.keys(groups).sort().forEach(w => {
  out.push('### ' + w + ' (' + groups[w].length + ')');
  groups[w].sort((a, b) => a.length - b.length).forEach(s => out.push(s));
});
fs.writeFileSync('tools/_i18n_todo.txt', out.join('\n'), 'utf8');
console.log('原文条目', scan.length, '· 缺词条', todo.length, '· 场景', Object.keys(groups).length);
console.log('词典条数', Object.keys(I.dict).length, '· 规则', I.rules.length, '· 术语', I.terms.length);
console.log('规则命中抽查:',
  ['已有赛季（3）', '第 5 轮已录完', '剩 4 人 · 2 场', '胜者：张三'].map(s => s + ' => ' + I.t(s)).join(' | '));
