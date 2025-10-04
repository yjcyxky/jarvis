export interface AgentConfig {
  name: string;
  description: string;
  prompt: string;
  parameters?: Record<string, any>;
  tags?: string[];
  icon?: string;
  sourcePath?: string;
}

export interface AgentStatus {
  name: string;
  state: 'idle' | 'running' | 'error' | 'paused';
  pid?: number;
  startTime?: Date;
  error?: string;
  logFile?: string;
  lastCompleted?: Date;
  historyId?: string;
}

export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  priority?: 'high' | 'medium' | 'low';
  file: string;
  line: number;
  children?: TodoItem[];
  executionStatus?: 'pending' | 'running' | 'success' | 'failed' | 'paused';
  lastExecution?: TodoExecution;
}

export interface TodoExecution {
  id: string;
  todoId: string;
  startTime: Date;
  endTime?: Date;
  status: 'running' | 'success' | 'failed';
  logFile: string;
  error?: string;
  historyId?: string;
}

export interface ClaudeCommandOptions {
  '--dangerously-skip-permissions'?: boolean;
  '--add-dir'?: string[];
  '--verbose'?: boolean;
  '--print'?: boolean;
  '--output-format'?: 'stream-json' | 'text';
  '--model'?: string;
  '--mcp-config'?: string;
}

export interface ClaudeJsonMessage {
  type: 'system' | 'assistant' | 'user' | 'result' | 'error';
  subtype?: string;
  message?: {
    content: Array<{
      type: 'text' | 'tool_use' | 'tool_result';
      text?: string;
      name?: string;
      input?: any;
      content?: any;
    }>;
  };
  content?: any[];
  result?: string;
  error?: string;
  timestamp?: string;
}

export interface JarvisConfig {
  paths: {
    agentDir: string;
    logDir: string;
    todoDir: string;
    todoLogDir: string;
  };
  claude: {
    executable: string;
    defaultParams: {
      'permission-mode': 'auto' | 'always-ask' | 'always-allow';
      'output-format': 'stream-json' | 'text';
      verbose: boolean;
      print: boolean;
      'add-dirs'?: string[];
      model?: string;
      'max-tokens'?: number;
      temperature?: number;
      'mcp-config'?: string;
    };
    requiredMcps: string[];
    environment: {
      checkOnStartup: boolean;
      autoInstallMcp: boolean;
    };
  };
  logs: {
    format: 'jsonl' | 'json' | 'text';
    realtimeFlush: boolean;
    compression: boolean;
    retentionDays: number;
  };
  ui: {
    autoRefresh: boolean;
    refreshInterval: number;
    showNotifications: boolean;
    logRetentionDays: number;
  };
}
