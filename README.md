# 卡牌赛事编排 Card Tournament Manager

一个**纯静态、离线可用**的卡牌 / 桌游赛事编排与计分系统。支持瑞士轮、单败淘汰、双败淘汰、循环赛、小组赛五大赛制，可多阶段串联；同一套代码可打包为 **Windows 桌面应用**（Electron）与 **Android 应用**（Capacitor）。数据全部存本地 localStorage，无需服务器、无需联网、零 CDN 依赖。

## 功能概览

- **赛制**：瑞士轮、单败淘汰、双败淘汰、循环赛（可多循环）、小组赛（组内可再选瑞士轮 / 循环赛 / 双败）
- **多阶段**：一个赛事可串任意多个阶段，自动按名次晋级 / 淘汰，名额可固定人数或同分同名次
- **编排与抽签**：按种子排位、手动点选编排、分档抽签、完全随机抽签；轮空归属不被抽签改变
- **计分**：大比分 → 积分映射表（表驱动），胜负 / 平局 / 未打完多种结果；平局可判「允许平局」「自动加赛决胜」或「双方都输」
- **小分**：胜负场、净胜局、净小分、累进分、对手分等多种排序依据，可跨阶段继承
- **提前晋级 / 淘汰**：达标即判定，界面实时显示
- **对阵图**：单阶段树状对阵图，或多个淘汰阶段合并查看的完整流向图
- **计时器**：每桌独立计时，到点按当前比分自动结算
- **导出**：HTML 一览导出（另存为 / 打印 PDF），支持原生保存对话框
- **回退**：任何一步操作都可撤销

## 目录结构

```
app/          纯静态前端（index.html + css + js）—— 核心应用本体
  js/core.js     数据模型、常量、默认值、localStorage 持久化
  js/formats.js  赛制相关算法（双败状态机、配对、加赛等）
  js/engine.js   引擎：编排、结算、积分、名次、导出数据准备
  js/exporter.js 导出与保存
  js/ui.js       界面渲染与交互
electron/     桌面端主进程
android/     Capacitor 安卓工程（Gradle）
tools/       测试与构建脚本（见下）
使用说明.md  完整使用文档
```

## 本地运行

Web 版（双击或起个静态服务均可）：

```bash
# 直接用浏览器打开
app/index.html

# 或起本地服务
python -m http.server 8080 --directory app
```

桌面版：

```bash
npm install
npm start
```

## 测试

所有测试均为**无头运行**（本地静态服务 + 无头浏览器 + CDP），不会弹出任何窗口：

```bash
node tools/test_engine.js       # 引擎核心
node tools/test_v23.js          # 最新版本的专项用例
node tools/smoke_flow.js        # 端到端流程
node tools/smoke_v23.js         # 界面冒烟
node tools/verify_pack.js       # 从打包产物 app.asar 解包后复跑
```

命名规则：`test_*.js` 为纯引擎测试，`smoke_*.js` 为界面测试，`zoom_*/shot_*` 为截图脚本。

## 打包

```bash
npm run dist:exe      # Windows：NSIS 安装包 + 便携版 exe → dist/
npm run cap:sync      # 同步前端到安卓工程
npm run apk:debug     # Android 调试版 APK（需本机 JDK 17 + Android SDK）
```

## 许可

MIT
