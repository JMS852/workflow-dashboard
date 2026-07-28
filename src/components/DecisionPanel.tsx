import React, { useState } from 'react';
import type { FileType } from '../types';
import { CheckCircle, XCircle, RefreshCw, ThumbsUp, ThumbsDown, Send } from 'lucide-react';

interface Props {
  fileType: FileType;
  fileName: string;
  onDecision: (action: string, reason: string) => void;
  feedback: string | null;
}

interface DecisionDef {
  action: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  requiresReason?: boolean;
}

const DECISION_MAP: Record<FileType, DecisionDef[]> = {
  checkpoint: [
    { action: '通过检查点', label: '✅ 通过', icon: <CheckCircle size={18} />, color: '#10b981' },
    { action: '驳回检查点', label: '❌ 驳回', icon: <XCircle size={18} />, color: '#ef4444', requiresReason: true },
  ],
  handoff: [
    { action: '通过执行结果', label: '✅ 通过', icon: <CheckCircle size={18} />, color: '#10b981' },
    { action: '需修改', label: '🔄 需修改', icon: <RefreshCw size={18} />, color: '#f59e0b', requiresReason: true },
    { action: '驳回执行结果', label: '❌ 驳回', icon: <XCircle size={18} />, color: '#ef4444', requiresReason: true },
  ],
  stage_gate: [
    { action: '通过阀门', label: '✅ 通过', icon: <CheckCircle size={18} />, color: '#10b981' },
    { action: '驳回阀门', label: '❌ 驳回', icon: <XCircle size={18} />, color: '#ef4444', requiresReason: true },
  ],
  decision: [
    { action: '同意该决策', label: '👍 同意', icon: <ThumbsUp size={18} />, color: '#10b981' },
    { action: '不同意该决策', label: '👎 不同意', icon: <ThumbsDown size={18} />, color: '#ef4444', requiresReason: true },
  ],
  project_status: [
    { action: '确认项目状态', label: '✅ 确认', icon: <CheckCircle size={18} />, color: '#10b981' },
    { action: '状态需调整', label: '⚠️ 需调整', icon: <XCircle size={18} />, color: '#f59e0b', requiresReason: true },
  ],
  recovery: [
    { action: '确认恢复', label: '✅ 确认恢复', icon: <CheckCircle size={18} />, color: '#10b981' },
  ],
  generic: [],
};

export default function DecisionPanel({ fileType, fileName, onDecision, feedback }: Props) {
  const [reason, setReason] = useState('');
  const [activeDecision, setActiveDecision] = useState<string | null>(null);

  const decisions = DECISION_MAP[fileType] || [];

  const handleClick = (d: DecisionDef) => {
    if (d.requiresReason && !activeDecision) {
      setActiveDecision(d.action);
      return;
    }
    onDecision(d.action, d.requiresReason ? reason : '');
    setReason('');
    setActiveDecision(null);
  };

  const cancelReason = () => {
    setActiveDecision(null);
    setReason('');
  };

  return (
    <div className="decision-panel">
      <h4>🎯 决策面板</h4>
      <p className="file-type-label">
        {fileName} — {getFileTypeLabel(fileType)}
      </p>

      {feedback && (
        <div className={`feedback ${feedback.startsWith('✅') ? 'success' : 'error'}`}>
          {feedback}
        </div>
      )}

      {decisions.length > 0 ? (
        <div className="decision-buttons">
          {decisions.map((d) => (
            <div key={d.action}>
              <button
                className="btn-decision"
                style={{ '--btn-color': d.color } as React.CSSProperties}
                onClick={() => handleClick(d)}
              >
                <span className="btn-icon">{d.icon}</span>
                {d.label}
              </button>
              {activeDecision === d.action && d.requiresReason && (
                <div className="reason-input">
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="写下理由..."
                    rows={3}
                    autoFocus
                  />
                  <div className="reason-actions">
                    <button className="btn btn-small btn-primary" onClick={() => handleClick(d)}>
                      <Send size={14} /> 确认
                    </button>
                    <button className="btn btn-small btn-ghost" onClick={cancelReason}>
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="hint">此文件类型暂无预设决策按钮，可用下方批注功能。</p>
      )}
    </div>
  );
}

function getFileTypeLabel(type: FileType): string {
  const labels: Record<FileType, string> = {
    checkpoint: '检查点',
    handoff: '执行汇报',
    stage_gate: '阶段阀门',
    decision: '决策记录',
    project_status: '项目状态',
    recovery: '恢复入口',
    generic: '文档',
  };
  return labels[type];
}
