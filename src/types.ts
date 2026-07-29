// ── Project / File ────────────────────────────────────────────

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

// ── AI Selection (v3) ────────────────────────────────────────

export type AIToolType = 'claude' | 'codex';

export interface AIToolSelection {
  type: AIToolType;
  count: number;
}

export interface AILaunchConfig {
  projectDir: string;
  tools: AIToolSelection[];
}

export interface AiWindowInfo {
  id: string;
  type: AIToolType;
  label: string;
  sessionId: string;
}

// ── Messenger (v3) ───────────────────────────────────────────

export interface ConclusionResult {
  windowId: string;
  label: string;
  type: AIToolType;
  conclusion: string;
  fullOutput: string;
}

export interface MessengerConfig {
  apiKey: string;
  model?: string;
}

export interface ConclusionDetectedEvent {
  windowId: string;
  label: string;
  conclusion: string;
  round: number;
}

// ── Round Result (actual data from PTY workflow engine) ──────

export interface RoundResult {
  instanceId: string;
  label: string;
  type: AIToolType;
  conclusion: string;
  fullOutput: string;
}

// ── Agent Result (kept for compatibility) ────────────────────

export interface AgentResult {
  agentId: string;
  round: number;
  fullOutput: string;
  conclusion: string;
  durationMs: number;
  error?: string;
}

// ── Workflow ───────────────────────────────────────────────────

export type WorkflowState =
  | 'idle'
  | 'round_1_produce'
  | 'round_2_debate'
  | 'round_3_decide'
  | 'complete';

export interface WorkflowStatus {
  state: WorkflowState;
  currentTask: string | null;
  currentRound: number;
  roundResults: Record<string, RoundResult[]>;
  error?: string;
}

export interface ConclusionTableData {
  round: number;
  table: string;
  results: RoundResult[];
}

export interface RoundProgressEvent {
  round: number;
  completedCount: number;
  totalCount: number;
  status: 'waiting' | 'processing' | 'done';
}

// ── Notification ──────────────────────────────────────────────

export interface Notification {
  id: number;
  type: 'added' | 'changed' | 'removed' | 'mqtt_task' | 'task_executed' | 'bridge_status' | 'checkpoint_saved' | 'workflow' | 'agent';
  fileName: string;
  time: string;
  read: boolean;
}

// ── Global window API ──────────────────────────────────────────

declare global {
  interface Window {
    electronAPI?: {
      // ── File operations ────────────────────────────────────
      selectProject: () => Promise<ProjectInfo | null>;
      openProject: (dir: string) => Promise<ProjectInfo | { error: string }>;
      readFile: (path: string) => Promise<FileContent>;
      writeFile: (path: string, content: string) => Promise<{ success?: boolean; error?: string }>;
      appendToFile: (path: string, text: string) => Promise<{ success?: boolean; error?: string }>;
      getFileInfo: (path: string) => Promise<FileEntry & { error?: string }>;
      openFileExternally: (path: string) => Promise<void>;
      detectFileType: (name: string) => Promise<FileType>;

      onFileAdded: (cb: (data: { path: string; name: string; time: string }) => void) => void;
      onFileChanged: (cb: (data: { path: string; name: string; time: string }) => void) => void;
      onFileRemoved: (cb: (data: { path: string; name: string }) => void) => void;

      // ── v3: AI Launch ──────────────────────────────────────
      launchAIs: (config: AILaunchConfig) => Promise<{ aiWindows: AiWindowInfo[]; error?: string }>;
      shutdownAIs: () => Promise<{ success: boolean }>;
      getAiWindows: () => Promise<AiWindowInfo[]>;
      focusAiWindow: (windowId: string) => Promise<{ success: boolean }>;
      injectToAiWindow: (windowId: string, message: string) => Promise<{ success: boolean }>;

      // ── v3: Messenger Config ───────────────────────────────
      configureMessenger: (config: MessengerConfig) => Promise<{ success: boolean }>;
      getMessengerConfig: () => Promise<MessengerConfig | null>;

      // ── v3: MQTT Config ────────────────────────────────────
      configureMqtt: (brokerUrl: string) => Promise<{ success: boolean; error?: string }>;
      getMqttStatus: () => Promise<{ connected: boolean; brokerUrl: string }>;

      // ── v3: MQTT task received ─────────────────────────────
      onMqttTaskReceived: (cb: (data: { id: string; title: string; description: string; receivedAt: string }) => void) => void;

      // ── Workflow ───────────────────────────────────────────
      workflowSubmitTask: (task: string) => Promise<{ success?: boolean; error?: string }>;
      workflowCancel: () => Promise<{ success: boolean }>;
      workflowGetStatus: () => Promise<WorkflowStatus>;

      onWorkflowStateChange: (cb: (data: WorkflowStatus) => void) => void;
      onWorkflowConclusionDetected: (cb: (data: ConclusionDetectedEvent) => void) => void;
      onWorkflowConclusionTable: (cb: (data: ConclusionTableData) => void) => void;
      onWorkflowRoundProgress: (cb: (data: RoundProgressEvent) => void) => void;
      onWorkflowDebateResult: (cb: (data: { results: RoundResult[]; summary: string }) => void) => void;
      onWorkflowFinalDecision: (cb: (data: { results: RoundResult[]; decision: string }) => void) => void;
      onWorkflowError: (cb: (data: { error: string }) => void) => void;

      // ── v3: PTY data (for AI windows) ──────────────────────
      onPtyData: (cb: (data: { data: string }) => void) => void;
      onPtyInfo: (cb: (data: { label: string; type: string; sessionId: string }) => void) => void;
      sendPtyInput: (windowId: string, data: string) => void;

      // ── Core ───────────────────────────────────────────────
      onCoreReady: (cb: (data: object) => void) => void;
      removeAllListeners: () => void;
    };
  }
}
