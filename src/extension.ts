import * as vscode from 'vscode';
import * as path from 'path';
import { AgentManager } from './executors/agentManager';
import { TodoManager } from './executors/todoManager';
import { AgentTreeProvider, AgentTreeItem } from './providers/agentTreeProvider';
import { TodoTreeProvider, TodoTreeItem } from './providers/todoTreeProvider';
import { StatisticsProvider } from './providers/statisticsProvider';

let agentManager: AgentManager;
let todoManager: TodoManager;
let agentTreeProvider: AgentTreeProvider;
let todoTreeProvider: TodoTreeProvider;
let statisticsProvider: StatisticsProvider;

export function activate(context: vscode.ExtensionContext) {
  console.log('Jarvis extension is now active!');

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('Jarvis requires a workspace to be opened');
    return;
  }

  // Initialize managers
  agentManager = new AgentManager(workspaceRoot);
  todoManager = new TodoManager(workspaceRoot);

  // Initialize providers
  agentTreeProvider = new AgentTreeProvider(agentManager);
  todoTreeProvider = new TodoTreeProvider(todoManager);
  statisticsProvider = new StatisticsProvider(agentManager, todoManager);

  // Register tree data providers
  vscode.window.registerTreeDataProvider('jarvis.agents', agentTreeProvider);
  vscode.window.registerTreeDataProvider('jarvis.todos', todoTreeProvider);
  vscode.window.registerTreeDataProvider('jarvis.statistics', statisticsProvider);

  // Register commands
  registerCommands(context);

  // Check environment on startup
  checkEnvironment();

  // Show welcome message
  const config = vscode.workspace.getConfiguration('jarvis.ui');
  if (config.get<boolean>('showNotifications', true)) {
    vscode.window.showInformationMessage('Jarvis is ready to assist you! 🤖');
  }
}

function registerCommands(context: vscode.ExtensionContext) {
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

  // TODO commands
  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.executeTodo', async (item: TodoTreeItem) => {
      if (item?.todo) {
        try {
          await todoManager.executeTodo(item.todo.id);
          todoTreeProvider.refresh();
          statisticsProvider.refresh();
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
            statisticsProvider.refresh();
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to execute TODO: ${error}`);
          }
        }
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

  // Refresh commands
  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.refreshAgents', () => {
      agentManager.refresh();
      agentTreeProvider.refresh();
      statisticsProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('jarvis.refreshTodos', () => {
      todoManager.refresh();
      todoTreeProvider.refresh();
      statisticsProvider.refresh();
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
  // Clean up
  agentManager?.dispose();
  todoManager?.dispose();
  agentTreeProvider?.dispose();
  todoTreeProvider?.dispose();
  statisticsProvider?.dispose();
}