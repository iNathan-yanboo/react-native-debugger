const DEFAULT_MAX_BODY_BYTES = 256 * 1024
const REDACTED_VALUE = '[REDACTED]'
const TRUNCATED_SUFFIX = '…[truncated]'
const sensitiveKeyPattern = /authorization|cookie|token|password|secret|api[-_]?key|session/i
const reduxConsolePattern = /^%c (?:prev state|action|next state)\s*\|\s*color:/

const getDefaultHost = () => (typeof self === 'undefined' ? {} : self)

const getByteLength = (value) => {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length
  return value.length
}

const truncate = (value, maxBytes) => {
  if (typeof value !== 'string' || getByteLength(value) <= maxBytes) return value

  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (getByteLength(value.slice(0, middle) + TRUNCATED_SUFFIX) <= maxBytes) {
      low = middle
    } else {
      high = middle - 1
    }
  }
  return value.slice(0, low) + TRUNCATED_SUFFIX
}

const redactJsonBody = (value) => {
  try {
    const parsed = JSON.parse(value)
    const redact = (item) => {
      if (Array.isArray(item)) return item.map(redact)
      if (!item || typeof item !== 'object') return item
      return Object.keys(item).reduce((result, key) => ({
        ...result,
        [key]: sensitiveKeyPattern.test(key) ? REDACTED_VALUE : redact(item[key]),
      }), {})
    }
    return JSON.stringify(redact(parsed))
  } catch (error) {
    return value
  }
}

const toBodyPayload = (value, maxBytes, mode) => {
  if (typeof value === 'string') {
    const originalByteLength = getByteLength(value)
    const processed = mode === 'redacted' ? redactJsonBody(value) : value
    const content = truncate(processed, maxBytes)
    const truncated = content !== processed
    return {
      content,
      truncated,
      originalByteLength,
      retainedByteLength: getByteLength(content),
    }
  }
  if (value && (typeof value.byteLength === 'number' || typeof value.size === 'number')) {
    return {
      type: 'binary',
      byteLength: typeof value.byteLength === 'number' ? value.byteLength : value.size,
      ...(value.type ? { contentType: value.type } : {}),
    }
  }
  return { content: value === null || typeof value === 'undefined' ? value : String(value) }
}

const redactUrl = (url, mode) => {
  if (mode === 'raw') return url
  return url.replace(
    /([?&](?:token|access_token|refresh_token|password|secret|code|session)=[^&#]*)/gi,
    (match) => `${match.slice(0, match.indexOf('=') + 1)}${REDACTED_VALUE}`,
  )
}

const normalizeValue = (value, options, seen = new WeakSet(), depth = 0) => {
  const { mode } = options
  if (value === null || typeof value === 'undefined') return value
  if (typeof value === 'string') return truncate(value, DEFAULT_MAX_BODY_BYTES)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value === 'symbol') return value.toString()
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncate(value.message, DEFAULT_MAX_BODY_BYTES),
      stack: value.stack ? truncate(value.stack, DEFAULT_MAX_BODY_BYTES) : undefined,
    }
  }
  if (depth >= 5) return '[Max depth reached]'
  if (typeof value !== 'object') return String(value)
  if (seen.has(value)) return '[Circular]'
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item, options, seen, depth + 1))
  }

  const result = {}
  Object.keys(value).forEach((key) => {
    result[key] = mode === 'redacted' && sensitiveKeyPattern.test(key)
      ? REDACTED_VALUE
      : normalizeValue(value[key], options, seen, depth + 1)
  })
  return result
}

const getResponseHeaders = (xhr) => {
  try {
    return xhr.getAllResponseHeaders()
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .reduce((headers, line) => {
        const separator = line.indexOf(':')
        if (separator === -1) return headers
        return {
          ...headers,
          [line.slice(0, separator).trim()]: line.slice(separator + 1).trim(),
        }
      }, {})
  } catch (error) {
    return {}
  }
}

const getHeader = (headers, name) => {
  const key = Object.keys(headers).find((header) => header.toLowerCase() === name.toLowerCase())
  return key ? headers[key] : ''
}

const isTextContentType = (contentType) => (
  !contentType
  || /^text\//i.test(contentType)
  || /json|xml|javascript|x-www-form-urlencoded/i.test(contentType)
)

const readBlobAsText = (blob, host) => {
  if (!host || typeof host.FileReader !== 'function') return Promise.resolve('[blob]')
  return new Promise((resolve) => {
    const reader = new host.FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : String(reader.result))
    reader.onerror = () => resolve('[Response body unavailable]')
    reader.onabort = () => resolve('[Response body unavailable]')
    try {
      reader.readAsText(blob)
    } catch (error) {
      resolve('[Response body unavailable]')
    }
  })
}

const getResponseBody = (xhr, host, headers) => {
  try {
    if (!xhr.responseType || xhr.responseType === 'text') return xhr.responseText
    if (typeof xhr.response === 'string') return xhr.response
    if (xhr.responseType === 'blob' && xhr.response) {
      const contentType = xhr.response.type || getHeader(headers, 'content-type')
      return isTextContentType(contentType)
        ? readBlobAsText(xhr.response, host)
        : xhr.response
    }
    return xhr.response === null || typeof xhr.response === 'undefined'
      ? xhr.response
      : `[${xhr.responseType || 'response'}]`
  } catch (error) {
    return '[Response body unavailable]'
  }
}

export const createAgentCapture = ({ host = getDefaultHost(), emit, now = Date.now } = {}) => {
  let sequence = 0
  let requestSequence = 0
  let enabled = false
  let options = { mode: 'redacted', maxBodyBytes: DEFAULT_MAX_BODY_BYTES }
  let originalConsole
  let xhrPrototype
  let originalXhrMethods
  let errorListener
  let rejectionListener
  const requests = new WeakMap()

  const publish = (kind, payload, publishOptions = options) => {
    if (!enabled) return
    const event = {
      version: 1,
      kind,
      seq: sequence + 1,
      timestamp: now(),
      sensitiveDataMode: publishOptions.mode,
      payload: normalizeValue(payload, publishOptions),
    }
    sequence += 1
    try {
      if (emit) emit(event)
      else host.postMessage({ agentCaptureEvent: true, event })
    } catch (error) {
      // Capture must never change the app's runtime behavior.
    }
  }

  const installConsole = () => {
    if (originalConsole || !host.console) return
    originalConsole = {}
    const levels = ['log', 'info', 'warn', 'error', 'debug']
    levels.forEach((level) => {
      const original = host.console[level]
      if (typeof original !== 'function') return
      originalConsole[level] = original
      host.console[level] = function capturedConsole(...args) {
        // Redux is already captured through reduxAPI. Re-sending its verbose
        // prev/action/next console triplet duplicates large state snapshots.
        if (!(
          level === 'log'
          && typeof args[0] === 'string'
          && reduxConsolePattern.test(args[0])
        )) {
          publish('console', { level, arguments: args })
        }
        return original.apply(host.console, args)
      }
    })
  }

  const installRuntimeErrors = () => {
    if (errorListener || !host.addEventListener) return
    errorListener = (event) => publish('runtime-error', {
      type: 'error',
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error,
    })
    rejectionListener = (event) => publish('runtime-error', {
      type: 'unhandledrejection',
      reason: event.reason,
    })
    host.addEventListener('error', errorListener)
    host.addEventListener('unhandledrejection', rejectionListener)
  }

  const finishRequest = (xhr, outcome) => {
    const request = requests.get(xhr)
    if (!request || request.completed) return
    request.completed = true
    const completedAt = now()
    const captureOptions = { ...options }
    const headers = getResponseHeaders(xhr)
    const publishResponse = (body) => {
      const response = {
        status: xhr.status,
        statusText: xhr.statusText,
        headers,
        body: toBodyPayload(body, captureOptions.maxBodyBytes, captureOptions.mode),
      }
      const eventKind = outcome === 'load' ? 'network-response' : 'network-error'
      publish(eventKind, {
        requestId: request.id,
        method: request.method,
        url: redactUrl(request.url, captureOptions.mode),
        mocked: Boolean(Reflect.get(xhr, '__RN_DEBUGGER_NETWORK_MOCK__')),
        response,
        outcome,
        startedAt: request.startedAt,
        completedAt,
        duration: completedAt - request.startedAt,
      }, captureOptions)
    }
    const body = getResponseBody(xhr, host, headers)
    if (body && typeof body.then === 'function') {
      body.then(publishResponse)
    } else {
      publishResponse(body)
    }
  }

  function restoreXhr() {
    if (!xhrPrototype || !originalXhrMethods) return
    xhrPrototype.open = originalXhrMethods.open
    xhrPrototype.send = originalXhrMethods.send
    xhrPrototype.setRequestHeader = originalXhrMethods.setRequestHeader
    xhrPrototype = null
    originalXhrMethods = null
  }

  const installXhr = () => {
    const Xhr = host.XMLHttpRequest
    if (!Xhr || !Xhr.prototype || xhrPrototype === Xhr.prototype) return
    restoreXhr()
    xhrPrototype = Xhr.prototype
    originalXhrMethods = {
      open: xhrPrototype.open,
      send: xhrPrototype.send,
      setRequestHeader: xhrPrototype.setRequestHeader,
    }

    xhrPrototype.open = function capturedOpen(method, url, ...args) {
      requests.set(this, {
        id: requestSequence + 1,
        method: String(method || 'GET').toUpperCase(),
        url: String(url),
        headers: {},
        startedAt: 0,
        completed: false,
      })
      requestSequence += 1
      return originalXhrMethods.open.call(this, method, url, ...args)
    }
    xhrPrototype.setRequestHeader = function capturedSetRequestHeader(name, value) {
      const request = requests.get(this)
      if (request) request.headers[name] = value
      return originalXhrMethods.setRequestHeader.call(this, name, value)
    }
    xhrPrototype.send = function capturedSend(body) {
      const request = requests.get(this) || {
        id: requestSequence + 1,
        method: 'GET', url: this.responseURL || '', headers: {}, completed: false,
      }
      if (!requests.has(this)) requestSequence += 1
      request.body = toBodyPayload(body, options.maxBodyBytes, options.mode)
      request.startedAt = now()
      requests.set(this, request)
      this.addEventListener('loadend', () => finishRequest(this, 'load'))
      this.addEventListener('error', () => finishRequest(this, 'error'))
      this.addEventListener('abort', () => finishRequest(this, 'abort'))
      this.addEventListener('timeout', () => finishRequest(this, 'timeout'))
      publish('network-request', {
        requestId: request.id,
        method: request.method,
        url: redactUrl(request.url, options.mode),
        mocked: Boolean(Reflect.get(this, '__RN_DEBUGGER_NETWORK_MOCK__')),
        headers: request.headers,
        body: request.body,
        startedAt: request.startedAt,
      })
      return originalXhrMethods.send.call(this, body)
    }
  }

  const stop = () => {
    enabled = false
    restoreXhr()
    if (originalConsole) {
      Object.keys(originalConsole).forEach((level) => {
        host.console[level] = originalConsole[level]
      })
      originalConsole = null
    }
    if (errorListener && host.removeEventListener) {
      host.removeEventListener('error', errorListener)
      host.removeEventListener('unhandledrejection', rejectionListener)
      errorListener = null
      rejectionListener = null
    }
  }

  const configure = (config = {}) => {
    if (!config.enabled) {
      stop()
      return
    }
    options = {
      mode: config.sensitiveDataMode === 'raw' ? 'raw' : 'redacted',
      maxBodyBytes: Number.isFinite(config.maxBodyBytes) && config.maxBodyBytes > 0
        ? config.maxBodyBytes
        : DEFAULT_MAX_BODY_BYTES,
    }
    enabled = true
    installConsole()
    installRuntimeErrors()
    installXhr()
  }

  return { configure, stop }
}

export { DEFAULT_MAX_BODY_BYTES, REDACTED_VALUE }
