import crypto from 'crypto'
import os from 'os'
import path from 'path'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
} from 'electron'
import Store from 'electron-store'
import {
  AgentEventStore,
  createAgentBridge,
  removeDiscoveryFile,
} from '.'
import { DiskHistoryStore } from './history-store'
import { redactValue } from './redaction'
import {
  listNetworkMocks,
  removeNetworkMock,
  saveNetworkMock,
  setNetworkMockEnabled,
} from '../network-mock-store'
import {
  readSensitiveDataMode,
  writeSensitiveDataMode,
} from './sensitive-data-preference'

const DEFAULTS = {
  enabled: false,
  maxConsoleEvents: 2000,
  maxReduxActions: 1000,
  maxNetworkRequests: 500,
  maxEvents: 4000,
  maxBodyBytes: 256 * 1024,
  persistHistory: true,
  persistSensitiveDataMode: true,
  maxHistoricalSessions: 2,
  maxHistoryDiskBytes: 256 * 1024 * 1024,
  historyTtlMinutes: 24 * 60,
}

const sessionsByWebContents = new Map()
const pendingModes = new Map()
const sensitiveDataPreferenceStore = new Store({ name: 'agent-bridge-preferences' })
let bridge
let runtimeConfig = { ...DEFAULTS }
let ipcRegistered = false
let discoveryPath

const createSessionId = () => (
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex')
)

const getDiscoveryPath = () => path.join(
  os.homedir(),
  '.react-native-debugger',
  'agent-bridge.json',
)

const getHistoryPath = () => path.join(
  app.getPath('userData'),
  'agent-bridge-history',
  'v1',
)

const getPreferredSensitiveDataMode = () => readSensitiveDataMode(
  sensitiveDataPreferenceStore,
  runtimeConfig.persistSensitiveDataMode !== false,
)

const rememberSensitiveDataMode = (sensitiveDataMode) => {
  writeSensitiveDataMode(
    sensitiveDataPreferenceStore,
    sensitiveDataMode,
    runtimeConfig.persistSensitiveDataMode !== false,
  )
}

const getMenuItem = () => {
  const menu = Menu.getApplicationMenu()
  return menu && menu.getMenuItemById('agent-sensitive-data')
}

const getSession = (webContentsId) => {
  if (!bridge) return null
  const sessionId = sessionsByWebContents.get(webContentsId)
  return sessionId ? bridge.store.getSession(sessionId) : null
}

export function syncAgentBridgeMenu(win) {
  const menuItem = getMenuItem()
  if (!menuItem) return
  const focusedWindow = BrowserWindow.getFocusedWindow()
  if (win && focusedWindow && win.id !== focusedWindow.id) return
  const targetWindow = focusedWindow || win
  const session = targetWindow && getSession(targetWindow.webContents.id)
  menuItem.enabled = !!session
  menuItem.checked = !!session && session.sensitiveDataMode === 'raw'
}

const updateSessionMetadata = (sessionId, patch) => {
  const current = bridge && bridge.store.getSession(sessionId)
  if (!current) return null
  return bridge.registerSession({
    sessionId,
    sensitiveDataMode: current.sensitiveDataMode,
    metadata: {
      ...current.metadata,
      ...patch,
    },
  })
}

const endSession = (webContentsId) => {
  const sessionId = sessionsByWebContents.get(webContentsId)
  if (!sessionId || !bridge) return
  updateSessionMetadata(sessionId, {
    status: 'disconnected',
    disconnectedAt: Date.now(),
  })
  try {
    bridge.store.archiveSession(sessionId)
  } catch (error) {
    // Detached sessions must never remain in the main-process heap merely
    // because local history storage is temporarily unavailable.
    bridge.store.discardSession(sessionId)
    console.warn('[RNDebugger] Failed to archive Agent Bridge session:', error)
  }
  sessionsByWebContents.delete(webContentsId)
  pendingModes.delete(webContentsId)
}

export const endAgentBridgeSession = (webContentsId) => {
  endSession(webContentsId)
  syncAgentBridgeMenu(BrowserWindow.getFocusedWindow())
}

const updateAgentBridgeSessionStatus = (
  webContentsId,
  { sessionId, status, reason } = {},
) => {
  if (!bridge || !sessionId || sessionsByWebContents.get(webContentsId) !== sessionId) return
  if (status !== 'suspended' && status !== 'connected') return
  updateSessionMetadata(sessionId, {
    status,
    ...(status === 'suspended' ? { suspendedAt: Date.now() } : { resumedAt: Date.now() }),
    ...(reason ? { disconnectReason: reason } : {}),
  })
}

const normalizeEvent = (event, mode) => {
  const payload = mode === 'raw' ? event.payload : redactValue(event.payload)
  return {
    type: event.kind,
    timestamp: event.timestamp,
    sensitiveDataMode: mode,
    payload: {
      ...payload,
      sourceSeq: event.seq,
      sourceVersion: event.version,
    },
  }
}

const ingestWorkerEvent = (webContentsId, event) => {
  const session = getSession(webContentsId)
  if (!session || !event || typeof event.kind !== 'string') return
  if (event.sensitiveDataMode !== session.sensitiveDataMode) {
    // Mode transitions are acknowledged by the worker. Events from the old
    // mode are intentionally dropped instead of being mislabeled.
    return
  }
  bridge.ingest({
    sessionId: session.sessionId,
    ...normalizeEvent(event, session.sensitiveDataMode),
  })
}

export const getReduxEventTypes = (request) => {
  const requestType = typeof request.type === 'string' ? request.type.toUpperCase() : ''
  if (requestType === 'ACTION') return ['redux-action', 'redux-state']
  if (requestType === 'STATE' || requestType === 'INIT') return ['redux-state']
  return []
}

const ingestReduxEvent = (webContentsId, request) => {
  const session = getSession(webContentsId)
  if (!session || !request) return
  if (!getReduxEventTypes(request).length) return
  const payload = session.sensitiveDataMode === 'raw' ? request : redactValue(request)
  bridge.ingestReduxMessage({
    sessionId: session.sessionId,
    sensitiveDataMode: session.sensitiveDataMode,
    request: payload,
  })
}

const beginSession = (event, metadata = {}) => {
  if (!bridge || !runtimeConfig.enabled) return { enabled: false }
  endSession(event.sender.id)
  const sessionId = createSessionId()
  const sensitiveDataMode = getPreferredSensitiveDataMode()
  bridge.registerSession({
    sessionId,
    sensitiveDataMode,
    metadata: {
      ...metadata,
      webContentsId: event.sender.id,
      status: 'connected',
      connectedAt: Date.now(),
    },
  })
  sessionsByWebContents.set(event.sender.id, sessionId)
  syncAgentBridgeMenu(BrowserWindow.fromWebContents(event.sender))
  return {
    enabled: true,
    sessionId,
    sensitiveDataMode,
    maxBodyBytes: runtimeConfig.maxBodyBytes,
  }
}

const applyModeAcknowledgement = (event, { sessionId, sensitiveDataMode }) => {
  const currentSessionId = sessionsByWebContents.get(event.sender.id)
  const pendingMode = pendingModes.get(event.sender.id)
  if (!bridge || currentSessionId !== sessionId || pendingMode !== sensitiveDataMode) return
  bridge.setSessionSensitiveDataMode(sessionId, sensitiveDataMode)
  rememberSensitiveDataMode(sensitiveDataMode)
  pendingModes.delete(event.sender.id)
  syncAgentBridgeMenu(BrowserWindow.fromWebContents(event.sender))
}

export const registerAgentBridgeIpc = () => {
  if (ipcRegistered) return
  ipcRegistered = true
  ipcMain.on('agent-bridge-session-start', (event, metadata) => {
    event.returnValue = beginSession(event, metadata)
  })
  ipcMain.on('agent-bridge-session-end', (event, { sessionId } = {}) => {
    if (sessionId && sessionsByWebContents.get(event.sender.id) !== sessionId) return
    endSession(event.sender.id)
    syncAgentBridgeMenu(BrowserWindow.fromWebContents(event.sender))
  })
  ipcMain.on('agent-bridge-session-status', (event, payload) => {
    updateAgentBridgeSessionStatus(event.sender.id, payload)
    syncAgentBridgeMenu(BrowserWindow.fromWebContents(event.sender))
  })
  ipcMain.on('agent-bridge-event', (event, capturedEvent) => {
    ingestWorkerEvent(event.sender.id, capturedEvent)
  })
  ipcMain.on('agent-bridge-redux-event', (event, request) => {
    ingestReduxEvent(event.sender.id, request)
  })
  ipcMain.on('agent-bridge-mode-applied', applyModeAcknowledgement)
}

export const startAgentBridgeRuntime = async (agentBridgeConfig = {}) => {
  runtimeConfig = {
    ...DEFAULTS,
    ...(agentBridgeConfig || {}),
  }
  discoveryPath = getDiscoveryPath()
  removeDiscoveryFile(discoveryPath)
  if (!runtimeConfig.enabled) return null
  const historyStore = runtimeConfig.persistHistory === false
    ? null
    : new DiskHistoryStore({
      directory: getHistoryPath(),
      maxSessions: runtimeConfig.maxHistoricalSessions,
      maxBytes: runtimeConfig.maxHistoryDiskBytes,
      ttlMs: runtimeConfig.historyTtlMinutes * 60 * 1000,
    })
  if (historyStore) historyStore.prune()
  const store = new AgentEventStore({
    limits: {
      logs: runtimeConfig.maxConsoleEvents,
      actions: runtimeConfig.maxReduxActions,
      network: runtimeConfig.maxNetworkRequests,
      events: runtimeConfig.maxEvents,
    },
    historyStore,
  })
  bridge = createAgentBridge({
    store,
    networkMocks: {
      list: listNetworkMocks,
      save: saveNetworkMock,
      setEnabled: setNetworkMockEnabled,
      remove: removeNetworkMock,
    },
  })
  try {
    await bridge.start()
    bridge.publishDiscovery(discoveryPath)
    return bridge.discovery
  } catch (error) {
    bridge = null
    throw error
  }
}

export const stopAgentBridgeRuntime = async () => {
  if (bridge && discoveryPath) bridge.removeDiscovery(discoveryPath)
  sessionsByWebContents.clear()
  pendingModes.clear()
  const activeBridge = bridge
  bridge = null
  if (activeBridge) await activeBridge.stop()
}

export const requestRawSensitiveDataForWindow = async (win, enabled) => {
  if (!bridge || !win) return false
  const session = getSession(win.webContents.id)
  if (!session) return false
  const sensitiveDataMode = enabled ? 'raw' : 'redacted'
  if (enabled) {
    const result = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Cancel', 'Allow Raw Data'],
      defaultId: 0,
      cancelId: 0,
      title: 'Allow Agent Access to Sensitive Data?',
      message: 'Raw mode may expose credentials, personal data, Redux state, and request bodies to local agents.',
      detail: [
        runtimeConfig.persistSensitiveDataMode === false
          ? 'The raw-data choice applies only to the current debug session and resets after reload or restart.'
          : 'The raw-data choice is remembered across reloads, new JS runtimes, and Debugger restarts.',
        runtimeConfig.persistHistory === false
          ? 'Captured raw data is discarded when the session ends.'
          : 'Captured raw data may remain in the local history archive after the session ends until its cleanup limits apply.',
      ].join(' '),
    })
    if (result.response !== 1) {
      syncAgentBridgeMenu(win)
      return false
    }
  }
  pendingModes.set(win.webContents.id, sensitiveDataMode)
  win.webContents.send('agent-bridge-apply-mode', {
    sessionId: session.sessionId,
    sensitiveDataMode,
    maxBodyBytes: runtimeConfig.maxBodyBytes,
  })
  return true
}

export const isAgentBridgeEnabled = () => !!bridge

export {
  DEFAULTS,
  getDiscoveryPath,
  getHistoryPath,
}
