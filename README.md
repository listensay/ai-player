# Study Helper

面向本地视频课程的桌面学习助手，将课程播放、笔记白板、AI 导学、练习与学习计划整合在一个工作区。

Study Helper 适合围绕视频课程进行系统学习：从整理课节、制定路线，到记录笔记、完成练习和回顾进度，减少在播放器、笔记工具与 AI 对话之间来回切换。

[功能特性](#功能特性) · [技术栈](#技术栈) · [安装](#安装) · [快速开始](#快速开始) · [参与贡献](#参与贡献)

## 功能特性

| 功能           | 说明                                                                                   |
| -------------- | -------------------------------------------------------------------------------------- |
| 课程管理与播放 | 导入本地课程目录，搜索、置顶与归档课程；支持播放进度恢复、倍速、全屏和快捷键。         |
| 笔记与白板     | 内置 AFFiNE 工作区，将文档和白板关联到课节，支持导入导出与 AI 辅助编辑。               |
| 字幕与离线转写 | 读取 SRT / WebVTT 字幕，或通过本地语音识别生成逐字稿，为课程概览和知识点整理提供材料。 |
| AI 导学与助教  | 根据学习目标制定路线，提供随堂问答、知识脑图、记忆闪卡与费曼对练。                     |
| 学习计划       | 设置学习日与每日时间预算，安排当天任务，支持暂停、顺延以及调整前的预览和撤销。         |
| 练习与实践     | 生成课后练习与每日巩固，记录作答和反馈，支持编程练习、错题强化与实践验收。             |
| 进度与回顾     | 查看每日任务、打卡日历、学习投入与知识掌握情况，生成周报、月报与 AI 复盘。             |
| 学习提醒       | 管理定时提醒和学习日历，支持同步 macOS 提醒事项。                                      |

## 技术栈

| 层面         | 技术                            | 用途                                               |
| ------------ | ------------------------------- | -------------------------------------------------- |
| 桌面应用     | Tauri 2、Rust                   | 原生窗口、文件访问、系统集成与桌面打包。           |
| 前端         | Vue 3、TypeScript、Vue Router   | 页面交互、应用状态与路由。                         |
| 界面与构建   | Vuetify、Tailwind CSS、Vite     | 界面组件、样式与前端构建。                         |
| 数据存储     | SQLite                          | 保存课程、学习进度与应用配置。                     |
| 笔记与白板   | AFFiNE                          | 文档编辑、白板与课节笔记工作区。                   |
| 音视频与转写 | FFmpeg、sherpa-onnx、SenseVoice | 音频提取与本地语音识别。                           |
| AI 接口      | OpenAI 兼容协议、Anthropic 协议 | 接入用户配置的模型服务，用于导学、问答和练习反馈。 |
| 编程练习     | Monaco Editor、QuickJS          | 代码编辑与 JavaScript 沙箱执行。                   |

## 安装

以下说明面向 **macOS 13.5 及以上系统**，通过源码构建桌面安装包。

### 环境要求

| 依赖     | 要求                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Git      | 用于获取项目及 AFFiNE 源码。                                                                                                     |
| Node.js  | 主项目使用 [.nvmrc](.nvmrc) 指定的 Node 24 官方发行版；AFFiNE 使用 Node 22。推荐通过 [nvm](https://github.com/nvm-sh/nvm) 管理。 |
| Rust     | 安装 [Rustup](https://rustup.rs/)，项目使用 [rust-toolchain.toml](rust-toolchain.toml) 指定的工具链。                            |
| 系统工具 | 安装 Xcode Command Line Tools，其他依赖参见 [Tauri 环境要求](https://v2.tauri.app/start/prerequisites/)。                        |

首次安装与构建需要联网获取依赖和 AFFiNE 源码。

### 1. 获取项目与安装依赖

```sh
git clone https://github.com/listensay/ai-player.git
cd ai-player
nvm install
npm ci
```

### 2. 构建笔记模块

AFFiNE 需要单独使用 Node 22 构建，完成后切回主项目的 Node 版本。

```sh
nvm install 22
npm run notes:build
nvm use
```

### 3. 构建并安装桌面应用

在项目根目录执行，构建产物输出到当前项目：

```sh
CARGO_TARGET_DIR="$PWD/src-tauri/target" npm run desktop:build
```

构建完成后，打开 `src-tauri/target/release/bundle/dmg/` 中的 `.dmg` 文件，将 **Study Helper** 拖入“应用程序”。

如需从源码启动开发窗口，在完成前两步后执行：

```sh
nvm use
CARGO_TARGET_DIR="$PWD/src-tauri/target" npm run dev
```

## 快速开始

1. **添加课程**：在首页选择本地课程目录，打开课程并选择课节。
2. **配置 AI**：进入“设置 → AI 服务设置”，选择接口格式，填写服务地址、模型 ID 和所需的 API 密钥，完成导学测试并保存配置。支持切换多套模型配置。
3. **开始学习**：播放视频、阅读字幕并记录课节笔记；需要时生成导学路线、练习或安排每日学习任务。

没有字幕的课程可使用离线转写，首次使用时需要下载语音识别模型。AI 功能需要可用的模型服务；基础课程播放与笔记编辑可独立使用。

## 参与贡献

问题反馈和功能建议可通过 [GitHub Issues](https://github.com/listensay/ai-player/issues) 提交。开发环境、代码规范和检查流程请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 第三方软件

笔记与白板基于 [AFFiNE](https://github.com/toeverything/AFFiNE) 集成。相关来源、版权、许可证与修改说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
