# Agent 自动执行功能文档

## 📚 文档索引

### 📖 主要文档

1. **[完整使用指南](agent-auto-execute-guide.md)**
   - 功能简介和核心特性
   - 详细的配置方法
   - 使用场景和最佳实践
   - 故障排除指南

2. **[快速参考](agent-auto-execute-quick-reference.md)**
   - 快速开始步骤
   - 配置选项速查
   - 常用场景配置
   - 故障排除要点

3. **[常见问题解答](agent-auto-execute-faq.md)**
   - 基础问题解答
   - 配置问题解答
   - 使用问题解答
   - 故障排除问题解答

## 🎯 按需求选择文档

### 我是新用户
👉 从 **[完整使用指南](agent-auto-execute-guide.md)** 开始，了解功能的基本概念和使用方法。

### 我需要快速配置
👉 查看 **[快速参考](agent-auto-execute-quick-reference.md)**，快速找到配置选项和使用方法。

### 我遇到了问题
👉 查看 **[常见问题解答](agent-auto-execute-faq.md)**，寻找类似问题的解决方案。

### 我需要了解工作原理
👉 阅读 **[完整使用指南](agent-auto-execute-guide.md)** 中的"工作原理"部分。

## 🚀 快速开始

### 1. 启用功能
```json
{
  "jarvis.autoExecute.enabled": true,
  "jarvis.autoExecute.agentName": "your-agent-name",
  "jarvis.autoExecute.frequency": "daily"
}
```

### 2. 手动触发
- 命令面板：`Ctrl/Cmd + Shift + P` → "Jarvis: Trigger Manual Execute"
- 快速访问：点击 Jarvis 按钮 → "Trigger Auto-Execute"

### 3. 查看状态
- 命令面板：`Ctrl/Cmd + Shift + P` → "Jarvis: Show Auto-Execute Status"
- 快速访问：点击 Jarvis 按钮 → "Show Auto-Execute Status"

## 📋 功能特性

- ✅ **智能触发**：只在文件实际变化时执行
- ✅ **频率控制**：支持每日、每小时或手动模式
- ✅ **防重复执行**：避免 agent 重复运行
- ✅ **状态透明**：随时查看执行状态
- ✅ **手动控制**：支持手动触发

## 🔧 配置选项

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `jarvis.autoExecute.enabled` | boolean | false | 启用/禁用自动执行 |
| `jarvis.autoExecute.agentName` | string | "" | 要执行的 agent 名称 |
| `jarvis.autoExecute.frequency` | string | "daily" | 执行频率 |
| `jarvis.paths.agentDir` | string | ".jarvis/agents" | Agent 文件目录 |

## 📊 执行条件

自动执行需要满足：
1. ✅ 功能已启用
2. ✅ Agent 存在且未运行
3. ✅ **检测到文件变化**
4. ✅ **变化时间 > 上次执行时间**
5. ✅ 满足频率限制

## 🆘 获取帮助

如果文档中没有找到答案：
1. 查看 VS Code 输出面板中的 "Jarvis - Agent Manager" 日志
2. 使用状态查看命令了解详细信息
3. 尝试手动触发进行测试
4. 检查 agent 配置是否正确

---

**提示**：建议先阅读完整使用指南了解功能全貌，然后根据需要查阅其他文档。
