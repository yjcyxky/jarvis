import * as vscode from 'vscode';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { ClaudeCommandOptions, ClaudeJsonMessage } from '../types';

export class ClaudeCodeExecutor {
  private processes: Map<string, child_process.ChildProcess> = new Map();
  private outputChannel: vscode.OutputChannel;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Jarvis - Claude');
  }

  private buildCommand(options?: Partial<ClaudeCommandOptions>): string[] {
    const config = vscode.workspace.getConfiguration('jarvis.claude');
    const executable = config.get<string>('executable', 'claude');
    const defaultParams = config.get<any>('defaultParams', {});

    const command = [executable];

    // Add permission mode
    if (options?.['--dangerously-skip-permissions'] || defaultParams['permission-mode'] === 'always-allow') {
      command.push('--dangerously-skip-permissions');
    }

    // Add directories
    const dirs = options?.['--add-dir'] || defaultParams['add-dirs'] || [];
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot && !dirs.includes(workspaceRoot)) {
      dirs.push(workspaceRoot);
    }
    dirs.forEach((dir: string) => {
      command.push('--add-dir', dir);
    });

    // Add other parameters
    if (options?.['--verbose'] ?? defaultParams.verbose) {
      command.push('--verbose');
    }

    if (options?.['--print'] ?? defaultParams.print) {
      command.push('--print');
    }

    const outputFormat = options?.['--output-format'] || defaultParams['output-format'] || 'stream-json';
    command.push('--output-format', outputFormat);

    if (options?.['--model'] || defaultParams.model) {
      command.push('--model', options?.['--model'] || defaultParams.model);
    }

    if (options?.['--mcp-config'] || defaultParams['mcp-config']) {
      command.push('--mcp-config', options?.['--mcp-config'] || defaultParams['mcp-config']);
    }

    return command;
  }

  private createLogStream(logFile: string): fs.WriteStream {
    const dir = path.dirname(logFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return fs.createWriteStream(logFile, { flags: 'a' });
  }

  async execute(
    id: string,
    prompt: string,
    options?: Partial<ClaudeCommandOptions>,
    logFile?: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const command = this.buildCommand(options);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const actualLogFile = logFile || path.join(
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
        '.jarvis/todo-logs',
        `${timestamp}_${id}.jsonl`
      );

      const logStream = this.createLogStream(actualLogFile);

      this.outputChannel.appendLine(`Starting Claude Code execution for: ${id}`);
      this.outputChannel.appendLine(`Command: ${command.join(' ')}`);
      this.outputChannel.appendLine(`Log file: ${actualLogFile}`);

      const stderrChunks: string[] = [];
      const recentMessages: string[] = [];
      let lastErrorMessage: string | undefined;

      const recordRecentMessage = (message: string | undefined) => {
        if (!message) {
          return;
        }
        const trimmed = message.trim();
        if (!trimmed) {
          return;
        }
        recentMessages.push(trimmed);
        if (recentMessages.length > 10) {
          recentMessages.shift();
        }
      };

      const childProc = child_process.spawn(command[0], command.slice(1), {
        cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        env: { ...process.env }
      });

      this.processes.set(id, childProc);

      if (!childProc.stdin) {
        const error = new Error('Claude process stdin is not available.');
        this.outputChannel.appendLine(`ERROR: ${error.message}`);
        logStream.write(
          JSON.stringify({
            type: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
          }) + '\n'
        );
        childProc.kill('SIGTERM');
        this.processes.delete(id);
        logStream.end();
        reject(error);
        return;
      }

      childProc.stdin.setDefaultEncoding('utf8');
      childProc.stdin.write(prompt, 'utf8', (writeError: Error | null | undefined) => {
        if (writeError) {
          const message = `Failed to write prompt to Claude stdin: ${writeError.message}`;
          this.outputChannel.appendLine(`ERROR: ${message}`);
          const errorJson: ClaudeJsonMessage = {
            type: 'error',
            error: message,
            timestamp: new Date().toISOString()
          };
          logStream.write(JSON.stringify(errorJson) + '\n');
          recordRecentMessage(message);
          childProc.kill('SIGTERM');
          this.processes.delete(id);
          reject(new Error(message));
        }
      });
      childProc.stdin.end();

      // Handle stdout with readline for JSON parsing
      const rl = readline.createInterface({
        input: childProc.stdout,
        crlfDelay: Infinity
      });

      rl.on('line', (line) => {
        try {
          // Try to parse as JSON
          const message: ClaudeJsonMessage = JSON.parse(line);
          message.timestamp = new Date().toISOString();

          // Write to log file
          logStream.write(JSON.stringify(message) + '\n');

          // Display in output channel
          this.formatAndDisplayMessage(message);

          // Record message details for improved error reporting
          if (message.type === 'error') {
            recordRecentMessage(message.error);
            lastErrorMessage = message.error || lastErrorMessage;
          } else if (message.type === 'assistant' && message.message?.content) {
            message.message.content.forEach(item => {
              if (item.type === 'text' && item.text) {
                recordRecentMessage(item.text);
              }
            });
          } else if (message.type === 'system' && message.content) {
            message.content.forEach(item => {
              if (typeof item === 'object' && 'text' in item && typeof item.text === 'string') {
                recordRecentMessage(item.text);
              }
            });
          }

          // Handle specific message types
          this.handleMessage(id, message);
        } catch (error) {
          // If not JSON, treat as plain text
          const textMessage: ClaudeJsonMessage = {
            type: 'system',
            content: [{ type: 'text', text: line }],
            timestamp: new Date().toISOString()
          };
          logStream.write(JSON.stringify(textMessage) + '\n');
          this.outputChannel.appendLine(line);
          recordRecentMessage(line);
        }
      });

      // Handle stderr
      childProc.stderr.on('data', (data: Buffer) => {
        const errorMessage: ClaudeJsonMessage = {
          type: 'error',
          error: data.toString(),
          timestamp: new Date().toISOString()
        };
        logStream.write(JSON.stringify(errorMessage) + '\n');
        this.outputChannel.appendLine(`ERROR: ${data}`);
        const stderrText = data.toString();
        stderrChunks.push(stderrText);
        stderrText.split(/\r?\n/).forEach(chunk => recordRecentMessage(chunk));
      });

      // Handle process exit
      childProc.on('exit', (code: number | null) => {
        this.processes.delete(id);
        logStream.end();

        if (code === 0) {
          this.outputChannel.appendLine(`Claude Code execution completed successfully for: ${id}`);
          resolve();
        } else {
          const details: string[] = [];
          details.push(`Claude Code execution failed with code ${code ?? 'unknown'} for: ${id}`);

          if (lastErrorMessage?.trim()) {
            details.push(`Claude reported: ${lastErrorMessage.trim()}`);
          }

          const stderrText = stderrChunks.join('').trim();
          if (stderrText) {
            details.push(`stderr: ${stderrText}`);
          }

          if (!lastErrorMessage && !stderrText && recentMessages.length > 0) {
            const recentSample = recentMessages.slice(-3).join(' | ');
            details.push(`Recent output: ${recentSample}`);
          }

          details.push(`Log file: ${actualLogFile}`);

          const errorMessage = details.join('\n');
          this.outputChannel.appendLine(errorMessage);
          reject(new Error(errorMessage));
        }
      });

      childProc.on('error', (error: Error) => {
        this.processes.delete(id);
        logStream.end();
        this.outputChannel.appendLine(`ERROR: ${error.message}`);
        reject(error);
      });
    });
  }

  private formatAndDisplayMessage(message: ClaudeJsonMessage): void {
    switch (message.type) {
      case 'assistant':
        if (message.message?.content) {
          message.message.content.forEach(item => {
            if (item.type === 'text' && item.text) {
              this.outputChannel.appendLine(`Assistant: ${item.text}`);
            } else if (item.type === 'tool_use') {
              this.outputChannel.appendLine(`Tool Use: ${item.name} - ${JSON.stringify(item.input)}`);
            }
          });
        }
        break;

      case 'result':
        this.outputChannel.appendLine(`Result: ${message.result}`);
        break;

      case 'error':
        this.outputChannel.appendLine(`Error: ${message.error}`);
        break;

      case 'system':
        if (message.content) {
          message.content.forEach(item => {
            if (typeof item === 'object' && 'text' in item) {
              this.outputChannel.appendLine(`System: ${item.text}`);
            }
          });
        }
        break;
    }
  }

  private handleMessage(id: string, message: ClaudeJsonMessage): void {
    // Emit events or update status based on message type
    // This can be extended to provide real-time updates to the UI
    if (message.type === 'error') {
      vscode.window.showErrorMessage(`Claude execution error for ${id}: ${message.error}`);
    }
  }

  async stop(id: string): Promise<void> {
    const process = this.processes.get(id);
    if (process) {
      process.kill('SIGTERM');
      this.processes.delete(id);
      this.outputChannel.appendLine(`Stopped Claude Code execution for: ${id}`);
    }
  }

  async stopAll(): Promise<void> {
    for (const [id, process] of this.processes.entries()) {
      process.kill('SIGTERM');
      this.outputChannel.appendLine(`Stopped Claude Code execution for: ${id}`);
    }
    this.processes.clear();
  }

  isRunning(id: string): boolean {
    return this.processes.has(id);
  }

  getRunningProcesses(): string[] {
    return Array.from(this.processes.keys());
  }

  dispose(): void {
    this.stopAll();
    this.outputChannel.dispose();
  }
}
