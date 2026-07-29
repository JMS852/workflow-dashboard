/**
 * WindowManager (v3) — AI 桌面窗口管理
 *
 * 每个 AI 实例一个独立的 Electron BrowserWindow，
 * 加载 ai-terminal.html 并通过 PTY 接收输出。
 * 关闭即隐藏（不退出），session 保持在 PTY 中。
 */

import { BrowserWindow, screen } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import type { PtyInstance } from './pty-manager';

export interface AiWindowInfo {
  id: string;
  type: 'claude' | 'codex';
  label: string;
  sessionId: string;
}

export interface AiWindowState {
  info: AiWindowInfo;
  window: BrowserWindow;
}

export class WindowManager {
  private windows: Map<string, AiWindowState> = new Map();
  private aiTerminalPath: string;

  constructor() {
    // Dev vs prod path resolution
    const devPath = path.join(__dirname, '..', 'public', 'ai-terminal.html');
    const prodPath = path.join(__dirname, '..', '..', 'public', 'ai-terminal.html');
    this.aiTerminalPath = fs.existsSync(devPath) ? devPath : prodPath;
  }

  createAiWindow(info: AiWindowInfo, ptyInstance: PtyInstance): BrowserWindow {
    const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
    const count = this.windows.size;
    const winWidth = 650;
    const winHeight = 500;
    const x = 100 + (count % 3) * (winWidth + 20);
    const y = 60 + Math.floor(count / 3) * (winHeight + 30);

    const win = new BrowserWindow({
      width: winWidth,
      height: winHeight,
      x: Math.min(x, screenWidth - winWidth),
      y,
      title: `${info.label} — ${info.type === 'claude' ? 'Claude Code' : 'Codex'}`,
      icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
      show: true,
    });

    // Load the AI terminal page
    win.loadFile(this.aiTerminalPath);

    // Forward PTY output to the window
    ptyInstance.ptyProcess.onData((data: string) => {
      if (!win.isDestroyed()) {
        win.webContents.send('pty-data', { data });
      }
    });

    // Close → hide (don't quit)
    win.on('close', (event) => {
      event.preventDefault();
      win.hide();
    });

    this.windows.set(info.id, { info, window: win });

    // Send session info after page loads
    win.webContents.on('did-finish-load', () => {
      win.webContents.send('pty-info', {
        label: info.label,
        type: info.type,
        sessionId: info.sessionId,
      });
    });

    return win;
  }

  closeAiWindow(windowId: string): void {
    const state = this.windows.get(windowId);
    if (state) {
      if (!state.window.isDestroyed()) {
        state.window.close();
      }
      this.windows.delete(windowId);
    }
  }

  closeAllAiWindows(): void {
    for (const [id] of this.windows) {
      this.closeAiWindow(id);
    }
  }

  focusWindow(windowId: string): void {
    const state = this.windows.get(windowId);
    if (state && !state.window.isDestroyed()) {
      if (state.window.isMinimized()) state.window.restore();
      state.window.show();
      state.window.focus();
    }
  }

  getAllWindows(): AiWindowState[] {
    return Array.from(this.windows.values());
  }

  getWindow(windowId: string): AiWindowState | undefined {
    return this.windows.get(windowId);
  }
}
