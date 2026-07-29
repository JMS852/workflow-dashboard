# 信差平台 v3.0 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 workflow-dashboard 从后台 CLI spawn 模式改造为 PTY 驱动的桌面多窗口信差平台，用户选择 AI 类型+数量后一键启动独立终端窗口，信差在三轮工作流中自动提取/去重/打包/转发结论。

**Architecture:** Electron 主进程管理 4 个核心服务（PtyManager、MessengerBrain、WindowManager、MqttClient），每个 AI 实例是一个独立 BrowserWindow 内嵌 xterm.js 渲染的 PTY 终端。WorkflowEngine 不再依赖 AgentManager，改为通过 PtyManager.broadcast() + MessengerBrain 处理结论来实现三轮推进。

**Tech Stack:** Electron 28, React 18, TypeScript 5, Vite 5, node-pty, xterm.js, DeepSeek API, mqtt.js

---

## 文件结构图

```
workflow-dashboard/
├── electron/
│   ├── main.ts                    [改造] 新服务初始化 + IPC 替换
│   ├── preload.ts                 [改造] API 接口替换
│   ├── workflow-engine.ts         [改造] AgentManager → PtyManager + MessengerBrain
│   ├── pty-manager.ts             [新建] PTY 实例管理
│   ├── messenger-brain.ts         [新建] DeepSeek LLM 秘书
│   ├── window-manager.ts          [新建] AI BrowserWindow 管理
│   ├── mqtt-client.ts             [新建] MQTT 订阅+发布
│   ├── agent-manager.ts           [删除] 旧 Agent spawn 模式
│   └── session-store.ts           [删除] 旧 session 持久化
├── src/
│   ├── types.ts                   [改造] 删除旧 Agent 类型 + 新增 v3 类型
│   ├── App.tsx                    [改造] AgentPanel → AISelector
│   └── components/
│       ├── AISelector.tsx         [新建] AI 启动配置面板
│       ├── WorkflowView.tsx       [改造] 新增 AI 窗口状态 + 信差处理状态
│       ├── AgentPanel.tsx         [删除] 旧 Agent 注册表单
│       ├── FileTree.tsx           [保留不变]
│       ├── ContentViewer.tsx      [保留不变]
│       └── NotificationBar.tsx    [保留不变]
├── public/
│   ├── ai-terminal.html           [新建] AI 窗口 HTML 骨架
│   └── ai-terminal-renderer.js    [新建] xterm.js 渲染 + IPC 通信
├── package.json                   [改造] 新增 4 个依赖
└── engine/                        [归档] 除 mqtt_client.py 外全部移入 _archive/
```

---

### Task 1: 环境准备 — 安装依赖 + 编译原生模块

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 4 个新依赖**

```bash
cd /c/Users/Lenovo/workflow-dashboard
npm install node-pty xterm @xterm/addon-fit mqtt
```

Expected: 4 个包安装成功，node-pty 会触发 node-gyp 编译。

- [ ] **Step 2: 用 electron-rebuild 重编译 node-pty 适配 Electron**

```bash
npx electron-rebuild -f -w node-pty
```

Expected: `✔ Rebuild Complete`，node-pty 针对 Electron 28 的 Node.js 版本重新编译。

- [ ] **Step 3: 验证 node-pty 可加载**

```bash
node -e "const pty = require('node-pty'); console.log('PTY OK:', typeof pty.spawn);"
```

Expected: `PTY OK: function`

- [ ] **Step 4: 验证 xterm 模块存在**

```bash
node -e "const xterm = require('xterm'); console.log('Xterm OK:', typeof xterm.Terminal);"
```

Expected: `Xterm OK: function`

- [ ] **Step 5: 提交**

```bash
cd /c/Users/Lenovo/workflow-dashboard
git add package.json package-lock.json
git commit -m "chore: add node-pty, xterm, @xterm/addon-fit, mqtt dependencies"
```

---

### Task 2: PtyManager — PTY 实例管理器

**Files:**
- Create: `electron/pty-manager.ts`

- [ ] **Step 1: 写出接口和类骨架**

```typescript
// electron/pty-manager.ts
import * as pty from 'node-pty';
import { EventEmitter } from 'events';

export interface PtyInstance {
  id: string;
  type: 'claude' | 'codex';
  label: string;
  ptyProcess: pty.IPty;
  outputBuffer: string;
  conclusion: string | null;
  createdAt: Date;
}

export interface ConclusionResult {
  instanceId: string;
  label: string;
  type: 'claude' | 'codex';
  conclusion: string;
  fullOutput: string;
  detectedAt: Date;
}

export class PtyManager extends EventEmitter {
  private instances: Map<string, PtyInstance> = new Map();
  private conclusionPattern = /──结论──\s*([\s\S]*?)\s*────────/;
  private nextId = 1;

  constructor() {
    super();
  }
}
```

- [ ] **Step 2: 实现 create() — 根据类型 spawn CLI 进程**

```typescript
// 在 PtyManager 类中新增:

getCliCommand(type: 'claude' | 'codex'): { exe: string; args: string[] } {
  if (type === 'claude') {
    // 使用 where claude 找到的路径，或直接靠 PATH
    return {
      exe: 'claude',
      args: [
        '--session-id', this.generateSessionId(),
        '--permission-mode', 'bypassPermissions',
      ],
    };
  } else {
    // Codex CLI 路径（用户本机已装）
    const codexPath = process.env.CODEX_CLI_PATH ||
      'C:\\Users\\Lenovo\\AppData\\Local\\OpenAI\\Codex\\bin\\69066b736e1e17a4\\codex.exe';
    return {
      exe: codexPath,
      args: ['exec'],
    };
  }
}

create(
  type: 'claude' | 'codex',
  projectDir: string,
  label: string
): PtyInstance {
  const id = `pty-${this.nextId++}-${type}`;
  const { exe, args } = this.getCliCommand(type);

  // Claude 需要 --add-dir 指向项目
  if (type === 'claude') {
    args.push('--add-dir', projectDir);
  }

  const ptyProcess = pty.spawn(exe, args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 40,
    cwd: projectDir,
    env: { ...process.env },
  });

  const instance: PtyInstance = {
    id,
    type,
    label,
    ptyProcess,
    outputBuffer: '',
    conclusion: null,
    createdAt: new Date(),
  };

  // 收集所有输出
  ptyProcess.onData((data: string) => {
    instance.outputBuffer += data;
    this.emit('data', { instanceId: id, data });

    // 检测结论标记
    const match = instance.outputBuffer.match(this.conclusionPattern);
    if (match && !instance.conclusion) {
      instance.conclusion = match[1].trim();
      const fullOutput = instance.outputBuffer;
      this.emit('conclusion', {
        instanceId: id,
        label: instance.label,
        type: instance.type,
        conclusion: instance.conclusion,
        fullOutput,
        detectedAt: new Date(),
      } as ConclusionResult);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    this.emit('exit', { instanceId: id, exitCode });
  });

  this.instances.set(id, instance);
  return instance;
}
```

- [ ] **Step 3: 实现 destroy() — 安全销毁 PTY**

```typescript
destroy(instanceId: string): void {
  const inst = this.instances.get(instanceId);
  if (inst) {
    try { inst.ptyProcess.kill(); } catch {}
    this.instances.delete(instanceId);
  }
}

destroyAll(): void {
  for (const [id] of this.instances) {
    this.destroy(id);
  }
}
```

- [ ] **Step 4: 实现 broadcast() 和 send()**

```typescript
send(instanceId: string, message: string): void {
  const inst = this.instances.get(instanceId);
  if (inst) {
    inst.ptyProcess.write(message + '\n');
  }
}

broadcast(message: string): void {
  for (const [id] of this.instances) {
    this.send(id, message);
  }
}
```

- [ ] **Step 5: 实现 getAllInstances() 和 waitForConclusions()**

```typescript
getAllInstances(): PtyInstance[] {
  return Array.from(this.instances.values());
}

getInstance(instanceId: string): PtyInstance | undefined {
  return this.instances.get(instanceId);
}

/**
 * 等待所有实例输出结论（或超时）
 */
waitForConclusions(timeoutMs: number): Promise<ConclusionResult[]> {
  return new Promise((resolve) => {
    const results: ConclusionResult[] = [];
    const total = this.instances.size;
    let settled = 0;

    const timer = setTimeout(() => {
      cleanup();
      resolve(results);
    }, timeoutMs);

    const onConclusion = (result: ConclusionResult) => {
      results.push(result);
      settled++;
      if (settled >= total) {
        clearTimeout(timer);
        cleanup();
        resolve(results);
      }
    };

    const onExit = (data: { instanceId: string }) => {
      settled++;
      if (settled >= total) {
        clearTimeout(timer);
        cleanup();
        resolve(results);
      }
    };

    this.on('conclusion', onConclusion);
    this.on('exit', onExit);

    const cleanup = () => {
      this.off('conclusion', onConclusion);
      this.off('exit', onExit);
    };
  });
}

/**
 * 注入 prompt 到所有实例并等待结论
 */
async injectAndWait(
  message: string,
  timeoutMs: number = 300000
): Promise<ConclusionResult[]> {
  const waitPromise = this.waitForConclusions(timeoutMs);
  this.broadcast(message);
  return waitPromise;
}

private generateSessionId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// EventEmitter 类型声明
declare interface PtyManager {
  on(event: 'data', listener: (data: { instanceId: string; data: string }) => void): this;
  on(event: 'conclusion', listener: (result: ConclusionResult) => void): this;
  on(event: 'exit', listener: (data: { instanceId: string; exitCode: number }) => void): this;
  emit(event: 'data', data: { instanceId: string; data: string }): boolean;
  emit(event: 'conclusion', result: ConclusionResult): boolean;
  emit(event: 'exit', data: { instanceId: string; exitCode: number }): boolean;
}
```

- [ ] **Step 6: 编译验证**

```bash
cd /c/Users/Lenovo/workflow-dashboard
npx tsc -p tsconfig.electron.json --noEmit 2>&1 | head -20
```

Expected: 无 TypeScript 错误。

- [ ] **Step 7: 提交**

```bash
cd /c/Users/Lenovo/workflow-dashboard
git add electron/pty-manager.ts
git commit -m "feat: add PtyManager — PTY spawn, broadcast, conclusion detection"
```

---

### Task 3: AI 终端窗口 — 每个 AI 一个独立桌面窗口

**Files:**
- Create: `electron/window-manager.ts`
- Create: `public/ai-terminal.html`
- Create: `public/ai-terminal-renderer.js`

- [ ] **Step 1: 创建 AI 终端 HTML 骨架**

```html
<!-- public/ai-terminal.html -->
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Terminal</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0d1117; overflow: hidden; }
    #terminal { width: 100%; height: 100vh; }
  </style>
</head>
<body>
  <div id="terminal"></div>
  <script src="../node_modules/xterm/lib/xterm.js"></script>
  <script src="../node_modules/@xterm/addon-fit/lib/addon-fit.js"></script>
  <script>
    // 由 preload 暴露的 IPC 通道在此处不可用（这是独立窗口）
    // 使用 window.opener 或 Electron messagePort 通信
    // 实际通信由 window-manager.ts 通过 webContents 直接发送
    window._aiTerminalReady = true;
  </script>
</body>
</html>
```

- [ ] **Step 2: 创建 WindowManager**

```typescript
// electron/window-manager.ts
import { BrowserWindow, screen } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import type { PtyInstance } from './pty-manager';

export interface AiWindowInfo {
  id: string;
  type: 'claude' | 'codex';
  label: string;
  ptyInstanceId: string;
}

export interface AiWindowState {
  info: AiWindowInfo;
  window: BrowserWindow;
}

export class WindowManager {
  private windows: Map<string, AiWindowState> = new Map();
  private aiTerminalPath: string;

  constructor() {
    // 确定 ai-terminal.html 路径
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
    const y = 100 + Math.floor(count / 3) * (winHeight + 30);

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
      // 关闭时隐藏而非退出
      show: true,
    });

    // 加载 AI 终端页面
    win.loadFile(this.aiTerminalPath);

    // 透明代理 PTY 输出到窗口
    ptyInstance.ptyProcess.onData((data: string) => {
      if (!win.isDestroyed()) {
        win.webContents.send('pty-data', data);
      }
    });

    // 关闭 → 隐藏
    win.on('close', (event) => {
      event.preventDefault();
      win.hide();
    });

    this.windows.set(info.id, { info, window: win });

    // 窗口加载完成后注入初始信息
    win.webContents.on('did-finish-load', () => {
      win.webContents.send('pty-info', {
        label: info.label,
        type: info.type,
        sessionId: info.ptyInstanceId,
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

  /** 向指定窗口发送用户输入（从窗口打字 → PTY） */
  setupIpcForWindow(windowId: string, ptyInstance: PtyInstance): void {
    // 这个在 main.ts 中通过 IPC handler 连接
    // ipcMain.on('pty-input', (event, { windowId, data }) => {
    //   ptyInstance.ptyProcess.write(data);
    // });
  }
}
```

- [ ] **Step 3: 编译验证**

```bash
cd /c/Users/Lenovo/workflow-dashboard
npx tsc -p tsconfig.electron.json --noEmit 2>&1 | head -20
```

Expected: 编译通过。

- [ ] **Step 4: 提交**

```bash
cd /c/Users/Lenovo/workflow-dashboard
git add electron/window-manager.ts public/ai-terminal.html
git commit -m "feat: add WindowManager — each AI as a separate BrowserWindow with xterm.js"
```

---

### Task 4: MessengerBrain — DeepSeek 信差大脑

**Files:**
- Create: `electron/messenger-brain.ts`

- [ ] **Step 1: 实现 MessengerBrain 类**

```typescript
// electron/messenger-brain.ts

export interface ConclusionItem {
  instanceId: string;
  label: string;
  type: 'claude' | 'codex';
  conclusion: string;
  fullOutput: string;
}

export interface DeduplicatedResult {
  conclusion: string;
  labels: string[];    // 多个 AI 说同一件事时合并
  isDuplicate: boolean;
  originalConclusions: ConclusionItem[];
}

const DEEPSEEK_API = 'https://api.deepseek.com/v1/chat/completions';

const ROUND_PROMPTS: Record<number, string> = {
  1: `你是一个消息整理助手。以下是对同一个任务的多个 AI 的方案结论。
请完成以下工作：
1. 提取每个 AI 的核心方案（一句话，不超过 50 字）
2. 如果多个 AI 说了同一件事，合并他们并标注"X #1、X #2 意见一致"
3. 生成一个对比表（表格格式）
4. 指出各方之间的主要分歧点（如果有）
5. 最后加上一段辩论指令，让各 AI 互相评判

请严格按以下格式输出：
<对比表>
| AI | 核心方案 |
|----|---------|
| ... | ... |
</对比表>

<分歧>
...
</分歧>

<指令>
请各 AI 审阅以上方案并评判。精简回复，200字以内。
</指令>`,

  2: `你是消息整理助手。以下是各 AI 互相辩论的结果。
请提取每方的评判意见，合并相似观点，生成辩论汇总。
标注出仍然存在的分歧。
最后加上投票指令：让各 AI 投票选出最佳方案。

输出格式：
<辩论汇总>
...
</辩论汇总>

<分歧>
...
</分歧>

<指令>
请各 AI 投票选出最佳方案并说明理由。精简回复，200字以内。
</指令>`,

  3: `你是消息整理助手。以下是各 AI 的最终投票结果。
统计票数，选出获胜方案，生成最终决策报告。

输出格式：
<最终决策>
...
</最终决策>

<建议>
...
</建议>`,
};

export class MessengerBrain {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = 'deepseek-chat') {
    this.apiKey = apiKey;
    this.model = model;
  }

  /**
   * 处理一轮输出：提取结论 → 去重 → 生成对比表 + 下轮指令
   */
  async processRound(
    conclusions: ConclusionItem[],
    round: number,
    taskDescription: string
  ): Promise<string> {
    // 先尝试纯规则提取
    const validOnes = conclusions.filter(c => c.conclusion && c.conclusion.length > 5);

    if (validOnes.length === 0) {
      // 没有检测到结论标记 → LLM 全额处理
      return this.askLLM(
        ROUND_PROMPTS[round] || ROUND_PROMPTS[1],
        `任务：${taskDescription}\n\n各 AI 输出：\n${conclusions.map(c =>
          `### ${c.label} (${c.type})\n${c.fullOutput.slice(0, 3000)}`
        ).join('\n\n')}`
      );
    }

    // 有结论 → 先做去重，再让 LLM 整理
    const deduplicated = await this.deduplicateFromLLM(validOnes);

    // 构建精简的 LLM prompt
    const userContent = [
      `任务：${taskDescription}`,
      '',
      ...deduplicated.map((d, i) => {
        if (d.isDuplicate) {
          return `${d.labels.join('、')} 意见一致：${d.conclusion}`;
        }
        return `${d.labels[0]}：${d.conclusion}`;
      }),
    ].join('\n');

    return this.askLLM(
      ROUND_PROMPTS[round] || ROUND_PROMPTS[1],
      userContent
    );
  }

  /**
   * 让 LLM 做去重
   */
  private async deduplicateFromLLM(
    conclusions: ConclusionItem[]
  ): Promise<DeduplicatedResult[]> {
    const prompt = `以下是对同一任务的多个方案结论。请判断哪些说的大致相同，进行分类。

${conclusions.map((c, i) => `[${i}] ${c.label}：${c.conclusion}`).join('\n')}

请输出 JSON 数组，每个元素包含：indices（相同结论的索引列表）、summary（合并后的摘要）。
只输出 JSON，不要其他内容。`;

    try {
      const response = await this.askLLM('你是一个文本去重助手。严格只输出 JSON。', prompt);
      const parsed = JSON.parse(response);
      return parsed.map((item: { indices: number[]; summary: string }) => ({
        conclusion: item.summary,
        labels: item.indices.map((i: number) => conclusions[i].label),
        isDuplicate: item.indices.length > 1,
        originalConclusions: item.indices.map((i: number) => conclusions[i]),
      }));
    } catch {
      // LLM 解析失败 → 返回原始不做去重
      return conclusions.map(c => ({
        conclusion: c.conclusion,
        labels: [c.label],
        isDuplicate: false,
        originalConclusions: [c],
      }));
    }
  }

  /**
   * 构建转发给 AI 的消息模板
   */
  buildForwardMessage(
    processedContent: string,
    round: number,
    taskDescription: string
  ): string {
    const header = [
      '───────────────────────────────',
      `以下是信差整理的结果（Round ${round}）：`,
      '',
      processedContent,
      '',
      '───────────────────────────────',
      '请按要求回复。精简你的方法描述，用 200 字以内的核心结论。',
      '请用 ──结论── 和 ──────── 包裹你的结论。',
    ].join('\n');

    return header;
  }

  /**
   * 直接调用 DeepSeek API
   */
  private async askLLM(systemPrompt: string, userContent: string): Promise<string> {
    const response = await fetch(DEEPSEEK_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        max_tokens: 2000,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;
    return data.choices?.[0]?.message?.content || '';
  }
}
```

- [ ] **Step 2: 编译验证**

```bash
cd /c/Users/Lenovo/workflow-dashboard
npx tsc -p tsconfig.electron.json --noEmit 2>&1 | head -20
```

Expected: 编译通过。

- [ ] **Step 3: 提交**

```bash
cd /c/Users/Lenovo/workflow-dashboard
git add electron/messenger-brain.ts
git commit -m "feat: add MessengerBrain — DeepSeek LLM for conclusion extraction/dedup/packaging"
```

---

### Task 5: MqttClient — MQTT 任务入口 + 结果出口

**Files:**
- Create: `electron/mqtt-client.ts`

- [ ] **Step 1: 实现 MqttClient**

```typescript
// electron/mqtt-client.ts
import * as mqtt from 'mqtt';
import { EventEmitter } from 'events';

export interface MqttTask {
  id: string;
  title: string;
  description: string;
  priority?: 'low' | 'normal' | 'high';
  source?: string;
  receivedAt: string;
}

export class MqttClient extends EventEmitter {
  private client: mqtt.MqttClient | null = null;
  private connected = false;
  private brokerUrl: string;

  constructor(brokerUrl: string = 'mqtt://localhost:1883') {
    super();
    this.brokerUrl = brokerUrl;
  }

  connect(brokerUrl?: string): Promise<void> {
    if (brokerUrl) this.brokerUrl = brokerUrl;

    return new Promise((resolve, reject) => {
      try {
        this.client = mqtt.connect(this.brokerUrl);

        this.client.on('connect', () => {
          this.connected = true;
          this.emit('connected');
          // 订阅任务主题
          this.client?.subscribe('workflow/tasks/new', (err) => {
            if (err) {
              console.error('[MQTT] subscribe error:', err);
            } else {
              console.log('[MQTT] subscribed to workflow/tasks/new');
            }
          });
          resolve();
        });

        this.client.on('message', (topic: string, payload: Buffer) => {
          if (topic === 'workflow/tasks/new') {
            try {
              const task: MqttTask = JSON.parse(payload.toString());
              task.receivedAt = new Date().toISOString();
              this.emit('task', task);
            } catch {
              console.error('[MQTT] failed to parse task payload');
            }
          }
        });

        this.client.on('error', (err: Error) => {
          console.error('[MQTT] error:', err.message);
          this.emit('error', err);
          reject(err);
        });

        this.client.on('close', () => {
          this.connected = false;
          this.emit('disconnected');
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  publishResult(taskId: string, data: object): void {
    if (!this.client || !this.connected) return;
    const topic = `workflow/results/${taskId}`;
    this.client.publish(topic, JSON.stringify({
      taskId,
      timestamp: new Date().toISOString(),
      ...data,
    }));
  }

  publishRoundResult(taskId: string, round: number, data: object): void {
    this.publishResult(taskId, { round, ...data });
  }

  disconnect(): void {
    if (this.client) {
      this.client.end();
      this.client = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}

declare interface MqttClient {
  on(event: 'connected', listener: () => void): this;
  on(event: 'disconnected', listener: () => void): this;
  on(event: 'task', listener: (task: MqttTask) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
}
```

- [ ] **Step 2: 编译验证 + 提交**

```bash
cd /c/Users/Lenovo/workflow-dashboard
npx tsc -p tsconfig.electron.json --noEmit 2>&1 | head -10
git add electron/mqtt-client.ts
git commit -m "feat: add MqttClient — subscribe tasks, publish results"
```

---

### Task 6: 改造 types.ts — 删除旧类型 + 新增 v3 类型

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: 删除旧的 Agent 类型，新增 v3 类型**

在 `src/types.ts` 中：

删除以下内容：
```typescript
// 删除 AgentType, AgentStatus, AgentConfig, AgentResult (第26-47行)
// 保留 ProjectInfo, FileEntry, FileContent, FileType
// 保留 WorkflowState, WorkflowStatus, ConclusionTableData, AgentStatusEvent (AgentStatusEvent 改为 ConclusionDetectedEvent)
// 保留 Notification
```

新增以下类型（放在原 Agent 类型位置）：
```typescript
// ── AI Selection (v3) ────────────────────────────────────────

export type AIToolType = 'claude' | 'codex';

export interface AIToolSelection {
  type: AIToolType;
  count: number;
}

export interface AILaunchConfig {
  projectDir: string;
  tools: AIToolSelection[];
}

export interface AiWindowInfo {
  id: string;
  type: AIToolType;
  label: string;
  sessionId: string;
}

// ── Messenger (v3) ───────────────────────────────────────────

export interface ConclusionResult {
  windowId: string;
  label: string;
  type: AIToolType;
  conclusion: string;
  fullOutput: string;
}

export interface MessengerConfig {
  apiKey: string;
  model?: string;
}

export interface ConclusionDetectedEvent {
  windowId: string;
  label: string;
  conclusion: string;
  round: number;
}

// ── Workflow (updated) ───────────────────────────────────────

// WorkflowState, WorkflowStatus 保留不变
// AgentStatusEvent 删除，替换为:

export interface RoundProgressEvent {
  round: number;
  completedCount: number;
  totalCount: number;
  status: 'waiting' | 'processing' | 'done';
}

// AgentResult 保留但简化（兼容性）
export interface AgentResult {
  agentId: string;
  round: number;
  fullOutput: string;
  conclusion: string;
  durationMs: number;
  error?: string;
}
```

- [ ] **Step 2: 更新全局 Window API 类型**

```typescript
declare global {
  interface Window {
    electronAPI?: {
      // File operations（保持不变）
      selectProject: () => Promise<ProjectInfo | null>;
      openProject: (dir: string) => Promise<ProjectInfo | { error: string }>;
      readFile: (path: string) => Promise<FileContent>;
      writeFile: (path: string, content: string) => Promise<{ success?: boolean; error?: string }>;
      appendToFile: (path: string, text: string) => Promise<{ success?: boolean; error?: string }>;
      getFileInfo: (path: string) => Promise<FileEntry & { error?: string }>;
      openFileExternally: (path: string) => Promise<void>;
      detectFileType: (name: string) => Promise<FileType>;

      onFileAdded: (cb: (data: { path: string; name: string; time: string }) => void) => void;
      onFileChanged: (cb: (data: { path: string; name: string; time: string }) => void) => void;
      onFileRemoved: (cb: (data: { path: string; name: string }) => void) => void;

      // ── v3: AI Launch ──────────────────────────────────
      launchAIs: (config: AILaunchConfig) => Promise<{ aiWindows: AiWindowInfo[]; error?: string }>;
      shutdownAIs: () => Promise<{ success: boolean }>;
      getAiWindows: () => Promise<AiWindowInfo[]>;
      focusAiWindow: (windowId: string) => Promise<{ success: boolean }>;
      injectToAiWindow: (windowId: string, message: string) => Promise<{ success: boolean }>;

      // ── v3: Messenger Config ───────────────────────────
      configureMessenger: (config: MessengerConfig) => Promise<{ success: boolean }>;
      getMessengerConfig: () => Promise<MessengerConfig | null>;

      // ── v3: MQTT Config ────────────────────────────────
      configureMqtt: (brokerUrl: string) => Promise<{ success: boolean; error?: string }>;
      getMqttStatus: () => Promise<{ connected: boolean; brokerUrl: string }>;

      // ── Workflow (updated) ─────────────────────────────
      workflowSubmitTask: (task: string) => Promise<{ success?: boolean; error?: string }>;
      workflowCancel: () => Promise<{ success: boolean }>;
      workflowGetStatus: () => Promise<WorkflowStatus>;

      onWorkflowStateChange: (cb: (data: WorkflowStatus) => void) => void;
      onWorkflowConclusionDetected: (cb: (data: ConclusionDetectedEvent) => void) => void;
      onWorkflowConclusionTable: (cb: (data: ConclusionTableData) => void) => void;
      onWorkflowRoundProgress: (cb: (data: RoundProgressEvent) => void) => void;
      onWorkflowDebateResult: (cb: (data: { results: AgentResult[]; summary: string }) => void) => void;
      onWorkflowFinalDecision: (cb: (data: { results: AgentResult[]; decision: string }) => void) => void;
      onWorkflowError: (cb: (data: { error: string }) => void) => void;

      // ── v3: PTY data for AI windows ────────────────────
      onPtyData: (cb: (data: { data: string }) => void) => void;
      onPtyInfo: (cb: (data: { label: string; type: string; sessionId: string }) => void) => void;
      sendPtyInput: (data: string) => void;

      // ── Core ───────────────────────────────────────────
      onCoreReady: (cb: (data: object) => void) => void;
      removeAllListeners: () => void;
    };
  }
}
```

- [ ] **Step 3: 编译 + 提交**

```bash
cd /c/Users/Lenovo/workflow-dashboard
npx tsc --noEmit 2>&1 | head -20
# 确保前端 TypeScript 编译通过（会有一些引用旧类型的报错——后续任务解决）
git add src/types.ts
git commit -m "refactor: update types.ts — remove Agent types, add v3 AI/Messenger/MQTT types"
```

---

### Task 7: 改造 main.ts — 新服务集成 + IPC 替换

**Files:**
- Modify: `electron/main.ts`

- [ ] **Step 1: 重写 main.ts**

```typescript
// electron/main.ts (重写版)
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

// ── v3 Core Services ───────────────────────────────────────────

const ptyManager = new PtyManager();
const windowManager = new WindowManager();
let messengerBrain: MessengerBrain | null = null;
let mqttClient: MqttClient | null = null;
let workflowEngine: WorkflowEngine | null = null;

// ── Window ────────────────────────────────────────────────────

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
}

// ── File Watcher (保持不变) ───────────────────────────────────

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
      if (entry.isDirectory()) { walkDir(fullPath); }
      else if (entry.name.endsWith('.md')) {
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

// ── IPC: Project / File（保持不变） ──────────────────────────

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

ipcMain.handle('open-project', async (_e, dir: string) => {
  if (!fs.existsSync(dir)) return { error: '目录不存在' };
  const workflowDir = startWatching(dir);
  const files = scanDirectory(dir);
  return { projectDir: dir, workflowDir, projectName: path.basename(dir), files };
});

ipcMain.handle('read-file', async (_e, fp: string) => {
  try { return { content: fs.readFileSync(fp, 'utf-8'), path: fp }; }
  catch (err: any) { return { error: err.message }; }
});

ipcMain.handle('write-file', async (_e, fp: string, content: string) => {
  try { fs.writeFileSync(fp, content, 'utf-8'); return { success: true }; }
  catch (err: any) { return { error: err.message }; }
});

ipcMain.handle('append-to-file', async (_e, fp: string, text: string) => {
  try { fs.appendFileSync(fp, text, 'utf-8'); return { success: true }; }
  catch (err: any) { return { error: err.message }; }
});

ipcMain.handle('get-file-info', async (_e, fp: string) => {
  try {
    const stat = fs.statSync(fp);
    return { name: path.basename(fp), path: fp, size: stat.size, mtime: stat.mtime.toISOString() };
  } catch (err: any) { return { error: err.message }; }
});

ipcMain.handle('open-file-externally', async (_e, fp: string) => {
  const { shell } = require('electron');
  await shell.openPath(fp);
});

ipcMain.handle('detect-file-type', async (_e, fileName: string) => {
  const name = fileName.toLowerCase();
  if (name.includes('checkpoint')) return 'checkpoint';
  if (name.includes('handoff') || name.includes('payload')) return 'handoff';
  if (name.includes('stage_gate') || name.includes('gate')) return 'stage_gate';
  if (name.includes('decision')) return 'decision';
  if (name.includes('项目状态')) return 'project_status';
  return 'generic';
});

// ── IPC: v3 AI Launch ──────────────────────────────────────────

ipcMain.handle('launch-ais', async (_e, config: AILaunchConfig) => {
  try {
    const aiWindows: AiWindowInfo[] = [];
    let idx = { claude: 0, codex: 0 };

    for (const tool of config.tools) {
      for (let i = 0; i < tool.count; i++) {
        idx[tool.type]++;
        const label = tool.type === 'claude'
          ? `Claude #${idx.claude}`
          : `Codex #${idx.codex}`;

        // 1. 创建 PTY
        const ptyInst = ptyManager.create(tool.type, config.projectDir, label);

        // 2. 创建 AI 窗口
        const windowId = `ai-${tool.type}-${idx[tool.type]}`;
        const info: AiWindowInfo = {
          id: windowId,
          type: tool.type,
          label,
          sessionId: ptyInst.id,
        };
        windowManager.createAiWindow(info, ptyInst);

        aiWindows.push(info);
      }
    }

    // 3. 初始化 WorkflowEngine
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
  return windowManager.getAllWindows().map(s => s.info);
});

ipcMain.handle('focus-ai-window', async (_e, windowId: string) => {
  windowManager.focusWindow(windowId);
  return { success: true };
});

ipcMain.handle('inject-to-ai-window', async (_e, windowId: string, message: string) => {
  ptyManager.send(windowId, message);  // 使用 ptyInstance.id 作为 key
  return { success: true };
});

// ── IPC: v3 Messenger Config ──────────────────────────────────

ipcMain.handle('configure-messenger', async (_e, config: MessengerConfig) => {
  messengerBrain = new MessengerBrain(config.apiKey, config.model);
  return { success: true };
});

ipcMain.handle('get-messenger-config', async () => {
  // 只返回是否配置，不返回 API Key
  return messengerBrain ? { configured: true } : null;
});

// ── IPC: v3 MQTT ──────────────────────────────────────────────

ipcMain.handle('configure-mqtt', async (_e, brokerUrl: string) => {
  try {
    mqttClient = new MqttClient(brokerUrl);
    await mqttClient.connect();

    // MQTT 收到任务 → 自动启动工作流
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
    brokerUrl: (mqttClient as any)?.brokerUrl || '',
  };
});

// ── IPC: Workflow（适配 v3）────────────────────────────────────

ipcMain.handle('workflow-submit-task', async (_e, task: string) => {
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
  return workflowEngine?.getStatus() || { state: 'idle' };
});

// ── IPC: PTY input（从 AI 窗口传回的用户输入） ──────────────

ipcMain.on('pty-input', (_e, { windowId, data }: { windowId: string; data: string }) => {
  ptyManager.send(windowId, data);
});

// ── Workflow Events Forwarding（改造） ────────────────────────

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

// ── App Identity + Lifecycle ──────────────────────────────────

app.setAppUserModelId('com.mqttick.workflow-dashboard');

app.whenReady().then(() => {
  createWindow();
  createTray();

  mainWindow?.webContents.send('core-ready', {
    claudeAvailable: true,  // PTY 模式下只要 CLI 在 PATH 里就可用
    codexAvailable: true,
  });
});

app.on('window-all-closed', () => {});

app.on('activate', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  else createWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  workflowEngine?.cancel();
  ptyManager.destroyAll();
  windowManager.closeAllAiWindows();
  mqttClient?.disconnect();
  if (tray) { tray.destroy(); tray = null; }
});
```

- [ ] **Step 2: 编译 + 提交**

```bash
cd /c/Users/Lenovo/workflow-dashboard
npx tsc -p tsconfig.electron.json --noEmit 2>&1 | head -20
git add electron/main.ts
git commit -m "refactor: rewrite main.ts for v3 — PtyManager + WindowManager + MessengerBrain + MQTT"
```

---

### Task 8: 改造 WorkflowEngine — PTY 驱动三轮工作流

**Files:**
- Modify: `electron/workflow-engine.ts`

- [ ] **Step 1: 重写 WorkflowEngine**

```typescript
// electron/workflow-engine.ts（重写版）
import { PtyManager, ConclusionResult } from './pty-manager';
import { MessengerBrain } from './messenger-brain';
import { EventEmitter } from 'events';

export type WorkflowState =
  | 'idle'
  | 'round_1_produce'
  | 'round_2_debate'
  | 'round_3_decide'
  | 'complete';

export interface WorkflowStatus {
  state: WorkflowState;
  currentTask: string | null;
  currentRound: number;
  roundResults: Record<string, ConclusionResult[]>;
  error?: string;
}

export class WorkflowEngine extends EventEmitter {
  private ptyManager: PtyManager;
  private messengerBrain: MessengerBrain;
  private state: WorkflowState = 'idle';
  private currentTask: string | null = null;
  private roundResults: Map<number, ConclusionResult[]> = new Map();
  private abortController: AbortController | null = null;

  private readonly ROUND_TIMEOUT = 300000; // 5分钟超时

  constructor(ptyManager: PtyManager, messengerBrain: MessengerBrain) {
    super();
    this.ptyManager = ptyManager;
    this.messengerBrain = messengerBrain;
  }

  getStatus(): WorkflowStatus {
    const rr: Record<string, ConclusionResult[]> = {};
    for (const [k, v] of this.roundResults) {
      rr[String(k)] = v;
    }
    return {
      state: this.state,
      currentTask: this.currentTask,
      currentRound: this.getRoundNumber(),
      roundResults: rr,
    };
  }

  private getRoundNumber(): number {
    switch (this.state) {
      case 'round_1_produce': return 1;
      case 'round_2_debate': return 2;
      case 'round_3_decide': return 3;
      default: return 0;
    }
  }

  async startTask(task: string): Promise<void> {
    if (this.state !== 'idle' && this.state !== 'complete') {
      this.emit('error', { error: '已有工作流正在运行' });
      return;
    }

    this.currentTask = task;
    this.roundResults.clear();
    this.abortController = new AbortController();

    // Round 1: 直接发送任务到所有 AI
    await this.transitionTo('round_1_produce');
    await this.executeRound(1, task);
  }

  cancel(): void {
    this.abortController?.abort();
    this.state = 'idle';
    this.currentTask = null;
    this.emit('state_change', this.getStatus());
  }

  private async transitionTo(newState: WorkflowState): Promise<void> {
    this.state = newState;
    this.emit('state_change', this.getStatus());
  }

  private async executeRound(round: number, taskOrPrompt: string): Promise<void> {
    const signal = this.abortController?.signal;
    if (signal?.aborted) { await this.transitionTo('idle'); return; }

    // 注入 prompt → 等待结论
    this.ptyManager.broadcast(taskOrPrompt);
    const results = await this.ptyManager.waitForConclusions(this.ROUND_TIMEOUT);

    if (signal?.aborted) { await this.transitionTo('idle'); return; }

    this.roundResults.set(round, results);

    // 每个结论检测时通知前端
    for (const r of results) {
      this.emit('conclusion_detected', {
        windowId: r.instanceId,
        label: r.label,
        conclusion: r.conclusion,
        round,
      });
    }

    // 信差 LLM 处理本轮结论
    if (results.length > 0) {
      const processed = await this.messengerBrain.processRound(
        results.map(r => ({
          instanceId: r.instanceId,
          label: r.label,
          type: r.type,
          conclusion: r.conclusion,
          fullOutput: r.fullOutput,
        })),
        round,
        this.currentTask || ''
      );

      // 构建转发消息
      const forwardMessage = this.messengerBrain.buildForwardMessage(
        processed,
        round,
        this.currentTask || ''
      );

      // 发射对比表事件
      this.emit('conclusion_table_ready', {
        round,
        table: processed,
        results,
      });

      // 决定下一轮
      switch (round) {
        case 1:
          await this.transitionTo('round_2_debate');
          this.emit('round_progress', { round: 2, completedCount: 0, totalCount: this.ptyManager.getAllInstances().length, status: 'waiting' });
          await this.executeRound(2, forwardMessage);
          break;
        case 2:
          this.emit('debate_result', { results, summary: processed });
          await this.transitionTo('round_3_decide');
          this.emit('round_progress', { round: 3, completedCount: 0, totalCount: this.ptyManager.getAllInstances().length, status: 'waiting' });
          await this.executeRound(3, forwardMessage);
          break;
        case 3:
          this.emit('final_decision', { results, decision: processed });
          await this.transitionTo('complete');
          break;
      }
    } else {
      this.emit('error', { error: '所有 AI 均未在超时时间内返回结论' });
      await this.transitionTo('idle');
    }
  }

  // EventEmitter 类型重载
  emit(event: 'state_change', data: WorkflowStatus): boolean;
  emit(event: 'conclusion_detected', data: { windowId: string; label: string; conclusion: string; round: number }): boolean;
  emit(event: 'conclusion_table_ready', data: { round: number; table: string; results: ConclusionResult[] }): boolean;
  emit(event: 'round_progress', data: { round: number; completedCount: number; totalCount: number; status: string }): boolean;
  emit(event: 'debate_result', data: { results: ConclusionResult[]; summary: string }): boolean;
  emit(event: 'final_decision', data: { results: ConclusionResult[]; decision: string }): boolean;
  emit(event: 'error', data: { error: string }): boolean;
  emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  on(event: 'state_change', listener: (data: WorkflowStatus) => void): this;
  on(event: 'conclusion_detected', listener: (data: { windowId: string; label: string; conclusion: string; round: number }) => void): this;
  on(event: 'conclusion_table_ready', listener: (data: { round: number; table: string; results: ConclusionResult[] }) => void): this;
  on(event: 'round_progress', listener: (data: { round: number; completedCount: number; totalCount: number; status: string }) => void): this;
  on(event: 'debate_result', listener: (data: { results: ConclusionResult[]; summary: string }) => void): this;
  on(event: 'final_decision', listener: (data: { results: ConclusionResult[]; decision: string }) => void): this;
  on(event: 'error', listener: (data: { error: string }) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
}
```

- [ ] **Step 2: 编译 + 提交**

```bash
cd /c/Users/Lenovo/workflow-dashboard
npx tsc -p tsconfig.electron.json --noEmit 2>&1 | head -10
git add electron/workflow-engine.ts
git commit -m "refactor: rewrite WorkflowEngine — PTY-driven rounds with MessengerBrain processing"
```

---

### Task 9: 改造 preload.ts — 对接 v3 API

**Files:**
- Modify: `electron/preload.ts`

- [ ] **Step 1: 重写 preload.ts**

```typescript
// electron/preload.ts
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // ── File operations（保持不变） ──────────────────────────
  selectProject: () => ipcRenderer.invoke('select-project'),
  openProject: (dir: string) => ipcRenderer.invoke('open-project', dir),
  readFile: (fPath: string) => ipcRenderer.invoke('read-file', fPath),
  writeFile: (fPath: string, content: string) => ipcRenderer.invoke('write-file', fPath, content),
  appendToFile: (fPath: string, text: string) => ipcRenderer.invoke('append-to-file', fPath, text),
  getFileInfo: (fPath: string) => ipcRenderer.invoke('get-file-info', fPath),
  openFileExternally: (fPath: string) => ipcRenderer.invoke('open-file-externally', fPath),
  detectFileType: (name: string) => ipcRenderer.invoke('detect-file-type', name),

  onFileAdded: (cb: (data: any) => void) => ipcRenderer.on('file-added', (_e: IpcRendererEvent, d: any) => cb(d)),
  onFileChanged: (cb: (data: any) => void) => ipcRenderer.on('file-changed', (_e: IpcRendererEvent, d: any) => cb(d)),
  onFileRemoved: (cb: (data: any) => void) => ipcRenderer.on('file-removed', (_e: IpcRendererEvent, d: any) => cb(d)),

  // ── v3: AI Launch ────────────────────────────────────────
  launchAIs: (config: object) => ipcRenderer.invoke('launch-ais', config),
  shutdownAIs: () => ipcRenderer.invoke('shutdown-ais'),
  getAiWindows: () => ipcRenderer.invoke('get-ai-windows'),
  focusAiWindow: (windowId: string) => ipcRenderer.invoke('focus-ai-window', windowId),
  injectToAiWindow: (windowId: string, message: string) => ipcRenderer.invoke('inject-to-ai-window', windowId, message),

  // ── v3: Messenger ────────────────────────────────────────
  configureMessenger: (config: object) => ipcRenderer.invoke('configure-messenger', config),
  getMessengerConfig: () => ipcRenderer.invoke('get-messenger-config'),

  // ── v3: MQTT ─────────────────────────────────────────────
  configureMqtt: (brokerUrl: string) => ipcRenderer.invoke('configure-mqtt', brokerUrl),
  getMqttStatus: () => ipcRenderer.invoke('get-mqtt-status'),

  // ── Workflow ─────────────────────────────────────────────
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

  // ── v3: PTY data（AI 窗口专用） ──────────────────────────
  onPtyData: (cb: (data: any) => void) =>
    ipcRenderer.on('pty-data', (_e: IpcRendererEvent, d: any) => cb(d)),
  onPtyInfo: (cb: (data: any) => void) =>
    ipcRenderer.on('pty-info', (_e: IpcRendererEvent, d: any) => cb(d)),
  sendPtyInput: (data: string) => ipcRenderer.send('pty-input', { data }),

  // ── Core ─────────────────────────────────────────────────
  onCoreReady: (cb: (data: any) => void) =>
    ipcRenderer.on('core-ready', (_e: IpcRendererEvent, d: any) => cb(d)),

  // ── MQTT ─────────────────────────────────────────────────
  onMqttTaskReceived: (cb: (data: any) => void) =>
    ipcRenderer.on('mqtt-task-received', (_e: IpcRendererEvent, d: any) => cb(d)),

  // Cleanup
  removeAllListeners: () => {
    const channels = ipcRenderer.eventNames();
    for (const channel of channels) {
      ipcRenderer.removeAllListeners(channel as string);
    }
  },
});
```

- [ ] **Step 2: 提交**

```bash
cd /c/Users/Lenovo/workflow-dashboard
git add electron/preload.ts
git commit -m "refactor: update preload.ts for v3 AI/Messenger/MQTT IPC channels"
```

---

### Task 10: 创建 AISelector 组件 — 替代 AgentPanel

**Files:**
- Create: `src/components/AISelector.tsx`

- [ ] **Step 1: 实现 AISelector**

```tsx
// src/components/AISelector.tsx
import React, { useState } from 'react';
import type { AIToolType, AILaunchConfig, AiWindowInfo } from '../types';
import { Play, Square, Monitor, Cpu, FolderOpen } from 'lucide-react';

interface Props {
  projectDir: string | null;
  onSelectProject: () => void;
  onLaunch: (config: AILaunchConfig) => void;
  onShutdown: () => void;
  aiWindows: AiWindowInfo[];
  launched: boolean;
}

export default function AISelector({
  projectDir,
  onSelectProject,
  onLaunch,
  onShutdown,
  aiWindows,
  launched,
}: Props) {
  const [claudeCount, setClaudeCount] = useState(2);
  const [codexCount, setCodexCount] = useState(1);
  const [claudeEnabled, setClaudeEnabled] = useState(true);
  const [codexEnabled, setCodexEnabled] = useState(true);

  const handleLaunch = () => {
    if (!projectDir) return;
    const tools: { type: AIToolType; count: number }[] = [];
    if (claudeEnabled && claudeCount > 0) tools.push({ type: 'claude', count: claudeCount });
    if (codexEnabled && codexCount > 0) tools.push({ type: 'codex', count: codexCount });

    if (tools.length === 0) return;
    onLaunch({ projectDir, tools });
  };

  const totalCount = (claudeEnabled ? claudeCount : 0) + (codexEnabled ? codexCount : 0);

  return (
    <div className="ai-selector">
      <div className="ai-selector-header">
        <Cpu size={14} />
        <span>AI 配置</span>
      </div>

      {/* Project */}
      <div className="ai-selector-section">
        <div className="field-label">📁 项目</div>
        <button className="btn btn-ghost btn-sm" onClick={onSelectProject}>
          <FolderOpen size={12} />
          {projectDir ? projectDir.split('\\').pop() : '选择文件夹'}
        </button>
        {projectDir && (
          <div className="field-hint" title={projectDir}>
            {projectDir.length > 35 ? '...' + projectDir.slice(-35) : projectDir}
          </div>
        )}
      </div>

      {/* Claude Code */}
      <div className="ai-selector-section">
        <label className="ai-tool-check">
          <input
            type="checkbox"
            checked={claudeEnabled}
            onChange={(e) => setClaudeEnabled(e.target.checked)}
            disabled={launched}
          />
          <span className="ai-tool-name claude">Claude Code</span>
        </label>
        <div className="ai-tool-count">
          <span className="count-label">数量</span>
          <select
            value={claudeCount}
            onChange={(e) => setClaudeCount(Number(e.target.value))}
            disabled={launched || !claudeEnabled}
          >
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <span className="ai-tool-badge">终端</span>
      </div>

      {/* Codex */}
      <div className="ai-selector-section">
        <label className="ai-tool-check">
          <input
            type="checkbox"
            checked={codexEnabled}
            onChange={(e) => setCodexEnabled(e.target.checked)}
            disabled={launched}
          />
          <span className="ai-tool-name codex">Codex</span>
        </label>
        <div className="ai-tool-count">
          <span className="count-label">数量</span>
          <select
            value={codexCount}
            onChange={(e) => setCodexCount(Number(e.target.value))}
            disabled={launched || !codexEnabled}
          >
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <span className="ai-tool-badge">终端</span>
      </div>

      {/* Launch / Shutdown */}
      <div className="ai-selector-actions">
        {!launched ? (
          <button
            className="btn btn-primary btn-block"
            onClick={handleLaunch}
            disabled={!projectDir || totalCount === 0}
          >
            <Play size={14} />
            启动 {totalCount} 个 AI
          </button>
        ) : (
          <button className="btn btn-danger btn-block" onClick={onShutdown}>
            <Square size={14} />
            关闭所有 AI
          </button>
        )}
      </div>

      {/* AI Window Status */}
      {launched && aiWindows.length > 0 && (
        <div className="ai-window-status">
          <Monitor size={12} />
          <span>已启动 {aiWindows.length} 个窗口</span>
          {aiWindows.map((w) => (
            <div key={w.id} className={`ai-window-badge ${w.type}`}>
              {w.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
cd /c/Users/Lenovo/workflow-dashboard
git add src/components/AISelector.tsx
git commit -m "feat: add AISelector — replaces AgentPanel with AI type+count selection"
```

---

### Task 11: 改造 App.tsx — 集成 AISelector

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: 改造 App.tsx**

关键改动：
1. 删除 `import AgentPanel` → 改为 `import AISelector`
2. 新增状态：`aiWindows`, `aiLaunched`, `messengerConfigured`
3. `<AgentPanel />` → `<AISelector />`
4. 欢迎页新增 Messenger/MQTT 配置

```tsx
// src/App.tsx 改动（仅显示改动部分）

// 第6行：替换 import
// import AgentPanel from './components/AgentPanel';  → 删除
import AISelector from './components/AISelector';
import type { AiWindowInfo, AILaunchConfig } from './types';

// 在 App 组件内新增状态：
const [aiWindows, setAiWindows] = useState<AiWindowInfo[]>([]);
const [aiLaunched, setAiLaunched] = useState(false);

// 新增方法：
const handleLaunchAIs = useCallback(async (config: AILaunchConfig) => {
  const api = window.electronAPI;
  if (!api) return;
  const result = await api.launchAIs(config);
  if (result.aiWindows) {
    setAiWindows(result.aiWindows);
    setAiLaunched(true);
    addNotification('workflow', `已启动 ${result.aiWindows.length} 个 AI 窗口`);
  }
  if (result.error) {
    addNotification('agent', `启动失败: ${result.error}`);
  }
}, [addNotification]);

const handleShutdownAIs = useCallback(async () => {
  const api = window.electronAPI;
  if (!api) return;
  await api.shutdownAIs();
  setAiWindows([]);
  setAiLaunched(false);
  addNotification('workflow', '所有 AI 窗口已关闭');
}, [addNotification]);

// 右侧边栏（第210行附近）：替换 AgentPanel
// <AgentPanel /> → <AISelector ... />
<aside className="right-sidebar">
  <AISelector
    projectDir={project?.projectDir || null}
    onSelectProject={selectProject}
    onLaunch={handleLaunchAIs}
    onShutdown={handleShutdownAIs}
    aiWindows={aiWindows}
    launched={aiLaunched}
  />
</aside>
```

- [ ] **Step 2: 欢迎页新增配置区**

在欢迎页（未选项目时）新增 Messenger API Key 输入和 MQTT Broker URL 输入。

```tsx
// 在欢迎页 welcome-card 内，selectProject 按钮上方新增：
<div className="welcome-config">
  <div className="config-item">
    <label>🔑 DeepSeek API Key（信差大脑）</label>
    <input
      type="password"
      placeholder="sk-..."
      onChange={(e) => {
        if (e.target.value.length > 20) {
          window.electronAPI?.configureMessenger({ apiKey: e.target.value });
        }
      }}
    />
  </div>
  <div className="config-item">
    <label>📡 MQTT Broker（可选）</label>
    <input
      placeholder="mqtt://localhost:1883"
      onBlur={(e) => {
        if (e.target.value) {
          window.electronAPI?.configureMqtt(e.target.value);
        }
      }}
    />
  </div>
</div>
```

- [ ] **Step 3: 提交**

```bash
cd /c/Users/Lenovo/workflow-dashboard
git add src/App.tsx
git commit -m "refactor: integrate AISelector + Messenger/MQTT config into App.tsx"
```

---

### Task 12: 改造 WorkflowView.tsx — 新增 AI 窗口状态 + 信差处理状态

**Files:**
- Modify: `src/components/WorkflowView.tsx`

- [ ] **Step 1: 新增 AI 窗口状态面板和信差处理中状态**

关键改动：
1. 新增监听 `onWorkflowConclusionDetected` 和 `onWorkflowRoundProgress`
2. 在「对话」Tab 中显示 AI 窗口状态列表
3. 工作流状态字符串增加「信差正在处理中」阶段

```tsx
// 新增状态
const [aiWindowStatuses, setAiWindowStatuses] = useState<Record<string, string>>({});

// 新增 useEffect 监听
useEffect(() => {
  const api = window.electronAPI;
  if (!api) return;

  api.onWorkflowConclusionDetected((data) => {
    setAiWindowStatuses(prev => ({
      ...prev,
      [data.label]: `✅ 结论已提取 · Round ${data.round}`,
    }));
  });

  api.onWorkflowRoundProgress((data) => {
    if (data.status === 'processing') {
      setStatusMsg(`信差正在处理 Round ${data.round} 结论...`);
    }
  });
}, []);
```

- [ ] **Step 2: 在 Chat Tab 顶部显示 AI 状态**

```tsx
// 在 chat-log 上方新增 AI 状态条
{activeTab === 'chat' && (
  <div className="chat-view">
    {/* 新增：AI 窗口状态 */}
    <div className="ai-status-bar">
      {Object.entries(aiWindowStatuses).map(([label, status]) => (
        <div key={label} className="ai-status-chip">
          <span className="ai-chip-label">{label}</span>
          <span className="ai-chip-status">{status}</span>
        </div>
      ))}
      {Object.keys(aiWindowStatuses).length === 0 && (
        <span className="ai-status-empty">等待 AI 响应...</span>
      )}
    </div>
    {/* 原有的 chat-log 和 chat-input-area */}
    ...
```

- [ ] **Step 3: 提交**

```bash
cd /c/Users/Lenovo/workflow-dashboard
git add src/components/WorkflowView.tsx
git commit -m "feat: add AI window status bar + messenger processing state to WorkflowView"
```

---

### Task 13: 清理旧代码

**Files:**
- Delete: `electron/agent-manager.ts`
- Delete: `electron/session-store.ts`
- Delete: `src/components/AgentPanel.tsx`

- [ ] **Step 1: 删除三个旧文件**

```bash
cd /c/Users/Lenovo/workflow-dashboard
git rm electron/agent-manager.ts
git rm electron/session-store.ts
git rm src/components/AgentPanel.tsx
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc -p tsconfig.electron.json --noEmit 2>&1 | head -10
npx tsc --noEmit 2>&1 | head -10
```

如果有引用旧模块的报错，清理残留 import。

- [ ] **Step 3: 提交**

```bash
git commit -m "chore: remove legacy agent-manager, session-store, AgentPanel"
```

---

### Task 14: 端到端构建测试

- [ ] **Step 1: 完整构建**

```bash
cd /c/Users/Lenovo/workflow-dashboard
npx tsc -p tsconfig.electron.json
npx tsc && npx vite build
```

Expected: 两个构建步骤均无错误。

- [ ] **Step 2: 启动应用**

```bash
node launcher.js
```

Expected: Dashboard 主窗口弹出，欢迎页显示 AI 选择面板。

- [ ] **Step 3: 验证启动流程**

1. 点击选择项目目录
2. 勾选 Claude Code (2) + Codex (1)
3. 点击「启动」
4. 验证：3 个独立 AI 窗口在桌面弹出
5. 在控制台输入任务：「设计一个 Hello World Web 服务」
6. 观察：每个 AI 窗口出现 prompt，开始产出
7. 观察：控制台显示 Round 1 → 结论提取 → Round 2 → Round 3

- [ ] **Step 4: 提交最终版本**

```bash
cd /c/Users/Lenovo/workflow-dashboard
git add -A
git commit -m "chore: finalize v3.0 build — PTY-driven multi-window messenger platform"
```
