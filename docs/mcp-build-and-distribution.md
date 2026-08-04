# React Native Debugger-mcp：构建、分发与 Agent 使用

## 一分钟结论

- 安装后的应用名是 **React Native Debugger-mcp**，便于和官方版本区分。
- `rndebugger:` 协议、内部包名和现有配置机制保持不变。
- 发行包内已包含只读 MCP Sidecar，不需要另发源码。
- MCP 负责提供实时日志、Redux 和 Network 数据；当前不需要额外 Skill。

## 构建与分发

```sh
yarn install
yarn build
yarn pack-macos
```

macOS 产物位于 `release/`，ZIP 是当前已验证的分发方式：

- `rn-debugger-macos-universal.zip`
- `rn-debugger-macos-arm64.zip`
- `rn-debugger-macos-x64.zip`

DMG 还依赖 `electron-installer-dmg` 的完整 macOS 可选依赖；依赖齐全时会
额外生成 `react-native-debugger_<version>_universal.dmg`。内部测试可直接
分发 ZIP。正式或跨团队分发建议使用 Developer ID 签名并公证，否则
接收者首次打开时可能被 Gatekeeper 拦截。Linux 和 Windows 分别使用
`yarn pack-linux`、`yarn pack-windows`。

> 两个版本仍共用 `rndebugger:` 协议；同时安装时，不要依赖协议自动选择
> mcp 版本，建议手动启动 **React Native Debugger-mcp**。

## 接收者首次配置

1. 安装并启动 **React Native Debugger-mcp**。
2. 打开 **Debugger → Open Config File**，启用：

```json5
{
  agentBridge: {
    enabled: true,
  },
}
```

3. 重启 Debugger，并让 RN 应用连接 Remote JS Debugging。
4. 在 Codex 中注册随应用分发的 MCP：

```sh
codex mcp add react_native_debugger \
  --env ELECTRON_RUN_AS_NODE=1 \
  -- "/Applications/React Native Debugger-mcp.app/Contents/MacOS/React Native Debugger-mcp" \
  "/Applications/React Native Debugger-mcp.app/Contents/Resources/agent-mcp/src/index.js"

codex mcp list
```

也可以直接写入 `~/.codex/config.toml`：

```toml
[mcp_servers.react_native_debugger]
command = "/Applications/React Native Debugger-mcp.app/Contents/MacOS/React Native Debugger-mcp"
args = ["/Applications/React Native Debugger-mcp.app/Contents/Resources/agent-mcp/src/index.js"]
env = { ELECTRON_RUN_AS_NODE = "1" }
enabled = true
```

重启 Codex 或新建任务，让 Agent 重新发现 MCP 工具。

## 对话中如何命中

直接描述目标和过滤条件，不需要说工具名：

```text
读取当前 RN 会话中包含 env.configs.adpopup 的日志，只返回最近 20 条。
```

```text
查看 URL 包含 realTimeCalculate 的网络请求摘要，再读取最新一条的响应正文。
```

```text
读取 Redux 的 /components_data/superEnough，不要返回完整 state。
```

如果希望在某个项目中稳定优先使用，可在项目 `AGENTS.md` 加一句：

```md
排查 React Native 运行时问题时，优先使用 react_native_debugger MCP；
先按关键词、URL、actionType 或 JSON Pointer 缩小范围，再读取正文或完整值。
```

## 是否需要 Skill

目前**不需要**。MCP 的 7 个只读工具已有明确 schema，`AGENTS.md` 的一条
路由规则足以让 Agent 稳定命中，而且 MCP 能被不同 Agent 客户端复用。

仅在需要统一复杂排障流程（固定查询顺序、业务字段解释、自动生成报告）
时再增加 Skill。若以后要做到一键安装，可以进一步打包成同时包含 MCP
和 Skill 的 Codex Plugin。

参考：

- [Codex MCP 命令](https://learn.chatgpt.com/docs/developer-commands#codex-mcp)
- [Codex config.toml 配置](https://learn.chatgpt.com/docs/config-file/config-reference#configtoml)
