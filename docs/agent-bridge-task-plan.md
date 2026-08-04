# Agent Bridge Task Plan

This plan implements [Agent Bridge Design](agent-bridge-design.md).

## Working agreement

- Keep the bridge disabled by default.
- Keep the first release read-only.
- Do not add Hermes/New Architecture scope to this delivery.
- Preserve existing React Native Debugger behavior when the bridge is disabled.
- Do not commit or push until implementation and verification are complete.

## Workstreams

### A. Worker capture

Owner: `worker_capture` subtask

Primary files:

- `app/worker/agentCapture.js`
- `app/worker/index.js`
- `app/worker/networkInspect.js`
- focused unit tests

Deliverables:

- console and runtime-error event capture
- XHR lifecycle capture used by fetch and direct XHR
- serializable event envelope
- redacted/raw capture behavior
- body truncation metadata

Exit checks:

- existing console and XHR behavior is preserved
- fetch requests are not double-counted
- cyclic console values do not crash capture
- abort, timeout, error, text, JSON, and binary responses are covered

### B. Electron bridge core

Owner: `electron_bridge` subtask

Primary files:

- `electron/agent-bridge/*`
- focused unit tests

Deliverables:

- per-session bounded event storage
- stable cursor pagination
- request/response correlation
- token-protected loopback HTTP server
- discovery metadata and lifecycle primitives

Exit checks:

- server binds only to `127.0.0.1`
- invalid tokens never return session metadata
- all responses include sensitive-data mode
- session buffers cannot leak events across windows
- expired cursors are detectable

### C. MCP sidecar

Owner: `mcp_sidecar` subtask

Primary files:

- `agent-mcp/*`

Deliverables:

- discovery-file client
- HTTP bridge client
- MCP tool handlers
- raw-mode warnings
- sidecar setup documentation

Exit checks:

- bearer token is never returned or logged
- bridge-not-running and stale-discovery errors are actionable
- all list tools support bounded reads
- no tool can mutate the application or sensitive-data mode

### D. Integration and UI

Owner: primary task

Primary files:

- `electron/main.js`
- `electron/window.js`
- `electron/menu/*`
- `electron/context-menu.js`
- `electron/config/template.js`
- `app/middlewares/debuggerAPI.js`
- `app/middlewares/reduxAPI.js`
- project documentation and E2E fixtures

Deliverables:

- Agent Bridge process lifecycle
- renderer-to-main event routing
- session create/disconnect/reload lifecycle
- per-session `redacted`/`raw` UI control
- explicit raw-mode warning and automatic reset
- configuration documentation

Exit checks:

- Agent cannot enable raw mode
- raw mode affects only events captured after the switch
- reload, disconnect, and restart reset to redacted
- disabled bridge creates no listener, discovery file, or capture overhead

## Integration sequence

1. Review the three module contracts and normalize naming.
2. Integrate Agent Bridge startup behind `agentBridge.enabled`.
3. Create a session when the debugger worker connects.
4. Forward worker and Redux events through IPC.
5. Add the sensitive-data mode UI and confirmation.
6. Reset the mode and close the session on worker shutdown/reload.
7. Connect and smoke-test MCP tools against the running app.
8. Extend E2E fixtures and run the full validation matrix.

## Implemented decisions

- The sensitive-data control is **Debugger → Allow Agent Raw Sensitive Data**.
  It is scoped to the focused debugger window and current session.
- Sessions are retained in bounded process memory after disconnect and evicted
  by least recent activity when the 20-session limit is reached.
- `get_redux_state` is updated by `STATE`, `INIT`, and `ACTION`; an `ACTION`
  remains available through `get_redux_actions`. `ERROR`, `Error`, `EXPORT`,
  and other non-state-bearing protocol messages do not replace the latest
  Redux state.
- Binary request and response bodies expose metadata only. Base64 retrieval is
  outside this release.
- Textual Blob responses are decoded before capture; binary payloads remain
  metadata-only.
- MCP reads default to compact 20-record pages. Logs support server-side
  keyword search; Redux state supports JSON Pointer selection; Redux actions
  exclude state by default; Network lists return summaries before explicit
  detail reads.
- Discovery metadata is written to
  `~/.react-native-debugger/agent-bridge.json` with current-user-only file
  permissions.

## Validation matrix

| Area | Redacted | Raw | Reload/reset | Disabled |
| --- | --- | --- | --- | --- |
| Console | sensitive fields hidden | original values available | new session redacted | unchanged |
| Redux | common sensitive keys hidden | post-switch state/actions raw | new session redacted | unchanged |
| fetch | headers/query/body hidden | post-switch request/response raw | new session redacted | unchanged |
| direct XHR | headers/query/body hidden | post-switch request/response raw | new session redacted | unchanged |
| MCP | mode returned | warning returned | old/new sessions distinct | bridge unavailable |

## Verification status

Focused automated checks have passed for worker capture, Agent Bridge storage,
redaction, Redux routing, and the MCP sidecar. `git diff --check` also passes.

A real legacy Remote Debugger session still needs manual smoke testing and
end-to-end validation for console, Redux, fetch, direct XHR, reload, disconnect,
and multiple-window behavior.

The full `yarn test` command currently depends on external network fixtures.
`yarn test-e2e` is pending because the required 8081 port is occupied. These
environment constraints do not replace the release validation.

## Full validation commands

```bash
yarn test
yarn build
yarn test-e2e
```

Focused tests should run before the full commands. E2E requires ports 8081 and
8088 to be free.

## Delivery gate

Implementation is ready for review only when:

- the working tree contains only Agent Bridge changes
- focused automated results are recorded, and full-command constraints are
  explicitly documented
- sensitive-data behavior has explicit test evidence
- manual legacy-session smoke/E2E evidence is recorded before release
- no temporary logs, tokens, discovery files, or captured payloads are staged
