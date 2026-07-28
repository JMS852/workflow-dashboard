# Bug Backlog — 待后续修复

> 创建于 2026-07-28 | 共 20 个问题 | v1 发布前分批处理

---

## 🟠 High (6 个)

### H1. `electron/main.ts:8-9` — Window/Tray 类型注解错误

`typeof BrowserWindow` 是构造函数类型，不是实例类型。
**Fix**: 改为 `let mainWindow: BrowserWindow | null = null`

### H2. `electron/preload.ts:61-73` — removeAllListeners 漏掉了 7+ 个事件频道

MQTT、bridge、task 相关的 IPC 频道没有被清理。
**Fix**: 列出所有已注册的频道，或使用共享列表

### H3. `electron/main.ts:84-94` — pendingBridgeCallbacks 在旧 bridge 死亡后未清理

可能导致新 bridge 误触发旧回调。
**Fix**: `startBridge()` 开始时清理 `pendingBridgeCallbacks = []`

### H4. `electron/launcher.js:40-47` — `ELECTRON_RUN_AS_NODE: undefined` 行为不可靠

`String(undefined)` 在某些平台会变成 `"undefined"` 字符串。
**Fix**: `delete env.ELECTRON_RUN_AS_NODE`

### H5. `engine/sandbox.py:13-16` — Docker 不可用时的本地执行无沙箱隔离

AI 生成代码在主机上直接运行，存在安全风险。
**Fix**: 本地执行时弹窗确认 or 限制子进程权限

### H6. `engine/orchestrator.py:219-227` — AI 代码被执行两次

沙箱验证一次 + run_and_collect_files 一次，浪费资源且可能产生不同副作用。
**Fix**: 复用沙箱结果

---

## 🟡 Medium (9 个)

### M1. `engine/mqtt_client.py:32` — threading.Lock 创建但从未 acquire

`_lock` 是死代码，`_connected` 在多线程下无保护。
**Fix**: 正确使用 lock 或移除

### M2. `engine/mqtt_client.py:111-115` — disconnect() 后 _client 未置 None

**Fix**: `self._client = None`

### M3. `engine/bridge.py:248-250` — 直接访问 MQTTTaskClient 私有属性

`self.mqtt._broker_host` 破坏封装。
**Fix**: 添加公开属性

### M4. `engine/bridge.py:249` — paho.mqtt.publish.single 同步阻塞，无超时

Broker 不可达时卡死 stdin 处理循环。
**Fix**: 异步发布或加超时

### M5. `engine/validator.py` — validate_executable、analyze_consensus 全是死代码

从未被导入或调用。
**Fix**: 集成到 orchestrator 或删除

### M6. `src/components/MqttPanel.tsx:158` — received_at 时间戳单位假设不一致

前端假设秒，后端可能发毫秒。
**Fix**: 统一时间戳格式

### M7. `src/components/MqttPanel.tsx:42-71` — handleConnect/handleSendTask 缺少错误处理

**Fix**: 加 try/catch，失败时提示用户

### M8. `src/App.tsx:226` — 内联 `() => {}` 每次渲染创建新引用

TaskFlow 的 `onSelectTask` 回调多余。
**Fix**: 用 `useCallback(() => {}, [])`

### M9. `src/App.tsx:156-182` — getStageLabel 每次渲染计算两次

正则匹配在渲染中调用两次，无缓存。
**Fix**: `useMemo` 包裹

---

## 🟢 Low (5 个)

### L1. `src/types.ts:97` — electronAPI 声明为必选而非可选

浏览器开发模式下 window.electronAPI 是 undefined。
**Fix**: `electronAPI?:` 加问号

### L2. `src/types.ts:57` — MqttTask.raw 使用 any 类型

**Fix**: 改为 `Record<string, unknown>`

### L3. `src/App.css:209-217` — .decision-panel-outer 定义但从未使用

**Fix**: 删除或者更新 JSX 使用它

### L4. `tsconfig.json:15-16` — noUnusedLocals/noUnusedParameters 关闭

**Fix**: 改为 `true`，CI 中卡住

### L5. `tsconfig.electron.json:8-10` — strict 模式完全关闭

Electron 主进程没有类型安全网。
**Fix**: 逐步启用

---

## 📋 修复记录模板

每次修复后在这里记录：

```
### [日期] H1 修复
- 状态: ✅ / ⏳ / ❌
- 改动文件:
- Git commit:
```
