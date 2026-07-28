/**
 * Session Store — 持久化 agent session ID 和对话历史
 *
 * 每个 agent 一个 JSON 文件，存在 .multi-ai-workflow/sessions/<agentId>.json
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Types ──────────────────────────────────────────────────────

export interface AgentSessionRecord {
  agentId: string;
  type: 'claude' | 'codex';
  label: string;
  workDir: string;
  /** CLI 原生的 session ID（Claude 是自定义字符串，Codex 是 UUID） */
  nativeSessionId: string | null;
  /** 各轮次的记录 */
  rounds: RoundRecord[];
  /** 最后一次活跃时间 (ISO) */
  lastActiveAt: string;
  createdAt: string;
}

export interface RoundRecord {
  round: number; // 1=产出, 2=辩论, 3=决策
  taskId: string;
  prompt: string;
  fullOutput: string;
  conclusion: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

// ── Store ──────────────────────────────────────────────────────

export class SessionStore {
  private sessionsDir: string;
  private cache: Map<string, AgentSessionRecord> = new Map();
  private initialized = false;

  constructor(projectDir: string | null) {
    this.sessionsDir = projectDir
      ? path.join(projectDir, '.multi-ai-workflow', 'sessions')
      : '';
  }

  setProjectDir(dir: string): void {
    this.sessionsDir = path.join(dir, '.multi-ai-workflow', 'sessions');
    this.cache.clear();
    this.initialized = false;
  }

  private ensureDir(): void {
    if (!this.sessionsDir) return;
    if (!this.initialized) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
      this.initialized = true;
    }
  }

  private filePath(agentId: string): string {
    return path.join(this.sessionsDir, `${agentId}.json`);
  }

  // ── CRUD ──────────────────────────────────────────────────

  /** 创建或更新 agent session 记录 */
  save(record: AgentSessionRecord): void {
    this.ensureDir();
    record.lastActiveAt = new Date().toISOString();
    this.cache.set(record.agentId, record);
    fs.writeFileSync(this.filePath(record.agentId), JSON.stringify(record, null, 2), 'utf-8');
  }

  /** 读取单个 agent 的 session */
  load(agentId: string): AgentSessionRecord | null {
    if (this.cache.has(agentId)) return this.cache.get(agentId)!;

    try {
      const raw = fs.readFileSync(this.filePath(agentId), 'utf-8');
      const record = JSON.parse(raw) as AgentSessionRecord;
      this.cache.set(agentId, record);
      return record;
    } catch {
      return null;
    }
  }

  /** 列出所有已知 agent session */
  listAll(): AgentSessionRecord[] {
    if (!this.sessionsDir) return [];
    this.ensureDir();

    const ids = new Set<string>();
    try {
      const files = fs.readdirSync(this.sessionsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const agentId = file.replace(/\.json$/, '');
        ids.add(agentId);
      }
    } catch {
      return [];
    }

    return Array.from(ids)
      .map((id) => this.load(id))
      .filter((r): r is AgentSessionRecord => r !== null);
  }

  /** 删除某个 agent session */
  delete(agentId: string): void {
    this.cache.delete(agentId);
    try {
      fs.unlinkSync(this.filePath(agentId));
    } catch {
      // ignore not-found
    }
  }

  /** 追加一轮 round 到已有记录 */
  appendRound(agentId: string, round: RoundRecord): void {
    const record = this.load(agentId);
    if (record) {
      record.rounds.push(round);
      this.save(record);
    }
  }

  /** 更新 agent 的 nativeSessionId */
  updateSessionId(agentId: string, nativeSessionId: string): void {
    const record = this.load(agentId);
    if (record) {
      record.nativeSessionId = nativeSessionId;
      this.save(record);
    }
  }
}
