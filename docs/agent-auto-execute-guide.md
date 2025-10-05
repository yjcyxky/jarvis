# Agent 自动执行功能使用指南

## 📖 功能简介

Agent 自动执行功能允许你配置一个特定的 agent，当项目中的 agent 文件发生变化时，系统会自动执行该 agent 来更新相关文档或执行其他任务。这个功能特别适合文档生成、配置同步等需要响应文件变化的场景。

## 🎯 核心特性

- **智能触发**：只有在文件实际发生变化时才执行
- **频率控制**：支持每日、每小时或手动执行模式
- **防重复执行**：避免 agent 重复运行和资源浪费
- **状态透明**：可以随时查看执行状态和文件变化情况
- **手动控制**：支持手动触发，不受频率限制

## ⚙️ 配置方法

### 方法一：VS Code 设置

1. 打开 VS Code 设置（`Ctrl/Cmd + ,`）
2. 搜索 "jarvis"
3. 找到 "Auto Execute" 相关设置
4. 配置以下选项：

```json
{
  "jarvis.autoExecute.enabled": true,
  "jarvis.autoExecute.agentName": "generate-claude-md",
  "jarvis.autoExecute.frequency": "daily"
}
```

### 方法二：项目配置文件

在项目根目录创建或编辑 `.vscode/settings.json` 文件：

```json
{
  "jarvis.paths.agentDir": ".jarvis/agents",
  "jarvis.autoExecute.enabled": true,
  "jarvis.autoExecute.agentName": "generate-claude-md",
  "jarvis.autoExecute.frequency": "daily"
}
```

## 🔧 配置选项详解

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `jarvis.autoExecute.enabled` | 布尔值 | false | 是否启用自动执行功能 |
| `jarvis.autoExecute.agentName` | 字符串 | "" | 要自动执行的 agent 名称 |
| `jarvis.autoExecute.frequency` | 字符串 | "daily" | 执行频率：hourly/daily/manual |
| `jarvis.paths.agentDir` | 字符串 | ".jarvis/agents" | Agent 文件所在目录 |

### 频率选项说明

- **daily（每日）**：每24小时最多执行一次，适合文档生成等低频任务
- **hourly（每小时）**：每1小时最多执行一次，适合需要较频繁更新的任务
- **manual（手动）**：禁用自动执行，仅支持手动触发

## 🚀 使用方法

### 1. 启用自动执行

1. 确保你的项目中有 agent 文件（`.md` 或 `.json` 格式）
2. 配置自动执行设置
3. 修改 agent 目录中的任何文件
4. 系统会自动检测变化并执行配置的 agent

### 2. 手动触发执行

#### 通过命令面板
1. 按 `Ctrl/Cmd + Shift + P` 打开命令面板
2. 输入 "Jarvis: Trigger Manual Execute"
3. 选择命令执行

#### 通过快速访问菜单
1. 点击 VS Code 侧边栏的 Jarvis 按钮
2. 选择 "Trigger Auto-Execute" 或 "Trigger Manual Execute"

### 3. 查看执行状态

#### 状态信息包括
- 自动执行是否启用
- 配置的 agent 名称
- 执行频率设置
- 最后一次文件变化时间
- 最后一次执行时间
- 是否有待处理的文件变化

#### 查看方法
1. 命令面板：`Ctrl/Cmd + Shift + P` → "Jarvis: Show Auto-Execute Status"
2. 快速访问：点击 Jarvis 按钮 → "Show Auto-Execute Status"

## 📋 使用场景

### 场景1：自动生成文档

**配置示例**：
```json
{
  "jarvis.autoExecute.enabled": true,
  "jarvis.autoExecute.agentName": "generate-claude-md",
  "jarvis.autoExecute.frequency": "daily"
}
```

**使用流程**：
1. 在 `.jarvis/agents` 目录中创建或修改 agent 文件
2. 系统检测到变化后，自动执行 `generate-claude-md` agent
3. 生成最新的 `CLAUDE.md` 文档
4. 每天最多执行一次，避免过度执行

### 场景2：配置同步

**配置示例**：
```json
{
  "jarvis.autoExecute.enabled": true,
  "jarvis.autoExecute.agentName": "config-sync",
  "jarvis.autoExecute.frequency": "hourly"
}
```

**使用流程**：
1. 修改配置文件
2. 系统每小时最多执行一次同步任务
3. 保持配置的一致性

### 场景3：测试和调试

**配置示例**：
```json
{
  "jarvis.autoExecute.enabled": true,
  "jarvis.autoExecute.agentName": "test-runner",
  "jarvis.autoExecute.frequency": "manual"
}
```

**使用流程**：
1. 设置为手动模式
2. 需要时手动触发执行
3. 完全控制执行时机

## 🔍 工作原理

### 执行条件

系统只有在以下条件**全部满足**时才会自动执行：

1. ✅ 自动执行功能已启用
2. ✅ 配置了目标 agent 名称
3. ✅ 目标 agent 存在且未在运行
4. ✅ **检测到文件变化**（新增/修改/删除）
5. ✅ **文件变化时间晚于上次执行时间**
6. ✅ 满足频率限制（daily/hourly）

### 智能跳过机制

系统会在以下情况下跳过执行：

- 文件没有变化
- Agent 已在运行
- 不满足频率限制
- 文件变化已被处理过

## 🛠️ 故障排除

### 常见问题

#### 1. 自动执行不工作

**可能原因**：
- 自动执行功能未启用
- Agent 名称配置错误
- 目标 agent 不存在

**解决方法**：
1. 检查 `jarvis.autoExecute.enabled` 是否为 `true`
2. 确认 `jarvis.autoExecute.agentName` 配置正确
3. 验证目标 agent 是否存在
4. 查看状态信息了解详情

#### 2. 执行过于频繁

**可能原因**：
- 频率设置过低
- 多个文件同时变化

**解决方法**：
1. 将频率设置为 `daily`
2. 检查是否有不必要的文件变化
3. 使用状态查看了解执行历史

#### 3. 手动触发失败

**可能原因**：
- Agent 名称错误
- Agent 已在运行
- Agent 不存在

**解决方法**：
1. 确认 agent 名称正确
2. 检查 agent 是否已在运行
3. 查看错误日志获取详细信息

### 调试步骤

1. **查看状态**：使用 "Show Auto-Execute Status" 命令
2. **检查日志**：查看 VS Code 输出面板中的 "Jarvis - Agent Manager"
3. **手动测试**：使用手动触发功能测试
4. **验证配置**：确认所有配置项设置正确

## 📊 监控和日志

### 日志位置

- **VS Code 输出面板**：选择 "Jarvis - Agent Manager" 频道
- **日志文件**：`.jarvis/agent-logs/` 目录

### 日志内容

- 文件变化检测
- 执行决策过程
- 频率检查结果
- 执行成功/失败信息
- 错误详情

## 💡 最佳实践

### 1. 频率选择建议

- **文档生成**：使用 `daily` 频率
- **配置同步**：使用 `hourly` 频率
- **测试调试**：使用 `manual` 模式

### 2. 性能优化

- 避免配置执行时间过长的 agent
- 合理设置频率，避免过度执行
- 定期清理日志文件

### 3. 错误处理

- 检查 agent 是否存在且配置正确
- 查看执行日志排查问题
- 使用手动触发进行测试

## 🔄 更新和维护

### 配置更新

修改配置后，系统会自动重新加载，无需重启 VS Code。

### 版本兼容性

- 支持 VS Code 1.85.0 及以上版本
- 向后兼容现有 agent 配置

## 📞 获取帮助

如果遇到问题，可以：

1. 查看本文档的故障排除部分
2. 检查 VS Code 输出面板中的日志
3. 使用状态查看命令了解详细信息
4. 尝试手动触发进行测试

---

**注意**：这个功能设计为智能且高效，只在真正需要时才执行 agent，避免不必要的资源消耗。通过合理配置和使用，可以大大提高工作效率。
