/**
 * Workflow Dashboard — 信差平台 v3.0 (main.ts)
 * Electron 主进程：窗口管理、PTY 服务、信差大脑、MQTT、工作流引擎
 */

import { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { watch, FSWatcher } from 'chokidar';
import type { IpcMainInvokeEvent } from 'electron';

import { PtyManager } from './pty-manager';
import { MessengerBrain } from './messenger-brain';
import { WindowManager } from './window-manager';
import { MqttClient } from './mqtt-client';
import { WorkflowEngine } from './workflow-engine';
import type { AILaunchConfig, AiWindowInfo, MessengerConfig } from '../src/types';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let watcher: FSWatcher | null = null;
let watchDir: string = '';

// ── v3 Core Services ─────────────────────────────────────────────

const ptyManager = new PtyManager();
const windowManager = new WindowManager();
let messengerBrain: MessengerBrain | null = null;
let mqttClient: MqttClient | null = null;
let workflowEngine: WorkflowEngine | null = null;

// ── Tray ─────────────────────────────────────────────────────────

function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');
  if (!fs.existsSync(iconPath)) return;

  const trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(trayIcon);
  tray.setToolTip('Workflow Dashboard — 信差平台');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示/隐藏控制台',
      click: () => {
        if (mainWindow) {
          mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
        }
      },
    },
    {
      label: '平铺 AI 窗口',
      click: () => {
        const wins = windowManager.getAllWindows();
        wins.forEach((w, i) => {
          if (!w.window.isDestroyed()) {
            w.window.setPosition(100 + (i % 3) * 680, 60 + Math.floor(i / 3) * 530);
            w.window.show();
          }
        });
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        ptyManager.destroyAll();
        windowManager.closeAllAiWindows();
        mqttClient?.disconnect();
        workflowEngine?.cancel();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    }
  });
}

// ── Main Window ──────────────────────────────────────────────────

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Workflow Dashboard — 信差平台',
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

// ── File Watcher ─────────────────────────────────────────────────

function startWatching(dir: string) {
  if (watcher) { watcher.close(); }

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

// ── IPC: Project / File ──────────────────────────────────────────

ipcMain.handle('select-project', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: '选择项目目录',
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const dir = result.filePaths[0];
  const workflowDir = startWatching(dir);
  const files = scanDirectory(dir);
  return { projectDir: dir, workflowDir, projectName: path.basename(dir), files };
});

ipcMain.handle('open-project', async (_e: IpcMainInvokeEvent, dir: string) => {
  if (!fs.existsSync(dir)) return { error: '目录不存在' };
  const workflowDir = startWatching(dir);
  const files = scanDirectory(dir);
  return { projectDir: dir, workflowDir, projectName: path.basename(dir), files };
});

ipcMain.handle('read-file', async (_e: IpcMainInvokeEvent, filePath: string) => {
  try { return { content: fs.readFileSync(filePath, 'utf-8'), path: filePath }; }
  catch (err: any) { return { error: err.message }; }
});

ipcMain.handle('write-file', async (_e: IpcMainInvokeEvent, filePath: string, content: string) => {
  try { fs.writeFileSync(filePath, content, 'utf-8'); return { success: true }; }
  catch (err: any) { return { error: err.message }; }
});

ipcMain.handle('append-to-file', async (_e: IpcMainInvokeEvent, filePath: string, text: string) => {
  try { fs.appendFileSync(filePath, text, 'utf-8'); return { success: true }; }
  catch (err: any) { return { error: err.message }; }
});

ipcMain.handle('get-file-info', async (_e: IpcMainInvokeEvent, filePath: string) => {
  try {
    const stat = fs.statSync(filePath);
    return { name: path.basename(filePath), path: filePath, size: stat.size, mtime: stat.mtime.toISOString() };
  } catch (err: any) { return { error: err.message }; }
});

ipcMain.handle('open-file-externally', async (_e: IpcMainInvokeEvent, filePath: string) => {
  const { shell } = require('electron');
  await shell.openPath(filePath);
});

ipcMain.handle('detect-file-type', async (_e: IpcMainInvokeEvent, fileName: string) => {
  const name = fileName.toLowerCase();
  if (name.includes('checkpoint')) return 'checkpoint';
  if (name.includes('handoff') || name.includes('payload')) return 'handoff';
  if (name.includes('stage_gate') || name.includes('gate')) return 'stage_gate';
  if (name.includes('decision')) return 'decision';
  if (name.includes('项目状态')) return 'project_status';
  return 'generic';
});

// ── IPC: v3 AI Launch ────────────────────────────────────────────

ipcMain.handle('launch-ais', async (_e: IpcMainInvokeEvent, config: AILaunchConfig) => {
  try {
    const aiWindows: AiWindowInfo[] = [];
    const idx: Record<string, number> = { claude: 0, codex: 0 };

    for (const tool of config.tools) {
      for (let i = 0; i < tool.count; i++) {
        idx[tool.type]++;
        const label = tool.type === 'claude'
          ? `Claude #${idx.claude}`
          : `Codex #${idx.codex}`;

        const ptyInst = ptyManager.create(tool.type, config.projectDir, label);

        const windowId = `ai-${tool.type}-${idx[tool.type]}`;
        const info: AiWindowInfo = { id: windowId, type: tool.type, label, sessionId: ptyInst.id };
        windowManager.createAiWindow(info, ptyInst);
        aiWindows.push(info);
      }
    }

    if (messengerBrain) {
      workflowEngine = new WorkflowEngine(ptyManager, messengerBrain);
      setupWorkflowEvents();
    }

    return { aiWindows };
  } catch (err: any) {
    return { aiWindows: [], error: err.message };
  }
});

ipcMain.handle('shutdown-ais', async () => {
  ptyManager.destroyAll();
  windowManager.closeAllAiWindows();
  return { success: true };
});

ipcMain.handle('get-ai-windows', async () => {
  return windowManager.getAllWindows().map((s) => s.info);
});

ipcMain.handle('focus-ai-window', async (_e: IpcMainInvokeEvent, windowId: string) => {
  windowManager.focusWindow(windowId);
  return { success: true };
});

ipcMain.handle('inject-to-ai-window', async (_e: IpcMainInvokeEvent, windowId: string, message: string) => {
  // windowId is AiWindowInfo.id (e.g. "ai-claude-1"); resolve via WindowManager → sessionId → PtyManager
  const win = windowManager.getWindow(windowId);
  if (win) { ptyManager.send(win.info.sessionId, message); }
  return { success: true };
});

// ── IPC: v3 Messenger Config ─────────────────────────────────────

ipcMain.handle('configure-messenger', async (_e: IpcMainInvokeEvent, config: MessengerConfig) => {
  messengerBrain = new MessengerBrain(config.apiKey, config.model);
  return { success: true };
});

ipcMain.handle('get-messenger-config', async () => {
  return messengerBrain ? { configured: true } : null;
});

// ── IPC: v3 MQTT Config ──────────────────────────────────────────

ipcMain.handle('configure-mqtt', async (_e: IpcMainInvokeEvent, brokerUrl: string) => {
  try {
    mqttClient = new MqttClient(brokerUrl);
    await mqttClient.connect();

    mqttClient.on('task', async (task) => {
      if (workflowEngine && mainWindow) {
        mainWindow.webContents.send('mqtt-task-received', task);
        try {
          await workflowEngine.startTask(task.description || task.title);
        } catch (err: any) {
          mainWindow.webContents.send('workflow-error', { error: err.message });
        }
      }
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-mqtt-status', async () => {
  return {
    connected: mqttClient?.isConnected() || false,
    brokerUrl: mqttClient?.brokerUrl || '',
  };
});

// ── IPC: Workflow ────────────────────────────────────────────────

ipcMain.handle('workflow-submit-task', async (_e: IpcMainInvokeEvent, task: string) => {
  if (!workflowEngine) return { error: '请先启动 AI 窗口' };
  try {
    await workflowEngine.startTask(task);
    return { success: true };
  } catch (err: any) {
    return { error: err.message };
  }
});

ipcMain.handle('workflow-cancel', async () => {
  workflowEngine?.cancel();
  return { success: true };
});

ipcMain.handle('workflow-get-status', async () => {
  return workflowEngine?.getStatus() || { state: 'idle', currentTask: null, currentRound: 0, roundResults: {} };
});

// ── IPC: PTY input (from AI windows) ────────────────────────────

ipcMain.on('pty-input', (_e, { windowId, data }: { windowId: string; data: string }) => {
  const instances = ptyManager.getAllInstances();
  const target = instances.find((inst) => inst.id === windowId);
  if (target) { ptyManager.send(target.id, data); }
});

// ── Workflow Events Forwarding ──────────────────────────────────

function setupWorkflowEvents() {
  if (!workflowEngine) return;

  workflowEngine.on('state_change', (status) => {
    mainWindow?.webContents.send('workflow-state-change', status);
  });
  workflowEngine.on('conclusion_detected', (data) => {
    mainWindow?.webContents.send('workflow-conclusion-detected', data);
  });
  workflowEngine.on('conclusion_table_ready', (data) => {
    mainWindow?.webContents.send('workflow-conclusion-table', data);
  });
  workflowEngine.on('round_progress', (data) => {
    mainWindow?.webContents.send('workflow-round-progress', data);
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
}

// ── App Identity ─────────────────────────────────────────────────

app.setAppUserModelId('com.mqttick.workflow-dashboard');

// ── App Lifecycle ────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  createTray();
  mainWindow?.webContents.send('core-ready', {});
});

app.on('window-all-closed', () => {});

app.on('activate', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  else { createWindow(); }
});

app.on('before-quit', () => {
  isQuitting = true;
  workflowEngine?.cancel();
  ptyManager.destroyAll();
  windowManager.closeAllAiWindows();
  mqttClient?.disconnect();
  if (tray) { tray.destroy(); tray = null; }
});
