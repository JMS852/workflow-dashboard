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
  type: 'added' | 'changed' | 'removed' | 'mqtt_task' | 'task_executed' | 'bridge_status';
  fileName: string;
  time: string;
  read: boolean;
}

// ── MQTT / Bridge types ──────────────────────────────────────

export interface MqttConfig {
  broker: string;
  port: number;
  task_topic: string;
  result_topic: string;
}

export interface MqttStatus {
  status: string;
  detail: string;
  ts: number;
}

export interface MqttTask {
  id: string;
  topic: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  raw: Record<string, any>;
  received_at: number;
}

export interface TaskProgress {
  task_id: string;
  stage: string;
  progress: number;
  message: string;
}

export interface TaskExecutionResult {
  task_id: string;
  execution_id: string;
  level: string;
  task_type: string;
  reference_results: number;
  passed: number;
  final_result: string;
  duration_ms: number;
  status: string;
  generated_files: string[];
  output_dir: string;
}

export interface TaskFlowItem {
  id: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  status: 'pending' | 'executing' | 'completed' | 'failed';
  receivedAt: number;
  completedAt?: number;
  result?: TaskExecutionResult;
  source: 'mqtt' | 'manual';
  topic?: string;
}

declare global {
  interface Window {
    electronAPI: {
      // File operations
      selectProject: () => Promise<ProjectInfo | null>;
      openProject: (dir: string) => Promise<ProjectInfo | { error: string }>;
      readFile: (path: string) => Promise<FileContent>;
      writeFile: (path: string, content: string) => Promise<{ success?: boolean; error?: string }>;
      appendToFile: (path: string, text: string) => Promise<{ success?: boolean; error?: string }>;
      getFileInfo: (path: string) => Promise<FileEntry & { error?: string }>;
      openFileExternally: (path: string) => Promise<void>;
      detectFileType: (name: string) => Promise<FileType>;

      // File watcher events
      onFileAdded: (callback: (data: { path: string; name: string; time: string }) => void) => void;
      onFileChanged: (callback: (data: { path: string; name: string; time: string }) => void) => void;
      onFileRemoved: (callback: (data: { path: string; name: string }) => void) => void;

      // Bridge commands
      bridgeStartMqtt: (config: MqttConfig) => Promise<{ success: boolean }>;
      bridgeStopMqtt: () => Promise<{ success: boolean }>;
      bridgeExecuteTask: (taskData: { title: string; description: string; priority?: string; id?: string }) => Promise<{ taskId: string }>;
      bridgePublishMqtt: (data: { topic: string; payload: object }) => Promise<{ success: boolean }>;
      bridgeConfigureProvider: (data: { provider: string; api_key: string; endpoint?: string; enabled?: boolean }) => Promise<{ success: boolean }>;

      // Bridge events
      onBridgeReady: (callback: (data: { version: string }) => void) => void;
      onBridgeError: (callback: (data: { error: string }) => void) => void;
      onMqttStatus: (callback: (data: MqttStatus) => void) => void;
      onMqttTask: (callback: (data: MqttTask) => void) => void;
      onTaskFileCreated: (callback: (data: { task_id: string; file: string; filename: string }) => void) => void;
      onTaskExecutionStarted: (callback: (data: { task_id: string }) => void) => void;
      onTaskExecuted: (callback: (data: TaskExecutionResult) => void) => void;
      onTaskExecutionError: (callback: (data: { task_id: string; error: string }) => void) => void;
      onTaskProgress: (callback: (data: TaskProgress) => void) => void;

      removeAllListeners: () => void;
    };
  }
}
