import { createAgentCapture, REDACTED_VALUE } from '../agentCapture'

class FakeXMLHttpRequest {
  constructor() {
    this.listeners = {}
    this.responseType = ''
    this.status = 200
    this.statusText = 'OK'
    this.responseText = '{"message":"abcdefghijklmnopqrst"}'
    this.responseHeaders = 'content-type: application/json\r\nset-cookie: session=secret'
  }

  addEventListener(type, listener) {
    this.listeners[type] = this.listeners[type] || []
    this.listeners[type].push(listener)
  }

  emit(type) {
    const listeners = this.listeners[type] || []
    listeners.forEach((listener) => listener())
  }

  open(method, url) {
    this.method = method
    this.responseURL = url
  }

  setRequestHeader(name, value) {
    this.requestHeaders = { ...this.requestHeaders, [name]: value }
  }

  send() {
    this.emit('loadend')
  }

  getAllResponseHeaders() {
    return this.responseHeaders
  }
}

function FakeFileReader() {}

FakeFileReader.prototype.readAsText = function readAsText(blob) {
  this.blob = blob
  Promise.resolve().then(() => {
    this.result = blob.content
    this.onload()
  })
}

const createHost = () => {
  const listeners = {}
  const console = {}
  const levels = ['log', 'info', 'warn', 'error', 'debug']
  levels.forEach((level) => {
    console[level] = jest.fn()
  })
  return {
    XMLHttpRequest: FakeXMLHttpRequest,
    FileReader: FakeFileReader,
    console,
    addEventListener: jest.fn((type, listener) => {
      listeners[type] = listener
    }),
    removeEventListener: jest.fn(),
    emitRuntime: (type, event) => listeners[type](event),
  }
}

describe('agentCapture', () => {
  it('captures console values in redacted mode without changing console behavior', () => {
    const host = createHost()
    const events = []
    const capture = createAgentCapture({ host, emit: (event) => events.push(event), now: () => 10 })
    const originalWarn = host.console.warn
    capture.configure({ enabled: true })

    host.console.warn('request failed', { token: 'sensitive' })

    expect(originalWarn).toHaveBeenCalledWith('request failed', { token: 'sensitive' })
    expect(events).toEqual([{
      version: 1,
      kind: 'console',
      seq: 1,
      timestamp: 10,
      sensitiveDataMode: 'redacted',
      payload: { level: 'warn', arguments: ['request failed', { token: REDACTED_VALUE }] },
    }])
  })

  it('captures runtime errors and raw values when raw mode is explicitly enabled', () => {
    const host = createHost()
    const events = []
    const capture = createAgentCapture({ host, emit: (event) => events.push(event), now: () => 20 })
    capture.configure({ enabled: true, sensitiveDataMode: 'raw' })

    host.emitRuntime('error', { message: 'boom', error: new Error('boom') })
    host.emitRuntime('unhandledrejection', { reason: { token: 'visible' } })

    expect(events[0]).toMatchObject({
      version: 1, kind: 'runtime-error', seq: 1, timestamp: 20, sensitiveDataMode: 'raw',
    })
    expect(events[0].payload.error.message).toBe('boom')
    expect(events[1]).toEqual({
      version: 1,
      kind: 'runtime-error',
      seq: 2,
      timestamp: 20,
      sensitiveDataMode: 'raw',
      payload: { type: 'unhandledrejection', reason: { token: 'visible' } },
    })
  })

  it('captures each XHR once and redacts headers and truncates bodies', () => {
    const host = createHost()
    const events = []
    const timestamp = 0
    const capture = createAgentCapture({ host, emit: (event) => events.push(event), now: () => timestamp })
    capture.configure({ enabled: true, maxBodyBytes: 20 })

    const xhr = new host.XMLHttpRequest()
    xhr.open('post', 'https://example.test/orders')
    xhr.setRequestHeader('Authorization', 'Bearer secret')
    xhr.send('abcdefghijklmnopqrstuvwx')
    xhr.emit('error')

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      kind: 'network-request',
      payload: {
        method: 'POST',
        url: 'https://example.test/orders',
        headers: { Authorization: REDACTED_VALUE },
        body: { truncated: true, originalByteLength: 24 },
      },
    })
    expect(events[1]).toMatchObject({
      kind: 'network-response',
      payload: {
        response: {
          headers: { 'set-cookie': REDACTED_VALUE },
          body: { truncated: true, originalByteLength: 34 },
        },
        outcome: 'load',
      },
    })
  })

  it('redacts sensitive JSON body keys in redacted mode', () => {
    const host = createHost()
    const events = []
    const capture = createAgentCapture({ host, emit: (event) => events.push(event) })
    capture.configure({ enabled: true })

    const xhr = new host.XMLHttpRequest()
    xhr.open('post', 'https://example.test/orders?token=secret')
    xhr.send('{"token":"sensitive","orderNo":"123"}')

    expect(events[0].payload).toMatchObject({
      url: 'https://example.test/orders?token=[REDACTED]',
      body: {
        content: '{"token":"[REDACTED]","orderNo":"123"}',
        truncated: false,
      },
    })
  })

  it('reads textual Blob responses and preserves the response-time sensitive mode', async () => {
    const host = createHost()
    const events = []
    const capture = createAgentCapture({ host, emit: (event) => events.push(event) })
    capture.configure({ enabled: true, sensitiveDataMode: 'raw' })

    const xhr = new host.XMLHttpRequest()
    xhr.responseType = 'blob'
    xhr.response = {
      type: 'application/json',
      size: 37,
      content: '{"token":"visible","result":"success"}',
    }
    xhr.open('get', 'https://example.test/orders')
    xhr.send()
    capture.configure({ enabled: true, sensitiveDataMode: 'redacted' })
    await Promise.resolve()
    await Promise.resolve()

    expect(events[1]).toMatchObject({
      kind: 'network-response',
      sensitiveDataMode: 'raw',
      payload: {
        response: {
          body: {
            content: '{"token":"visible","result":"success"}',
            truncated: false,
          },
        },
      },
    })
  })

  it('keeps non-text Blob responses as bounded binary metadata', async () => {
    const host = createHost()
    const events = []
    const capture = createAgentCapture({ host, emit: (event) => events.push(event) })
    capture.configure({ enabled: true })

    const xhr = new host.XMLHttpRequest()
    xhr.responseType = 'blob'
    xhr.response = { type: 'image/png', size: 128 }
    xhr.open('get', 'https://example.test/image.png')
    xhr.send()
    await Promise.resolve()

    expect(events[1]).toMatchObject({
      kind: 'network-response',
      payload: {
        response: {
          body: {
            type: 'binary',
            byteLength: 128,
            contentType: 'image/png',
          },
        },
      },
    })
  })

  it('applies a runtime mode switch to subsequent events only', () => {
    const host = createHost()
    const events = []
    const capture = createAgentCapture({ host, emit: (event) => events.push(event) })
    capture.configure({ enabled: true })
    host.console.log({ token: 'first' })

    capture.configure({ enabled: true, sensitiveDataMode: 'raw' })
    host.console.log({ token: 'second' })

    expect(events).toMatchObject([
      {
        sensitiveDataMode: 'redacted',
        payload: { arguments: [{ token: REDACTED_VALUE }] },
      },
      {
        sensitiveDataMode: 'raw',
        payload: { arguments: [{ token: 'second' }] },
      },
    ])
  })
})
