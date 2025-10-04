# Jarvis - AI Agent Manager for VSCode

A powerful VSCode extension for managing and executing AI-based agents with Claude Code integration. Jarvis provides a comprehensive interface for running subagents, managing TODO tasks, and tracking execution logs.

## Features

### 🤖 Agent Management
- **Auto-discovery** of agent configurations from `.jarvis/agents/`
- **Real-time status monitoring** (idle, running, error, paused)
- **One-click execution** with customizable parameters
- Support for both JSON and Markdown agent definitions
- Structured logging with JSONL format

### ✅ TODO Task Management
- Parse standard Markdown TODO syntax
- **Priority levels** (HIGH, MEDIUM, LOW)
- **Nested task support** with subtasks
- **Execution tracking** with status indicators
- Automatic task completion on successful execution

### 📊 Statistics Dashboard
- Real-time agent and TODO statistics
- Progress tracking with visual indicators
- Execution history and error reporting

### 🔧 Claude Code Integration
- Seamless integration with Claude Code CLI
- Configurable execution parameters
- Stream JSON output processing
- MCP (Model Context Protocol) support

## Installation

1. Install the extension from the VSCode Marketplace
2. Install Claude Code CLI:
   ```bash
   npm install -g @anthropic/claude-cli
   ```
3. Open a workspace folder in VSCode
4. Jarvis will automatically activate and create the `.jarvis` directory structure

## Quick Start

### Setting Up Agents

Create agent configurations in `.jarvis/agents/`:

**JSON Format** (`.jarvis/agents/my-agent.json`):
```json
{
  "name": "Code Reviewer",
  "description": "Reviews code for quality and best practices",
  "prompt": "Review the current codebase and provide feedback",
  "parameters": {
    "--model": "claude-sonnet-4-5-20250929",
    "--temperature": 0.3
  },
  "tags": ["review", "quality"]
}
```

**Markdown Format** (`.jarvis/agents/my-agent.md`):
```markdown
# Data Processor

## Description
Processes and transforms data files

## Prompt
Process the data files in the input directory and generate reports

## Parameters
\`\`\`json
{
  "--model": "claude-sonnet-4-5-20250929",
  "--max-tokens": 4096
}
\`\`\`

## Tags
data, processing, automation
```

### Creating TODOs

Add TODO files in `.jarvis/todos/`:

```markdown
# Project Tasks

- [ ] [HIGH] Implement authentication
  - [ ] Create login form
  - [ ] Add JWT handling
- [ ] [MEDIUM] Add tests
- [ ] [LOW] Update documentation
```

### Running Agents and TODOs

1. **Via UI**: Click the play button next to any agent or TODO in the sidebar
2. **Via Command Palette**:
   - `Jarvis: Start Agent`
   - `Jarvis: Execute TODO`
3. **Via Context Menu**: Right-click on items in the tree view

## Configuration

Configure Jarvis through VSCode settings (`Cmd/Ctrl + ,`):

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
  "jarvis.logs.retentionDays": 30
}
```

## MCP Configuration

Configure MCP servers in `.jarvis/mcp-config.json`:

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

## Commands

| Command | Description |
|---------|-------------|
| `Jarvis: Start Agent` | Start an agent execution |
| `Jarvis: Stop Agent` | Stop a running agent |
| `Jarvis: Execute TODO` | Execute a TODO task |
| `Jarvis: View Logs` | Open the logs directory |
| `Jarvis: Configure` | Open Jarvis settings |
| `Jarvis: Refresh Agents` | Reload agent configurations |
| `Jarvis: Refresh TODOs` | Reload TODO files |

## Directory Structure

```
.jarvis/
├── agents/              # Agent configuration files
│   ├── agent1.json
│   └── agent2.md
├── agent-logs/          # Agent execution logs
│   └── {agent-name}/
│       └── {timestamp}.jsonl
├── todos/               # TODO task files
│   ├── development.md
│   └── testing.md
├── todo-logs/           # TODO execution logs
│   └── {timestamp}_{task-id}.jsonl
└── mcp-config.json      # MCP server configuration
```

## Log Format

Logs are stored in JSONL format for easy parsing:

```jsonl
{"type":"system","content":[{"type":"text","text":"Starting execution"}],"timestamp":"2025-01-04T12:00:00.000Z"}
{"type":"assistant","message":{"content":[{"type":"text","text":"Processing task..."}]},"timestamp":"2025-01-04T12:00:01.000Z"}
{"type":"result","result":"Task completed successfully","timestamp":"2025-01-04T12:00:05.000Z"}
```

## Development

### Building from Source

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch mode for development
npm run watch

# Package extension
npm run package
```

### Testing

```bash
# Run tests
npm test

# Run with coverage
npm run test:coverage
```

## Troubleshooting

### Claude Code CLI Not Found
- Ensure Claude CLI is installed: `npm install -g @anthropic/claude-cli`
- Check the executable path in settings

### Agents Not Appearing
- Verify agent files are in `.jarvis/agents/`
- Check file format (JSON or Markdown)
- Look for syntax errors in agent definitions

### TODOs Not Updating
- Ensure TODO files use correct Markdown syntax
- Check file permissions
- Refresh the TODO view manually

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

- **Issues**: [GitHub Issues](https://github.com/your-org/jarvis-vscode/issues)
- **Documentation**: [Wiki](https://github.com/your-org/jarvis-vscode/wiki)
- **Discord**: [Community Server](https://discord.gg/jarvis)

## Acknowledgments

- Built with [Claude Code](https://claude.ai) integration
- Powered by the VSCode Extension API
- Icons from VSCode Codicons

---

Made with ❤️ by the Jarvis Team