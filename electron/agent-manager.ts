/**
 * Agent Manager — spawn CLI 进程、管理会话、提取结论
 *
 * 职责：
 * 1. 注册 agent（claude / codex）
 * 2. spawn 非交互 CLI 进程，用 session 保持上下文
 * 3. 提取输出中的 [结论] 部分
 * 4. 通知 workflow engine agent 完成
 */

import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { SessionStore, RoundRecord } from './session-store';

// ── Types ──────────────────────────────────────────────────────

export type AgentType = 'claude' | 'codex';

export type AgentStatus = 'idle' | 'working' | 'done' | 'error';

export interface AgentConfig {
  id: string;
  type: AgentType;
  label: string;
  workDir: string;
  enabled: boolean;
  /** 可选：自定义 CLI 路径 */
  cliPath?: string;
}

export interface AgentResult {
  agentId: string;
  round: number;
  fullOutput: string;
  conclusion: string;
  durationMs: number;
  error?: string;
}

export type AgentEventCallback = (event: AgentResult) => void;

// ── CLI Discovery ──────────────────────────────────────────────

function findClaudeCodePath(): string | null {
  // 1. 环境变量优先
  if (process.env.CLAUDE_CODE_PATH) return process.env.CLAUDE_CODE_PATH;

  // 2. PATH 中查找
  const pathExts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const searchName = 'claude';
  if (process.platform === 'win32') {
    for (const ext of pathExts) {
      try {
        const result = require('child_process').execSync(`where ${searchName}${ext} 2>nul`, { encoding: 'utf-8' });
        const lines = result.trim().split('\n');
        if (lines[0] && !lines[0].toLowerCase().includes('could not find')) return lines[0].trim();
      } catch {}
    }
  }

  // 3. 已知安装路径
  const knownPaths: Record<string, string[]> = {
    win32: [
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages', 'Anthropic.ClaudeCode_Microsoft.Winget.Source_8wekyb3d8bbwe'),
    ],
    darwin: ['/usr/local/bin/claude', path.join(process.env.HOME || '', '.local/bin/claude')],
    linux: ['/usr/bin/claude', path.join(process.env.HOME || '', '.local/bin/claude')],
  };

  const platformPaths = knownPaths[process.platform] || [];

  for (const dir of platformPaths) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      // winget 安装是目录，需要找里面的 claude.exe
      const exePath = path.join(dir, 'claude.exe');
      if (fs.existsSync(exePath)) return exePath;
    }
    if (fs.existsSync(dir)) return dir;
  }

  return null;
}

function findCodexPath(): string | null {
  if (process.env.CODEX_PATH) return process.env.CODEX_PATH;

  // 1. PATH 中查找
  try {
    const result = require('child_process').execSync(
      process.platform === 'win32' ? 'where codex 2>nul' : 'which codex 2>/dev/null',
      { encoding: 'utf-8' }
    );
    const line = result.trim().split('\n')[0];
    if (line && !line.toLowerCase().includes('could not find')) return line.trim();
  } catch {}

  // 2. OpenAI 桌面应用安装路径
  const openAiCodexDir = path.join(
    process.env.LOCALAPPDATA || process.env.HOME || '',
    'OpenAI', 'Codex', 'bin'
  );
  if (fs.existsSync(openAiCodexDir)) {
    // 找最新版本目录
    const dirs = fs.readdirSync(openAiCodexDir).filter(d => /^[a-f0-9]+$/.test(d));
    for (const dir of dirs) {
      const exePath = path.join(openAiCodexDir, dir, 'codex.exe');
      if (fs.existsSync(exePath)) return exePath;
    }
  }

  // 3. npm global
  const npmPaths = process.platform === 'win32'
    ? [path.join(process.env.APPDATA || '', 'npm', 'codex.cmd')]
    : ['/usr/local/bin/codex', path.join(process.env.HOME || '', '.local/bin/codex')];

  for (const p of npmPaths) {
    if (fs.existsSync(p)) return p;
  }

  return null;
}

// ── Conclusion Extraction ──────────────────────────────────────

const CONCLUSION_START = '──结论──';
const CONCLUSION_END = '────────';

export function extractConclusion(fullOutput: string): string {
  const startIdx = fullOutput.indexOf(CONCLUSION_START);
  if (startIdx === -1) {
    // 没有标记，返回最后 500 字作为摘要
    const trimmed = fullOutput.trim();
    if (trimmed.length <= 500) return trimmed;
    return '…' + trimmed.slice(-500);
  }

  const endIdx = fullOutput.indexOf(CONCLUSION_END, startIdx + CONCLUSION_START.length);
  if (endIdx === -1) {
    // 有开始标记没结束标记：取开始标记之后所有内容
    const conclusion = fullOutput.slice(startIdx + CONCLUSION_START.length).trim();
    return conclusion.length <= 500 ? conclusion : conclusion.slice(0, 500) + '…';
  }

  return fullOutput.slice(startIdx + CONCLUSION_START.length, endIdx).trim();
}

/**
 * 拼接完整的 Agent prompt：协议指令 + 轮次上下文
 */
export function buildAgentPrompt(
  round: number,
  userTask: string,
  conclusions: string | null, // 上一轮的结论汇总（Round 2/3 用）
  agentRole: string
): string {
  const protocolHeader = [
    '## 工作协议',
    '',
    '1. 请在你的完整产出末尾，以以下格式给出 200 字以内的结论摘要：',
    '',
    '──结论──',
    '<200字以内的核心方案、关键决策、注意事项>',
    '────────',
    '',
    '2. 结论必须简洁——其他 agent 只会阅读你的结论，不会阅读你的完整产出。',
  ];

  if (round === 2) {
    protocolHeader.push(
      '',
      '3. 本轮是**辩论轮**。以下是各方上一轮的结论对比表。',
      '   请对每个方案给出你的评判：同意 / 反对 / 改进建议。',
      '   在你的结论中给出综合建议。'
    );
  } else if (round === 3) {
    protocolHeader.push(
      '',
      '3. 本轮是**决策轮**。以下是辩论结果汇总。',
      '   请给出你的最终投票（选择最佳方案），并简述理由。',
      '   在你的结论中给出最终建议。'
    );
  }

  const parts: string[] = [];
  parts.push(protocolHeader.join('\n'));
  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push(`你作为: **${agentRole}**`);

  if (round === 1) {
    parts.push('');
    parts.push('## 任务');
    parts.push('');
    parts.push(userTask);
  } else if (conclusions) {
    parts.push('');
    parts.push('## 各方结论对比（上一轮）');
    parts.push('');
    parts.push(conclusions);
    if (round === 2) {
      parts.push('');
      parts.push('## 你的任务');
      parts.push('');
      parts.push('分析以上各方方案，指出各自优劣，给出你的评判和改进建议。');
    } else {
      parts.push('');
      parts.push('## 你的任务');
      parts.push('');
      parts.push('基于以上辩论结果，给出最终决策投票和建议。');
    }
  }

  return parts.join('\n');
}

// ── Agent Manager ──────────────────────────────────────────────

export class AgentManager {
  private agents: Map<string, AgentConfig> = new Map();
  private sessionStore: SessionStore;
  private claudePath: string | null = null;
  private codexPath: string | null = null;

  constructor(sessionStore: SessionStore) {
    this.sessionStore = sessionStore;
  }

  // ── Agent 注册 ────────────────────────────────────────────

  registerAgent(config: AgentConfig): void {
    this.agents.set(config.id, config);

    // 恢复已有的 session（如果存在）
    const existing = this.sessionStore.load(config.id);
    if (!existing) {
      // Claude 需要 UUID 作为 session ID
      const nativeSessionId = config.type === 'claude' ? randomUUID() : null;
      this.sessionStore.save({
        agentId: config.id,
        type: config.type,
        label: config.label,
        workDir: config.workDir,
        nativeSessionId,
        rounds: [],
        lastActiveAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
    }

    // 自动发现 CLI 路径
    if (config.type === 'claude' && !this.claudePath) {
      this.claudePath = config.cliPath || findClaudeCodePath();
      console.log(`[AgentManager] Claude Code path: ${this.claudePath}`);
    }
    if (config.type === 'codex' && !this.codexPath) {
      this.codexPath = config.cliPath || findCodexPath();
      console.log(`[AgentManager] Codex path: ${this.codexPath}`);
    }
  }

  unregisterAgent(agentId: string): void {
    this.agents.delete(agentId);
  }

  getAgent(agentId: string): AgentConfig | undefined {
    return this.agents.get(agentId);
  }

  listAgents(): AgentConfig[] {
    return Array.from(this.agents.values());
  }

  isAvailable(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    if (agent.type === 'claude' && !this.claudePath) return false;
    if (agent.type === 'codex' && !this.codexPath) return false;
    return true;
  }

  /** 检查所有 agent CLI 是否可用 */
  checkAllAvailability(): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    for (const [id] of this.agents) {
      result[id] = this.isAvailable(id);
    }
    return result;
  }

  // ── CLI 调用 ──────────────────────────────────────────────

  /**
   * 让一个 agent 执行一轮任务
   * - Round 1（产出）：agent 收到任务，产出完整方案 + 结论
   * - Round 2（辩论）：agent 收到结论对比表，评判各方方案
   * - Round 3（决策）：agent 收到辩论汇总，投票决策
   *
   * @returns AgentResult，包含 fullOutput 和 conclusion
   */
  async runAgentRound(
    agentId: string,
    round: number,
    userTask: string,
    conclusions: string | null,
    onStatusChange?: (status: AgentStatus) => void,
    signal?: AbortSignal
  ): Promise<AgentResult> {
    const agent = this.agents.get(agentId);
    if (!agent) return { agentId, round, fullOutput: '', conclusion: '', durationMs: 0, error: `Agent ${agentId} 未注册` };

    if (signal?.aborted) {
      return { agentId, round, fullOutput: '', conclusion: '', durationMs: 0, error: '已取消' };
    }

    onStatusChange?.('working');

    const cliPath = agent.type === 'claude' ? this.claudePath : this.codexPath;
    if (!cliPath) {
      onStatusChange?.('error');
      return { agentId, round, fullOutput: '', conclusion: '', durationMs: 0, error: `${agent.type === 'claude' ? 'Claude Code' : 'Codex'} CLI 未找到` };
    }

    const sessionRecord = this.sessionStore.load(agentId);
    const prompt = buildAgentPrompt(round, userTask, conclusions, agent.label);

    const args = this.buildCliArgs(agent, prompt, sessionRecord?.nativeSessionId);
    const startTime = Date.now();

    try {
      const fullOutput = await this.spawnAndCollect(cliPath, args, agent.workDir, signal);
      const conclusion = extractConclusion(fullOutput);
      const durationMs = Date.now() - startTime;

      // 首次调用时提取 Codex session ID（Codex 返回 JSON 中有 session_id）
      if (agent.type === 'codex' && !sessionRecord?.nativeSessionId) {
        const extractedId = this.extractCodexSessionId(fullOutput);
        if (extractedId) {
          this.sessionStore.updateSessionId(agentId, extractedId);
        }
      }

      // 持久化
      const roundRecord: RoundRecord = {
        round,
        taskId: `task_${Date.now()}`,
        prompt,
        fullOutput,
        conclusion,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs,
      };
      this.sessionStore.appendRound(agentId, roundRecord);

      onStatusChange?.('done');

      return { agentId, round, fullOutput, conclusion, durationMs };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      onStatusChange?.('error');
      return {
        agentId,
        round,
        fullOutput: '',
        conclusion: '',
        durationMs,
        error: err?.message || String(err),
      };
    }
  }

  private buildCliArgs(agent: AgentConfig, prompt: string, sessionId: string | null | undefined): string[] {
    if (agent.type === 'claude') {
      const args: string[] = [];
      // 指定工作目录
      args.push('--add-dir', agent.workDir);
      // 非交互模式：绕过权限提示（否则 agent 卡死等待批准）
      args.push('--permission-mode', 'bypassPermissions');
      // 纯文本输出
      args.push('--output-format', 'text');

      if (sessionId) {
        // 已有 session → resume
        args.push('--resume', sessionId, '-p', prompt);
      } else {
        // 首次 → 使用预生成的 UUID
        const record = this.sessionStore.load(agent.id);
        const uuid = record?.nativeSessionId || randomUUID();
        args.push('--session-id', uuid, '-p', prompt);
      }
      return args;
    } else {
      // codex
      if (sessionId) {
        return ['exec', 'resume', sessionId, prompt];
      } else {
        return ['exec', '--skip-git-repo-check', prompt];
      }
    }
  }

  private spawnAndCollect(
    cliPath: string,
    args: string[],
    workDir: string,
    signal?: AbortSignal
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let allChunks = '';

      const child = spawn(cliPath, args, {
        cwd: workDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
        // 加一个超时，防止 CLI 卡死
        timeout: 300000, // 5分钟超时
      });

      child.stdout?.on('data', (chunk: Buffer) => {
        allChunks += chunk.toString('utf-8');
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        // stderr 在 CLI 中可能是进度信息，也收集起来
        allChunks += chunk.toString('utf-8');
      });

      child.on('close', (code: number | null) => {
        if (code === 0) {
          resolve(allChunks);
        } else {
          reject(new Error(`CLI exited with code ${code}\n${allChunks.slice(-500)}`));
        }
      });

      child.on('error', (err: Error) => {
        reject(err);
      });

      // 支持外部取消
      if (signal) {
        const onAbort = () => {
          child.kill('SIGTERM');
          setTimeout(() => {
            try { child.kill('SIGKILL'); } catch {}
          }, 3000);
          reject(new Error('已取消'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  private extractCodexSessionId(output: string): string | null {
    // Codex --json 模式下，每行一个 JSON 对象，最后一条包含 session_id
    // 简单正则匹配
    const match = output.match(/"session_id"\s*:\s*"([a-f0-9-]{36})"/);
    return match ? match[1] : null;
  }

  /**
   * 并行运行所有启用的 agent 的同一轮
   */
  async runAllAgentsRound(
    round: number,
    userTask: string,
    conclusions: string | null,
    onStatusChange?: (agentId: string, status: AgentStatus) => void,
    signal?: AbortSignal
  ): Promise<AgentResult[]> {
    const enabledAgents = this.listAgents().filter((a) => a.enabled);

    if (enabledAgents.length === 0) {
      return [];
    }

    const tasks = enabledAgents.map((agent) =>
      this.runAgentRound(
        agent.id,
        round,
        userTask,
        conclusions,
        (status) => onStatusChange?.(agent.id, status),
        signal
      )
    );

    return Promise.all(tasks);
  }

  /**
   * 构建结论对比表（Markdown 表格）
   */
  buildConclusionTable(results: AgentResult[]): string {
    const valid = results.filter((r) => r.conclusion && !r.error);
    if (valid.length === 0) return '(无有效结论)';

    let table = '| Agent | 结论 |\n|-------|------|\n';
    for (const r of valid) {
      const agent = this.agents.get(r.agentId);
      const label = agent?.label || r.agentId;
      // 结论中换行转空格，避免破坏表格
      const conclusion = r.conclusion.replace(/\n/g, ' ').replace(/\|/g, '\\|');
      table += `| ${label} | ${conclusion} |\n`;
    }
    table += '\n';

    // 额外：附带错误信息
    const errors = results.filter((r) => r.error);
    if (errors.length > 0) {
      table += '### 异常\n\n';
      for (const e of errors) {
        const agent = this.agents.get(e.agentId);
        table += `- **${agent?.label || e.agentId}**: ${e.error}\n`;
      }
    }

    return table;
  }
}
