import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { watch, FSWatcher } from 'chokidar';
import type { IpcMainInvokeEvent } from 'electron';

import { SessionStore } from './session-store';
import { AgentManager, AgentConfig } from './agent-manager';
import { WorkflowEngine } from './workflow-engine';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let watcher: FSWatcher | null = null;
let watchDir: string = '';

// ── Core Services ──────────────────────────────────────────────

const sessionStore = new SessionStore(null);
const agentManager = new AgentManager(sessionStore);
const workflowEngine = new WorkflowEngine(agentManager);

// ── Workflow Event Forwarding ──────────────────────────────────

workflowEngine.on('state_change', (status) => {
  mainWindow?.webContents.send('workflow-state-change', status);
});

workflowEngine.on('agent_status_change', (data) => {
  mainWindow?.webContents.send('workflow-agent-status', data);
});

workflowEngine.on('conclusion_table_ready', (data) => {
  mainWindow?.webContents.send('workflow-conclusion-table', data);
});

workflowEngine.on('debate_result', (data) => {
  mainWindow?.webContents.send('workflow-debate-result', data);
});

workflowEngine.on('final_decision', (data) => {
  mainWindow?.webContents.send('workflow-final-decision', data);
});

workflowEngine.on('error', (data) => {
  mainWindow?.webContents.send('workflow-error', data);
});

// ── Window ────────────────────────────────────────────────────

function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');
  if (!fs.existsSync(iconPath)) return;

  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
  tray.setToolTip('Workflow Dashboard — 信差平台');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示/隐藏窗口',
      click: () => {
        if (mainWindow) {
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Workflow Dashboard',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

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
  sessionStore.setProjectDir(dir);

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
  if (!fs.existsSync(workflowDir)) return [];

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

// ── IPC: Project / File ────────────────────────────────────────

ipcMain.handle('select-project', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: '选择项目目录',
  });

  if (result.canceled || !result.filePaths[0]) return null;

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

ipcMain.handle('open-project', async (_event: IpcMainInvokeEvent, dir: string) => {
  if (!fs.existsSync(dir)) return { error: '目录不存在' };

  const workflowDir = startWatching(dir);
  const files = scanDirectory(dir);

  return {
    projectDir: dir,
    workflowDir,
    projectName: path.basename(dir),
    files,
  };
});

ipcMain.handle('read-file', async (_event: IpcMainInvokeEvent, filePath: string) => {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return { content, path: filePath };
  } catch (err: any) {
    return { error: err.message };
  }
});

ipcMain.handle('write-file', async (_event: IpcMainInvokeEvent, filePath: string, content: string) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true };
  } catch (err: any) {
    return { error: err.message };
  }
});

ipcMain.handle('append-to-file', async (_event: IpcMainInvokeEvent, filePath: string, text: string) => {
  try {
    fs.appendFileSync(filePath, text, 'utf-8');
    return { success: true };
  } catch (err: any) {
    return { error: err.message };
  }
});

ipcMain.handle('get-file-info', async (_event: IpcMainInvokeEvent, filePath: string) => {
  try {
    const stat = fs.statSync(filePath);
    const name = path.basename(filePath);
    return { name, path: filePath, size: stat.size, mtime: stat.mtime.toISOString() };
  } catch (err: any) {
    return { error: err.message };
  }
});

ipcMain.handle('open-file-externally', async (_event: IpcMainInvokeEvent, filePath: string) => {
  const { shell } = require('electron');
  await shell.openPath(filePath);
});

ipcMain.handle('detect-file-type', async (_event: IpcMainInvokeEvent, fileName: string) => {
  const name = fileName.toLowerCase();
  if (name.includes('checkpoint') || name.includes('检查点')) return 'checkpoint';
  if (name.includes('handoff') || name.includes('payload')) return 'handoff';
  if (name.includes('stage_gate') || name.includes('阀门') || name.includes('gate')) return 'stage_gate';
  if (name.includes('decision') || name.includes('决策')) return 'decision';
  if (name.includes('项目状态')) return 'project_status';
  if (name.includes('recovery')) return 'recovery';
  if (name.includes('task_')) return 'handoff';
  return 'generic';
});

// ── IPC: Workflow ──────────────────────────────────────────────

ipcMain.handle('workflow-submit-task', async (_event: IpcMainInvokeEvent, task: string) => {
  try {
    await workflowEngine.startTask(task);
    return { success: true };
  } catch (err: any) {
    return { error: err.message };
  }
});

ipcMain.handle('workflow-cancel', async () => {
  workflowEngine.cancel();
  return { success: true };
});

ipcMain.handle('workflow-get-status', async () => {
  return workflowEngine.getStatus();
});

// ── IPC: Agent ─────────────────────────────────────────────────

ipcMain.handle('agent-register', async (_event: IpcMainInvokeEvent, config: AgentConfig) => {
  agentManager.registerAgent(config);
  return { success: true };
});

ipcMain.handle('agent-unregister', async (_event: IpcMainInvokeEvent, agentId: string) => {
  agentManager.unregisterAgent(agentId);
  return { success: true };
});

ipcMain.handle('agent-list', async () => {
  return agentManager.listAgents();
});

ipcMain.handle('agent-check-availability', async () => {
  return agentManager.checkAllAvailability();
});

ipcMain.handle('agent-update-config', async (_event: IpcMainInvokeEvent, config: AgentConfig) => {
  agentManager.registerAgent(config); // re-registering overwrites
  return { success: true };
});

// ── App Identity ──────────────────────────────────────────────

app.setAppUserModelId('com.mqttick.workflow-dashboard');

// ── App Lifecycle ─────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  createTray();

  // 通知 UI 核心服务已就绪
  mainWindow?.webContents.send('core-ready', {
    claudeAvailable: agentManager.checkAllAvailability(),
  });
});

app.on('window-all-closed', () => {
  // Tray keeps alive on Windows
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  workflowEngine.cancel();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});
