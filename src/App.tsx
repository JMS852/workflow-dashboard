import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { ProjectInfo, FileEntry, FileContent, FileType, Notification } from './types';
import FileTree from './components/FileTree';
import ContentViewer from './components/ContentViewer';
import DecisionPanel from './components/DecisionPanel';
import NotificationBar from './components/NotificationBar';
import { FileText, FolderOpen, RefreshCw } from 'lucide-react';

export default function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [fileType, setFileType] = useState<FileType>('generic');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [userInput, setUserInput] = useState('');
  const [decisionFeedback, setDecisionFeedback] = useState<string | null>(null);
  const notifIdRef = useRef(0);

  const addNotification = useCallback((type: Notification['type'], fileName: string) => {
    const id = ++notifIdRef.current;
    const n: Notification = {
      id,
      type,
      fileName,
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      read: false,
    };
    setNotifications(prev => [n, ...prev].slice(0, 20));
  }, []);

  const refreshFiles = useCallback(async (dir: string) => {
    if (!window.electronAPI) return;
    const result = await window.electronAPI.openProject(dir);
    if ('error' in result) return;
    setFiles(result.files);
    setProject(result);
  }, []);

  const selectProject = useCallback(async () => {
    if (!window.electronAPI) return;
    setLoading(true);
    const result = await window.electronAPI.selectProject();
    if (result) {
      setProject(result);
      setFiles(result.files);
      setSelectedFile(null);
      setFileContent('');
    }
    setLoading(false);
  }, []);

  const selectFile = useCallback(async (file: FileEntry) => {
    if (!window.electronAPI) return;
    setSelectedFile(file);
    const result = await window.electronAPI.readFile(file.path);
    if (result.content !== undefined) {
      setFileContent(result.content);
    } else {
      setFileContent(`⚠️ 读取失败: ${result.error}`);
    }
    const type = await window.electronAPI.detectFileType(file.name);
    setFileType(type);
    setDecisionFeedback(null);
  }, []);

  const handleDecision = useCallback(async (action: string, reason: string) => {
    if (!selectedFile || !window.electronAPI) return;

    const block = `\n\n---\n\n【用户补充意见】\n- 我的决定：${action}\n- 我的理由：${reason || '无'}\n- 时间：${new Date().toLocaleString('zh-CN')}\n`;

    const result = await window.electronAPI.appendToFile(selectedFile.path, block);
    if (result.success) {
      setDecisionFeedback(`✅ 已写入: ${action}`);
      setTimeout(() => setDecisionFeedback(null), 3000);
      // Refresh file content
      const updated = await window.electronAPI.readFile(selectedFile.path);
      if (updated.content !== undefined) {
        setFileContent(updated.content);
      }
    } else {
      setDecisionFeedback(`❌ 写入失败: ${result.error}`);
    }
  }, [selectedFile]);

  const handleAppendNote = useCallback(async () => {
    if (!selectedFile || !userInput.trim() || !window.electronAPI) return;
    const block = `\n\n---\n\n【用户批注】\n${userInput.trim()}\n- 时间：${new Date().toLocaleString('zh-CN')}\n`;
    const result = await window.electronAPI.appendToFile(selectedFile.path, block);
    if (result.success) {
      setUserInput('');
      setDecisionFeedback('✅ 批注已写入');
      setTimeout(() => setDecisionFeedback(null), 3000);
      const updated = await window.electronAPI.readFile(selectedFile.path);
      if (updated.content !== undefined) {
        setFileContent(updated.content);
      }
    }
  }, [selectedFile, userInput]);

  // Setup file watcher listeners
  useEffect(() => {
    if (!window.electronAPI) return;

    window.electronAPI.onFileAdded((data) => {
      addNotification('added', data.name);
      if (project) refreshFiles(project.projectDir);
    });

    window.electronAPI.onFileChanged((data) => {
      addNotification('changed', data.name);
      if (project) refreshFiles(project.projectDir);
      // If currently viewing this file, refresh it
      if (selectedFile && data.path === selectedFile.path) {
        window.electronAPI.readFile(data.path).then((result) => {
          if (result.content !== undefined) {
            setFileContent(result.content);
          }
        });
      }
    });

    window.electronAPI.onFileRemoved((data) => {
      addNotification('removed', data.name);
      if (project) refreshFiles(project.projectDir);
    });

    return () => {
      window.electronAPI.removeAllListeners();
    };
  }, [project, selectedFile, addNotification, refreshFiles]);

  const dismissNotification = useCallback((id: number) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const getStageLabel = () => {
    if (!project) return '';
    try {
      const match = fileContent.match(/当前阶段[：:]\s*(.+)/);
      return match ? match[1].trim() : '';
    } catch { return ''; }
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">Workflow Dashboard</h1>
          {project && (
            <span className="project-badge">
              <FolderOpen size={14} />
              {project.projectName}
            </span>
          )}
          {project && getStageLabel() && (
            <span className="stage-badge">{getStageLabel()}</span>
          )}
        </div>
        <div className="header-right">
          {project && (
            <button className="btn btn-ghost" onClick={() => refreshFiles(project.projectDir)} title="刷新">
              <RefreshCw size={16} />
            </button>
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
            <FileText size={48} strokeWidth={1} />
            <h2>Multi-AI Workflow Dashboard</h2>
            <p>选择一个包含 <code>.multi-ai-workflow</code> 目录的项目，开始监控和决策。</p>
            <p className="hint">按 multi-ai-workflow 工作流运行的项目会自动生成工作文件。</p>
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
          <aside className="sidebar">
            <FileTree
              files={files}
              selectedFile={selectedFile}
              onSelectFile={selectFile}
              projectDir={project.projectDir}
            />
          </aside>

          <main className="viewer">
            {selectedFile ? (
              <>
                <div className="viewer-header">
                  <span className="viewer-filename">{selectedFile.name}</span>
                  <span className="viewer-meta">
                    {new Date(selectedFile.mtime).toLocaleString('zh-CN')}
                  </span>
                </div>
                <ContentViewer content={fileContent} />
              </>
            ) : (
              <div className="viewer-empty">
                <FileText size={40} strokeWidth={1} />
                <p>从左侧选择一个文件查看</p>
              </div>
            )}
          </main>

          <aside className="decision-panel">
            {selectedFile ? (
              <>
                <DecisionPanel
                  fileType={fileType}
                  fileName={selectedFile.name}
                  onDecision={handleDecision}
                  feedback={decisionFeedback}
                />
                <div className="user-note">
                  <h4>📝 我的批注</h4>
                  <textarea
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    placeholder="写下你的批注或指令，将追加到文件末尾..."
                    rows={4}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={handleAppendNote}
                    disabled={!userInput.trim()}
                    style={{ marginTop: 8, width: '100%' }}
                  >
                    写入批注
                  </button>
                </div>
                <div className="panel-footer">
                  <button
                    className="btn btn-ghost"
                    onClick={() => selectedFile && window.electronAPI?.openFileExternally(selectedFile.path)}
                    style={{ width: '100%', marginTop: 8 }}
                  >
                    在外部编辑器打开
                  </button>
                </div>
              </>
            ) : (
              <div className="panel-empty">
                <p>选择文件后可做决策</p>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
