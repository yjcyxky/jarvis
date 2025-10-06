import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ClaudeJsonMessage } from '../types';
import { Logger } from './logger';
import { HistoryStore } from './historyStore';
import type { HistoryEntryType } from '../webviews/shared/historyMessages';
import type {
  LogDataPayload,
  LogEntryViewModel,
  LogFromWebviewMessage,
  LogPayloadSegment,
  LogStatsViewModel,
  LogToWebviewMessage
} from '../webviews/shared/logMessages';

type LogType = HistoryEntryType;

interface LogContext {
  type: LogType;
  id: string;
  title: string;
  logFile: string;
  run?: {
    status?: string;
    startTime?: string;
    endTime?: string;
    versionHash?: string;
    sourceFile?: string;
    error?: string;
  };
}

interface LogPanelState {
  panel: vscode.WebviewPanel;
  context: LogContext;
  ready: boolean;
  pendingMessages: LogToWebviewMessage[];
}

interface WatcherRecord {
  watcher?: fs.FSWatcher;
  interval?: NodeJS.Timeout;
}

interface ParsedLogEntry {
  index: number;
  badge: string;
  status: string;
  timestamp?: Date;
  tokens?: number;
  payload: LogPayloadSegment[];
  raw: string;
}

export class LogViewer implements vscode.Disposable {
  private readonly logger = Logger.getInstance();
  private readonly contexts = new Map<string, LogContext>();
  private readonly panels = new Map<string, LogPanelState>();
  private readonly watchers = new Map<string, WatcherRecord>();
  private readonly updateTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly workspaceRoot: string,
    private readonly historyStore?: HistoryStore
  ) {}

  dispose(): void {
    this.panels.forEach(state => state.panel.dispose());
    this.watchers.forEach(record => this.disposeWatcherRecord(record));
    this.panels.clear();
    this.watchers.clear();
    this.updateTimers.forEach(timer => clearTimeout(timer));
    this.updateTimers.clear();
    this.contexts.clear();
  }

  async openLog(context: LogContext): Promise<void> {
    const key = this.getKey(context.type, context.id);

    const existingContext = this.contexts.get(key);
    const mergedContext: LogContext = {
      ...(existingContext ?? {}),
      ...context,
      run: {
        ...(existingContext?.run ?? {}),
        ...(context.run ?? {})
      }
    };
    this.contexts.set(key, mergedContext);

    const existing = this.panels.get(key);
    if (existing) {
      existing.context = mergedContext;
      existing.panel.title = mergedContext.title;
      existing.panel.reveal(vscode.ViewColumn.Beside, false);
      this.ensureWatcher(key, mergedContext);
      this.postData(existing);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'jarvisLog',
      mergedContext.title,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webviews')]
      }
    );

    panel.iconPath = vscode.Uri.file(path.join(this.extensionUri.fsPath, 'resources', 'jarvis-icon.png'));

    const state: LogPanelState = {
      panel,
      context: mergedContext,
      ready: false,
      pendingMessages: []
    };

    this.panels.set(key, state);

    panel.onDidDispose(() => {
      this.disposeWatcher(key);
      this.panels.delete(key);
      this.contexts.delete(key);
    });

    panel.webview.onDidReceiveMessage(async (message: LogFromWebviewMessage) => {
      switch (message.type) {
        case 'ready':
          state.ready = true;
          this.flushPendingMessages(state);
          break;
        case 'refresh':
          this.postData(state);
          break;
        case 'openLogFile':
          await this.openLogFile(state.context.logFile);
          break;
        case 'openSource':
          await this.openSourceFile(state.context.run?.sourceFile);
          break;
        default:
          this.logger.warn('LogViewer', `Received unknown message: ${JSON.stringify(message)}`);
      }
    });

    panel.webview.html = this.getHtml(panel.webview);

    this.ensureWatcher(key, mergedContext);
    this.postData(state);
  }

  updateRunContext(type: LogType, id: string, updates: LogContext['run']): void {
    const key = this.getKey(type, id);
    const context = this.contexts.get(key);
    if (!context) {
      return;
    }

    context.run = {
      ...(context.run ?? {}),
      ...(updates ?? {})
    };
    this.contexts.set(key, context);

    const panelState = this.panels.get(key);
    if (panelState) {
      panelState.context = context;
      this.postData(panelState);
    }
  }

  private postData(state: LogPanelState): void {
    try {
      const payload = this.buildPayload(state.context);
      this.enqueueMessage(state, { type: 'logData', payload });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.enqueueMessage(state, { type: 'showError', payload: { message } });
    }
  }

  private enqueueMessage(state: LogPanelState, message: LogToWebviewMessage): void {
    if (state.ready) {
      state.panel.webview.postMessage(message).then(undefined, (err: any) => {
        this.logger.error('LogViewer', 'Failed to post message to webview', err);
      });
    } else {
      state.pendingMessages.push(message);
    }
  }

  private flushPendingMessages(state: LogPanelState): void {
    if (!state.ready) {
      return;
    }

    while (state.pendingMessages.length > 0) {
      const message = state.pendingMessages.shift();
      if (message) {
        state.panel.webview.postMessage(message).then(undefined, (err: any) => {
          this.logger.error('LogViewer', 'Failed to post queued message', err);
        });
      }
    }
  }

  private ensureWatcher(key: string, context: LogContext): void {
    this.disposeWatcher(key);

    const directory = path.dirname(context.logFile);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }
    if (!fs.existsSync(context.logFile)) {
      fs.writeFileSync(context.logFile, '', 'utf8');
    }

    const record: WatcherRecord = {};

    try {
      const watcher = fs.watch(context.logFile, { persistent: true }, eventType => {
        if (eventType === 'change') {
          this.scheduleUpdate(key);
        } else if (eventType === 'rename') {
          // 文件被重命名或删除
          this.handleFileDeleted(key, context.logFile);
        }
      });
      record.watcher = watcher;
    } catch (error) {
      this.logger.error('LogViewer', `Failed to watch log file ${context.logFile}`, error);
    }

    // Fallback polling in case file watching fails or misses events.
    const interval = setInterval(() => {
      if (fs.existsSync(context.logFile)) {
        this.scheduleUpdate(key);
      } else {
        // 文件不存在，可能被删除了
        this.handleFileDeleted(key, context.logFile);
      }
    }, 2000);
    record.interval = interval;

    this.watchers.set(key, record);
  }

  private scheduleUpdate(key: string): void {
    const existingTimer = this.updateTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.updateTimers.delete(key);
      const state = this.panels.get(key);
      if (state) {
        this.postData(state);
      }
    }, 120);

    this.updateTimers.set(key, timer);
  }

  private handleFileDeleted(key: string, logFile: string): void {
    this.logger.info('LogViewer', `Log file deleted: ${logFile}`);
    
    // 关闭相关的面板
    const state = this.panels.get(key);
    if (state) {
      state.panel.dispose();
    }
    
    // 清理监控器
    this.disposeWatcher(key);
    
    // 通知外部系统文件已删除
    this.notifyFileDeleted(logFile);
  }

  private notifyFileDeleted(logFile: string): void {
    this.logger.info('LogViewer', `Notifying file deletion: ${logFile}`);
    
    // 通知 HistoryStore 删除相关的历史记录
    if (this.historyStore) {
      const removed = this.historyStore.removeByLogFile(logFile);
      if (removed) {
        this.logger.info('LogViewer', `Removed history record for deleted log file: ${logFile}`);
      }
    }
  }

  private disposeWatcher(key: string): void {
    const record = this.watchers.get(key);
    if (record) {
      this.disposeWatcherRecord(record);
      this.watchers.delete(key);
    }
    const timer = this.updateTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.updateTimers.delete(key);
    }
  }

  private disposeWatcherRecord(record: WatcherRecord): void {
    if (record.watcher) {
      record.watcher.close();
    }
    if (record.interval) {
      clearInterval(record.interval);
    }
  }

  private buildPayload(context: LogContext): LogDataPayload {
    const { logFile } = context;

    if (!fs.existsSync(logFile)) {
      throw new Error('Log file not found.');
    }

    const entries = this.parseLogFile(logFile);
    const baseline = this.getBaselineTimestamp(entries);
    let previous: Date | undefined;

    const viewEntries: LogEntryViewModel[] = entries.map(entry => {
      const timestampIso = entry.timestamp ? entry.timestamp.toISOString() : undefined;
      const relative = entry.timestamp && baseline
        ? entry.timestamp.getTime() - baseline.getTime()
        : undefined;
      const delta = entry.timestamp && previous
        ? entry.timestamp.getTime() - previous.getTime()
        : undefined;
      if (entry.timestamp) {
        previous = entry.timestamp;
      }

      return {
        index: entry.index,
        badge: entry.badge,
        status: entry.status,
        timestamp: timestampIso,
        relativeToStartMs: relative,
        deltaPreviousMs: delta,
        tokens: entry.tokens,
        payload: entry.payload
      };
    });

    const stats = this.calculateStats(entries);

    const relativePath = this.getRelativePath(logFile);

    return {
      header: {
        title: context.title,
        type: context.type,
        logFile,
        relativePath,
        run: context.run
      },
      entries: viewEntries,
      stats
    };
  }

  private calculateStats(entries: ParsedLogEntry[]): LogStatsViewModel {
    const stats: LogStatsViewModel = {
      totalEntries: entries.length,
      assistantCount: 0,
      userCount: 0,
      systemCount: 0,
      errorCount: 0
    };

    entries.forEach(entry => {
      switch (entry.status) {
        case 'assistant':
          stats.assistantCount += 1;
          break;
        case 'user':
          stats.userCount += 1;
          break;
        case 'system':
          stats.systemCount += 1;
          break;
        case 'error':
          stats.errorCount += 1;
          break;
        default:
          break;
      }
    });

    return stats;
  }

  private getRelativePath(filePath: string): string {
    const relative = path.relative(this.workspaceRoot, filePath);
    return relative.startsWith('..') ? filePath : relative;
  }

  private async openLogFile(logFile: string): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(logFile);
      await vscode.window.showTextDocument(document, { preview: false });
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to open log file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async openSourceFile(sourceFile?: string): Promise<void> {
    if (!sourceFile) {
      vscode.window.showWarningMessage('No source file is associated with this execution.');
      return;
    }

    if (!fs.existsSync(sourceFile)) {
      vscode.window.showWarningMessage('Source file no longer exists on disk.');
      return;
    }

    try {
      const document = await vscode.workspace.openTextDocument(sourceFile);
      await vscode.window.showTextDocument(document, { preview: false });
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to open source file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webviews', 'log.js')
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
    <title>Jarvis Log</title>
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

  private parseLogFile(logFile: string): ParsedLogEntry[] {
    const raw = fs.readFileSync(logFile, 'utf8');
    if (!raw.trim()) {
      return [];
    }

    const lines = raw
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0);

    return lines.map((line, index) => this.parseLine(line, index));
  }

  private parseLine(line: string, index: number): ParsedLogEntry {
    try {
      const message: ClaudeJsonMessage = JSON.parse(line);
      return this.parseMessage(message, index, line);
    } catch (error) {
      return this.parsePlainLine(line, index);
    }
  }

  private parseMessage(message: ClaudeJsonMessage, index: number, raw: string): ParsedLogEntry {
    const timestamp = this.parseTimestamp(message.timestamp);
    const payload = this.extractPayloadSegments(message);
    const tokens = this.extractTokenUsage(message);

    return {
      index,
      badge: this.getBadge(message),
      status: message.type,
      timestamp,
      tokens,
      payload,
      raw
    };
  }

  private parsePlainLine(line: string, index: number): ParsedLogEntry {
    return {
      index,
      badge: '⚙️ System',
      status: 'system',
      timestamp: new Date(),
      payload: [{ text: line }],
      raw: line
    };
  }

  private extractPayloadSegments(message: ClaudeJsonMessage): LogPayloadSegment[] {
    const segments: LogPayloadSegment[] = [];

    const append = (text: string | undefined, isCode = false) => {
      if (text && text.trim().length > 0) {
        segments.push({ text: text.trim(), isCode });
      }
    };

    const formatMcpServers = (servers: {name: string, status: string}[]): string => {
      return servers.map(server => `${server.name} (${server.status})`).join(' | ');
    };

    const formatToolResult = (content: unknown): string => {
      if (content == null) return '';
      let text = String(content);

      // If there is no real newline but there is a literal \n, restore it first
      if (!/\n/.test(text) && /\\n/.test(text)) {
        text = text.replace(/\\n/g, '\n');
      }
      // Unify line breaks (CRLF/CR -> LF)
      text = text.replace(/\r\n?/g, '\n');

      const lines = text.split('\n');

      const cleaned = lines.map((line) =>
        line
          .replace(/^\uFEFF/, '') // Remove BOM
          // Remove the row number prefix with "arrow", avoiding misjudging the markdown ordered list
          .replace(/^\s*\d+→/, '')
      );

      let result = cleaned.join('\n');

      // Fix common escapes
      result = result.replace(/\\"/g, '"').replace(/\\t/g, '\t');

      return result.trim();
    };

    switch (message.type) {
      case 'assistant':
      case 'user': {
        const content = message.message?.content || [];
        content.forEach(item => {
          if (item.type === 'text' && item.text) {
            const trimmed = item.text.trim();
            const looksJson = this.isLikelyJson(trimmed);
            append(looksJson ? this.prettyPrintJson(trimmed) ?? trimmed : trimmed, looksJson);
          } else if (item.type === 'tool_use') {
            append(`Tool call → ${item.name}`);
            const rendered = item.input ? JSON.stringify(item.input, null, 2) : undefined;
            append(rendered, true);
          } else if (item.type === 'tool_result') {
            const rendered = item.content ? formatToolResult(item.content) : undefined;
            this.logger.info('LogViewer', `Tool result: ${rendered}`);
            append('Tool result');
            append(rendered, false);
          }
        });
        break;
      }
      case 'system':
        if (Array.isArray(message.content)) {
          message.content.forEach(entry => {
            if (typeof entry === 'string') {
              append(entry);
            } else if (entry && typeof entry === 'object' && 'text' in entry) {
              append(String((entry as any).text));
            } else {
              append(JSON.stringify(entry, null, 2), true);
            }
          });
        } else if (typeof message.content === 'string') {
          append(message.content);
        }

        if (message.tools) {
          append(`Tools: ${message.tools.length}`);
        }

        if (message.model) {
          append(`Model: ${message.model}`);
        }

        if (message.mcp_servers) {
          append(`MCP Servers: ${formatMcpServers(message.mcp_servers)}`);
        }
        break;
      case 'result':
        if (typeof message.result === 'string') {
          const pretty = this.prettyPrintJson(message.result);
          append(pretty ?? message.result, !!pretty);
        } else if (message.result) {
          append(JSON.stringify(message.result, null, 2), true);
        }
        break;
      case 'error':
        append(message.error);
        break;
      default:
        append(JSON.stringify(message, null, 2), true);
        break;
    }

    return segments.length > 0 ? segments : [{ text: '(no content)' }];
  }

  private extractTokenUsage(message: ClaudeJsonMessage): number | undefined {
    const candidates: Array<number | undefined> = [];

    const usage = (message as any).usage || (message as any).metadata?.tokenUsage || (message as any).metadata?.token_usage;
    if (usage) {
      candidates.push(
        usage.output_tokens,
        usage.total_tokens,
        usage.tokens,
        usage.outputTokens,
        usage.totalTokens
      );
    }

    const first = candidates.find(value => typeof value === 'number');
    return first;
  }

  private getBadge(message: ClaudeJsonMessage): string {
    switch (message.type) {
      case 'assistant':
        return '🤖 Assistant';
      case 'user':
        return '👤 User';
      case 'system':
        return '⚙️ System';
      case 'result':
        return '📦 Result';
      case 'error':
        return '❗ Error';
      default:
        return String(message.type);
    }
  }

  private getBaselineTimestamp(entries: ParsedLogEntry[]): Date | undefined {
    const timestamps = entries
      .map(entry => entry.timestamp)
      .filter((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());

    return timestamps[0];
  }

  private parseTimestamp(raw?: string): Date | undefined {
    if (!raw) {
      return undefined;
    }
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      return undefined;
    }
    return date;
  }

  private isLikelyJson(text: string): boolean {
    if (!text) {
      return false;
    }
    const trimmed = text.trim();
    if (!(trimmed.startsWith('{') && trimmed.endsWith('}')) && !(trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      return false;
    }
    try {
      JSON.parse(trimmed);
      return true;
    } catch (error) {
      return false;
    }
  }

  private prettyPrintJson(text: string): string | undefined {
    try {
      const parsed = JSON.parse(text);
      return JSON.stringify(parsed, null, 2);
    } catch (error) {
      return undefined;
    }
  }

  private getKey(type: LogType, id: string): string {
    return `${type}:${id}`;
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
