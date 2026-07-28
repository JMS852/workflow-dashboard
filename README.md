# 📡 Workflow Dashboard — 多 Agent 协作信差平台

> **v2.0** | Electron + React + TypeScript | Claude Code / Codex Agent | 事件驱动工作流

一个桌面信差平台，不产生 AI 内容——只负责在**用户**和**多个 Claude Code / Codex Agent** 之间传递消息、汇聚结论、推动辩论与决策。适用于算法设计、数学建模、代码审查、嵌入式开发、系统架构等复杂工程任务。

---

## 🏗️ 架构设计

本项目由 **[MQTT-3388](https://github.com/MQTT-3388)** 提出核心架构构想并全程指导设计方向，包括但不限于：

| 架构决策 | 指导来源 |
|---|---|
| **事件驱动工作流模型** — Agent 产出作为事件，自动触发下一轮，不设中央调度器阻塞等待 | MQTT-3388 |
| **三段式对抗验证** — Round 1 产出 → Round 2 辩论 → Round 3 投票决策，Agent 只交换结论节省 Token | MQTT-3388 |
| **信差平台定位** — Dashboard 不产生 AI 内容，不直接调用 AI API，只做消息路由和结论汇聚 | MQTT-3388 |
| **结论协议** — Agent 产出完整方案后给出 200 字结论，Agent 间只互读结论不互读全文，节省 25× Token | MQTT-3388 |
| **Session 持久化** — 每个 Agent 保持独立完整上下文（--session-id / --resume），跨轮次记忆不丢失 | MQTT-3388 |
| **CC#1/CC#2 双角色分离** — 规划/裁决与执行/产出职责分离，阶段阀门必过 | MQTT-3388 |
| **Harness → Dashboard 能力映射** — 提炼 Claude Code Workflow Harness 的 pipeline / adversarial-verify / checkpoint 模式为桌面应用可复用的编排原语 | MQTT-3388 |
| **系统托盘 + 桌面集成** — Windows 任务栏 pin + 托盘常驻 + 关闭即隐藏 | MQTT-3388 |

```
┌──────────────────────────────────────────────────────────────┐
│                   Electron 28 桌面壳                           │
│  ┌──────────────────────────────────────────────────────────┐│
│  │              React 18 + Vite 5 + TypeScript 5             ││
│  │  ┌──────────────┐ ┌────────────────┐ ┌────────────────┐  ││
│  │  │   Agent 面板  │ │  工作流主视图   │ │   文件浏览器    │  ││
│  │  │  (注册/管理)  │ │ 对话/结论/辩论  │ │  (历史记录)    │  ││
│  │  └──────────────┘ └────────────────┘ └────────────────┘  ││
│  └────────────────────┬─────────────────────────────────────┘│
│                       │ IPC (contextBridge)                   │
│  ┌────────────────────▼─────────────────────────────────────┐│
│  │  main.ts: 窗口/托盘/文件监听                               ││
│  │  ┌─────────────────┐ ┌──────────────┐ ┌────────────────┐ ││
│  │  │ Agent Manager    │ │Workflow Engine│ │ Session Store  │ ││
│  │  │ spawn CLI 进程   │ │ 状态机驱动    │ │ 持久化 UUID    │ ││
│  │  │ --resume 上下文  │ │ 事件→轮次     │ │ 会话历史归档   │ ││
│  │  └────────┬────────┘ └──────┬───────┘ └───────┬────────┘ ││
│  └───────────┼─────────────────┼─────────────────┼──────────┘│
│              │                 │                 │            │
│  ┌───────────▼─────────────────▼─────────────────▼──────────┐│
│  │                    CLI Agent 层                            ││
│  │  claude -p --session-id <UUID>     codex exec --json      ││
│  │  claude --resume <UUID> -p "..."   codex exec resume <ID> ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

---

## 🎯 核心能力

### 三段式工作流

```
Round 1 产出  → 用户提任务 → 所有 Agent 并行产出方案 + 200 字结论
Round 2 辩论  → Dashboard 汇聚结论对比表 → Agent 互相评判、改进
Round 3 决策  → Agent 投票 → Dashboard 展示最终决策
```

每轮自动推进，无需手动操作。Agent 产出 = 事件 → 触发下一轮。

### Agent 间共识协议

每个 Agent 的 prompt 包含协议指令，确保输出格式统一：

```
──結論──
<200字以内的核心方案、关键决策、注意事项>
────────
```

Dashboard 自动提取结论并构建对比表。Agent 只交换结论，不互读完整产出——**节省 96% Token（25×）**。

### Session 持久化

- **Claude Code**: `--session-id <UUID>` 创建 → `--resume <UUID>` 恢复
- **Codex**: `codex exec` 创建 → `codex exec resume <ID>` 恢复
- Dashboard 崩溃后重启，自动恢复所有 Agent 完整上下文

---

## 🚀 快速开始

### 环境要求

- Windows 11 / Windows 10（macOS / Linux 理论兼容）
- Node.js 18+
- **Claude Code CLI** 和/或 **Codex CLI**（至少一种）

### 1. 安装 CLI Agent（至少选一种）

```bash
# Claude Code CLI
npm install -g @anthropic-ai/claude-code
claude login    # 或设置 ANTHROPIC_API_KEY 环境变量

# Codex CLI (OpenAI)
npm install -g @openai/codex
# 设置 OPENAI_API_KEY 环境变量
```

### 2. 安装并启动 Dashboard

```bash
git clone https://github.com/JMS852/workflow-dashboard.git
cd workflow-dashboard
npm install

# 一键构建+启动
node launcher.js
```

### 3. 注册 Agent 并开始

1. 点击「选择项目目录」
2. 右侧 Agent 面板点 `+` 注册 Agent（ID、类型、显示名）
3. 在输入框输入任务，Enter 提交
4. 观察 Round 1 → 2 → 3 自动推进

---

## 📡 MQTT 任务摄入（可选）

```json
{
  "id": "task-001",
  "title": "数据分析报告",
  "description": "分析 sales.csv 并生成可视化",
  "priority": "high"
}
```

发布到 `workflow/tasks/analyze`，Dashboard 自动接收。需要外部 MQTT Broker。

---

## 🛠️ 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Electron 28 |
| 前端 | React 18 + TypeScript 5 + Vite 5 |
| 图标 | lucide-react |
| Markdown | marked |
| Agent 引擎 | Claude Code CLI / Codex CLI |
| 工作流引擎 | TypeScript 事件驱动状态机 |
| Session 持久化 | JSON (--session-id/--resume) |
| 可选沙箱 | Docker + 本地子进程降级 (Python) |
| 文件监听 | chokidar 3.6 |

---

## 📂 项目结构

```
workflow-dashboard/
├── electron/                    # Electron 主进程
│   ├── main.ts                  # 窗口/托盘/IPC/文件监听
│   ├── preload.ts               # contextBridge 安全暴露 API
│   ├── agent-manager.ts         # Agent 注册、CLI spawn、结论提取
│   ├── workflow-engine.ts       # 事件驱动状态机（三轮）
│   └── session-store.ts         # Agent session 持久化
├── src/                         # React 渲染进程
│   ├── App.tsx                  # 主布局
│   ├── types.ts                 # TypeScript 类型定义
│   └── components/
│       ├── AgentPanel.tsx       # Agent 管理面板
│       ├── WorkflowView.tsx     # 对话/结论对比/辩论视图
│       ├── FileTree.tsx         # 文件浏览器
│       ├── ContentViewer.tsx    # Markdown 查看器
│       └── NotificationBar.tsx  # 通知栏
├── engine/                      # 可选 Python 组件
│   ├── sandbox.py               # Docker/本地沙箱执行
│   └── mqtt_client.py           # MQTT 客户端（可选）
├── _archive/                    # v1.0 旧架构（已归档）
│   ├── bridge.py                # 旧 Python 桥接
│   ├── ai_router.py             # 旧 AI API 路由
│   ├── orchestrator.py          # 旧编排器
│   └── adapters/                # 旧 Provider 适配器
├── docs/USER_GUIDE.html         # 详细使用说明书
├── assets/icon.ico              # 自定义图标
└── .multi-ai-workflow/          # 运行时工作目录
    └── sessions/                # Agent session 记录
```

---

## 🏷️ 版本历史

| 版本 | 日期 | 内容 |
|---|---|---|
| **v2.0** | 2026-07-29 | 架构重构：从 AI API 执行者变为 Claude Code/Codex 信差平台；新增 Agent Manager、Workflow Engine、Session Store；事件驱动三轮工作流；结论协议节省 25× Token |
| v1.0.0 | 2026-07-28 | Harness 能力整合（对抗验证 + 流水线 + 检查点），16 Bug 修复 |
| v0.1.0 | 2026-07-28 | 初始恢复：MQTT + 多 AI + 桌面壳 |

[完整 CHANGELOG](./CHANGELOG.md)

---

## 👤 致谢

- **[@MQTT-3388](https://github.com/MQTT-3388)** — 项目架构师。提出信差平台定位、事件驱动工作流模型、三段式对抗验证、结论协议、Session 持久化、CC#1/CC#2 双角色分离、Harness 能力映射等核心架构设计，并在整个开发周期中持续指导方向。

---

## 📄 License

MIT
