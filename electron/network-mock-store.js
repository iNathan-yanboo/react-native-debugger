import crypto from 'crypto'
import { BrowserWindow, ipcMain } from 'electron'
import Store from 'electron-store'

const storage = new Store({ name: 'network-mocks' })
const STORAGE_KEY = 'rules'

const createId = () => (typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : crypto.randomBytes(16).toString('hex'))

const isValidId = (id) => typeof id === 'string' && id && id !== 'undefined'

const normalizeHeaders = (headers) => (
  headers && typeof headers === 'object' && !Array.isArray(headers) ? headers : {}
)

const normalizeRule = (value = {}, existing = {}) => ({
  id: existing.id || value.id || createId(),
  enabled: value.enabled !== false,
  url: String(value.url || existing.url || ''),
  urlMatchType: value.urlMatchType === 'regex' ? 'regex' : (existing.urlMatchType || 'exact'),
  method: value.method ? String(value.method).toUpperCase() : (existing.method || ''),
  status: Number.isFinite(Number(value.status)) ? Number(value.status) : (existing.status || 200),
  statusText: String(value.statusText || existing.statusText || 'OK'),
  // Observation-only snapshot from the request used to create the mock.
  originalRequestHeaders: normalizeHeaders(
    value.originalRequestHeaders || existing.originalRequestHeaders || existing.requestHeaders,
  ),
  originalRequestBody: typeof value.originalRequestBody === 'undefined'
    ? (existing.originalRequestBody || existing.requestBody || '')
    : value.originalRequestBody,
  mockRequestHeadersEnabled: value.mockRequestHeadersEnabled === true,
  mockRequestHeaders: normalizeHeaders(value.mockRequestHeaders || existing.mockRequestHeaders),
  mockRequestBodyEnabled: value.mockRequestBodyEnabled === true,
  mockRequestBody: typeof value.mockRequestBody === 'undefined'
    ? (existing.mockRequestBody || '')
    : value.mockRequestBody,
  // Existing rules were response mocks before response switches were added.
  mockResponseHeadersEnabled: value.mockResponseHeadersEnabled !== false,
  mockResponseBodyEnabled: value.mockResponseBodyEnabled !== false,
  headers: normalizeHeaders(value.headers || existing.headers),
  body: typeof value.body === 'undefined' ? (existing.body || '') : value.body,
  delayMs: Number.isFinite(Number(value.delayMs)) ? Math.max(0, Number(value.delayMs)) : (existing.delayMs || 0),
  updatedAt: Date.now(),
})

const readRules = () => {
  const rules = storage.get(STORAGE_KEY, [])
  if (!Array.isArray(rules)) return []
  const knownIds = new Set()
  let changed = false
  const normalizedRules = rules.map((rule) => {
    if (isValidId(rule.id) && !knownIds.has(rule.id)) {
      knownIds.add(rule.id)
      return rule
    }
    const id = createId()
    knownIds.add(id)
    changed = true
    return { ...rule, id }
  })
  if (changed) storage.set(STORAGE_KEY, normalizedRules)
  return normalizedRules
}

const writeRules = (rules) => storage.set(STORAGE_KEY, rules)

export const getNetworkMockConfig = () => {
  const rules = readRules()
  return { enabled: rules.some((rule) => rule.enabled), rules }
}

const syncWorkers = () => {
  const config = getNetworkMockConfig()
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('network-mock-apply', config)
  })
  return config
}

export const listNetworkMocks = () => readRules()

export const saveNetworkMock = (draft) => {
  const rules = readRules()
  const id = isValidId(draft.id) ? draft.id : undefined
  const index = id ? rules.findIndex((rule) => rule.id === id) : -1
  const existing = index === -1 ? {} : rules[index]
  const rule = normalizeRule({ ...draft, id }, existing)
  if (!rule.url) throw new Error('Mock URL is required')
  if (rule.urlMatchType === 'regex') {
    try {
      // Validate eagerly so an invalid pattern never silently disables a rule.
      new RegExp(rule.url) // eslint-disable-line no-new
    } catch (error) {
      throw new Error(`Invalid Mock URL regular expression: ${error.message}`)
    }
  }
  if (index === -1) rules.unshift(rule)
  else rules[index] = rule
  writeRules(rules)
  syncWorkers()
  return rule
}

export const setNetworkMockEnabled = (id, enabled) => {
  const rule = readRules().find((item) => item.id === id)
  if (!rule) throw new Error('Mock rule not found')
  return saveNetworkMock({ ...rule, enabled: !!enabled })
}

export const removeNetworkMock = (id) => {
  const rules = readRules()
  const nextRules = rules.filter((rule) => rule.id !== id)
  if (nextRules.length === rules.length) throw new Error('Mock rule not found')
  writeRules(nextRules)
  syncWorkers()
}

let registered = false
export const registerNetworkMockIpc = () => {
  if (registered) return
  registered = true
  ipcMain.on('network-mock-session-config', (event) => {
    event.returnValue = getNetworkMockConfig()
  })
  ipcMain.handle('network-mock-list', () => listNetworkMocks())
  ipcMain.handle('network-mock-save', (event, draft) => saveNetworkMock(draft || {}))
  ipcMain.handle('network-mock-set-enabled', (event, id, enabled) => setNetworkMockEnabled(id, enabled))
  ipcMain.handle('network-mock-delete', (event, id) => removeNetworkMock(id))
}
