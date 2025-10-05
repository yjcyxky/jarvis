# Jarvis - VSCode AI Agent 管理器

一个强大的 VSCode 扩展，用于管理和执行基于 AI 的智能代理，集成 Claude Code。Jarvis 提供了运行子代理、管理 TODO 任务和跟踪执行日志的综合界面。

**📖 Chinese Documentation | [English Documentation](README.md)**

## 功能特性

### 🤖 Agent 管理
- 从 `.jarvis/agents/` 目录**自动发现**代理配置
- **实时状态监控**（空闲、运行中、错误、暂停）
- **一键执行**，支持自定义参数
- **🆕 文件变化时自动执行**，带频率控制
- **🆕 手动触发**即时执行
- **🆕 模板变量支持**，动态代理路径
- 支持 JSON 和 Markdown 代理定义格式
- 结构化日志，JSONL 格式

### ✅ TODO 任务管理
- 解析标准 Markdown TODO 语法
- **优先级级别**（高、中、低）
- **嵌套任务支持**，包含子任务
- **执行跟踪**，带状态指示器
- 成功执行后自动完成任务

### 📊 统计仪表板
- 实时代理和 TODO 统计
- 进度跟踪，带可视化指示器
- 执行历史和错误报告

### 🔧 Claude Code 集成
- 与 Claude Code CLI 无缝集成
- 可配置执行参数
- 流式 JSON 输出处理
- MCP（模型上下文协议）支持

## 安装

1. 从 VSCode 市场安装扩展
2. 安装 Claude Code CLI：
   ```bash
   npm install -g @anthropic/claude-cli
   ```
3. 在 VSCode 中打开工作区文件夹
4. Jarvis 将自动激活并创建 `.jarvis` 目录结构

## 快速开始

### 设置代理

在 `.jarvis/agents/` 中创建代理配置：

**JSON 格式**（`.jarvis/agents/my-agent.json`）：
```json
{
  "name": "代码审查员",
  "description": "审查代码质量和最佳实践",
  "prompt": "审查当前代码库并提供反馈",
  "parameters": {
    "--model": "claude-sonnet-4-5-20250929"
  },
  "tags": ["review", "quality"]
}
```

**Markdown 格式**（`.jarvis/agents/my-agent.md`）：
```markdown
---
name: data-processor
description: Processes and transforms data files
tools:
model: claude-sonnet-4-5-20250929
---

## Description
处理和转换数据文件

## Prompt
处理输入目录中的数据文件并生成报告

## Parameters
- input_dir: 源数据目录
- output_dir: 生成的报告目录
- format: 输出格式（json, csv, xml）
```

### 创建 TODO

在 `.jarvis/todos/` 中添加 TODO 文件：

```markdown
# 项目任务

- [ ] [HIGH] 实现身份验证
  - [ ] 创建登录表单
  - [ ] 添加 JWT 处理
- [ ] [MEDIUM] 添加测试
- [ ] [LOW] 更新文档
```

### 运行代理和 TODO

1. **通过 UI**：点击侧边栏中任何代理或 TODO 旁边的播放按钮
2. **通过命令面板**：
   - `Jarvis: Start Agent`
   - `Jarvis: Execute TODO`
   - `Jarvis: Trigger Manual Execute`（🆕）
   - `Jarvis: Show Auto-Execute Status`（🆕）
3. **通过上下文菜单**：右键点击树视图中的项目
4. **🆕 自动执行**：配置文件变化时的自动执行

## 配置

通过 VSCode 设置配置 Jarvis（`Cmd/Ctrl + ,`）：

```json
{
  "jarvis.paths.agentDir": ".jarvis/agents",
  "jarvis.paths.logDir": ".jarvis/agent-logs",
  "jarvis.paths.todoDir": ".jarvis/todos",
  "jarvis.claude.executable": "claude",
  "jarvis.claude.defaultParams.model": "claude-sonnet-4-5-20250929",
  "jarvis.claude.defaultParams.temperature": 0.7,
  "jarvis.claude.defaultParams.max-tokens": 4096,
  "jarvis.ui.autoRefresh": true,
  "jarvis.ui.refreshInterval": 1000,
  "jarvis.logs.retentionDays": 30,
  "jarvis.autoExecute.enabled": true,
  "jarvis.autoExecute.agentName": "generate-claude-md",
  "jarvis.autoExecute.frequency": "daily"
}
```

### 🆕 自动执行配置

配置文件变化时的自动代理执行：

```json
{
  "jarvis.autoExecute.enabled": true,
  "jarvis.autoExecute.agentName": "generate-claude-md",
  "jarvis.autoExecute.frequency": "daily"
}
```

**自动执行选项：**
- `enabled`：启用/禁用自动执行
- `agentName`：要自动执行的代理名称
- `frequency`：执行频率（`daily`、`hourly`、`manual`）

**功能特性：**
- ✅ **文件变化驱动**：仅在文件实际变化时执行
- ✅ **频率控制**：防止过度执行
- ✅ **手动触发**：需要时覆盖频率限制
- ✅ **状态监控**：查看执行状态和文件变化

## MCP 配置

在 `.jarvis/mcp-config.json` 中配置 MCP 服务器：

```json
{
  "mcpServers": {
    "mcpx": {
      "command": "npx",
      "args": ["@mcpx/mcpx"]
    },
    "chrome-devtools": {
      "command": "npx",
      "args": ["@mcpx/chrome-devtools-mcp"]
    }
  }
}
```

## 命令

| 命令 | 描述 |
|------|------|
| `Jarvis: Start Agent` | 启动代理执行 |
| `Jarvis: Stop Agent` | 停止运行中的代理 |
| `Jarvis: Execute TODO` | 执行 TODO 任务 |
| `Jarvis: Trigger Manual Execute` | 🆕 手动触发自动执行代理 |
| `Jarvis: Show Auto-Execute Status` | 🆕 查看自动执行状态和文件变化 |
| `Jarvis: View Logs` | 打开日志目录 |
| `Jarvis: Configure` | 打开 Jarvis 设置 |
| `Jarvis: Refresh Agents` | 重新加载代理配置 |
| `Jarvis: Refresh TODOs` | 重新加载 TODO 文件 |

## 目录结构

```
.jarvis/
├── agents/              # 代理配置文件
│   ├── agent1.json
│   └── agent2.md
├── agent-logs/          # 代理执行日志
│   └── {agent-name}/
│       └── {timestamp}.jsonl
├── todos/               # TODO 任务文件
│   ├── development.md
│   └── testing.md
├── todo-logs/           # TODO 执行日志
│   └── {timestamp}_{task-id}.jsonl
└── mcp-config.json      # MCP 服务器配置
```

## 日志格式

日志以 JSONL 格式存储，便于解析：

```jsonl
{"type":"system","content":[{"type":"text","text":"开始执行"}],"timestamp":"2025-01-04T12:00:00.000Z"}
{"type":"assistant","message":{"content":[{"type":"text","text":"处理任务..."}]},"timestamp":"2025-01-04T12:00:01.000Z"}
{"type":"result","result":"任务成功完成","timestamp":"2025-01-04T12:00:05.000Z"}
```

## 开发

### 从源码构建

```bash
# 安装依赖
npm install

# 编译 TypeScript
npm run compile

# 开发模式监听
npm run watch

# 打包扩展
npm run package
```

### 测试

```bash
# 运行测试
npm test

# 运行覆盖率测试
npm run test:coverage
```

## 故障排除

### Claude Code CLI 未找到
- 确保已安装 Claude CLI：`npm install -g @anthropic/claude-cli`
- 检查设置中的可执行文件路径

### 代理未显示
- 验证代理文件在 `.jarvis/agents/` 中
- 检查文件格式（JSON 或 Markdown）
- 查找代理定义中的语法错误

### TODO 未更新
- 确保 TODO 文件使用正确的 Markdown 语法
- 检查文件权限
- 手动刷新 TODO 视图

### 🆕 自动执行不工作
- 检查 `jarvis.autoExecute.enabled` 是否设置为 `true`
- 验证 `jarvis.autoExecute.agentName` 是否匹配现有代理
- 使用"Show Auto-Execute Status"命令检查文件变化
- 确保代理文件在正确目录中
- 检查频率设置（`daily`、`hourly`、`manual`）

### 🆕 手动触发失败
- 确认代理名称正确
- 检查代理是否已在运行
- 验证代理存在且配置正确
- 检查 VSCode 输出面板中的错误详情

## 贡献

欢迎贡献！请：

1. Fork 仓库
2. 创建功能分支
3. 进行更改
4. 添加测试
5. 提交拉取请求

## 许可证

MIT 许可证 - 详见 LICENSE 文件

## 支持

- **问题反馈**：[GitHub Issues](https://github.com/your-org/jarvis-vscode/issues)
- **文档**：[Wiki](https://github.com/your-org/jarvis-vscode/wiki)
- **🆕 自动执行指南**：[docs/agent-auto-execute-guide.md](docs/agent-auto-execute-guide.md)
- **🆕 快速参考**：[docs/agent-auto-execute-quick-reference.md](docs/agent-auto-execute-quick-reference.md)
- **🆕 常见问题**：[docs/agent-auto-execute-faq.md](docs/agent-auto-execute-faq.md)
- **Discord**：[社区服务器](https://discord.gg/jarvis)

## 致谢

- 基于 [Claude Code](https://claude.ai) 集成构建
- 由 VSCode 扩展 API 提供支持
- 图标来自 VSCode Codicons

---

由 Jarvis 团队用 ❤️ 制作
