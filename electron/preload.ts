/**
 * preload.ts (v3) — contextBridge 安全暴露 IPC 接口
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // ── File operations ───────────────────────────────────────────
  selectProject: () => ipcRenderer.invoke('select-project'),
  openProject: (dir: string) => ipcRenderer.invoke('open-project', dir),
  readFile: (fPath: string) => ipcRenderer.invoke('read-file', fPath),
  writeFile: (fPath: string, content: string) => ipcRenderer.invoke('write-file', fPath, content),
  appendToFile: (fPath: string, text: string) => ipcRenderer.invoke('append-to-file', fPath, text),
  getFileInfo: (fPath: string) => ipcRenderer.invoke('get-file-info', fPath),
  openFileExternally: (fPath: string) => ipcRenderer.invoke('open-file-externally', fPath),
  detectFileType: (name: string) => ipcRenderer.invoke('detect-file-type', name),

  // File events
  onFileAdded: (cb: (data: any) => void) =>
    ipcRenderer.on('file-added', (_e: IpcRendererEvent, d: any) => cb(d)),
  onFileChanged: (cb: (data: any) => void) =>
    ipcRenderer.on('file-changed', (_e: IpcRendererEvent, d: any) => cb(d)),
  onFileRemoved: (cb: (data: any) => void) =>
    ipcRenderer.on('file-removed', (_e: IpcRendererEvent, d: any) => cb(d)),

  // ── v3: AI Launch ─────────────────────────────────────────────
  launchAIs: (config: object) => ipcRenderer.invoke('launch-ais', config),
  shutdownAIs: () => ipcRenderer.invoke('shutdown-ais'),
  getAiWindows: () => ipcRenderer.invoke('get-ai-windows'),
  focusAiWindow: (windowId: string) => ipcRenderer.invoke('focus-ai-window', windowId),
  injectToAiWindow: (windowId: string, message: string) =>
    ipcRenderer.invoke('inject-to-ai-window', windowId, message),

  // ── v3: Messenger ─────────────────────────────────────────────
  configureMessenger: (config: object) => ipcRenderer.invoke('configure-messenger', config),
  getMessengerConfig: () => ipcRenderer.invoke('get-messenger-config'),

  // ── v3: MQTT ──────────────────────────────────────────────────
  configureMqtt: (brokerUrl: string) => ipcRenderer.invoke('configure-mqtt', brokerUrl),
  getMqttStatus: () => ipcRenderer.invoke('get-mqtt-status'),

  // ── Workflow ──────────────────────────────────────────────────
  workflowSubmitTask: (task: string) => ipcRenderer.invoke('workflow-submit-task', task),
  workflowCancel: () => ipcRenderer.invoke('workflow-cancel'),
  workflowGetStatus: () => ipcRenderer.invoke('workflow-get-status'),

  onWorkflowStateChange: (cb: (data: any) => void) =>
    ipcRenderer.on('workflow-state-change', (_e: IpcRendererEvent, d: any) => cb(d)),
  onWorkflowConclusionDetected: (cb: (data: any) => void) =>
    ipcRenderer.on('workflow-conclusion-detected', (_e: IpcRendererEvent, d: any) => cb(d)),
  onWorkflowConclusionTable: (cb: (data: any) => void) =>
    ipcRenderer.on('workflow-conclusion-table', (_e: IpcRendererEvent, d: any) => cb(d)),
  onWorkflowRoundProgress: (cb: (data: any) => void) =>
    ipcRenderer.on('workflow-round-progress', (_e: IpcRendererEvent, d: any) => cb(d)),
  onWorkflowDebateResult: (cb: (data: any) => void) =>
    ipcRenderer.on('workflow-debate-result', (_e: IpcRendererEvent, d: any) => cb(d)),
  onWorkflowFinalDecision: (cb: (data: any) => void) =>
    ipcRenderer.on('workflow-final-decision', (_e: IpcRendererEvent, d: any) => cb(d)),
  onWorkflowError: (cb: (data: any) => void) =>
    ipcRenderer.on('workflow-error', (_e: IpcRendererEvent, d: any) => cb(d)),

  // ── v3: PTY data (for AI windows) ─────────────────────────────
  onPtyData: (cb: (data: any) => void) =>
    ipcRenderer.on('pty-data', (_e: IpcRendererEvent, d: any) => cb(d)),
  onPtyInfo: (cb: (data: any) => void) =>
    ipcRenderer.on('pty-info', (_e: IpcRendererEvent, d: any) => cb(d)),
  sendPtyInput: (windowId: string, data: string) => ipcRenderer.send('pty-input', { windowId, data }),

  // ── v3: MQTT task received ────────────────────────────────────
  onMqttTaskReceived: (cb: (data: any) => void) =>
    ipcRenderer.on('mqtt-task-received', (_e: IpcRendererEvent, d: any) => cb(d)),

  // ── Core ──────────────────────────────────────────────────────
  onCoreReady: (cb: (data: any) => void) =>
    ipcRenderer.on('core-ready', (_e: IpcRendererEvent, d: any) => cb(d)),

  removeAllListeners: () => {
    const channels = ipcRenderer.eventNames();
    for (const channel of channels) {
      ipcRenderer.removeAllListeners(channel as string);
    }
  },
});
