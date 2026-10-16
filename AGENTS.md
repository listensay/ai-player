# Study Helper · Agent 必须遵守

先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，沿用现有组件、数据兼容与验证约定。

## 每次完成更新，必须同步版本日志

**AI Agent 修改项目内容后，必须在同一轮工作中自动更新版本日志，不等用户提醒。未更新版本日志，不得宣告工作完成。**

- 唯一版本日志源：`app/data/releases.json`；应用内“版本日志”页面和“关于与诊断”的当前版本均读取它。
- 当前起始版本为 **0.0.1**。每轮独立交付默认增加补丁号（例如 0.0.1 → 0.0.2）；同一轮开发、修复和验证只维护本轮同一个条目，不反复加号。用户指定版本时以用户要求为准。
- 新版本插入数组首位，保留历史文字记录。填写实际交付日期（项目时区 Asia/Shanghai）、标题、简短概述，以及 `added`、`changed`、`fixed`、`removed` 四类内容；没有变化的分类用空数组。
- 用简洁中文写清楚具体新增、调整、修复或移除了什么。只记录已完成的工作，不写计划，不虚构测试结果；纯文档或维护改动也要说明。
- 同步 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 中本项目的版本号。不得批量替换依赖或数据库结构版本。
- 这是更新日志机制，不保留旧软件包、代码快照或桌宠备份。不要为了版本记录创建安装包归档、Git 标签或复制整个项目。
- 完成前执行 `npm run check`；涉及原生实现时执行 `npm run check:rust`。版本一致性和日志格式会随检查验证。

## 名称与兼容

对用户展示的应用名称为 **Study Helper**。`app.aiplayer.desktop`、`ai-player.db`、已有知识库目录、URL 协议及 AFFiNE 桥接标识保留，用于继续读取现有课程、笔记和系统集成，不能为名称替换直接破坏它们。
