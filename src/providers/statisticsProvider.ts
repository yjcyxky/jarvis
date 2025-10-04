import * as vscode from 'vscode';
import { AgentManager } from '../executors/agentManager';
import { TodoManager } from '../executors/todoManager';

export class StatisticsTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly value: string | number,
    public readonly icon?: vscode.ThemeIcon
  ) {
    super(`${label}: ${value}`, vscode.TreeItemCollapsibleState.None);
    this.iconPath = icon;
    this.contextValue = 'statistic';
  }
}

export class StatisticsProvider implements vscode.TreeDataProvider<StatisticsTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<StatisticsTreeItem | undefined | null | void> =
    new vscode.EventEmitter<StatisticsTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<StatisticsTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private refreshTimer?: NodeJS.Timeout;

  constructor(
    private agentManager: AgentManager,
    private todoManager: TodoManager
  ) {
    this.startAutoRefresh();
  }

  private startAutoRefresh(): void {
    const config = vscode.workspace.getConfiguration('jarvis.ui');
    if (config.get<boolean>('autoRefresh', true)) {
      const interval = config.get<number>('refreshInterval', 5000); // Less frequent for stats
      this.refreshTimer = setInterval(() => {
        this.refresh();
      }, interval);
    }
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: StatisticsTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: StatisticsTreeItem): Thenable<StatisticsTreeItem[]> {
    if (!element) {
      const items: StatisticsTreeItem[] = [];

      // Agent statistics
      const agents = this.agentManager.getAgents();
      const agentStatuses = this.agentManager.getAllStatuses();
      const runningAgents = agentStatuses.filter(s => s.state === 'running').length;
      const errorAgents = agentStatuses.filter(s => s.state === 'error').length;

      items.push(
        new StatisticsTreeItem(
          '📦 Agents',
          '',
          new vscode.ThemeIcon('robot')
        )
      );
      items.push(
        new StatisticsTreeItem(
          '  Total',
          agents.length,
          new vscode.ThemeIcon('symbol-numeric')
        )
      );
      items.push(
        new StatisticsTreeItem(
          '  Running',
          runningAgents,
          new vscode.ThemeIcon('debug-start', new vscode.ThemeColor('charts.green'))
        )
      );
      if (errorAgents > 0) {
        items.push(
          new StatisticsTreeItem(
            '  Errors',
            errorAgents,
            new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'))
          )
        );
      }

      // Separator
      items.push(
        new StatisticsTreeItem('', '', undefined)
      );

      // TODO statistics
      const todoStats = this.todoManager.getStatistics();

      items.push(
        new StatisticsTreeItem(
          '✅ TODOs',
          '',
          new vscode.ThemeIcon('checklist')
        )
      );
      items.push(
        new StatisticsTreeItem(
          '  Total',
          todoStats.total,
          new vscode.ThemeIcon('symbol-numeric')
        )
      );
      items.push(
        new StatisticsTreeItem(
          '  Completed',
          `${todoStats.completed}/${todoStats.total} (${this.getPercentage(todoStats.completed, todoStats.total)}%)`,
          new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'))
        )
      );
      items.push(
        new StatisticsTreeItem(
          '  Pending',
          todoStats.pending,
          new vscode.ThemeIcon('circle-outline')
        )
      );
      if (todoStats.running > 0) {
        items.push(
          new StatisticsTreeItem(
            '  Running',
            todoStats.running,
            new vscode.ThemeIcon('sync~spin')
          )
        );
      }
      if (todoStats.failed > 0) {
        items.push(
          new StatisticsTreeItem(
            '  Failed',
            todoStats.failed,
            new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'))
          )
        );
      }

      // Progress bar
      const progress = this.getProgressBar(todoStats.completed, todoStats.total);
      items.push(
        new StatisticsTreeItem(
          '  Progress',
          progress,
          new vscode.ThemeIcon('graph')
        )
      );

      return Promise.resolve(items);
    }
    return Promise.resolve([]);
  }

  private getPercentage(completed: number, total: number): number {
    if (total === 0) return 0;
    return Math.round((completed / total) * 100);
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
  }
}