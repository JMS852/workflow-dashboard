/**
 * WorkflowEngine v3 — PTY 驱动三轮对抗式工作流
 *
 * 不依赖 AgentManager。改为通过 PtyManager.broadcast() 发送消息，
 * 用 PtyManager.waitForConclusions() 等待响应，
 * 用 MessengerBrain 处理结论（提取/去重/打包）。
 */

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

  private readonly ROUND_TIMEOUT = 300000; // 5 分钟超时

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

    // 发送任务到所有 AI
    const taskPrompt = [
      '───────────────────────────────',
      `任务：${task}`,
      '',
      '请给出你的方案。精简方法描述，用 200 字以内的核心结论回复。',
      '请用 ──结论── 和 ──────── 包裹你的结论。',
      '───────────────────────────────',
    ].join('\n');

    await this.transitionTo('round_1_produce');
    await this.executeRound(1, taskPrompt);
  }

  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.state = 'idle';
    this.currentTask = null;
    this.emit('state_change', this.getStatus());
  }

  private async transitionTo(newState: WorkflowState): Promise<void> {
    this.state = newState;
    this.emit('state_change', this.getStatus());
  }

  private async executeRound(round: number, prompt: string): Promise<void> {
    const signal = this.abortController?.signal;
    if (signal?.aborted) {
      await this.transitionTo('idle');
      return;
    }

    // 每轮开始前重置 conclusion 缓冲，使新结论能再次触发
    this.ptyManager.resetForNewRound();

    // 注入 prompt → 等待结论
    const waitPromise = this.ptyManager.waitForConclusions(this.ROUND_TIMEOUT);
    this.ptyManager.broadcast(prompt);
    const results = await waitPromise;

    if (signal?.aborted) {
      await this.transitionTo('idle');
      return;
    }

    this.roundResults.set(round, results);

    // 通知前端每个结论
    for (const r of results) {
      this.emit('conclusion_detected', {
        windowId: r.instanceId,
        label: r.label,
        conclusion: r.conclusion,
        round,
      });
    }

    // 信差 LLM 处理本轮结论
    if (results.length > 0 && this.currentTask) {
      const processed = await this.messengerBrain.processRound(
        results.map((r) => ({
          instanceId: r.instanceId,
          label: r.label,
          type: r.type,
          conclusion: r.conclusion,
          fullOutput: r.fullOutput,
        })),
        round,
        this.currentTask,
      );

      // 构建转发消息
      const forwardMessage = this.messengerBrain.buildForwardMessage(
        processed,
        round,
        this.currentTask,
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
          this.emit('round_progress', {
            round: 2,
            completedCount: 0,
            totalCount: this.ptyManager.getAllInstances().length,
            status: 'waiting',
          });
          await this.executeRound(2, forwardMessage);
          break;
        case 2:
          this.emit('debate_result', { results, summary: processed });
          await this.transitionTo('round_3_decide');
          this.emit('round_progress', {
            round: 3,
            completedCount: 0,
            totalCount: this.ptyManager.getAllInstances().length,
            status: 'waiting',
          });
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

  // ── EventEmitter 类型重载 ──────────────────────────────────

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
