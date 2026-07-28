const { app, BrowserWindow, ipcMain, dialog } = require('electron');
import * as path from 'path';
import * as fs from 'fs';
import { ChildProcess, spawn } from 'child_process';
const { watch } = require('chokidar');
import type { FSWatcher } from 'chokidar';

let mainWindow: typeof BrowserWindow | null = null;
let watcher: FSWatcher | null = null;
let watchDir: string = '';
let bridgeProcess: ChildProcess | null = null;
let bridgeReady = false;
let pendingBridgeCallbacks: Array<() => void> = [];

// ── Python Bridge ─────────────────────────────────────────────

function getPythonPath(): string {
  // Use the project's venv Python
  const venvPython = path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(venvPython)) return venvPython;

  // Fallback: system Python
  const systemPython = path.join(
    process.env.LOCALAPPDATA || '',
    'Programs', 'Python', 'Python312', 'python.exe'
  );
  if (fs.existsSync(systemPython)) return systemPython;
  return 'python';
}

function startBridge(projectDir?: string) {
  if (bridgeProcess) {
    bridgeProcess.kill();
    bridgeProcess = null;
    bridgeReady = false;
  }

  const pythonPath = getPythonPath();
  const bridgeScript = path.join(__dirname, '..', 'engine', 'bridge.py');

  console.log(`[Main] Starting bridge: ${pythonPath} ${bridgeScript}`);

  bridgeProcess = spawn(pythonPath, [bridgeScript], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });

  let buffer = '';

  bridgeProcess.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf-8');
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        handleBridgeMessage(msg);
      } catch {
        // Skip non-JSON lines
      }
    }
  });

  bridgeProcess.stderr?.on('data', (chunk: Buffer) => {
    console.error('[Bridge stderr]', chunk.toString());
  });

  bridgeProcess.on('close', (code: number | null) => {
    console.log(`[Main] Bridge exited with code ${code}`);
    bridgeReady = false;
    bridgeProcess = null;
  });

  bridgeProcess.on('error', (err: Error) => {
    console.error('[Main] Bridge spawn error:', err.message);
    mainWindow?.webContents.send('bridge-error', { error: err.message });
  });

  // Wait for bridge_ready, then send project_dir
  const onReady = () => {
    if (projectDir) {
      sendToBridge({ action: 'set_project', data: { project_dir: projectDir } });
    }
  };

  if (bridgeReady) {
    onReady();
  } else {
    pendingBridgeCallbacks.push(onReady);
  }
}

function sendToBridge(msg: object) {
  if (bridgeProcess?.stdin?.writable) {
    const line = JSON.stringify(msg) + '\n';
    bridgeProcess.stdin.write(line);
  }
}

function handleBridgeMessage(msg: any) {
  const event = msg.event;
  const data = msg.data;

  switch (event) {
    case 'bridge_ready':
      bridgeReady = true;
      console.log('[Main] Bridge ready v' + data?.version);
      mainWindow?.webContents.send('bridge-ready', data);
      // Flush pending callbacks
      for (const cb of pendingBridgeCallbacks) cb();
      pendingBridgeCallbacks = [];
      break;

    case 'mqtt_status':
      mainWindow?.webContents.send('mqtt-status', data);
      break;

    case 'mqtt_task_received':
      mainWindow?.webContents.send('mqtt-task', data);
      break;

    case 'task_file_written':
      mainWindow?.webContents.send('task-file-created', data);
      break;

    case 'task_execution_started':
      mainWindow?.webContents.send('task-execution-started', data);
      break;

    case 'task_executed':
      mainWindow?.webContents.send('task-executed', data);
      break;

    case 'task_error':
      mainWindow?.webContents.send('task-execution-error', data);
      break;

    case 'pong':
    case 'mqtt_started':
    case 'mqtt_stopped':
    case 'mqtt_published':
    case 'mqtt_error':
    case 'provider_configured':
    case 'project_set':
      // Forward all bridge events to renderer
      mainWindow?.webContents.send(event, data);
      break;

    case 'task_progress':
      mainWindow?.webContents.send('task_progress', data);
      break;

    default:
      // Forward unknown events to renderer as-is
      mainWindow?.webContents.send(event, data);
  }
}

function stopBridge() {
  if (bridgeProcess) {
    sendToBridge({ action: 'stop_mqtt' });
    setTimeout(() => {
      bridgeProcess?.kill();
      bridgeProcess = null;
      bridgeReady = false;
    }, 500);
  }
}

// ── Window ────────────────────────────────────────────────────

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

// ── File Watcher ──────────────────────────────────────────────

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

// ── IPC Handlers ──────────────────────────────────────────────

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

  // Notify bridge of project change
  sendToBridge({ action: 'set_project', data: { project_dir: dir } });

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

  sendToBridge({ action: 'set_project', data: { project_dir: dir } });

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

ipcMain.handle('detect-file-type', async (_event, fileName: string) => {
  const name = fileName.toLowerCase();
  if (name.includes('checkpoint') || name.includes('检查点')) return 'checkpoint';
  if (name.includes('handoff') || name.includes('payload')) return 'handoff';
  if (name.includes('stage_gate') || name.includes('阀门') || name.includes('gate')) return 'stage_gate';
  if (name.includes('decision') || name.includes('决策')) return 'decision';
  if (name.includes('项目状态')) return 'project_status';
  if (name.includes('recovery')) return 'recovery';
  if (name.includes('task_')) return 'handoff'; // MQTT task files
  return 'generic';
});

// ── MQTT / Bridge IPC ─────────────────────────────────────────

ipcMain.handle('bridge-start-mqtt', async (_event, config: {
  broker?: string; port?: number; task_topic?: string; result_topic?: string;
}) => {
  if (!bridgeProcess) {
    startBridge(watchDir);
    // Wait briefly for bridge to be ready
    await new Promise<void>(resolve => {
      const check = () => {
        if (bridgeReady) resolve();
        else setTimeout(check, 100);
      };
      check();
    });
  }
  sendToBridge({
    action: 'start_mqtt',
    data: {
      broker: config.broker || 'localhost',
      port: config.port || 1883,
      task_topic: config.task_topic || 'workflow/tasks/#',
      result_topic: config.result_topic || 'workflow/results',
    },
  });
  return { success: true };
});

ipcMain.handle('bridge-stop-mqtt', async () => {
  sendToBridge({ action: 'stop_mqtt', data: {} });
  return { success: true };
});

ipcMain.handle('bridge-execute-task', async (_event, taskData: {
  title: string; description: string; priority?: string;
}) => {
  const taskId = `manual_${Date.now()}`;
  sendToBridge({
    action: 'execute_task',
    data: {
      id: taskId,
      title: taskData.title,
      description: taskData.description,
      priority: taskData.priority || 'medium',
    },
  });
  return { taskId };
});

ipcMain.handle('bridge-publish-mqtt', async (_event, data: {
  topic: string; payload: object;
}) => {
  sendToBridge({ action: 'publish_mqtt', data });
  return { success: true };
});

ipcMain.handle('bridge-configure-provider', async (_event, data: {
  provider: string; api_key: string; endpoint?: string; enabled?: boolean;
}) => {
  sendToBridge({ action: 'configure_provider', data });
  return { success: true };
});

// ── App Lifecycle ─────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  // Start bridge automatically
  startBridge();
});

app.on('window-all-closed', () => {
  stopBridge();
  if (watcher) watcher.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  stopBridge();
});
