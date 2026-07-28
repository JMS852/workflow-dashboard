export interface ProjectInfo {
  projectDir: string;
  workflowDir: string;
  projectName: string;
  files: FileEntry[];
}

export interface FileEntry {
  path: string;
  name: string;
  size: number;
  mtime: string;
}

export interface FileContent {
  content?: string;
  error?: string;
}

export type FileType = 'checkpoint' | 'handoff' | 'stage_gate' | 'decision' | 'project_status' | 'recovery' | 'generic';

export interface Decision {
  type: string;
  label: string;
  action: string;
}

export interface Notification {
  id: number;
  type: 'added' | 'changed' | 'removed';
  fileName: string;
  time: string;
  read: boolean;
}

declare global {
  interface Window {
    electronAPI: {
      selectProject: () => Promise<ProjectInfo | null>;
      openProject: (dir: string) => Promise<ProjectInfo | { error: string }>;
      readFile: (path: string) => Promise<FileContent>;
      writeFile: (path: string, content: string) => Promise<{ success?: boolean; error?: string }>;
      appendToFile: (path: string, text: string) => Promise<{ success?: boolean; error?: string }>;
      getFileInfo: (path: string) => Promise<FileEntry & { error?: string }>;
      openFileExternally: (path: string) => Promise<void>;
      detectFileType: (name: string) => Promise<FileType>;
      onFileAdded: (callback: (data: { path: string; name: string; time: string }) => void) => void;
      onFileChanged: (callback: (data: { path: string; name: string; time: string }) => void) => void;
      onFileRemoved: (callback: (data: { path: string; name: string }) => void) => void;
      removeAllListeners: () => void;
    };
  }
}
