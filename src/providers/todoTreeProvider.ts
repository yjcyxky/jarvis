import * as vscode from 'vscode';
import * as path from 'path';
import { TodoItem } from '../types';
import { TodoManager } from '../executors/todoManager';

export class TodoTreeItem extends vscode.TreeItem {
  constructor(
    public readonly todo: TodoItem,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(todo.text, collapsibleState);

    this.tooltip = this.getTooltip();
    this.description = this.getDescription();
    this.contextValue = `todo.${todo.executionStatus}`;
    this.iconPath = this.getIcon();
    this.checkboxState = todo.completed
      ? vscode.TreeItemCheckboxState.Checked
      : vscode.TreeItemCheckboxState.Unchecked;
  }

  private getTooltip(): string {
    let tooltip = this.todo.text;
    if (this.todo.priority) {
      tooltip += `\nPriority: ${this.todo.priority}`;
    }
    if (this.todo.lastExecution) {
      tooltip += `\nLast run: ${this.todo.lastExecution.startTime.toLocaleString()}`;
      tooltip += `\nStatus: ${this.todo.lastExecution.status}`;
    }
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

export class TodoTreeProvider implements vscode.TreeDataProvider<TodoTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TodoTreeItem | undefined | null | void> =
    new vscode.EventEmitter<TodoTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TodoTreeItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private groupByFile: boolean = true;
  private refreshTimer?: NodeJS.Timeout;

  constructor(private todoManager: TodoManager) {
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

  setGroupByFile(groupByFile: boolean): void {
    this.groupByFile = groupByFile;
    this.refresh();
  }

  getTreeItem(element: TodoTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TodoTreeItem | any): Thenable<any[]> {
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
          return new TodoTreeItem(
            todo,
            hasChildren
              ? vscode.TreeItemCollapsibleState.Expanded
              : vscode.TreeItemCollapsibleState.None
          );
        });
        return Promise.resolve(items);
      }
    }

    if (element instanceof TodoTreeItem) {
      // Return children of a todo
      if (element.todo.children) {
        const items = element.todo.children.map(child => {
          const hasChildren = child.children && child.children.length > 0;
          return new TodoTreeItem(
            child,
            hasChildren
              ? vscode.TreeItemCollapsibleState.Expanded
              : vscode.TreeItemCollapsibleState.None
          );
        });
        return Promise.resolve(items);
      }
    } else if (element.todos) {
      // This is a file group, return its todos
      const items = element.todos.map((todo: TodoItem) => {
        const hasChildren = todo.children && todo.children.length > 0;
        return new TodoTreeItem(
          todo,
          hasChildren
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None
        );
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