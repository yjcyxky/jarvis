import type { HistoryEntryType } from './historyMessages';

export interface LogPayloadSegment {
  text: string;
  isCode?: boolean;
}

export interface LogEntryViewModel {
  index: number;
  badge: string;
  status: string;
  timestamp?: string;
  relativeToStartMs?: number;
  deltaPreviousMs?: number;
  tokens?: number;
  payload: LogPayloadSegment[];
}

export interface LogHeaderViewModel {
  title: string;
  type: HistoryEntryType;
  logFile: string;
  relativePath: string;
  run?: {
    status?: string;
    startTime?: string;
    endTime?: string;
    versionHash?: string;
    sourceFile?: string;
    error?: string;
  };
}

export interface LogStatsViewModel {
  totalEntries: number;
  assistantCount: number;
  userCount: number;
  systemCount: number;
  errorCount: number;
}

export interface LogDataPayload {
  header: LogHeaderViewModel;
  entries: LogEntryViewModel[];
  stats: LogStatsViewModel;
}

export type LogToWebviewMessage =
  | {
      type: 'logData';
      payload: LogDataPayload;
    }
  | {
      type: 'setLoading';
      payload: boolean;
    }
  | {
      type: 'showError';
      payload: { message: string };
    };

export type LogFromWebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'openLogFile' }
  | { type: 'openSource' }
  | { type: 'stopExecution' };
