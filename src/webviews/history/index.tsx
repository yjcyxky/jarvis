import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  Table,
  Tag,
  Tooltip,
  Typography
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ClockCircleOutlined,
  FileTextOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  DeleteOutlined
} from '@ant-design/icons';
import 'antd/dist/reset.css';
import '../shared/theme.css';
import type {
  HistoryDataPayload,
  HistoryEntryViewModel,
  HistoryFromWebviewMessage,
  HistoryToWebviewMessage
} from '../shared/historyMessages';

type VsCodeApi = {
  postMessage: (message: HistoryFromWebviewMessage) => void;
};

declare function acquireVsCodeApi<T = unknown>(): T & VsCodeApi;

const vscode = acquireVsCodeApi();

interface HistoryState {
  loading: boolean;
  data?: HistoryDataPayload;
  error?: string;
}

const statusColorMap: Record<HistoryEntryViewModel['status'], string> = {
  success: 'green',
  failed: 'red',
  running: 'blue',
  stopped: 'orange',
  paused: 'gold'
};

const statusLabelMap: Record<HistoryEntryViewModel['status'], string> = {
  success: 'Success',
  failed: 'Failed',
  running: 'Running',
  stopped: 'Stopped',
  paused: 'Paused'
};

const typeLabelMap: Record<HistoryEntryViewModel['type'], { label: string; color: string }> = {
  agent: { label: 'Agent', color: 'geekblue' },
  todo: { label: 'TODO', color: 'purple' }
};

function formatDate(value?: string): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date);
}

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) {
    return '-';
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

const HistoryApp: React.FC = () => {
  const [state, setState] = useState<HistoryState>({ loading: true });
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const handleMessage = (event: MessageEvent<HistoryToWebviewMessage>) => {
      const message = event.data;
      switch (message.type) {
        case 'historyData':
          setState({ loading: false, data: message.payload, error: undefined });
          setDeletingIds(prev => {
            const activeIds = new Set(message.payload.entries.map(entry => entry.id));
            const next = new Set<string>();
            prev.forEach(id => {
              if (activeIds.has(id)) {
                next.add(id);
              }
            });
            return next;
          });
          break;
        case 'setLoading':
          setState(prev => ({ ...prev, loading: message.payload }));
          break;
        case 'showError':
          setState(prev => ({ ...prev, loading: false, error: message.payload.message }));
          setDeletingIds(new Set());
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

  const handleDelete = useCallback((entryId: string) => {
    setDeletingIds(prev => {
      const next = new Set(prev);
      next.add(entryId);
      return next;
    });
    vscode.postMessage({ type: 'deleteEntry', payload: { entryId } });
  }, []);

  const columns: ColumnsType<HistoryEntryViewModel> = useMemo(() => [
    {
      title: 'Type',
      key: 'type',
      width: 110,
      render: (_, record) => {
        const meta = typeLabelMap[record.type];
        return <Tag color={meta.color}>{meta.label}</Tag>;
      }
    },
    {
      title: 'Name',
      dataIndex: 'label',
      key: 'label',
      ellipsis: true
    },
    {
      title: 'Status',
      key: 'status',
      width: 120,
      render: (_, record) => (
        <Tag color={statusColorMap[record.status] || 'default'}>
          {statusLabelMap[record.status] || record.status}
        </Tag>
      )
    },
    {
      title: 'Started',
      dataIndex: 'startTime',
      key: 'startTime',
      width: 200,
      render: (value: string) => formatDate(value)
    },
    {
      title: 'Duration',
      dataIndex: 'durationMs',
      key: 'duration',
      width: 140,
      render: (value: number | undefined) => formatDuration(value)
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 240,
      render: (_, record) => (
        <Space>
          <Button
            size="small"
            icon={<FileTextOutlined />}
            onClick={() => vscode.postMessage({ type: 'openLog', payload: { entryId: record.id } })}
          >
            Log
          </Button>
          <Tooltip title={record.sourceFile ? 'Open source file' : 'No source file'}>
            <Button
              size="small"
              disabled={!record.sourceFile}
              onClick={() => vscode.postMessage({ type: 'openSource', payload: { entryId: record.id } })}
            >
              Source
            </Button>
          </Tooltip>
          <Tooltip title="Delete this run">
            <Button
              size="small"
              danger
              loading={deletingIds.has(record.id)}
              icon={<DeleteOutlined />}
              onClick={() => handleDelete(record.id)}
            >
              Delete
            </Button>
          </Tooltip>
        </Space>
      )
    }
  ], [deletingIds, handleDelete]);

  const summaryCards = useMemo(() => {
    const summary = state.data?.summary;
    if (!summary) {
      return null;
    }

    const items: Array<{ title: string; value: number; icon: React.ReactNode }> = [
      { title: 'Total Runs', value: summary.total, icon: <ThunderboltOutlined /> },
      { title: 'Success', value: summary.success, icon: <Tag color="green">OK</Tag> },
      { title: 'Running', value: summary.running, icon: <Tag color="blue">RUN</Tag> },
      { title: 'Failed', value: summary.failed, icon: <Tag color="red">ERR</Tag> }
    ];

    return (
      <Flex gap={16} wrap>
        {items.map(item => (
          <Card key={item.title} style={{ minWidth: 180 }}>
            <Space direction="horizontal" size="large">
              {item.icon}
              <Statistic title={item.title} value={item.value} valueStyle={{ color: 'var(--vscode-foreground)' }} />
            </Space>
          </Card>
        ))}
        {summary.lastRun && (
          <Card style={{ minWidth: 220 }}>
            <Space>
              <ClockCircleOutlined />
              <div>
                <Typography.Text type="secondary">Last Run</Typography.Text>
                <Typography.Text style={{ display: 'block' }}>{formatDate(summary.lastRun)}</Typography.Text>
              </div>
            </Space>
          </Card>
        )}
      </Flex>
    );
  }, [state.data?.summary]);

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
              {state.data?.title ?? 'Execution History'}
            </Typography.Title>
            {state.data?.filter && (
              <Typography.Text type="secondary">
                {state.data.filter.type === 'all'
                  ? 'Showing all runs'
                  : `Showing ${state.data.filter.type} runs${state.data.filter.targetId ? ` for ${state.data.filter.targetId}` : ''}`}
              </Typography.Text>
            )}
          </div>
          <Button icon={<ReloadOutlined />} onClick={() => vscode.postMessage({ type: 'refresh' })}>
            Refresh
          </Button>
        </Space>

        {state.error && <Alert type="error" message={state.error} showIcon />}

        <Spin spinning={state.loading} tip="Loading history…">
          {state.data && state.data.entries.length > 0 ? (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              {summaryCards}
              <Table
                rowKey="id"
                columns={columns}
                dataSource={state.data.entries}
                pagination={{ pageSize: 10 }}
                size="middle"
              />
            </Space>
          ) : state.loading ? null : (
            <Card>
              <Empty description="No execution history yet." />
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
  root.render(<HistoryApp />);
}
