import React, { useState, useEffect, useCallback } from 'react';
import type { AgentConfig, AgentStatus, AgentStatusEvent } from '../types';
import { Cpu, Check, X, Circle, Trash2, Plus } from 'lucide-react';

interface Props {
  onStatuses?: (statuses: Record<string, AgentStatus>) => void;
}

export default function AgentPanel({ onStatuses }: Props) {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [statuses, setStatuses] = useState<Record<string, AgentStatus>>({});
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [showAdd, setShowAdd] = useState(false);

  // Form state for adding agent
  const [newId, setNewId] = useState('');
  const [newType, setNewType] = useState<'claude' | 'codex'>('claude');
  const [newLabel, setNewLabel] = useState('');
  const [newDir, setNewDir] = useState('');

  const loadAgents = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    const list = await api.agentList();
    setAgents(list);
    const avail = await api.agentCheckAvailability();
    setAvailability(avail);
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  // Listen for agent status changes from workflow
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    api.onWorkflowAgentStatus((data: AgentStatusEvent) => {
      setStatuses((prev) => ({
        ...prev,
        [data.agentId]: data.status,
      }));
      onStatuses?.(statuses);
    });
  }, [onStatuses]);

  const handleRegister = async () => {
    const api = window.electronAPI;
    if (!api || !newId.trim()) return;

    const config: AgentConfig = {
      id: newId.trim(),
      type: newType,
      label: newLabel.trim() || newId.trim(),
      workDir: newDir.trim() || process.cwd?.() || '.',
      enabled: true,
    };

    await api.agentRegister(config);
    setShowAdd(false);
    setNewId('');
    setNewLabel('');
    setNewDir('');
    loadAgents();
  };

  const handleToggle = async (id: string) => {
    const api = window.electronAPI;
    if (!api) return;
    const agent = agents.find((a) => a.id === id);
    if (!agent) return;
    const updated = { ...agent, enabled: !agent.enabled };
    await api.agentUpdateConfig(updated);
    loadAgents();
  };

  const handleRemove = async (id: string) => {
    const api = window.electronAPI;
    if (!api) return;
    await api.agentUnregister(id);
    loadAgents();
  };

  const statusIcon = (status: AgentStatus) => {
    switch (status) {
      case 'working':
        return <Circle size={10} className="pulse" style={{ color: '#f59e0b', fill: '#f59e0b' }} />;
      case 'done':
        return <Check size={10} style={{ color: '#10b981' }} />;
      case 'error':
        return <X size={10} style={{ color: '#ef4444' }} />;
      default:
        return <Circle size={10} style={{ color: '#5e6278' }} />;
    }
  };

  return (
    <div className="agent-panel">
      <div className="agent-panel-header">
        <Cpu size={14} />
        <span>Agents</span>
        <button className="btn-icon" onClick={() => setShowAdd(!showAdd)} title="添加 Agent">
          <Plus size={14} />
        </button>
      </div>

      {/* Add Agent Form */}
      {showAdd && (
        <div className="agent-add-form">
          <input
            placeholder="ID (e.g. cc-1)"
            value={newId}
            onChange={(e) => setNewId(e.target.value)}
          />
          <select value={newType} onChange={(e) => setNewType(e.target.value as 'claude' | 'codex')}>
            <option value="claude">Claude Code</option>
            <option value="codex">Codex</option>
          </select>
          <input
            placeholder="显示名 (e.g. Claude #1)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
          />
          <input
            placeholder="工作目录"
            value={newDir}
            onChange={(e) => setNewDir(e.target.value)}
          />
          <button className="btn btn-primary btn-sm" onClick={handleRegister} disabled={!newId.trim()}>
            注册
          </button>
        </div>
      )}

      {/* Agent List */}
      <div className="agent-list">
        {agents.length === 0 && (
          <div className="agent-empty">
            <p>暂无 Agent。点击 + 添加。</p>
            <p className="hint">Claude Code: <code>npm i -g @anthropic-ai/claude-code</code></p>
            <p className="hint">Codex: <code>npm i -g @openai/codex</code></p>
          </div>
        )}

        {agents.map((agent) => {
          const status = statuses[agent.id] || 'idle';
          const avail = availability[agent.id];
          return (
            <div
              key={agent.id}
              className={`agent-item ${agent.enabled ? '' : 'disabled'} ${status}`}
            >
              <div className="agent-item-left">
                <span className="agent-status-icon">{statusIcon(status)}</span>
                <span className="agent-label">{agent.label}</span>
                <span className="agent-type-badge">{agent.type}</span>
                {avail === false && <span className="agent-warn" title="CLI 未找到">⚠</span>}
              </div>
              <div className="agent-item-right">
                <button
                  className={`btn-toggle ${agent.enabled ? 'on' : 'off'}`}
                  onClick={() => handleToggle(agent.id)}
                  title={agent.enabled ? '禁用' : '启用'}
                >
                  {agent.enabled ? 'ON' : 'OFF'}
                </button>
                <button className="btn-icon btn-remove" onClick={() => handleRemove(agent.id)} title="移除">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
