import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ExecutionHistoryEntry } from './historyStore';
import { AgentManager } from '../executors/agentManager';
import { TodoManager } from '../executors/todoManager';
import { Logger } from './logger';

interface HistoryViewerOptions {
  type: 'agent' | 'todo' | 'all';
  targetId?: string;
  title: string;
}

export class HistoryViewer implements vscode.TextDocumentContentProvider {
  private static readonly scheme = 'jarvis-history';
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.onDidChangeEmitter.event;
  private activeViews = new Map<string, HistoryViewerOptions>();
  private logger: Logger;

  constructor(
    private agentManager: AgentManager,
    private todoManager: TodoManager
  ) {
    this.logger = Logger.getInstance();
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const viewId = uri.authority || uri.path.replace(/^\//, '');
    const options = this.activeViews.get(viewId);

    if (!options) {
      return '# No history data available';
    }

    this.logger.info("HistoryViewer", `Providing history content for: ${options.type}/${options.targetId || 'all'}`);

    // Gather history entries
    let entries: ExecutionHistoryEntry[] = [];

    if (options.type === 'agent') {
      if (options.targetId) {
        entries = this.agentManager.getHistory(options.targetId);
      } else {
        entries = this.agentManager.getAllHistory();
      }
    } else if (options.type === 'todo') {
      if (options.targetId) {
        entries = this.todoManager.getHistory(options.targetId);
      } else {
        entries = this.todoManager.getAllHistory();
      }
    } else {
      // Show all history
      entries = [
        ...this.agentManager.getAllHistory(),
        ...this.todoManager.getAllHistory()
      ];
    }

    // Sort by start time descending
    entries.sort((a, b) =>
      new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );

    return this.formatHistoryAsMarkdown(options.title, entries);
  }

  private formatHistoryAsMarkdown(title: string, entries: ExecutionHistoryEntry[]): string {
    const lines: string[] = [];

    lines.push(`# ${title}`);
    lines.push('');
    lines.push(`*Total Executions: ${entries.length}*`);
    lines.push('');

    if (entries.length === 0) {
      lines.push('No execution history available.');
      return lines.join('\n');
    }

    // Create table header
    lines.push('| Time | Type | Name | Status | Duration | Source | Log | Version |');
    lines.push('|------|------|------|--------|----------|--------|-----|---------|');

    // Add table rows
    for (const entry of entries) {
      const startTime = new Date(entry.startTime);
      const timeStr = this.formatDateTime(startTime);
      const typeIcon = entry.type === 'agent' ? '🤖' : '✅';
      const statusIcon = this.getStatusIcon(entry.status);
      const duration = this.calculateDuration(entry);

      // Create clickable links for source and log files
      const sourceName = entry.sourceFile ? path.basename(entry.sourceFile) : '-';
      const sourceLink = entry.sourceFile && fs.existsSync(entry.sourceFile)
        ? `[${sourceName}](command:vscode.open?${encodeURIComponent(JSON.stringify([vscode.Uri.file(entry.sourceFile)]))})`
        : sourceName;

      const logName = entry.logFile ? path.basename(entry.logFile) : '-';
      const logLink = entry.logFile && fs.existsSync(entry.logFile)
        ? `[${logName}](command:jarvis.openLog?${encodeURIComponent(JSON.stringify([entry.type, entry.targetId, entry.logFile]))})`
        : logName;

      const versionShort = entry.versionHash ? entry.versionHash.substring(0, 8) : '-';

      lines.push(`| ${timeStr} | ${typeIcon} ${entry.type} | ${entry.label} | ${statusIcon} ${entry.status} | ${duration} | ${sourceLink} | ${logLink} | ${versionShort} |`);
    }

    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Legend');
    lines.push('- 🤖 Agent execution');
    lines.push('- ✅ TODO execution');
    lines.push('- ✅ Success');
    lines.push('- ❌ Failed');
    lines.push('- ⏸️ Stopped');
    lines.push('- ⏳ Running');
    lines.push('');
    lines.push('*Click on source files to open them, click on log files to view execution logs.*');

    return lines.join('\n');
  }

  private formatDateTime(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());

    return `${month}/${day} ${hours}:${minutes}:${seconds}`;
  }

  private getStatusIcon(status: string): string {
    switch (status) {
      case 'success': return '✅';
      case 'failed': return '❌';
      case 'stopped': return '⏸️';
      case 'running': return '⏳';
      default: return '❓';
    }
  }

  private calculateDuration(entry: ExecutionHistoryEntry): string {
    if (!entry.endTime) {
      if (entry.status === 'running') {
        const duration = Date.now() - new Date(entry.startTime).getTime();
        return this.formatDuration(duration);
      }
      return '-';
    }

    const duration = new Date(entry.endTime).getTime() - new Date(entry.startTime).getTime();
    return this.formatDuration(duration);
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  async openHistoryView(options: HistoryViewerOptions): Promise<void> {
    const viewId = `${options.type}-${options.targetId || 'all'}-${Date.now()}`;
    const uri = vscode.Uri.parse(`${HistoryViewer.scheme}://${viewId}`);

    this.activeViews.set(viewId, options);

    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, {
      preview: false,
      preserveFocus: false,
      viewColumn: vscode.ViewColumn.One
    });

    // Set up auto-refresh
    const refreshInterval = setInterval(() => {
      if (!this.activeViews.has(viewId)) {
        clearInterval(refreshInterval);
        return;
      }

      // Check if the document is still open
      const isOpen = vscode.window.visibleTextEditors.some(
        editor => editor.document.uri.toString() === uri.toString()
      );

      if (!isOpen) {
        this.activeViews.delete(viewId);
        clearInterval(refreshInterval);
        return;
      }

      this.onDidChangeEmitter.fire(uri);
    }, 5000); // Refresh every 5 seconds

    this.logger.info("HistoryViewer", `Opened history view: ${options.title}`);
  }

  dispose(): void {
    this.activeViews.clear();
    this.onDidChangeEmitter.dispose();
  }

  static register(context: vscode.ExtensionContext, agentManager: AgentManager, todoManager: TodoManager): HistoryViewer {
    const viewer = new HistoryViewer(agentManager, todoManager);

    const provider = vscode.workspace.registerTextDocumentContentProvider(
      HistoryViewer.scheme,
      viewer
    );

    context.subscriptions.push(provider);

    // Register command to open log files from history view
    context.subscriptions.push(
      vscode.commands.registerCommand('jarvis.openLog', async (type: string, targetId: string, logFile: string) => {
        if (!logFile || !fs.existsSync(logFile)) {
          vscode.window.showWarningMessage('Log file not found');
          return;
        }

        const uri = vscode.Uri.file(logFile);
        await vscode.window.showTextDocument(uri);
      })
    );

    return viewer;
  }
}
