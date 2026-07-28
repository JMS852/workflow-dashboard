# Changelog

## v1.0.0 (2026-07-28)

### 🎯 新特性 — Harness 能力整合

- **对抗验证模式** (`ai_router.py`): 提案 AI 生成 → 审查 AI 交叉评审 → 多数投票通过，对应 Harness 的 adversarial-verify 模式
- **流水线执行模式** (`orchestrator.py`): 阶段串行，上游输出驱动下游，隐性阀门 gate，对应 Harness 的 pipeline() 模式
- **检查点/恢复机制** (`bridge.py`): 执行状态自动持久化到 `.multi-ai-workflow/checkpoints/`，支持断点续跑，对应 Harness 的 checkpoint/resume 机制
- **新增 Bridge 协议动作**: `resume_task`, `list_checkpoints`, `delete_checkpoint`
- **新增前端事件**: `onCheckpointSaved`, `onCheckpointResumed`, `onCheckpointsList`

### 🐛 Bug 修复 — BUG_BACKLOG 批量清除

16 个确认问题全部修复，4 个误报排除：

- **H2**: preload.ts `removeAllListeners` 改为动态获取全部频道
- **H3**: Bridge 终止路径增加 `pendingBridgeCallbacks` 清理
- **H4**: launcher.js `ELECTRON_RUN_AS_NODE` 改用显式 delete
- **H5**: 本地沙箱执行增加资源限制/超时/文件系统隔离
- **H6**: orchestrator.py 复用沙箱结果，消除 AI 代码重复执行
- **M1**: mqtt_client.py 补齐 `threading.Lock` 线程安全保护
- **M2**: disconnect() 后 `_client` 置 None
- **M3**: MQTTTaskClient 添加公开 property
- **M4**: 添加非阻塞 `publish_message` 方法
- **M5**: validator.py 清理死代码
- **M7**: MqttPanel 增加 try/catch 错误处理
- **M9**: App.tsx `getStageLabel` 结果缓存
- **L1**: electronAPI 改为可选类型
- **L2**: MqttTask.raw 改为 `Record<string, unknown>`
- **L3**: App.css 删除未使用规则
- **L5**: tsconfig.electron.json 启用 strict 模式

### 🔧 类型系统更新

- 新增 `CheckpointInfo`, `CheckpointDetail`, `PipelineStageResult`, `PipelineExecutionResult` 类型
- `bridgeExecuteTask` 支持 `adversarial`, `pipeline`, `stages` 参数
- Notification 类型新增 `checkpoint_saved`

---

## v0.1.0 (2026-07-28)

- 初始恢复版本
- Electron 28 + React 18 + TypeScript 5 + Vite 5
- Python 3.12 引擎：MQTT + 多 AI 路由 + Docker 沙箱
- 4 区域布局：文件树 | 内容查看器 | MQTT/决策/AI 面板
- 系统托盘 + 桌面快捷方式 + 自定义图标
- Bridge Protocol v1.0 标准通信
