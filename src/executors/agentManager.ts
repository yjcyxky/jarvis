import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { AgentConfig, AgentStatus } from '../types';
import { LogViewer } from '../utils/logViewer';
import { HistoryStore, ExecutionHistoryEntry } from '../utils/historyStore';
import { ClaudeCodeExecutor } from './claudeCodeExecutor';
import { Logger } from '../utils/logger';

export class AgentManager {
  private agents: Map<string, AgentConfig> = new Map();
  private statuses: Map<string, AgentStatus> = new Map();
  private executor: ClaudeCodeExecutor;
  private watcher?: vscode.FileSystemWatcher;
  private readonly agentSources: Map<string, string> = new Map();
  private changeVersion = 0;
  private readonly _onDidChange = new vscode.EventEmitter<void>();

  readonly onDidChange: vscode.Event<void> = this._onDidChange.event;

  constructor(
    private workspaceRoot: string,
    private readonly logViewer: LogViewer,
    private readonly historyStore: HistoryStore
  ) {
    this.executor = new ClaudeCodeExecutor();
    this.loadAgents();
    this.setupWatcher();
  }

  private getAgentDir(): string {
    const config = vscode.workspace.getConfiguration('jarvis.paths');
    const agentDir = config.get<string>('agentDir', '.jarvis/agents');
    return path.join(this.workspaceRoot, agentDir);
  }

  private getLogDir(): string {
    const config = vscode.workspace.getConfiguration('jarvis.paths');
    const logDir = config.get<string>('logDir', '.jarvis/agent-logs');
    return path.join(this.workspaceRoot, logDir);
  }

  private setupWatcher(): void {
    const agentDir = this.getAgentDir();
    const pattern = new vscode.RelativePattern(agentDir, '**/*.{json,md}');

    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

    this.watcher.onDidCreate(() => this.loadAgents());
    this.watcher.onDidChange(() => this.loadAgents());
    this.watcher.onDidDelete(() => this.loadAgents());
  }

  private loadAgents(): void {
    const agentDir = this.getAgentDir();

    if (!fs.existsSync(agentDir)) {
      fs.mkdirSync(agentDir, { recursive: true });
      this.markChanged();
      return;
    }

    this.agents.clear();
    this.agentSources.clear();

    const files = fs.readdirSync(agentDir);
    for (const file of files) {
      if (file.endsWith('.json') || file.endsWith('.md')) {
        try {
          const filePath = path.join(agentDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');

          let agent: AgentConfig;

          if (file.endsWith('.json')) {
            const parsed = JSON.parse(content);
            agent = {
              ...parsed,
              sourcePath: filePath
            };
          } else {
            // Parse markdown format
            agent = this.parseMarkdownAgent(content, file, filePath);
          }

          this.agents.set(agent.name, agent);
          this.agentSources.set(agent.name, filePath);

          // Initialize status if not exists
          if (!this.statuses.has(agent.name)) {
            this.statuses.set(agent.name, {
              name: agent.name,
              state: 'idle'
            });
          }
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to load agent ${file}: ${error}`);
        }
      }
    }

    this.markChanged();
  }

  private parseMarkdownAgent(content: string, filename: string, filePath: string): AgentConfig {
    // Extract name from filename or first heading
    const nameMatch = content.match(/^#\s+(.+)$/m);
    const name = nameMatch ? nameMatch[1] : path.basename(filename, path.extname(filename));

    // Extract description from second paragraph or first non-heading content
    const descMatch = content.match(/^#+\s+Description\s*\n+(.+?)(?:\n#|\n\n#|\n$)/ms);
    const description = descMatch ? descMatch[1].trim() : '';

    // Extract prompt from the rest of the content
    const promptMatch = content.match(/^#+\s+Prompt\s*\n+([\s\S]+)$/m);
    const prompt = promptMatch ? promptMatch[1].trim() : content;

    // Extract parameters if present
    const paramsMatch = content.match(/^#+\s+Parameters\s*\n+```json\s*\n([\s\S]+?)\n```/m);
    let parameters = {};
    if (paramsMatch) {
      try {
        parameters = JSON.parse(paramsMatch[1]);
      } catch (error) {
        // Ignore parse errors
      }
    }

    // Extract tags if present
    const tagsMatch = content.match(/^#+\s+Tags\s*\n+(.+)$/m);
    const tags = tagsMatch ? tagsMatch[1].split(',').map(t => t.trim()) : [];

    return {
      name,
      description,
      prompt,
      parameters,
      tags,
      sourcePath: filePath
    };
  }

  getAgents(): AgentConfig[] {
    return Array.from(this.agents.values());
  }

  getAgent(name: string): AgentConfig | undefined {
    return this.agents.get(name);
  }

  getStatus(name: string): AgentStatus | undefined {
    return this.statuses.get(name);
  }

  getAllStatuses(): AgentStatus[] {
    return Array.from(this.statuses.values());
  }

  async startAgent(name: string): Promise<void> {
    const agent = this.agents.get(name);
    if (!agent) {
      throw new Error(`Agent ${name} not found`);
    }

    const status = this.statuses.get(name);
    if (status?.state === 'running') {
      vscode.window.showWarningMessage(`Agent ${name} is already running`);
      return;
    }

    // Create log file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(this.getLogDir(), name, `${timestamp}.jsonl`);
    const sourcePath = agent.sourcePath || this.agentSources.get(name);
    const versionHash = this.computeVersionHash(agent, sourcePath);

    const historyEntry = this.historyStore.beginExecution({
      type: 'agent',
      targetId: name,
      label: agent.name,
      sourceFile: sourcePath,
      logFile,
      versionHash
    });

    // Update status
    this.statuses.set(name, {
      name,
      state: 'running',
      startTime: new Date(),
      logFile,
      historyId: historyEntry.id
    });
    this.markChanged();

    const title = agent.description ? `${agent.name} — ${agent.description}` : agent.name;
    void this.logViewer.openLog({
      type: 'agent',
      id: name,
      title,
      logFile,
      run: {
        status: 'running',
        startTime: historyEntry.startTime,
        versionHash,
        sourceFile: sourcePath
      }
    });

    try {
      await this.executor.execute(
        `agent-${name}`,
        agent.prompt,
        agent.parameters,
        logFile
      );

      // Update status on completion
      const completedAt = new Date();
      this.statuses.set(name, {
        name,
        state: 'idle',
        logFile,
        lastCompleted: completedAt,
        historyId: historyEntry.id
      });
      this.historyStore.completeExecution(historyEntry.id, {
        status: 'success',
        endTime: completedAt.toISOString()
      });
      this.logViewer.updateRunContext('agent', name, {
        status: 'success',
        endTime: completedAt.toISOString()
      });
      this.markChanged();

      vscode.window.showInformationMessage(`Agent ${name} completed successfully`);
    } catch (error) {
      // Update status on error
      const completedAt = new Date();
      this.statuses.set(name, {
        name,
        state: 'error',
        error: error instanceof Error ? error.message : String(error),
        logFile,
        lastCompleted: completedAt,
        historyId: historyEntry.id
      });
      this.historyStore.completeExecution(historyEntry.id, {
        status: 'failed',
        metadata: {
          error: error instanceof Error ? error.message : String(error)
        },
        endTime: completedAt.toISOString()
      });
      this.logViewer.updateRunContext('agent', name, {
        status: 'failed',
        endTime: completedAt.toISOString(),
        error: error instanceof Error ? error.message : String(error)
      });
      this.markChanged();

      vscode.window.showErrorMessage(`Agent ${name} failed: ${error}`);
    }
  }

  async stopAgent(name: string): Promise<void> {
    const status = this.statuses.get(name);
    if (status?.state !== 'running') {
      vscode.window.showWarningMessage(`Agent ${name} is not running`);
      return;
    }

    await this.executor.stop(`agent-${name}`);

    // Update status
    const endedAt = new Date();
    this.statuses.set(name, {
      name,
      state: 'idle',
      logFile: status?.logFile,
      lastCompleted: endedAt,
      historyId: status?.historyId
    });
    if (status?.historyId) {
      this.historyStore.completeExecution(status.historyId, {
        status: 'stopped',
        endTime: endedAt.toISOString()
      });
      this.logViewer.updateRunContext('agent', name, {
        status: 'stopped',
        endTime: endedAt.toISOString()
      });
    }
    this.markChanged();

    vscode.window.showInformationMessage(`Agent ${name} stopped`);
  }

  async stopAllAgents(): Promise<void> {
    for (const status of this.statuses.values()) {
      if (status.state === 'running') {
        await this.stopAgent(status.name);
      }
    }
  }

  refresh(): void {
    this.loadAgents();
  }

  dispose(): void {
    this.stopAllAgents();
    this.watcher?.dispose();
    this.executor.dispose();
    this._onDidChange.dispose();
  }

  getHistory(name: string): ExecutionHistoryEntry[] {
    return this.historyStore.getHistory('agent', name);
  }

  getAllHistory(): ExecutionHistoryEntry[] {
    const allHistory: ExecutionHistoryEntry[] = [];
    this.agents.forEach((_agent, name) => {
      const history = this.getHistory(name);
      allHistory.push(...history);
    });
    return allHistory;
  }

  getAgentSource(name: string): string | undefined {
    const agent = this.agents.get(name);
    return agent?.sourcePath || this.agentSources.get(name);
  }

  getChangeVersion(): number {
    return this.changeVersion;
  }

  private markChanged(): void {
    this.changeVersion++;
    this._onDidChange.fire();
  }

  private computeVersionHash(agent: AgentConfig, sourcePath?: string): string | undefined {
    try {
      if (sourcePath && fs.existsSync(sourcePath)) {
        const content = fs.readFileSync(sourcePath, 'utf8');
        return crypto.createHash('md5').update(content).digest('hex');
      }

      if (agent.prompt) {
        return crypto.createHash('md5').update(agent.prompt).digest('hex');
      }
    } catch (error) {
      console.error('Failed to compute agent version hash', error);
    }

    return undefined;
  }
}
