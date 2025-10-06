export type HistoryEntryType = 'agent' | 'todo';

export interface HistoryEntryViewModel {
  id: string;
  type: HistoryEntryType;
  targetId: string;
  label: string;
  status: 'running' | 'success' | 'failed' | 'stopped' | 'paused';
  startTime: string;
  endTime?: string;
  durationMs?: number;
  sourceFile?: string;
  logFile?: string;
  versionHash?: string;
  metadata?: Record<string, unknown>;
}

export interface HistorySummaryViewModel {
  total: number;
  running: number;
  success: number;
  failed: number;
  stopped: number;
  paused: number;
  lastRun?: string;
}

export interface HistoryDataPayload {
  title: string;
  filter: { type: HistoryEntryType | 'all'; targetId?: string };
  entries: HistoryEntryViewModel[];
  summary: HistorySummaryViewModel;
}

export type HistoryToWebviewMessage =
  | {
      type: 'historyData';
      payload: HistoryDataPayload;
    }
  | {
      type: 'setLoading';
      payload: boolean;
    }
  | {
      type: 'showError';
      payload: { message: string };
    };

export type HistoryFromWebviewMessage =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'openLog'; payload: { entryId: string } }
  | { type: 'openSource'; payload: { entryId: string } }
  | { type: 'deleteEntry'; payload: { entryId: string } };
