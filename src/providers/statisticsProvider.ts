import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AgentManager } from '../executors/agentManager';
import { TodoManager } from '../executors/todoManager';
import { ClaudeJsonMessage } from '../types';
import { Logger } from '../utils/logger';

interface ClaudeUsageStats {
  totalTokens: number;
  totalCost: number;
  totalExecutions: number;
  averageTokensPerExecution: number;
  averageCostPerExecution: number;
  lastExecution?: Date;
  sessionStartTime: Date;
}

export class StatisticsTreeItem extends vscode.TreeItem {
  constructor(
    public readonly name: string,
    public readonly value: string | number,
    public readonly icon?: vscode.ThemeIcon
  ) {
    // Only append value if it's not empty
    const displayLabel = value !== '' && value !== undefined && value !== null
      ? `${name}: ${value}`
      : `${name}`;
    super(displayLabel, vscode.TreeItemCollapsibleState.None);
    this.iconPath = icon;
    this.contextValue = 'statistic';

    // Debug logging
    const logger = Logger.getInstance();
    logger.debug('StatisticsTreeItem', `Created item: label="${name}", value="${value}", displayLabel="${displayLabel}"`);
  }
}

export class StatisticsProvider implements vscode.TreeDataProvider<StatisticsTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<StatisticsTreeItem | undefined | null | void> =
    new vscode.EventEmitter<StatisticsTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<StatisticsTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private refreshTimer?: NodeJS.Timeout;
  private readonly disposables: vscode.Disposable[] = [];
  private lastAgentVersion = -1;
  private lastTodoVersion = -1;
  private claudeUsageStats: ClaudeUsageStats = {
    totalTokens: 0,
    totalCost: 0,
    totalExecutions: 0,
    averageTokensPerExecution: 0,
    averageCostPerExecution: 0,
    sessionStartTime: new Date()
  };
  private workspaceRoot: string;
  private logger = Logger.getInstance();

  constructor(
    private agentManager: AgentManager,
    private todoManager: TodoManager
  ) {
    this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    this.logger.info('StatisticsProvider', `Initialized with workspace root: ${this.workspaceRoot}`);

    this.startAutoRefresh();
    this.disposables.push(
      this.agentManager.onDidChange(() => this.refresh(true))
    );
    this.disposables.push(
      this.todoManager.onDidChange(() => this.refresh(true))
    );
    this.updateClaudeStats();
    this.refresh(true);
  }

  private startAutoRefresh(): void {
    const config = vscode.workspace.getConfiguration('jarvis.ui');
    if (config.get<boolean>('autoRefresh', true)) {
      const interval = config.get<number>('refreshInterval', 5000); // Less frequent for stats
      this.refreshTimer = setInterval(() => {
        this.updateClaudeStats();
        this.refresh();
      }, interval);
    }
  }

  refresh(force = false): void {
    if (force) {
      this.lastAgentVersion = this.agentManager.getChangeVersion();
      this.lastTodoVersion = this.todoManager.getChangeVersion();
      this.updateClaudeStats();
      this._onDidChangeTreeData.fire();
      return;
    }

    const agentVersion = this.agentManager.getChangeVersion();
    const todoVersion = this.todoManager.getChangeVersion();

    if (agentVersion !== this.lastAgentVersion || todoVersion !== this.lastTodoVersion) {
      this.lastAgentVersion = agentVersion;
      this.lastTodoVersion = todoVersion;
      this.updateClaudeStats();
      this._onDidChangeTreeData.fire();
    }
  }

  private updateClaudeStats(): void {
    this.logger.info('StatisticsProvider', 'Starting Claude stats update...');

    // Support multiple possible locations
    const possibleRoots = [
      this.workspaceRoot
    ];

    let totalTokens = 0;
    let totalCost = 0;
    let totalExecutions = 0;
    let lastExecution: Date | undefined;
    const processedFiles = new Set<string>();

    // Helper function to recursively scan directories
    const scanDirectory = (dir: string): void => {
      if (!fs.existsSync(dir)) {
        this.logger.debug('StatisticsProvider', `Directory does not exist: ${dir}`);
        return;
      }

      this.logger.debug('StatisticsProvider', `Scanning directory: ${dir}`);

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        this.logger.debug('StatisticsProvider', `Found ${entries.length} entries in ${dir}`);

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            // Recursively scan subdirectories
            scanDirectory(fullPath);
          } else if (entry.isFile() && (entry.name.endsWith('.log') || entry.name.endsWith('.jsonl'))) {
            // Process log file
            if (!processedFiles.has(fullPath)) {
              processedFiles.add(fullPath);
              this.logger.debug('StatisticsProvider', `Processing log file: ${fullPath}`);
              const stats = this.parseLogFile(fullPath);

              this.logger.debug('StatisticsProvider', `File ${entry.name}: ${stats.tokens} tokens, $${stats.cost.toFixed(6)}`);

              if (stats.tokens > 0 || stats.cost > 0) {
                totalTokens += stats.tokens;
                totalCost += stats.cost;
                totalExecutions++;

                // Get file modification time as execution time
                const fileStat = fs.statSync(fullPath);
                if (!lastExecution || fileStat.mtime > lastExecution) {
                  lastExecution = fileStat.mtime;
                }
              }
            }
          }
        }
      } catch (error) {
        this.logger.error('StatisticsProvider', `Error scanning directory ${dir}`, error);
      }
    };

    // Scan all possible locations
    for (const root of possibleRoots) {
      this.logger.debug('StatisticsProvider', `Checking root: ${root}`);
      const agentLogDir = path.join(root, '.jarvis', 'agent-logs');
      const todoLogDir = path.join(root, '.jarvis', 'todo-logs');

      scanDirectory(agentLogDir);
      scanDirectory(todoLogDir);
    }

    // Also check history for any additional info
    const agentHistory = this.agentManager.getAllHistory();
    this.logger.debug('StatisticsProvider', `Found ${agentHistory.length} agent history entries`);
    agentHistory.forEach(entry => {
      if (entry.logFile && fs.existsSync(entry.logFile)) {
        // Skip if already processed
        if (!processedFiles.has(entry.logFile)) {
          processedFiles.add(entry.logFile);
          const stats = this.parseLogFile(entry.logFile);
          if (stats.tokens > 0 || stats.cost > 0) {
            totalTokens += stats.tokens;
            totalCost += stats.cost;
            totalExecutions++;
          }
        }

        const execDate = new Date(entry.startTime);
        if (!lastExecution || execDate > lastExecution) {
          lastExecution = execDate;
        }
      }
    });

    const todoHistory = this.todoManager.getAllHistory();
    this.logger.debug('StatisticsProvider', `Found ${todoHistory.length} todo history entries`);
    todoHistory.forEach(entry => {
      if (entry.logFile && fs.existsSync(entry.logFile)) {
        // Skip if already processed
        if (!processedFiles.has(entry.logFile)) {
          processedFiles.add(entry.logFile);
          const stats = this.parseLogFile(entry.logFile);
          if (stats.tokens > 0 || stats.cost > 0) {
            totalTokens += stats.tokens;
            totalCost += stats.cost;
            totalExecutions++;
          }
        }

        const execDate = new Date(entry.startTime);
        if (!lastExecution || execDate > lastExecution) {
          lastExecution = execDate;
        }
      }
    });

    this.logger.info('StatisticsProvider',
      `Stats Update Complete: ${totalTokens} tokens, ${totalExecutions} executions, $${totalCost.toFixed(4)} cost`);
    this.logger.info('StatisticsProvider',
      `Processed ${processedFiles.size} files`);

    this.claudeUsageStats = {
      totalTokens,
      totalCost,
      totalExecutions,
      averageTokensPerExecution: totalExecutions > 0 ? Math.round(totalTokens / totalExecutions) : 0,
      averageCostPerExecution: totalExecutions > 0 ? totalCost / totalExecutions : 0,
      lastExecution,
      sessionStartTime: this.claudeUsageStats.sessionStartTime
    };

    this.logger.debug('StatisticsProvider', `Updated stats: ${JSON.stringify(this.claudeUsageStats)}`);
  }

  private parseLogFile(logFile: string): { tokens: number; cost: number } {
    try {
      const content = fs.readFileSync(logFile, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());

      this.logger.debug('StatisticsProvider', `Parsing ${path.basename(logFile)} with ${lines.length} lines`);

      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCacheReadTokens = 0;
      let totalCacheCreationTokens = 0;
      let totalCost = 0;
      let lineCount = 0;

      for (const line of lines) {
        lineCount++;
        try {
          const json = JSON.parse(line);

          // Check for the result summary with total cost
          if (json.type === 'result' && json.total_cost_usd !== undefined) {
            this.logger.debug('StatisticsProvider',
              `Found result with total_cost_usd: $${json.total_cost_usd}`);
            // Use the total cost directly if available
            if (totalCost === 0) { // Only use if we haven't found cost yet
              totalCost = json.total_cost_usd;
            }

            // Also extract usage from result
            if (json.usage) {
              totalInputTokens += json.usage.input_tokens || 0;
              totalOutputTokens += json.usage.output_tokens || 0;
              totalCacheReadTokens += json.usage.cache_read_input_tokens || 0;
              totalCacheCreationTokens += json.usage.cache_creation_input_tokens || 0;

              this.logger.debug('StatisticsProvider',
                `Result usage: input=${json.usage.input_tokens}, output=${json.usage.output_tokens}, cache_read=${json.usage.cache_read_input_tokens}`);
            }

            // Don't double-count modelUsage since we already have total_cost_usd
          }

          // Check for assistant messages with usage
          if (json.type === 'assistant' && json.message?.usage) {
            const usage = json.message.usage;
            totalInputTokens += usage.input_tokens || 0;
            totalOutputTokens += usage.output_tokens || 0;
            totalCacheReadTokens += usage.cache_read_input_tokens || 0;
            totalCacheCreationTokens += usage.cache_creation_input_tokens || 0;
          }

          // Check for other usage patterns
          const usage = json.usage || json.metadata?.tokenUsage || json.metadata?.token_usage;
          if (usage) {
            totalInputTokens += usage.input_tokens || usage.inputTokens || 0;
            totalOutputTokens += usage.output_tokens || usage.outputTokens || 0;
            totalCacheReadTokens += usage.cache_read_input_tokens || usage.cacheReadInputTokens || 0;
            totalCacheCreationTokens += usage.cache_creation_input_tokens || usage.cacheCreationInputTokens || 0;
          }
        } catch (e) {
          // Skip non-JSON lines
        }
      }

      const totalTokens = totalInputTokens + totalOutputTokens + totalCacheReadTokens + totalCacheCreationTokens;

      // If cost wasn't provided, estimate it
      if (totalCost === 0 && totalTokens > 0) {
        // Claude 3.5 Sonnet pricing: $3 per 1M input tokens, $15 per 1M output tokens
        const inputCost = ((totalInputTokens + totalCacheReadTokens) / 1000000) * 3;
        const outputCost = (totalOutputTokens / 1000000) * 15;
        const cacheCreationCost = (totalCacheCreationTokens / 1000000) * 3.75; // 25% more than input
        totalCost = inputCost + outputCost + cacheCreationCost;
      }

      this.logger.debug('StatisticsProvider',
        `Parsed ${path.basename(logFile)}: ${totalTokens} tokens, $${totalCost.toFixed(6)}`);

      return { tokens: totalTokens, cost: totalCost };
    } catch (error) {
      this.logger.error('StatisticsProvider', `Failed to parse log file ${logFile}`, error);
      return { tokens: 0, cost: 0 };
    }
  }

  getTreeItem(element: StatisticsTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: StatisticsTreeItem): Thenable<StatisticsTreeItem[]> {
    if (!element) {
      this.logger.debug('StatisticsProvider', `getChildren called with stats: ${JSON.stringify(this.claudeUsageStats)}`);

      const items: StatisticsTreeItem[] = [];

      // Claude Usage Statistics
      items.push(
        new StatisticsTreeItem(
          '🤖 Claude Usage',
          '',
          new vscode.ThemeIcon('robot')
        )
      );

      // Total Tokens
      const tokensValue = this.claudeUsageStats.totalTokens > 0
        ? this.formatNumber(this.claudeUsageStats.totalTokens)
        : '0';
      this.logger.debug('StatisticsProvider', `Total Tokens display value: ${tokensValue}`);

      items.push(
        new StatisticsTreeItem(
          '  Total Tokens',
          tokensValue,
          new vscode.ThemeIcon('symbol-numeric')
        )
      );

      // Total Cost
      items.push(
        new StatisticsTreeItem(
          '  Total Cost',
          this.claudeUsageStats.totalCost > 0
            ? `$${this.claudeUsageStats.totalCost.toFixed(4)}`
            : '$0.0000',
          new vscode.ThemeIcon('credit-card')
        )
      );

      // Total Executions
      items.push(
        new StatisticsTreeItem(
          '  Executions',
          this.claudeUsageStats.totalExecutions > 0
            ? this.claudeUsageStats.totalExecutions.toString()
            : '0',
          new vscode.ThemeIcon('play-circle')
        )
      );

      // Average Tokens per Execution
      if (this.claudeUsageStats.totalExecutions > 0) {
        items.push(
          new StatisticsTreeItem(
            '  Avg Tokens/Run',
            this.formatNumber(this.claudeUsageStats.averageTokensPerExecution),
            new vscode.ThemeIcon('dashboard')
          )
        );

        // Average Cost per Execution
        items.push(
          new StatisticsTreeItem(
            '  Avg Cost/Run',
            `$${this.claudeUsageStats.averageCostPerExecution.toFixed(4)}`,
            new vscode.ThemeIcon('graph-line')
          )
        );
      }

      // Last Execution
      if (this.claudeUsageStats.lastExecution) {
        items.push(
          new StatisticsTreeItem(
            '  Last Run',
            this.formatTimeSince(this.claudeUsageStats.lastExecution),
            new vscode.ThemeIcon('clock')
          )
        );
      }

      // Session Duration
      items.push(
        new StatisticsTreeItem(
          '  Session Time',
          this.formatDuration(Date.now() - this.claudeUsageStats.sessionStartTime.getTime()),
          new vscode.ThemeIcon('history')
        )
      );

      // Add note if no data
      if (this.claudeUsageStats.totalExecutions === 0) {
        items.push(
          new StatisticsTreeItem(
            '  ℹ️ Note',
            'Run agents/todos to see usage',
            undefined
          )
        );
      }

      // Separator
      items.push(
        new StatisticsTreeItem('', '', undefined)
      );

      // Active Tasks Summary
      const agents = this.agentManager.getAgents();
      const agentStatuses = this.agentManager.getAllStatuses();
      const runningAgents = agentStatuses.filter(s => s.state === 'running').length;
      const todoStats = this.todoManager.getStatistics();

      items.push(
        new StatisticsTreeItem(
          '📊 Active Tasks',
          '',
          new vscode.ThemeIcon('tasklist')
        )
      );

      items.push(
        new StatisticsTreeItem(
          '  Agents',
          `${runningAgents}/${agents.length} running`,
          new vscode.ThemeIcon('robot')
        )
      );

      items.push(
        new StatisticsTreeItem(
          '  TODOs',
          `${todoStats.completed}/${todoStats.total} complete`,
          new vscode.ThemeIcon('checklist')
        )
      );

      if (todoStats.running > 0) {
        items.push(
          new StatisticsTreeItem(
            '  In Progress',
            todoStats.running,
            new vscode.ThemeIcon('sync~spin')
          )
        );
      }

      // Progress bar
      const progress = this.getProgressBar(todoStats.completed, todoStats.total);
      items.push(
        new StatisticsTreeItem(
          '  Overall',
          progress,
          new vscode.ThemeIcon('graph')
        )
      );

      return Promise.resolve(items);
    }
    return Promise.resolve([]);
  }

  private formatNumber(num: number): string {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(2)}M`;
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
  }

  private formatTimeSince(date: Date): string {
    const diff = Date.now() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days} day${days > 1 ? 's' : ''} ago`;
    }
    if (hours > 0) {
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    }
    if (minutes > 0) {
      return `${minutes} min${minutes > 1 ? 's' : ''} ago`;
    }
    return 'Just now';
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }


  private getProgressBar(completed: number, total: number): string {
    if (total === 0) return '⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜';

    const percentage = (completed / total) * 100;
    const filled = Math.round(percentage / 10);
    const empty = 10 - filled;

    return '🟩'.repeat(filled) + '⬜'.repeat(empty);
  }

  dispose(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    this.disposables.forEach(d => d.dispose());
  }
}
