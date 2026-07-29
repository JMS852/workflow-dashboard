/**
 * MessengerBrain — DeepSeek LLM 信差大脑 (v3)
 *
 * 职责：调用 DeepSeek API，做消息的提取、去重、精简、打包。
 * 信差不生产 AI 内容——只做秘书工作。
 */

export interface ConclusionItem {
  instanceId: string;
  label: string;
  type: 'claude' | 'codex';
  conclusion: string;
  fullOutput: string;
}

export interface DeduplicatedResult {
  conclusion: string;
  labels: string[];
  isDuplicate: boolean;
  originalConclusions: ConclusionItem[];
}

const DEEPSEEK_API = 'https://api.deepseek.com/v1/chat/completions';

const ROUND_PROMPTS: Record<number, string> = {
  1: `你是一个消息整理助手。以下是对同一个任务的多个 AI 的方案结论。
请完成以下工作：
1. 提取每个 AI 的核心方案（一句话，不超过 50 字）
2. 如果多个 AI 说了同一件事，合并他们并标注"AI #1、AI #2 意见一致"
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
    taskDescription: string,
  ): Promise<string> {
    // 先尝试纯规则提取——有结论标记的直接用
    const validOnes = conclusions.filter((c) => c.conclusion && c.conclusion.length > 5);

    if (validOnes.length === 0) {
      // 没有检测到结论标记 → LLM 全额处理
      return this.askLLM(
        ROUND_PROMPTS[round] || ROUND_PROMPTS[1],
        [
          `任务：${taskDescription}`,
          '',
          '各 AI 输出：',
          ...conclusions.map(
            (c) => `### ${c.label} (${c.type})\n${c.fullOutput.slice(0, 3000)}`,
          ),
        ].join('\n'),
      );
    }

    // 有结论 → 先做去重，再让 LLM 整理
    const deduplicated = await this.deduplicateFromLLM(validOnes);

    // 构建精简的 LLM prompt
    const userContent = [
      `任务：${taskDescription}`,
      '',
      ...deduplicated.map((d) => {
        if (d.isDuplicate) {
          return `${d.labels.join('、')} 意见一致：${d.conclusion}`;
        }
        return `${d.labels[0]}：${d.conclusion}`;
      }),
    ].join('\n');

    return this.askLLM(ROUND_PROMPTS[round] || ROUND_PROMPTS[1], userContent);
  }

  /**
   * 让 LLM 做去重
   */
  private async deduplicateFromLLM(
    conclusions: ConclusionItem[],
  ): Promise<DeduplicatedResult[]> {
    const prompt = [
      '以下是对同一任务的多个方案结论。请判断哪些说的大致相同，进行分类。',
      '',
      ...conclusions.map((c, i) => `[${i}] ${c.label}：${c.conclusion}`),
      '',
      '请输出 JSON 数组，每个元素包含：indices（相同结论的索引列表）、summary（合并后的摘要）。',
      '只输出 JSON，不要其他内容。',
    ].join('\n');

    try {
      const response = await this.askLLM('你是一个文本去重助手。严格只输出 JSON。', prompt);
      // 尝试提取 JSON（可能包裹在 ```json ... ``` 中）
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) || response.match(/(\[[\s\S]*\])/);
      const jsonStr = jsonMatch ? jsonMatch[1] : response;
      const parsed = JSON.parse(jsonStr.trim());
      return parsed.map(
        (item: { indices: number[]; summary: string }) => ({
          conclusion: item.summary,
          labels: item.indices.map((i: number) => conclusions[i].label),
          isDuplicate: item.indices.length > 1,
          originalConclusions: item.indices.map((i: number) => conclusions[i]),
        }),
      );
    } catch {
      // LLM 解析失败 → 返回原始不做去重
      return conclusions.map((c) => ({
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
  buildForwardMessage(processedContent: string, round: number, taskDescription: string): string {
    return [
      '───────────────────────────────',
      `以下是信差整理的结果（Round ${round}）：`,
      '',
      processedContent,
      '',
      '───────────────────────────────',
      '请按要求回复。精简你的方法描述，用 200 字以内的核心结论。',
      '请用 ──结论── 和 ──────── 包裹你的结论。',
    ].join('\n');
  }

  /**
   * 直接调用 DeepSeek API
   */
  private async askLLM(systemPrompt: string, userContent: string): Promise<string> {
    const response = await fetch(DEEPSEEK_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
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

    const data = (await response.json()) as any;
    return data.choices?.[0]?.message?.content || '';
  }
}
