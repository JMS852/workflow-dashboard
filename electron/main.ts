const { app, BrowserWindow, ipcMain, dialog } = require('electron');
import * as path from 'path';
import * as fs from 'fs';
const { watch } = require('chokidar');
import type { FSWatcher } from 'chokidar';

let mainWindow: typeof BrowserWindow | null = null;
let watcher: FSWatcher | null = null;
let watchDir: string = '';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Workflow Dashboard',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: undefined,
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startWatching(dir: string) {
  if (watcher) {
    watcher.close();
  }

  const workflowDir = path.join(dir, '.multi-ai-workflow');
  if (!fs.existsSync(workflowDir)) {
    fs.mkdirSync(workflowDir, { recursive: true });
  }

  watchDir = dir;

  watcher = watch(workflowDir, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  watcher.on('add', (filePath: string) => {
    if (filePath.endsWith('.md')) {
      mainWindow?.webContents.send('file-added', {
        path: filePath,
        name: path.relative(workflowDir, filePath),
        time: new Date().toISOString(),
      });
    }
  });

  watcher.on('change', (filePath: string) => {
    if (filePath.endsWith('.md')) {
      mainWindow?.webContents.send('file-changed', {
        path: filePath,
        name: path.relative(workflowDir, filePath),
        time: new Date().toISOString(),
      });
    }
  });

  watcher.on('unlink', (filePath: string) => {
    if (filePath.endsWith('.md')) {
      mainWindow?.webContents.send('file-removed', {
        path: filePath,
        name: path.relative(workflowDir, filePath),
      });
    }
  });

  return workflowDir;
}

function scanDirectory(dir: string) {
  const workflowDir = path.join(dir, '.multi-ai-workflow');
  if (!fs.existsSync(workflowDir)) {
    return [];
  }

  const files: Array<{ path: string; name: string; size: number; mtime: string }> = [];
  const walkDir = (d: string) => {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.name.endsWith('.md')) {
        const stat = fs.statSync(fullPath);
        files.push({
          path: fullPath,
          name: path.relative(workflowDir, fullPath),
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        });
      }
    }
  };
  walkDir(workflowDir);
  return files;
}

// IPC Handlers
ipcMain.handle('select-project', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: '选择项目目录',
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  const dir = result.filePaths[0];
  const workflowDir = startWatching(dir);
  const files = scanDirectory(dir);

  return {
    projectDir: dir,
    workflowDir,
    projectName: path.basename(dir),
    files,
  };
});

ipcMain.handle('open-project', async (_event, dir: string) => {
  if (!fs.existsSync(dir)) {
    return { error: '目录不存在' };
  }

  const workflowDir = startWatching(dir);
  const files = scanDirectory(dir);

  return {
    projectDir: dir,
    workflowDir,
    projectName: path.basename(dir),
    files,
  };
});

ipcMain.handle('read-file', async (_event, filePath: string) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { content, path: filePath };
  } catch (err: any) {
    return { error: err.message };
  }
});

ipcMain.handle('write-file', async (_event, filePath: string, content: string) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true };
  } catch (err: any) {
    return { error: err.message };
  }
});

ipcMain.handle('append-to-file', async (_event, filePath: string, text: string) => {
  try {
    fs.appendFileSync(filePath, text, 'utf-8');
    return { success: true };
  } catch (err: any) {
    return { error: err.message };
  }
});

ipcMain.handle('get-file-info', async (_event, filePath: string) => {
  try {
    const stat = fs.statSync(filePath);
    const name = path.basename(filePath);
    return { name, path: filePath, size: stat.size, mtime: stat.mtime.toISOString() };
  } catch (err: any) {
    return { error: err.message };
  }
});

ipcMain.handle('open-file-externally', async (_event, filePath: string) => {
  const { shell } = require('electron');
  await shell.openPath(filePath);
});

// Detect file type for decision panel
ipcMain.handle('detect-file-type', async (_event, fileName: string) => {
  const name = fileName.toLowerCase();
  if (name.includes('checkpoint') || name.includes('检查点')) return 'checkpoint';
  if (name.includes('handoff') || name.includes('payload')) return 'handoff';
  if (name.includes('stage_gate') || name.includes('阀门') || name.includes('gate')) return 'stage_gate';
  if (name.includes('decision') || name.includes('决策')) return 'decision';
  if (name.includes('项目状态')) return 'project_status';
  if (name.includes('recovery')) return 'recovery';
  return 'generic';
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (watcher) watcher.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
