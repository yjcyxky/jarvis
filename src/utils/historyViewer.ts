import * as fs from 'fs';
import * as vscode from 'vscode';
import { HistoryStore, type ExecutionHistoryEntry } from './historyStore';
import { AgentManager } from '../executors/agentManager';
import { TodoManager } from '../executors/todoManager';
import { Logger } from './logger';
import { LogViewer } from './logViewer';
import type {
  HistoryDataPayload,
  HistoryEntryViewModel,
  HistoryFromWebviewMessage,
  HistorySummaryViewModel,
  HistoryToWebviewMessage
} from '../webviews/shared/historyMessages';

export interface HistoryViewerOptions {
  type: 'agent' | 'todo' | 'all';
  targetId?: string;
  title: string;
}

interface HistoryPanelState {
  panel: vscode.WebviewPanel;
  options: HistoryViewerOptions;
  ready: boolean;
  pendingMessages: HistoryToWebviewMessage[];
}

export class HistoryViewer implements vscode.Disposable {
  private readonly panels = new Map<string, HistoryPanelState>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly logger = Logger.getInstance();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly agentManager: AgentManager,
    private readonly todoManager: TodoManager,
    private readonly logViewer: LogViewer,
    private readonly historyStore: HistoryStore
  ) {
    this.disposables.push(
      this.agentManager.onDidChange(() => this.refreshAll()),
      this.todoManager.onDidChange(() => this.refreshAll())
    );
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.panels.forEach(state => state.panel.dispose());
    this.panels.clear();
  }

  async openHistoryView(options: HistoryViewerOptions): Promise<void> {
    const key = this.getViewKey(options);
    const existing = this.panels.get(key);

    if (existing) {
      existing.options = options;
      existing.panel.title = options.title;
      existing.panel.reveal(vscode.ViewColumn.Active, false);
      this.postData(existing);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'jarvisHistory',
      options.title,
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webviews')]
      }
    );

    const state: HistoryPanelState = {
      panel,
      options,
      ready: false,
      pendingMessages: []
    };

    this.panels.set(key, state);

    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'resources', 'jarvis-icon.png');

    panel.onDidDispose(() => {
      this.panels.delete(key);
    });

    panel.webview.onDidReceiveMessage(async (message: HistoryFromWebviewMessage) => {
      switch (message.type) {
        case 'ready':
          state.ready = true;
          this.flushPendingMessages(state);
          break;
        case 'refresh':
          this.postData(state);
          break;
        case 'openLog':
          await this.handleOpenLog(state, message.payload.entryId);
          break;
        case 'openSource':
          await this.handleOpenSource(state, message.payload.entryId);
          break;
        case 'deleteEntry':
          await this.handleDeleteEntry(state, message.payload.entryId);
          break;
        default:
          this.logger.warn('HistoryViewer', `Received unknown message: ${JSON.stringify(message)}`);
      }
    });

    panel.webview.html = this.getHtml(panel.webview);
    this.postData(state);
  }

  private refreshAll(): void {
    this.panels.forEach(state => this.postData(state));
  }

  private getViewKey(options: HistoryViewerOptions): string {
    return `${options.type}:${options.targetId ?? 'all'}`;
  }

  private postData(state: HistoryPanelState): void {
    try {
      const payload = this.buildViewModel(state.options);
      this.enqueueMessage(state, { type: 'historyData', payload });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.enqueueMessage(state, { type: 'showError', payload: { message } });
    }
  }

  private enqueueMessage(state: HistoryPanelState, message: HistoryToWebviewMessage): void {
    if (state.ready) {
      state.panel.webview.postMessage(message).then(undefined, (err: any) => {
        this.logger.error('HistoryViewer', 'Failed to post message to webview', err);
      });
    } else {
      state.pendingMessages.push(message);
    }
  }

  private flushPendingMessages(state: HistoryPanelState): void {
    if (!state.ready) {
      return;
    }

    while (state.pendingMessages.length > 0) {
      const message = state.pendingMessages.shift();
      if (message) {
        state.panel.webview.postMessage(message).then(undefined, (err: any) => {
          this.logger.error('HistoryViewer', 'Failed to post queued message', err);
        });
      }
    }
  }

  private buildViewModel(options: HistoryViewerOptions): HistoryDataPayload {
    const entries = this.getEntries(options);

    const viewEntries: HistoryEntryViewModel[] = entries.map(entry => ({
      id: entry.id,
      type: entry.type,
      targetId: entry.targetId,
      label: entry.label,
      status: entry.status,
      startTime: entry.startTime,
      endTime: entry.endTime,
      durationMs: this.calculateDuration(entry),
      sourceFile: entry.sourceFile,
      logFile: entry.logFile,
      versionHash: entry.versionHash,
      metadata: entry.metadata
    }));

    const summary = this.calculateSummary(viewEntries);

    return {
      title: options.title,
      filter: { type: options.type, targetId: options.targetId },
      entries: viewEntries,
      summary
    };
  }

  private getEntries(options: HistoryViewerOptions): ExecutionHistoryEntry[] {
    let entries: ExecutionHistoryEntry[] = [];

    if (options.type === 'agent') {
      entries = options.targetId
        ? this.agentManager.getHistory(options.targetId)
        : this.agentManager.getAllHistory();
    } else if (options.type === 'todo') {
      entries = options.targetId
        ? this.todoManager.getHistory(options.targetId)
        : this.todoManager.getAllHistory();
    } else {
      entries = [
        ...this.agentManager.getAllHistory(),
        ...this.todoManager.getAllHistory()
      ];
    }

    return entries.sort((a, b) =>
      new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );
  }

  private calculateDuration(entry: ExecutionHistoryEntry): number | undefined {
    if (!entry.endTime) {
      return undefined;
    }
    const start = new Date(entry.startTime).getTime();
    const end = new Date(entry.endTime).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) {
      return undefined;
    }
    return Math.max(0, end - start);
  }

  private calculateSummary(entries: HistoryEntryViewModel[]): HistorySummaryViewModel {
    const summary: HistorySummaryViewModel = {
      total: entries.length,
      running: 0,
      success: 0,
      failed: 0,
      stopped: 0,
      paused: 0,
      lastRun: undefined as string | undefined
    };

    let latestTimestamp = 0;

    entries.forEach(entry => {
      switch (entry.status) {
        case 'running':
          summary.running += 1;
          break;
        case 'success':
          summary.success += 1;
          break;
        case 'failed':
          summary.failed += 1;
          break;
        case 'stopped':
          summary.stopped += 1;
          break;
        case 'paused':
          summary.paused += 1;
          break;
        default:
          break;
      }

      const candidate = entry.endTime ?? entry.startTime;
      const timestamp = new Date(candidate).getTime();
      if (!Number.isNaN(timestamp) && timestamp > latestTimestamp) {
        latestTimestamp = timestamp;
      }
    });

    if (latestTimestamp > 0) {
      summary.lastRun = new Date(latestTimestamp).toISOString();
    }

    return summary;
  }

  private async handleOpenLog(state: HistoryPanelState, entryId: string): Promise<void> {
    const entry = this.getEntries(state.options).find(item => item.id === entryId);
    if (!entry) {
      vscode.window.showWarningMessage('History entry no longer available.');
      return;
    }

    const timestamp = new Date(entry.startTime);
    const titleSuffix = Number.isNaN(timestamp.getTime())
      ? ''
      : ` (${timestamp.toLocaleString()})`;
    const panelTitle = `${entry.label}${titleSuffix}`;

    await this.logViewer.openLog({
      type: entry.type,
      id: entry.targetId,
      title: panelTitle,
      logFile: entry.logFile,
      run: {
        status: entry.status,
        startTime: entry.startTime,
        endTime: entry.endTime,
        versionHash: entry.versionHash,
        sourceFile: entry.sourceFile
      }
    });
  }

  private async handleOpenSource(state: HistoryPanelState, entryId: string): Promise<void> {
    const entry = this.getEntries(state.options).find(item => item.id === entryId);
    if (!entry || !entry.sourceFile) {
      vscode.window.showWarningMessage('Source file is not available for this entry.');
      return;
    }

    if (!fs.existsSync(entry.sourceFile)) {
      vscode.window.showWarningMessage('Source file no longer exists on disk.');
      return;
    }

    try {
      const document = await vscode.workspace.openTextDocument(entry.sourceFile);
      const uri = document.uri;
      await vscode.window.showTextDocument(uri, { preview: false });
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to open source file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async handleDeleteEntry(state: HistoryPanelState, entryId: string): Promise<void> {
    this.enqueueMessage(state, { type: 'setLoading', payload: true });

    try {
      const entry = this.historyStore.getById(entryId);

      if (!entry) {
        vscode.window.showWarningMessage('History entry no longer exists.');
        this.enqueueMessage(state, {
          type: 'showError',
          payload: { message: 'History entry no longer exists.' }
        });
        return;
      }

      const logExists = entry.logFile && fs.existsSync(entry.logFile);
      const deleteRecordOption = 'Delete Record';
      const deleteRecordAndLogOption = 'Delete Record and Log File';
      const choices = logExists
        ? [deleteRecordOption, deleteRecordAndLogOption]
        : [deleteRecordOption];

      const selection = await vscode.window.showWarningMessage(
        `Delete run "${entry.label}"? This action cannot be undone.`,
        {
          modal: true,
          detail: logExists ? `Log file: ${entry.logFile}` : undefined
        },
        ...choices
      );

      if (!selection) {
        return;
      }

      const removed = this.historyStore.removeById(entryId);
      if (!removed) {
        vscode.window.showWarningMessage('Failed to remove the selected history entry.');
        this.enqueueMessage(state, {
          type: 'showError',
          payload: { message: 'Failed to remove the selected history entry.' }
        });
        return;
      }

      if (selection === deleteRecordAndLogOption && removed.logFile && fs.existsSync(removed.logFile)) {
        try {
          await fs.promises.unlink(removed.logFile);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(
            `History entry removed, but failed to delete log file: ${message}`
          );
        }
      }

      if (removed.type === 'agent') {
        this.agentManager.notifyHistoryChange();
      } else if (removed.type === 'todo') {
        this.todoManager.notifyHistoryChange();
      }

      vscode.window.showInformationMessage('History entry deleted.');
    } finally {
      this.postData(state);
      this.enqueueMessage(state, { type: 'setLoading', payload: false });
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webviews', 'history.js')
    );
    const nonce = this.generateNonce();
    const csp = [
      `default-src 'none';`,
      `img-src ${webview.cspSource} https:;`,
      `script-src 'nonce-${nonce}';`,
      `style-src ${webview.cspSource} 'unsafe-inline';`,
      `font-src ${webview.cspSource} https:;`
    ].join(' ');

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Jarvis History</title>
    <style>
      body {
        padding: 0;
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      #root {
        height: 100vh;
        width: 100vw;
        background: var(--vscode-editor-background);
        color: var(--vscode-foreground);
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }

  private generateNonce(): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return result;
  }
}
