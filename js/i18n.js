/**
 * i18n.js —— 中英双语
 *
 * 为什么做成「渲染后按文本查表」而不是把每一条文案都抽成 key：
 *   这个项目的界面是「字符串拼 HTML」的全量重绘（ui.js 里上千条中文串，
 *   还有大量 '第 ' + n + ' 轮' 这种拼接），逐条抽 key 要改几千行，风险极高。
 *   这里改成：渲染完成后扫一遍 DOM，把「一句话」翻成英文再写回去。
 *
 * ★ 关键点：一句话常常被标签拆成好几段
 *     第 <b>1</b> 轮  →  文本节点 "第 " + <b>1</b> + 文本节点 " 轮"
 *   逐节点查表永远翻不了。所以先把「连续的行内内容」拼成一句（run），
 *   只有整句能在字典/规则里命中时才替换（命中就并成一个文本节点，
 *   顺带丢掉这句里的 <b> 之类行内标签 —— 英文语序下这些加粗本来就是中文断句的产物）。
 *
 * 用法：
 *   I18n.lang                    当前语言 'zh' | 'en'
 *   I18n.t('保存')               整串翻译（提示 / toast / CSV 单元格 / 导出字符串）
 *   I18n.apply(el)               翻译一棵子树（render 后、modal 打开后、导出前调用）
 *   I18n.set('en')               切换语言（写 localStorage，调用方负责刷新）
 *   I18n._collectUntranslated(el) 扫描漏翻（tools/extract_i18n.js 用）
 *
 * 字典在 i18n.en.js（I18n.dict / I18n.rules）。这个文件只放机制。
 */
(function (global) {
  'use strict';

  var KEY = 'tms_lang';
  var I = global.I18n = global.I18n || {};

  I.SUPPORTED = ['zh', 'en'];
  I.dict = I.dict || {};      // 中文原文 -> 英文
  I.rules = I.rules || [];    // [[正则, 替换函数], ...]

  function readLang() {
    try {
      var v = global.localStorage && global.localStorage.getItem(KEY);
      if (v && I.SUPPORTED.indexOf(v) >= 0) return v;
    } catch (e) { /* localStorage 不可用：按中文 */ }
    // 没选过语言一律先给中文：老用户看到的界面永远不变，
    // 英文用户点一次顶栏的 EN 即可（选择会记住）。不做 navigator.language 自动判断 ——
    // 那会让无头浏览器（en-US）跑中式断言全部翻车，也让老用户升级后界面突然变英文。
    return '';
  }

  I.lang = readLang() || 'zh';
  I.isEn = function () { return I.lang === 'en'; };
  I.otherLabel = function () { return I.isEn() ? '中文' : 'EN'; };

  I.set = function (lang) {
    if (I.SUPPORTED.indexOf(lang) < 0) lang = 'zh';
    I.lang = lang;
    try { global.localStorage && global.localStorage.setItem(KEY, lang); } catch (e) {}
    try { document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'zh-CN'); } catch (e) {}
    return I.lang;
  };

  var CJK = /[\u4e00-\u9fff]/;

  /* 查一条：命中字典返回英文，否则 null */
  function dictHit(s) {
    return Object.prototype.hasOwnProperty.call(I.dict, s) ? I.dict[s] : null;
  }

  /* 整串翻译（含规则）：没有对应就原样返回 */
  I.t = function (text) {
    var s = (text === undefined || text === null) ? '' : String(text);
    if (!I.isEn() || !s) return s;
    var hit = dictHit(s);
    if (hit !== null) return hit;
    var trimmed = s.trim();
    if (!trimmed) return s;
    if (trimmed !== s) {
      var inner = dictHit(trimmed);
      if (inner !== null) return s.replace(trimmed, inner);
    }
    for (var i = 0; i < I.rules.length; i++) {
      var r = I.rules[i][0], fn = I.rules[i][1];
      if (r.test(trimmed)) return s.replace(trimmed, applyRule(trimmed, r, fn));
    }
    return s;
  };

  /* 规则替换：回调 fn 收到的是「匹配结果数组」（fn(m) 里 m[1] 就是第一个分组）。
     注意不能直接把 fn 交给 String.replace —— 那样第一个参数是整个匹配串（字符串），
     fn(m) 里的 m[1] 会取到「第二个字符」，翻译结果就会丢数字 / 串成乱码（踩过）。 */
  function applyRule(s, r, fn) {
    return s.replace(r, function () { return fn(arguments); });
  }

  /* 术语级替换：整句翻完还剩中文时（例如句子里嵌了阶段名「双败淘汰」），
     再按词表把残留的专有名词换掉。词表按长度倒序，避免短词先吃掉长词。
     只用于「句子里已经没法整句匹配」的兜底，正常句子走字典 / 规则。 */
  I.terms = I.terms || [];
  var termSorted = null;
  function termPass(s) {
    if (!termSorted) {
      termSorted = I.terms.slice().sort(function (a, b) { return b[0].length - a[0].length; });
    }
    var out = s;
    for (var i = 0; i < termSorted.length; i++) {
      var zh = termSorted[i][0], en = termSorted[i][1];
      if (out.indexOf(zh) >= 0) out = out.split(zh).join(en);
    }
    return out;
  }

  /* 只翻译「整句都能命中」的情况（给 run 用，避免半句被误翻） */
  function translateWhole(s) {
    var hit = dictHit(s);
    if (hit !== null) return hit;
    for (var i = 0; i < I.rules.length; i++) {
      var r = I.rules[i][0], fn = I.rules[i][1];
      if (r.test(s)) return applyRule(s, r, fn);
    }
    // 整句没命中：只有当词表能把它整句里的中文都吃掉时才返回（否则留原样，等补词条）
    var t2 = termPass(s);
    if (t2 !== s && !CJK.test(t2)) return t2;
    return null;
  }

  // 行内元素：这些标签里的文字算「同一句」的一部分
  var INLINE = {
    B: 1, STRONG: 1, EM: 1, I: 1, U: 1, S: 1, SMALL: 1, SPAN: 1, A: 1, CODE: 1,
    SUB: 1, SUP: 1, FONT: 1, MARK: 1, ABBR: 1, LABEL: 1
  };
  // 这些元素里的内容完全不碰
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, TEXT: 1 };
  var ATTRS = ['placeholder', 'title', 'alt', 'aria-label'];

  function isInline(el) {
    return !!(el && el.nodeType === 1 && INLINE[String(el.tagName).toUpperCase()]);
  }
  function isSkipped(el) {
    return !!(el && el.nodeType === 1 && SKIP[String(el.tagName).toUpperCase()]);
  }

  /* 把一个容器的子节点切成「行内 run」：
       run = 连续的文本节点 / 行内元素（遇到块级元素就断开） */
  function runsOf(container) {
    var out = [], cur = null;
    var kids = container.childNodes || [];
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      var isTxt = (n.nodeType === 3);
      var isInl = isInline(n);
      if (isTxt || isInl) {
        if (isInl && isSkipped(n)) { cur = null; continue; }
        if (!cur) { cur = []; out.push(cur); }
        cur.push(n);
      } else if (n.nodeType === 1) {
        cur = null;              // 块级元素：断开
      }
    }
    return out;
  }

  function hasNestedEl(run) {
    for (var i = 0; i < run.length; i++) {
      if (run[i].nodeType === 1 && CJK.test(run[i].textContent || '')) return true;
    }
    return false;
  }

  function runText(run) {
    var s = '';
    for (var i = 0; i < run.length; i++) s += run[i].textContent;
    return s;
  }

  /* 翻译一个容器里的所有 run；返回是否有改动 */
  function translateRuns(container) {
    var changed = false;
    var runs = runsOf(container);
    for (var r = 0; r < runs.length; r++) {
      var run = runs[r];
      var text = runText(run);
      if (!text || !CJK.test(text)) continue;
      // 一行里塞了好几个元素的（逐局 chips、卡片里的多列信息）只允许「整句精确命中词典」，
      // 否则会拼成「G1 A 胜 X G2 A 胜 Y」这种没法翻的长串 —— 那种留给子节点各自翻。
      // 说明文字里夹两个 <b> 的长句也走这条：整句在词典里就整句换掉，不在就落到子节点。
      var elKids = 0;
      for (var q = 0; q < run.length; q++) if (run[q].nodeType === 1) elKids++;
      // 已经半边翻成英文的（父层自己没命中，子层先被翻过了）不要整体合并，

      // 改成逐个文本节点翻，保住已经翻好的子节点
      var mixed = /[A-Za-z]{3,}/.test(text) && CJK.test(text);
      if (mixed) {
        for (var w = 0; w < run.length; w++) {
          if (run[w].nodeType === 3 && CJK.test(run[w].nodeValue)) run[w].nodeValue = I.t(run[w].nodeValue);
        }
        continue;
      }
      // 整句翻译只接受「翻完整段都不剩中文」的结果：多元素拼出来的行（逐局 chips 之类）
      // 一旦剩下中文就说明是硬拼的，宁可退回逐节点翻，也不要搞出半英半中
      var en = translateWhole(text);
      if (en !== null && elKids > 1 && CJK.test(en)) en = null;
      if (en === null) {
        // 整句没命中：退一步，把这一串里的**文本节点**逐个翻（每块仍要精确命中才换），
        // 这样「<b>已经翻好的那块</b>：后面这句还没收录」不会把整行卡死在中文
        for (var w2 = 0; w2 < run.length; w2++) {
          if (run[w2].nodeType === 3 && CJK.test(run[w2].nodeValue)) run[w2].nodeValue = I.t(run[w2].nodeValue);
        }
        continue;
      }
      var first = run[0];
      // 用「翻译后的整句」替换这一串；原本这里可能夹着 <b>/<span>，一并去掉
      try {
        first.parentNode.replaceChild(document.createTextNode(en), first);
      } catch (e) { continue; }
      for (var k = 1; k < run.length; k++) {
        try { if (run[k].parentNode) run[k].parentNode.removeChild(run[k]); } catch (e2) {}
      }
      changed = true;
    }
    return changed;
  }

  function translateAttrs(el) {
    for (var a = 0; a < ATTRS.length; a++) {
      var at = ATTRS[a];
      if (el.hasAttribute && el.hasAttribute(at)) {
        var av = el.getAttribute(at);
        if (av && CJK.test(av)) {
          var nv = I.t(av);
          if (nv !== av) el.setAttribute(at, nv);
        }
      }
    }
  }

  function walk(el) {
    if (!el || el.nodeType !== 1) return;
    if (isSkipped(el)) return;
    // 先翻这一层、再翻子层（pre-order）：
    //   整句能命中词典/规则时，连 <b> 一起并成一句英文，子节点就不用再管；
    //   整句命中不了（例如卡片里「3 胜 0 负 0 平9 分第 1 名」这种拼接），
    //   再让子层各自翻 —— 反过来的话，子层先翻成英文，父层拼出来就成了「第 1 轮Recorded」这种半英半中。
    translateAttrs(el);
    translateRuns(el);
    var kids = [].slice.call(el.childNodes || []);
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].nodeType === 1) walk(kids[i]);
    }
  }

  I.apply = function (root) {
    if (!I.isEn()) return;
    walk(root || document.body);
  };

  I.boot = function () {
    // 侧栏「赛事」小标题是 CSS 伪元素，JS 改不到，用自定义属性把译文塞进去
    try {
      document.documentElement.style.setProperty('--tabs-label', JSON.stringify(I.isEn() ? 'Events' : '赛事'));
    } catch (e) {}
    try { document.documentElement.setAttribute('lang', I.isEn() ? 'en' : 'zh-CN'); } catch (e) {}
    if (I.isEn()) {
      try { document.title = I.t(document.title); } catch (e) {}
    }
  };

  /* ---------- 扫描工具 ---------- */
  /* 收集「没被翻译的中文整句」：与 apply 同样的切 run 逻辑，只读不改 */
  I._collectUntranslated = function (root) {
    var out = {};
    function add(s) {
      s = String(s || '').trim();
      if (!s || !CJK.test(s)) return;
      // 英文模式下跳过「已经能翻译」的；中文模式（tools/extract_i18n.js --zh）下全收，
      // 只要原文清单，用来和词典做差集、补漏掉的词条
      if (I.lang === 'en' && translateWhole(s) !== null) return;
      out[s] = (out[s] || 0) + 1;
    }
    function walk2(el) {
      if (!el || el.nodeType !== 1) return;
      if (isSkipped(el)) return;
      // 与 apply 一致：先子后父，这样收集到的就是「翻译后仍剩下的」真正漏翻内容
      var kids = [].slice.call(el.childNodes || []);
      for (var i = 0; i < kids.length; i++) {
        if (kids[i].nodeType === 1) walk2(kids[i]);
      }
      for (var a = 0; a < ATTRS.length; a++) {
        if (el.hasAttribute && el.hasAttribute(ATTRS[a])) add(el.getAttribute(ATTRS[a]));
      }
      var runs = runsOf(el);
      for (var r = 0; r < runs.length; r++) {
        var run = runs[r];
        // 英文模式：只报「最深一层」的短语（父层拼出来的长句是噪音）；
        // 中文模式（--zh）：父层也要报 —— 长句里往往夹着 <b>，「开启后参赛单位变成<队伍>（…）」
        // 这种句子只能作为整句进词典，跳过父层就永远收不到它
        var txt = runText(run);
        var mixedTxt = /[A-Za-z]{3,}/.test(txt);
        if (I.lang === 'en' && (mixedTxt || run.length > 1 && hasNestedEl(run))) {
          for (var k = 0; k < run.length; k++) {
            if (run[k].nodeType === 3) add(run[k].nodeValue);
          }
          continue;
        }
        add(txt);
      }
    }
    walk2(root || document.body);
    return out;
  };
})(window);
