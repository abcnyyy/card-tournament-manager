/* Electron 主进程 —— 纯本地运行，不加载任何网络资源 */
const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;

/* 自动化测试用：TMS_SMOKE_HIDDEN=1 时窗口不落到可见桌面上（放到屏幕外 + 不进任务栏），
   但页面照常渲染，CDP 截图可用 —— 测试期间不弹窗打扰用户 */
const HIDDEN = process.env.TMS_SMOKE_HIDDEN === '1';
const OFF_X = -6000, OFF_Y = -6000;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    title: '卡牌赛事编排',
    backgroundColor: '#ffffff',
    show: false,
    x: HIDDEN ? OFF_X : undefined,
    y: HIDDEN ? OFF_Y : undefined,
    skipTaskbar: HIDDEN,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'app', 'index.html'));

  mainWindow.once('ready-to-show', function () {
    if (HIDDEN) {
      // 完全透明 + 不进任务栏 + 不抢焦点：用户看不到任何窗口，但页面照常渲染可截图
      mainWindow.setSkipTaskbar(true);
      mainWindow.setOpacity(0);
      try { mainWindow.setPosition(OFF_X, OFF_Y); } catch (e) {}
      mainWindow.showInactive();
    } else {
      mainWindow.show();
    }
  });

  // 禁止跳转到外部浏览器（纯本地应用）
  mainWindow.webContents.setWindowOpenHandler(function () { return { action: 'deny' }; });
  mainWindow.webContents.on('will-navigate', function (e, url) {
    if (!url.startsWith('file://') && !url.startsWith('blob:')) e.preventDefault();
  });

  // 打包后隐藏菜单栏
  if (app.isPackaged) Menu.setApplicationMenu(null);
}

/* ============ 导出：原生「另存为」对话框 ============ */
const MIME_EXT = {
  'text/csv': 'csv',
  'application/json': 'json',
  'text/plain': 'txt',
  'text/html': 'html',
  'text/markdown': 'md',
  'application/pdf': 'pdf'
};

function extOf(filename, mime) {
  var m = (mime || '').split(';')[0].trim();
  if (MIME_EXT[m]) return MIME_EXT[m];
  var e = path.extname(filename || '').replace('.', '');
  return e || 'txt';
}

function filterOf(ext) {
  var names = {
    csv: 'CSV 表格', json: 'JSON 存档', txt: '文本文件',
    html: '网页', md: 'Markdown', pdf: 'PDF 文档'
  };
  return [{ name: names[ext] || ext.toUpperCase() + ' 文件', extensions: [ext] }];
}

// 安全文件名
function safeName(n) {
  return String(n || '导出').replace(/[\\/:*?"<>|]/g, '_');
}

ipcMain.handle('tms:saveFile', async function (ev, payload) {
  payload = payload || {};
  var filename = safeName(payload.filename || '导出.txt');
  var ext = extOf(filename, payload.mime);
  if (path.extname(filename) === '') filename += '.' + ext;
  var win = BrowserWindow.fromWebContents(ev.sender) || mainWindow;
  var def = path.join(app.getPath('documents'), filename);
  var r = await dialog.showSaveDialog(win, {
    title: '导出到文件',
    defaultPath: def,
    filters: filterOf(ext),
    properties: ['createDirectory', 'showOverwriteConfirmation']
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true, msg: '已取消导出' };
  try {
    fs.writeFileSync(r.filePath, String(payload.content == null ? '' : payload.content), 'utf8');
    return { ok: true, path: r.filePath, msg: '已保存到：' + r.filePath };
  } catch (e) {
    return { ok: false, msg: '保存失败：' + e.message };
  }
});

ipcMain.handle('tms:savePDF', async function (ev, payload) {
  payload = payload || {};
  var filename = safeName(payload.filename || '导出.pdf');
  if (!/\.pdf$/i.test(filename)) filename += '.pdf';
  var win = BrowserWindow.fromWebContents(ev.sender) || mainWindow;
  try {
    var data = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
      preferCSSPageSize: false
    });
    var r = await dialog.showSaveDialog(win, {
      title: '导出 PDF',
      defaultPath: path.join(app.getPath('documents'), filename),
      filters: filterOf('pdf'),
      properties: ['createDirectory', 'showOverwriteConfirmation']
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true, msg: '已取消导出' };
    fs.writeFileSync(r.filePath, data);
    return { ok: true, path: r.filePath, msg: 'PDF 已保存到：' + r.filePath };
  } catch (e) {
    return { ok: false, msg: '导出 PDF 失败：' + e.message };
  }
});

// 打开导出的文件夹（导出成功后提示里用）
ipcMain.handle('tms:reveal', function (ev, p) {
  try { shell.showItemInFolder(p); return true; } catch (e) { return false; }
});

app.whenReady().then(function () {
  createWindow();
  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// 安全策略：拦截全部网络请求（离线应用）
app.on('ready', function () {
  const { session } = require('electron');
  session.defaultSession.webRequest.onBeforeRequest(function (details, callback) {
    if (details.url.startsWith('file://') || details.url.startsWith('blob:')) {
      callback({ cancel: false });
    } else {
      callback({ cancel: true });
    }
  });
});
