/* eslint-disable no-underscore-dangle */

const getDefaultHost = () => (typeof self === 'undefined' ? {} : self)

const normalizeBody = (body) => {
  if (typeof body === 'string') return body
  if (typeof body === 'undefined' || body === null) return ''
  try {
    return JSON.stringify(body)
  } catch (error) {
    return String(body)
  }
}

const normalizeHeaders = (headers) => (
  headers && typeof headers === 'object' && !Array.isArray(headers) ? headers : {}
)

const getRules = (config) => {
  if (!config || !config.enabled || !Array.isArray(config.rules)) return []
  return config.rules.filter((rule) => rule && rule.enabled !== false && rule.url)
}

const matchesUrl = (rule, url) => {
  if (rule.urlMatchType !== 'regex') return String(rule.url) === String(url)
  try {
    return new RegExp(rule.url).test(String(url))
  } catch (error) {
    return false
  }
}

const findRule = (rules, method, url) => rules.find((rule) => (
  matchesUrl(rule, url)
  && (!rule.method || String(rule.method).toUpperCase() === String(method).toUpperCase())
))

const responseHeaders = (headers) => Object.entries(headers)
  .map(([name, value]) => `${name}: ${value}`)
  .join('\r\n')

const hasMockResponse = (rule) => (
  rule && (rule.mockResponseHeadersEnabled !== false || rule.mockResponseBodyEnabled !== false)
)

export const createNetworkMock = ({ host = getDefaultHost() } = {}) => {
  let originalXMLHttpRequest
  let installed = false
  let rules = []

  const stop = () => {
    if (installed && originalXMLHttpRequest) host.XMLHttpRequest = originalXMLHttpRequest
    installed = false
    originalXMLHttpRequest = null
    rules = []
  }

  const configure = (config = {}) => {
    const nextRules = getRules(config)
    stop()
    if (!nextRules.length || typeof host.XMLHttpRequest !== 'function') return

    originalXMLHttpRequest = host.XMLHttpRequest
    rules = nextRules
    const OriginalXMLHttpRequest = originalXMLHttpRequest
    const states = new WeakMap()
    const eventTypes = ['load', 'loadend', 'error', 'abort', 'timeout', 'readystatechange']

    const getState = (xhr) => states.get(xhr)
    const isMocked = (xhr) => getState(xhr).isMocked
    const isMixedResponse = (xhr) => getState(xhr).mixedResponse
    const dispatch = (xhr, event) => {
      const state = getState(xhr)
      const { type } = event
      const payload = { ...event, target: xhr, currentTarget: xhr }
      const handler = state.handlers[type]
      if (typeof handler === 'function') handler(payload)
      ;(state.listeners[type] || []).forEach((listener) => listener(payload))
    }
    const completeMixedResponse = (xhr) => {
      const state = getState(xhr)
      const { rule } = state
      state.status = state.native.status
      state.statusText = state.native.statusText
      state.responseURL = state.native.responseURL || state.url
      if (rule.mockResponseHeadersEnabled) {
        state.responseHeaderText = responseHeaders(normalizeHeaders(rule.headers))
      }
      if (rule.mockResponseBodyEnabled) {
        state.responseText = normalizeBody(rule.body)
        state.response = state.responseText
      }
      const delayMs = Number.isFinite(Number(rule.delayMs))
        ? Math.max(0, Number(rule.delayMs))
        : 0
      state.timer = setTimeout(() => {
        state.readyState = 4
        dispatch(xhr, { type: 'readystatechange' })
        dispatch(xhr, { type: 'load' })
        dispatch(xhr, { type: 'loadend' })
      }, delayMs)
    }

    function MockXMLHttpRequest() {
      const xhr = Object.create(MockXMLHttpRequest.prototype)
      states.set(xhr, {
        native: new OriginalXMLHttpRequest(),
        listeners: {},
        handlers: {},
        isMocked: false,
        mixedResponse: false,
        method: 'GET',
        url: '',
        rule: null,
        timer: null,
        responseText: '',
        response: null,
        responseHeaderText: '',
        readyState: 0,
        status: 0,
        statusText: '',
        responseURL: '',
        responseType: '',
        mockRequestHeadersApplied: false,
      })
      const state = getState(xhr)
      state.native.addEventListener('load', () => {
        if (state.mixedResponse) completeMixedResponse(xhr)
      })
      ;['error', 'abort', 'timeout'].forEach((type) => {
        state.native.addEventListener(type, () => {
          if (state.mixedResponse) dispatch(xhr, { type })
        })
      })
      xhr.__RN_DEBUGGER_NETWORK_MOCK__ = false
      return xhr
    }

    Object.defineProperties(MockXMLHttpRequest.prototype, {
      readyState: { get() { const state = getState(this); return (isMocked(this) || isMixedResponse(this)) ? state.readyState : state.native.readyState } },
      status: { get() { const state = getState(this); return (isMocked(this) || isMixedResponse(this)) ? state.status : state.native.status } },
      statusText: { get() { const state = getState(this); return (isMocked(this) || isMixedResponse(this)) ? state.statusText : state.native.statusText } },
      responseText: { get() { const state = getState(this); return isMocked(this) || (isMixedResponse(this) && state.rule.mockResponseBodyEnabled) ? state.responseText : state.native.responseText } },
      response: { get() { const state = getState(this); return isMocked(this) || (isMixedResponse(this) && state.rule.mockResponseBodyEnabled) ? state.response : state.native.response } },
      responseURL: { get() { const state = getState(this); return (isMocked(this) || isMixedResponse(this)) ? state.responseURL : state.native.responseURL } },
      responseType: {
        get() { const state = getState(this); return isMocked(this) ? state.responseType : state.native.responseType },
        set(value) { const state = getState(this); state.responseType = value; if (!isMocked(this)) state.native.responseType = value },
      },
      timeout: {
        get() { return getState(this).native.timeout },
        set(value) { getState(this).native.timeout = value },
      },
      withCredentials: {
        get() { return getState(this).native.withCredentials },
        set(value) { getState(this).native.withCredentials = value },
      },
      upload: { get() { return getState(this).native.upload } },
    })

    eventTypes.forEach((type) => {
      Object.defineProperty(MockXMLHttpRequest.prototype, `on${type}`, {
        get() { return getState(this).handlers[type] || null },
        set(handler) {
          const state = getState(this)
          state.handlers[type] = handler
          if (!state.isMocked && !state.mixedResponse) state.native[`on${type}`] = handler
        },
      })
    })

    MockXMLHttpRequest.prototype.addEventListener = function addEventListener(type, listener) {
      const state = getState(this)
      if (state.isMocked || state.mixedResponse) {
        state.listeners[type] = state.listeners[type] || []
        state.listeners[type].push(listener)
      } else {
        state.native.addEventListener(type, listener)
      }
    }
    MockXMLHttpRequest.prototype.removeEventListener = function removeEventListener(type, listener) {
      const state = getState(this)
      if (state.isMocked || state.mixedResponse) {
        state.listeners[type] = (state.listeners[type] || []).filter((item) => item !== listener)
      } else {
        state.native.removeEventListener(type, listener)
      }
    }
    MockXMLHttpRequest.prototype.open = function open(method, url, ...args) {
      const state = getState(this)
      state.method = String(method || 'GET').toUpperCase()
      state.url = String(url)
      state.rule = findRule(rules, state.method, state.url)
      state.mixedResponse = !!(hasMockResponse(state.rule) && state.rule.mixedResponseEnabled)
      state.isMocked = !!(hasMockResponse(state.rule) && !state.mixedResponse)
      this.__RN_DEBUGGER_NETWORK_MOCK__ = state.isMocked || state.mixedResponse
      if (state.isMocked) {
        state.readyState = 1
        state.responseURL = state.url
        return undefined
      }
      return state.native.open(method, url, ...args)
    }
    MockXMLHttpRequest.prototype.setRequestHeader = function setRequestHeader(name, value) {
      const state = getState(this)
      if (!state.isMocked) {
        if (state.rule && state.rule.mockRequestHeadersEnabled) return undefined
        return state.native.setRequestHeader(name, value)
      }
      return undefined
    }
    MockXMLHttpRequest.prototype.getAllResponseHeaders = function getAllResponseHeaders() {
      const state = getState(this)
      if (state.isMocked || (state.mixedResponse && state.rule.mockResponseHeadersEnabled)) {
        return state.responseHeaderText
      }
      return state.native.getAllResponseHeaders()
    }
    MockXMLHttpRequest.prototype.getResponseHeader = function getResponseHeader(name) {
      const state = getState(this)
      if (!state.isMocked && !(state.mixedResponse && state.rule.mockResponseHeadersEnabled)) {
        return state.native.getResponseHeader(name)
      }
      const headers = normalizeHeaders(state.rule.headers)
      const key = Object.keys(headers)
        .find((header) => header.toLowerCase() === String(name).toLowerCase())
      return key ? String(headers[key]) : null
    }
    MockXMLHttpRequest.prototype.abort = function abort() {
      const state = getState(this)
      if (!state.isMocked) return state.native.abort()
      if (state.timer) clearTimeout(state.timer)
      dispatch(this, { type: 'abort' })
      dispatch(this, { type: 'loadend' })
      return undefined
    }
    MockXMLHttpRequest.prototype.dispatchEvent = function dispatchEvent(event) {
      const state = getState(this)
      if (!state.isMocked && typeof state.native.dispatchEvent === 'function') {
        return state.native.dispatchEvent(event)
      }
      dispatch(this, event)
      return true
    }
    MockXMLHttpRequest.prototype.send = function send(...args) {
      const state = getState(this)
      const { rule } = state
      const delayMs = Number.isFinite(Number(rule && rule.delayMs))
        ? Math.max(0, Number(rule.delayMs))
        : 0
      if (!state.isMocked) {
        if (rule && rule.mockRequestHeadersEnabled && !state.mockRequestHeadersApplied) {
          Object.entries(normalizeHeaders(rule.mockRequestHeaders)).forEach(([name, value]) => {
            state.native.setRequestHeader(name, value)
          })
          state.mockRequestHeadersApplied = true
        }
        const body = rule && rule.mockRequestBodyEnabled ? rule.mockRequestBody : args[0]
        if (state.mixedResponse || !delayMs) return state.native.send(body)
        state.timer = setTimeout(() => state.native.send(body), delayMs)
        return undefined
      }
      const headers = rule.mockResponseHeadersEnabled === false ? {} : normalizeHeaders(rule.headers)
      state.responseText = rule.mockResponseBodyEnabled === false ? '' : normalizeBody(rule.body)
      state.response = state.responseText
      state.responseHeaderText = responseHeaders(headers)
      state.status = Number.isFinite(Number(rule.status)) ? Number(rule.status) : 200
      state.statusText = rule.statusText || 'OK'
      state.timer = setTimeout(() => {
        state.readyState = 4
        dispatch(this, { type: 'readystatechange' })
        dispatch(this, { type: 'load' })
        dispatch(this, { type: 'loadend' })
      }, delayMs)
      return undefined
    }

    host.XMLHttpRequest = MockXMLHttpRequest
    installed = true
  }

  return { configure, stop }
}
