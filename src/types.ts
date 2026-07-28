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
  type: 'added' | 'changed' | 'removed' | 'mqtt_task' | 'task_executed' | 'bridge_status' | 'checkpoint_saved';
  fileName: string;
  time: string;
  read: boolean;
}

// ── Checkpoint types ─────────────────────────────────────────

export interface CheckpointInfo {
  task_id: string;
  title: string;
  stage: string;
  saved_at: number;
  status: string;
}

export interface CheckpointDetail {
  task_id: string;
  title: string;
  stage: string;
  status: string;
  mode?: string;
  task_data?: Record<string, unknown>;
  saved_at?: number;
  saved_iso?: string;
  started_at?: number;
  result_summary?: Record<string, unknown>;
  error?: string;
}

// ── Pipeline types ───────────────────────────────────────────

export interface PipelineStageResult {
  stage: string;
  gate: 'pass' | 'reject';
  output_preview?: string;
}

export interface PipelineExecutionResult extends TaskExecutionResult {
  mode: 'pipeline';
  stages_total?: number;
  stages_passed?: number;
  stage_summaries?: PipelineStageResult[];
  all_passed?: boolean;
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
  raw: Record<string, unknown>;
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
    electronAPI?: {
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
      bridgeExecuteTask: (taskData: {
        title: string; description: string; priority?: string; id?: string;
        adversarial?: boolean; pipeline?: boolean; stages?: Array<{ name: string; prompt: string }>;
      }) => Promise<{ taskId: string }>;
      bridgePublishMqtt: (data: { topic: string; payload: object }) => Promise<{ success: boolean }>;
      bridgeConfigureProvider: (data: { provider: string; api_key: string; endpoint?: string; enabled?: boolean }) => Promise<{ success: boolean }>;
      bridgeResumeTask: (taskId: string) => Promise<{ success: boolean }>;
      bridgeListCheckpoints: () => Promise<{ checkpoints: CheckpointInfo[] }>;
      bridgeDeleteCheckpoint: (taskId: string) => Promise<{ success: boolean }>;

      // Bridge events
      onBridgeReady: (callback: (data: { version: string }) => void) => void;
      onBridgeError: (callback: (data: { error: string }) => void) => void;
      onMqttStatus: (callback: (data: MqttStatus) => void) => void;
      onMqttTask: (callback: (data: MqttTask) => void) => void;
      onTaskFileCreated: (callback: (data: { task_id: string; file: string; filename: string }) => void) => void;
      onTaskExecutionStarted: (callback: (data: { task_id: string; mode?: string }) => void) => void;
      onTaskExecuted: (callback: (data: TaskExecutionResult | PipelineExecutionResult) => void) => void;
      onTaskExecutionError: (callback: (data: { task_id: string; error: string }) => void) => void;
      onTaskProgress: (callback: (data: TaskProgress) => void) => void;
      onCheckpointSaved: (callback: (data: { task_id: string; file: string; stage: string }) => void) => void;
      onCheckpointResumed: (callback: (data: { task_id: string; stage: string; saved_at: string }) => void) => void;
      onCheckpointsList: (callback: (data: { checkpoints: CheckpointInfo[] }) => void) => void;

      removeAllListeners: () => void;
    };
  }
}
