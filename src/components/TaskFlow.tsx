import React, { useState, useEffect, useCallback } from 'react';
import type { TaskFlowItem, TaskExecutionResult } from '../types';
import { Play, CheckCircle, XCircle, Clock, Zap, ArrowRight } from 'lucide-react';

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

    return () => {
      // cleanup by App
    };
  }, []);

  const handleExecuteTask = useCallback(async (task: TaskFlowItem) => {
    if (!window.electronAPI) return;
    await window.electronAPI.bridgeExecuteTask({
      title: task.title,
      description: task.description,
      priority: task.priority,
    });
    onSelectTask?.(task);
  }, [onSelectTask]);

  const sorted = [...tasks].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 2;
    const pb = PRIORITY_ORDER[b.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    return b.receivedAt - a.receivedAt;
  });

  const pending = sorted.filter(t => t.status === 'pending' || t.status === 'executing');
  const completed = sorted.filter(t => t.status === 'completed' || t.status === 'failed');

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
            {pending.map(task => (
              <div key={task.id} className={`task-card priority-${task.priority}`}>
                <div className="card-header">
                  <span className={`priority-badge ${task.priority}`}>
                    {task.priority === 'high' ? '🔴' : task.priority === 'medium' ? '🟡' : '🟢'}
                  </span>
                  <span className="card-title">{task.title}</span>
                  {task.source === 'mqtt' && <span className="source-badge">MQTT</span>}
                </div>
                {task.description && (
                  <p className="card-desc">{task.description.slice(0, 100)}</p>
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
                  {task.status === 'executing' && (
                    <span className="executing-spinner">⏳</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Completed column */}
          <div className="flow-column completed-column">
            <div className="column-header">
              <CheckCircle size={14} />
              <span>已完成 ({completed.length})</span>
            </div>
            {completed.map(task => (
              <div key={task.id} className={`task-card ${task.status}`}>
                <div className="card-header">
                  <span className="card-title">{task.title}</span>
                  {task.status === 'failed' && <XCircle size={14} color="#ef4444" />}
                  {task.status === 'completed' && <CheckCircle size={14} color="#10b981" />}
                </div>
                {task.result && (
                  <div className="card-result">
                    <span className="result-line">
                      L{task.result.level} · {task.result.reference_results} AI · {task.result.duration_ms}ms
                    </span>
                  </div>
                )}
                <div className="card-footer">
                  <span className="card-status">{STATUS_LABELS[task.status]}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
