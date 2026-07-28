# 🧠 Workflow Dashboard — MQTT 多AI任务流可视化指挥台

> **v1.0.0** | Electron + React + Python | 多 AI 并行执行 | Harness 架构

一个独立的桌面应用，用 MQTT 协议接收任务流，通过**多 AI 并行对抗验证**执行任务，在可视化面板上实时监控、决策和批注。

---

## 🏗️ 架构设计

本项目由 **[MQTT-3388](https://github.com/MQTT-3388)** 提出核心架构构想并全程指导设计方向，包括但不限于：

| 架构决策 | 指导来源 |
|---|---|
| **MQTT 作为任务流传输层** — `workflow/tasks/#` 订阅 + `workflow/results/` 发布，实现松耦合任务分发 | MQTT-3388 |
| **多 AI 并行对抗验证模式** — 提案 AI 生成 → 审查 AI 交叉评审 → 多数投票通过，防止单一 AI 输出不可信 | MQTT-3388 |
| **CC#1/CC#2 双角色分离** — 规划/裁决 (CC#1) 与 执行/产出 (CC#2) 职责分离，阶段阀门必过 | MQTT-3388 |
| **Harness → Dashboard 能力映射** — 将 Claude Code Workflow Harness 的 pipeline / adversarial-verify / checkpoint 模式提炼为桌面应用可复用的编排原语 | MQTT-3388 |
| **Bridge Protocol v1.0** — stdin/stdout JSON 标准化通信协议，预留 task-assistant 合并端口 | MQTT-3388 |
| **L1/L2/L3 三级任务编排** — 按复杂度自动分级，动态选择 AI 数量和超时策略 | MQTT-3388 |
| **系统托盘 + 桌面集成** — 要求 Windows 任务栏 pin + 托盘常驻 + 关闭即隐藏 | MQTT-3388 |
| **项目隔离 + 合并协议** — 与 task-assistant 完全独立但预留标准化合并端口 | MQTT-3388 |

```
┌─────────────────────────────────────────────────────────┐
│                   Electron 28 桌面壳                      │
│  ┌──────────────────────────────────────────────────────┐│
│  │              React 18 + Vite 5 + TypeScript 5        ││
│  │  ┌────────┐ ┌──────────┐ ┌────────────────────────┐ ││
│  │  │ 文件树  │ │内容查看器 │ │ MQTT / 决策 / AI 面板  │ ││
│  │  │(智能分类)│ │(Markdown)│ │ (Provider 配置+路由)   │ ││
│  │  └────────┘ └──────────┘ └────────────────────────┘ ││
│  │  ┌──────────────────────────────────────────────────┐││
│  │  │          任务流看板 (双列 Kanban)                  │││
│  │  │    进行中 ··· 进度条 ··· 已完成 ··· 结果卡片      │││
│  │  └──────────────────────────────────────────────────┘││
│  └────────────────────┬─────────────────────────────────┘│
│                       │ IPC (contextBridge)              │
│  ┌────────────────────▼─────────────────────────────────┐│
│  │  main.ts: 窗口/托盘/文件监听/Bridge 生命周期管理       ││
│  └────────────────────┬─────────────────────────────────┘│
│                       │ stdin/stdout JSON                 │
│  ┌────────────────────▼─────────────────────────────────┐│
│  │              Python 3.12 Bridge v1.0.0                ││
│  │  ┌───────────┐ ┌────────────┐ ┌───────────────────┐  ││
│  │  │ mqtt_client│ │orchestrator│ │    ai_router      │  ││
│  │  │ paho-mqtt │ │ L1/L2/L3  │ │ 对抗验证/流水线    │  ││
│  │  │ 线程安全   │ │ 编排+沙箱  │ │ 4 Provider 并行   │  ││
│  │  └───────────┘ └────────────┘ └───────────────────┘  ││
│  │  ┌────────────────────────────────────────────────┐  ││
│  │  │        checkpoint/resume 持久化机制             │  ││
│  │  └────────────────────────────────────────────────┘  ││
│  └────────────────────┬─────────────────────────────────┘│
│                       │ paho-mqtt 2.1                     │
│  ┌────────────────────▼─────────────────────────────────┐│
│  │              MQTT Broker (外部任务源)                   ││
│  └──────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

---

## 🎯 核心能力

### 多 AI 对抗验证 (Adversarial Verify)

```python
# 提案 AI (DeepSeek + 千问) 各自生成答案
# 审查 AI (豆包 + 混元) 交叉评审每个提案
# 3 维度评审: 正确性 / 完整性 / 安全性
# 多数投票通过 → 采纳；否则驳回

call_with_adversarial_verify(prompt, proposers, reviewers, review_threshold=2)
```

### 流水线执行 (Pipeline)

```python
# 阶段串行: 分析 → 生成 → 验证 → 综合
# 上游输出作为下游上下文
# 每阶段隐性阀门 (gate: pass/reject)
# reject → 中止管道，保护下游不被污染

execute_pipeline(task_data, stages, adversarial=True)
```

### 检查点恢复 (Checkpoint/Resume)

```python
# 执行中自动保存检查点到 .multi-ai-workflow/checkpoints/
# 崩溃/中断后可断点续跑
# 支持 checkpoint 列表查询和删除

resume_task(task_id)  # 从上次中断处恢复
```

---

## 🚀 快速开始

### 环境要求

- Windows 11 / macOS / Linux
- Node.js 18+ 
- Python 3.12
- (可选) Docker Desktop — 代码沙箱隔离
- (可选) MQTT Broker — 接收外部任务

### 安装启动

```bash
# 克隆
git clone https://github.com/JMS852/workflow-dashboard.git
cd workflow-dashboard

# 创建 Python 虚拟环境
python -m venv .venv
.venv\Scripts\pip install paho-mqtt

# 安装 Node 依赖
npm install

# 一键构建+启动
node launcher.js
```

双击桌面快捷方式或 `launch.vbs` 也可静默启动。

### 配置 AI Provider

启动后在 **AI 提供商** 面板填入至少一个 API Key：

| Provider | 需要 |
|---|---|
| DeepSeek | API Key |
| 通义千问 | API Key |
| 豆包 | API Key |
| 混元 | SecretId + SecretKey |

---

## 📡 MQTT 任务格式

```json
{
  "id": "task-001",
  "title": "数据分析报告",
  "description": "分析 sales.csv 并生成可视化",
  "priority": "high",
  "adversarial": true,
  "pipeline": false
}
```

发布到 `workflow/tasks/analyze`，Dashboard 自动接收并执行。

---

## 🛠️ 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Electron 28 |
| 前端 | React 18 + TypeScript 5 + Vite 5 |
| 图标 | lucide-react |
| Markdown | marked |
| 后端引擎 | Python 3.12 |
| MQTT | paho-mqtt 2.1 |
| AI 适配 | DeepSeek / 通义千问 / 豆包 / 混元 |
| 沙箱 | Docker + 本地子进程降级 |
| IPC | stdin/stdout JSON (Bridge Protocol v1.0) |
| 文件监听 | chokidar 3.6 |

---

## 📂 项目结构

```
workflow-dashboard/
├── electron/                # Electron 主进程
│   ├── main.ts              # 窗口/托盘/桥接/文件监听
│   └── preload.ts           # contextBridge 安全暴露 API
├── src/                     # React 渲染进程
│   ├── App.tsx              # 4 区域主布局
│   ├── types.ts             # 完整 TS 类型定义
│   └── components/          # 8 个 UI 组件
├── engine/                  # Python 后端引擎
│   ├── bridge.py            # stdin/stdout JSON 总控
│   ├── mqtt_client.py       # MQTT 客户端 (线程安全)
│   ├── orchestrator.py      # L1/L2/L3 编排 + Pipeline
│   ├── ai_router.py         # 多 AI 路由 + 对抗验证
│   ├── sandbox.py           # Docker/本地沙箱执行
│   ├── validator.py         # 交叉验证
│   └── adapters/            # 4 个 AI Provider 适配器
├── assets/icon.ico          # 自定义图标
├── .multi-ai-workflow/      # 运行时工作目录
│   ├── checkpoints/         # 检查点持久化
│   ├── decisions/           # 决策记录
│   └── BUG_BACKLOG.md       # Bug 追踪
└── CHANGELOG.md
```

---

## 🏷️ 版本历史

| 版本 | 日期 | 内容 |
|---|---|---|
| **v1.0.0** | 2026-07-28 | Harness 能力整合（对抗验证 + 流水线 + 检查点），16 Bug 修复 |
| v0.1.0 | 2026-07-28 | 初始恢复：MQTT + 多 AI + 桌面壳 |

[完整 CHANGELOG](./CHANGELOG.md)

---

## 👤 致谢

- **[@MQTT-3388](https://github.com/MQTT-3388)** — 项目架构师。提出 MQTT 任务流传输、多 AI 对抗验证、CC#1/CC#2 双角色分离、Harness 能力映射、三级编排等核心架构设计，并在整个开发周期中持续指导方向。

---

## 📄 License

MIT
