# Agent 自动执行 - 快速参考

## 🚀 快速开始

### 1. 启用自动执行
```json
{
  "jarvis.autoExecute.enabled": true,
  "jarvis.autoExecute.agentName": "your-agent-name",
  "jarvis.autoExecute.frequency": "daily"
}
```

### 2. 手动触发
- **命令面板**：`Ctrl/Cmd + Shift + P` → "Jarvis: Trigger Manual Execute"
- **快速访问**：点击 Jarvis 按钮 → "Trigger Auto-Execute"

### 3. 查看状态
- **命令面板**：`Ctrl/Cmd + Shift + P` → "Jarvis: Show Auto-Execute Status"
- **快速访问**：点击 Jarvis 按钮 → "Show Auto-Execute Status"

## ⚙️ 配置选项

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `jarvis.autoExecute.enabled` | `true/false` | 启用/禁用自动执行 |
| `jarvis.autoExecute.agentName` | `"agent-name"` | 要执行的 agent 名称 |
| `jarvis.autoExecute.frequency` | `"daily"/"hourly"/"manual"` | 执行频率 |

## 🎯 执行条件

自动执行需要满足：
1. ✅ 功能已启用
2. ✅ Agent 存在且未运行
3. ✅ **检测到文件变化**
4. ✅ **变化时间 > 上次执行时间**
5. ✅ 满足频率限制

## 📋 常用场景

### 文档生成
```json
{
  "jarvis.autoExecute.enabled": true,
  "jarvis.autoExecute.agentName": "generate-claude-md",
  "jarvis.autoExecute.frequency": "daily"
}
```

### 配置同步
```json
{
  "jarvis.autoExecute.enabled": true,
  "jarvis.autoExecute.agentName": "config-sync",
  "jarvis.autoExecute.frequency": "hourly"
}
```

### 手动控制
```json
{
  "jarvis.autoExecute.enabled": true,
  "jarvis.autoExecute.agentName": "test-runner",
  "jarvis.autoExecute.frequency": "manual"
}
```

## 🔍 故障排除

### 不执行？
- 检查是否启用：`jarvis.autoExecute.enabled: true`
- 确认 agent 名称正确
- 查看状态信息
- 检查是否有文件变化

### 执行太频繁？
- 设置频率为 `daily`
- 检查文件变化情况
- 查看执行历史

### 手动触发失败？
- 确认 agent 存在
- 检查 agent 是否在运行
- 查看错误日志

## 📊 状态信息

状态查看显示：
- 启用状态
- Agent 名称
- 执行频率
- 最后文件变化时间
- 最后执行时间
- 是否有待处理变化

## 💡 提示

- 只有在文件**实际变化**时才执行
- 手动触发不受频率限制
- 配置修改后自动生效
- 查看日志了解详细信息
