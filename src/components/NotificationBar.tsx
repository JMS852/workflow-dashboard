import React from 'react';
import type { Notification } from '../types';
import { Bell, FilePlus, FileEdit, FileMinus, X } from 'lucide-react';

interface Props {
  notifications: Notification[];
  onDismiss: (id: number) => void;
  onClearAll: () => void;
}

const TYPE_ICONS: Record<Notification['type'], React.ReactNode> = {
  added: <FilePlus size={14} />,
  changed: <FileEdit size={14} />,
  removed: <FileMinus size={14} />,
};

const TYPE_COLORS: Record<Notification['type'], string> = {
  added: '#10b981',
  changed: '#3b82f6',
  removed: '#ef4444',
};

const TYPE_LABELS: Record<Notification['type'], string> = {
  added: '新增',
  changed: '变更',
  removed: '删除',
};

export default function NotificationBar({ notifications, onDismiss, onClearAll }: Props) {
  const unread = notifications.filter(n => !n.read).length;

  return (
    <div className="notification-bar">
      <div className="notification-header">
        <Bell size={16} />
        <span>通知</span>
        {unread > 0 && <span className="badge">{unread}</span>}
        {notifications.length > 0 && (
          <button className="btn-clear" onClick={onClearAll}>清空</button>
        )}
      </div>
      <div className="notification-list">
        {notifications.length === 0 && (
          <span className="notification-empty">暂无通知</span>
        )}
        {notifications.map((n) => (
          <div key={n.id} className={`notification-item ${n.type}`}>
            <span className="notif-icon" style={{ color: TYPE_COLORS[n.type] }}>
              {TYPE_ICONS[n.type]}
            </span>
            <span className="notif-label">{TYPE_LABELS[n.type]}</span>
            <span className="notif-file">{n.fileName}</span>
            <span className="notif-time">{n.time}</span>
            <button className="notif-dismiss" onClick={() => onDismiss(n.id)}>
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
