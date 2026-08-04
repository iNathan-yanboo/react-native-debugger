# Agent Bridge

Agent Bridge exposes console logs, Redux DevTools state/actions, and Network
Inspect requests from a running React Native Debugger session to local agents.
It is read-only and disabled by default.

This feature has the same compatibility boundary as React Native Debugger: it
supports applications using the legacy Remote Debugger. It does not add Hermes,
JSI, or React Native New Architecture debugger support.

## Enable

Open **Debugger → Open Config File** and add:

```json5
{
  agentBridge: {
    enabled: true,
    maxConsoleEvents: 2000,
    maxReduxActions: 1000,
  maxNetworkRequests: 500,
  maxEvents: 4000,
  maxBodyBytes: 262144,
  persistHistory: true,
  maxHistoricalSessions: 2,
  maxHistoryDiskBytes: 268435456,
  historyTtlMinutes: 1440,
  },
}
```

Restart React Native Debugger after changing the config.

Disconnected sessions are immediately removed from the Electron main-process
heap. When `persistHistory` is enabled, their captured data is retained in a
current-user-only local archive until either `maxHistoricalSessions`,
`maxHistoryDiskBytes`, or `historyTtlMinutes` requires cleanup. Set
`persistHistory: false` to discard disconnected-session history immediately.
Raw-mode data follows the same retention policy; the confirmation dialog
states this before raw mode is enabled.

When enabled, RNDebugger starts an authenticated HTTP server on a random
`127.0.0.1` port and writes discovery metadata to:

```text
~/.react-native-debugger/agent-bridge.json
```

The discovery file is readable only by the current OS user and is removed when
RNDebugger exits normally.

## Connect an MCP host

The repository includes a dependency-free Node.js MCP sidecar:

```sh
node /absolute/path/to/react-native-debugger/agent-mcp/src/index.js
```

It discovers the default file automatically. A different path can be selected
with `--discovery` or `RNDEBUGGER_AGENT_DISCOVERY`.

Example Codex MCP configuration:

```toml
[mcp_servers.react_native_debugger]
command = "node"
args = ["/absolute/path/to/react-native-debugger/agent-mcp/src/index.js"]
```

Available read-only tools:

- `list_debug_sessions`
- `get_console_logs`
- `get_redux_state`
- `get_redux_actions`
- `get_network_requests`
- `get_network_request`
- `wait_for_debug_event`

## Token-efficient reads

MCP list tools return compact, bounded results by default. Filtering and
projection happen inside the bridge before data reaches the Agent context.

- `get_console_logs` supports case-insensitive `search`, `level`, `since`,
  `cursor`, and `limit`. Compact results render each console entry as a bounded
  message instead of returning large logged objects. Truncated messages include
  byte-length metadata, and search results carry `searchMatched=true`.
- `get_redux_state` accepts a JSON Pointer `path`, such as
  `/components_data/superEnough`, so an Agent can read one subtree.
- `get_redux_actions` excludes the action-linked state snapshot unless
  `includeState=true`.
- `get_network_requests` returns request summaries by default. Headers and
  bodies are opt-in.
- `get_network_request` reads one request by `requestId` and returns bounded
  request/response body previews.
- `wait_for_debug_event` returns a compact projected event instead of the full
  captured payload. Redux state is omitted by default; callers can opt in with
  `includeState=true` and optionally select a JSON Pointer `path`.

The main guards are `maxValueBytes`, `bodyPreviewBytes`, and `maxResultBytes`.
When a guard is reached, the response reports truncation and retains a cursor
for the next incremental read.

Example targeted arguments:

```json
{
  "sessionId": "session-id",
  "search": "Failed prop type",
  "level": "error",
  "limit": 10
}
```

```json
{
  "sessionId": "session-id",
  "method": "POST",
  "url": "realTimeCalculate",
  "status": 200,
  "limit": 5
}
```

## Sensitive-data modes

Every new or reloaded session starts in `redacted` mode. Authorization headers,
cookies, common credential query values, and sensitive JSON/Redux keys are
redacted.

When original values are required for debugging, use:

**Debugger → Allow Agent Raw Sensitive Data**

RNDebugger shows a warning before enabling raw mode. Raw mode:

- applies only to the current session;
- affects only events captured after the switch;
- is clearly reported in every bridge/MCP result;
- resets to redacted after reload or disconnect;
- cannot be enabled by an MCP tool or agent.

Previously captured raw events remain marked as raw while retained in memory.
Any result containing one of those events continues to carry the raw warning,
even after the current session has switched back to redacted.

Switching back to redacted mode is applied inside the debugger worker before
the main process marks the session redacted, preventing raw events from being
stored under a redacted label.

## Data scope

Captured:

- JavaScript `console.log/info/warn/error/debug`
- uncaught JavaScript errors and unhandled promise rejections
- Redux DevTools state and action messages
- fetch and direct XMLHttpRequest traffic handled by Network Inspect

Textual Blob responses, including JSON returned through the fetch polyfill, are
decoded to text before capture. Non-text binary bodies remain metadata-only.

Not captured:

- Android Logcat
- iOS OSLog
- Metro terminal output
- image/native-module requests that do not pass through debugger fetch/XHR
- Hermes/New Architecture debugger events

Captured data is held in bounded main-process memory and is not persisted to
disk. Request and response bodies are truncated at `maxBodyBytes`.

## Security properties

- disabled by default
- loopback-only listener
- random bearer token per RNDebugger launch
- current-user-only discovery file
- no CORS/browser-origin access
- no Redux dispatch, state mutation, request replay, or mode-changing MCP tool

See [Agent Bridge Design](agent-bridge-design.md) for the detailed contract and
[Agent Bridge Task Plan](agent-bridge-task-plan.md) for the delivery plan.
