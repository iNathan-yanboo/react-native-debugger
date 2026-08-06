# React Native Debugger-mcp 使用说明

## 接收者首次配置

### 1. 安装并启动

1. 解压 `rn-debugger-macos-universal.zip`。
2. 将 **React Native Debugger-mcp.app** 拖入 `/Applications`。
3. 首次打开若被 macOS 拦截，请到 **系统设置 → 隐私与安全性**，
   确认应用来源后选择“仍要打开”。

### 2. 开启 Agent Bridge

在应用菜单选择 **Debugger → Open Config File**，加入：

```json5
{
  agentBridge: {
    enabled: true,
  },
}
```

保存后重启 **React Native Debugger-mcp**，再让 RN 应用连接
Remote JS Debugging。

> 默认会脱敏日志、Redux 和网络数据。如确需调试敏感数据，可在应用菜单
> 选择 **Debugger → Allow Agent Raw Sensitive Data**。每次新会话默认
> 恢复脱敏模式。

### 2.1 配置接口 Mock（可选）

在 Chrome DevTools 的 **Network** 列表中选中目标请求并右键，选择
**Mock selected Network request**。应用会自动带入完整 URL、方法、状态码、
响应头和响应正文；可直接编辑后保存。

也可从应用菜单打开 **Debugger → Manage Network Mocks**，集中新增、编辑、
启用、禁用或删除规则。规则保存后会立即同步到当前 RN 会话，**不需要 Reload JS**。

URL 为精确匹配（包含 query string），命中后不发送真实请求。启用 Mock 会自动
开启 Network Inspect；启用 Agent Bridge 时，Mock 响应会带 `mocked: true` 标记，
供 MCP 查询和排查。

### 3. 在 Codex 注册 MCP

复制执行：

```sh
codex mcp add react_native_debugger \
  --env ELECTRON_RUN_AS_NODE=1 \
  -- "/Applications/React Native Debugger-mcp.app/Contents/MacOS/React Native Debugger-mcp" \
  "/Applications/React Native Debugger-mcp.app/Contents/Resources/agent-mcp/src/index.js"

codex mcp list
```

如果应用没有安装在 `/Applications`，请将命令中的两个路径改为实际路径。
该方式使用应用自带的 Electron 运行 MCP，不需要另外安装 Node.js。

完成后重启 Codex 或新建任务，使 Agent 重新发现以下工具：

- `list_debug_sessions`
- `get_console_logs`
- `get_redux_state`
- `get_redux_actions`
- `get_network_requests`
- `get_network_request`
- `wait_for_debug_event`

若没有发现工具，依次确认：

1. `codex mcp list` 中存在 `react_native_debugger`。
2. **React Native Debugger-mcp** 正在运行。
3. RN 应用已经连接 Remote JS Debugging。
4. `~/.react-native-debugger/agent-bridge.json` 已生成。

## 对话中如何命中

为了稳定命中，建议在首次指令中直接说明使用
`react_native_debugger MCP`，并给出关键词、URL、actionType 或 Redux
JSON Pointer，避免读取全量数据。

### 日志检索

```text
使用 react_native_debugger MCP，查找当前 RN 会话中包含
env.configs.adpopup 的日志，只返回最近 20 条并总结不同值。
```

### 网络请求

```text
使用 react_native_debugger MCP，查找 URL 包含 realTimeCalculate 的
网络请求摘要，然后读取最新一条的响应正文。
```

### Redux

```text
使用 react_native_debugger MCP，读取 Redux 的
/components_data/superEnough，只返回这个子树，不要返回完整 state。
```

```text
使用 react_native_debugger MCP，查找 actionType 为 ADD_CART_ITEM 的
最近 20 条 Redux action，不要包含 state。
```

### 持续等待问题复现

```text
使用 react_native_debugger MCP，等待下一条 console 或 network 事件；
问题复现后优先检查 error 日志和失败请求的详情。
```

如果希望某个项目的 Agent 默认优先使用，可在项目 `AGENTS.md` 中加入：

```md
排查 React Native 运行时问题时，优先使用 react_native_debugger MCP；
先按关键词、URL、actionType 或 JSON Pointer 缩小范围，再按需读取正文。
```
