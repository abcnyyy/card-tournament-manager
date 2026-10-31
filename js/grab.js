/**
 * grab.js —— 把一段 HTML 渲染成一张 JPG（整张长图），或按 A4 切片成多页
 *
 * 纯离线、零依赖：把 HTML 塞进 SVG 的 foreignObject → Image → Canvas → JPEG。
 * 桌面（Electron）和安卓（WebView）都是 Chromium 内核，同一套代码。
 * 项目里没有外链图片，所以不会污染 canvas。
 *
 * 用法：
 *   TMS.grab.jpegFromHTML(html, {width:1180}).then(function (r) {
 *     // r = { dataURL, width, height, scale }
 *   });
 *   TMS.grab.jpgPagesFromHTML(html, {width:1180}).then(function (pages) {
 *     // pages = [{ dataURL, width, height }]  // 每页正好 A4 比例
 *   });
 */
(function () {
  var TMS = window.TMS = window.TMS || {};
  var G = TMS.grab = {};

  var MAX_SIDE = 16000;   // Chromium canvas 单边上限约 16k，留点余量
  var MAX_AREA = 4000 * 4000;  // 总像素上限：16000×16000 会吃掉 1GB 显存/内存，手机必然崩

  /* 收集当前页面所有样式表（同源，读得到 cssRules） */
  function styleText() {
    var out = [];
    var sheets = document.styleSheets || [];
    for (var i = 0; i < sheets.length; i++) {
      var sh = sheets[i];
      var rules = null;
      try { rules = sh.cssRules || sh.rules; } catch (e) { rules = null; }
      if (!rules) continue;
      for (var j = 0; j < rules.length; j++) out.push(rules[j].cssText);
    }
    return out.join('\n');
  }

  /* 把 HTML 摆到屏幕外量尺寸，返回 {html, width, height}
     shrink = true 时宽度按内容自适应（不超过 width），对阵图这类窄内容不会留一大片空白 */
  function measure(html, width, shrink) {
    var stage = document.createElement('div');
    stage.setAttribute('data-grab-stage', '1');
    stage.style.cssText = 'position:fixed;left:-40000px;top:0;z-index:-1;' +
      (shrink ? ('width:max-content;max-width:' + width + 'px;') : ('width:' + width + 'px;')) +
      'background:#fff;padding:18px 20px;box-sizing:border-box;' +
      'font-family:' + (getComputedStyle(document.body).fontFamily || 'sans-serif');
    stage.innerHTML = html;
    document.body.appendChild(stage);
    void stage.offsetHeight;               // 强制布局
    var w = Math.max(1, Math.ceil(stage.scrollWidth));
    if (shrink) w = Math.min(w, width);
    var h = Math.max(1, Math.ceil(stage.scrollHeight));
    var inner = stage.innerHTML;
    document.body.removeChild(stage);
    return { html: inner, width: w, height: h };
  }

  /* 生成可被 Image 加载的 SVG data URL */
  function buildSVG(pack) {
    var css = styleText();
    var wrap = document.createElement('div');
    wrap.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    wrap.setAttribute('style', 'width:' + pack.width + 'px;box-sizing:border-box;' +
      'padding:18px 20px;background:#ffffff;');
    // 用 DOM 建 <style> 并写 textContent —— 不能拼字符串：HTML 解析会把 <![CDATA[ 当正文，
    // 导致整张样式表解析失败（导出的图就完全没样式）。交给 XMLSerializer 转义才安全。
    var st = document.createElement('style');
    st.setAttribute('type', 'text/css');
    st.textContent = css;
    wrap.appendChild(st);
    var box = document.createElement('div');
    box.innerHTML = pack.html;
    while (box.firstChild) wrap.appendChild(box.firstChild);
    // XMLSerializer 会把 <br> 之类的空元素自动写成自闭合，保证 XML 合法
    var body = new XMLSerializer().serializeToString(wrap);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + pack.width + '" height="' + pack.height + '">' +
      '<foreignObject x="0" y="0" width="' + pack.width + '" height="' + pack.height + '">' +
      body + '</foreignObject></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function loadImage(url) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error('图片渲染失败（内容过大或含不支持的样式）')); };
      img.src = url;
    });
  }

  /* 主画布：整张长图 */
  function renderCanvas(html, opts) {
    opts = opts || {};
    var width = opts.width || 1180;
    var scale = opts.scale || 2;
    var pack = measure(html, width, !!opts.shrink);
    // 太高就降采样，别撞 canvas 上限。
    // v2.6.1：以前写成 Math.max(0.5, …)，把下限钉死在 0.5 —— 内容高 4 万 px 时
    // 画布还是 2 万 px（超 16384 上限），Chromium 会静默给一张空白图。
    // 现在按「单边」和「总像素」两个上限一起压，允许低于 0.5（宁可糊一点也不能空白）。
    var bySide = Math.min(MAX_SIDE / pack.height, MAX_SIDE / pack.width);
    var byArea = Math.sqrt(MAX_AREA / Math.max(1, pack.width * pack.height));
    scale = Math.min(scale, bySide, byArea);
    scale = Math.max(0.05, scale);
    return loadImage(buildSVG(pack)).then(function (img) {
      var cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.ceil(pack.width * scale));
      cv.height = Math.max(1, Math.ceil(pack.height * scale));
      var ctx = cv.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      return { canvas: cv, width: pack.width, height: pack.height, scale: scale };
    });
  }

  /**
   * 一整张 JPG（长图）
   * @return Promise<{dataURL, width, height, scale}>
   */
  G.jpegFromHTML = function (html, opts) {
    return renderCanvas(html, opts).then(function (r) {
      return {
        dataURL: r.canvas.toDataURL('image/jpeg', (opts && opts.quality) || 0.92),
        width: r.canvas.width, height: r.canvas.height, scale: r.scale
      };
    });
  };

  /**
   * 按 A4 竖版比例切片（每页一张 JPG），用于在没有打印服务的环境下生成 PDF
   * @return Promise<[{dataURL, width, height}]>
   */
  G.jpgPagesFromHTML = function (html, opts) {
    opts = opts || {};
    return renderCanvas(html, opts).then(function (r) {
      var cv = r.canvas;
      var pageH = Math.max(1, Math.round(cv.width * 297 / 210));   // A4 比例
      var pages = [];
      if (cv.height <= pageH * 1.02) {
        pages.push({ dataURL: cv.toDataURL('image/jpeg', 0.92), width: cv.width, height: cv.height });
      } else {
        for (var y = 0; y < cv.height; y += pageH) {
          var h = Math.min(pageH, cv.height - y);
          var one = document.createElement('canvas');
          one.width = cv.width;
          one.height = h;
          var c2 = one.getContext('2d');
          c2.fillStyle = '#ffffff';
          c2.fillRect(0, 0, one.width, one.height);
          c2.drawImage(cv, 0, y, cv.width, h, 0, 0, cv.width, h);
          pages.push({ dataURL: one.toDataURL('image/jpeg', 0.92), width: one.width, height: one.height });
        }
      }
      return pages;
    });
  };
})();
