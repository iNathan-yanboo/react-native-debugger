// Browser boundary doubles are intentionally colocated with these lifecycle tests.
/* eslint-disable max-classes-per-file */
import { setDebuggerLocation } from '../../actions/debugger'

// Only browser/Electron boundaries are faked; every test loads the real middleware.
class FakeEventTarget {
  constructor() {
    this.listeners = new Map()
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type).add(listener)
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }

  emit(type, fields = {}) {
    const event = { target: this, currentTarget: this, ...fields }
    return Array.from(this.listeners.get(type) || []).map((listener) => listener(event))
  }
}

let sockets
let workers
let ipc
let ipcListeners
let dispatch
let handle
let checkPortStatus
let fakeWindow
let originalGlobals

class FakeSocket {
  static CONNECTING = 0

  static OPEN = 1

  static CLOSING = 2

  static CLOSED = 3

  constructor(url) {
    this.url = url
    this.readyState = FakeSocket.CONNECTING
    this.sent = []
    this.sendAttempts = 0
    sockets.push(this)
  }

  open() {
    this.readyState = FakeSocket.OPEN
    this.onopen?.({})
  }

  send(value) {
    this.sendAttempts += 1
    if (this.readyState === FakeSocket.CONNECTING) {
      const error = new Error('WebSocket is connecting')
      error.name = 'InvalidStateError'
      throw error
    }
    if (this.readyState === FakeSocket.OPEN) this.sent.push(JSON.parse(value))
  }

  receive(value) {
    return this.onmessage?.({ data: JSON.stringify(value) })
  }

  close() {
    this.readyState = FakeSocket.CLOSING
  }

  finishClose(fields = {}) {
    this.readyState = FakeSocket.CLOSED
    this.onclose?.({ code: 1006, reason: '', wasClean: false, ...fields })
  }
}

class FakeWorker extends FakeEventTarget {
  constructor(url) {
    super()
    this.url = url
    this.messages = []
    this.terminated = false
    workers.push(this)
  }

  postMessage(message) {
    this.messages.push(message)
  }

  terminate() {
    this.terminated = true
  }
}

const workerMessage = (worker, data) => worker.emit('message', { data })
const bridgeCalls = (channel) => ipc.send.mock.calls.filter(([name]) => name === channel)
const statusActions = () => dispatch.mock.calls.filter(([action]) => action.type === 'SET_DEBUGGER_STATUS')
const settle = () => jest.advanceTimersByTimeAsync(0)
const connect = async (port = 8081) => {
  handle(setDebuggerLocation({ host: 'localhost', port }))
  await settle()
  const socket = sockets[sockets.length - 1]
  socket.open()
  return socket
}
const prepare = async (socket, id = 1) => {
  await socket.receive({ id, method: 'prepareJSRuntime' })
  return workers[workers.length - 1]
}
const loadScript = (socket, id = 2) => socket.receive({
  id,
  method: 'executeApplicationScript',
  url: 'http://localhost:8081/index.bundle?platform=ios',
  inject: {},
})
const diagnostics = () => {
  expect(fakeWindow.getRNDebuggerConnectionDiagnostics).toEqual(expect.any(Function))
  return fakeWindow.getRNDebuggerConnectionDiagnostics()
}

beforeEach(() => {
  jest.resetModules()
  jest.useFakeTimers()
  sockets = []
  workers = []
  ipcListeners = new Map()
  let sessionNumber = 0
  ipc = {
    on: jest.fn((channel, listener) => ipcListeners.set(channel, listener)),
    send: jest.fn(),
    sendSync: jest.fn((channel) => {
      if (channel === 'agent-bridge-session-start') {
        sessionNumber += 1
        return { enabled: true, sessionId: `session-${sessionNumber}`, sensitiveDataMode: 'redacted' }
      }
      if (channel === 'network-mock-session-config') return { enabled: true, rules: [] }
      return undefined
    }),
  }
  checkPortStatus = jest.fn().mockResolvedValue('open')
  fakeWindow = new FakeEventTarget()
  fakeWindow.reactDevToolsPort = 8097
  const globals = {
    window: fakeWindow,
    Worker: FakeWorker,
    WebSocket: FakeSocket,
    postMessage: jest.fn(),
    __webpack_public_path__: 'js/',
  }
  originalGlobals = Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(global, key)])
  Object.entries(globals).forEach(([key, value]) => {
    Object.defineProperty(global, key, { configurable: true, writable: true, value })
  })
  jest.spyOn(console, 'clear').mockImplementation(() => {})
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.doMock('electron', () => ({ ipcRenderer: ipc }))
  jest.doMock('@electron/remote', () => ({
    getCurrentWindow: () => ({ webContents: { isDevToolsOpened: () => false } }),
  }))
  jest.doMock('portscanner', () => ({ checkPortStatus }))
  jest.doMock('../../utils/devMenu', () => ({
    setDevMenuMethods: jest.fn(),
    networkInspect: { isEnabled: () => false },
  }))
  jest.doMock('../../utils/adb', () => ({ tryADBReverse: jest.fn().mockResolvedValue() }))
  jest.doMock('../../utils/devtools', () => ({
    clearNetworkLogs: jest.fn(),
    selectRNDebuggerWorkerContext: jest.fn(),
  }))
  jest.doMock('../../utils/config', () => ({ port: 8081, timesJSLoadToRefreshDevTools: -1 }))
  // eslint-disable-next-line global-require
  const middleware = require('../debuggerAPI').default
  dispatch = jest.fn()
  handle = middleware({ dispatch })((action) => action)
})

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
  jest.restoreAllMocks()
  originalGlobals.forEach(([key, descriptor]) => {
    if (descriptor) Object.defineProperty(global, key, descriptor)
    else delete global[key]
  })
})

test('preserves the current handshake, bundle-before-queue ordering and native replies', async () => {
  const socket = await connect()
  const worker = await prepare(socket)
  const pending = { id: 3, method: 'callFunctionReturnFlushedQueue', arguments: [] }
  await socket.receive(pending)
  expect(worker.messages).toEqual([])
  await loadScript(socket)
  expect(worker.messages.map(({ method }) => method)).toEqual([
    'executeApplicationScript', pending.method,
  ])
  expect(worker.messages[0]).toMatchObject({
    agentCapture: { enabled: true, sessionId: 'session-1' },
    networkMock: { enabled: true, rules: [] },
  })
  workerMessage(worker, { replyID: 3, result: '[]' })
  expect(socket.sent).toEqual([{ replyID: 1 }, { replyID: 3, result: '[]' }])
})

test('does not publish connected state for every normal native call', async () => {
  const socket = await connect()
  await prepare(socket)
  await loadScript(socket)
  dispatch.mockClear()
  ipc.send.mockClear()
  for (let id = 3; id < 103; id += 1) {
    // eslint-disable-next-line no-await-in-loop
    await socket.receive({ id, method: 'flushedQueue' })
  }
  expect(statusActions()).toHaveLength(0)
  expect(bridgeCalls('agent-bridge-session-status')).toHaveLength(0)
})

test('notifies suspension once and retains MCP access until a new runtime is prepared', async () => {
  const socket = await connect()
  const worker = await prepare(socket)
  ipc.send.mockClear()
  await socket.receive({ $event: 'client-disconnected' })
  await socket.receive({ method: '$disconnected' })
  expect(bridgeCalls('agent-bridge-session-status')).toHaveLength(1)
  expect(bridgeCalls('agent-bridge-session-status')[0][1].status).toBe('suspended')
  expect(bridgeCalls('agent-bridge-session-end')).toHaveLength(0)
  expect(worker.terminated).toBe(false)
  workerMessage(worker, { agentCaptureEvent: true, event: { kind: 'console' } })
  expect(bridgeCalls('agent-bridge-event')).toHaveLength(1)
})

test('does not send a retained worker reply while the replacement socket is connecting', async () => {
  const first = await connect()
  const worker = await prepare(first)
  first.finishClose()
  await jest.advanceTimersByTimeAsync(500)
  expect(sockets).toHaveLength(2)
  const replacement = sockets[1]
  expect(() => workerMessage(worker, { replyID: 7 })).not.toThrow()
  expect(replacement.sendAttempts).toBe(0)
})

test('requires a new runtime handshake on an open replacement transport', async () => {
  const first = await connect()
  const worker = await prepare(first)
  await loadScript(first)
  first.finishClose()
  await jest.advanceTimersByTimeAsync(500)
  const replacement = sockets[1]
  replacement.open()
  const before = worker.messages.length
  await replacement.receive({ id: 8, method: 'flushedQueue' })
  workerMessage(worker, { replyID: 8 })
  expect(worker.messages).toHaveLength(before)
  expect(replacement.sent).toEqual([])
  const nextWorker = await prepare(replacement, 10)
  await loadScript(replacement, 11)
  workerMessage(nextWorker, { replyID: 11, result: '[]' })
  expect(replacement.sent).toEqual([{ replyID: 10 }, { replyID: 11, result: '[]' }])
})

test('rejects callbacks from a replaced worker even when reply IDs are reused', async () => {
  const socket = await connect()
  const oldWorker = await prepare(socket)
  const oldListener = Array.from(oldWorker.listeners.get('message'))[0]
  await prepare(socket, 2)
  ipc.send.mockClear()
  oldListener({ data: { replyID: 2 }, currentTarget: oldWorker })
  oldListener({ data: { agentCaptureEvent: true, event: { kind: 'console' } }, currentTarget: oldWorker })
  oldListener({ data: { agentCaptureConfigured: true, sensitiveDataMode: 'raw' }, currentTarget: oldWorker })
  expect(socket.sent).toEqual([{ replyID: 1 }, { replyID: 2 }])
  expect(ipc.send).not.toHaveBeenCalled()
})

test('does not transfer pre-bundle calls into the next runtime', async () => {
  const socket = await connect()
  await prepare(socket)
  await socket.receive({ id: 99, method: 'flushedQueue' })
  const replacement = await prepare(socket, 10)
  await loadScript(socket, 11)
  expect(replacement.messages.map(({ id }) => id)).toEqual([11])
})

test('requires a fresh prepare after client disconnect even on the same socket', async () => {
  const socket = await connect()
  const worker = await prepare(socket)
  await socket.receive({ id: 99, method: 'flushedQueue' })
  await socket.receive({ $event: 'client-disconnected' })
  await loadScript(socket, 4)
  workerMessage(worker, { replyID: 99 })
  expect(worker.messages).toEqual([])
  expect(socket.sent).toEqual([{ replyID: 1 }])
  const nextWorker = await prepare(socket, 10)
  await loadScript(socket, 11)
  expect(nextWorker.messages.map(({ id }) => id)).toEqual([11])
})

test.each([FakeSocket.CONNECTING, FakeSocket.CLOSING, FakeSocket.CLOSED])(
  'does not attempt replies when the owning socket has readyState %s',
  async (state) => {
    const socket = await connect()
    const worker = await prepare(socket)
    socket.readyState = state
    const attempts = socket.sendAttempts
    expect(() => workerMessage(worker, { replyID: 5 })).not.toThrow()
    expect(socket.sendAttempts).toBe(attempts)
  },
)

test('schedules only one reconnect for duplicate callbacks from a closed socket', async () => {
  const socket = await connect()
  await prepare(socket)
  const onClose = socket.onclose
  socket.finishClose()
  onClose({ code: 1006, reason: '', wasClean: false })
  await jest.advanceTimersByTimeAsync(500)
  expect(sockets).toHaveLength(2)
})

test('ignores an obsolete asynchronous port probe after changing target', async () => {
  let finishProbe
  checkPortStatus.mockImplementationOnce(() => new Promise((resolve) => { finishProbe = resolve }))
  handle(setDebuggerLocation({ host: 'localhost', port: 8081 }))
  const socket = await connect(9091)
  finishProbe('open')
  await settle()
  expect(sockets).toHaveLength(1)
  expect(socket.url).toContain(':9091/')
})

test('switches target without waiting for old close and ignores stale socket callbacks', async () => {
  const oldSocket = await connect()
  await prepare(oldSocket)
  const oldClose = oldSocket.onclose
  const oldMessage = oldSocket.onmessage
  handle(setDebuggerLocation({ host: 'localhost', port: 9091 }))
  await settle()
  expect(sockets).toHaveLength(2)
  const current = sockets[1]
  current.open()
  const worker = await prepare(current)
  await oldMessage({ data: JSON.stringify({ method: 'prepareJSRuntime', id: 55 }) })
  oldClose({ code: 1006, reason: '', wasClean: false })
  await jest.advanceTimersByTimeAsync(500)
  expect(sockets).toHaveLength(2)
  expect(workers[workers.length - 1]).toBe(worker)
  expect(worker.terminated).toBe(false)
})

test('records close metadata without copying unknown reason text or application payloads', async () => {
  const socket = await connect()
  await prepare(socket)
  socket.finishClose({ code: 1006, reason: 'Bearer secret-token; private request body', wasClean: false })
  expect(diagnostics()).toEqual(expect.arrayContaining([
    expect.objectContaining({ event: 'socket-closed', code: 1006, timestamp: expect.any(Number) }),
  ]))
  const recorded = JSON.stringify([diagnostics(), console.warn.mock.calls, console.info.mock.calls])
  expect(recorded).not.toContain('secret-token')
  expect(recorded).not.toContain('private request body')
})

test('records worker failures without suppressing the original error or copying its message', async () => {
  const socket = await connect()
  const worker = await prepare(socket)
  const preventDefault = jest.fn()
  worker.emit('error', { message: 'private runtime value', lineno: 21, colno: 4, preventDefault })
  expect(diagnostics()).toEqual(expect.arrayContaining([
    expect.objectContaining({ event: 'worker-error', line: 21, column: 4 }),
  ]))
  expect(JSON.stringify(diagnostics())).not.toContain('private runtime value')
  expect(preventDefault).not.toHaveBeenCalled()
})

test('bounds diagnostic history and returns copies rather than mutable internal records', async () => {
  const socket = await connect()
  const worker = await prepare(socket)
  for (let i = 0; i < 250; i += 1) worker.emit('messageerror', {})
  const snapshot = diagnostics()
  expect(snapshot).toHaveLength(200)
  expect(snapshot.every(({ event }) => event === 'worker-message-error')).toBe(true)
  snapshot[0].event = 'changed-by-caller'
  expect(diagnostics()[0].event).toBe('worker-message-error')
})

test.each(['{invalid-json', 'null', '[]', '42'])('ignores invalid proxy input %s', async (data) => {
  const socket = await connect()
  await expect(Promise.resolve().then(() => socket.onmessage({ data }))).resolves.toBeUndefined()
  expect(workers).toHaveLength(0)
  expect(diagnostics().some(({ event }) => event === 'invalid-proxy-message')).toBe(true)
})

test('keeps live capture and mock reconfiguration working without sending them to Metro', async () => {
  const socket = await connect()
  const worker = await prepare(socket)
  ipcListeners.get('agent-bridge-apply-mode')(null, { sessionId: 'session-1', sensitiveDataMode: 'raw' })
  ipcListeners.get('network-mock-apply')(null, { enabled: false, rules: [] })
  expect(worker.messages.map(({ method }) => method)).toEqual(['configureAgentCapture', 'configureNetworkMock'])
  workerMessage(worker, { agentCaptureConfigured: true, sensitiveDataMode: 'raw' })
  workerMessage(worker, { __IS_REDUX_NATIVE_MESSAGE__: true, content: {} })
  workerMessage(worker, { __REPORT_REACT_DEVTOOLS_PORT__: 8097 })
  expect(bridgeCalls('agent-bridge-mode-applied')[0][1]).toEqual({ sessionId: 'session-1', sensitiveDataMode: 'raw' })
  expect(socket.sent).toEqual([{ replyID: 1 }])
})

test('cleans up the worker and cancels reconnects when the renderer actually unloads', async () => {
  const socket = await connect()
  const worker = await prepare(socket)
  socket.finishClose()
  fakeWindow.emit('unload')
  await jest.advanceTimersByTimeAsync(2000)
  expect(sockets).toHaveLength(1)
  expect(worker.terminated).toBe(true)
  expect(bridgeCalls('agent-bridge-session-end')).toHaveLength(1)
})

test('does not throw an uncaught worker callback error if socket.send fails', async () => {
  const socket = await connect()
  const worker = await prepare(socket)
  socket.send = () => { throw new Error('private transport data') }
  expect(() => workerMessage(worker, { replyID: 2 })).not.toThrow()
  expect(diagnostics().some(({ event }) => event === 'socket-send-failed')).toBe(true)
  expect(JSON.stringify(diagnostics())).not.toContain('private transport data')
})

test('does not flood diagnostic or DevTools console history while Metro stays offline', async () => {
  checkPortStatus.mockResolvedValue('closed')
  handle(setDebuggerLocation({ host: 'localhost', port: 8081 }))
  await jest.advanceTimersByTimeAsync(30000)
  expect(sockets).toHaveLength(0)
  expect(diagnostics().filter(({ event }) => event === 'reconnect-scheduled')).toHaveLength(1)
  expect(console.info).not.toHaveBeenCalled()
  expect(console.warn).not.toHaveBeenCalled()
})
