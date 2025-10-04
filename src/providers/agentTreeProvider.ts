import * as vscode from 'vscode';
import { AgentConfig, AgentStatus } from '../types';
import { AgentManager } from '../executors/agentManager';

export class AgentTreeItem extends vscode.TreeItem {
  constructor(
    public readonly agent: AgentConfig,
    public readonly status: AgentStatus,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly historyCount: number
  ) {
    super(agent.name, collapsibleState);

    const tooltipLines = [
      `${agent.name}: ${agent.description}`,
      `Status: ${status.state}`
    ];
    if (status.startTime) {
      tooltipLines.push(`Started: ${status.startTime.toLocaleString()}`);
    }
    if (status.lastCompleted) {
      tooltipLines.push(`Last finished: ${status.lastCompleted.toLocaleString()}`);
    }
    if (status.logFile) {
      tooltipLines.push(`Log: ${status.logFile}`);
    }
    tooltipLines.push(`Runs: ${historyCount}`);
    this.tooltip = tooltipLines.join('\n');
    const statusDescription = this.getStatusDescription();
    this.description = historyCount > 0 ? `${statusDescription} · ${historyCount} logs` : statusDescription;
    this.contextValue = `agent.${status.state}`;
    this.iconPath = this.getIcon();
    this.command = {
      command: 'jarvis.openAgentLog',
      title: 'Open Agent Log',
      arguments: [agent.name]
    };
  }

  private getStatusDescription(): string {
    switch (this.status.state) {
      case 'running':
        return '🔵 Running';
      case 'idle':
        return '⚪ Idle';
      case 'error':
        return '❌ Error';
      case 'paused':
        return '⏸️ Paused';
      default:
        return '';
    }
  }

  private getIcon(): vscode.ThemeIcon {
    switch (this.status.state) {
      case 'running':
        return new vscode.ThemeIcon('debug-start', new vscode.ThemeColor('charts.green'));
      case 'error':
        return new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
      case 'paused':
        return new vscode.ThemeIcon('debug-pause', new vscode.ThemeColor('charts.yellow'));
      default:
        return new vscode.ThemeIcon('robot');
    }
  }
}

export class ViewHistoryTreeItem extends vscode.TreeItem {
  constructor(
    public readonly targetType: 'agent' | 'todo',
    public readonly targetId: string,
    public readonly historyCount: number
  ) {
    super(`View History (${historyCount} runs)`, vscode.TreeItemCollapsibleState.None);

    this.description = 'Click to view execution history';
    this.contextValue = 'viewHistory';
    this.iconPath = new vscode.ThemeIcon('history');
    this.command = {
      command: 'jarvis.viewAgentHistory',
      title: 'View Agent History',
      arguments: [targetId]
    };
  }
}

export class AgentTreeProvider implements vscode.TreeDataProvider<AgentTreeItem | ViewHistoryTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<AgentTreeItem | ViewHistoryTreeItem | undefined | null | void> =
    new vscode.EventEmitter<AgentTreeItem | ViewHistoryTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<AgentTreeItem | ViewHistoryTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private refreshTimer?: NodeJS.Timeout;
  private readonly disposables: vscode.Disposable[] = [];
  private lastRenderedVersion = -1;

  constructor(private agentManager: AgentManager) {
    this.startAutoRefresh();
    this.disposables.push(
      this.agentManager.onDidChange(() => this.refresh())
    );
    this.refresh(true);
  }

  private startAutoRefresh(): void {
    const config = vscode.workspace.getConfiguration('jarvis.ui');
    if (config.get<boolean>('autoRefresh', true)) {
      const interval = config.get<number>('refreshInterval', 1000);
      this.refreshTimer = setInterval(() => {
        this.refresh();
      }, interval);
    }
  }

  refresh(force = false): void {
    if (force) {
      this.lastRenderedVersion = this.agentManager.getChangeVersion();
      this._onDidChangeTreeData.fire();
      return;
    }

    const version = this.agentManager.getChangeVersion();
    if (version !== this.lastRenderedVersion) {
      this.lastRenderedVersion = version;
      this._onDidChangeTreeData.fire();
    }
  }

  getTreeItem(element: AgentTreeItem | ViewHistoryTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AgentTreeItem | ViewHistoryTreeItem): Thenable<(AgentTreeItem | ViewHistoryTreeItem)[]> {
    if (!element) {
      // Root level - return all agents
      const agents = this.agentManager.getAgents();
      const items = agents.map(agent => {
        const status = this.agentManager.getStatus(agent.name) || {
          name: agent.name,
          state: 'idle' as const
        };
        const historyEntries = this.agentManager.getHistory(agent.name);
        const collapsible = historyEntries.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None;
        return new AgentTreeItem(agent, status, collapsible, historyEntries.length);
      });
      return Promise.resolve(items);
    }

    if (element instanceof AgentTreeItem) {
      // Show the "View History" button as a child
      const historyEntries = this.agentManager.getHistory(element.agent.name);
      if (historyEntries.length > 0) {
        return Promise.resolve([
          new ViewHistoryTreeItem('agent', element.agent.name, historyEntries.length)
        ]);
      }
    }

    return Promise.resolve([]);
  }

  dispose(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
    this.disposables.forEach(d => d.dispose());
  }
}
