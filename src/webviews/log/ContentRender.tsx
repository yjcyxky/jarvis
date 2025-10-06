import React, { useState, useMemo } from 'react';
import { Button, Select, Typography } from 'antd';
import { DownOutlined, UpOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import Papa from 'papaparse';
import { SimpleTable, HeaderObject } from "simple-table-core";
import "simple-table-core/styles.css";
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import { unified } from 'unified';
import remarkParse from 'remark-parse';

function normalizeMarkdownFences(markdown: string): string {
  return markdown
    // 把行首（允许空格）后紧跟 ``` 的部分移到行首
    .replace(/^[ \t]+(```)/gm, '$1')
    // 清除一些常见的 BOM 或奇怪缩进
    .replace(/^\uFEFF/, '');
}

function detectContentType(
  text: string,
  isCode: boolean
): 'code' | 'csv' | 'tsv' | 'markdown' | 'text' {
  if (isCode) return 'code';

  const trimmed = text.trim();
  if (!trimmed) return 'text';

  // Detect table: csv / tsv
  const lines = trimmed.split(/\r?\n/).slice(0, 10); // 取前10行
  const commaCount = lines.map(l => (l.match(/,/g) || []).length);
  const tabCount = lines.map(l => (l.match(/\t/g) || []).length);

  const avgComma = commaCount.reduce((a, b) => a + b, 0) / lines.length;
  const avgTab = tabCount.reduce((a, b) => a + b, 0) / lines.length;

  // If the number of commas/tabs appears stably in multiple lines, it can be determined as a table format
  const isCsv =
    avgComma > 1 && commaCount.filter(c => c > 0).length >= lines.length / 2;
  const isTsv =
    avgTab > 1 && tabCount.filter(c => c > 0).length >= lines.length / 2;

  if (isCsv) return 'csv';
  if (isTsv) return 'tsv';

  // Detect Markdown
  if (looksLikeMarkdown(trimmed)) return 'markdown';

  return 'text';
}

function looksLikeMarkdown(text: string) {
  const ast = unified().use(remarkParse).parse(text);
  // 检查 ast.children 中是否有 “heading” / “list” / “code” / “link” 等节点
  for (const node of ast.children) {
    if (['heading', 'list', 'code', 'blockquote', 'link'].includes(node.type)) {
      return true;
    }
  }
  return false;
}


interface CollapsibleContentProps {
  text: string;
  maxLength?: number;
  isCode?: boolean;
}

/**
 * Common collapsible content component
 * - Support text, code, Markdown, CSV/TSV table
 * - Automatically detect content type
 * - Long text folding display
 */
export const CollapsibleContent: React.FC<CollapsibleContentProps> = ({
  text,
  maxLength = 600,
  isCode = false
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const type = useMemo(() => detectContentType(text, isCode), [text, isCode]);
  const [contentType, setContentType] = useState(type);
  const [selectorVisible, setSelectorVisible] = useState(text.length > 100);

  const shouldCollapse = text.length > maxLength;
  const displayText = shouldCollapse && !isExpanded ? text.slice(0, maxLength) + '...' : text;
  const rawText = text

  const renderContent = () => {
    switch (contentType) {
      case 'csv':
      case 'tsv': {
        const delimiter = contentType === 'csv' ? ',' : '\t';

        const parsed = Papa.parse<string[]>(rawText.trim(), {
          delimiter,
          skipEmptyLines: true,
          dynamicTyping: false,
          transform: (v) => v?.trim?.() ?? v,
        });

        if (parsed.errors.length > 0) {
          const errorList = parsed.errors.map((e, i) => (
            <div key={i}>• {e.message} ( Row {e.row ?? 'Unknown'} )</div>
          ));
          return (
            <Typography.Text type="danger">
              CSV/TSV parsing error:
              <div style={{ marginTop: 4 }}>{errorList}</div>
            </Typography.Text>
          );
        }

        const rowsArray = parsed.data;
        if (!rowsArray || rowsArray.length === 0) {
          return <Typography.Text type="secondary">(Empty table)</Typography.Text>;
        }

        const headers = rowsArray[0];
        const body = rowsArray.slice(1);

        const headerObjects: HeaderObject[] = headers.map((h, idx) => ({
          accessor: h || `col_${idx}`,
          label: h || `Column ${idx + 1}`,
          isSortable: true,
          type: 'string',
          width: '150px',
          minWidth: 100,
          maxWidth: 300,
        }));

        const rowData = body.map((row, i) => {
          const record: Record<string, string> = {};
          headers.forEach((h, idx) => (record[h || `col_${idx}`] = row[idx] ?? ''));
          return { id: i, ...record };
        });

        return (
          <div
            style={{
              width: '100%',
              overflowX: 'auto',
              overflowY: 'hidden',
              border: '1px solid #e0e0e0',
              borderRadius: 4,
              boxSizing: 'border-box',
              maxWidth: 'calc(100vw - 200px)', // 避免超出页面
            }}
          >
            <div
              style={{
                width: '100%',
                minWidth: `${Math.max(headers.length * 150, 600)}px`,
              }}
            >
              <Select
                value={contentType}
                options={["code", "markdown", "text", "csv", "tsv"].map(v => ({ label: v, value: v }))}
                onChange={(value) => {
                  setContentType(value as "code" | "markdown" | "text" | "csv" | "tsv");
                }}
                style={{
                  height: 'auto',
                  fontSize: '12px',
                  color: 'var(--vscode-descriptionForeground)',
                  background: 'none',
                  boxShadow: 'none',
                  width: 150,
                  display: selectorVisible ? 'block' : 'none'
                }}
              >
              </Select>
              <SimpleTable
                defaultHeaders={headerObjects}
                rows={isExpanded ? rowData : rowData.slice(0, 5)}
                rowIdAccessor="id"
                editColumns
                selectableCells
                theme="light"
                rowHeight={32}
              />
            </div>
          </div>
        );
      }

      case 'markdown':
        return (
          <div
            style={{
              border: '1px solid #e0e0e0',
              background: 'rgba(255,255,255,0.03)',
              borderRadius: 4,
              padding: 6,
              maxWidth: '100%',
              overflowX: 'auto',
              wordBreak: 'break-word'
            }}
          >
            <Select
              value={contentType}
              options={["code", "markdown", "text", "csv", "tsv"].map(v => ({ label: v, value: v }))}
              onChange={(value) => {
                setContentType(value as "code" | "markdown" | "text" | "csv" | "tsv");
              }}
              style={{
                height: 'auto',
                fontSize: '12px',
                color: 'var(--vscode-descriptionForeground)',
                background: 'none',
                boxShadow: 'none',
                width: 150,
                display: selectorVisible ? 'block' : 'none'
              }}
            >
            </Select>
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkFrontmatter]}
              components={{
                // 确保表格不会超出容器
                table: ({ children, ...props }) => (
                  <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
                    <table {...props} style={{ minWidth: '100%', tableLayout: 'auto' }}>
                      {children}
                    </table>
                  </div>
                ),
                // 确保代码块不会超出容器
                pre: ({ children, ...props }) => (
                  <pre {...props} style={{
                    overflowX: 'auto',
                    maxWidth: '100%',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word'
                  }}>
                    {children}
                  </pre>
                ),
                // 确保代码不会超出容器
                code: ({ children, ...props }) => (
                  <code {...props} style={{
                    wordBreak: 'break-word',
                    maxWidth: '100%'
                  }}>
                    {children}
                  </code>
                )
              }}
            >
              {normalizeMarkdownFences(displayText)}
            </ReactMarkdown>
          </div>
        );

      case 'code':
        return (
          <>
            <Select
              value={contentType}
              options={["code", "markdown", "text", "csv", "tsv"].map(v => ({ label: v, value: v }))}
              onChange={(value) => {
                setContentType(value as "code" | "markdown" | "text" | "csv" | "tsv");
              }}
              style={{
                height: 'auto',
                fontSize: '12px',
                color: 'var(--vscode-descriptionForeground)',
                background: 'none',
                boxShadow: 'none',
                width: 150,
                display: selectorVisible ? 'block' : 'none'
              }}
            >
            </Select>
            <pre
              style={{
                border: '1px solid #e0e0e0',
                padding: 6,
                background: 'rgba(255,255,255,0.03)',
                borderRadius: 4,
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                maxWidth: '100%',
                wordBreak: 'break-word'
              }}
            >
              <code>{displayText}</code>
            </pre>
          </>
        );

      default:
        return (
          <>
            <Select
              value={contentType}
              options={["code", "markdown", "text", "csv", "tsv"].map(v => ({ label: v, value: v }))}
              onChange={(value) => {
                setContentType(value as "code" | "markdown" | "text" | "csv" | "tsv");
              }}
              style={{
                height: 'auto',
                fontSize: '12px',
                color: 'var(--vscode-descriptionForeground)',
                background: 'none',
                boxShadow: 'none',
                width: 150,
                display: selectorVisible ? 'block' : 'none'
              }}
            >
            </Select>
            <Typography.Paragraph
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                overflowX: 'auto',
                padding: 6,
                border: selectorVisible ? '1px solid #e0e0e0' : 'none',
                borderRadius: 4,
                maxWidth: '100%'
              }}
            >
              {displayText.split('\n').map((line, index) => (
                <React.Fragment key={index}>
                  {line}
                  {index < displayText.split('\n').length - 1 && <br />}
                </React.Fragment>
              ))}
            </Typography.Paragraph>
          </>
        );
    }
  };

  return (
    <div>
      {/* <span>{detectContentType(text, isCode) }</span> */}
      {renderContent()}
      {shouldCollapse && (
        <Button
          size="small"
          icon={isExpanded ? <UpOutlined /> : <DownOutlined />}
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            padding: 6,
            marginTop: 6,
            height: 'auto',
            fontSize: '12px',
            color: 'var(--vscode-descriptionForeground)',
            background: 'none',
            boxShadow: 'none'
          }}
        >
          {isExpanded ? 'Collapse' : 'Expand'}
        </Button>
      )}
    </div>
  );
};
