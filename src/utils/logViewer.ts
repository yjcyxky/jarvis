import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ClaudeJsonMessage } from '../types';

type LogType = 'todo' | 'agent';

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

interface StoredLogContext {
  context: LogContext;
  uri: vscode.Uri;
}

interface PayloadSegment {
  text: string;
  isCode?: boolean;
}

interface ParsedLogEntry {
  index: number;
  badge: string;
  status: string;
  timestamp?: Date;
  tokens?: number;
  payload: PayloadSegment[];
  raw: string;
}

export class LogViewer implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private static readonly scheme = 'jarvis-log';

  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  private readonly logs = new Map<string, StoredLogContext>();
  private readonly watchers = new Map<string, fs.FSWatcher>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly workspaceRoot: string) {
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(LogViewer.scheme, this)
    );

    this.disposables.push(
      vscode.workspace.onDidCloseTextDocument(document => {
        if (document.uri.scheme === LogViewer.scheme) {
          const key = this.getKeyFromUri(document.uri);
          this.disposeWatcher(key);
        }
      })
    );
  }

  async openLog(context: LogContext): Promise<void> {
    const key = this.getKey(context.type, context.id);
    const existing = this.logs.get(key);
    const uri = existing?.uri ?? this.createUri(context, key);

    const storedContext = { ...context };
    this.logs.set(key, { context: storedContext, uri });
    this.ensureWatcher(key, uri, storedContext.logFile);
    this.onDidChangeEmitter.fire(uri);

    try {
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, {
        preview: false,
        viewColumn: vscode.ViewColumn.Beside
      });
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to open log view: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  updateRunContext(type: LogType, id: string, updates: LogContext['run']): void {
    const key = this.getKey(type, id);
    const stored = this.logs.get(key);
    if (!stored) {
      return;
    }

    stored.context.run = {
      ...(stored.context.run || {}),
      ...updates
    };

    this.logs.set(key, stored);
    this.onDidChangeEmitter.fire(stored.uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const key = this.getKeyFromUri(uri);
    const entry = this.logs.get(key);

    if (!entry) {
      return 'Log context is no longer available.';
    }

    const { context } = entry;
    const relativePath = path.relative(this.workspaceRoot, context.logFile);
    const headerTitle = `${context.type === 'todo' ? 'TODO' : 'Agent'} — ${context.title}`;
    const headerUnderline = '─'.repeat(Math.max(headerTitle.length, 12));

    const headerLines: string[] = [
      'Jarvis Log Viewer',
      headerTitle,
      `Log file: ${relativePath.startsWith('..') ? context.logFile : relativePath}`
    ];

    if (context.run) {
      if (context.run.status) {
        headerLines.push(`Status: ${context.run.status}`);
      }
      if (context.run.startTime) {
        const start = new Date(context.run.startTime);
        headerLines.push(`Started: ${isNaN(start.getTime()) ? context.run.startTime : start.toLocaleString()}`);
      }
      if (context.run.endTime) {
        const end = new Date(context.run.endTime);
        headerLines.push(`Ended: ${isNaN(end.getTime()) ? context.run.endTime : end.toLocaleString()}`);
      }
      if (context.run.versionHash) {
        headerLines.push(`Version: ${context.run.versionHash}`);
      }
      if (context.run.sourceFile) {
        const sourceRelative = path.relative(this.workspaceRoot, context.run.sourceFile);
        headerLines.push(`Source: ${sourceRelative.startsWith('..') ? context.run.sourceFile : sourceRelative}`);
      }
    }

    headerLines.push(headerUnderline);
    const header = headerLines.join('\n');

    try {
      if (!fs.existsSync(context.logFile)) {
        return `${header}\nWaiting for log output…`;
      }

      const raw = fs.readFileSync(context.logFile, 'utf8');
      if (!raw.trim()) {
        return `${header}\nWaiting for log output…`;
      }

      const lines = raw
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0);

      if (lines.length === 0) {
        return `${header}\nWaiting for log output…`;
      }

      const entries = lines.map((line, index) => this.parseLine(line, index));
      const baseline = this.getBaselineTimestamp(entries);
      const formatted: string[] = [];
      let previous: Date | undefined;

      for (const entry of entries) {
        formatted.push(this.renderCard(entry, baseline, previous));
        if (entry.timestamp) {
          previous = entry.timestamp;
        }
      }

      return `${header}\n\n${formatted.join('\n\n')}`;
    } catch (error) {
      return `${header}\nError reading log file: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  dispose(): void {
    this.watchers.forEach(watcher => watcher.close());
    this.watchers.clear();
    this.logs.clear();
    this.disposables.forEach(d => d.dispose());
    this.onDidChangeEmitter.dispose();
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

  private extractPayloadSegments(message: ClaudeJsonMessage): PayloadSegment[] {
    const segments: PayloadSegment[] = [];

    const append = (text: string | undefined, isCode = false) => {
      if (text && text.trim().length > 0) {
        segments.push({ text: text.trim(), isCode });
      }
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
            const rendered = item.content ? JSON.stringify(item.content, null, 2) : undefined;
            append(`Tool result`, false);
            append(rendered, true);
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
              append(String(entry.text));
            } else {
              append(JSON.stringify(entry, null, 2), true);
            }
          });
        } else if (typeof message.content === 'string') {
          append(message.content);
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
        return message.type;
    }
  }

  private getBaselineTimestamp(entries: ParsedLogEntry[]): Date | undefined {
    const timestamps = entries
      .map(entry => entry.timestamp)
      .filter((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());

    return timestamps[0];
  }

  private renderCard(entry: ParsedLogEntry, baseline?: Date, previous?: Date): string {
    const lines: string[] = [];
    lines.push(`╭─ ${entry.badge}`);

    const metaParts: string[] = [];
    const timestampText = entry.timestamp
      ? entry.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : `Line ${entry.index + 1}`;
    metaParts.push(`Time: ${timestampText}`);

    if (entry.timestamp && baseline) {
      const delta = this.formatDuration(entry.timestamp.getTime() - baseline.getTime());
      if (delta) {
        metaParts.push(`T+${delta}`);
      }
    }

    if (entry.timestamp && previous && previous !== entry.timestamp) {
      const step = this.formatDuration(entry.timestamp.getTime() - previous.getTime());
      if (step) {
        metaParts.push(`Δ${step}`);
      }
    }

    if (entry.tokens !== undefined) {
      metaParts.push(`Tokens: ${entry.tokens}`);
    }

    metaParts.push(`Status: ${entry.status}`);

    lines.push(`│ ${metaParts.join(' • ')}`);
    lines.push('├────────────────────────────────────────────────────');

    entry.payload.forEach((segment, segmentIndex) => {
      if (segmentIndex > 0) {
        lines.push('│');
      }
      const rendered = segment.isCode ? this.renderCodeBlock(segment.text) : this.renderTextBlock(segment.text);
      rendered.forEach(line => lines.push(`│ ${line}`));
    });

    lines.push('╰────────────────────────────────────────────────────');
    return lines.join('\n');
  }

  private renderTextBlock(text: string): string[] {
    return text.split(/\r?\n/);
  }

  private renderCodeBlock(text: string): string[] {
    const lines = text.split(/\r?\n/);
    return ['```json', ...lines, '```'];
  }

  private formatDuration(milliseconds: number): string | undefined {
    if (!Number.isFinite(milliseconds)) {
      return undefined;
    }
    const ms = Math.max(0, milliseconds);
    const secondsTotal = Math.floor(ms / 1000);
    const seconds = secondsTotal % 60;
    const minutes = Math.floor(secondsTotal / 60) % 60;
    const hours = Math.floor(secondsTotal / 3600);

    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
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

  private ensureWatcher(key: string, uri: vscode.Uri, logFile: string): void {
    this.disposeWatcher(key);

    const directory = path.dirname(logFile);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }

    // Create the log file if it doesn't exist
    if (!fs.existsSync(logFile)) {
      fs.writeFileSync(logFile, '', 'utf8');
    }

    try {
      // Watch the specific log file for changes
      const watcher = fs.watch(logFile, { persistent: true }, (eventType) => {
        // Trigger update on any change to the file
        if (eventType === 'change') {
          // Small debounce to avoid multiple rapid updates
          setTimeout(() => {
            this.onDidChangeEmitter.fire(uri);
          }, 100);
        }
      });

      this.watchers.set(key, watcher);

      // Also set up an interval to check for updates in case file watching fails
      const intervalId = setInterval(() => {
        if (fs.existsSync(logFile)) {
          this.onDidChangeEmitter.fire(uri);
        }
      }, 500);

      // Store the interval ID so we can clear it later
      (watcher as any).__intervalId = intervalId;
    } catch (error) {
      console.error('Failed to watch log file', error);

      // Fallback to polling if watching fails
      const intervalId = setInterval(() => {
        if (fs.existsSync(logFile)) {
          this.onDidChangeEmitter.fire(uri);
        }
      }, 500);

      // Create a dummy watcher object to store the interval
      const dummyWatcher = {
        close: () => clearInterval(intervalId),
        __intervalId: intervalId
      } as any;

      this.watchers.set(key, dummyWatcher);
    }
  }

  private disposeWatcher(key: string): void {
    const watcher = this.watchers.get(key);
    if (watcher) {
      // Clear any associated interval timer
      if ((watcher as any).__intervalId) {
        clearInterval((watcher as any).__intervalId);
      }
      watcher.close();
      this.watchers.delete(key);
    }
  }

  private createUri(context: LogContext, key: string): vscode.Uri {
    const slug = this.slugify(`${context.type}-${context.title || context.id}`);
    return vscode.Uri.from({
      scheme: LogViewer.scheme,
      authority: context.type,
      path: `/${slug || key}.log`,
      query: encodeURIComponent(key)
    });
  }

  private getKey(type: LogType, id: string): string {
    return `${type}:${id}`;
  }

  private getKeyFromUri(uri: vscode.Uri): string {
    if (uri.query) {
      try {
        return decodeURIComponent(uri.query);
      } catch (error) {
        // Fall through to rebuild
      }
    }

    const idFromPath = uri.path.split('/').filter(Boolean).shift() || '';
    const decodedId = decodeURIComponent(idFromPath);
    return this.getKey(uri.authority as LogType, decodedId);
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);
  }
}
