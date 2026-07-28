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

// ── Agent ──────────────────────────────────────────────────────

export type AgentType = 'claude' | 'codex';

export type AgentStatus = 'idle' | 'working' | 'done' | 'error';

export interface AgentConfig {
  id: string;
  type: AgentType;
  label: string;
  workDir: string;
  enabled: boolean;
  cliPath?: string;
}

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
  roundResults: Record<string, AgentResult[]>;
  agentStatuses: Record<string, AgentStatus>;
  error?: string;
}

export interface ConclusionTableData {
  round: number;
  table: string;
  results: AgentResult[];
}

export interface AgentStatusEvent {
  agentId: string;
  status: AgentStatus;
  round?: number;
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
      // File operations
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

      // Workflow
      workflowSubmitTask: (task: string) => Promise<{ success?: boolean; error?: string }>;
      workflowCancel: () => Promise<{ success: boolean }>;
      workflowGetStatus: () => Promise<WorkflowStatus>;

      onWorkflowStateChange: (cb: (data: WorkflowStatus) => void) => void;
      onWorkflowAgentStatus: (cb: (data: AgentStatusEvent) => void) => void;
      onWorkflowConclusionTable: (cb: (data: ConclusionTableData) => void) => void;
      onWorkflowDebateResult: (cb: (data: { results: AgentResult[]; summary: string }) => void) => void;
      onWorkflowFinalDecision: (cb: (data: { results: AgentResult[]; decision: string }) => void) => void;
      onWorkflowError: (cb: (data: { error: string }) => void) => void;

      // Agent
      agentRegister: (config: AgentConfig) => Promise<{ success: boolean }>;
      agentUnregister: (agentId: string) => Promise<{ success: boolean }>;
      agentList: () => Promise<AgentConfig[]>;
      agentCheckAvailability: () => Promise<Record<string, boolean>>;
      agentUpdateConfig: (config: AgentConfig) => Promise<{ success: boolean }>;

      // Core
      onCoreReady: (cb: (data: { claudeAvailable: Record<string, boolean> }) => void) => void;

      removeAllListeners: () => void;
    };
  }
}
