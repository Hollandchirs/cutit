# CursorCut AI

**AI驱动的智能视频编辑工具 - 自动识别并删除重复片段**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.2-blue)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-6.2-purple)](https://vitejs.dev/)

## 📖 项目简介

CursorCut AI 是一个基于 AI 的智能视频编辑工具，专门用于自动识别和删除视频中的重复片段（NG镜头/重录内容）。通过结合 **Groq Whisper API** 的快速语音转文字和 **Google Gemini AI** 的智能分析，可以自动检测重复内容，并帮助用户快速制作高质量的视频。

### ✨ 核心功能

- 🎬 **智能转录**: 使用 Groq Whisper API 进行高精度中文语音转文字，支持词级时间戳
- 🤖 **AI 分析**: 使用 Gemini AI 自动识别重复片段，标记最佳版本
- ✂️ **精确编辑**: 支持时间轴拖拽、分割、删除、静音、词级精确裁剪
- 📝 **字幕编辑**: 可视化字幕编辑器，支持按词删除和精确裁剪
- 🔄 **撤销/重做**: 完整的操作历史记录，支持撤销和重做
- 📤 **视频导出**: 基于 FFmpeg 的视频导出功能，支持多片段拼接
- 🔇 **静音检测**: 自动识别并标记视频中的静音片段

## 🚀 快速开始

### 环境要求

- **Node.js** >= 18.0.0
- **npm** 或 **yarn**

### 安装步骤

1. **克隆仓库**
   ```bash
   git clone https://github.com/Hollandchirs/cutit.git
   cd cutit
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **配置环境变量**
   
   在项目根目录创建 `.env.local` 文件，添加以下配置：
   ```env
   # Google Gemini API Key (必需)
   # 获取地址: https://aistudio.google.com/app/apikey
   GEMINI_API_KEY=your_gemini_api_key_here
   
   # Groq API Key (必需)
   # 获取地址: https://console.groq.com/keys
   GROQ_API_KEY=your_groq_api_key_here
   ```

4. **启动开发服务器**
   ```bash
   # 仅启动前端 (端口 3002)
   npm run dev
   
   # 启动前端 + 后端服务 (视频导出需要)
   npm run dev:all
   ```

5. **访问应用**
   
   打开浏览器访问: `http://localhost:3002`

## 📁 项目结构

```
cutit/
├── components/          # React 组件
│   ├── MediaPool.tsx   # 媒体池 - 显示视频和片段列表
│   ├── Timeline.tsx     # 时间轴编辑器
│   ├── Player.tsx      # 视频播放器
│   ├── TranscriptEditor.tsx  # 字幕编辑器
│   └── TranscriptView.tsx    # 字幕查看器
├── services/            # 业务逻辑服务
│   ├── geminiService.ts      # Gemini AI 分析服务
│   ├── groqWhisperService.ts # Groq Whisper 转录服务
│   └── exportService.ts      # 视频导出服务
├── hooks/              # React Hooks
│   └── useTimelineHistory.ts # 时间轴历史记录 Hook
├── prompts/            # AI 提示词
│   └── systemPrompt.ts # 系统提示词模板
├── server/             # 后端服务器 (Express)
│   └── index.js        # 视频处理和导出服务
├── types.ts            # TypeScript 类型定义
├── constants.ts        # 常量配置
└── App.tsx             # 主应用组件
```

## 🎯 使用指南

### 基本工作流程

1. **上传视频**
   - 点击媒体池中的上传按钮，选择视频文件
   - 支持多个视频文件同时上传

2. **分析视频**
   - 点击"分析"按钮开始处理
   - 系统会自动：
     - 提取音频并使用 Groq Whisper 进行转录
     - 使用 Gemini AI 分析并识别重复片段
     - 在时间轴上显示所有片段，重复内容用相同颜色标记

3. **编辑时间轴**
   - **选择片段**: 点击时间轴上的片段
   - **删除片段**: 选中后按 `Delete` 或 `Backspace`
   - **分割片段**: 在播放头位置按 `Ctrl+B` (Mac: `Cmd+B`)
   - **调整时长**: 拖拽片段边缘进行裁剪
   - **重新排序**: 拖拽片段改变顺序
   - **静音片段**: 双击片段切换静音状态

4. **精确编辑字幕**
   - 在媒体池中点击片段，打开字幕编辑器
   - 可以按词删除或精确裁剪特定时间段
   - 支持文本选择后剪切

5. **导出视频**
   - 点击右上角"Export Video"按钮
   - 系统会拼接所有选中的片段并导出为 MP4 文件

### 键盘快捷键

| 快捷键                        | 功能         |
| -------------------------- | ---------- |
| `Space`                    | 播放/暂停      |
| `Ctrl+Z` / `Cmd+Z`         | 撤销         |
| `Ctrl+Shift+Z` / `Cmd+Shift+Z` | 重做         |
| `Delete` / `Backspace`     | 删除选中片段     |
| `Ctrl+B` / `Cmd+B`         | 在播放头位置分割片段 |

## 🔧 技术架构

### 前端技术栈

- **React 19.2** - UI 框架
- **TypeScript** - 类型安全
- **Vite** - 构建工具
- **Tailwind CSS** - 样式框架
- **FFmpeg.wasm** - 浏览器端视频处理

### AI 服务

- **Groq Whisper API** - 快速、准确的语音转文字
  - 支持中文
  - 词级时间戳精度
  - 自动合并句子片段
  - 静音片段检测

- **Google Gemini AI** - 智能内容分析
  - 识别重复片段
  - 标记最佳版本
  - 评分系统 (0-100)

### 后端服务

- **Express.js** - 视频处理服务器
- **FFmpeg** - 视频导出和压缩
- **Multer** - 文件上传处理

## 📝 API 配置

### Groq API Key

1. 访问 [Groq Console](https://console.groq.com/keys)
2. 注册/登录账号
3. 创建 API Key
4. 将 Key 添加到 `.env.local` 文件

### Gemini API Key

1. 访问 [Google AI Studio](https://aistudio.google.com/app/apikey)
2. 使用 Google 账号登录
3. 创建 API Key
4. 将 Key 添加到 `.env.local` 文件

## 🛠️ 开发

### 运行开发服务器

```bash
# 仅前端
npm run dev

# 前端 + 后端
npm run dev:all

# 仅后端
npm run server
```

### 构建生产版本

```bash
npm run build
```

### 预览生产构建

```bash
npm run preview
```

## 📦 依赖说明

### 核心依赖

- `@google/genai` - Google Gemini AI SDK
- `@ffmpeg/ffmpeg` - FFmpeg WebAssembly
- `react` / `react-dom` - React 框架
- `express` - 后端服务器
- `multer` - 文件上传处理

### 开发依赖

- `vite` - 构建工具
- `typescript` - TypeScript 编译器
- `tailwindcss` - CSS 框架
- `@vitejs/plugin-react` - React 插件

## 🎨 功能特性

### 智能重复检测

- 自动识别说话人重复录制的内容
- 基于内容相似度分组
- 每组自动标记最佳版本
- 支持多组重复内容同时处理
- 重复片段自动显示删除线，双击可恢复

### 精确时间控制

- 词级时间戳精度
- 支持精确到字的裁剪
- 自动对齐片段边界
- 去除静音片段
- 增加时间 padding 防止截断单词

### 专业编辑体验

- 可视化时间轴
- 拖拽排序和调整
- 实时预览
- 撤销/重做支持
- 支持剪切片段的独立拖动

## ⚠️ 注意事项

1. **API 配额**: Groq 和 Gemini API 都有使用限制，请注意配额
2. **视频大小**: 大文件会自动压缩，但处理时间可能较长
3. **浏览器兼容**: 建议使用 Chrome/Edge 最新版本
4. **服务器依赖**: 视频导出功能需要后端服务器运行

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

本项目采用 MIT 许可证。

## 🔗 相关链接

- [Groq Console](https://console.groq.com/)
- [Google AI Studio](https://aistudio.google.com/)
- [FFmpeg 文档](https://ffmpeg.org/documentation.html)

---

**Made with ❤️ by Hollandchirs**
