import * as vscode from 'vscode';

export class Logger {
  private static instance: Logger;
  private outputChannel: vscode.OutputChannel;
  private logLevel: string = 'info';

  private constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Jarvis Extension');
    this.outputChannel.show();
    this.loadLogLevel();
    
    // Listen for configuration changes
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('jarvis.logs.level')) {
        this.loadLogLevel();
      }
    });
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private loadLogLevel(): void {
    const config = vscode.workspace.getConfiguration('jarvis.logs');
    this.logLevel = config.get<string>('level', 'info');
  }

  private shouldLog(level: string): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex >= currentLevelIndex;
  }

  private formatMessage(level: string, context: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] [${context}] ${message}`;
  }

  info(context: string, message: string): void {
    if (!this.shouldLog('info')) return;
    const formatted = this.formatMessage('INFO', context, message);
    this.outputChannel.appendLine(formatted);
    console.log(formatted);
  }

  debug(context: string, message: string): void {
    if (!this.shouldLog('debug')) return;
    const formatted = this.formatMessage('DEBUG', context, message);
    this.outputChannel.appendLine(formatted);
    console.log(formatted);
  }

  error(context: string, message: string, error?: any): void {
    if (!this.shouldLog('error')) return;
    const errorDetails = error ? ` - ${error.message || error}` : '';
    const formatted = this.formatMessage('ERROR', context, message + errorDetails);
    this.outputChannel.appendLine(formatted);
    console.error(formatted);
    if (error?.stack) {
      this.outputChannel.appendLine(error.stack);
    }
  }

  warn(context: string, message: string): void {
    if (!this.shouldLog('warn')) return;
    const formatted = this.formatMessage('WARN', context, message);
    this.outputChannel.appendLine(formatted);
    console.warn(formatted);
  }

  setDebugMode(enabled: boolean): void {
    // This method is kept for backward compatibility
    // The actual log level is now controlled by configuration
    const newLevel = enabled ? 'debug' : 'info';
    const config = vscode.workspace.getConfiguration('jarvis.logs');
    config.update('level', newLevel, vscode.ConfigurationTarget.Workspace);
    this.info('Logger', `Log level set to: ${newLevel}`);
  }

  getLogLevel(): string {
    return this.logLevel;
  }

  clear(): void {
    this.outputChannel.clear();
  }

  show(): void {
    this.outputChannel.show();
  }

  dispose(): void {
    this.outputChannel.dispose();
  }
}