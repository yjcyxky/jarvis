import * as vscode from 'vscode';
import * as path from 'path';
import { TodoItem } from '../types';
import { TodoManager } from '../executors/todoManager';
import { ViewHistoryTreeItem } from './agentTreeProvider';

export class TodoTreeItem extends vscode.TreeItem {
  constructor(
    public readonly todo: TodoItem,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly historyCount: number
  ) {
    super(todo.text, collapsibleState);

    this.tooltip = this.getTooltip();
    this.description = this.getDescription();
    this.contextValue = `todo.${todo.executionStatus}`;
    this.iconPath = this.getIcon();
    this.checkboxState = todo.completed
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
    this.command = {
      command: 'jarvis.openTodoLog',
      title: 'Open TODO Log',
      arguments: [todo.id]
    };
  }

  private getTooltip(): string {
    let tooltip = this.todo.text;
    if (this.todo.priority) {
      tooltip += `\nPriority: ${this.todo.priority}`;
    }
    if (this.todo.lastExecution) {
      tooltip += `\nLast run: ${this.todo.lastExecution.startTime.toLocaleString()}`;
      tooltip += `\nStatus: ${this.todo.lastExecution.status}`;
      tooltip += `\nLog: ${this.todo.lastExecution.logFile}`;
    }
    tooltip += `\nRuns: ${this.historyCount}`;
    return tooltip;
  }

  private getDescription(): string {
    const parts: string[] = [];

    if (this.todo.priority) {
      const priorityIcon = {
        high: '🔴',
        medium: '🟡',
        low: '🟢'
      }[this.todo.priority];
      parts.push(priorityIcon);
    }

    const statusIcon = {
      pending: '⚪',
      running: '🔵',
      success: '✅',
      failed: '❌',
      paused: '⏸️'
    }[this.todo.executionStatus || 'pending'];
    parts.push(statusIcon);

    parts.push(`[${path.basename(this.todo.file)}:${this.todo.line}]`);

    if (this.historyCount > 0) {
      parts.push(`(${this.historyCount})`);
    }

    return parts.join(' ');
  }

  private getIcon(): vscode.ThemeIcon {
    if (this.todo.completed) {
      return new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'));
    }

    switch (this.todo.executionStatus) {
      case 'running':
        return new vscode.ThemeIcon('sync~spin');
      case 'failed':
        return new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
      case 'paused':
        return new vscode.ThemeIcon('debug-pause');
      default:
        return new vscode.ThemeIcon('circle-outline');
    }
  }
}

export class TodoTreeProvider implements vscode.TreeDataProvider<TodoTreeItem | ViewHistoryTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TodoTreeItem | ViewHistoryTreeItem | undefined | null | void> =
    new vscode.EventEmitter<TodoTreeItem | ViewHistoryTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TodoTreeItem | ViewHistoryTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private groupByFile: boolean = true;
  private refreshTimer?: NodeJS.Timeout;
  private readonly disposables: vscode.Disposable[] = [];
  private lastRenderedVersion = -1;

  constructor(private todoManager: TodoManager) {
    this.startAutoRefresh();
    this.disposables.push(
      this.todoManager.onDidChange(() => this.refresh())
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
      this.lastRenderedVersion = this.todoManager.getChangeVersion();
      this._onDidChangeTreeData.fire();
      return;
    }

    const version = this.todoManager.getChangeVersion();
    if (version !== this.lastRenderedVersion) {
      this.lastRenderedVersion = version;
      this._onDidChangeTreeData.fire();
    }
  }

  setGroupByFile(groupByFile: boolean): void {
    this.groupByFile = groupByFile;
    this.refresh(true);
  }

  getTreeItem(element: TodoTreeItem | ViewHistoryTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TodoTreeItem | ViewHistoryTreeItem | any): Thenable<any[]> {
    if (!element) {
      // Root level
      if (this.groupByFile) {
        // Return file groups
        const todos = this.todoManager.getAllTodos();
        const fileGroups = new Map<string, TodoItem[]>();

        todos.forEach(todo => {
          const fileName = path.basename(todo.file);
          if (!fileGroups.has(fileName)) {
            fileGroups.set(fileName, []);
          }
          fileGroups.get(fileName)!.push(todo);
        });

        const items: vscode.TreeItem[] = [];
        fileGroups.forEach((todos, fileName) => {
          const item = new vscode.TreeItem(
            `📝 ${fileName}`,
            vscode.TreeItemCollapsibleState.Expanded
          );
          item.contextValue = 'todoFile';
          (item as any).todos = todos;
          items.push(item);
        });

        return Promise.resolve(items);
      } else {
        // Return all todos flat
        const todos = this.todoManager.getAllTodos();
        const items = todos.map(todo => {
          const hasChildren = todo.children && todo.children.length > 0;
          const historyCount = this.todoManager.getHistory(todo.id).length;
          const collapsible = hasChildren || historyCount > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;
          return new TodoTreeItem(todo, collapsible, historyCount);
        });
        return Promise.resolve(items);
      }
    }

    if (element instanceof TodoTreeItem) {
      const results: vscode.TreeItem[] = [];

      // Return children of a todo
      if (element.todo.children) {
        const items = element.todo.children.map(child => {
          const hasChildren = child.children && child.children.length > 0;
          const historyCount = this.todoManager.getHistory(child.id).length;
          const collapsible = hasChildren || historyCount > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;
          return new TodoTreeItem(child, collapsible, historyCount);
        });
        results.push(...items);
      }

      // Add "View History" button if there's history
      const history = this.todoManager.getHistory(element.todo.id);
      if (history.length > 0) {
        const historyItem = new ViewHistoryTreeItem('todo', element.todo.id, history.length);
        historyItem.command = {
          command: 'jarvis.viewTodoHistory',
          title: 'View TODO History',
          arguments: [element.todo.id]
        };
        results.push(historyItem);
      }

      return Promise.resolve(results);
    } else if (element.todos) {
      // This is a file group, return its todos
      const items = element.todos.map((todo: TodoItem) => {
        const hasChildren = todo.children && todo.children.length > 0;
        const historyCount = this.todoManager.getHistory(todo.id).length;
        const collapsible = hasChildren || historyCount > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None;
        return new TodoTreeItem(todo, collapsible, historyCount);
      });
      return Promise.resolve(items);
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
