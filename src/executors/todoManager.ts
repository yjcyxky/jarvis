import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { TodoItem, TodoExecution } from '../types';
import { LogViewer } from '../utils/logViewer';
import { HistoryStore, ExecutionHistoryEntry } from '../utils/historyStore';
import { ClaudeCodeExecutor } from './claudeCodeExecutor';

export class TodoManager {
  private todos: Map<string, TodoItem[]> = new Map();
  private executor: ClaudeCodeExecutor;
  private watcher?: vscode.FileSystemWatcher;
  private executions: Map<string, TodoExecution> = new Map();
  private changeVersion = 0;
  private readonly _onDidChange = new vscode.EventEmitter<void>();

  readonly onDidChange: vscode.Event<void> = this._onDidChange.event;

  constructor(
    private workspaceRoot: string,
    private readonly logViewer: LogViewer,
    private readonly historyStore: HistoryStore
  ) {
    this.executor = new ClaudeCodeExecutor();
    this.loadTodos();
    this.setupWatcher();
  }

  private getTodoDir(): string {
    const config = vscode.workspace.getConfiguration('jarvis.paths');
    const todoDir = config.get<string>('todoDir', '.jarvis/todos');
    return path.join(this.workspaceRoot, todoDir);
  }

  private getTodoLogDir(): string {
    const config = vscode.workspace.getConfiguration('jarvis.paths');
    const todoLogDir = config.get<string>('todoLogDir', '.jarvis/todo-logs');
    return path.join(this.workspaceRoot, todoLogDir);
  }

  private setupWatcher(): void {
    const todoDir = this.getTodoDir();
    const pattern = new vscode.RelativePattern(todoDir, '**/*.md');

    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

    this.watcher.onDidCreate(() => this.loadTodos());
    this.watcher.onDidChange(() => this.loadTodos());
    this.watcher.onDidDelete(() => this.loadTodos());
  }

  private loadTodos(): void {
    const todoDir = this.getTodoDir();

    if (!fs.existsSync(todoDir)) {
      fs.mkdirSync(todoDir, { recursive: true });
      this.markChanged();
      return;
    }

    this.todos.clear();

    const files = fs.readdirSync(todoDir);
    for (const file of files) {
      if (file.endsWith('.md')) {
        try {
          const filePath = path.join(todoDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const todos = this.parseTodoFile(content, filePath);
          this.todos.set(filePath, todos);
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to load TODO file ${file}: ${error}`);
        }
      }
    }

    this.markChanged();
  }

  private parseTodoFile(content: string, filePath: string): TodoItem[] {
    const lines = content.split('\n');
    const todos: TodoItem[] = [];
    const stack: { item: TodoItem; indent: number }[] = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const todoMatch = line.match(/^(\s*)- \[([ xX])\] (.+)$/);

      if (todoMatch) {
        const indent = todoMatch[1].length;
        const completed = todoMatch[2].toLowerCase() === 'x';
        const text = todoMatch[3];

        // Extract priority from text if present
        let priority: 'high' | 'medium' | 'low' | undefined;
        let cleanText = text;

        if (text.includes('[HIGH]')) {
          priority = 'high';
          cleanText = text.replace('[HIGH]', '').trim();
        } else if (text.includes('[MEDIUM]')) {
          priority = 'medium';
          cleanText = text.replace('[MEDIUM]', '').trim();
        } else if (text.includes('[LOW]')) {
          priority = 'low';
          cleanText = text.replace('[LOW]', '').trim();
        }

        const todoItem: TodoItem = {
          id: `${path.basename(filePath)}-${i}`,
          text: cleanText,
          completed,
          priority,
          file: filePath,
          line: i + 1,
          executionStatus: completed ? 'success' : 'pending',
          children: []
        };

        // Check for agent-parameters block after this todo item
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === '') {
          j++; // Skip empty lines
        }

        if (j < lines.length && lines[j].trim() === '```agent-parameters') {
          j++; // Move past the opening marker
          const paramLines: string[] = [];
          
          // Collect parameter lines until closing marker
          while (j < lines.length && lines[j].trim() !== '```') {
            paramLines.push(lines[j]);
            j++;
          }
          
          if (j < lines.length && lines[j].trim() === '```') {
            // Parse YAML parameters
            try {
              const yaml = require('yaml');
              const yamlContent = paramLines.join('\n');
              if (yamlContent.trim()) {
                const params = yaml.parse(yamlContent);
                if (params && typeof params === 'object') {
                  todoItem.parameters = new Map(Object.entries(params));
                }
              }
            } catch (error) {
              console.warn(`Failed to parse agent-parameters for todo "${cleanText}":`, error);
            }
            i = j; // Update i to skip the processed parameter block
          } else {
            i = j - 1; // If no closing marker found, backtrack
          }
        }

        // Find parent based on indentation
        while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
          stack.pop();
        }

        if (stack.length > 0) {
          // This is a child item
          const parent = stack[stack.length - 1].item;
          if (!parent.children) {
            parent.children = [];
          }
          parent.children.push(todoItem);
        } else {
          // This is a root item
          todos.push(todoItem);
        }

        stack.push({ item: todoItem, indent });
      }

      i++;
    }

    return todos;
  }

  getAllTodos(): TodoItem[] {
    const allTodos: TodoItem[] = [];
    for (const todos of this.todos.values()) {
      allTodos.push(...todos);
    }
    return allTodos;
  }

  getTodosByFile(filePath: string): TodoItem[] {
    return this.todos.get(filePath) || [];
  }

  getTodoById(id: string): TodoItem | undefined {
    for (const todos of this.todos.values()) {
      const found = this.findTodoInTree(todos, id);
      if (found) return found;
    }
    return undefined;
  }

  private findTodoInTree(todos: TodoItem[], id: string): TodoItem | undefined {
    for (const todo of todos) {
      if (todo.id === id) return todo;
      if (todo.children) {
        const found = this.findTodoInTree(todo.children, id);
        if (found) return found;
      }
    }
    return undefined;
  }

  async executeTodo(id: string): Promise<void> {
    const todo = this.getTodoById(id);
    if (!todo) {
      throw new Error(`TODO ${id} not found`);
    }

    if (todo.completed) {
      vscode.window.showWarningMessage(`TODO "${todo.text}" is already completed`);
      return;
    }

    if (todo.executionStatus === 'running') {
      vscode.window.showWarningMessage(`TODO "${todo.text}" is already running`);
      return;
    }

    // Update status
    todo.executionStatus = 'running';

    // Create execution record
    const executionId = `exec-${id}-${Date.now()}`;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFile = path.join(this.getTodoLogDir(), `${timestamp}_${id.replace(/[\/\\:]/g, '-')}.jsonl`);
    const versionHash = this.computeVersionHash(todo.file);

    const historyEntry = this.historyStore.beginExecution({
      type: 'todo',
      targetId: id,
      label: todo.text,
      sourceFile: todo.file,
      logFile,
      versionHash,
      metadata: {
        priority: todo.priority
      }
    });

    const execution: TodoExecution = {
      id: executionId,
      todoId: id,
      startTime: new Date(),
      status: 'running',
      logFile,
      historyId: historyEntry.id
    };

    this.executions.set(executionId, execution);
    todo.lastExecution = execution;
    this.markChanged();

    void this.logViewer.openLog({
      type: 'todo',
      id,
      title: todo.text,
      logFile,
      run: {
        status: 'running',
        startTime: historyEntry.startTime,
        versionHash,
        sourceFile: todo.file
      }
    });

    try {
      // Prepare prompt for Claude
      const prompt = this.buildTodoPrompt(todo);

      await this.executor.execute(
        `todo-${id}`,
        prompt,
        undefined,
        logFile
      );

      // Update status on completion
      todo.executionStatus = 'success';
      todo.completed = true;
      execution.status = 'success';
      const completedAt = new Date();
      execution.endTime = completedAt;
      this.historyStore.completeExecution(historyEntry.id, {
        status: 'success',
        endTime: completedAt.toISOString()
      });
      this.logViewer.updateRunContext('todo', id, {
        status: 'success',
        endTime: completedAt.toISOString()
      });
      this.markChanged();

      // Update the file
      await this.updateTodoInFile(todo);

      vscode.window.showInformationMessage(`TODO "${todo.text}" completed successfully`);
    } catch (error) {
      // Update status on error
      todo.executionStatus = 'failed';
      execution.status = 'failed';
      const completedAt = new Date();
      execution.endTime = completedAt;
      execution.error = error instanceof Error ? error.message : String(error);
      this.historyStore.completeExecution(historyEntry.id, {
        status: 'failed',
        metadata: {
          error: error instanceof Error ? error.message : String(error)
        },
        endTime: completedAt.toISOString()
      });
      this.logViewer.updateRunContext('todo', id, {
        status: 'failed',
        endTime: completedAt.toISOString(),
        error: error instanceof Error ? error.message : String(error)
      });
      this.markChanged();

      vscode.window.showErrorMessage(`TODO "${todo.text}" failed: ${error}`);
    }
  }

  private buildTodoPrompt(todo: TodoItem): string {
    let prompt = `Please complete the following task:\n\n${todo.text}`;

    if (todo.priority) {
      prompt += `\n\nPriority: ${todo.priority.toUpperCase()}`;
    }

    if (todo.parameters) {
      prompt += `\n\nParameters: ${JSON.stringify(Object.fromEntries(todo.parameters))} \n\n The parameters might be needed for the agent execution.`;
    }

    if (todo.children && todo.children.length > 0) {
      prompt += '\n\nSubtasks:';
      todo.children.forEach((child, index) => {
        prompt += `\n${index + 1}. ${child.completed ? '[✓]' : '[ ]'} ${child.text}`;
      });
    }

    prompt += '\n\nPlease complete this task and update any relevant files as needed.';

    return prompt;
  }

  private async updateTodoInFile(todo: TodoItem): Promise<void> {
    const content = fs.readFileSync(todo.file, 'utf-8');
    const lines = content.split('\n');

    if (lines[todo.line - 1]) {
      lines[todo.line - 1] = lines[todo.line - 1].replace('- [ ]', '- [x]');
      fs.writeFileSync(todo.file, lines.join('\n'));
    }
  }

  async stopTodo(id: string): Promise<void> {
    const todo = this.getTodoById(id);
    if (!todo || todo.executionStatus !== 'running') {
      vscode.window.showWarningMessage(`TODO is not running`);
      return;
    }

    await this.executor.stop(`todo-${id}`);
    todo.executionStatus = 'paused';

    if (todo.lastExecution) {
      todo.lastExecution.status = 'failed';
      const endedAt = new Date();
      todo.lastExecution.endTime = endedAt;
      if (todo.lastExecution.historyId) {
        this.historyStore.completeExecution(todo.lastExecution.historyId, {
          status: 'stopped',
          endTime: endedAt.toISOString()
        });
        this.logViewer.updateRunContext('todo', id, {
          status: 'stopped',
          endTime: endedAt.toISOString()
        });
      }
    }
    this.markChanged();

    vscode.window.showInformationMessage(`TODO "${todo.text}" stopped`);
  }

  getExecutionHistory(todoId: string): TodoExecution[] {
    const history: TodoExecution[] = [];
    for (const execution of this.executions.values()) {
      if (execution.todoId === todoId) {
        history.push(execution);
      }
    }
    return history.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  }

  getStatistics(): {
    total: number;
    completed: number;
    pending: number;
    running: number;
    failed: number;
  } {
    const todos = this.getAllTodos();
    const stats = {
      total: 0,
      completed: 0,
      pending: 0,
      running: 0,
      failed: 0
    };

    const countTodos = (items: TodoItem[]) => {
      for (const item of items) {
        stats.total++;
        if (item.completed) stats.completed++;
        if (item.executionStatus === 'pending') stats.pending++;
        if (item.executionStatus === 'running') stats.running++;
        if (item.executionStatus === 'failed') stats.failed++;

        if (item.children) {
          countTodos(item.children);
        }
      }
    };

    countTodos(todos);
    return stats;
  }

  refresh(): void {
    this.loadTodos();
  }

  /**
   * 同步日志文件状态，清理无效的历史记录
   */
  syncLogFiles(): void {
    const removedCount = this.historyStore.cleanupInvalidRecords();
    if (removedCount > 0) {
      console.log(`TodoManager: Cleaned up ${removedCount} invalid history records`);
      this.markChanged();
    }
  }

  dispose(): void {
    this.watcher?.dispose();
    this.executor.dispose();
    this._onDidChange.dispose();
  }

  getHistory(todoId: string): ExecutionHistoryEntry[] {
    return this.historyStore.getHistory('todo', todoId);
  }

  getAllHistory(): ExecutionHistoryEntry[] {
    const allHistory: ExecutionHistoryEntry[] = [];
    this.todos.forEach(todoList => {
      todoList.forEach(todo => {
        const history = this.getHistory(todo.id);
        allHistory.push(...history);
      });
    });
    return allHistory;
  }

  getChangeVersion(): number {
    return this.changeVersion;
  }

  private markChanged(): void {
    this.changeVersion++;
    this._onDidChange.fire();
  }

  private computeVersionHash(filePath: string): string | undefined {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        return crypto.createHash('md5').update(content).digest('hex');
      }
    } catch (error) {
      console.error('Failed to compute TODO version hash', error);
    }

    return undefined;
  }
}
