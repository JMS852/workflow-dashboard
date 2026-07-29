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
  private conclusionPattern = /──結論──\s*([\s\S]*?)\s*────────/;
  private nextId = 1;

  constructor() { super(); }

  getCliCommand(type: 'claude' | 'codex'): { exe: string; args: string[] } {
    if (type === 'claude') {
      return {
        exe: 'claude',
        args: [
          '--session-id', this.generateSessionId(),
          '--permission-mode', 'bypassPermissions',
        ],
      };
    } else {
      const codexPath = process.env.CODEX_CLI_PATH ||
        String.raw`C:\Users\Lenovo\AppData\Local\OpenAI\Codex\bin\69066b736e1e17a4\codex.exe`;
      return { exe: codexPath, args: ['exec'] };
    }
  }

  create(type: 'claude' | 'codex', projectDir: string, label: string): PtyInstance {
    const id = `pty-${this.nextId++}-${type}`;
    const { exe, args } = this.getCliCommand(type);
    if (type === 'claude') { args.push('--add-dir', projectDir); }

    const ptyProcess = pty.spawn(exe, args, {
      name: 'xterm-256color',
      cols: 120, rows: 40,
      cwd: projectDir,
      env: { ...process.env } as any,
    });

    const instance: PtyInstance = {
      id, type, label, ptyProcess,
      outputBuffer: '', conclusion: null,
      createdAt: new Date(),
    };

    ptyProcess.onData((data: string) => {
      instance.outputBuffer += data;
      this.emit('data', { instanceId: id, data });
      const match = instance.outputBuffer.match(this.conclusionPattern);
      if (match && !instance.conclusion) {
        instance.conclusion = match[1].trim();
        this.emit('conclusion', {
          instanceId: id, label: instance.label, type: instance.type,
          conclusion: instance.conclusion, fullOutput: instance.outputBuffer,
          detectedAt: new Date(),
        } as ConclusionResult);
      }
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      this.emit('exit', { instanceId: id, exitCode });
    });

    this.instances.set(id, instance);
    return instance;
  }

  destroy(instanceId: string): void {
    const inst = this.instances.get(instanceId);
    if (inst) { try { inst.ptyProcess.kill(); } catch {} this.instances.delete(instanceId); }
  }

  destroyAll(): void {
    for (const [id] of this.instances) { this.destroy(id); }
  }

  /** 每轮开始前重置——清空 outputBuffer 和 conclusion，允许新结论触发 */
  resetForNewRound(): void {
    for (const inst of this.instances.values()) {
      inst.conclusion = null;
      inst.outputBuffer = '';
    }
  }

  send(instanceId: string, message: string): void {
    const inst = this.instances.get(instanceId);
    if (inst) { inst.ptyProcess.write(message + '\n'); }
  }

  broadcast(message: string): void {
    for (const [id] of this.instances) { this.send(id, message); }
  }

  getAllInstances(): PtyInstance[] {
    return Array.from(this.instances.values());
  }

  getInstance(instanceId: string): PtyInstance | undefined {
    return this.instances.get(instanceId);
  }

  waitForConclusions(timeoutMs: number): Promise<ConclusionResult[]> {
    return new Promise((resolve) => {
      const results: ConclusionResult[] = [];
      const total = this.instances.size;
      const concluded = new Set<string>(); // 已返回结论的 instanceId
      const exited = new Set<string>();    // 已退出的 instanceId
      let settled = 0;

      const timer = setTimeout(() => { cleanup(); resolve(results); }, timeoutMs);

      const checkDone = () => {
        if (settled >= total) { clearTimeout(timer); cleanup(); resolve(results); }
      };

      const onConclusion = (result: ConclusionResult) => {
        if (concluded.has(result.instanceId)) return;
        concluded.add(result.instanceId);
        results.push(result);
        settled++;
        checkDone();
      };

      const onExit = (data: { instanceId: string; exitCode: number }) => {
        if (exited.has(data.instanceId)) return;
        exited.add(data.instanceId);
        // 只有未返回过结论的退出才计入 settled（避免双重计数）
        if (!concluded.has(data.instanceId)) {
          settled++;
        }
        checkDone();
      };

      this.on('conclusion', onConclusion);
      this.on('exit', onExit);

      const cleanup = () => {
        this.off('conclusion', onConclusion);
        this.off('exit', onExit);
      };
    });
  }

  async injectAndWait(message: string, timeoutMs: number = 300000): Promise<ConclusionResult[]> {
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

  on(event: 'data', listener: (data: { instanceId: string; data: string }) => void): this;
  on(event: 'conclusion', listener: (result: ConclusionResult) => void): this;
  on(event: 'exit', listener: (data: { instanceId: string; exitCode: number }) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this { return super.on(event, listener); }

  emit(event: 'data', data: { instanceId: string; data: string }): boolean;
  emit(event: 'conclusion', result: ConclusionResult): boolean;
  emit(event: 'exit', data: { instanceId: string; exitCode: number }): boolean;
  emit(event: string | symbol, ...args: any[]): boolean { return super.emit(event, ...args); }

  off(event: 'data', listener: (data: { instanceId: string; data: string }) => void): this;
  off(event: 'conclusion', listener: (result: ConclusionResult) => void): this;
  off(event: 'exit', listener: (data: { instanceId: string; exitCode: number }) => void): this;
  off(event: string | symbol, listener: (...args: any[]) => void): this { return super.off(event, listener); }
}
