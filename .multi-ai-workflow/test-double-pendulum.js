/**
 * 端到端测试：双摆模拟 — 2 个 Claude Code agent 完整三轮
 * 直接调用 CLI，不依赖 Electron
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ── Config ──────────────────────────────────────────────────
const TASK = '使用 Python 模拟一个双摆（double pendulum）系统的运动轨迹。要求：1) 使用拉格朗日力学推导运动方程 2) 用 scipy.integrate.solve_ivp 数值求解 3) 生成动画或轨迹图 4) 分析混沌行为（初始条件敏感性）';

const CLAUDE_PATH = process.env.CLAUDE_CODE_PATH || 'claude';
const { randomUUID } = require('crypto');

const WORK_DIR = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(__dirname, 'test-output');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// 生成 UUID session ID
const SESSION_CC1 = randomUUID();
const SESSION_CC2 = randomUUID();
console.log(`Session cc-1: ${SESSION_CC1}`);
console.log(`Session cc-2: ${SESSION_CC2}`);

// ── Protocol ────────────────────────────────────────────────
const PROTOCOL = `
## 工作协议

1. 请在完整产出末尾，以如下格式给出 **200字以内的结论摘要**：

──結論──
<200字以内的核心方案、关键决策、注意事项>
────────

2. 结论必须简洁——其他 agent 只会阅读你的结论，不会阅读你的完整产出。`;

// ── Utils ───────────────────────────────────────────────────

function extractConclusion(output) {
  const start = output.indexOf('──結論──');
  if (start === -1) {
    const trimmed = output.trim();
    return trimmed.length <= 500 ? trimmed : '…' + trimmed.slice(-500);
  }
  const end = output.indexOf('────────', start + 10);
  if (end === -1) {
    return output.slice(start + 10).trim().slice(0, 500);
  }
  return output.slice(start + 10, end).trim();
}

function spawnClaude(args, label) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    console.log(`\n🚀 [${label}] 启动: claude ${args.slice(0, 3).join(' ')}...`);

    const child = spawn(CLAUDE_PATH, args, {
      cwd: WORK_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(`[${label}] ${text.slice(-100)}`);
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      const duration = Date.now() - startTime;
      console.log(`\n✅ [${label}] 完成 (${(duration/1000).toFixed(1)}s, code=${code})`);
      if (code === 0) {
        resolve({ output: stdout + stderr, duration });
      } else {
        resolve({ output: `[exit code ${code}]\n` + (stdout + stderr).slice(-1000), duration, error: `exit code ${code}` });
      }
    });

    child.on('error', (err) => {
      console.error(`❌ [${label}] 启动失败:`, err.message);
      resolve({ output: '', duration: Date.now() - startTime, error: err.message });
    });
  });
}

function buildPrompt(round, task, conclusions, agentLabel) {
  let header = PROTOCOL;

  if (round === 2) {
    header += '\n3. 本轮是**辩论轮**。以下是各方上一轮的结论对比表。请对每个方案给出评判（同意/反对/改进建议），并在结论中给出综合建议。';
  } else if (round === 3) {
    header += '\n3. 本轮是**决策轮**。以下是辩论结果汇总。请给出最终投票（选择最佳方案）并简述理由。';
  }

  let body = '';
  body += `\n\n你作为: **${agentLabel}**\n\n`;

  if (round === 1) {
    body += `## 任务\n\n${task}`;
  } else if (conclusions) {
    body += `## 各方结论对比\n\n${conclusions}`;
    if (round === 2) {
      body += '\n## 你的任务\n\n分析以上各方方案优劣，给出评判和改进建议。';
    } else {
      body += '\n## 你的任务\n\n基于辩论结果给出最终决策投票和建议。';
    }
  }

  return header + body;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('  双摆模型 — 多 Agent 协作测试');
  console.log('  2 Claude Code agents × 3 轮');
  console.log('═══════════════════════════════════════════');
  console.log(`  任务: ${TASK.slice(0, 60)}...`);

  const results = {
    task: TASK,
    rounds: {},
    startedAt: new Date().toISOString(),
  };

  // ── Round 1: 产出 ──────────────────────────────────────
  console.log('\n\n┌─────────────────────────────────────────┐');
  console.log('│  Round 1: Agent 各自产出方案 + 结论      │');
  console.log('└─────────────────────────────────────────┘');

  const round1Prompts = {
    'cc-1': buildPrompt(1, TASK, null, 'Claude #1（数学建模专家）'),
    'cc-2': buildPrompt(1, TASK, null, 'Claude #2（Python 数值计算专家）'),
  };

  const r1Results = await Promise.all([
    spawnClaude(['-p', round1Prompts['cc-1'], '--session-id', SESSION_CC1, '--output-format', 'text'], 'cc-1'),
    spawnClaude(['-p', round1Prompts['cc-2'], '--session-id', SESSION_CC2, '--output-format', 'text'], 'cc-2'),
  ]);

  const cc1Conclusion = extractConclusion(r1Results[0].output);
  const cc2Conclusion = extractConclusion(r1Results[1].output);

  console.log('\n── Round 1 结论 ──');
  console.log(`\n📋 cc-1: ${cc1Conclusion}`);
  console.log(`\n📋 cc-2: ${cc2Conclusion}`);

  results.rounds[1] = {
    'cc-1': { conclusion: cc1Conclusion, duration: r1Results[0].duration, error: r1Results[0].error },
    'cc-2': { conclusion: cc2Conclusion, duration: r1Results[1].duration, error: r1Results[1].error },
  };

  // Save to file
  fs.writeFileSync(path.join(OUTPUT_DIR, 'round1.json'), JSON.stringify(results.rounds[1], null, 2));

  // ── Round 2: 辩论 ──────────────────────────────────────
  console.log('\n\n┌─────────────────────────────────────────┐');
  console.log('│  Round 2: Agent 互相辩论                  │');
  console.log('└─────────────────────────────────────────┘');

  const conclusionTable =
`| Agent | 结论 |
|-------|------|
| Claude #1（数学建模专家） | ${cc1Conclusion.replace(/\n/g, ' ')} |
| Claude #2（Python 数值计算专家） | ${cc2Conclusion.replace(/\n/g, ' ')} |`;

  console.log('\n📊 结论对比表:');
  console.log(conclusionTable);

  const round2Prompts = {
    'cc-1': buildPrompt(2, TASK, conclusionTable, 'Claude #1（数学建模专家）'),
    'cc-2': buildPrompt(2, TASK, conclusionTable, 'Claude #2（Python 数值计算专家）'),
  };

  // Resume sessions
  const r2Results = await Promise.all([
    spawnClaude(['--resume', SESSION_CC1, '-p', round2Prompts['cc-1'], '--output-format', 'text'], 'cc-1'),
    spawnClaude(['--resume', SESSION_CC2, '-p', round2Prompts['cc-2'], '--output-format', 'text'], 'cc-2'),
  ]);

  const cc1Debate = extractConclusion(r2Results[0].output);
  const cc2Debate = extractConclusion(r2Results[1].output);

  console.log('\n── Round 2 辩论结果 ──');
  console.log(`\n🔍 cc-1 评判: ${cc1Debate}`);
  console.log(`\n🔍 cc-2 评判: ${cc2Debate}`);

  results.rounds[2] = {
    'cc-1': { conclusion: cc1Debate, duration: r2Results[0].duration, error: r2Results[0].error },
    'cc-2': { conclusion: cc2Debate, duration: r2Results[1].duration, error: r2Results[1].error },
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'round2.json'), JSON.stringify(results.rounds[2], null, 2));

  // ── Round 3: 决策 ──────────────────────────────────────
  console.log('\n\n┌─────────────────────────────────────────┐');
  console.log('│  Round 3: Agent 最终决策                  │');
  console.log('└─────────────────────────────────────────┘');

  const debateSummary =
`## 辩论汇总

### Claude #1 的观点
${cc1Debate}

### Claude #2 的观点
${cc2Debate}

---
## 决策任务
以上是各 agent 对双摆模拟方案的辩论意见。请给出最终投票和建议。`;

  const round3Prompts = {
    'cc-1': buildPrompt(3, TASK, debateSummary, 'Claude #1（数学建模专家）'),
    'cc-2': buildPrompt(3, TASK, debateSummary, 'Claude #2（Python 数值计算专家）'),
  };

  const r3Results = await Promise.all([
    spawnClaude(['--resume', SESSION_CC1, '-p', round3Prompts['cc-1'], '--output-format', 'text'], 'cc-1'),
    spawnClaude(['--resume', SESSION_CC2, '-p', round3Prompts['cc-2'], '--output-format', 'text'], 'cc-2'),
  ]);

  const cc1Decision = extractConclusion(r3Results[0].output);
  const cc2Decision = extractConclusion(r3Results[1].output);

  console.log('\n── Round 3 最终决策 ──');
  console.log(`\n🏆 cc-1 决策: ${cc1Decision}`);
  console.log(`\n🏆 cc-2 决策: ${cc2Decision}`);

  results.rounds[3] = {
    'cc-1': { conclusion: cc1Decision, duration: r3Results[0].duration, error: r3Results[0].error },
    'cc-2': { conclusion: cc2Decision, duration: r3Results[1].duration, error: r3Results[1].error },
  };
  fs.writeFileSync(path.join(OUTPUT_DIR, 'round3.json'), JSON.stringify(results.rounds[3], null, 2));

  // ── 总结 ──────────────────────────────────────────────
  const totalDuration = Object.values(results.rounds).reduce((sum, round) => {
    return sum + Object.values(round).reduce((s, r) => s + (r.duration || 0), 0);
  }, 0);

  console.log('\n\n═══════════════════════════════════════════');
  console.log('  测试完成!');
  console.log(`  总耗时: ${(totalDuration/1000).toFixed(1)}s`);
  console.log(`  输出: ${OUTPUT_DIR}`);
  console.log('═══════════════════════════════════════════');

  results.completedAt = new Date().toISOString();
  results.totalDurationMs = totalDuration;
  fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.json'), JSON.stringify(results, null, 2));
}

main().catch(console.error);
