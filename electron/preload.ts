import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // ── File operations ───────────────────────────────────────

  selectProject: () => ipcRenderer.invoke('select-project'),
  openProject: (dir: string) => ipcRenderer.invoke('open-project', dir),
  readFile: (fPath: string) => ipcRenderer.invoke('read-file', fPath),
  writeFile: (fPath: string, content: string) => ipcRenderer.invoke('write-file', fPath, content),
  appendToFile: (fPath: string, text: string) => ipcRenderer.invoke('append-to-file', fPath, text),
  getFileInfo: (fPath: string) => ipcRenderer.invoke('get-file-info', fPath),
  openFileExternally: (fPath: string) => ipcRenderer.invoke('open-file-externally', fPath),
  detectFileType: (name: string) => ipcRenderer.invoke('detect-file-type', name),

  // File watcher events
  onFileAdded: (cb: (data: any) => void) => {
    ipcRenderer.on('file-added', (_e: IpcRendererEvent, d: any) => cb(d));
  },
  onFileChanged: (cb: (data: any) => void) => {
    ipcRenderer.on('file-changed', (_e: IpcRendererEvent, d: any) => cb(d));
  },
  onFileRemoved: (cb: (data: any) => void) => {
    ipcRenderer.on('file-removed', (_e: IpcRendererEvent, d: any) => cb(d));
  },

  // ── Workflow ──────────────────────────────────────────────

  workflowSubmitTask: (task: string) => ipcRenderer.invoke('workflow-submit-task', task),
  workflowCancel: () => ipcRenderer.invoke('workflow-cancel'),
  workflowGetStatus: () => ipcRenderer.invoke('workflow-get-status'),

  // Workflow events
  onWorkflowStateChange: (cb: (data: any) => void) => {
    ipcRenderer.on('workflow-state-change', (_e: IpcRendererEvent, d: any) => cb(d));
  },
  onWorkflowAgentStatus: (cb: (data: any) => void) => {
    ipcRenderer.on('workflow-agent-status', (_e: IpcRendererEvent, d: any) => cb(d));
  },
  onWorkflowConclusionTable: (cb: (data: any) => void) => {
    ipcRenderer.on('workflow-conclusion-table', (_e: IpcRendererEvent, d: any) => cb(d));
  },
  onWorkflowDebateResult: (cb: (data: any) => void) => {
    ipcRenderer.on('workflow-debate-result', (_e: IpcRendererEvent, d: any) => cb(d));
  },
  onWorkflowFinalDecision: (cb: (data: any) => void) => {
    ipcRenderer.on('workflow-final-decision', (_e: IpcRendererEvent, d: any) => cb(d));
  },
  onWorkflowError: (cb: (data: any) => void) => {
    ipcRenderer.on('workflow-error', (_e: IpcRendererEvent, d: any) => cb(d));
  },

  // ── Agent ─────────────────────────────────────────────────

  agentRegister: (config: object) => ipcRenderer.invoke('agent-register', config),
  agentUnregister: (agentId: string) => ipcRenderer.invoke('agent-unregister', agentId),
  agentList: () => ipcRenderer.invoke('agent-list'),
  agentCheckAvailability: () => ipcRenderer.invoke('agent-check-availability'),
  agentUpdateConfig: (config: object) => ipcRenderer.invoke('agent-update-config', config),

  // Core events
  onCoreReady: (cb: (data: any) => void) => {
    ipcRenderer.on('core-ready', (_e: IpcRendererEvent, d: any) => cb(d));
  },

  // ── Cleanup ───────────────────────────────────────────────

  removeAllListeners: () => {
    const channels = ipcRenderer.eventNames();
    for (const channel of channels) {
      ipcRenderer.removeAllListeners(channel as string);
    }
  },
});
