import * as vscode from 'vscode';
import * as path from 'path';
import { AgentManager } from './executors/agentManager';
import { TodoManager } from './executors/todoManager';
import { AgentTreeProvider, AgentTreeItem } from './providers/agentTreeProvider';
import { TodoTreeProvider, TodoTreeItem } from './providers/todoTreeProvider';
import { StatisticsProvider } from './providers/statisticsProvider';
import { LogViewer } from './utils/logViewer';
import { HistoryStore, ExecutionHistoryEntry } from './utils/historyStore';
import { HistoryViewer } from './utils/historyViewer';
import { Logger } from './utils/logger';

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

  // Initialize log viewer and managers
  logViewer = new LogViewer(workspaceRoot);
  context.subscriptions.push(logViewer);

  historyStore = new HistoryStore(workspaceRoot);
  context.subscriptions.push({ dispose: () => historyStore.dispose() });

  agentManager = new AgentManager(workspaceRoot, logViewer, historyStore);
  todoManager = new TodoManager(workspaceRoot, logViewer, historyStore);

  // Initialize history viewer
  historyViewer = HistoryViewer.register(context, agentManager, todoManager);

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

  // Show welcome message
  const config = vscode.workspace.getConfiguration('jarvis.ui');
  if (config.get<boolean>('showNotifications', true)) {
    vscode.window.showInformationMessage('Jarvis is ready to assist you! 🤖');
  }
}

function registerCommands(context: vscode.ExtensionContext, logViewer: LogViewer) {
  // Agent commands
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
        { label: '$(play) Start Agent', value: 'start-agent' },
        { label: '$(run) Execute TODO', value: 'execute-todo' },
        { label: '$(output) View Logs', value: 'view-logs' },
        { label: '$(robot) Open Agents View', value: 'open-agents' },
        { label: '$(checklist) Open TODOs View', value: 'open-todos' },
        { label: '$(graph) Open Statistics', value: 'open-stats' },
        { label: '$(settings-gear) Configure', value: 'configure' },
        { label: '$(refresh) Refresh All', value: 'refresh-all' }
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
