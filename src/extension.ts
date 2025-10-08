import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AgentManager } from './executors/agentManager';
import { TodoManager } from './executors/todoManager';
import { AgentTreeProvider, AgentTreeItem } from './providers/agentTreeProvider';
import { TodoTreeProvider, TodoTreeItem } from './providers/todoTreeProvider';
import { StatisticsProvider } from './providers/statisticsProvider';
import { LogViewer } from './utils/logViewer';
import { HistoryStore, ExecutionHistoryEntry } from './utils/historyStore';
import { HistoryViewer } from './utils/historyViewer';
import { Logger } from './utils/logger';
import { AgentConfig, TodoItem } from './types';

let agentManager: AgentManager;
let todoManager: TodoManager;
let agentTreeProvider: AgentTreeProvider;
let todoTreeProvider: TodoTreeProvider;
let statisticsProvider: StatisticsProvider;
let logViewer: LogViewer;
let historyViewer: HistoryViewer;
let historyStore: HistoryStore;

export function activate(context: vscode.ExtensionContext) {
  const logger = Logger.getInstance();
  logger.info('Extension', 'Jarvis extension is now activating...');

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('Jarvis requires a workspace to be opened');
    logger.error('Extension', 'No workspace folder found');
    return;
  }

  logger.info('Extension', `Workspace root: ${workspaceRoot}`);

  // Initialize history store first
  historyStore = new HistoryStore(workspaceRoot);
  context.subscriptions.push({ dispose: () => historyStore.dispose() });

  // Initialize log viewer with history store reference
  logViewer = new LogViewer(context.extensionUri, workspaceRoot, historyStore);
  context.subscriptions.push(logViewer);

  agentManager = new AgentManager(workspaceRoot, logViewer, historyStore);
  todoManager = new TodoManager(workspaceRoot, logViewer, historyStore);
  todoManager.registerAgentManager(agentManager);

  logViewer.registerStopHandler('agent', name => agentManager.stopAgent(name));
  logViewer.registerStopHandler('todo', id => todoManager.stopTodo(id));

  // Initialize history viewer
  historyViewer = new HistoryViewer(
    context.extensionUri,
    agentManager,
    todoManager,
    logViewer,
    historyStore
  );
  context.subscriptions.push(historyViewer);

  logger.info('Extension', 'Managers initialized');

  // Initialize providers
  agentTreeProvider = new AgentTreeProvider(agentManager);
  todoTreeProvider = new TodoTreeProvider(todoManager);
  statisticsProvider = new StatisticsProvider(agentManager, todoManager);

  logger.info('Extension', 'Providers initialized');

  // Register tree data providers
  vscode.window.registerTreeDataProvider('jarvis.agents', agentTreeProvider);
  vscode.window.registerTreeDataProvider('jarvis.todos', todoTreeProvider);
  vscode.window.registerTreeDataProvider('jarvis.statistics', statisticsProvider);

  logger.info('Extension', 'Tree providers registered');

  // Register commands
  registerCommands(context, logViewer);

  // Check environment on startup
  checkEnvironment();

  // Sync log files on startup
  setTimeout(() => {
    logger.info('Extension', 'Performing initial log file sync...');
    agentManager.syncLogFiles();
    todoManager.syncLogFiles();
  }, 2000); // 延迟2秒执行，确保所有组件都已初始化

  // Set up periodic log file sync (every 5 minutes)
  const syncInterval = setInterval(() => {
    logger.info('Extension', 'Performing periodic log file sync...');
    agentManager.syncLogFiles();
    todoManager.syncLogFiles();
  }, 5 * 60 * 1000); // 5分钟

  context.subscriptions.push({
    dispose: () => clearInterval(syncInterval)
  });

  // Show welcome message
  const config = vscode.workspace.getConfiguration('jarvis.ui');
  if (config.get<boolean>('showNotifications', true)) {
    vscode.window.showInformationMessage('Jarvis is ready to assist you! 🤖');
  }
}

function registerCommands(context: vscode.ExtensionContext, logViewer: LogViewer) {
  const applyTemplateReplacements = (
    content: string,
    replacements: Record<string, string>
  ): string => {
    let updated = content;
    for (const [key, value] of Object.entries(replacements)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'gi');
      updated = updated.replace(regex, value);
    }
    return updated;
  };

  const sanitizeBaseName = (raw: string, fallback: string): string => {
    const replaced = raw
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return replaced || fallback;
  };

  const getWorkspaceRoot = (): string | undefined =>
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  const isPathInsideWorkspace = (targetPath: string | undefined): boolean => {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot || !targetPath) {
      return false;
    }
    const relative = path.relative(workspaceRoot, targetPath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  };

  const formatWorkspaceRelative = (targetPath: string): string => {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
      return targetPath;
    }
    const relative = path.relative(workspaceRoot, targetPath);
    if (!relative || relative.startsWith('..')) {
      return targetPath;
    }
    return relative;
  };

  const createEntityFromTemplate = async (type: 'agent' | 'todo'): Promise<void> => {
    const logger = Logger.getInstance();
    const workspaceRoot = getWorkspaceRoot();

    if (!workspaceRoot) {
      vscode.window.showErrorMessage('Jarvis requires a workspace to create files.');
      return;
    }

    const prompt =
      type === 'agent'
        ? 'Enter a name for the new agent file'
        : 'Enter a name for the new TODO file';
    const placeHolder = type === 'agent' ? 'weekly-agent' : 'sprint-todos';

    const input = await vscode.window.showInputBox({
      prompt,
      placeHolder,
      validateInput: value => {
        if (!value.trim()) {
          return 'Name cannot be empty';
        }
        if (value.includes('/') || value.includes('\\')) {
          return 'Name cannot contain path separators';
        }
        return undefined;
      }
    });

    if (!input) {
      return;
    }

    const trimmed = input.trim();
    const extension = path.extname(trimmed) || '.md';
    const base = extension ? path.basename(trimmed, extension) : trimmed;
    const sanitizedBase = sanitizeBaseName(
      base,
      type === 'agent' ? 'new-agent' : 'new-todo'
    );
    const fileName = `${sanitizedBase}${extension}`;

    const pathsConfig = vscode.workspace.getConfiguration('jarvis.paths');
    const relativeDir = pathsConfig.get<string>(
      type === 'agent' ? 'agentDir' : 'todoDir',
      type === 'agent' ? '.jarvis/agents' : '.jarvis/todos'
    );
    const targetDir = path.join(workspaceRoot, relativeDir);

    try {
      await fs.promises.mkdir(targetDir, { recursive: true });
    } catch (error) {
      logger.error('Command', `Failed to prepare directory for ${type} file`, error);
      vscode.window.showErrorMessage(`Failed to prepare directory: ${error}`);
      return;
    }

    const filePath = path.join(targetDir, fileName);
    if (fs.existsSync(filePath)) {
      vscode.window.showErrorMessage(`File ${fileName} already exists.`);
      return;
    }

    const templateSegments =
      type === 'agent'
        ? ['resources', 'agent-template.md']
        : ['resources', 'todo-template.md'];

    let templateContent = '';
    try {
      const templateUri = vscode.Uri.joinPath(context.extensionUri, ...templateSegments);
      const data = await vscode.workspace.fs.readFile(templateUri);
      templateContent = Buffer.from(data).toString('utf8');
    } catch (error) {
      logger.warn('Command', `Unable to load ${type} template: ${error}`);
    }

    templateContent = applyTemplateReplacements(templateContent, {
      name: sanitizedBase,
      title: sanitizedBase,
      filename: fileName
    });

    if (!templateContent.trim()) {
      templateContent =
        type === 'agent'
          ? `---\nname: ${sanitizedBase}\ndescription: \nmodel: \n---\n\n# Instructions\n- Describe the agent goals here.\n`
          : `# ${sanitizedBase}\n\n- [ ] First task description\n`;
    }

    try {
      await fs.promises.writeFile(filePath, templateContent, 'utf8');
    } catch (error) {
      logger.error('Command', `Failed to write ${type} template`, error);
      vscode.window.showErrorMessage(`Failed to create file: ${error}`);
      return;
    }

    try {
      const fileUri = vscode.Uri.file(filePath);
      const document = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(document, { preview: false });
    } catch (error) {
      logger.error('Command', `Failed to open new ${type} file`, error);
      vscode.window.showWarningMessage(
        `Created ${fileName}, but failed to open it automatically: ${error}`
      );
    }

    if (type === 'agent') {
      agentManager.refresh();
      agentTreeProvider.refresh();
    } else {
      todoManager.refresh();
      todoTreeProvider.refresh();
    }
    statisticsProvider.refresh(true);

    vscode.window.showInformationMessage(
      type === 'agent'
        ? `New agent file ${fileName} created.`
        : `New TODO file ${fileName} created.`
    );
  };

  // Agent commands
  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.createAgent', async () => {
      await createEntityFromTemplate('agent');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.deleteAgent', async (target?: AgentTreeItem | string) => {
      const logger = Logger.getInstance();
      const workspaceRoot = getWorkspaceRoot();

      if (!workspaceRoot) {
        vscode.window.showErrorMessage('Jarvis requires a workspace to delete agent prompts.');
        return;
      }

      let agentName: string | undefined;

      if (typeof target === 'string') {
        agentName = target;
      } else if (target instanceof AgentTreeItem) {
        agentName = target.agent.name;
      }

      const agents = agentManager.getAgents();

      const pickAgent = async (): Promise<AgentConfig | undefined> => {
        const deletableAgents = agents.filter(agent => isPathInsideWorkspace(agent.sourcePath));
        if (deletableAgents.length === 0) {
          vscode.window.showWarningMessage('No agent prompts in the workspace can be deleted.');
          return undefined;
        }

        const picked = await vscode.window.showQuickPick(
          deletableAgents.map(agent => ({
            label: agent.name,
            description: agent.description || undefined,
            detail: formatWorkspaceRelative(agent.sourcePath),
            agent
          })),
          { placeHolder: 'Select an agent prompt to delete' }
        );

        return picked?.agent;
      };

      let agentConfig: AgentConfig | undefined = agentName
        ? agents.find(a => a.name === agentName)
        : undefined;

      if (!agentConfig && agentName) {
        vscode.window.showWarningMessage(`Agent "${agentName}" was not found.`);
      }

      if (!agentConfig) {
        agentConfig = await pickAgent();
        if (!agentConfig) {
          return;
        }
        agentName = agentConfig.name;
      }

      if (!agentName) {
        return;
      }

      const sourcePath = agentManager.getAgentSource(agentName);
      if (!sourcePath) {
        vscode.window.showWarningMessage('Could not determine the prompt file for this agent.');
        return;
      }

      if (!isPathInsideWorkspace(sourcePath)) {
        vscode.window.showWarningMessage('This agent prompt is read-only and cannot be deleted.');
        return;
      }

      const status = agentManager.getStatus(agentName);
      if (status?.state === 'running') {
        vscode.window.showWarningMessage(`Stop agent "${agentName}" before deleting its prompt.`);
        return;
      }

      if (!fs.existsSync(sourcePath)) {
        vscode.window.showWarningMessage(`File already missing: ${formatWorkspaceRelative(sourcePath)}`);
        agentManager.refresh();
        agentTreeProvider.refresh();
        return;
      }

      const confirmation = await vscode.window.showWarningMessage(
        `Delete agent "${agentName}"?\n${formatWorkspaceRelative(sourcePath)}`,
        { modal: true },
        'Delete'
      );
      if (confirmation !== 'Delete') {
        return;
      }

      try {
        await fs.promises.unlink(sourcePath);
        logger.info('Command', `Deleted agent file ${sourcePath}`);
      } catch (error) {
        logger.error('Command', `Failed to delete agent file ${sourcePath}`, error);
        vscode.window.showErrorMessage(`Failed to delete agent: ${error}`);
        return;
      }

      agentManager.refresh();
      agentTreeProvider.refresh();
      statisticsProvider.refresh(true);

      vscode.window.showInformationMessage(
        `Agent "${agentName}" deleted (${formatWorkspaceRelative(sourcePath)}).`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.startAgent', async (item: AgentTreeItem) => {
      if (item?.agent) {
        try {
          await agentManager.startAgent(item.agent.name);
          agentTreeProvider.refresh();
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to start agent: ${error}`);
        }
      } else {
        // Show quick pick if no item provided
        const agents = agentManager.getAgents();
        const selected = await vscode.window.showQuickPick(
          agents.map(a => ({
            label: a.name,
            description: a.description,
            agent: a
          })),
          { placeHolder: 'Select an agent to start' }
        );
        if (selected) {
          try {
            await agentManager.startAgent(selected.agent.name);
            agentTreeProvider.refresh();
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to start agent: ${error}`);
          }
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.stopAgent', async (item: AgentTreeItem) => {
      if (item?.agent) {
        try {
          await agentManager.stopAgent(item.agent.name);
          agentTreeProvider.refresh();
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to stop agent: ${error}`);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.openAgentSource', async (target?: AgentTreeItem | string) => {
      let agentName: string | undefined;

      if (typeof target === 'string') {
        agentName = target;
      } else if (target instanceof AgentTreeItem) {
        agentName = target.agent.name;
      }

      if (!agentName) {
        const agents = agentManager.getAgents();
        if (agents.length === 0) {
          vscode.window.showWarningMessage('No agents are available.');
          return;
        }

        const picked = await vscode.window.showQuickPick(
          agents.map(agent => ({
            label: agent.name,
            description: agent.description,
            agent
          })),
          { placeHolder: 'Select an agent prompt to open' }
        );

        if (!picked) {
          return;
        }

        agentName = picked.agent.name;
      }

      const source = agentManager.getAgentSource(agentName);
      if (!source) {
        vscode.window.showWarningMessage('Could not determine the prompt file for this agent.');
        return;
      }

      try {
        const document = await vscode.workspace.openTextDocument(source);
        await vscode.window.showTextDocument(document, { preview: false });
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to open agent prompt: ${error}`);
      }
    })
  );

  // TODO commands
  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.createTodo', async () => {
      await createEntityFromTemplate('todo');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.deleteTodo', async (target?: TodoTreeItem | { todos?: TodoItem[] } | string) => {
      const logger = Logger.getInstance();
      const workspaceRoot = getWorkspaceRoot();

      if (!workspaceRoot) {
        vscode.window.showErrorMessage('Jarvis requires a workspace to delete TODO files.');
        return;
      }

      const resolveFilePathFromTarget = (
        candidate: TodoTreeItem | { todos?: TodoItem[] } | string | undefined
      ): string | undefined => {
        if (!candidate) {
          return undefined;
        }
        if (typeof candidate === 'string') {
          return path.isAbsolute(candidate) ? candidate : path.join(workspaceRoot, candidate);
        }
        if (candidate instanceof TodoTreeItem) {
          return candidate.todo.file;
        }
        if (Array.isArray(candidate.todos) && candidate.todos.length > 0) {
          return candidate.todos[0].file;
        }
        return undefined;
      };

      let filePath = resolveFilePathFromTarget(target);

      const pickTodoFile = async (): Promise<string | undefined> => {
        const files = todoManager.getTodoFiles().filter(isPathInsideWorkspace);
        if (files.length === 0) {
          vscode.window.showWarningMessage('No TODO files found in the workspace to delete.');
          return undefined;
        }

        const picked = await vscode.window.showQuickPick(
          files.map(file => ({
            label: path.basename(file),
            description: formatWorkspaceRelative(file),
            file
          })),
          { placeHolder: 'Select a TODO file to delete' }
        );

        return picked?.file;
      };

      if (!filePath) {
        filePath = await pickTodoFile();
        if (!filePath) {
          return;
        }
      }

      if (!isPathInsideWorkspace(filePath)) {
        vscode.window.showWarningMessage('This TODO file is read-only and cannot be deleted.');
        return;
      }

      const todosInFile = todoManager.getTodosByFile(filePath);
      const runningTodo = todosInFile.find(todo => todo.executionStatus === 'running');
      if (runningTodo) {
        vscode.window.showWarningMessage(
          `Stop running TODO "${runningTodo.text}" before deleting its file.`
        );
        return;
      }

      if (!fs.existsSync(filePath)) {
        vscode.window.showWarningMessage(`TODO file already missing: ${formatWorkspaceRelative(filePath)}`);
        todoManager.refresh();
        todoTreeProvider.refresh();
        return;
      }

      const confirmation = await vscode.window.showWarningMessage(
        `Delete TODO file?\n${formatWorkspaceRelative(filePath)}`,
        { modal: true },
        'Delete'
      );
      if (confirmation !== 'Delete') {
        return;
      }

      try {
        await fs.promises.unlink(filePath);
        logger.info('Command', `Deleted TODO file ${filePath}`);
      } catch (error) {
        logger.error('Command', `Failed to delete TODO file ${filePath}`, error);
        vscode.window.showErrorMessage(`Failed to delete TODO file: ${error}`);
        return;
      }

      todoManager.refresh();
      todoTreeProvider.refresh();
      statisticsProvider.refresh(true);

      vscode.window.showInformationMessage(
        `TODO file deleted (${formatWorkspaceRelative(filePath)}).`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.executeTodo', async (item: TodoTreeItem) => {
      if (item?.todo) {
        try {
          await todoManager.executeTodo(item.todo.id);
          todoTreeProvider.refresh();
          statisticsProvider.refresh(true);
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to execute TODO: ${error}`);
        }
      } else {
        // Show quick pick if no item provided
        const todos = todoManager.getAllTodos().filter(t => !t.completed);
        const selected = await vscode.window.showQuickPick(
          todos.map(t => ({
            label: t.text,
            description: `${t.priority ? `[${t.priority.toUpperCase()}] ` : ''}${path.basename(t.file)}:${t.line}`,
            todo: t
          })),
          { placeHolder: 'Select a TODO to execute' }
        );
        if (selected) {
          try {
            await todoManager.executeTodo(selected.todo.id);
            todoTreeProvider.refresh();
            statisticsProvider.refresh(true);
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to execute TODO: ${error}`);
          }
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.stopTodo', async (target?: TodoTreeItem | string) => {
      let todoId: string | undefined;

      if (typeof target === 'string') {
        todoId = target;
      } else if (target instanceof TodoTreeItem) {
        todoId = target.todo.id;
      }

      if (!todoId) {
        const runningTodos = todoManager
          .getAllTodos()
          .filter(todo => todo.executionStatus === 'running');

        if (runningTodos.length === 0) {
          vscode.window.showInformationMessage('No running TODO tasks to stop.');
          return;
        }

        const picked = await vscode.window.showQuickPick(
          runningTodos.map(todo => ({
            label: todo.text,
            description: `${path.basename(todo.file)}:${todo.line}`,
            todo
          })),
          { placeHolder: 'Select a running TODO to stop' }
        );

        if (!picked) {
          return;
        }

        todoId = picked.todo.id;
      }

      try {
        await todoManager.stopTodo(todoId);
        todoTreeProvider.refresh();
        statisticsProvider.refresh(true);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to stop TODO: ${error}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.openTodoSource', async (target?: TodoTreeItem | string) => {
      let todoId: string | undefined;

      if (typeof target === 'string') {
        todoId = target;
      } else if (target instanceof TodoTreeItem) {
        todoId = target.todo.id;
      }

      if (!todoId) {
        const todos = todoManager.getAllTodos();
        if (todos.length === 0) {
          vscode.window.showWarningMessage('No TODO items are available.');
          return;
        }

        const picked = await vscode.window.showQuickPick(
          todos.map(todo => ({
            label: todo.text,
            description: `${path.basename(todo.file)}:${todo.line}`,
            todo
          })),
          { placeHolder: 'Select a TODO list item to open' }
        );

        if (!picked) {
          return;
        }

        todoId = picked.todo.id;
      }

      const todo = todoManager.getTodoById(todoId!);
      if (!todo) {
        vscode.window.showWarningMessage('Could not find the requested TODO item.');
        return;
      }

      try {
        const document = await vscode.workspace.openTextDocument(todo.file);
        await vscode.window.showTextDocument(document, { preview: false });
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to open TODO list: ${error}`);
      }
    })
  );

  // View logs command
  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.viewLogs', async () => {
      const options = [
        { label: '📦 Agent Logs', value: 'agent' },
        { label: '✅ TODO Logs', value: 'todo' }
      ];
      const selected = await vscode.window.showQuickPick(options, {
        placeHolder: 'Select log type to view'
      });

      if (selected) {
        const config = vscode.workspace.getConfiguration('jarvis.paths');
        const workspaceRootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRootPath) {
          vscode.window.showErrorMessage('No workspace folder found');
          return;
        }
        let logDir: string;

        if (selected.value === 'agent') {
          logDir = path.join(workspaceRootPath, config.get<string>('logDir', '.jarvis/agent-logs'));
        } else {
          logDir = path.join(workspaceRootPath, config.get<string>('todoLogDir', '.jarvis/todo-logs'));
        }

        // Open log directory in explorer
        const uri = vscode.Uri.file(logDir);
        vscode.commands.executeCommand('revealInExplorer', uri);
      }
    })
  );

  // Configure command
  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.configure', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'jarvis');
    })
  );

  // Quick Access command for header button
  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.quickAccess', async () => {
      const options = [
        // 执行操作
        { label: '$(play) Start Agent', value: 'start-agent' },
        { label: '$(run) Execute TODO', value: 'execute-todo' },
        { label: '$(sync) Trigger Manual Execute', value: 'trigger-manual-execute' },
        { kind: vscode.QuickPickItemKind.Separator, label: '' },
        
        // 视图操作
        { label: '$(robot) Open Agents View', value: 'open-agents' },
        { label: '$(checklist) Open TODOs View', value: 'open-todos' },
        { label: '$(graph) Open Statistics', value: 'open-stats' },
        { label: '$(output) View Logs', value: 'view-logs' },
        { kind: vscode.QuickPickItemKind.Separator, label: '' },
        
        // 系统操作
        { label: '$(settings-gear) Configure', value: 'configure' },
        { label: '$(refresh) Refresh All', value: 'refresh-all' },
        { label: '$(info) Show Auto-Execute Status', value: 'show-status' }
      ];

      const selected = await vscode.window.showQuickPick(options, {
        placeHolder: 'Select a Jarvis action'
      });

      if (selected) {
        switch (selected.value) {
          case 'start-agent':
            vscode.commands.executeCommand('jarvis.startAgent');
            break;
          case 'execute-todo':
            vscode.commands.executeCommand('jarvis.executeTodo');
            break;
          case 'view-logs':
            vscode.commands.executeCommand('jarvis.viewLogs');
            break;
          case 'open-agents':
            vscode.commands.executeCommand('jarvis.agents.focus');
            break;
          case 'open-todos':
            vscode.commands.executeCommand('jarvis.todos.focus');
            break;
          case 'open-stats':
            vscode.commands.executeCommand('jarvis.statistics.focus');
            break;
          case 'configure':
            vscode.commands.executeCommand('jarvis.configure');
            break;
          case 'refresh-all':
            vscode.commands.executeCommand('jarvis.refreshAgents');
            vscode.commands.executeCommand('jarvis.refreshTodos');
            break;
          case 'trigger-manual-execute':
            vscode.commands.executeCommand('jarvis.triggerManualExecute');
            break;
          case 'show-status':
            vscode.commands.executeCommand('jarvis.showAutoExecuteStatus');
            break;
        }
      }
    })
  );

  // Refresh commands
  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.refreshAgents', () => {
      agentManager.refresh();
      agentTreeProvider.refresh();
      statisticsProvider.refresh(true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.refreshTodos', () => {
      todoManager.refresh();
      todoTreeProvider.refresh();
      statisticsProvider.refresh(true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.refreshStatistics', () => {
      const logger = Logger.getInstance();
      logger.info('Command', 'Manual statistics refresh triggered');
      statisticsProvider.refresh(true);
      vscode.window.showInformationMessage('Statistics refreshed');
    })
  );

  // Sync log files command
  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.syncLogFiles', () => {
      const logger = Logger.getInstance();
      logger.info('Command', 'Syncing log files...');
      
      // 同步 Agent 和 Todo 的日志文件
      agentManager.syncLogFiles();
      todoManager.syncLogFiles();
      
      // 刷新所有提供者
      agentTreeProvider.refresh();
      todoTreeProvider.refresh();
      statisticsProvider.refresh(true);
      
      vscode.window.showInformationMessage('Log files synchronized successfully');
    })
  );

  // Auto-execute commands
  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.triggerAutoExecute', async () => {
      try {
        await agentManager.triggerAutoExecute();
        vscode.window.showInformationMessage('Auto-execute triggered');
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to trigger auto-execute: ${error}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.triggerManualExecute', async () => {
      try {
        await agentManager.triggerManualExecute();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to trigger manual execute: ${error}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.showAutoExecuteStatus', async () => {
      const config = agentManager.getAutoExecuteConfig();
      const fileStatus = agentManager.getFileChangeStatus();
      
      let statusMessage = `Auto-Execute Status:\n`;
      statusMessage += `- Enabled: ${config.enabled ? 'Yes' : 'No'}\n`;
      statusMessage += `- Agent: ${config.agentName || 'Not configured'}\n`;
      statusMessage += `- Frequency: ${config.frequency}\n`;
      
      if (fileStatus.lastChangeTime) {
        statusMessage += `- Last file change: ${fileStatus.lastChangeTime.toLocaleString()}\n`;
      } else {
        statusMessage += `- Last file change: No changes detected\n`;
      }
      
      if (fileStatus.lastExecutionTime) {
        statusMessage += `- Last execution: ${fileStatus.lastExecutionTime.toLocaleString()}\n`;
      } else {
        statusMessage += `- Last execution: Never executed\n`;
      }
      
      statusMessage += `- Has pending changes: ${fileStatus.hasChanges ? 'Yes' : 'No'}`;
      
      vscode.window.showInformationMessage(statusMessage);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.openTodoLog', async (target?: TodoTreeItem | string) => {
      let todoId: string | undefined;

      if (typeof target === 'string') {
        todoId = target;
      } else if (target instanceof TodoTreeItem) {
        todoId = target.todo.id;
      }

      if (!todoId) {
        const todosWithLogs = todoManager
          .getAllTodos()
          .filter(todo => todo.lastExecution?.logFile)
          .map(todo => ({
            label: todo.text,
            description: todo.lastExecution?.logFile,
            todo
          }));

        if (todosWithLogs.length === 0) {
          vscode.window.showWarningMessage('No TODO logs are available yet.');
          return;
        }

        const picked = await vscode.window.showQuickPick(todosWithLogs, {
          placeHolder: 'Select a TODO log to open'
        });

        if (!picked) {
          return;
        }

        todoId = picked.todo.id;
      }

      const todo = todoManager.getTodoById(todoId);
      if (!todo) {
        vscode.window.showWarningMessage('No log is available for the selected TODO yet.');
        return;
      }

      const historyEntries = todoManager.getHistory(todo.id);
      const linkedHistory = historyEntries.find(entry => entry.id === todo.lastExecution?.historyId) ?? historyEntries[0];
      const logFile = linkedHistory?.logFile ?? todo.lastExecution?.logFile;

      if (!logFile) {
        vscode.window.showWarningMessage('No log is available for the selected TODO yet.');
        return;
      }

      const todoViewerId = linkedHistory && linkedHistory.status === 'running'
        ? todo.id
        : linkedHistory
          ? `${todo.id}#${linkedHistory.id}`
          : todo.id;

      await logViewer.openLog({
        type: 'todo',
        id: todoViewerId,
        title: todo.text,
        logFile,
        run: linkedHistory
          ? {
              status: linkedHistory.status,
              startTime: linkedHistory.startTime,
              endTime: linkedHistory.endTime,
              versionHash: linkedHistory.versionHash,
              sourceFile: linkedHistory.sourceFile
            }
          : {
              status: todo.executionStatus,
              startTime: todo.lastExecution?.startTime?.toISOString(),
              endTime: todo.lastExecution?.endTime?.toISOString(),
              sourceFile: todo.file
            }
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.openAgentLog', async (target?: AgentTreeItem | string) => {
      let agentName: string | undefined;

      if (typeof target === 'string') {
        agentName = target;
      } else if (target instanceof AgentTreeItem) {
        agentName = target.agent.name;
      }

      if (!agentName) {
        const agentsWithLogs = agentManager
          .getAgents()
          .map(agent => {
            const status = agentManager.getStatus(agent.name);
            if (!status?.logFile) {
              return undefined;
            }
            return {
              label: agent.name,
              description: status.logFile || 'No log file available',
              agent,
              logFile: status.logFile
            };
          })
          .filter((entry): entry is { label: string; description: string; agent: any; logFile: string } => !!entry);

        if (agentsWithLogs.length === 0) {
          vscode.window.showWarningMessage('No agent logs are available yet.');
          return;
        }

        const picked = await vscode.window.showQuickPick(agentsWithLogs, {
          placeHolder: 'Select an agent log to open'
        });

        if (!picked) {
          return;
        }

        agentName = picked.agent.name;
      }

      const status = agentManager.getStatus(agentName!);
      if (!status?.logFile) {
        const fallbackHistory = agentManager.getHistory(agentName!);
        if (fallbackHistory.length === 0) {
          vscode.window.showWarningMessage('No log is available for the selected agent yet.');
          return;
        }
      }

      const agent = agentManager.getAgent(agentName!);
      const title = agent?.description ? `${agent.name} — ${agent.description}` : agentName;
      const historyEntries = agentManager.getHistory(agentName!);
      const linkedHistory = historyEntries.find(entry => entry.id === status?.historyId) ?? historyEntries[0];
      const logFile = linkedHistory?.logFile ?? status?.logFile;

      if (!logFile) {
        vscode.window.showWarningMessage('No log is available for the selected agent yet.');
        return;
      }

      const agentViewerId = linkedHistory && linkedHistory.status === 'running'
        ? agentName
        : linkedHistory
          ? `${agentName}#${linkedHistory.id}`
          : agentName;

      await logViewer.openLog({
        type: 'agent',
        id: agentViewerId!,
        title: title || agentName!,
        logFile,
        run: linkedHistory
          ? {
              status: linkedHistory.status,
              startTime: linkedHistory.startTime,
              endTime: linkedHistory.endTime,
              versionHash: linkedHistory.versionHash,
              sourceFile: linkedHistory.sourceFile
            }
          : {
              status: status?.state,
              startTime: status?.startTime?.toISOString(),
              endTime: status?.lastCompleted?.toISOString(),
              sourceFile: agent?.sourcePath
            }
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.openExecutionLog', async (entry?: ExecutionHistoryEntry) => {
      if (!entry) {
        return;
      }

      // Validate required properties
      const logger = Logger.getInstance();
      logger.info("Extension - Execution History", JSON.stringify(entry));
      if (!entry.logFile) {
        vscode.window.showWarningMessage('No log file available for this execution history entry.');
        return;
      }

      const historyEntry = entry;
      const contextId = `${historyEntry.targetId}#${historyEntry.id}`;
      const type = historyEntry.type;
      const title = `${historyEntry.label} (${new Date(historyEntry.startTime).toLocaleString()})`;

      await logViewer.openLog({
        type,
        id: contextId,
        title,
        logFile: historyEntry.logFile,
        run: {
          status: historyEntry.status,
          startTime: historyEntry.startTime,
          endTime: historyEntry.endTime,
          versionHash: historyEntry.versionHash,
          sourceFile: historyEntry.sourceFile
        }
      });
    })
  );

  // History viewer commands
  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.viewAgentHistory', async (agentName?: string) => {
      if (!agentName) {
        const agents = agentManager.getAgents();
        const picked = await vscode.window.showQuickPick(
          agents.map(agent => ({
            label: agent.name,
            description: agent.description,
            agentName: agent.name
          })),
          { placeHolder: 'Select an agent to view history' }
        );
        if (!picked) {
          return;
        }
        agentName = picked.agentName;
      }

      const agent = agentManager.getAgent(agentName);
      const title = agent ? `${agent.name} - Execution History` : `${agentName} - Execution History`;

      await historyViewer.openHistoryView({
        type: 'agent',
        targetId: agentName,
        title
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.viewTodoHistory', async (todoId?: string) => {
      if (!todoId) {
        const todos = todoManager.getAllTodos();
        const picked = await vscode.window.showQuickPick(
          todos.map(todo => ({
            label: todo.text,
            description: `${path.basename(todo.file)}:${todo.line}`,
            todoId: todo.id
          })),
          { placeHolder: 'Select a TODO to view history' }
        );
        if (!picked) {
          return;
        }
        todoId = picked.todoId;
      }

      const todo = todoManager.getTodoById(todoId);
      const title = todo ? `${todo.text} - Execution History` : `TODO - Execution History`;

      await historyViewer.openHistoryView({
        type: 'todo',
        targetId: todoId,
        title
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.viewAllHistory', async () => {
      await historyViewer.openHistoryView({
        type: 'all',
        title: 'All Execution History'
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.selectAutoExecuteAgent', async () => {
      const agents = agentManager.getAgents();
      if (agents.length === 0) {
        vscode.window.showWarningMessage('No agents available. Please create an agent first.');
        return;
      }

      const currentConfig = vscode.workspace.getConfiguration('jarvis.autoExecute');
      const currentAgentName = currentConfig.get<string>('agentName', '');

      const selected = await vscode.window.showQuickPick(
        agents.map(a => ({
          label: a.name,
          description: a.description || 'No description',
          picked: a.name === currentAgentName
        })),
        { 
          placeHolder: 'Select an agent for auto-execution',
          title: 'Select Auto-Execute Agent'
        }
      );

      if (selected) {
        await currentConfig.update('agentName', selected.label, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`Auto-execute agent set to: ${selected.label}`);
      }
    })
  );
}

async function checkEnvironment() {
  const config = vscode.workspace.getConfiguration('jarvis.claude.environment');
  if (!config.get<boolean>('checkOnStartup', true)) {
    return;
  }

  // Check if Claude is installed
  const { exec } = require('child_process');
  const claudeExecutable = vscode.workspace.getConfiguration('jarvis.claude').get<string>('executable', 'claude');

  exec(`${claudeExecutable} --version`, (error: any, stdout: string) => {
    if (error) {
      vscode.window.showErrorMessage(
        'Claude Code CLI not found. Please install it first.',
        'Open Documentation'
      ).then(selection => {
        if (selection === 'Open Documentation') {
          vscode.env.openExternal(vscode.Uri.parse('https://docs.claude.ai/cli'));
        }
      });
      return;
    }

    console.log(`Claude Code CLI found: ${stdout}`);

    // Check for required MCPs
    const requiredMcps = vscode.workspace.getConfiguration('jarvis.claude').get<string[]>('requiredMcps', []);
    if (requiredMcps.length > 0 && config.get<boolean>('autoInstallMcp', false)) {
      // Auto-install MCPs if configured
      checkAndInstallMcps(requiredMcps);
    }
  });
}

async function checkAndInstallMcps(mcps: string[]) {
  // This is a placeholder for MCP checking logic
  // In a real implementation, you would check if MCPs are installed
  // and potentially auto-install them if configured
  console.log('Checking MCPs:', mcps);
}

export function deactivate() {
  const logger = Logger.getInstance();
  logger.info('Extension', 'Deactivating Jarvis extension...');

  // Clean up
  agentManager?.dispose();
  todoManager?.dispose();
  agentTreeProvider?.dispose();
  todoTreeProvider?.dispose();
  statisticsProvider?.dispose();
  logViewer?.dispose();
  historyViewer?.dispose();
  historyStore?.dispose();

  logger.info('Extension', 'Jarvis extension deactivated');
  logger.dispose();
}
