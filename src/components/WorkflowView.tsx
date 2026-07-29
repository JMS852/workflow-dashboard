import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { WorkflowStatus, ConclusionTableData, AgentResult, ConclusionDetectedEvent, RoundProgressEvent } from '../types';
import { Send, Square, Loader2, MessageSquare, GitCompare, Vote, Activity } from 'lucide-react';

type Tab = 'chat' | 'conclusions' | 'debate';

export default function WorkflowView() {
  const [task, setTask] = useState('');
  const [running, setRunning] = useState(false);
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus | null>(null);
  const [conclusionTable, setConclusionTable] = useState<ConclusionTableData | null>(null);
  const [debateSummary, setDebateSummary] = useState<string | null>(null);
  const [finalDecision, setFinalDecision] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [aiWindowStatuses, setAiWindowStatuses] = useState<Record<string, string>>({});
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [workflowStatus, conclusionTable, debateSummary, finalDecision]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    api.onWorkflowStateChange((data: WorkflowStatus) => {
      setWorkflowStatus(data);
      if (data.state === 'complete') {
        setRunning(false);
        setStatusMsg('工作流完成');
      } else if (data.state === 'round_1_produce') {
        setStatusMsg('Round 1: Agent 正在产出方案...');
      } else if (data.state === 'round_2_debate') {
        setStatusMsg('Round 2: Agent 正在辩论...');
        setActiveTab('conclusions');
      } else if (data.state === 'round_3_decide') {
        setStatusMsg('Round 3: Agent 正在决策...');
        setActiveTab('debate');
      } else if (data.state === 'idle') {
        setRunning(false);
        setStatusMsg('');
      }
    });

    api.onWorkflowConclusionDetected((data: ConclusionDetectedEvent) => {
      setAiWindowStatuses((prev) => ({
        ...prev,
        [data.label]: `✅ 结论已提取 · Round ${data.round}`,
      }));
    });

    api.onWorkflowRoundProgress((data: RoundProgressEvent) => {
      if (data.status === 'processing') {
        setStatusMsg(`信差正在处理 Round ${data.round} 结论...`);
      }
    });

    api.onWorkflowConclusionTable((data: ConclusionTableData) => {
      setConclusionTable(data);
    });

    api.onWorkflowDebateResult((data: { summary: string }) => {
      setDebateSummary(data.summary);
    });

    api.onWorkflowFinalDecision((data: { decision: string }) => {
      setFinalDecision(data.decision);
    });

    api.onWorkflowError((data: { error: string }) => {
      setStatusMsg(`错误: ${data.error}`);
      setRunning(false);
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    const api = window.electronAPI;
    if (!api || !task.trim() || running) return;

    setRunning(true);
    setConclusionTable(null);
    setDebateSummary(null);
    setFinalDecision(null);
    setStatusMsg('正在提交任务...');

    const result = await api.workflowSubmitTask(task.trim());
    if (result.error) {
      setStatusMsg(`提交失败: ${result.error}`);
      setRunning(false);
    }
  }, [task, running]);

  const handleCancel = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    await api.workflowCancel();
    setRunning(false);
    setStatusMsg('已取消');
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const stateLabel = (state: string): string => {
    const map: Record<string, string> = {
      idle: '空闲',
      round_1_produce: 'Round 1: 产出',
      round_2_debate: 'Round 2: 辩论',
      round_3_decide: 'Round 3: 决策',
      complete: '完成',
    };
    return map[state] || state;
  };

  return (
    <div className="workflow-view">
      {/* Status bar */}
      <div className="workflow-status-bar">
        <span className={`workflow-state ${workflowStatus?.state || 'idle'}`}>
          {stateLabel(workflowStatus?.state || 'idle')}
        </span>
        {statusMsg && <span className="workflow-status-msg">{statusMsg}</span>}
        {running && <Loader2 size={14} className="spin" />}
      </div>

      {/* Tab switcher */}
      <div className="workflow-tabs">
        <button
          className={`workflow-tab ${activeTab === 'chat' ? 'active' : ''}`}
          onClick={() => setActiveTab('chat')}
        >
          <MessageSquare size={14} /> 对话
        </button>
        <button
          className={`workflow-tab ${activeTab === 'conclusions' ? 'active' : ''}`}
          onClick={() => setActiveTab('conclusions')}
        >
          <GitCompare size={14} /> 结论对比
        </button>
        <button
          className={`workflow-tab ${activeTab === 'debate' ? 'active' : ''}`}
          onClick={() => setActiveTab('debate')}
        >
          <Vote size={14} /> 辩论&决策
        </button>
      </div>

      {/* Content area */}
      <div className="workflow-content" ref={logRef}>
        {/* Chat tab: input + log */}
        {activeTab === 'chat' && (
          <div className="chat-view">
            {/* AI Window Status Bar */}
            <div className="ai-status-bar">
              <Activity size={12} />
              {Object.entries(aiWindowStatuses).length > 0 ? (
                Object.entries(aiWindowStatuses).map(([label, status]) => (
                  <span key={label} className="ai-status-chip">
                    <span className="ai-chip-label">{label}</span>
                    <span className="ai-chip-status">{status}</span>
                  </span>
                ))
              ) : (
                <span className="ai-status-empty">等待 AI 响应...</span>
              )}
            </div>
            {/* Conversation log */}
            <div className="chat-log">
              {(workflowStatus?.roundResults?.['1'] || workflowStatus?.roundResults?.[1]) && (
                <div className="chat-event">
                  <div className="chat-event-header">📋 Round 1 产出</div>
                  {(workflowStatus.roundResults['1'] || workflowStatus.roundResults[1]).map((r: AgentResult, i: number) => (
                    <div key={i} className={`chat-agent-msg ${r.error ? 'error' : ''}`}>
                      <div className="chat-agent-label">{r.agentId}</div>
                      <div className="chat-agent-conclusion">
                        {r.error ? `❌ ${r.error}` : r.conclusion}
                      </div>
                      {r.fullOutput && (
                        <details>
                          <summary>查看完整产出 ({(r.fullOutput.length / 1000).toFixed(1)}K)</summary>
                          <pre className="full-output">{r.fullOutput.slice(0, 5000)}{r.fullOutput.length > 5000 ? '\n...（已截断）' : ''}</pre>
                        </details>
                      )}
                      <div className="chat-agent-time">{r.durationMs}ms</div>
                    </div>
                  ))}
                </div>
              )}

              {running && !workflowStatus?.roundResults?.['1'] && !workflowStatus?.roundResults?.[1] && (
                <div className="chat-waiting">
                  <Loader2 size={20} className="spin" />
                  <p>等待 Agent 响应...</p>
                </div>
              )}

              {finalDecision && (
                <div className="chat-event">
                  <div className="chat-event-header">🏆 最终决策</div>
                  <pre className="final-decision">{finalDecision}</pre>
                </div>
              )}
            </div>

            {/* Input area */}
            <div className="chat-input-area">
              <textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入任务描述... (Enter 发送，Shift+Enter 换行)"
                rows={3}
                disabled={running}
              />
              <div className="chat-input-actions">
                {running ? (
                  <button className="btn btn-danger" onClick={handleCancel}>
                    <Square size={14} /> 取消
                  </button>
                ) : (
                  <button
                    className="btn btn-primary"
                    onClick={handleSubmit}
                    disabled={!task.trim()}
                  >
                    <Send size={14} /> 提交任务
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Conclusions tab: side-by-side comparison table */}
        {activeTab === 'conclusions' && (
          <div className="conclusions-view">
            {conclusionTable ? (
              <>
                <div className="conclusion-meta">
                  Round {conclusionTable.round} · {conclusionTable.results.filter(r => !r.error).length}/{conclusionTable.results.length} Agent 完成
                </div>
                <div
                  className="conclusion-table markdown-body"
                  dangerouslySetInnerHTML={{ __html: renderMarkdownTable(conclusionTable.table) }}
                />
                <div className="conclusion-raw">
                  <details>
                    <summary>原始 Markdown</summary>
                    <pre>{conclusionTable.table}</pre>
                  </details>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <GitCompare size={40} strokeWidth={1} />
                <p>尚未有结论产出。提交任务后，各 Agent 的结论将在这里并排对比。</p>
              </div>
            )}
          </div>
        )}

        {/* Debate tab: debate summary + decision */}
        {activeTab === 'debate' && (
          <div className="debate-view">
            {debateSummary && (
              <div className="debate-section">
                <h3>📊 辩论汇总</h3>
                <div
                  className="markdown-body"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(debateSummary) }}
                />
              </div>
            )}
            {finalDecision && (
              <div className="debate-section">
                <h3>🏆 最终决策</h3>
                <div
                  className="markdown-body"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(finalDecision) }}
                />
              </div>
            )}
            {!debateSummary && !finalDecision && (
              <div className="empty-state">
                <Vote size={40} strokeWidth={1} />
                <p>辩论与决策将在 Round 2-3 自动进行。</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function renderMarkdownTable(md: string): string {
  let html = md
    // Table
    .replace(/^\|(.+)\|$/gm, (match) => {
      const cells = match.split('|').filter(c => c.trim());
      const isHeader = match.includes('---');
      if (isHeader) return '';
      const tag = match.startsWith('| Agent') || match.startsWith('|-------') ? 'th' : 'td';
      return `<tr>${cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('')}</tr>`;
    })
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Headings
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    // List items
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr>')
    // Paragraphs
    .replace(/\n\n/g, '<br><br>');

  // Wrap consecutive <tr> in <table>
  html = html.replace(/(<tr>[\s\S]*?<\/tr>)+/g, (match) => `<table>${match}</table>`);
  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li>[\s\S]*?<\/li>)+/g, (match) => `<ul>${match}</ul>`);

  return html;
}

function renderMarkdown(md: string): string {
  return md
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\n\n/g, '<br><br>');
}
