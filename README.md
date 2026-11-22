# Shiori

Shiori 是一个专注、克制的桌面端 AI Agent 工作台（基于 [Craft Agents](https://github.com/craft-ai-agents/craft-agents-oss) `v0.15.11` 深度重构），面向日常编码与多任务协作场景，主打清晰的项目/会话层级、无干扰主界面以及本地优先的数据掌控。

## 核心特性

### 1. 专注的桌面交互与信息架构
- **单列可折叠侧栏**：将工作区切换、新建会话与历史任务收拢到统一侧栏，支持按项目文件夹分组与状态筛选。
- **独立设置界面与命令面板**：数据源（Sources）、技能（Skills）、模型连接、权限与快捷键收敛至独立设置视图，支持快捷键快速唤起命令面板。
- **暖灰中性色视觉体系**：完整适配浅色与深色主题，优化中文排版、长标题截断与窄窗口阅读体验。

### 2. Agent 工作流增强
- **运行中引导（Mid-Turn Steering）**：Agent 执行过程中可直接输入追加指令进行引导，无需粗暴中断当前轮次。
- **Intelligent UI（交互式界面卡片）**：支持在对话中渲染沙箱化 `shiori-ui` / `interactive-ui` HTML/JS 交互卡片，内置浅/深色主题同步、自动高度适配、全屏查看、双向会话回传（`window.shiori.send` / `data-shiori-send`）以及**离线单文件 HTML 导出**。
- **Git Diff 变更抽屉**：右侧按需展开查看工作区改动与代码差异。
- **Magpie 桥接插件**：在 `integrations/magpie-agent-shiori/` 提供 Magpie 适配插件，便于对接本地代理与自定义模型路由。

### 3. 本地优先与完全去上游依赖
- **独立数据目录 `~/.shiori/`**：首次启动时自动从 `~/.craft-agent/` 平滑迁移历史配置、工作区与会话（不覆盖已有文件，原目录保留备份）。
- **零上游外链请求**：默认禁用上游自动更新检查与 `thecraftagents.com` 文档/分享域名（如需自建更新源，可通过环境变量 `SHIORI_UPDATE_URL` 开启）。

## 安装与使用（Windows）

目前已完成 **Windows x64** 实机构建与验证（macOS / Linux 构建脚本保留，但尚未实机验证）：

1. 前往本仓库 **Releases** 页面下载：
   - 安装版：`Shiori-Setup-0.15.11-x64.exe`（推荐，支持自定义安装路径，卸载不删用户数据）
   - 便携版：`Shiori-0.15.11-win-x64.zip`（解压到常规目录即可运行）
2. 由于个人构建未附带商业代码签名，首次安装时 Windows SmartScreen 可能提示未知发布者，点击「更多信息 → 仍要运行」即可。

## 本地开发与构建

环境要求：[Bun](https://bun.sh/) 1.3+、Node.js 20+。

```bash
# 安装依赖
bun install

# 类型检查（Electron）
bun run typecheck:electron

# 构建主进程、预加载脚本、渲染层与资源
bun run electron:build:main
bun run electron:build:preload
bun run electron:build:renderer
cd apps/electron && bun scripts/copy-assets.ts

# 打包 Windows 安装包与便携压缩包
cd apps/electron
bun x electron-builder --win --x64
```

## 开源协议与致谢

本项目基于 [Craft Agents](https://github.com/craft-ai-agents/craft-agents-oss)（`v0.15.11`）二次开发，沿用 **Apache License 2.0** 协议发布，详见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。

Shiori 是一个独立衍生项目，与 Craft Docs Ltd. 无隶属或官方背书关系。
