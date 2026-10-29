/**
 * pdfgen.js —— 把若干张 JPG 拼成一个 PDF 文件（纯手写，零依赖）
 *
 * 用途：安卓 / 浏览器里没有 printToPDF，又不能弹系统打印面板，
 *       就用「页面渲染成 JPG → 组装成 PDF」这条路，直接落成文件。
 * 桌面端仍然走 Electron 的 printToPDF（矢量、更清晰）。
 *
 * 用法：TMS.pdf.fromJPEGs(pages) -> { bytes: Uint8Array, pages: n }
 *       pages = [{ dataURL: 'data:image/jpeg;base64,...', width, height }]
 */
(function () {
  var TMS = window.TMS = window.TMS || {};
  var P = TMS.pdf = {};

  var A4_W = 595.28, A4_H = 841.89;   // pt

  function asciiBytes(str) {
    var a = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) a[i] = str.charCodeAt(i) & 0xFF;
    return a;
  }

  function base64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function jpegBytesOf(dataURL) {
    var i = String(dataURL || '').indexOf('base64,');
    if (i < 0) throw new Error('不是 base64 图片');
    return base64ToBytes(dataURL.slice(i + 7));
  }

  function pad10(n) {
    var s = String(n);
    while (s.length < 10) s = '0' + s;
    return s;
  }

  /**
   * @param pages [{dataURL,width,height}]  每页一张图（建议已是 A4 比例）
   * @param opts  {title}
   * @return {bytes: Uint8Array, pages: Number}
   */
  P.fromJPEGs = function (pages, opts) {
    opts = opts || {};
    pages = pages || [];
    if (!pages.length) throw new Error('没有可写入的页面');

    var chunks = [];
    var size = 0;
    function push(u8) { chunks.push(u8); size += u8.length; }
    function pushStr(s) { push(asciiBytes(s)); }

    // 对象编号：1 目录、2 页树，之后每页 3 个（页 / 内容 / 图片）
    var n = pages.length;
    var objNum = function (kind, i) { return 3 + i * 3 + kind; };
    var totalObjs = 2 + n * 3;
    var offsets = new Array(totalObjs + 1).fill(0);

    function beginObj(num) {
      offsets[num] = size;
      pushStr(num + ' 0 obj\n');
    }
    function endObj() { pushStr('endobj\n'); }

    pushStr('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

    // 1: Catalog
    beginObj(1);
    pushStr('<< /Type /Catalog /Pages 2 0 R >>\n');
    endObj();

    // 2: Pages
    var kids = [];
    for (var p = 0; p < n; p++) kids.push(objNum(0, p) + ' 0 R');
    beginObj(2);
    pushStr('<< /Type /Pages /Count ' + n + ' /Kids [' + kids.join(' ') + '] >>\n');
    endObj();

    for (var i = 0; i < n; i++) {
      var pageNum = objNum(0, i);
      var contNum = objNum(1, i);
      var imgNum = objNum(2, i);
      var jpg = jpegBytesOf(pages[i].dataURL);
      var dispW = A4_W, dispH = A4_H;
      // 高度不足一页的（最后一页）按比例缩到页宽，贴顶放
      var ratio = (pages[i].height || 1) / (pages[i].width || 1);
      if (ratio < A4_H / A4_W - 0.01) {
        dispW = A4_W;
        dispH = Math.max(1, A4_W * ratio);
      }

      // 页对象
      beginObj(pageNum);
      pushStr('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + A4_W.toFixed(2) + ' ' + A4_H.toFixed(2) + '] ' +
        '/Resources << /XObject << /Im0 ' + imgNum + ' 0 R >> >> ' +
        '/Contents ' + contNum + ' 0 R >>\n');
      endObj();

      // 内容流：把图按页宽铺满
      var content = 'q\n' + dispW.toFixed(2) + ' 0 0 ' + dispH.toFixed(2) + ' 0 ' + (A4_H - dispH).toFixed(2) + ' cm\n/Im0 Do\nQ\n';
      var cBytes = asciiBytes(content);
      beginObj(contNum);
      pushStr('<< /Length ' + cBytes.length + ' >>\nstream\n');
      push(cBytes);
      pushStr('endstream\n');
      endObj();

      // 图片对象（DCTDecode 直接塞 JPEG 字节）
      beginObj(imgNum);
      pushStr('<< /Type /XObject /Subtype /Image /Width ' + (pages[i].width || 1) +
        ' /Height ' + (pages[i].height || 1) + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 ' +
        '/Filter /DCTDecode /Length ' + jpg.length + ' >>\nstream\n');
      push(jpg);
      pushStr('\nendstream\n');
      endObj();
    }

    // 交叉引用表
    var xrefStart = size;
    pushStr('xref\n0 ' + (totalObjs + 1) + '\n');
    pushStr('0000000000 65535 f \n');
    for (var k = 1; k <= totalObjs; k++) pushStr(pad10(offsets[k]) + ' 00000 n \n');
    pushStr('trailer\n<< /Size ' + (totalObjs + 1) + ' /Root 1 0 R >>\n');
    pushStr('startxref\n' + xrefStart + '\n%%EOF\n');

    var out = new Uint8Array(size);
    var at = 0;
    for (var c = 0; c < chunks.length; c++) { out.set(chunks[c], at); at += chunks[c].length; }
    return { bytes: out, pages: n };
  };

  /* Uint8Array → base64（分块，避免大文件爆栈） */
  P.bytesToBase64 = function (u8) {
    var CH = 0x8000, out = [];
    for (var i = 0; i < u8.length; i += CH) {
      out.push(String.fromCharCode.apply(null, u8.subarray(i, i + CH)));
    }
    return btoa(out.join(''));
  };
})();
