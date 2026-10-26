# 贡献指南 · Contributing

感谢你关注 **卡牌赛事编排**！无论是报 bug、提需求、补文档还是写代码，都非常欢迎。

## 一、提 Issue 前

- 先搜一下 [Issues](https://github.com/abcnyyy/card-tournament-manager/issues)，避免重复。
- 用模板提交：Bug 报告 / 功能请求 / 赛制咨询。
- 能附上「赛事设置 + 具体对阵 / 比分」最好，便于复现。

## 二、开发环境

本仓库是**纯静态前端 + 桌面壳 + 安卓壳**，无需后端：

```bash
npm install            # 安装桌面端依赖
npm start              # 启动 Electron 桌面端（开发）
# 或仅跑 Web 版：
python -m http.server 8080 --directory app
```

技术栈：原生 JS（无框架）、Electron（桌面）、Capacitor + Gradle（安卓）。

## 三、代码约定

- 核心引擎在 `app/js/`：`core.js`(模型) / `engine.js`(编排·结算·积分) / `formats.js`(赛制) / `ui.js`(界面) / `exporter.js`(导出)。
- 引擎统一挂载在 `window.TMS`，不要随意改挂载结构。
- 改任何逻辑后必须跑测试，且**全部测试必须零窗口无头运行**（绝不要为了测试启动可见窗口）。

```bash
node tools/test_engine.js     # 引擎核心
node tools/test_v29.js        # 最新版本专项用例
node tools/smoke_flow.js      # 端到端流程
node tools/smoke_v29.js       # 界面冒烟
node tools/verify_pack.js     # 从打包产物 app.asar 解包复跑
```

- 文档改动后用 `python tools/md2html.py 使用说明.md 使用说明.html` 重新生成 HTML。

## 四、提交规范

- 分支：从 `main` 切 `feature/xxx` 或 `fix/xxx`，PR 合并回 `main`。
- Commit message 建议英文、祈使句（`feat:` / `fix:` / `docs:` / `test:` / `refactor:`）。
- 一个大功能拆成几个小而完整的 commit，方便 review 与回滚。
- PR 描述说清「为什么改、改了什么、怎么验证」。

## 五、行为准则

参与本社区即表示你同意遵守 [行为准则](CODE_OF_CONDUCT.md)。互相尊重，友好交流。

---

再次感谢你的贡献 ❤️
