import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { AgentConfig, AgentStatus, ClaudeCommandOptions } from '../types';
import { LogViewer } from '../utils/logViewer';
import { HistoryStore, ExecutionHistoryEntry } from '../utils/historyStore';
import { ClaudeCodeExecutor } from './claudeCodeExecutor';
import { Logger } from '../utils/logger';
import * as yaml from 'yaml';

export class AgentManager {
  private agents: Map<string, AgentConfig> = new Map();
  private statuses: Map<string, AgentStatus> = new Map();
  private logger: Logger;
  private executor: ClaudeCodeExecutor;
  private watcher?: vscode.FileSystemWatcher;
  private logWatcher?: vscode.FileSystemWatcher;
  private readonly agentSources: Map<string, string> = new Map();
  private changeVersion = 0;
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  private autoExecuteAgent?: string; // 配置的自动执行 agent 名称
  private lastFileChangeTime?: Date; // 记录最后一次文件变化时间

  readonly onDidChange: vscode.Event<void> = this._onDidChange.event;

  constructor(
    private workspaceRoot: string,
    private readonly logViewer: LogViewer,
    private readonly historyStore: HistoryStore
  ) {
    this.logger = Logger.getInstance();
    this.executor = new ClaudeCodeExecutor();
    this.loadAgents();
    this.setupWatcher();
    this.loadAutoExecuteConfig();
    
    // 监听配置变化
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('jarvis.autoExecute') || e.affectsConfiguration('jarvis.paths')) {
        this.loadAutoExecuteConfig();
        this.logger.info("AgentManager", "Configuration reloaded");
      }
    });
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

  private loadAutoExecuteConfig(): void {
    const config = vscode.workspace.getConfiguration('jarvis.autoExecute');
    const enabled = config.get<boolean>('enabled', false);
    const agentName = config.get<string>('agentName');
    const frequency = config.get<'daily' | 'hourly' | 'manual'>('frequency', 'daily');
    
    if (enabled && agentName && frequency !== 'manual') {
      this.autoExecuteAgent = agentName;
    } else {
      this.autoExecuteAgent = undefined;
    }
  }

  private processTemplate(content: string, variables: Record<string, string>): string {
    let processed = content;
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      processed = processed.replace(new RegExp(placeholder, 'g'), value);
    }
    return processed;
  }

  private getTemplateVariables(): Record<string, string> {
    const config = vscode.workspace.getConfiguration('jarvis.paths');
    const agentDir = config.get<string>('agentDir', '.jarvis/agents');
    
    return {
      agentDir: agentDir
    };
  }

  private async autoExecuteIfConfigured(): Promise<void> {
    if (!this.autoExecuteAgent) {
      this.logger.info("AgentManager", "No auto-execute agent configured");
      return;
    }

    const agent = this.agents.get(this.autoExecuteAgent);
    if (!agent) {
      this.logger.warn("AgentManager", `Auto-execute agent '${this.autoExecuteAgent}' not found`);
      return;
    }

    // 检查 agent 是否已经在运行
    const status = this.statuses.get(this.autoExecuteAgent);
    if (status?.state === 'running') {
      this.logger.info("AgentManager", `Auto-execute agent '${this.autoExecuteAgent}' is already running, skipping`);
      return;
    }

    // 检查执行频率
    if (!this.shouldExecuteBasedOnFrequency()) {
      this.logger.info("AgentManager", `Auto-execute agent '${this.autoExecuteAgent}' skipped due to frequency limit`);
      return;
    }

    try {
      this.logger.info("AgentManager", `Auto-executing agent '${this.autoExecuteAgent}' due to directory changes`);
      await this.startAgent(this.autoExecuteAgent);
      this.updateLastExecutionTime();
    } catch (error) {
      this.logger.error("AgentManager", `Failed to auto-execute agent '${this.autoExecuteAgent}': ${error}`);
    }
  }

  private shouldExecuteBasedOnFrequency(): boolean {
    const config = vscode.workspace.getConfiguration('jarvis.autoExecute');
    const frequency = config.get<'daily' | 'hourly' | 'manual'>('frequency', 'daily');
    const lastExecution = config.get<string>('lastExecution');

    // 手动模式不自动执行
    if (frequency === 'manual') {
      return false;
    }

    // 如果没有文件变化记录，不执行
    if (!this.lastFileChangeTime) {
      this.logger.info("AgentManager", "No file changes detected, skipping auto-execute");
      return false;
    }

    // 如果没有执行记录，可以执行（首次执行）
    if (!lastExecution) {
      this.logger.info("AgentManager", "First execution, proceeding with auto-execute");
      return true;
    }

    const lastExecutionTime = new Date(lastExecution);
    const fileChangeTime = this.lastFileChangeTime;
    
    // 如果文件变化时间早于上次执行时间，说明没有新的变化
    if (fileChangeTime <= lastExecutionTime) {
      this.logger.info("AgentManager", "No new file changes since last execution, skipping auto-execute");
      return false;
    }

    // 检查频率限制
    const now = new Date();
    const timeDiff = now.getTime() - lastExecutionTime.getTime();

    switch (frequency) {
      case 'hourly':
        if (timeDiff < 60 * 60 * 1000) { // 1小时
          this.logger.info("AgentManager", "Hourly frequency limit not met, skipping auto-execute");
          return false;
        }
        break;
      case 'daily':
        if (timeDiff < 24 * 60 * 60 * 1000) { // 24小时
          this.logger.info("AgentManager", "Daily frequency limit not met, skipping auto-execute");
          return false;
        }
        break;
    }

    this.logger.info("AgentManager", "File changes detected and frequency limit met, proceeding with auto-execute");
    return true;
  }

  private updateLastExecutionTime(): void {
    const config = vscode.workspace.getConfiguration('jarvis.autoExecute');
    const now = new Date().toISOString();
    config.update('lastExecution', now, vscode.ConfigurationTarget.Workspace);
  }

  private setupWatcher(): void {
    const agentDir = this.getAgentDir();
    const pattern = new vscode.RelativePattern(agentDir, '**/*.{json,md}');

    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

    this.watcher.onDidCreate(() => {
      this.lastFileChangeTime = new Date();
      this.loadAgents();
      this.autoExecuteIfConfigured();
    });
    this.watcher.onDidChange(() => {
      this.lastFileChangeTime = new Date();
      this.loadAgents();
      this.autoExecuteIfConfigured();
    });
    this.watcher.onDidDelete(() => {
      this.lastFileChangeTime = new Date();
      this.loadAgents();
      this.autoExecuteIfConfigured();
    });

    const logDir = this.getLogDir();
    const logPattern = new vscode.RelativePattern(logDir, '**/*.jsonl');

    this.logWatcher = vscode.workspace.createFileSystemWatcher(logPattern);

    this.logWatcher.onDidCreate(() => {
      this.syncLogFiles();
    });
    this.logWatcher.onDidChange(() => {
      this.syncLogFiles();
    });
    this.logWatcher.onDidDelete(() => {
      this.syncLogFiles();
    });
  }

  private findAgentsFromResources(): string[] {
    const extensionPath = vscode.extensions.getExtension('OpenProphetDB.openjarvis')?.extensionPath;
    if (!extensionPath) {
      return [];
    }
    
    const resourcesDir = path.join(extensionPath, 'resources', 'templates');
    if (!fs.existsSync(resourcesDir)) {
      return [];
    }
    
    const files = fs.readdirSync(resourcesDir);
    const agentFiles = [];
    for (const file of files) {
      if (file.endsWith('.md')) {
        agentFiles.push(path.join(resourcesDir, file));
      }
    }

    this.logger.info("AgentManager", `Found ${agentFiles.length} agents in resources: ${agentFiles.join(', ')}`);
    return agentFiles;
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
    const filesFromResources = this.findAgentsFromResources();
    const allFiles = [...files, ...filesFromResources];
    for (const file of allFiles) {
      if (file.endsWith('.json') || file.endsWith('.md')) {
        try {
          const filePath = filesFromResources.includes(file) ? file : path.join(agentDir, file);
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
    // 提取 YAML frontmatter 和内容
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]+?)\n---\s*\n([\s\S]*)$/);

    if (!frontmatterMatch) {
      // 如果没有 frontmatter,尝试兼容旧格式或返回基本配置
      const processedContent = this.processTemplate(content.trim(), this.getTemplateVariables());
      return {
        name: path.basename(filename, path.extname(filename)),
        description: '',
        prompt: processedContent,
        tools: undefined, // undefined 表示继承所有工具
        model: undefined, // undefined 表示使用默认模型
        sourcePath: filePath
      };
    }

    const [, frontmatterStr, promptContent] = frontmatterMatch;

    // 解析 YAML frontmatter
    let frontmatter: any = {};
    try {
      frontmatter = yaml.parse(frontmatterStr);
    } catch (error) {
      this.logger.error("AgentManager", `Failed to parse YAML frontmatter in ${filename}:`, error as string);
      // 使用默认值
    }

    // 提取字段
    const name = frontmatter.name || path.basename(filename, path.extname(filename));
    const description = frontmatter.description || '';
    
    // 处理模板变量
    const templateVariables = this.getTemplateVariables();
    const processedPrompt = this.processTemplate(promptContent.trim(), templateVariables);

    // 处理 tools 字段
    // 可以是字符串(逗号分隔)或数组
    let tools: string[] | undefined = undefined;
    if (frontmatter.tools) {
      if (typeof frontmatter.tools === 'string') {
        tools = frontmatter.tools
          .split(',')
          .map((t: string) => t.trim())
          .filter((t: string) => t.length > 0);
      } else if (Array.isArray(frontmatter.tools)) {
        tools = frontmatter.tools;
      }
    }

    // 处理 model 字段
    const model = frontmatter.model || undefined;

    const agent: AgentConfig = {
      name,
      description,
      prompt: processedPrompt,
      tools,
      model,
      sourcePath: filePath
    };

    this.logger.info("AgentManager", `Loaded agent ${name}: ${JSON.stringify(agent)}`);

    return agent;
  }

  getAgents(): AgentConfig[] {
    return Array.from(this.agents.values());
  }

  getAgent(name: string): AgentConfig | undefined {
    return this.agents.get(name);
  }

  getAgentNames(): string[] {
    return Array.from(this.agents.keys());
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

    const commandOptions: ClaudeCommandOptions = {};
    if (agent.model) {
      commandOptions['--model'] = agent.model;
    }

    if (agent.tools) {
      commandOptions['--allowedTools'] = agent.tools;
    }

    try {
      await this.executor.execute(
        `agent-${name}`,
        agent.prompt,
        commandOptions,
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
    this.syncLogFiles();
  }

  async triggerAutoExecute(): Promise<void> {
    await this.autoExecuteIfConfigured();
  }

  async triggerManualExecute(): Promise<void> {
    const config = vscode.workspace.getConfiguration('jarvis.autoExecute');
    const agentName = config.get<string>('agentName');
    
    if (!agentName) {
      vscode.window.showErrorMessage('No auto-execute agent configured');
      return;
    }

    const agent = this.agents.get(agentName);
    if (!agent) {
      vscode.window.showErrorMessage(`Agent '${agentName}' not found`);
      return;
    }

    // 检查 agent 是否已经在运行
    const status = this.statuses.get(agentName);
    if (status?.state === 'running') {
      vscode.window.showWarningMessage(`Agent '${agentName}' is already running`);
      return;
    }

    try {
      vscode.window.showInformationMessage(`Manually executing agent '${agentName}'...`);
      await this.startAgent(agentName);
      this.updateLastExecutionTime();
      vscode.window.showInformationMessage(`Agent '${agentName}' executed successfully`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to execute agent '${agentName}': ${error}`);
    }
  }

  getAutoExecuteAgent(): string | undefined {
    return this.autoExecuteAgent;
  }

  getAutoExecuteConfig(): { agentName?: string; enabled: boolean; frequency: string; lastExecution?: string } {
    const config = vscode.workspace.getConfiguration('jarvis.autoExecute');
    return {
      agentName: config.get<string>('agentName'),
      enabled: config.get<boolean>('enabled', false),
      frequency: config.get<'daily' | 'hourly' | 'manual'>('frequency', 'daily'),
      lastExecution: config.get<string>('lastExecution')
    };
  }

  getFileChangeStatus(): { hasChanges: boolean; lastChangeTime?: Date; lastExecutionTime?: Date } {
    const config = vscode.workspace.getConfiguration('jarvis.autoExecute');
    const lastExecution = config.get<string>('lastExecution');
    
    return {
      hasChanges: this.lastFileChangeTime ? 
        (!lastExecution || this.lastFileChangeTime > new Date(lastExecution)) : false,
      lastChangeTime: this.lastFileChangeTime,
      lastExecutionTime: lastExecution ? new Date(lastExecution) : undefined
    };
  }

  /**
   * 同步日志文件状态，清理无效的历史记录
   */
  syncLogFiles(): void {
    const removedCount = this.historyStore.cleanupInvalidRecords();
    if (removedCount > 0) {
      this.logger.info('AgentManager', `Cleaned up ${removedCount} invalid history records`);
      this.markChanged();
    }
  }

  dispose(): void {
    this.stopAllAgents();
    this.watcher?.dispose();
    this.logWatcher?.dispose();
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

  notifyHistoryChange(): void {
    this.markChanged();
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
