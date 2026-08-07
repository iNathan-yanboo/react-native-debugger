import crypto from 'crypto'
import http from 'http'
import { AgentEventStore } from './event-store'
import {
  createDiscoveryDocument,
  removeDiscoveryFile,
  writeDiscoveryFile,
} from './discovery'
import {
  matchesLogSearch,
  projectEvents,
  projectLogs,
  projectNetwork,
  projectReduxActions,
  projectReduxState,
  projectSessions,
} from './projection'

const LOOPBACK_HOST = '127.0.0.1'

const sendJson = (response, status, body) => {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(JSON.stringify(body))
}

const readJsonBody = (request) => new Promise((resolve, reject) => {
  let size = 0
  const chunks = []
  request.on('data', (chunk) => {
    size += chunk.length
    if (size > 2 * 1024 * 1024) {
      reject(new Error('request_body_too_large'))
      request.destroy()
      return
    }
    chunks.push(chunk)
  })
  request.on('end', () => {
    try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch (error) { reject(error) }
  })
  request.on('error', reject)
})

const createToken = () => crypto.randomBytes(32).toString('base64url')

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

const isAuthorized = (request, token) => {
  const authorization = request.headers.authorization || ''
  return safeEqual(authorization, `Bearer ${token}`)
}

const decode = (value) => {
  try {
    return decodeURIComponent(value)
  } catch (error) {
    return null
  }
}

const toErrorResponse = (error) => {
  if (error.code === 'SESSION_NOT_FOUND') return [404, 'session_not_found']
  if (error.code === 'STATE_PATH_NOT_FOUND') return [404, 'state_path_not_found']
  return [400, 'invalid_request']
}

const getResponseMode = (sessions) => (
  sessions.some(({ sensitiveDataMode }) => sensitiveDataMode === 'raw') ? 'raw' : 'redacted'
)

const getSinceTimestamp = (value) => {
  if (!value) return null
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

const parseJson = (value) => {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch (error) {
    return value
  }
}

const getActionType = (item) => {
  const action = parseJson(item.payload && item.payload.action)
  if (!action || typeof action !== 'object') return undefined
  return (action.action && action.action.type) || action.type
}

const matchesEventType = (item, requestedTypes) => {
  if (!requestedTypes.length) return true
  return requestedTypes.some((type) => {
    if (type === 'console') return ['console', 'runtime-error'].includes(item.kind)
    if (type === 'redux_action') return item.kind === 'redux-action'
    if (type === 'redux_state') return item.kind === 'redux-state'
    if (type === 'network') return item.kind === 'network' || item.kind.startsWith('network-')
    return item.kind === type
  })
}

const createFilter = (collection, searchParams) => {
  const since = getSinceTimestamp(searchParams.get('since'))
  const level = searchParams.get('level')
  const search = searchParams.get('search')
  const actionType = searchParams.get('actionType')
  const method = searchParams.get('method')
  const url = searchParams.get('url')
  const rawStatus = searchParams.get('status')
  const status = rawStatus === null ? null : Number(rawStatus)
  const eventTypes = searchParams.getAll('eventTypes')
    .flatMap((value) => value.split(','))
    .filter(Boolean)

  return (item) => {
    if (since !== null && item.timestamp < since) return false
    if (collection === 'logs' && level && item.payload.level !== level) return false
    if (collection === 'logs' && !matchesLogSearch(item, search)) return false
    if (collection === 'actions' && actionType && getActionType(item) !== actionType) return false
    if (collection === 'network') {
      if (method && item.payload.method !== method.toUpperCase()) return false
      if (url && !String(item.payload.url || '').includes(url)) return false
      if (status !== null && Number(item.payload.response && item.payload.response.status) !== status) {
        return false
      }
    }
    if (collection === 'events' && !matchesEventType(item, eventTypes)) return false
    return true
  }
}

const waitForEvents = async (store, sessionId, {
  after,
  limit,
  timeoutMs,
  filter,
}) => {
  const page = () => store.page(sessionId, 'events', {
    cursor: after,
    limit,
    filter,
  })
  const initial = page()
  if (initial.items.length || timeoutMs <= 0 || initial.session.metadata.status === 'disconnected') {
    return {
      ...initial,
      sessionDisconnected: initial.session.metadata.status === 'disconnected',
    }
  }

  return new Promise((resolve) => {
    let settled = false
    let interval
    let timeout
    const finish = (result) => {
      if (settled) return
      settled = true
      clearInterval(interval)
      clearTimeout(timeout)
      resolve(result)
    }
    interval = setInterval(() => {
      const result = page()
      if (result.items.length || result.session.metadata.status === 'disconnected') {
        finish({
          ...result,
          sessionDisconnected: result.session.metadata.status === 'disconnected',
        })
      }
    }, 100)
    timeout = setTimeout(() => finish(page()), timeoutMs)
  })
}

const handleRequest = (store, token, networkMocks) => async (request, response) => {
  if (!isAuthorized(request, token)) {
    sendJson(response, 401, { error: 'unauthorized' })
    return
  }
  if (request.headers.origin) {
    sendJson(response, 403, { error: 'browser_origin_not_allowed' })
    return
  }

  const url = new URL(request.url, `http://${LOOPBACK_HOST}`)
  const parts = url.pathname.split('/').filter(Boolean).map(decode)
  if (parts.some((part) => part === null)) {
    sendJson(response, 400, { error: 'invalid_path' })
    return
  }

  try {
    if (parts.length === 2 && parts[0] === 'v1' && parts[1] === 'network-mocks') {
      if (!networkMocks) { sendJson(response, 404, { error: 'not_found' }); return }
      if (request.method === 'GET') { sendJson(response, 200, { sensitiveDataMode: 'raw', rules: networkMocks.list() }); return }
      if (request.method === 'POST') { sendJson(response, 200, { sensitiveDataMode: 'raw', rule: networkMocks.save(await readJsonBody(request)) }); return }
      sendJson(response, 405, { error: 'method_not_allowed' }); return
    }
    if (parts.length === 4 && parts[0] === 'v1' && parts[1] === 'network-mocks' && parts[3] === 'enabled') {
      if (!networkMocks) { sendJson(response, 404, { error: 'not_found' }); return }
      if (request.method !== 'POST') { sendJson(response, 405, { error: 'method_not_allowed' }); return }
      const body = await readJsonBody(request)
      sendJson(response, 200, { sensitiveDataMode: 'raw', rule: networkMocks.setEnabled(parts[2], body.enabled) })
      return
    }
    if (parts.length === 3 && parts[0] === 'v1' && parts[1] === 'network-mocks') {
      if (!networkMocks) { sendJson(response, 404, { error: 'not_found' }); return }
      if (request.method !== 'DELETE') { sendJson(response, 405, { error: 'method_not_allowed' }); return }
      networkMocks.remove(parts[2])
      sendJson(response, 200, { sensitiveDataMode: 'raw', id: parts[2], deleted: true })
      return
    }
    if (request.method !== 'GET') { sendJson(response, 405, { error: 'method_not_allowed' }); return }
    if (parts.length === 2 && parts[0] === 'v1' && parts[1] === 'sessions') {
      const sessions = store.listSessions()
      sendJson(response, 200, projectSessions({
        sensitiveDataMode: getResponseMode(sessions),
        sessions,
      }, url.searchParams))
      return
    }
    if (parts.length === 4 && parts[0] === 'v1' && parts[1] === 'sessions') {
      const [,, sessionId, collection] = parts
      if (['logs', 'redux', 'actions', 'network'].includes(collection)) {
        const result = store.page(sessionId, collection, {
          cursor: url.searchParams.get('cursor'),
          limit: url.searchParams.get('limit'),
          filter: createFilter(collection, url.searchParams),
        })
        let projected = result
        if (collection === 'logs') projected = projectLogs(result, url.searchParams)
        if (collection === 'network') projected = projectNetwork(result, url.searchParams)
        sendJson(response, 200, projected)
        return
      }
    }
    if (parts.length === 5 && parts[0] === 'v1' && parts[1] === 'sessions'
      && parts[3] === 'redux' && parts[4] === 'state') {
      sendJson(
        response,
        200,
        projectReduxState(store.latest(parts[2], 'redux'), url.searchParams),
      )
      return
    }
    if (parts.length === 5 && parts[0] === 'v1' && parts[1] === 'sessions'
      && parts[3] === 'redux' && parts[4] === 'actions') {
      const result = store.page(parts[2], 'actions', {
        cursor: url.searchParams.get('cursor'),
        limit: url.searchParams.get('limit'),
        filter: createFilter('actions', url.searchParams),
      })
      sendJson(response, 200, projectReduxActions(result, url.searchParams))
      return
    }
    if (parts.length === 4 && parts[0] === 'v1' && parts[1] === 'sessions'
      && parts[3] === 'events') {
      const rawTimeout = Number(url.searchParams.get('timeoutMs') || 10000)
      const timeoutMs = Number.isFinite(rawTimeout)
        ? Math.max(0, Math.min(rawTimeout, 30000))
        : 10000
      const result = await waitForEvents(store, parts[2], {
        after: url.searchParams.get('after'),
        limit: url.searchParams.get('limit') || 1,
        timeoutMs,
        filter: createFilter('events', url.searchParams),
      })
      const projected = projectEvents(result, url.searchParams)
      sendJson(response, 200, {
        ...projected,
        event: projected.items[0] || null,
        cursor: projected.nextCursor,
        timedOut: projected.items.length === 0,
      })
      return
    }
    if (parts.length === 5 && parts[0] === 'v1' && parts[1] === 'sessions'
      && parts[3] === 'network') {
      const result = store.getNetworkDetail(parts[2], parts[4])
      if (!result) {
        sendJson(response, 404, { error: 'network_request_not_found' })
        return
      }
      sendJson(response, 200, projectNetwork(result, url.searchParams, true))
      return
    }
    sendJson(response, 404, { error: 'not_found' })
  } catch (error) {
    const [status, message] = toErrorResponse(error)
    sendJson(response, status, { error: message, message: error.message })
  }
}

export const createAgentBridge = ({
  store = new AgentEventStore(),
  token = createToken(),
  serverFactory = http.createServer,
  networkMocks = null,
} = {}) => {
  let server
  let address
  let discoveryDocument

  const bridge = {
    token,
    store,
    registerSession: (session) => store.registerSession(session),
    setSessionSensitiveDataMode: (sessionId, sensitiveDataMode) => (
      store.setSessionSensitiveDataMode(sessionId, sensitiveDataMode)
    ),
    ingest: (event) => store.ingest(event),
    ingestReduxMessage: (event) => store.ingestReduxMessage(event),
    get discovery() {
      return discoveryDocument || null
    },
    async start({ port = 0, host = LOOPBACK_HOST } = {}) {
      if (host !== LOOPBACK_HOST) throw new Error('Agent Bridge may only bind 127.0.0.1')
      if (server) return bridge.discovery
      server = serverFactory(handleRequest(store, token, networkMocks))
      try {
        await new Promise((resolve, reject) => {
          server.once('error', (error) => {
            reject(error)
          })
          server.listen(port, host, () => {
            server.removeListener('error', reject)
            resolve()
          })
        })
      } catch (error) {
        server = null
        throw error
      }
      address = server.address()
      discoveryDocument = createDiscoveryDocument({ port: address.port, token })
      return bridge.discovery
    },
    async stop() {
      if (!server) return
      const closingServer = server
      server = null
      address = null
      discoveryDocument = null
      if (!closingServer.listening) return
      const closePromise = new Promise((resolve, reject) => {
        closingServer.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
      if (typeof closingServer.closeAllConnections === 'function') {
        closingServer.closeAllConnections()
      }
      await closePromise
    },
    publishDiscovery(filePath, fileSystem) {
      if (!bridge.discovery) throw new Error('Start Agent Bridge before publishing discovery')
      return writeDiscoveryFile(filePath, bridge.discovery, fileSystem)
    },
    removeDiscovery(filePath, fileSystem) {
      return removeDiscoveryFile(filePath, fileSystem)
    },
  }

  return bridge
}

export {
  AgentEventStore,
  createDiscoveryDocument,
  removeDiscoveryFile,
  writeDiscoveryFile,
}
