好的，我已根据你提供的文档做了整体优化，保持了原有的结构与大部分内容，仅对存在重复、冲突或不够清晰的部分做了微调和合并，使其更加一致、完整。以下是优化后的版本：

---

# 项目概述

开发一个 VSCode 插件，用于管理和执行基于 AI 的 agent 系统，提供 subagents 管理、TODO 任务执行、日志查看等功能，并集成 Claude Code 作为执行引擎。

## 核心功能需求

### 1. Subagents 管理模块

#### 1.1 Agent 发现与展示

* **自动发现机制**：从 `${workspaceRoot}/.jarvis/agents/` 目录扫描 agent 配置文件（格式与Claude Code SubAgents一致，支持JSON和Markdown）
* **树形视图展示**：在侧边栏以 TreeView 形式展示所有可用 agents，支持分组和折叠
* **实时状态显示**：展示每个 agent 的运行状态（空闲/运行中/错误）

#### 1.2 Agent 执行管理

* **一键启动**：通过内联按钮或右键菜单启动 agent
* **进程管理**：支持终止运行中的 agent 进程
* **参数配置**：支持为每个 agent 配置独立的启动参数

#### 1.3 日志管理

* **结构化日志存储**：

  ```
  .jarvis/
  ├── agent-logs/
  │   ├── {agentName}/
  │   │   ├── 2025-01-04T12-30-00.md
  │   │   └── 2025-01-04T13-45-00.md
  ```
* **日志查看器**：集成日志预览功能，支持语法高亮和折叠
* **日志归档**：自动清理超过配置时限的旧日志

---

### 2. TODO 任务管理模块

#### 2.1 任务组织

* **Markdown 格式支持**：解析标准 Markdown 任务列表语法

  ```markdown
  - [ ] 未完成任务
  - [x] 已完成任务
  - [ ] 带子任务的任务
    - [ ] 子任务 1
    - [ ] 子任务 2
  ```
* **任务分类**：支持通过文件名或标签进行任务分组
* **优先级标记**：支持高/中/低优先级可视化标记

#### 2.2 Claude Code 集成

* **执行引擎封装**：

  * 创建 `ClaudeCodeExecutor` 类处理所有 Claude Code 调用
  * 支持异步执行和进度反馈
  * 实现执行队列管理，避免并发冲突
* **参数管理**：

  * 全局默认参数配置
  * 任务级别参数覆盖
  * 支持环境变量注入

#### 2.3 执行状态管理

* **状态图标系统**：

  * ⚪ 未执行（pending）
  * 🔵 执行中（running）
  * ✅ 成功（success）
  * ❌ 失败（failed）
  * ⏸️ 暂停（paused）
* **执行历史**：保存每次执行的完整上下文和结果

---

### 3. Claude Code 集成补充说明

#### 3.1 命令参数规范

```typescript
interface ClaudeCommandOptions {
  "--dangerously-skip-permissions": boolean;
  "--add-dir": string[];
  "--verbose": boolean;
  "--print": boolean;
  "--output-format": "stream-json" | "text";
  "--model"?: string;
  "--max-tokens"?: number;
  "--temperature"?: number;
}
```

**执行命令示例**：

```typescript
const command = [
  "claude",
  "--dangerously-skip-permissions",
  "--add-dir", workspaceRoot,
  "--verbose",
  "--print", 
  "--output-format", "stream-json"
];
```

#### 3.2 JSONL 日志存储

* **文件命名规范**：`YYYYMMDD_HH-MM-SS_{taskname}.jsonl`
* **实时写入机制**：通过 `fs.createWriteStream` 以追加模式写入，每条消息独立 JSON 行。

#### 3.3 消息结构

```typescript
interface ClaudeJsonMessage {
  type: "system" | "assistant" | "user" | "result" | "error";
  subtype?: string;
  message?: { content: Array<{ type: "text" | "tool_use" | "tool_result"; text?: string; name?: string; input?: any; content?: any; }>; };
  content?: any[];
  result?: string;
  error?: string;
}
```

#### 3.4 流式进程管理

* 使用 `child_process.spawn` 执行命令
* `readline` 按行解析 JSON 输出
* 自动写入 JSONL 日志

---

### 4. 配置管理

#### 4.1 插件配置架构

```json
{
  "jarvis.paths": {
    "agentDir": ".jarvis/agents",
    "logDir": ".jarvis/agent-logs",
    "todoDir": ".jarvis/todos",
    "todoLogDir": ".jarvis/todo-logs"
  },
  "jarvis.claude": {
    "executable": "claude",
    "defaultParams": {
      "permission-mode": "auto",
      "output-format": "stream-json",
      "verbose": true,
      "print": true,
      "add-dirs": ["${workspaceRoot}"],
      "model": "claude-sonnet-4-5-20250929",
      "max-tokens": 4096,
      "temperature": 0.7,
      "mcp-config": "${workspaceRoot}/.jarvis/mcp-config.json"
    },
    "requiredMcps": ["mcpx", "chrome-devtools-mcp"],
    "environment": {
      "checkOnStartup": true,
      "autoInstallMcp": false
    }
  },
  "jarvis.logs": {
    "format": "jsonl",
    "realtimeFlush": true,
    "compression": false,
    "retentionDays": 30
  },
  "jarvis.ui": {
    "autoRefresh": true,
    "refreshInterval": 1000,
    "showNotifications": true,
    "logRetentionDays": 30
  }
}
```

#### 4.2 配置编辑器

* Webview 配置界面
* JSON Schema 验证
* 导入/导出功能

---

### 5. 用户界面设计

#### 5.1 活动栏集成

* **Jarvis 图标**放置在活动栏
* **侧边栏容器**包含多个面板

#### 5.2 视图结构

```
Jarvis
├── 📦 Agents
│   ├── 🤖 Data Processor [▶️]
│   ├── 🤖 Code Analyzer [⏸️]
│   └── 🤖 Test Runner [✅]
├── ✅ TODOs
│   ├── 📝 Feature Development
│   │   ├── ⚪ Implement auth system
│   │   └── ✅ Setup database
│   └── 📝 Bug Fixes
│       └── 🔵 Fix memory leak
└── 📊 Statistics
    ├── Tasks: 12 completed / 20 total
    └── Agents: 2 running / 5 total
```

#### 5.3 命令面板

* `Jarvis: Start Agent`
* `Jarvis: Execute TODO`
* `Jarvis: View Logs`
* `Jarvis: Configure`

---

### 6. 技术架构

#### 6.1 项目结构

```
jarvis-vscode/
├── src/
│   ├── extension.ts
│   ├── providers/
│   ├── executors/
│   ├── views/
│   ├── utils/
│   └── types/
├── resources/
├── package.json
├── tsconfig.json
└── webpack.config.js
```

#### 6.2 技术栈

* TypeScript 5.x
* Webpack 5 + ESBuild
* React + VSCode Webview API
* Jest + VSCode Extension Test Runner
* ESLint + Prettier + Husky

#### 6.3 性能优化

* Virtual Scrolling
* 懒加载
* 文件监听去抖动
* 内存缓存

---

### 7. 安全与错误处理

* 沙箱化执行
* 敏感信息加密
* 权限验证
* 全局错误边界与降级策略
* 详细日志与用户提示

---

### 8. 发布与分发

* 打包体积 < 5MB
* 支持多平台
* 自动更新
* 文档：README、API、贡献指南、CHANGELOG

---

## 交付标准

1. 完整的 TypeScript 源代码
2. 单元测试覆盖率 > 80%
3. 用户手册与配置示例
4. CI/CD 配置（GitHub Actions）
5. 发布就绪 VSIX 包
