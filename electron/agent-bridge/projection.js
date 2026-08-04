const DEFAULT_MAX_VALUE_BYTES = 2048
const DEFAULT_BODY_PREVIEW_BYTES = 8192
const MAX_QUERY_BYTES = 1024 * 1024

const byteLength = (value) => Buffer.byteLength(value, 'utf8')

const truncateUtf8 = (value, maximum) => {
  if (maximum === undefined || byteLength(value) <= maximum) return value
  if (maximum <= 0) return ''
  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (byteLength(value.slice(0, middle)) <= maximum) low = middle
    else high = middle - 1
  }
  return value.slice(0, low)
}

const parseJson = (value) => {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch (error) {
    return value
  }
}

const serialize = (value) => {
  try {
    return JSON.stringify(value)
  } catch (error) {
    return JSON.stringify({
      serializationError: true,
      preview: String(value),
    })
  }
}

const parseBoolean = (searchParams, name, defaultValue) => {
  const value = searchParams.get(name)
  if (value === null) return defaultValue
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be true or false`)
}

const parseBytes = (searchParams, name, defaultValue) => {
  const value = searchParams.get(name)
  if (value === null || value === '') return defaultValue
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }
  return Math.min(parsed, MAX_QUERY_BYTES)
}

const boundValue = (value, maximum) => {
  if (maximum === undefined) return value
  const serialized = serialize(value)
  const originalByteLength = byteLength(serialized)
  if (originalByteLength <= maximum) return value
  return {
    truncated: true,
    originalByteLength,
    retainedByteLength: Math.min(originalByteLength, maximum),
    preview: truncateUtf8(serialized, maximum),
  }
}

const renderValue = (value) => {
  if (typeof value === 'string') return value
  if (value === undefined) return ''
  return serialize(value)
}

const renderLogMessage = (item, maximum) => {
  const payload = item.payload || {}
  const values = Array.isArray(payload.arguments)
    ? payload.arguments
    : [payload.message || payload.reason || payload.error || payload]
  const original = values.map(renderValue).filter(Boolean).join(' | ')
  const message = truncateUtf8(original, maximum)
  return {
    message,
    messageTruncated: byteLength(original) > byteLength(message),
    originalMessageByteLength: byteLength(original),
    returnedMessageByteLength: byteLength(message),
  }
}

const projectLogItem = (item, { compact, maxValueBytes, searchMatched = false }) => {
  if (!compact && maxValueBytes === undefined) return item
  if (!compact) {
    return {
      ...item,
      payload: boundValue(item.payload, maxValueBytes),
    }
  }
  const payload = item.payload || {}
  const rendered = renderLogMessage(item, maxValueBytes)
  return {
    cursor: item.cursor,
    timestamp: item.timestamp,
    kind: item.kind,
    sensitiveDataMode: item.sensitiveDataMode,
    payload: {
      level: payload.level || (item.kind === 'runtime-error' ? 'error' : undefined),
      message: rendered.message,
      ...(rendered.messageTruncated
        ? {
          messageTruncated: true,
          originalMessageByteLength: rendered.originalMessageByteLength,
          returnedMessageByteLength: rendered.returnedMessageByteLength,
        }
        : {}),
      ...(searchMatched ? { searchMatched: true } : {}),
      ...(payload.filename ? { filename: payload.filename } : {}),
      ...(payload.lineno ? { lineno: payload.lineno } : {}),
      ...(payload.colno ? { colno: payload.colno } : {}),
    },
  }
}

const getReduxState = (item) => {
  const request = item && item.payload
  if (!request || typeof request !== 'object') return request
  return Object.prototype.hasOwnProperty.call(request, 'payload')
    ? parseJson(request.payload)
    : request
}

const decodePointerToken = (token) => token.replace(/~1/g, '/').replace(/~0/g, '~')

const selectJsonPointer = (value, pointer) => {
  if (pointer === undefined || pointer === null || pointer === '') return value
  if (!pointer.startsWith('/')) throw new Error('path must be a JSON Pointer beginning with "/"')
  return pointer.slice(1).split('/').map(decodePointerToken).reduce((current, token) => {
    if (current === null || current === undefined
      || !Object.prototype.hasOwnProperty.call(Object(current), token)) {
      const error = new Error(`Redux state path not found: ${pointer}`)
      error.code = 'STATE_PATH_NOT_FOUND'
      throw error
    }
    return current[token]
  }, value)
}

const projectActionItem = (item, { compact, includeState, maxValueBytes }) => {
  const request = item.payload || {}
  if (!compact && includeState && maxValueBytes === undefined) return item
  const action = boundValue(parseJson(request.action), maxValueBytes)
  let state
  if (includeState) {
    state = Object.prototype.hasOwnProperty.call(request, 'payload')
      ? boundValue(parseJson(request.payload), maxValueBytes)
      : { stateOmitted: true, stateCursor: request.stateCursor }
  }
  const payload = compact
    ? {
      messageType: request.type,
      instanceId: request.id || request.instanceId,
      name: request.name,
      action,
      ...(includeState ? { state } : {}),
    }
    : {
      ...request,
      action,
      ...(includeState ? { payload: state } : { payload: undefined }),
    }
  if (!includeState && !compact) delete payload.payload
  return {
    ...item,
    payload,
  }
}

const projectBody = (body, maximum) => {
  if (!body || typeof body !== 'object' || typeof body.content !== 'string') return body
  const originalContentByteLength = byteLength(body.content)
  const content = truncateUtf8(body.content, maximum)
  return {
    ...body,
    content,
    previewTruncated: originalContentByteLength > byteLength(content),
    returnedByteLength: byteLength(content),
  }
}

const projectNetworkItem = (item, {
  includeHeaders,
  includeRequestBody,
  includeResponseBody,
  bodyPreviewBytes,
}) => {
  const payload = item.payload || {}
  const response = payload.response || {}
  return {
    cursor: item.cursor,
    timestamp: item.timestamp,
    kind: item.kind,
    sensitiveDataMode: item.sensitiveDataMode,
    payload: {
      requestId: payload.requestId,
      method: payload.method,
      url: payload.url,
      startedAt: payload.startedAt,
      completedAt: payload.completedAt,
      duration: payload.duration,
      outcome: payload.outcome,
      ...(includeHeaders ? { headers: payload.headers } : {}),
      ...(includeRequestBody
        ? { body: projectBody(payload.body, bodyPreviewBytes) }
        : {}),
      response: {
        status: response.status,
        statusText: response.statusText,
        ...(includeHeaders ? { headers: response.headers } : {}),
        ...(includeResponseBody
          ? { body: projectBody(response.body, bodyPreviewBytes) }
          : {}),
      },
    },
  }
}

const truncateItem = (item, maximum) => {
  const serialized = serialize(item)
  return {
    cursor: item.cursor,
    timestamp: item.timestamp,
    kind: item.kind,
    sensitiveDataMode: item.sensitiveDataMode,
    payload: {
      truncated: true,
      originalByteLength: byteLength(serialized),
      preview: truncateUtf8(serialized, maximum),
    },
  }
}

const fitSingleResult = (result, searchParams) => {
  const maximum = parseBytes(searchParams, 'maxResultBytes', undefined)
  if (maximum === undefined || !result.item) return result
  if (byteLength(serialize(result)) <= maximum) return result
  const base = { ...result, item: null }
  const previewBudget = Math.max(0, maximum - byteLength(serialize(base)) - 256)
  return {
    ...result,
    item: truncateItem(result.item, previewBudget),
    resultTruncated: true,
    maxResultBytes: maximum,
  }
}

const projectSessions = (result, searchParams) => {
  const maximum = parseBytes(searchParams, 'maxResultBytes', undefined)
  if (maximum === undefined || byteLength(serialize(result)) <= maximum) return result
  const base = { ...result, sessions: [] }
  let retainedBytes = byteLength(serialize(base))
  const sessions = []
  let truncated = false

  result.sessions.forEach((session) => {
    if (truncated) return
    let projected = session
    const sessionBytes = byteLength(serialize(projected))
    if (retainedBytes + sessionBytes <= maximum) {
      sessions.push(projected)
      retainedBytes += sessionBytes
      return
    }
    if (!sessions.length) {
      const metadataBudget = Math.max(
        0,
        maximum - retainedBytes - byteLength(serialize({ ...session, metadata: null })) - 128,
      )
      projected = {
        ...session,
        metadata: boundValue(session.metadata, metadataBudget),
      }
    }
    if (!sessions.length) {
      sessions.push(projected)
      retainedBytes += byteLength(serialize(projected))
    }
    truncated = true
  })

  return {
    ...result,
    sessions,
    resultTruncated: true,
    maxResultBytes: maximum,
    hasMore: sessions.length < result.sessions.length,
  }
}

const projectReduxState = (result, searchParams) => {
  if (!result.item) return result
  const path = searchParams.get('path')
  const maxValueBytes = parseBytes(searchParams, 'maxValueBytes', undefined)
  if (path === null && maxValueBytes === undefined && !searchParams.has('maxResultBytes')) {
    return result
  }
  const request = result.item.payload || {}
  const value = selectJsonPointer(getReduxState(result.item), path || '')
  return fitSingleResult({
    ...result,
    item: {
      cursor: result.item.cursor,
      timestamp: result.item.timestamp,
      kind: result.item.kind,
      sensitiveDataMode: result.item.sensitiveDataMode,
      payload: {
        messageType: request.type || 'STATE',
        path: path || '',
        value: boundValue(value, maxValueBytes),
      },
    },
  }, searchParams)
}

const projectReduxStateEvent = (item, {
  includeState,
  maxValueBytes,
  path,
}) => {
  const request = item.payload || {}
  return {
    cursor: item.cursor,
    timestamp: item.timestamp,
    kind: item.kind,
    sensitiveDataMode: item.sensitiveDataMode,
    payload: {
      messageType: request.type || 'STATE',
      ...(includeState
        ? {
          path: path || '',
          value: boundValue(
            selectJsonPointer(getReduxState(item), path || ''),
            maxValueBytes,
          ),
        }
        : { stateOmitted: true }),
    },
  }
}

const fitPage = (result, searchParams) => {
  const maximum = parseBytes(searchParams, 'maxResultBytes', undefined)
  if (maximum === undefined || !Array.isArray(result.items)) return result
  const base = { ...result, items: [] }
  let retainedBytes = byteLength(serialize(base))
  const items = []
  let truncated = false

  result.items.forEach((item) => {
    if (truncated) return
    const serialized = serialize(item)
    const itemBytes = byteLength(serialized)
    if (retainedBytes + itemBytes <= maximum) {
      items.push(item)
      retainedBytes += itemBytes
      return
    }
    if (!items.length) {
      const previewBudget = Math.max(0, maximum - retainedBytes - 256)
      items.push(truncateItem(item, previewBudget))
    }
    truncated = true
  })

  return {
    ...result,
    items,
    nextCursor: items.length ? items[items.length - 1].cursor : result.nextCursor,
    hasMore: result.hasMore || truncated,
    ...(truncated ? { resultTruncated: true, maxResultBytes: maximum } : {}),
  }
}

const mapPage = (result, searchParams, mapper) => fitPage({
  ...result,
  items: result.items.map(mapper),
}, searchParams)

const projectLogs = (result, searchParams) => {
  const searchMatched = Boolean(searchParams.get('search'))
  const options = {
    compact: parseBoolean(searchParams, 'compact', false),
    maxValueBytes: parseBytes(
      searchParams,
      'maxValueBytes',
      searchParams.has('compact') ? DEFAULT_MAX_VALUE_BYTES : undefined,
    ),
    searchMatched,
  }
  return mapPage(result, searchParams, (item) => projectLogItem(item, options))
}

const projectReduxActions = (result, searchParams) => {
  const options = {
    compact: parseBoolean(searchParams, 'compact', false),
    includeState: parseBoolean(searchParams, 'includeState', true),
    maxValueBytes: parseBytes(searchParams, 'maxValueBytes', undefined),
  }
  return mapPage(result, searchParams, (item) => projectActionItem(item, options))
}

const projectNetwork = (result, searchParams, detail = false) => {
  const includeHeaders = parseBoolean(searchParams, 'includeHeaders', detail)
  const includeBodies = parseBoolean(searchParams, 'includeBodies', detail)
  const options = {
    includeHeaders,
    includeRequestBody: parseBoolean(
      searchParams,
      'includeRequestBody',
      includeBodies,
    ),
    includeResponseBody: parseBoolean(
      searchParams,
      'includeResponseBody',
      includeBodies,
    ),
    bodyPreviewBytes: parseBytes(
      searchParams,
      'bodyPreviewBytes',
      DEFAULT_BODY_PREVIEW_BYTES,
    ),
  }
  if (detail) {
    return fitSingleResult({
      ...result,
      item: result.item ? projectNetworkItem(result.item, options) : null,
    }, searchParams)
  }
  return mapPage(result, searchParams, (item) => projectNetworkItem(item, options))
}

const projectEvents = (result, searchParams) => {
  const logOptions = {
    compact: parseBoolean(searchParams, 'compact', false),
    maxValueBytes: parseBytes(searchParams, 'maxValueBytes', DEFAULT_MAX_VALUE_BYTES),
  }
  const actionOptions = {
    compact: parseBoolean(searchParams, 'compact', false),
    includeState: parseBoolean(searchParams, 'includeState', false),
    maxValueBytes: logOptions.maxValueBytes,
  }
  const stateOptions = {
    includeState: actionOptions.includeState,
    maxValueBytes: logOptions.maxValueBytes,
    path: searchParams.get('path'),
  }
  const networkOptions = {
    includeHeaders: parseBoolean(searchParams, 'includeHeaders', false),
    includeRequestBody: parseBoolean(searchParams, 'includeBodies', false),
    includeResponseBody: parseBoolean(searchParams, 'includeBodies', false),
    bodyPreviewBytes: parseBytes(
      searchParams,
      'bodyPreviewBytes',
      DEFAULT_BODY_PREVIEW_BYTES,
    ),
  }
  return mapPage(result, searchParams, (item) => {
    if (item.kind === 'console' || item.kind === 'runtime-error') {
      return projectLogItem(item, logOptions)
    }
    if (item.kind === 'redux-action') return projectActionItem(item, actionOptions)
    if (item.kind === 'redux-state') return projectReduxStateEvent(item, stateOptions)
    if (item.kind === 'network' || item.kind.startsWith('network-')) {
      return projectNetworkItem(item, networkOptions)
    }
    return item
  })
}

const matchesLogSearch = (item, search) => {
  if (!search) return true
  const searchable = truncateUtf8(serialize(item.payload), 256 * 1024)
  return searchable.toLowerCase().includes(search.toLowerCase())
}

export {
  fitPage,
  matchesLogSearch,
  projectEvents,
  projectLogs,
  projectNetwork,
  projectReduxActions,
  projectReduxState,
  projectSessions,
}
