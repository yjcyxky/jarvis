import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Alert,
  Button,
  Card,
  ConfigProvider,
  Empty,
  Flex,
  Space,
  Spin,
  Statistic,
  Tag,
  Timeline,
  Tooltip,
  Typography
} from 'antd';
import {
  ClockCircleOutlined,
  CodeOutlined,
  FileSearchOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import 'antd/dist/reset.css';
import '../shared/theme.css';
import type {
  LogDataPayload,
  LogEntryViewModel,
  LogFromWebviewMessage,
  LogToWebviewMessage
} from '../shared/logMessages';
import { CollapsibleContent } from './ContentRender';

type VsCodeApi = {
  postMessage: (message: LogFromWebviewMessage) => void;
};

declare function acquireVsCodeApi<T = unknown>(): T & VsCodeApi;

const vscode = acquireVsCodeApi();

interface LogState {
  loading: boolean;
  data?: LogDataPayload;
  error?: string;
}

const statusColorMap: Record<string, string> = {
  assistant: 'geekblue',
  user: 'purple',
  system: 'gold',
  result: 'green',
  error: 'red'
};

const timelineColorMap: Record<string, string> = {
  assistant: '#1677ff',
  user: '#722ed1',
  system: '#faad14',
  result: '#52c41a',
  error: '#ff4d4f'
};

function formatDuration(ms?: number): string | undefined {
  if (ms === undefined || ms < 0) {
    return undefined;
  }
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

function formatTimestamp(timestamp?: string): string {
  if (!timestamp) {
    return '-';
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date);
}

const LogEntryCard: React.FC<{ entry: LogEntryViewModel }> = ({ entry }) => {
  const relative = formatDuration(entry.relativeToStartMs);
  const delta = formatDuration(entry.deltaPreviousMs);
  const color = statusColorMap[entry.status] ?? 'default';

  return (
    <Card size="small" style={{ background: 'var(--vscode-editorWidget-background)', width: '100%' }}>
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Space wrap align="baseline" style={{ justifyContent: 'space-between', width: '100%' }}>
          <Space wrap>
            <Tag color={color}>{entry.badge}</Tag>
            <Typography.Text type="secondary">{entry.status}</Typography.Text>
          </Space>
          <Space wrap>
            <Typography.Text type="secondary">
              <ClockCircleOutlined style={{ marginRight: 4 }} />
              {formatTimestamp(entry.timestamp)}
            </Typography.Text>
            {relative && (
              <Tag color="blue">T+{relative}</Tag>
            )}
            {delta && (
              <Tag color="gold">Δ{delta}</Tag>
            )}
            {typeof entry.tokens === 'number' && (
              <Tag color="purple">Tokens: {entry.tokens}</Tag>
            )}
          </Space>
        </Space>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {entry.payload.map((segment, index) => (
            <CollapsibleContent
              key={index}
              text={segment.text}
              isCode={segment.isCode}
              maxLength={500}
            />
          ))}
        </Space>
      </Space>
    </Card>
  );
};

const LogApp: React.FC = () => {
  const [state, setState] = useState<LogState>({ loading: true });

  useEffect(() => {
    const handleMessage = (event: MessageEvent<LogToWebviewMessage>) => {
      const message = event.data;
      switch (message.type) {
        case 'logData':
          setState({ loading: false, data: message.payload, error: undefined });
          break;
        case 'setLoading':
          setState(prev => ({ ...prev, loading: message.payload }));
          break;
        case 'showError':
          setState(prev => ({ ...prev, loading: false, error: message.payload.message }));
          break;
        default:
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    vscode.postMessage({ type: 'ready' });

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  const statsItems = useMemo(() => {
    const stats = state.data?.stats;
    if (!stats) {
      return null;
    }

    return (
      <Flex gap={16} wrap>
        <Card style={{ minWidth: 160 }}>
          <Statistic title="Total Entries" value={stats.totalEntries} valueStyle={{ color: 'var(--vscode-foreground)' }} />
        </Card>
        <Card style={{ minWidth: 160 }}>
          <Statistic title="Assistant" value={stats.assistantCount} valueStyle={{ color: 'var(--vscode-foreground)' }} />
        </Card>
        <Card style={{ minWidth: 160 }}>
          <Statistic title="User" value={stats.userCount} valueStyle={{ color: 'var(--vscode-foreground)' }} />
        </Card>
        <Card style={{ minWidth: 160 }}>
          <Statistic title="System" value={stats.systemCount} valueStyle={{ color: 'var(--vscode-foreground)' }} />
        </Card>
        <Card style={{ minWidth: 160 }}>
          <Statistic title="Errors" value={stats.errorCount} valueStyle={{ color: 'var(--vscode-foreground)' }} />
        </Card>
      </Flex>
    );
  }, [state.data?.stats]);

  const headerContent = state.data?.header;

  return (
    <ConfigProvider
      theme={{
        token: {
          colorBgBase: 'var(--vscode-editor-background)',
          colorBgContainer: 'var(--vscode-editorWidget-background)',
          colorTextBase: 'var(--vscode-foreground)',
          colorText: 'var(--vscode-foreground)',
          colorTextSecondary: 'var(--vscode-descriptionForeground)',
          colorBorder: 'var(--vscode-editorWidget-border)',
          colorPrimary: 'var(--vscode-focusBorder)',
          colorPrimaryHover: 'var(--vscode-focusBorder)',
          colorPrimaryActive: 'var(--vscode-focusBorder)'
        }
      }}
    >
      <Space
        direction="vertical"
        style={{ padding: 16, width: '100%', boxSizing: 'border-box' }}
        size={16}
      >
        <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {headerContent?.title ?? 'Execution Log'}
            </Typography.Title>
            {headerContent && (
              <Typography.Text type="secondary">
                {headerContent.relativePath}
              </Typography.Text>
            )}
          </div>
          <Space>
            <Tooltip title="Reload log">
              <Button icon={<ReloadOutlined />} onClick={() => vscode.postMessage({ type: 'refresh' })}>
                Refresh
              </Button>
            </Tooltip>
            <Tooltip title="Open raw log file">
              <Button icon={<FileSearchOutlined />} onClick={() => vscode.postMessage({ type: 'openLogFile' })}>
                Raw Log
              </Button>
            </Tooltip>
            <Tooltip title={headerContent?.run?.sourceFile ? 'Open source file' : 'No source file'}>
              <Button
                icon={<CodeOutlined />}
                disabled={!headerContent?.run?.sourceFile}
                onClick={() => vscode.postMessage({ type: 'openSource' })}
              >
                Source
              </Button>
            </Tooltip>
          </Space>
        </Space>

        {headerContent && (
          <Card>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Space wrap>
                {headerContent.run?.status && (
                  <Tag color="blue">Status: {headerContent.run.status}</Tag>
                )}
                {headerContent.run?.versionHash && (
                  <Tag color="purple">{headerContent.run.versionHash.slice(0, 10)}</Tag>
                )}
                {headerContent.run?.startTime && headerContent.run?.endTime && (
                  <Tag color="gold">
                    Duration:{' '}
                    {formatDuration(
                      new Date(headerContent.run.endTime).getTime() -
                        new Date(headerContent.run.startTime).getTime()
                    )}
                  </Tag>
                )}
              </Space>
              <Space wrap>
                {headerContent.run?.startTime && (
                  <Typography.Text type="secondary">
                    Started: {formatTimestamp(headerContent.run.startTime)}
                  </Typography.Text>
                )}
                {headerContent.run?.endTime && (
                  <Typography.Text type="secondary">
                    Ended: {formatTimestamp(headerContent.run.endTime)}
                  </Typography.Text>
                )}
                {headerContent.run?.sourceFile && (
                  <Typography.Text type="secondary">
                    Source: {headerContent.run.sourceFile.split(/[\\/]/).slice(-1)[0]}
                  </Typography.Text>
                )}
              </Space>
            </Space>
          </Card>
        )}

        {state.error && <Alert type="error" message={state.error} showIcon />}

        <Spin spinning={state.loading} tip="Reading log…">
          {state.data && state.data.entries.length > 0 ? (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              {statsItems}
              <Timeline
                mode="left"
                style={{ width: '100%' }}
                items={state.data.entries.map(entry => ({
                  color: timelineColorMap[entry.status] ?? '#1677ff',
                  children: (
                    <div className="jarvis-timeline-row">
                      <div className="jarvis-timeline-time">{formatTimestamp(entry.timestamp)}</div>
                      <div className="jarvis-timeline-content">
                        <LogEntryCard entry={entry} />
                      </div>
                    </div>
                  )
                }))}
              />
            </Space>
          ) : state.loading ? null : (
            <Card>
              <Empty description="Waiting for log output…" />
            </Card>
          )}
        </Spin>
      </Space>
    </ConfigProvider>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<LogApp />);
}
