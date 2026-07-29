/**
 * AISelector (v3) — 替代 AgentPanel
 *
 * 选择 AI 类型 + 数量，一键启动独立桌面窗口。
 * 不再需要填写 ID、显示名、工作目录等字段。
 */

import React, { useState } from 'react';
import type { AIToolType, AILaunchConfig, AiWindowInfo } from '../types';
import { Play, Square, Monitor, Cpu, FolderOpen } from 'lucide-react';

interface Props {
  projectDir: string | null;
  onSelectProject: () => void;
  onLaunch: (config: AILaunchConfig) => void;
  onShutdown: () => void;
  aiWindows: AiWindowInfo[];
  launched: boolean;
}

export default function AISelector({
  projectDir,
  onSelectProject,
  onLaunch,
  onShutdown,
  aiWindows,
  launched,
}: Props) {
  const [claudeCount, setClaudeCount] = useState(2);
  const [codexCount, setCodexCount] = useState(1);
  const [claudeEnabled, setClaudeEnabled] = useState(true);
  const [codexEnabled, setCodexEnabled] = useState(true);

  const handleLaunch = () => {
    if (!projectDir) return;
    const tools: { type: AIToolType; count: number }[] = [];
    if (claudeEnabled && claudeCount > 0) tools.push({ type: 'claude', count: claudeCount });
    if (codexEnabled && codexCount > 0) tools.push({ type: 'codex', count: codexCount });
    if (tools.length === 0) return;
    onLaunch({ projectDir, tools });
  };

  const totalCount = (claudeEnabled ? claudeCount : 0) + (codexEnabled ? codexCount : 0);

  return (
    <div className="ai-selector">
      <div className="ai-selector-header">
        <Cpu size={14} />
        <span>AI 配置</span>
      </div>

      {/* Project */}
      <div className="ai-selector-section">
        <div className="field-label">📁 项目</div>
        <button className="btn btn-ghost btn-sm" onClick={onSelectProject}>
          <FolderOpen size={12} />
          {projectDir ? projectDir.split('\\').pop() : '选择文件夹'}
        </button>
        {projectDir && (
          <div className="field-hint" title={projectDir}>
            {projectDir.length > 35 ? '...' + projectDir.slice(-35) : projectDir}
          </div>
        )}
      </div>

      {/* Claude Code */}
      <div className="ai-selector-section">
        <label className="ai-tool-check">
          <input
            type="checkbox"
            checked={claudeEnabled}
            onChange={(e) => setClaudeEnabled(e.target.checked)}
            disabled={launched}
          />
          <span className="ai-tool-name claude">Claude Code</span>
        </label>
        <div className="ai-tool-count">
          <span className="count-label">数量</span>
          <select
            value={claudeCount}
            onChange={(e) => setClaudeCount(Number(e.target.value))}
            disabled={launched || !claudeEnabled}
          >
            {[1, 2, 3].map((n) => (<option key={n} value={n}>{n}</option>))}
          </select>
        </div>
        <span className="ai-tool-badge">终端</span>
      </div>

      {/* Codex */}
      <div className="ai-selector-section">
        <label className="ai-tool-check">
          <input
            type="checkbox"
            checked={codexEnabled}
            onChange={(e) => setCodexEnabled(e.target.checked)}
            disabled={launched}
          />
          <span className="ai-tool-name codex">Codex</span>
        </label>
        <div className="ai-tool-count">
          <span className="count-label">数量</span>
          <select
            value={codexCount}
            onChange={(e) => setCodexCount(Number(e.target.value))}
            disabled={launched || !codexEnabled}
          >
            {[1, 2, 3].map((n) => (<option key={n} value={n}>{n}</option>))}
          </select>
        </div>
        <span className="ai-tool-badge">终端</span>
      </div>

      {/* Launch / Shutdown */}
      <div className="ai-selector-actions">
        {!launched ? (
          <button
            className="btn btn-primary btn-block"
            onClick={handleLaunch}
            disabled={!projectDir || totalCount === 0}
          >
            <Play size={14} />
            启动 {totalCount} 个 AI
          </button>
        ) : (
          <button className="btn btn-danger btn-block" onClick={onShutdown}>
            <Square size={14} />
            关闭所有 AI
          </button>
        )}
      </div>

      {/* AI Window Status */}
      {launched && aiWindows.length > 0 && (
        <div className="ai-window-status">
          <Monitor size={12} />
          <span>已启动 {aiWindows.length} 个窗口</span>
          {aiWindows.map((w) => (
            <div key={w.id} className={`ai-window-badge ${w.type}`}>
              {w.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
