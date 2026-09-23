/**
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

// Take from https://github.com/facebook/react-native/blob/master/local-cli/server/util/debugger.html

import { getCurrentWindow } from '@electron/remote'
import { ipcRenderer } from 'electron'
import { bindActionCreators } from 'redux'
import { checkPortStatus } from 'portscanner'
import * as debuggerActions from '../actions/debugger'
import { setDevMenuMethods, networkInspect } from '../utils/devMenu'
import { tryADBReverse } from '../utils/adb'
import { clearNetworkLogs, selectRNDebuggerWorkerContext } from '../utils/devtools'
import config from '../utils/config'

const currentWindow = getCurrentWindow()
const { SET_DEBUGGER_LOCATION, BEFORE_WINDOW_CLOSE } = debuggerActions

let worker
let workerSocket
let removeWorkerListeners
let runtimeSuspended = false
let runtimeSequence = 0
let connectionGeneration = 0
let connectionSequence = 0
let rendererUnloaded = false
let queuedMessages = []
let scriptExecuted = false
let actions
let host
let port
let socket
let agentCaptureConfig = { enabled: false }
let networkMockConfig = { enabled: false, rules: [] }
const APOLLO_MESSAGE_PREFIX = 'ac-devtools:'
const connectionDiagnostics = []
const MAX_CONNECTION_DIAGNOSTICS = 200
const knownCloseReasons = new Set([
  '',
  'Another debugger is already connected',
  'Debugger was disconnected',
  'Client was disconnected',
])

// Keep a bounded, payload-free trace across the usual console clears on Reload.
window.getRNDebuggerConnectionDiagnostics = () => connectionDiagnostics.map((entry) => ({ ...entry }))
const recordConnectionEvent = (event, details = {}) => {
  const entry = {
    timestamp: Date.now(),
    event,
    connectionId: connectionSequence,
    runtimeId: runtimeSequence,
    ...details,
  }
  connectionDiagnostics.push(entry)
  if (connectionDiagnostics.length > MAX_CONNECTION_DIAGNOSTICS) connectionDiagnostics.shift()
  // Do not mirror the trace into unbounded DevTools console history.
}

const updateAgentBridgeSessionStatus = (status, reason) => {
  if (!agentCaptureConfig.enabled) return
  ipcRenderer.send('agent-bridge-session-status', {
    sessionId: agentCaptureConfig.sessionId,
    status,
    ...(reason ? { reason } : {}),
  })
}

const suspendJSRuntimeForClientDisconnect = (reason = 'client-disconnected') => {
  queuedMessages = []
  if (!worker || runtimeSuspended) return
  runtimeSuspended = true
  actions.setDebuggerStatus('waiting')
  updateAgentBridgeSessionStatus('suspended', reason)
  recordConnectionEvent('runtime-suspended', { reason })
}

const sendDebuggerMessage = (ws, data) => {
  if (rendererUnloaded || !ws || ws !== socket || ws.readyState !== WebSocket.OPEN) return false
  try {
    ws.send(JSON.stringify(data))
    return true
  } catch (error) {
    // Do not queue/replay replies: their IDs belong to the original native runtime.
    recordConnectionEvent('socket-send-failed', { readyState: ws.readyState })
    suspendJSRuntimeForClientDisconnect('debugger-websocket-send-failed')
    ws.close()
    return false
  }
}

const workerOnMessage = (message, sourceWorker, ownerSocket) => {
  // A terminated worker may still have a callback already queued in the renderer.
  if (rendererUnloaded || sourceWorker !== worker) return false
  const { data } = message

  if (data && data.agentCaptureEvent) {
    ipcRenderer.send('agent-bridge-event', data.event)
    return false
  }
  if (data && data.agentCaptureConfigured) {
    ipcRenderer.send('agent-bridge-mode-applied', {
      sessionId: agentCaptureConfig.sessionId,
      sensitiveDataMode: data.sensitiveDataMode,
    })
    return false
  }
  if (data && data.message?.startsWith(APOLLO_MESSAGE_PREFIX)) {
    data.__FROM_DEBUGGER_WORKER__ = true
    postMessage(data, '*')
    return false
  }

  if (data && (data.__IS_REDUX_NATIVE_MESSAGE__ || data.__REPORT_REACT_DEVTOOLS_PORT__)) {
    return true
  }
  const list = data && data.__AVAILABLE_METHODS_CAN_CALL_BY_RNDEBUGGER__
  if (list) {
    setDevMenuMethods(list, worker)
    return false
  }
  if (runtimeSuspended || workerSocket !== ownerSocket) return false
  return sendDebuggerMessage(ownerSocket, data)
}

const onWindowMessage = (e) => {
  if (!worker || rendererUnloaded) return
  const { data } = e
  if (
    !data?.__FROM_DEBUGGER_WORKER__ &&
    data?.message?.startsWith(APOLLO_MESSAGE_PREFIX)
  ) {
    worker.postMessage({
      method: 'emitApolloMessage',
      ...data,
    })
    return false
  }
}

const createJSRuntime = (ws) => {
  // Execute app JavaScript without a document, as in the native JSC environment.
  // eslint-disable-next-line no-undef, camelcase
  const runtimeWorker = new Worker(`${__webpack_public_path__}RNDebuggerWorker.js`)
  worker = runtimeWorker
  workerSocket = ws
  runtimeSuspended = false
  runtimeSequence += 1
  const onMessage = (message) => workerOnMessage(message, runtimeWorker, ws)
  const onError = (error) => {
    if (runtimeWorker !== worker || rendererUnloaded) return
    // Leave the original error visible in DevTools; do not copy app values/URLs.
    recordConnectionEvent('worker-error', { line: error.lineno, column: error.colno })
  }
  const onMessageError = () => {
    if (runtimeWorker === worker && !rendererUnloaded) recordConnectionEvent('worker-message-error')
  }
  runtimeWorker.addEventListener('message', onMessage)
  runtimeWorker.addEventListener('error', onError)
  runtimeWorker.addEventListener('messageerror', onMessageError)
  removeWorkerListeners = () => {
    runtimeWorker.removeEventListener('message', onMessage)
    runtimeWorker.removeEventListener('error', onError)
    runtimeWorker.removeEventListener('messageerror', onMessageError)
  }
  window.addEventListener('message', onWindowMessage)
  actions.setDebuggerWorker(runtimeWorker, 'connected')
  recordConnectionEvent('runtime-prepared')
}

const shutdownJSRuntime = () => {
  scriptExecuted = false
  queuedMessages = []
  workerSocket = null
  runtimeSuspended = false
  removeWorkerListeners?.()
  removeWorkerListeners = null
  window.removeEventListener('message', onWindowMessage)
  if (worker) {
    worker.terminate()
    setDevMenuMethods([])
    recordConnectionEvent('runtime-stopped')
  }
  worker = null
  actions.setDebuggerWorker(null, 'disconnected')
  if (agentCaptureConfig.enabled) {
    ipcRenderer.send('agent-bridge-session-end', {
      sessionId: agentCaptureConfig.sessionId,
    })
    agentCaptureConfig = { enabled: false }
  }
}

const isScriptBuildForAndroid = (url) => url && (url.indexOf('.android.bundle') > -1 || url.indexOf('platform=android') > -1)

let preconnectTimeout
let reconnectScheduled = false
const preconnect = async (fn, firstTimeout = false, generation = connectionGeneration) => {
  if (rendererUnloaded || generation !== connectionGeneration) return
  clearTimeout(preconnectTimeout)
  preconnectTimeout = null
  if (firstTimeout) {
    if (!reconnectScheduled) recordConnectionEvent('reconnect-scheduled', { delayMs: 500 })
    reconnectScheduled = true
    preconnectTimeout = setTimeout(() => preconnect(fn, false, generation), 500)
    return
  }
  try {
    const status = await checkPortStatus(port, host)
    // The target or renderer may have changed while the port probe was pending.
    if (rendererUnloaded || generation !== connectionGeneration) return
    if (status !== 'open') {
      preconnect(fn, true, generation)
      return
    }
    if (!socket) {
      socket = fn(generation)
      reconnectScheduled = false
    }
  } catch (error) {
    if (rendererUnloaded || generation !== connectionGeneration) return
    if (!reconnectScheduled) recordConnectionEvent('connection-attempt-failed')
    preconnect(fn, true, generation)
  }
}

const clearLogs = () => {
  if (process.env.NODE_ENV !== 'development') {
    console.clear()
    clearNetworkLogs(currentWindow)
  }
}

const flushQueuedMessages = () => {
  if (!worker) return
  // Flush any messages queued up and clear them
  queuedMessages.forEach((message) => worker.postMessage(message))
  queuedMessages = []
}

let loadCount = 0
const checkJSLoadCount = () => {
  loadCount += 1
  if (
    currentWindow.webContents.isDevToolsOpened()
    && config.timesJSLoadToRefreshDevTools >= 0
    && loadCount > 0
    && loadCount % config.timesJSLoadToRefreshDevTools === 0
  ) {
    currentWindow.webContents.closeDevTools()
    currentWindow.webContents.openDevTools()
    console.warn(
      '[RNDebugger]',
      `Refreshed the devtools panel as React Native app was reloaded ${loadCount} times.`,
      'If you want to update or disable this,',
      'Open `Debugger` -> `Open Config File` to change `timesJSLoadToRefreshDevTools` field.',
    )
    loadCount = 0
  }
}

const connectToDebuggerProxy = (generation) => {
  const ws = new WebSocket(`ws://${host}:${port}/debugger-proxy?role=debugger&name=Chrome`)

  connectionSequence += 1
  recordConnectionEvent('socket-connecting')
  const isCurrent = () => !rendererUnloaded && generation === connectionGeneration && socket === ws
  ws.onopen = () => {
    if (!isCurrent()) return
    actions.setDebuggerStatus('waiting')
    recordConnectionEvent('socket-open')
  }
  ws.onmessage = (message) => {
    if (!isCurrent() || ws.readyState !== WebSocket.OPEN || !message.data) return

    let object
    try {
      object = JSON.parse(message.data)
    } catch (error) {
      recordConnectionEvent('invalid-proxy-message')
      return
    }
    if (!object || typeof object !== 'object' || Array.isArray(object)) {
      recordConnectionEvent('invalid-proxy-message')
      return
    }
    if (object.$event === 'client-disconnected') {
      suspendJSRuntimeForClientDisconnect()
      return
    }
    if (!object.method) return

    // Special message that asks for a new JS runtime
    if (object.method === 'prepareJSRuntime') {
      shutdownJSRuntime()
      agentCaptureConfig = ipcRenderer.sendSync('agent-bridge-session-start', {
        host,
        port,
      }) || { enabled: false }
      networkMockConfig = ipcRenderer.sendSync('network-mock-session-config') || networkMockConfig
      createJSRuntime(ws)
      clearLogs()
      selectRNDebuggerWorkerContext(currentWindow)
      sendDebuggerMessage(ws, { replyID: object.id })
    } else if (object.method === '$disconnected') {
      suspendJSRuntimeForClientDisconnect('debugger-disconnected')
    } else {
      // Socket OPEN alone does not identify a new native JS runtime. Only
      // prepareJSRuntime may replace the suspended worker and start a new session.
      if (!worker || workerSocket !== ws || runtimeSuspended) return
      if (object.method === 'executeApplicationScript') {
        object.networkInspect = networkInspect.isEnabled()
        object.networkMock = networkMockConfig
        object.reactDevToolsPort = window.reactDevToolsPort
        object.agentCapture = agentCaptureConfig
        if (isScriptBuildForAndroid(object.url)) {
          // Reserve React Inspector port for debug via USB on Android real device
          tryADBReverse(window.reactDevToolsPort).catch(() => {})
        }
        // Clear logs even if no error catched
        clearLogs()
        scriptExecuted = true
        recordConnectionEvent('bundle-dispatched')
        checkJSLoadCount()
      }
      if (scriptExecuted) {
        // Otherwise, pass through to the worker provided the
        // application script has been executed. If not add
        // it to a queue until it has been executed.
        worker.postMessage(object)
        flushQueuedMessages()
      } else {
        queuedMessages.push(object)
      }
    }
  }

  ws.onerror = () => {
    if (isCurrent()) recordConnectionEvent('socket-error', { readyState: ws.readyState })
  }
  ws.onclose = (e) => {
    if (!isCurrent()) return
    recordConnectionEvent('socket-closed', {
      code: e.code,
      wasClean: e.wasClean,
      // Close reasons are server-controlled. Keep known protocol reasons only.
      reason: knownCloseReasons.has(e.reason) ? e.reason : '[redacted]',
    })
    socket = null
    suspendJSRuntimeForClientDisconnect('debugger-websocket-closed')
    preconnect(connectToDebuggerProxy, true, generation)
  }
  return ws
}

ipcRenderer.on('agent-bridge-apply-mode', (event, nextConfig) => {
  if (!agentCaptureConfig.enabled || nextConfig.sessionId !== agentCaptureConfig.sessionId) return
  agentCaptureConfig = {
    ...agentCaptureConfig,
    ...nextConfig,
  }
  if (worker) {
    worker.postMessage({
      method: 'configureAgentCapture',
      agentCapture: agentCaptureConfig,
    })
  } else {
    ipcRenderer.send('agent-bridge-mode-applied', {
      sessionId: agentCaptureConfig.sessionId,
      sensitiveDataMode: agentCaptureConfig.sensitiveDataMode,
    })
  }
})

ipcRenderer.on('network-mock-apply', (event, nextConfig) => {
  networkMockConfig = nextConfig || { enabled: false, rules: [] }
  if (worker) worker.postMessage({ method: 'configureNetworkMock', networkMock: networkMockConfig })
})

const setDebuggerLoc = ({ host: packagerHost, port: packagerPort }) => {
  const nextHost = packagerHost || 'localhost'
  const nextPort = Number(packagerPort || config.port || 8081)
  if (rendererUnloaded || (host === nextHost && port === nextPort)) return

  connectionGeneration += 1
  reconnectScheduled = false
  clearTimeout(preconnectTimeout)
  preconnectTimeout = null
  host = nextHost
  port = nextPort
  const previousSocket = socket
  socket = null
  shutdownJSRuntime()
  // Invalidate old callbacks before closing; a delayed close must not reconnect.
  if (previousSocket) previousSocket.close()
  recordConnectionEvent('target-changed')
  preconnect(connectToDebuggerProxy)
}

window.addEventListener('unload', () => {
  rendererUnloaded = true
  connectionGeneration += 1
  reconnectScheduled = false
  clearTimeout(preconnectTimeout)
  preconnectTimeout = null
  const previousSocket = socket
  socket = null
  if (previousSocket) previousSocket.close()
  shutdownJSRuntime()
})

export default ({ dispatch }) => {
  actions = bindActionCreators(debuggerActions, dispatch)

  return (next) => (action) => {
    if (action.type === SET_DEBUGGER_LOCATION) {
      setDebuggerLoc(action.loc)
    }
    if (action.type === BEFORE_WINDOW_CLOSE) {
      // Return boolean instead of handle reducer
      if (!worker) return false
      worker.postMessage({ method: 'beforeTerminate' })
      return true
    }
    return next(action)
  }
}
