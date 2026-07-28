import React, { useState, useEffect, useCallback } from 'react';
import type { TaskFlowItem, TaskExecutionResult, TaskProgress } from '../types';
import { Play, CheckCircle, XCircle, Clock, Zap, ChevronDown, ChevronUp, FileText, Loader } from 'lucide-react';

interface Props {
  onSelectTask?: (task: TaskFlowItem) => void;
}

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
const STATUS_LABELS: Record<string, string> = {
  pending: '⏳ 等待中',
  executing: '🔄 执行中',
  completed: '✅ 已完成',
  failed: '❌ 失败',
};

export default function TaskFlow({ onSelectTask }: Props) {
  const [tasks, setTasks] = useState<TaskFlowItem[]>([]);
  const [bridgeVersion, setBridgeVersion] = useState('');
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [progressMap, setProgressMap] = useState<Record<string, TaskProgress>>({});

  // Listen for bridge events
  useEffect(() => {
    if (!window.electronAPI) return;

    window.electronAPI.onBridgeReady((data) => {
      setBridgeVersion(data.version || '');
    });

    window.electronAPI.onMqttTask((data) => {
      const item: TaskFlowItem = {
        id: data.id,
        title: data.title,
        description: data.description,
        priority: data.priority || 'medium',
        status: 'pending',
        receivedAt: data.received_at,
        source: 'mqtt',
        topic: data.topic,
      };
      setTasks(prev => {
        const exists = prev.find(t => t.id === item.id);
        if (exists) return prev;
        return [item, ...prev];
      });
    });

    window.electronAPI.onTaskExecutionStarted((data) => {
      setTasks(prev => prev.map(t =>
        t.id === data.task_id ? { ...t, status: 'executing' } : t
      ));
    });

    window.electronAPI.onTaskExecuted((data: TaskExecutionResult) => {
      setTasks(prev => prev.map(t =>
        t.id === data.task_id ? {
          ...t,
          status: data.status === 'completed' ? 'completed' : 'failed',
          completedAt: Date.now(),
          result: data,
        } : t
      ));
    });

    window.electronAPI.onTaskExecutionError((data) => {
      setTasks(prev => prev.map(t =>
        t.id === data.task_id ? { ...t, status: 'failed', completedAt: Date.now() } : t
      ));
    });

    window.electronAPI.onTaskProgress((data: TaskProgress) => {
      setProgressMap(prev => ({ ...prev, [data.task_id]: data }));
    });

    return () => {
      // cleanup by App
    };
  }, []);

  const handleExecuteTask = useCallback(async (task: TaskFlowItem) => {
    if (!window.electronAPI) return;
    setExpandedTasks(prev => {
      const next = new Set(prev);
      next.add(task.id);
      return next;
    });
    await window.electronAPI.bridgeExecuteTask({
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
    });
    onSelectTask?.(task);
  }, [onSelectTask]);

  const toggleExpand = (taskId: string) => {
    setExpandedTasks(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const sorted = [...tasks].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 2;
    const pb = PRIORITY_ORDER[b.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    return b.receivedAt - a.receivedAt;
  });

  const pending = sorted.filter(t => t.status === 'pending' || t.status === 'executing');
  const completed = sorted.filter(t => t.status === 'completed' || t.status === 'failed');

  const renderTaskCard = (task: TaskFlowItem) => {
    const isExpanded = expandedTasks.has(task.id);
    const isExecuting = task.status === 'executing';

    const progress = progressMap[task.id];

    return (
      <div key={task.id} className={`task-card priority-${task.priority} ${task.status}`}>
        <div className="card-header" onClick={() => toggleExpand(task.id)}>
          <span className={`priority-badge ${task.priority}`}>
            {task.priority === 'high' ? '🔴' : task.priority === 'medium' ? '🟡' : '🟢'}
          </span>
          <span className="card-title">{task.title}</span>
          {task.source === 'mqtt' && <span className="source-badge">MQTT</span>}
          {isExecuting && <Loader size={14} className="executing-spinner" />}
          <span style={{ cursor: 'pointer', flexShrink: 0 }}>
            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        </div>

        {/* Progress bar during execution */}
        {isExecuting && progress && (
          <div className="progress-bar-container">
            <div className="progress-bar-fill" style={{ width: `${Math.round(progress.progress * 100)}%` }} />
            <span className="progress-label">{progress.message}</span>
          </div>
        )}

        {task.description && (
          <p className="card-desc">{task.description.slice(0, 120)}</p>
        )}

        {/* Expanded result view */}
        {isExpanded && task.result && (
          <div className="card-result-expanded">
            <div className="result-meta">
              <span>Level: <strong>{task.result.level}</strong></span>
              <span>AI: <strong>{task.result.reference_results}</strong></span>
              <span>Duration: <strong>{task.result.duration_ms}ms</strong></span>
              <span>Passed: <strong>{task.result.passed}/{task.result.reference_results}</strong></span>
            </div>
            {task.result.final_result && (
              <div className="result-body">
                <div className="result-body-header">
                  <FileText size={12} /> AI 综合输出
                </div>
                <div className="result-text">{task.result.final_result}</div>
              </div>
            )}
            {task.result.generated_files && task.result.generated_files.length > 0 && (
              <div className="result-files">
                📁 生成文件: {task.result.generated_files.map((f: string) => (
                  <span key={f} className="gen-file">{f.split('/').pop() || f.split('\\').pop()}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Expanded pending view */}
        {isExpanded && task.status === 'pending' && (
          <div className="card-result-expanded">
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '8px 0' }}>
              {task.description}
            </p>
            <button
              className="btn btn-primary btn-small"
              onClick={() => handleExecuteTask(task)}
              style={{ marginTop: 8 }}
            >
              <Play size={12} /> 立即执行
            </button>
          </div>
        )}

        <div className="card-footer">
          <span className="card-status">{STATUS_LABELS[task.status]}</span>
          {task.status === 'pending' && (
            <button
              className="btn btn-small btn-primary"
              onClick={() => handleExecuteTask(task)}
            >
              <Play size={12} /> 执行
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="task-flow">
      <div className="task-flow-header">
        <h3>
          <Zap size={18} />
          任务流
        </h3>
        {bridgeVersion && (
          <span className="bridge-ver">Bridge v{bridgeVersion}</span>
        )}
        <span className="task-count">
          {pending.length} 活跃 / {tasks.length} 总计
        </span>
      </div>

      {tasks.length === 0 ? (
        <div className="task-flow-empty">
          <Clock size={32} strokeWidth={1} />
          <p>暂无任务</p>
          <p className="hint">通过 MQTT 或手动发送任务开始</p>
        </div>
      ) : (
        <div className="task-flow-content">
          {/* Active column */}
          <div className="flow-column active-column">
            <div className="column-header">
              <Play size={14} />
              <span>活跃 ({pending.length})</span>
            </div>
            {pending.length === 0 ? (
              <p className="hint" style={{ padding: '12px 0', textAlign: 'center' }}>无活跃任务</p>
            ) : (
              pending.map(renderTaskCard)
            )}
          </div>

          {/* Completed column */}
          <div className="flow-column completed-column">
            <div className="column-header">
              <CheckCircle size={14} />
              <span>已完成 ({completed.length})</span>
            </div>
            {completed.length === 0 ? (
              <p className="hint" style={{ padding: '12px 0', textAlign: 'center' }}>尚无完成的任务</p>
            ) : (
              completed.map(renderTaskCard)
            )}
          </div>
        </div>
      )}
    </div>
  );
}
