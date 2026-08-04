const DEFAULT_SENSITIVE_DATA_MODE = 'redacted'
const SENSITIVE_DATA_MODES = new Set(['redacted', 'raw'])

export const DEFAULT_LIMITS = {
  logs: 500,
  redux: 100,
  actions: 500,
  network: 500,
  events: 2000,
}

const COLLECTIONS = new Set(Object.keys(DEFAULT_LIMITS))
const EVENT_COLLECTIONS = {
  log: 'logs',
  logs: 'logs',
  redux: 'redux',
  action: 'actions',
  actions: 'actions',
  network: 'network',
  console: 'logs',
  'runtime-error': 'logs',
  'redux-state': 'redux',
  'redux-action': 'actions',
  'network-request': 'network',
  'network-response': 'network',
  'network-error': 'network',
}

const cloneForTransport = (value) => {
  if (value === undefined) return null
  try {
    return JSON.parse(JSON.stringify(value))
  } catch (error) {
    return {
      serializationError: true,
      preview: String(value),
    }
  }
}

const normalizeMode = (sensitiveDataMode = DEFAULT_SENSITIVE_DATA_MODE) => {
  if (!SENSITIVE_DATA_MODES.has(sensitiveDataMode)) {
    throw new Error('sensitiveDataMode must be "redacted" or "raw"')
  }
  return sensitiveDataMode
}

const normalizeLimit = (limit, maximum) => {
  if (limit === undefined || limit === null || limit === '') return Math.min(100, maximum)
  const parsed = Number(limit)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error('limit must be a positive integer')
  return Math.min(parsed, maximum)
}

const normalizeCursor = (cursor) => {
  if (cursor === undefined || cursor === null || cursor === '') return 0
  const parsed = Number(cursor)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('cursor must be a non-negative integer')
  return parsed
}

const createRingBuffer = (limit, initialItems = []) => {
  const items = initialItems.slice(-limit)
  return {
    push(item) {
      items.push(item)
      return items.length > limit ? items.shift() : null
    },
    page(cursor, pageLimit, predicate = () => true) {
      const matches = items.filter((item) => item.cursor > cursor && predicate(item))
      const pageItems = matches.slice(0, pageLimit)
      return {
        items: pageItems,
        nextCursor: pageItems.length ? pageItems[pageItems.length - 1].cursor : cursor,
        hasMore: matches.length > pageItems.length,
      }
    },
    get size() {
      return items.length
    },
    latest() {
      return items.length ? items[items.length - 1] : null
    },
    snapshot() {
      return items.slice()
    },
    replace(item) {
      items.splice(0, items.length, item)
    },
  }
}

const snapshotSession = (session) => ({
  sessionId: session.sessionId,
  sensitiveDataMode: session.sensitiveDataMode,
  metadata: session.metadata,
  startedAt: session.startedAt,
  lastActivityAt: session.lastActivityAt,
  nextCursor: session.nextCursor,
  buffers: Object.keys(session.buffers).reduce((buffers, collection) => ({
    ...buffers,
    [collection]: session.buffers[collection].snapshot(),
  }), {}),
  networkDetails: Array.from(session.networkDetails.entries()),
})

const restoreSession = (snapshot, limits) => ({
  sessionId: snapshot.sessionId,
  sensitiveDataMode: snapshot.sensitiveDataMode,
  metadata: snapshot.metadata || {},
  startedAt: snapshot.startedAt,
  lastActivityAt: snapshot.lastActivityAt,
  nextCursor: snapshot.nextCursor,
  storage: 'disk',
  buffers: Object.keys(limits).reduce((buffers, collection) => ({
    ...buffers,
    [collection]: createRingBuffer(limits[collection], snapshot.buffers[collection] || []),
  }), {}),
  networkDetails: new Map(snapshot.networkDetails || []),
})

const toSummary = (session) => ({
  sessionId: session.sessionId,
  sensitiveDataMode: session.sensitiveDataMode,
  metadata: cloneForTransport(session.metadata),
  startedAt: session.startedAt,
  lastActivityAt: session.lastActivityAt,
  ...(session.storage ? { storage: session.storage } : {}),
  counts: Object.keys(session.buffers).reduce((counts, collection) => ({
    ...counts,
    [collection]: session.buffers[collection].size,
  }), {}),
})

const getResultMode = (session, items = []) => (
  session.sensitiveDataMode === 'raw'
    || items.some((item) => item && item.sensitiveDataMode === 'raw')
    ? 'raw'
    : 'redacted'
)

export class AgentEventStore {
  constructor({
    limits = {},
    maxSessions = 20,
    clock = () => Date.now(),
    historyStore = null,
  } = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits }
    this.maxSessions = maxSessions
    this.clock = clock
    this.sessions = new Map()
    this.historyStore = historyStore
  }

  registerSession({ sessionId, sensitiveDataMode, metadata = {} }) {
    if (!sessionId || typeof sessionId !== 'string') throw new Error('sessionId is required')
    const mode = normalizeMode(sensitiveDataMode)
    const current = this.sessions.get(sessionId)
    if (current) {
      if (current.sensitiveDataMode !== mode) {
        throw new Error('sensitiveDataMode cannot change for an existing session')
      }
      current.metadata = cloneForTransport(metadata)
      current.lastActivityAt = this.clock()
      return toSummary(current)
    }

    if (!Number.isInteger(this.maxSessions) || this.maxSessions < 1) {
      throw new Error('maxSessions must be a positive integer')
    }
    if (this.sessions.size >= this.maxSessions) this.removeOldestSession()

    const now = this.clock()
    const session = {
      sessionId,
      sensitiveDataMode: mode,
      metadata: cloneForTransport(metadata),
      startedAt: now,
      lastActivityAt: now,
      nextCursor: 1,
      buffers: Object.keys(this.limits).reduce((buffers, collection) => ({
        ...buffers,
        [collection]: createRingBuffer(this.limits[collection]),
      }), {}),
      networkDetails: new Map(),
    }
    this.sessions.set(sessionId, session)
    return toSummary(session)
  }

  ingest({ sessionId, type, payload, timestamp, sensitiveDataMode, metadata }) {
    const collection = EVENT_COLLECTIONS[type]
    if (!collection && type !== 'network-detail') {
      throw new Error(`Unsupported event type: ${type}`)
    }
    let session = this.sessions.get(sessionId)
    if (!session) {
      this.registerSession({ sessionId, sensitiveDataMode, metadata })
      session = this.sessions.get(sessionId)
    }
    if (sensitiveDataMode && session.sensitiveDataMode !== normalizeMode(sensitiveDataMode)) {
      throw new Error('sensitiveDataMode cannot change for an existing session')
    }

    const event = {
      cursor: session.nextCursor,
      timestamp: timestamp === undefined ? this.clock() : timestamp,
      kind: type,
      sensitiveDataMode: session.sensitiveDataMode,
      payload: cloneForTransport(payload),
    }
    session.nextCursor += 1
    session.lastActivityAt = event.timestamp

    session.buffers.events.push(event)

    if (type === 'network-detail') {
      const requestId = event.payload && String(event.payload.requestId)
      if (!requestId) {
        throw new Error('network-detail payload.requestId is required')
      }
      const current = session.networkDetails.get(requestId)
      event.payload = {
        ...(current ? current.payload : {}),
        ...event.payload,
        requestId,
      }
      session.networkDetails.set(requestId, event)
      return event
    }

    if (collection === 'network') {
      const requestId = event.payload && String(event.payload.requestId)
      const current = requestId ? session.networkDetails.get(requestId) : null
      if (current) {
        current.kind = type
        current.timestamp = event.timestamp
        current.sensitiveDataMode = (
          current.sensitiveDataMode === 'raw' || event.sensitiveDataMode === 'raw'
            ? 'raw'
            : 'redacted'
        )
        current.payload = {
          ...current.payload,
          ...event.payload,
          requestId,
        }
        return event
      }
      if (requestId) {
        event.payload.requestId = requestId
        session.networkDetails.set(requestId, event)
      }
    }

    const removed = collection ? session.buffers[collection].push(event) : null
    if (collection === 'network') {
      if (removed && removed.payload && removed.payload.requestId) {
        const removedId = String(removed.payload.requestId)
        const removedDetail = session.networkDetails.get(removedId)
        if (removedDetail === removed) {
          session.networkDetails.delete(removedId)
        }
      }
    }
    return event
  }

  ingestReduxMessage({ sessionId, request, timestamp, sensitiveDataMode, metadata }) {
    const requestType = typeof request?.type === 'string' ? request.type.toUpperCase() : ''
    if (!['ACTION', 'STATE', 'INIT'].includes(requestType)) return null
    let session = this.sessions.get(sessionId)
    if (!session) {
      this.registerSession({ sessionId, sensitiveDataMode, metadata })
      session = this.sessions.get(sessionId)
    }
    if (sensitiveDataMode && session.sensitiveDataMode !== normalizeMode(sensitiveDataMode)) {
      throw new Error('sensitiveDataMode cannot change for an existing session')
    }
    const eventTimestamp = timestamp === undefined ? this.clock() : timestamp
    const createEvent = (kind, payload) => {
      const event = {
        cursor: session.nextCursor,
        timestamp: eventTimestamp,
        kind,
        sensitiveDataMode: session.sensitiveDataMode,
        payload,
      }
      session.nextCursor += 1
      return event
    }
    let actionEvent = null
    if (requestType === 'ACTION') {
      const actionPayload = { ...request }
      delete actionPayload.payload
      actionEvent = createEvent('redux-action', cloneForTransport(actionPayload))
      session.buffers.actions.push(actionEvent)
      session.buffers.events.push(actionEvent)
    }
    const stateEvent = createEvent('redux-state', {
      type: request.type,
      id: request.id,
      instanceId: request.instanceId,
      name: request.name,
      payload: request.payload,
    })
    session.buffers.redux.replace(stateEvent)
    if (actionEvent) actionEvent.payload.stateCursor = stateEvent.cursor
    session.buffers.events.push({
      cursor: stateEvent.cursor,
      timestamp: stateEvent.timestamp,
      kind: stateEvent.kind,
      sensitiveDataMode: stateEvent.sensitiveDataMode,
      payload: {
        type: stateEvent.payload.type,
        stateOmitted: true,
        ...(actionEvent ? { actionCursor: actionEvent.cursor } : {}),
      },
    })
    session.lastActivityAt = eventTimestamp
    return { actionEvent, stateEvent }
  }

  listSessions() {
    const archived = this.historyStore ? this.historyStore.list() : []
    return [...Array.from(this.sessions.values()).map(toSummary), ...archived]
      .sort((left, right) => right.lastActivityAt - left.lastActivityAt)
  }

  getSession(sessionId) {
    const session = this.sessions.get(sessionId)
    if (session) return toSummary(session)
    return this.historyStore ? this.historyStore.getSummary(sessionId) : null
  }

  setSessionSensitiveDataMode(sessionId, sensitiveDataMode) {
    const session = this.requireSession(sessionId)
    session.sensitiveDataMode = normalizeMode(sensitiveDataMode)
    session.lastActivityAt = this.clock()
    return toSummary(session)
  }

  page(sessionId, collection, { cursor, limit, filter } = {}) {
    if (!COLLECTIONS.has(collection)) throw new Error(`Unsupported collection: ${collection}`)
    const session = this.requireSession(sessionId)
    const result = session.buffers[collection].page(
      normalizeCursor(cursor),
      normalizeLimit(limit, this.limits[collection]),
      filter,
    )
    return {
      sensitiveDataMode: getResultMode(session, result.items),
      session: toSummary(session),
      ...result,
    }
  }

  latest(sessionId, collection) {
    if (!COLLECTIONS.has(collection)) throw new Error(`Unsupported collection: ${collection}`)
    const session = this.requireSession(sessionId)
    const item = cloneForTransport(session.buffers[collection].latest())
    return {
      sensitiveDataMode: getResultMode(session, [item]),
      session: toSummary(session),
      item,
    }
  }

  getNetworkDetail(sessionId, requestId) {
    const session = this.requireSession(sessionId)
    const event = session.networkDetails.get(String(requestId))
    if (!event) return null
    return {
      sensitiveDataMode: getResultMode(session, [event]),
      session: toSummary(session),
      item: cloneForTransport(event),
    }
  }

  requireSession(sessionId) {
    const session = this.sessions.get(sessionId)
    if (session) return session
    const snapshot = this.historyStore && this.historyStore.load(sessionId)
    if (!snapshot) {
      const error = new Error(`Unknown session: ${sessionId}`)
      error.code = 'SESSION_NOT_FOUND'
      throw error
    }
    return restoreSession(snapshot, this.limits)
  }

  archiveSession(sessionId) {
    const session = this.sessions.get(sessionId)
    if (!session) return null
    const summary = toSummary(session)
    if (this.historyStore) this.historyStore.archive({ summary, snapshot: snapshotSession(session) })
    this.sessions.delete(sessionId)
    return summary
  }

  discardSession(sessionId) {
    return this.sessions.delete(sessionId)
  }

  removeOldestSession() {
    const oldest = Array.from(this.sessions.values())
      .sort((left, right) => left.lastActivityAt - right.lastActivityAt)[0]
    if (oldest) this.sessions.delete(oldest.sessionId)
  }
}
