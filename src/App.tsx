import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { ProjectInfo, FileEntry, FileType, Notification } from './types';
import FileTree from './components/FileTree';
import ContentViewer from './components/ContentViewer';
import NotificationBar from './components/NotificationBar';
import AISelector from './components/AISelector';
import WorkflowView from './components/WorkflowView';
import { FileText, FolderOpen, RefreshCw, Zap } from 'lucide-react';
import type { AiWindowInfo, AILaunchConfig } from './types';

export default function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [fileType, setFileType] = useState<FileType>('generic');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [showFilePanel, setShowFilePanel] = useState(false);
  const [aiWindows, setAiWindows] = useState<AiWindowInfo[]>([]);
  const [aiLaunched, setAiLaunched] = useState(false);
  const notifIdRef = useRef(0);
  const selectedFileRef = useRef<FileEntry | null>(null);
  selectedFileRef.current = selectedFile;

  const addNotification = useCallback((type: Notification['type'], fileName: string) => {
    const id = ++notifIdRef.current;
    setNotifications((prev) => [
      { id, type, fileName, time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), read: false },
      ...prev,
    ].slice(0, 30));
  }, []);

  const refreshFiles = useCallback(async (dir: string) => {
    const api = window.electronAPI;
    if (!api) return;
    const result = await api.openProject(dir);
    if ('error' in result) return;
    setFiles(result.files);
    setProject(result);
  }, []);

  const selectProject = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    setLoading(true);
    const result = await api.selectProject();
    if (result) {
      setProject(result);
      setFiles(result.files);
      setSelectedFile(null);
      setFileContent('');
    }
    setLoading(false);
  }, []);

  const handleLaunchAIs = useCallback(async (config: AILaunchConfig) => {
    const api = window.electronAPI;
    if (!api) return;
    const result = await api.launchAIs(config);
    if (result.aiWindows) {
      setAiWindows(result.aiWindows);
      setAiLaunched(true);
      addNotification('workflow', `已启动 ${result.aiWindows.length} 个 AI 窗口`);
    }
    if (result.error) {
      addNotification('agent', `启动失败: ${result.error}`);
    }
  }, [addNotification]);

  const handleShutdownAIs = useCallback(async () => {
    const api = window.electronAPI;
    if (!api) return;
    await api.shutdownAIs();
    setAiWindows([]);
    setAiLaunched(false);
    addNotification('workflow', '所有 AI 窗口已关闭');
  }, [addNotification]);

  const selectFile = useCallback(async (file: FileEntry) => {
    const api = window.electronAPI;
    if (!api) return;
    setSelectedFile(file);
    const result = await api.readFile(file.path);
    if (result.content !== undefined) {
      setFileContent(result.content);
    } else {
      setFileContent(`⚠️ 读取失败: ${result.error}`);
    }
    const type = await api.detectFileType(file.name);
    setFileType(type);
  }, []);

  // Setup file watcher listeners
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    api.onFileAdded((data) => {
      addNotification('added', data.name);
      if (project) refreshFiles(project.projectDir);
    });

    api.onFileChanged((data) => {
      addNotification('changed', data.name);
      if (project) refreshFiles(project.projectDir);
      const current = selectedFileRef.current;
      if (current && data.path === current.path) {
        api.readFile(data.path).then((result) => {
          if (result.content !== undefined) setFileContent(result.content);
        });
      }
    });

    api.onFileRemoved((data) => {
      addNotification('removed', data.name);
      if (project) refreshFiles(project.projectDir);
    });

    return () => {
      api.removeAllListeners();
    };
  }, [project, refreshFiles, addNotification]);

  // Listen for workflow events → notifications
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    api.onWorkflowStateChange((data) => {
      addNotification('workflow', `状态: ${data.state}`);
    });

    api.onWorkflowError((data) => {
      addNotification('agent', `错误: ${data.error}`);
    });
  }, [addNotification]);

  const dismissNotification = useCallback((id: number) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">
            <Zap size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Workflow Dashboard
          </h1>
          {project && (
            <span className="project-badge">
              <FolderOpen size={14} />
              {project.projectName}
            </span>
          )}
        </div>
        <div className="header-right">
          {project && (
            <>
              <button
                className={`btn btn-ghost ${showFilePanel ? 'active' : ''}`}
                onClick={() => setShowFilePanel(!showFilePanel)}
                title="文件面板"
              >
                <FileText size={16} />
              </button>
              <button className="btn btn-ghost" onClick={() => refreshFiles(project.projectDir)} title="刷新">
                <RefreshCw size={16} />
              </button>
            </>
          )}
          <button className="btn btn-primary" onClick={selectProject} disabled={loading}>
            <FolderOpen size={16} />
            {loading ? '加载中...' : project ? '切换项目' : '打开项目'}
          </button>
        </div>
      </header>

      {/* Notifications */}
      <NotificationBar
        notifications={notifications}
        onDismiss={dismissNotification}
        onClearAll={() => setNotifications([])}
      />

      {/* Welcome screen */}
      {!project && (
        <div className="welcome">
          <div className="welcome-card">
            <Zap size={48} strokeWidth={1} />
            <h2>Workflow Dashboard — 信差平台</h2>
            <p>打开项目目录，注册 Claude Code / Codex Agent，开始多 Agent 协作。</p>
            <p className="hint">Agents 会各自产出一个简洁结论，然后互相辩论，最终做出决策。</p>
            <div className="welcome-config">
              <div className="config-item">
                <label>🔑 DeepSeek API Key（信差大脑）</label>
                <input
                  type="password"
                  placeholder="sk-..."
                  style={{ width: '100%', padding: '6px 10px', background: '#0d1117', border: '1px solid #30363d', borderRadius: '4px', color: '#c9d1d9', fontSize: '13px' }}
                  onBlur={(e) => {
                    if (e.target.value.length > 10) {
                      window.electronAPI?.configureMessenger({ apiKey: e.target.value });
                    }
                  }}
                />
              </div>
              <div className="config-item">
                <label>📡 MQTT Broker（可选）</label>
                <input
                  placeholder="mqtt://localhost:1883"
                  style={{ width: '100%', padding: '6px 10px', background: '#0d1117', border: '1px solid #30363d', borderRadius: '4px', color: '#c9d1d9', fontSize: '13px' }}
                  onBlur={(e) => {
                    if (e.target.value) {
                      window.electronAPI?.configureMqtt(e.target.value);
                    }
                  }}
                />
              </div>
            </div>
            <button className="btn btn-primary btn-large" onClick={selectProject}>
              <FolderOpen size={20} />
              选择项目目录
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      {project && (
        <div className="main-content">
          {/* File panel (togglable) */}
          {showFilePanel && (
            <aside className="sidebar">
              <FileTree
                files={files}
                selectedFile={selectedFile}
                onSelectFile={selectFile}
                projectDir={project.projectDir}
              />
            </aside>
          )}

          {/* Center: Workflow or File viewer */}
          <main className="center-panel">
            {selectedFile ? (
              <>
                <div className="viewer-header">
                  <span className="viewer-filename">{selectedFile.name}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setSelectedFile(null)}>
                    关闭
                  </button>
                </div>
                <ContentViewer content={fileContent} />
              </>
            ) : (
              <WorkflowView />
            )}
          </main>

          {/* Right: AI Selector */}
          <aside className="right-sidebar">
            <AISelector
              projectDir={project?.projectDir || null}
              onSelectProject={selectProject}
              onLaunch={handleLaunchAIs}
              onShutdown={handleShutdownAIs}
              aiWindows={aiWindows}
              launched={aiLaunched}
            />
          </aside>
        </div>
      )}
    </div>
  );
}
