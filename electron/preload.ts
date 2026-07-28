const { contextBridge, ipcRenderer } = require('electron');
import type { IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // File operations
  selectProject: () => ipcRenderer.invoke('select-project'),
  openProject: (dir: string) => ipcRenderer.invoke('open-project', dir),
  readFile: (path: string) => ipcRenderer.invoke('read-file', path),
  writeFile: (path: string, content: string) => ipcRenderer.invoke('write-file', path, content),
  appendToFile: (path: string, text: string) => ipcRenderer.invoke('append-to-file', path, text),
  getFileInfo: (path: string) => ipcRenderer.invoke('get-file-info', path),
  openFileExternally: (path: string) => ipcRenderer.invoke('open-file-externally', path),
  detectFileType: (name: string) => ipcRenderer.invoke('detect-file-type', name),

  // File watcher events
  onFileAdded: (callback: (data: any) => void) => {
    ipcRenderer.on('file-added', (_event: IpcRendererEvent, data: any) => callback(data));
  },
  onFileChanged: (callback: (data: any) => void) => {
    ipcRenderer.on('file-changed', (_event: IpcRendererEvent, data: any) => callback(data));
  },
  onFileRemoved: (callback: (data: any) => void) => {
    ipcRenderer.on('file-removed', (_event: IpcRendererEvent, data: any) => callback(data));
  },

  // MQTT Bridge
  bridgeStartMqtt: (config: object) => ipcRenderer.invoke('bridge-start-mqtt', config),
  bridgeStopMqtt: () => ipcRenderer.invoke('bridge-stop-mqtt'),
  bridgeExecuteTask: (taskData: object) => ipcRenderer.invoke('bridge-execute-task', taskData),
  bridgePublishMqtt: (data: object) => ipcRenderer.invoke('bridge-publish-mqtt', data),
  bridgeConfigureProvider: (data: object) => ipcRenderer.invoke('bridge-configure-provider', data),
  bridgeResumeTask: (taskId: string) => ipcRenderer.invoke('bridge-resume-task', { task_id: taskId }),
  bridgeListCheckpoints: () => ipcRenderer.invoke('bridge-list-checkpoints'),
  bridgeDeleteCheckpoint: (taskId: string) => ipcRenderer.invoke('bridge-delete-checkpoint', { task_id: taskId }),

  // Bridge events
  onBridgeReady: (callback: (data: any) => void) => {
    ipcRenderer.on('bridge-ready', (_event: IpcRendererEvent, data: any) => callback(data));
  },
  onBridgeError: (callback: (data: any) => void) => {
    ipcRenderer.on('bridge-error', (_event: IpcRendererEvent, data: any) => callback(data));
  },
  onMqttStatus: (callback: (data: any) => void) => {
    ipcRenderer.on('mqtt-status', (_event: IpcRendererEvent, data: any) => callback(data));
  },
  onMqttTask: (callback: (data: any) => void) => {
    ipcRenderer.on('mqtt-task', (_event: IpcRendererEvent, data: any) => callback(data));
  },
  onTaskFileCreated: (callback: (data: any) => void) => {
    ipcRenderer.on('task-file-created', (_event: IpcRendererEvent, data: any) => callback(data));
  },
  onTaskExecutionStarted: (callback: (data: any) => void) => {
    ipcRenderer.on('task-execution-started', (_event: IpcRendererEvent, data: any) => callback(data));
  },
  onTaskExecuted: (callback: (data: any) => void) => {
    ipcRenderer.on('task-executed', (_event: IpcRendererEvent, data: any) => callback(data));
  },
  onTaskExecutionError: (callback: (data: any) => void) => {
    ipcRenderer.on('task-execution-error', (_event: IpcRendererEvent, data: any) => callback(data));
  },
  onTaskProgress: (callback: (data: any) => void) => {
    ipcRenderer.on('task_progress', (_event: IpcRendererEvent, data: any) => callback(data));
  },
  onCheckpointSaved: (callback: (data: any) => void) => {
    ipcRenderer.on('checkpoint_saved', (_event: IpcRendererEvent, data: any) => callback(data));
  },
  onCheckpointResumed: (callback: (data: any) => void) => {
    ipcRenderer.on('checkpoint_resumed', (_event: IpcRendererEvent, data: any) => callback(data));
  },
  onCheckpointsList: (callback: (data: any) => void) => {
    ipcRenderer.on('checkpoints_list', (_event: IpcRendererEvent, data: any) => callback(data));
  },

  removeAllListeners: () => {
    const channels = ipcRenderer.eventNames();
    for (const channel of channels) {
      ipcRenderer.removeAllListeners(channel as string);
    }
  },
});
