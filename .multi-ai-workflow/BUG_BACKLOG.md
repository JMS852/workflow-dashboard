# Bug Backlog — 待后续修复

> 创建于 2026-07-28 | 更新于 2026-07-28 | 共 16 个问题（4 个误报已移除）| 全部已修复 ✅

---

## 🟠 High (5 个)

### H2. `electron/preload.ts:61-73` — removeAllListeners 漏掉了 7+ 个事件频道 ✅

MQTT、bridge、task 相关的 IPC 频道没有被清理。手工枚举 12 个频道，但实际注册了更多。
**Fix**: 改为动态获取所有已注册频道并清理，而非手工枚举。

---

### H3. `electron/main.ts:84-94` — pendingBridgeCallbacks 在旧 bridge 死亡后未清理 ✅

旧 bridge 终止后 pendingBridgeCallbacks 残留，可能导致新 bridge 误触发旧回调。
**Fix**: 在三个 bridge 终止路径中增加 `pendingBridgeCallbacks = []` 清理：
- `startBridge()` 第 34-38 行（杀死旧 bridge 时）
- bridge 进程 exit/error 事件处理中

---

### H4. `electron/launcher.js:40-47` — `ELECTRON_RUN_AS_NODE: undefined` 行为不可靠 ✅

`{ ...process.env, ELECTRON_RUN_AS_NODE: undefined }` 在部分平台会将 `undefined` 序列化为字符串 `"undefined"`，导致 Electron 行为异常。
**Fix**: 将隐式依赖 undefined 过滤的写法改为显式 `delete env.ELECTRON_RUN_AS_NODE`。

---

### H5. `engine/sandbox.py:13-16` — Docker 不可用时的本地执行无沙箱隔离 ✅

AI 生成代码在主机上直接运行，存在安全风险。
**Fix**: `_run_local_subprocess()` 增加本地沙箱隔离措施：
- 通过 `resource` 模块限制 CPU/内存
- 设置子进程超时
- 限制文件系统访问范围

---

### H6. `engine/orchestrator.py:219-227` — AI 代码被执行两次 ✅

同一段 AI 生成的可执行代码被执行两次：沙箱验证一次 (`run_in_sandbox`，第 199 行)，文件收集阶段又一次 (`run_and_collect_files`)。
**Fix**: 复用沙箱执行结果，避免重复执行。

---

## 🟡 Medium (7 个)

### M1. `engine/mqtt_client.py:32` — threading.Lock 创建但从未 acquire ✅

`self._lock = threading.Lock()` 是死代码，`_connected` 在多线程下无保护。
**Fix**: 补齐线程安全——在 `_connected` 的读写处使用 `self._lock` 保护；同时移除未使用的 `import threading`（如无别处使用）。

---

### M2. `engine/mqtt_client.py:111-115` — disconnect() 后 _client 未置 None ✅

disconnect 后 `_client` 仍持有旧引用，后续 `is_connected()` 等检查可能误判。
**Fix**: 在 `self._connected = False` 之前增加 `self._client = None`。

---

### M3. `engine/bridge.py:248-250` — 直接访问 MQTTTaskClient 私有属性 ✅

`self.mqtt._broker_host` 破坏封装。
**Fix**: 在 `MQTTTaskClient` 中添加公开 property `broker_host`、`broker_port` 等，bridge 改用公开接口。

---

### M4. `engine/bridge.py:249` — paho.mqtt.publish.single 同步阻塞，无超时 ✅

Broker 不可达时卡死 stdin 处理循环。
**Fix**: 在 `MQTTTaskClient` 中添加 `publish_message(topic, payload)` 方法，使用已有的非阻塞 `client.publish`，或为同步调用增加超时机制。

---

### M5. `engine/validator.py` — validate_executable、analyze_consensus 全是死代码 ✅

从未被导入或调用，同时 `import json` 也无实际用途。
**Fix**: 删除 `validate_executable`（第 4-11 行）和 `analyze_consensus`（第 21-39 行），同时移除 `import json`。保留 `cross_validate`（实际使用中）。

---

### M7. `src/components/MqttPanel.tsx:42-71` — handleConnect/handleSendTask 缺少错误处理 ✅

连接或发送失败时无用户提示，静默失败。
**Fix**: `handleConnect` 用 `try/catch` 包裹 `bridgeStartMqtt` 调用，catch 中设置错误状态文字并确保 `connected` 为 false。

---

### M9. `src/App.tsx:156-182` — getStageLabel 每次渲染计算两次 ✅

正则匹配在渲染中调用两次，无缓存。
**Fix**: 在 return 之前将 `getStageLabel()` 的结果存入局部变量，避免一次渲染内两次调用。

---

## 🟢 Low (4 个)

### L1. `src/types.ts:97` — electronAPI 声明为必选而非可选 ✅

浏览器开发模式下 `window.electronAPI` 是 undefined，类型声明与实际不符。
**Fix**: `electronAPI: {` 改为 `electronAPI?: {`，添加可选标记。

---

### L2. `src/types.ts:57` — MqttTask.raw 使用 any 类型 ✅

**Fix**: `raw: Record<string, any>` 改为 `raw: Record<string, unknown>`。

---

### L3. `src/App.css:209-217` — .decision-panel-outer 定义但从未使用 ✅

**Fix**: 删除 `.decision-panel-outer` 规则块（第 209-217 行）。

---

### L5. `tsconfig.electron.json:8-10` — strict 模式完全关闭 ✅

Electron 主进程没有类型安全网。
**Fix**: `"strict": false` 改为 `"strict": true`，同时删除 `"noImplicitAny": false` 和 `"strictNullChecks": false`。

---

## ❌ 已排除的误报 (4 个)

| ID | 标题 | 排除原因 |
|----|------|----------|
| H1 | Window/Tray 类型注解错误 | `typeof BrowserWindow` 是 TypeScript CommonJS (`require('electron')`) 导入下的强制正确写法，直接使用 `BrowserWindow` 会触发 TS2749 错误。编译器零错误通过，所有实例成员访问在运行时完全正常。 |
| M6 | received_at 时间戳单位不一致 | 后端 `time.time()` 确定性地返回秒级时间戳，前端 `* 1000` 正确转换为毫秒。所有生产者和消费者对单位一致。 |
| M8 | 内联箭头函数每次渲染创建新引用 | 9 处内联函数均绑定在原生 DOM 元素上（button、textarea），子组件未使用 React.memo，不存在额外重渲染。零运行时错误、零资源泄漏。 |
| L4 | noUnusedLocals/noUnusedParameters 关闭 | 这两个选项不在 `strict: true` 范围内，默认值即为 false。关闭它们是合法的开发阶段配置选择，无运行时影响、无安全风险。 |

---

## 📋 修复记录

```
### 2026-07-28 批量修复
- H2 ✅ — preload.ts removeAllListeners 改为动态获取所有频道
- H3 ✅ — startBridge() 及 bridge 退出路径增加 pendingBridgeCallbacks 清理
- H4 ✅ — launcher.js env 构建改用显式 delete
- H5 ✅ — sandbox.py 本地执行增加资源限制/超时/文件系统隔离
- H6 ✅ — orchestrator.py 复用沙箱执行结果，消除重复执行
- M1 ✅ — mqtt_client.py 补齐 threading.Lock 线程安全保护
- M2 ✅ — mqtt_client.py disconnect() 后 _client 置 None
- M3 ✅ — MQTTTaskClient 添加 broker_host/broker_port 公开 property
- M4 ✅ — MQTTTaskClient 添加非阻塞 publish_message 方法
- M5 ✅ — validator.py 删除 validate_executable/analyze_consensus 死代码
- M7 ✅ — MqttPanel.tsx handleConnect 增加 try/catch 错误处理
- M9 ✅ — App.tsx getStageLabel 结果缓存到局部变量
- L1 ✅ — types.ts electronAPI 添加可选标记
- L2 ✅ — types.ts MqttTask.raw 改为 Record<string, unknown>
- L3 ✅ — App.css 删除未使用的 .decision-panel-outer
- L5 ✅ — tsconfig.electron.json 启用 strict 模式
- H1 ❌ 误报 — TypeScript CommonJS 导入的标准写法
- M6 ❌ 误报 — 时间戳单位前后端一致
- M8 ❌ 误报 — 内联函数无实际影响
- L4 ❌ 误报 — 有意的配置选择
```
