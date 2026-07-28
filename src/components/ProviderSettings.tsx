import React, { useState, useEffect } from 'react';
import { Key, Eye, EyeOff, CheckCircle, XCircle, Settings } from 'lucide-react';

interface ProviderInfo {
  provider: string;
  label: string;
  color: string;
  configured: boolean;
}

const PROVIDERS: ProviderInfo[] = [
  { provider: 'deepseek', label: 'DeepSeek', color: '#6366f1', configured: false },
  { provider: 'qianwen', label: '通义千问', color: '#10b981', configured: false },
  { provider: 'doubao', label: '豆包', color: '#f59e0b', configured: false },
  { provider: 'hunyuan', label: '混元', color: '#ef4444', configured: false },
];

interface Props {
  onConfigured?: () => void;
}

export default function ProviderSettings({ onConfigured }: Props) {
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [configured, setConfigured] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const handleSaveKey = async (provider: string) => {
    const key = apiKeys[provider]?.trim();
    if (!key || !window.electronAPI) return;

    setSaving(provider);
    await window.electronAPI.bridgeConfigureProvider({
      provider,
      api_key: key,
      enabled: true,
    });

    setConfigured(prev => ({ ...prev, [provider]: true }));
    setSaving(null);
    onConfigured?.();
  };

  const toggleShowKey = (provider: string) => {
    setShowKeys(prev => ({ ...prev, [provider]: !prev[provider] }));
  };

  const configuredCount = Object.values(configured).filter(Boolean).length;

  return (
    <div className="provider-settings">
      <div className="panel-section">
        <h4>
          <Settings size={16} />
          AI 提供商配置
        </h4>
        <p className="hint" style={{ marginBottom: 12 }}>
          配置至少一个 AI 提供商以启用任务执行。
          {configuredCount > 0 && (
            <span style={{ color: '#10b981', marginLeft: 8 }}>
              {configuredCount}/{PROVIDERS.length} 已配置
            </span>
          )}
        </p>

        {PROVIDERS.map(p => (
          <div key={p.provider} className="provider-row">
            <div className="provider-header">
              <span className="provider-dot" style={{ background: p.color }} />
              <span className="provider-name">{p.label}</span>
              {configured[p.provider] ? (
                <CheckCircle size={14} color="#10b981" />
              ) : (
                <XCircle size={14} color="#6b7280" />
              )}
            </div>
            <div className="provider-key-row">
              <input
                type={showKeys[p.provider] ? 'text' : 'password'}
                value={apiKeys[p.provider] || ''}
                onChange={e => setApiKeys(prev => ({ ...prev, [p.provider]: e.target.value }))}
                placeholder={`${p.label} API Key...`}
                className="key-input"
              />
              <button
                className="btn-icon-only"
                onClick={() => toggleShowKey(p.provider)}
                title={showKeys[p.provider] ? '隐藏' : '显示'}
              >
                {showKeys[p.provider] ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button
                className="btn btn-primary btn-small"
                onClick={() => handleSaveKey(p.provider)}
                disabled={!apiKeys[p.provider]?.trim() || saving === p.provider}
              >
                {saving === p.provider ? '...' : <Key size={14} />}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="panel-section">
        <h4>📋 使用说明</h4>
        <ul className="provider-help">
          <li>API Key 通过 Electron IPC → Python Bridge 注入</li>
          <li>Key 仅存在于当前会话，不会写入磁盘</li>
          <li>支持多个提供商同时配置，AI 路由自动选择可用提供商</li>
          <li>超时熔断：收齐 2 个参考 AI + 90s 熔断</li>
        </ul>
      </div>
    </div>
  );
}
