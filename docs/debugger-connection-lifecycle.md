# Debugger 连接生命周期与断线诊断

本次修改针对 `app/middlewares/debuggerAPI.js`，不修改 Metro、RN 原生代码、
MCP 协议、敏感数据模式或历史保留配置。

## 连接与会话规则

- Worker 的原生调用回复只发往创建该 Worker 的、仍处于 OPEN 状态的当前连接。
- 连接断开时保留现有 Worker 和 MCP 会话以供查看，但停止转发原生回复和执行新的原生调用。
- 新连接建立不代表旧原生运行环境可以继续使用。收到 `prepareJSRuntime` 后才创建新 Worker，
  结束上一 MCP 会话并开启新会话。不重放旧回复或旧请求。
- 在运行环境重建、客户端断开及目标切换时清空尚未执行的原生消息队列。
- 挂起通知仅在状态变化时发送，不再为每次正常原生调用重复发送 connected 状态。
- 切换 host/port 或真正关闭 renderer 时，使旧的异步端口探测、连接回调和重连定时器失效。
- 保留原有 MCP 采集、模式切换、Mock 配置以及正常 bundle/回复流程。

这不能使已经进入原生 RCTFatal 状态的 App 无缝恢复；此时仍可能需要手动 Reload JS。
这也不证明最初的网络中断或长时间运行故障由上述缺陷引起。

## 诊断记录

连接事件仅保存在当前 Debugger renderer 内存中的环形记录中，最多 200 条。
不会将每条记录再次输出到 DevTools Console，以免形成无上限的第二份日志；
持续离线时，重复的端口轮询只记录一次重连等待阶段。
它不受普通 Reload JS 时清空 Console 的影响，但关闭或重载 Debugger renderer 会丢失记录。

在 Debugger 自身的 DevTools Console 中，将 JavaScript 执行上下文切换到 **top**，
不要选 `RNDebuggerWorker.js`，然后执行：

```js
window.getRNDebuggerConnectionDiagnostics()
```

需要复制给排查人员时，可在同一个 Console 中执行：

```js
copy(JSON.stringify(window.getRNDebuggerConnectionDiagnostics(), null, 2))
```

常见事件有 `socket-connecting`、`socket-open`、`socket-closed`、`socket-error`、
`reconnect-scheduled`、`runtime-prepared`、`runtime-suspended`、`worker-error`。
每条包含时间戳以及当前窗口中的 connectionId/runtimeId。
关闭记录包含关闭码和 wasClean；已知的固定协议关闭原因会保留，其他服务端原因文本
以 `[redacted]` 替代。不会将原生调用参数、业务正文、URL、令牌或 Worker 错误正文
复制到此诊断记录中。Worker 的原始错误仍按原行为在 DevTools 显示，不被吞掉。

## 验证命令

从项目根目录运行新增回归测试：

```sh
yarn jest app/middlewares/__tests__/debuggerAPI.test.js --runInBand --watchman=false --modulePathIgnorePatterns '<rootDir>/dist/' '<rootDir>/release/'
```

其他检查：

```sh
yarn test
(cd agent-mcp && npm test)
yarn build
```

`yarn test` 包含项目已有测试。修改前的基线中，`redux-routing.test.js` 因
`electron-store` 在 Node 测试环境中读取不到 Electron app 而加载失败。
`injectDevToolsMiddleware.test.js` 会访问外部源站下载历史代码，结果可能受网络影响。
不要把这两类问题与新增连接回归测试混为一谈，也不要把全量命令的非零退出码记为通过。

新增测试加载真实 middleware，只替换浏览器/Electron 边界，不连接实际 Metro。
构建成功及这些测试通过不替代真实 RN App 的长时间运行验证。

## 切换测试版

本次构建更新项目的 `dist/`，不会替换 `/Applications` 中已安装的 Debugger。
方便中断当前调试时，先完整退出当前 Debugger，再从项目根目录运行 `yarn start`。
不要同时运行两份 Debugger 抢占同一远程调试连接或 Agent Bridge 发现文件。
再次出现故障时，先复制诊断记录，再执行 Reload JS 或重启 Debugger。
