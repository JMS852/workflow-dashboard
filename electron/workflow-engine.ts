/**
 * Workflow Engine — MQTT-3388 事件驱动状态机
 *
 * agent 的产出 = 事件，事件自动触发下一轮。
 * 不设中央调度器阻塞等待——每个 agent 完成后独立报告，
 * 当所有 agent 完成当前轮次时，自动推进到下一轮。
 */

import { AgentManager, AgentResult, AgentStatus } from './agent-manager';
import { EventEmitter } from 'events';

// ── Types ──────────────────────────────────────────────────────

export type WorkflowState =
  | 'idle'
  | 'round_1_produce'   // agent 各自产出方案 + 结论
  | 'round_2_debate'     // agent 阅读结论表，互相辩论
  | 'round_3_decide'     // agent 投票决策
  | 'complete';

export interface WorkflowStatus {
  state: WorkflowState;
  currentTask: string | null;
  currentRound: number;
  roundResults: Record<string, AgentResult[]>; // round number → agent results
  agentStatuses: Record<string, AgentStatus>;
  error?: string;
}

export type WorkflowEvent =
  | 'state_change'
  | 'agent_status_change'
  | 'conclusion_table_ready'
  | 'debate_result'
  | 'final_decision'
  | 'error';

// ── Engine ─────────────────────────────────────────────────────

export class WorkflowEngine extends EventEmitter {
  private agentManager: AgentManager;
  private state: WorkflowState = 'idle';
  private currentTask: string | null = null;
  private roundResults: Map<number, AgentResult[]> = new Map();
  private agentStatuses: Map<string, AgentStatus> = new Map();
  private abortController: AbortController | null = null;

  constructor(agentManager: AgentManager) {
    super();
    this.agentManager = agentManager;
  }

  // ── Public API ──────────────────────────────────────────────

  getStatus(): WorkflowStatus {
    const roundResultsObj: Record<string, AgentResult[]> = {};
    for (const [k, v] of this.roundResults) {
      roundResultsObj[String(k)] = v;
    }

    const agentStatusesObj: Record<string, AgentStatus> = {};
    for (const [k, v] of this.agentStatuses) {
      agentStatusesObj[k] = v;
    }

    return {
      state: this.state,
      currentTask: this.currentTask,
      currentRound: this.getRoundNumber(),
      roundResults: roundResultsObj,
      agentStatuses: agentStatusesObj,
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

  /**
   * 启动新工作流——用户提交任务
   */
  async startTask(task: string): Promise<void> {
    if (this.state !== 'idle' && this.state !== 'complete') {
      this.emit('error', { error: '已有工作流正在运行，请等待完成或取消' });
      return;
    }

    this.currentTask = task;
    this.roundResults.clear();
    this.agentStatuses.clear();
    this.abortController = new AbortController();

    await this.transitionTo('round_1_produce');
    this.emit('state_change', this.getStatus());

    // Round 1: 所有 agent 产出方案
    await this.executeRound(1, task, null);
  }

  /**
   * 取消当前工作流
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.state = 'idle';
    this.currentTask = null;
    this.emit('state_change', this.getStatus());
  }

  /**
   * 跳过某个 agent（手动操作）
   */
  skipAgent(agentId: string): void {
    this.agentStatuses.set(agentId, 'done');
    this.emit('agent_status_change', { agentId, status: 'done' });
  }

  // ── Internal ─────────────────────────────────────────────────

  private async transitionTo(newState: WorkflowState): Promise<void> {
    this.state = newState;
    this.emit('state_change', this.getStatus());
  }

  /**
   * 执行一轮：并行跑所有 agent，等全部完成后自动进入下一轮
   */
  private async executeRound(
    round: number,
    userTask: string,
    conclusions: string | null
  ): Promise<void> {
    const signal = this.abortController?.signal;

    // 初始化所有 agent 状态
    for (const agent of this.agentManager.listAgents()) {
      if (agent.enabled) {
        this.agentStatuses.set(agent.id, 'idle');
      }
    }

    const results = await this.agentManager.runAllAgentsRound(
      round,
      userTask,
      conclusions,
      (agentId, status) => {
        this.agentStatuses.set(agentId, status);
        this.emit('agent_status_change', { agentId, status, round });
      },
      signal
    );

    // 检查是否被取消
    if (signal?.aborted) {
      await this.transitionTo('idle');
      return;
    }

    this.roundResults.set(round, results);

    // 构建结论表
    const conclusionTable = this.agentManager.buildConclusionTable(results);
    this.emit('conclusion_table_ready', { round, table: conclusionTable, results });

    // 根据当前轮次决定下一步
    switch (round) {
      case 1: {
        // Round 1 完成 → 自动进入 Round 2（辩论）
        await this.transitionTo('round_2_debate');
        this.emit('state_change', this.getStatus());
        await this.executeRound(2, userTask, conclusionTable);
        break;
      }
      case 2: {
        // Round 2 完成 → 自动进入 Round 3（决策）
        // 构建辩论汇总
        const debateSummary = this.buildDebateSummary(results, conclusionTable);
        this.emit('debate_result', { results, summary: debateSummary });
        await this.transitionTo('round_3_decide');
        this.emit('state_change', this.getStatus());
        await this.executeRound(3, userTask, debateSummary);
        break;
      }
      case 3: {
        // Round 3 完成 → 结束
        // 构建最终决策
        const finalDecision = this.buildFinalDecision(results);
        this.emit('final_decision', { results, decision: finalDecision });
        await this.transitionTo('complete');
        this.emit('state_change', this.getStatus());
        break;
      }
    }
  }

  private buildDebateSummary(results: AgentResult[], previousTable: string): string {
    const parts: string[] = [];
    parts.push('## 本轮辩论汇总\n');

    for (const r of results) {
      const agent = this.agentManager.getAgent(r.agentId);
      const label = agent?.label || r.agentId;

      parts.push(`### ${label} 的观点`);
      if (r.error) {
        parts.push(`(出错: ${r.error})\n`);
      } else {
        parts.push(r.conclusion || r.fullOutput.slice(0, 500));
      }
      parts.push('');
    }

    parts.push('---');
    parts.push('');
    parts.push('## 决策任务');
    parts.push('');
    parts.push('以上是各 agent 对各方方案的辩论意见。请给你认为最佳的方案投票，并给出最终建议。');

    return parts.join('\n');
  }

  private buildFinalDecision(results: AgentResult[]): string {
    const parts: string[] = [];
    parts.push('## 最终决策\n');

    for (const r of results) {
      const agent = this.agentManager.getAgent(r.agentId);
      const label = agent?.label || r.agentId;

      parts.push(`### ${label}`);
      if (r.error) {
        parts.push(`*异常: ${r.error}*\n`);
      } else {
        parts.push(r.conclusion);
      }
      parts.push('');
    }

    return parts.join('\n');
  }

  // ── Event overloads for TypeScript ─────────────────────────

  emit(event: 'state_change', data: WorkflowStatus): boolean;
  emit(event: 'agent_status_change', data: { agentId: string; status: AgentStatus; round?: number }): boolean;
  emit(event: 'conclusion_table_ready', data: { round: number; table: string; results: AgentResult[] }): boolean;
  emit(event: 'debate_result', data: { results: AgentResult[]; summary: string }): boolean;
  emit(event: 'final_decision', data: { results: AgentResult[]; decision: string }): boolean;
  emit(event: 'error', data: { error: string }): boolean;
  emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  on(event: 'state_change', listener: (data: WorkflowStatus) => void): this;
  on(event: 'agent_status_change', listener: (data: { agentId: string; status: AgentStatus; round?: number }) => void): this;
  on(event: 'conclusion_table_ready', listener: (data: { round: number; table: string; results: AgentResult[] }) => void): this;
  on(event: 'debate_result', listener: (data: { results: AgentResult[]; summary: string }) => void): this;
  on(event: 'final_decision', listener: (data: { results: AgentResult[]; decision: string }) => void): this;
  on(event: 'error', listener: (data: { error: string }) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
}
