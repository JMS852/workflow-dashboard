const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectProject: () => ipcRenderer.invoke('select-project'),
  openProject: (dir: string) => ipcRenderer.invoke('open-project', dir),
  readFile: (path: string) => ipcRenderer.invoke('read-file', path),
  writeFile: (path: string, content: string) => ipcRenderer.invoke('write-file', path, content),
  appendToFile: (path: string, text: string) => ipcRenderer.invoke('append-to-file', path, text),
  getFileInfo: (path: string) => ipcRenderer.invoke('get-file-info', path),
  openFileExternally: (path: string) => ipcRenderer.invoke('open-file-externally', path),
  detectFileType: (name: string) => ipcRenderer.invoke('detect-file-type', name),

  onFileAdded: (callback: (data: any) => void) => {
    ipcRenderer.on('file-added', (_event, data) => callback(data));
  },
  onFileChanged: (callback: (data: any) => void) => {
    ipcRenderer.on('file-changed', (_event, data) => callback(data));
  },
  onFileRemoved: (callback: (data: any) => void) => {
    ipcRenderer.on('file-removed', (_event, data) => callback(data));
  },

  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('file-added');
    ipcRenderer.removeAllListeners('file-changed');
    ipcRenderer.removeAllListeners('file-removed');
  },
});
