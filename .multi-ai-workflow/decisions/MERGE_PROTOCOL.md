# Merge Protocol v1.0 — Workflow Dashboard ↔ Task Assistant

> 当 task-assistant 调教好之后，通过此协议合并到 workflow-dashboard。

## 协议概述

两个项目通过 **stdin/stdout JSON 行协议** 或 **MQTT** 通信。不硬编码耦合，不共享 Python 环境。

```
┌──────────────────────────┐       stdin/stdout JSON       ┌──────────────────────┐
│   Workflow Dashboard      │ ◄──────────────────────────► │   Task Assistant      │
│   (Electron Desktop App) │                               │   (Electron Desktop)  │
│                          │       MQTT topics             │                       │
│   engine/bridge.py       │ ◄──────────────────────────► │   engine/main.py      │
└──────────────────────────┘                               └──────────────────────┘
```

## 方式 A: stdin/stdout JSON Bridge Protocol

### 消息格式

每行一个 JSON 对象，UTF-8 编码。所有消息包含 `action` 或 `event` 字段。

### Action: task-assistant → workflow-dashboard

```json
{
  "action": "execute_task",
  "data": {
    "id": "task-001",
    "title": "帮我写一个Python脚本",
    "description": "生成随机密码的脚本，支持指定长度和字符集",
    "priority": "medium"
  }
}
```

### Event: workflow-dashboard → task-assistant

```json
{"event": "task_execution_started", "data": {"task_id": "task-001"}}
{"event": "task_progress", "data": {"task_id": "task-001", "stage": "analyzing", "progress": 0.1, "message": "正在分析任务..."}}
{"event": "task_executed", "data": {"task_id": "task-001", "status": "completed", "final_result": "...", "duration_ms": 1234}}
```

### Action: 配置 AI 提供商

```json
{
  "action": "configure_provider",
  "data": {
    "provider": "deepseek",
    "api_key": "sk-xxx",
    "endpoint": "",
    "enabled": true
  }
}
```

### 完整 Action 列表

| Action | 方向 | 说明 |
|---|---|---|
| `ping` | 双向 | 心跳检测，回复 `{"event":"pong"}` |
| `execute_task` | → | 提交任务执行 |
| `configure_provider` | → | 配置 AI 提供商 |
| `start_mqtt` | → | 启动 MQTT 连接 |
| `stop_mqtt` | → | 停止 MQTT 连接 |
| `set_project` | → | 设置工作目录 |
| `publish_mqtt` | → | 手动发布 MQTT 消息 |

### 完整 Event 列表

| Event | 方向 | 说明 |
|---|---|---|
| `bridge_ready` | ← | Bridge 就绪 |
| `task_execution_started` | ← | 任务开始执行 |
| `task_progress` | ← | 执行进度更新 |
| `task_executed` | ← | 任务执行完成 |
| `task_error` | ← | 任务执行错误 |
| `mqtt_task_received` | ← | 收到 MQTT 任务 |
| `mqtt_status` | ← | MQTT 连接状态变化 |
| `task_file_written` | ← | 任务文件已写入磁盘 |

## 方式 B: MQTT 集成

task-assistant 可直接通过 MQTT 发送任务，无需 spawn bridge 子进程。

### Topic 约定

| Topic | 方向 | 说明 |
|---|---|---|
| `workflow/tasks/manual` | → | 手动发送任务 |
| `workflow/tasks/#` | → | 通配订阅，接收所有任务 |
| `workflow/results/{task_id}` | ← | 执行结果 |
| `workflow/results/{task_id}/status` | ← | 执行进度 |

### 任务消息格式

```json
{
  "id": "task-001",
  "title": "帮我写一个Python脚本",
  "description": "生成随机密码的脚本",
  "priority": "high"
}
```

### 结果消息格式

```json
{
  "id": "task-001",
  "result": {
    "execution_id": "...",
    "level": "L3",
    "task_type": "code",
    "reference_results": 3,
    "passed": 3,
    "final_result": "...",
    "duration_ms": 1234,
    "status": "completed",
    "generated_files": ["C:/Users/.../output.py"]
  },
  "ts": 1722158400.123
}
```

## 合并步骤（未来执行）

1. task-assistant 的 `engine/main.py` 替换为 `engine/bridge.py`（或实现相同协议）
2. task-assistant 通过 MQTT 发送任务 → workflow-dashboard 接收并执行
3. task-assistant 也可直接 spawn bridge.py 作为子进程（同 Electron 方式）
4. 两个项目共享 `.multi-ai-workflow/` 工作文件目录
5. Git 仓库合并（workflow-dashboard 作为主仓库，task-assistant 作为子模块或合并分支）

## 不变量

- **不共享 venv**：各自独立 Python 环境
- **不硬编码路径**：通过协议传递项目目录
- **不直接导入**：通过 JSON 协议通信，不 import 对方模块
- **不绕过阀门**：所有 AI 调用统一通过 bridge.py，保留 CC#1/CC#2 审查能力
