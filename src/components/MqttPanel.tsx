import React, { useState, useEffect } from 'react';
import { Radio, Wifi, WifiOff, Play, Square, Send, Settings } from 'lucide-react';
import type { MqttStatus, MqttTask } from '../types';

interface Props {
  onStatusChange?: (connected: boolean) => void;
  onManualTask?: (title: string, description: string) => void;
}

export default function MqttPanel({ onStatusChange, onManualTask }: Props) {
  const [connected, setConnected] = useState(false);
  const [broker, setBroker] = useState('localhost');
  const [port, setPort] = useState(1883);
  const [statusText, setStatusText] = useState('未连接');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [recentTasks, setRecentTasks] = useState<MqttTask[]>([]);

  useEffect(() => {
    if (!window.electronAPI) return;

    window.electronAPI.onMqttStatus((data: MqttStatus) => {
      setStatusText(data.detail || data.status);
      if (data.status === 'connected') {
        setConnected(true);
        onStatusChange?.(true);
      } else if (data.status === 'disconnected' || data.status === 'error') {
        setConnected(false);
        onStatusChange?.(false);
      }
    });

    window.electronAPI.onMqttTask((data: MqttTask) => {
      setRecentTasks(prev => [data, ...prev].slice(0, 20));
    });

    return () => {
      // listeners cleaned up by App
    };
  }, [onStatusChange]);

  const handleConnect = async () => {
    if (!window.electronAPI) return;
    setStatusText('连接中...');
    try {
      await window.electronAPI.bridgeStartMqtt({
        broker,
        port,
        task_topic: 'workflow/tasks/#',
        result_topic: 'workflow/results',
      });
    } catch (err: any) {
      setStatusText(`连接失败: ${err?.message || '未知错误'}`);
      setConnected(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.electronAPI) return;
    await window.electronAPI.bridgeStopMqtt();
    setConnected(false);
    setStatusText('已断开');
  };

  const handleSendTask = async () => {
    if (!taskTitle.trim() || !window.electronAPI) return;
    const title = taskTitle.trim();
    const desc = taskDesc.trim();
    try {
      await window.electronAPI.bridgePublishMqtt({
        topic: 'workflow/tasks/manual',
        payload: { title, description: desc, priority: 'medium' },
      });
      onManualTask?.(title, desc);
      setTaskTitle('');
      setTaskDesc('');
    } catch (err: any) {
      setStatusText(`发送失败: ${err?.message || '未知错误'}`);
    }
  };

  const statusColor = connected ? '#10b981' : '#6b7280';

  return (
    <div className="mqtt-panel">
      <div className="panel-section">
        <h4>
          <Radio size={16} style={{ color: statusColor }} />
          MQTT Broker
        </h4>
        <div className="mqtt-status" style={{ color: statusColor }}>
          {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
          <span>{statusText}</span>
        </div>

        <div className="mqtt-config">
          <div className="config-row">
            <label>Host</label>
            <input
              type="text"
              value={broker}
              onChange={e => setBroker(e.target.value)}
              disabled={connected}
              placeholder="localhost"
            />
          </div>
          <div className="config-row">
            <label>Port</label>
            <input
              type="number"
              value={port}
              onChange={e => setPort(Number(e.target.value))}
              disabled={connected}
              placeholder="1883"
            />
          </div>
        </div>

        <div className="mqtt-actions">
          {!connected ? (
            <button className="btn btn-primary btn-small" onClick={handleConnect}>
              <Play size={14} /> 连接
            </button>
          ) : (
            <button className="btn btn-ghost btn-small" onClick={handleDisconnect}>
              <Square size={14} /> 断开
            </button>
          )}
        </div>
      </div>

      <div className="panel-section">
        <h4>📤 手动发送任务</h4>
        <input
          type="text"
          value={taskTitle}
          onChange={e => setTaskTitle(e.target.value)}
          placeholder="任务标题..."
          className="mqtt-input"
        />
        <textarea
          value={taskDesc}
          onChange={e => setTaskDesc(e.target.value)}
          placeholder="任务描述..."
          rows={3}
          className="mqtt-textarea"
        />
        <button
          className="btn btn-primary btn-small"
          onClick={handleSendTask}
          disabled={!taskTitle.trim()}
          style={{ width: '100%', marginTop: 4 }}
        >
          <Send size={14} /> 发送
        </button>
      </div>

      {recentTasks.length > 0 && (
        <div className="panel-section">
          <h4>📋 最近任务 ({recentTasks.length})</h4>
          <div className="recent-tasks">
            {recentTasks.slice(0, 8).map(task => (
              <div key={task.id} className={`recent-task-item priority-${task.priority}`}>
                <span className="task-priority-dot" />
                <span className="task-title-text">{task.title}</span>
                <span className="task-time">
                  {new Date(task.received_at * 1000).toLocaleTimeString('zh-CN')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
