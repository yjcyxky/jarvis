import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export type ExecutionTargetType = 'agent' | 'todo';

export interface ExecutionHistoryEntry {
  id: string;
  type: ExecutionTargetType;
  targetId: string;
  label: string;
  sourceFile?: string;
  logFile: string;
  versionHash?: string;
  status: 'running' | 'success' | 'failed' | 'stopped' | 'paused';
  startTime: string;
  endTime?: string;
  metadata?: Record<string, any>;
}

export interface ExecutionStartOptions {
  type: ExecutionTargetType;
  targetId: string;
  label: string;
  sourceFile?: string;
  logFile: string;
  versionHash?: string;
  metadata?: Record<string, any>;
}

export interface ExecutionCompletionOptions {
  status: 'success' | 'failed' | 'stopped' | 'paused';
  metadata?: Record<string, any>;
  endTime?: string;
}

export class HistoryStore {
  private readonly historyDir: string;
  private readonly historyFile: string;
  private records: ExecutionHistoryEntry[] = [];
  private isDirty = false;

  constructor(workspaceRoot: string, relativePath = '.jarvis/history.json') {
    this.historyDir = path.join(workspaceRoot, path.dirname(relativePath));
    this.historyFile = path.join(workspaceRoot, relativePath);
    this.load();
  }

  beginExecution(options: ExecutionStartOptions): ExecutionHistoryEntry {
    const record: ExecutionHistoryEntry = {
      id: this.generateId(options.type),
      type: options.type,
      targetId: options.targetId,
      label: options.label,
      sourceFile: options.sourceFile,
      logFile: options.logFile,
      versionHash: options.versionHash,
      status: 'running',
      startTime: new Date().toISOString(),
      metadata: options.metadata ? { ...options.metadata } : undefined
    };

    this.records.push(record);
    this.save();
    return record;
  }

  completeExecution(id: string, options: ExecutionCompletionOptions): ExecutionHistoryEntry | undefined {
    const record = this.records.find(entry => entry.id === id);
    if (!record) {
      return undefined;
    }

    record.status = options.status;
    record.endTime = options.endTime ?? new Date().toISOString();
    if (options.metadata) {
      record.metadata = { ...(record.metadata || {}), ...options.metadata };
    }

    this.save();
    return record;
  }

  updateMetadata(id: string, metadata: Record<string, any>): ExecutionHistoryEntry | undefined {
    const record = this.records.find(entry => entry.id === id);
    if (!record) {
      return undefined;
    }

    record.metadata = { ...(record.metadata || {}), ...metadata };
    this.save();
    return record;
  }

  getHistory(type: ExecutionTargetType, targetId: string, limit?: number): ExecutionHistoryEntry[] {
    const filtered = this.records
      .filter(record => record.type === type && record.targetId === targetId)
      .sort((a, b) => {
        const aTime = new Date(a.startTime).getTime();
        const bTime = new Date(b.startTime).getTime();
        return bTime - aTime;
      });

    return typeof limit === 'number' ? filtered.slice(0, limit) : filtered;
  }

  getAll(): ExecutionHistoryEntry[] {
    return [...this.records];
  }

  /**
   * 清理无效的历史记录（对应的日志文件不存在）
   */
  cleanupInvalidRecords(): number {
    const initialCount = this.records.length;
    this.records = this.records.filter(record => {
      try {
        return fs.existsSync(record.logFile);
      } catch (error) {
        console.warn(`Failed to check log file existence: ${record.logFile}`, error);
        return false;
      }
    });
    
    const removedCount = initialCount - this.records.length;
    if (removedCount > 0) {
      this.save();
    }
    
    return removedCount;
  }

  /**
   * 根据日志文件路径删除历史记录
   */
  removeByLogFile(logFile: string): boolean {
    const initialLength = this.records.length;
    this.records = this.records.filter(record => record.logFile !== logFile);
    
    const removed = this.records.length < initialLength;
    if (removed) {
      this.save();
    }
    
    return removed;
  }

  dispose(): void {
    if (this.isDirty) {
      this.save();
    }
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.historyDir)) {
        fs.mkdirSync(this.historyDir, { recursive: true });
      }

      if (!fs.existsSync(this.historyFile)) {
        fs.writeFileSync(this.historyFile, JSON.stringify([], null, 2), 'utf8');
        this.records = [];
        return;
      }

      const content = fs.readFileSync(this.historyFile, 'utf8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        this.records = parsed;
      } else {
        this.records = [];
      }
    } catch (error) {
      console.error('Failed to load history file', error);
      this.records = [];
    }
  }

  private save(): void {
    try {
      if (!fs.existsSync(this.historyDir)) {
        fs.mkdirSync(this.historyDir, { recursive: true });
      }
      fs.writeFileSync(this.historyFile, JSON.stringify(this.records, null, 2), 'utf8');
      this.isDirty = false;
    } catch (error) {
      console.error('Failed to write history file', error);
      this.isDirty = true;
    }
  }

  private generateId(type: ExecutionTargetType): string {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    const random = crypto.randomBytes(8).toString('hex');
    return `${type}-${Date.now().toString(36)}-${random}`;
  }
}
