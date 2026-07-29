# 信差平台 v3.0 — 设计文档

> 日期: 2026-07-29 | 状态: 待验收 | 项目: workflow-dashboard

## 1. 产品定位

**信差不生产 AI 内容，只做消息路由。**

一个桌面应用，用户选择 AI 工具和数量后，信差自动打开多个 AI 终端窗口（Claude Code CLI / Codex CLI），在它们之间执行三轮对抗式工作流（产出 → 辩论 → 决策）。信差的核心工作是：**读取每个 AI 的输出 → 用 LLM 提取/去重/精简/打包 → 注入到其他 AI 的输入**。用户随时可在任意 AI 窗口里直接对话、插话、监督。

---

## 2. 核心概念

### 2.1 AI 实例

| 属性 | 说明 |
|---|---|
| 类型 | Claude Code CLI 或 Codex CLI |
| 数量 | 用户选择，每种 1-3 个 |
| 运行方式 | 每个 AI 一个独立的 Electron BrowserWindow，内嵌 xterm.js 终端 |
| 底层控制 | node-pty 伪终端（PTY），信差可读写每个 AI 的 stdin/stdout |
| Session | Claude Code 用 `--session-id`，Codex 用 `codex resume`，崩溃后可恢复 |

### 2.2 信差大脑

信差本身不调用 AI API 来「生产内容」，而是用一个轻量 LLM（DeepSeek）做**秘书工作**：

- **提取**：从 AI 的完整输出中抓出核心结论（处理格式不规范的情况）
- **去重**：两个 AI 说出相同观点 → 合并标注
- **精简**：去掉废话，保留关键分歧点
- **打包**：组装成结构化的对比表 + 辩论/投票指令
- **加料**：每次转发时自动注入「请精简回复」「请评判以上方案」「请投票」等指令

### 2.3 MQTT 任务接入

MQTT 作为**任务入口和结果出口**，不参与工作流内部逻辑：

| 方向 | Topic | 用途 |
|---|---|---|
| 订阅 | `workflow/tasks/new` | 外部系统推送任务，Dashboard 自动接收并启动工作流 |
| 发布 | `workflow/results/{taskId}` | 每轮结束发布结论对比表，最终决策发布汇总 |

MQTT 可选——用户在 Dashboard 里手动输入任务也一样工作。

### 2.4 桌面窗口架构

```
┌─ 主窗口：信差控制台 ─────────────────────────────────┐
│  • 任务输入框                                         │
│  • 结论对比表（每轮更新）                              │
│  • 对话记录（点击任意 AI 查看完整历史）                 │
│  • MQTT 状态 / 工作流状态                              │
│  • AI 选择配置（启动前）                               │
└──────────────────────────────────────────────────────┘

┌─ Claude #1 ─┐ ┌─ Claude #2 ─┐ ┌─ Codex #1 ─┐ ┌─ Codex #2 ─┐
│ xterm.js    │ │ xterm.js    │ │ xterm.js   │ │ xterm.js   │
│ PTY → CLI   │ │ PTY → CLI   │ │ PTY → CLI  │ │ PTY → CLI  │
└─────────────┘ └─────────────┘ └────────────┘ └────────────┘
 独立桌面窗口    独立桌面窗口    独立桌面窗口   独立桌面窗口
```

每个 AI 窗口：
- 独立任务栏图标，可拖拽、排列、最小化
- 用户可直接在窗口内打字跟 AI 对话
- 信差注入的消息自动显示（看起来像有人帮你打了字）
- 关闭窗口 = 隐藏（不退出），session 保持在 PTY 中

---

## 3. 用户操作流程

### 3.1 启动前：选择配置

```
步骤 1: 选择项目文件夹（信差自动设置 --add-dir / workDir）
步骤 2: 勾选 AI 类型 + 数量
        ┌─ Claude Code: [2] ─┐  ┌─ Codex: [2] ─┐
        └────────────────────┘  └───────────────┘
步骤 3: 点击「启动」
```

**没有「Agent 注册」概念。** 不需要填 ID、显示名、工作目录——选了类型和数量就行。

### 3.2 启动后：信差自动做的事

```
1. 为每个 AI 创建一个 Electron BrowserWindow（独立桌面窗口）
2. 在每个窗口内创建 PTY，启动对应的 CLI：
   - Claude: claude --session-id <UUID> --add-dir <项目> --permission-mode bypassPermissions
   - Codex:  codex exec
3. 每个窗口内用 xterm.js 渲染 PTY 内容
4. 信差开始监听每个 PTY 的 stdout
```

### 3.3 工作流执行：三轮自动推进

```
Round 1 · 产出
  用户在控制台输入任务 → 信差同时写入所有 PTY
  → 每个 AI 产出方案 + 精简结论
  → 信差 LLM 提取结论 → 去重 → 拼对比表
  → 控制台显示对比表，MQTT 发布（如有）

Round 2 · 辩论  [自动推进]
  信差注入：对比表 + 「请评判各方方案，指出优劣，给出改进建议。精简回复。」
  → 每个 AI 评判其他方案
  → 信差 LLM 整理评判 → 生成辩论汇总
  → 控制台更新，MQTT 发布（如有）

Round 3 · 决策  [自动推进]
  信差注入：辩论汇总 + 「请投票选最佳方案，精简回复。」
  → 每个 AI 投票
  → 信差 LLM 汇总 → 最终决策
  → 控制台显示最终决策，MQTT 发布（如有）
```

### 3.4 用户干预

- **在任何 AI 窗口里直接打字**：信差检测到 stdin 活动 → 标记为「用户插话」→ 可选择同步转发给其他 AI
- **在控制台输入框打字**：同步注入所有 AI 窗口
- **暂停/跳过**：控制台有取消按钮，可随时中断

---

## 4. 技术架构

### 4.1 技术栈

| 层 | 技术 | 状态 |
|---|---|---|
| 桌面壳 | Electron 28 | 已有 |
| 前端 | React 18 + TypeScript 5 + Vite 5 | 已有 |
| 终端 | node-pty + xterm.js | 新增 |
| AI 引擎 | Claude Code CLI + Codex CLI | 用户本机已装 |
| 信差大脑 | DeepSeek API | 需用户提供 API Key |
| MQTT | mqtt.js（可选） | 已有 engine/ |
| 工作流引擎 | TS 事件驱动状态机 | 已有，需改造 |

### 4.2 进程架构

```
Electron 主进程
├── PTY Manager          # 管理所有 PTY 实例（创建/销毁/读写）
├── Messenger Brain      # 调用 DeepSeek API 做提取/去重/打包
├── Workflow Engine      # 三轮状态机（已有，改造为 PTY 驱动）
├── MQTT Client          # 订阅 + 发布（可选）
└── Window Manager       # 管理所有 BrowserWindow

每个 AI 窗口（BrowserWindow）
├── xterm.js             # 渲染 PTY 输出
├── 键盘输入 → PTY stdin # 用户在窗口里打字
└── PTY stdout → 显示    # AI 回复
```

### 4.3 PTY 数据流

```
用户在 AI 窗口打字
    ↓
xterm.js onData → IPC → 主进程 → PTY.stdin.write()
    ↓
CLI 进程收到输入
    ↓
CLI 进程产生输出
    ↓
PTY.stdout.on('data') → 主进程读取
    ↓                     ↓
xterm.js 显示          信差监听 → LLM 处理 → 提取结论
                          ↓
                       工作流引擎决定下一轮
                          ↓
                       信差构造转发消息 → PTY.stdin.write()
```

### 4.4 信差转发消息模板

每次信差往 AI 注入消息时使用此模板：

```
───────────────────────────────
以下是其他 AI 对任务「{任务标题}」的方案汇总：

| AI | 核心方案 |
|----|---------|
| Claude #1 | {方案摘要} |
| Claude #2 | {方案摘要} |
| Codex #1  | {方案摘要} |

请你：
① 审阅以上方案，指出最佳选择及理由
② 给出融合方案（取各方优点）
③ 只用 200 字以内的核心结论回复

请用 ──结论── 和 ──────── 包裹你的结论
───────────────────────────────
```

### 4.5 待删除的旧代码

| 文件 | 原因 |
|---|---|
| `electron/agent-manager.ts` | 整个 Agent 注册/CLI spawn 模式被 PTY 窗口模式取代 |
| `src/components/AgentPanel.tsx` | Agent 注册表单不再需要，改为简单的 AI 选择面板 |
| `electron/session-store.ts` | PTY session 由 node-pty 和 CLI 自身管理 |
| `src/types.ts` 中的 `AgentConfig`, `AgentType`, `AgentStatus` | 旧 Agent 模型废弃 |

### 4.6 待改造的旧代码

| 文件 | 改造内容 |
|---|---|
| `electron/workflow-engine.ts` | 从 `agentManager.runAllAgentsRound()` 改为 PTY 驱动的消息注入/监听 |
| `electron/main.ts` | 新增 Window Manager、PTY Manager 初始化 |
| `src/components/WorkflowView.tsx` | 适配新的工作流状态和数据格式 |
| `src/App.tsx` | 新的 AI 选择面板替代旧的 AgentPanel 槽位 |

---

## 5. 待定 / 风险

| 项目 | 说明 |
|---|---|
| DeepSeek API Key | 用户需提供。信差每次转发消耗约 500-1000 token，成本极低 |
| Codex PTY 交互 | Codex CLI 在 Windows 上需 WSL2 或 native sandbox（用户已有 spatialai.vip 代理配置，需验证 PTY 兼容性） |
| xterm.js addon-fit | 需要安装 `@xterm/addon-fit` 依赖 |
| MQTT Broker | 可选——如无外部 broker，Dashboard 可内嵌轻量 broker（如 aedes）或仅支持手动输入 |

---

## 6. 变更摘要

v2.0 → v3.0：

- ❌ 删除 Agent 注册流程（ID、类型、显示名、工作目录、CLI 路径）
- ❌ 删除后台 CLI spawn（非交互模式）
- ✅ 新增 AI 选择面板（类型 + 数量，一键启动）
- ✅ 新增每个 AI 独立桌面窗口（BrowserWindow + xterm.js + PTY）
- ✅ 新增信差大脑（DeepSeek LLM 做提取/去重/精简/打包）
- ✅ 新增 MQTT 任务入口 + 结果出口（简化版）
- ✅ 用户可在任意 AI 窗口内直接对话/插话
- ✅ 三轮工作流保持，但驱动方式从 `agentManager.runAllAgentsRound()` 改为 PTY 消息注入/监听
