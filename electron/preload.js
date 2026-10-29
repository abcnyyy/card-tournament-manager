/* Electron 预加载脚本 —— 仅暴露极少量安全接口给渲染进程 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isPackaged: (function () {
    try { return require('electron').app.isPackaged; } catch (e) { return false; }
  })()
});

/* 原生文件保存 / 导出 PDF —— 页面里通过 TMS.util.nativeKind() 自动识别 */
contextBridge.exposeInMainWorld('tmsNative', {
  platform: 'electron',
  saveFile: function (filename, content, mime) {
    return ipcRenderer.invoke('tms:saveFile', {
      filename: filename, content: content, mime: mime
    });
  },
  saveBinary: function (filename, base64, mime) {
    return ipcRenderer.invoke('tms:saveBinary', {
      filename: filename, base64: base64, mime: mime
    });
  },
  savePDF: function (filename) {
    return ipcRenderer.invoke('tms:savePDF', { filename: filename });
  },
  reveal: function (p) {
    return ipcRenderer.invoke('tms:reveal', p);
  }
});
