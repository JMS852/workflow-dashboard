import React from 'react';
import type { FileEntry } from '../types';
import { FileText, FolderOpen, FileCheck, FileWarning, FileEdit, ClipboardList, Settings } from 'lucide-react';

interface Props {
  files: FileEntry[];
  selectedFile: FileEntry | null;
  onSelectFile: (file: FileEntry) => void;
  projectDir: string;
}

const ICON_MAP: Record<string, React.ReactNode> = {
  checkpoint: <FileCheck size={14} />,
  handoff: <ClipboardList size={14} />,
  stage_gate: <FileWarning size={14} />,
  decision: <FileEdit size={14} />,
  project_status: <FolderOpen size={14} />,
  recovery: <Settings size={14} />,
  generic: <FileText size={14} />,
};

function getFileCategory(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('checkpoint') || n.includes('检查点')) return 'checkpoint';
  if (n.includes('handoff') || n.includes('payload')) return 'handoff';
  if (n.includes('stage_gate') || n.includes('阀门') || n.includes('gate')) return 'stage_gate';
  if (n.includes('decision') || n.includes('决策')) return 'decision';
  if (n.includes('项目状态')) return 'project_status';
  if (n.includes('recovery')) return 'recovery';
  return 'generic';
}

function getCategoryLabel(cat: string): string {
  const labels: Record<string, string> = {
    checkpoint: '检查点',
    handoff: '执行汇报',
    stage_gate: '阶段阀门',
    decision: '决策记录',
    project_status: '项目状态',
    recovery: '恢复入口',
    generic: '文档',
  };
  return labels[cat] || '文档';
}

function getCategoryColor(cat: string): string {
  const colors: Record<string, string> = {
    checkpoint: '#10b981',
    handoff: '#3b82f6',
    stage_gate: '#f59e0b',
    decision: '#8b5cf6',
    project_status: '#ef4444',
    recovery: '#6b7280',
    generic: '#9ca3af',
  };
  return colors[cat] || '#9ca3af';
}

export default function FileTree({ files, selectedFile, onSelectFile, projectDir }: Props) {
  // Group files by directory
  const grouped: Record<string, FileEntry[]> = {};
  for (const f of files) {
    const dir = f.name.includes('/') ? f.name.split('/').slice(0, -1).join('/') : '(root)';
    if (!grouped[dir]) grouped[dir] = [];
    grouped[dir].push(f);
  }

  const sortedFiles = [...files].sort((a, b) => b.mtime.localeCompare(a.mtime));

  return (
    <div className="file-tree">
      <div className="file-tree-header">
        <h3>📁 工作文件</h3>
        <span className="file-count">{files.length} 个文件</span>
      </div>
      <div className="file-tree-list">
        {sortedFiles.map((file) => {
          const cat = getFileCategory(file.name);
          const color = getCategoryColor(cat);
          const isSelected = selectedFile?.path === file.path;
          return (
            <div
              key={file.path}
              className={`file-item ${isSelected ? 'selected' : ''}`}
              onClick={() => onSelectFile(file)}
            >
              <span className="file-icon" style={{ color }}>
                {ICON_MAP[cat] || ICON_MAP.generic}
              </span>
              <div className="file-info">
                <span className="file-name">{file.name}</span>
                <span className="file-meta">
                  <span className="file-category" style={{ color }}>{getCategoryLabel(cat)}</span>
                  <span className="file-time">
                    {new Date(file.mtime).toLocaleString('zh-CN', {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </span>
              </div>
            </div>
          );
        })}
        {files.length === 0 && (
          <div className="file-tree-empty">
            <FileText size={24} strokeWidth={1} />
            <p>暂无工作文件</p>
            <p className="hint">运行 multi-ai-workflow 后将自动出现</p>
          </div>
        )}
      </div>
    </div>
  );
}
