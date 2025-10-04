import * as vscode from 'vscode';
import { AgentConfig, AgentStatus } from '../types';
import { AgentManager } from '../executors/agentManager';

export class AgentTreeItem extends vscode.TreeItem {
  constructor(
    public readonly agent: AgentConfig,
    public readonly status: AgentStatus,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(agent.name, collapsibleState);

    this.tooltip = `${agent.name}: ${agent.description}`;
    this.description = this.getStatusDescription();
    this.contextValue = `agent.${status.state}`;
    this.iconPath = this.getIcon();
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

export class AgentTreeProvider implements vscode.TreeDataProvider<AgentTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<AgentTreeItem | undefined | null | void> =
    new vscode.EventEmitter<AgentTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<AgentTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private refreshTimer?: NodeJS.Timeout;

  constructor(private agentManager: AgentManager) {
    this.startAutoRefresh();
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

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AgentTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AgentTreeItem): Thenable<AgentTreeItem[]> {
    if (!element) {
      // Root level - return all agents
      const agents = this.agentManager.getAgents();
      const items = agents.map(agent => {
        const status = this.agentManager.getStatus(agent.name) || {
          name: agent.name,
          state: 'idle' as const
        };
        return new AgentTreeItem(agent, status, vscode.TreeItemCollapsibleState.None);
      });
      return Promise.resolve(items);
    }
    return Promise.resolve([]);
  }

  dispose(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
  }
}