const { contextBridge, ipcRenderer } = require('electron');

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
    ipcRenderer.on('file-added', (_event, data) => callback(data));
  },
  onFileChanged: (callback: (data: any) => void) => {
    ipcRenderer.on('file-changed', (_event, data) => callback(data));
  },
  onFileRemoved: (callback: (data: any) => void) => {
    ipcRenderer.on('file-removed', (_event, data) => callback(data));
  },

  // MQTT Bridge
  bridgeStartMqtt: (config: object) => ipcRenderer.invoke('bridge-start-mqtt', config),
  bridgeStopMqtt: () => ipcRenderer.invoke('bridge-stop-mqtt'),
  bridgeExecuteTask: (taskData: object) => ipcRenderer.invoke('bridge-execute-task', taskData),
  bridgePublishMqtt: (data: object) => ipcRenderer.invoke('bridge-publish-mqtt', data),
  bridgeConfigureProvider: (data: object) => ipcRenderer.invoke('bridge-configure-provider', data),

  // Bridge events
  onBridgeReady: (callback: (data: any) => void) => {
    ipcRenderer.on('bridge-ready', (_event, data) => callback(data));
  },
  onBridgeError: (callback: (data: any) => void) => {
    ipcRenderer.on('bridge-error', (_event, data) => callback(data));
  },
  onMqttStatus: (callback: (data: any) => void) => {
    ipcRenderer.on('mqtt-status', (_event, data) => callback(data));
  },
  onMqttTask: (callback: (data: any) => void) => {
    ipcRenderer.on('mqtt-task', (_event, data) => callback(data));
  },
  onTaskFileCreated: (callback: (data: any) => void) => {
    ipcRenderer.on('task-file-created', (_event, data) => callback(data));
  },
  onTaskExecutionStarted: (callback: (data: any) => void) => {
    ipcRenderer.on('task-execution-started', (_event, data) => callback(data));
  },
  onTaskExecuted: (callback: (data: any) => void) => {
    ipcRenderer.on('task-executed', (_event, data) => callback(data));
  },
  onTaskExecutionError: (callback: (data: any) => void) => {
    ipcRenderer.on('task-execution-error', (_event, data) => callback(data));
  },
  onTaskProgress: (callback: (data: any) => void) => {
    ipcRenderer.on('task_progress', (_event, data) => callback(data));
  },

  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('file-added');
    ipcRenderer.removeAllListeners('file-changed');
    ipcRenderer.removeAllListeners('file-removed');
    ipcRenderer.removeAllListeners('bridge-ready');
    ipcRenderer.removeAllListeners('bridge-error');
    ipcRenderer.removeAllListeners('mqtt-status');
    ipcRenderer.removeAllListeners('mqtt-task');
    ipcRenderer.removeAllListeners('task-file-created');
    ipcRenderer.removeAllListeners('task-execution-started');
    ipcRenderer.removeAllListeners('task-executed');
    ipcRenderer.removeAllListeners('task-execution-error');
    ipcRenderer.removeAllListeners('task_progress');
  },
});
