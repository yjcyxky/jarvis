import * as vscode from 'vscode';

export class Logger {
  private static instance: Logger;
  private outputChannel: vscode.OutputChannel;
  private isDebugMode: boolean = true;

  private constructor() {
    this.outputChannel = vscode.window.createOutputChannel('Jarvis Extension');
    this.outputChannel.show();
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private formatMessage(level: string, context: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] [${context}] ${message}`;
  }

  info(context: string, message: string): void {
    const formatted = this.formatMessage('INFO', context, message);
    this.outputChannel.appendLine(formatted);
    console.log(formatted);
  }

  debug(context: string, message: string): void {
    if (!this.isDebugMode) return;
    const formatted = this.formatMessage('DEBUG', context, message);
    this.outputChannel.appendLine(formatted);
    console.log(formatted);
  }

  error(context: string, message: string, error?: any): void {
    const errorDetails = error ? ` - ${error.message || error}` : '';
    const formatted = this.formatMessage('ERROR', context, message + errorDetails);
    this.outputChannel.appendLine(formatted);
    console.error(formatted);
    if (error?.stack) {
      this.outputChannel.appendLine(error.stack);
    }
  }

  warn(context: string, message: string): void {
    const formatted = this.formatMessage('WARN', context, message);
    this.outputChannel.appendLine(formatted);
    console.warn(formatted);
  }

  setDebugMode(enabled: boolean): void {
    this.isDebugMode = enabled;
    this.info('Logger', `Debug mode ${enabled ? 'enabled' : 'disabled'}`);
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