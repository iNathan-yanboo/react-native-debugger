import { createNetworkMock } from '../networkMock'
import { createAgentCapture } from '../agentCapture'

/* eslint-disable no-underscore-dangle */

class FakeXMLHttpRequest {
  constructor() {
    FakeXMLHttpRequest.lastInstance = this
    this.listeners = {}
    this.status = 204
    this.statusText = 'No Content'
    this.responseText = ''
  }

  addEventListener(type, listener) {
    this.listeners[type] = this.listeners[type] || []
    this.listeners[type].push(listener)
  }

  removeEventListener(type, listener) {
    this.listeners[type] = (this.listeners[type] || []).filter((item) => item !== listener)
  }

  open(method, url) {
    this.method = method
    this.responseURL = url
  }

  setRequestHeader(name, value) {
    this.requestHeaders = this.requestHeaders || {}
    this.requestHeaders[name] = value
  }

  send(body) {
    this.requestBody = body
    ;(this.listeners.load || []).forEach((listener) => listener())
    ;(this.listeners.loadend || []).forEach((listener) => listener())
  }

  getAllResponseHeaders() { return this.responseHeaders || '' }

  getResponseHeader() { return this.responseHeader || null }

  abort() { this.aborted = true }
}

describe('networkMock', () => {
  it('returns a configured response without sending the matching request', (done) => {
    const host = { XMLHttpRequest: FakeXMLHttpRequest }
    const mock = createNetworkMock({ host })
    mock.configure({
      enabled: true,
      rules: [{
        url: 'https://example.test/profile',
        method: 'GET',
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: { id: 'mock-user' },
      }],
    })

    const xhr = new host.XMLHttpRequest()
    xhr.open('GET', 'https://example.test/profile')
    xhr.addEventListener('loadend', () => {
      expect(xhr.__RN_DEBUGGER_NETWORK_MOCK__).toBe(true)
      expect(xhr.status).toBe(200)
      expect(xhr.responseText).toBe('{"id":"mock-user"}')
      expect(xhr.getResponseHeader('Content-Type')).toBe('application/json')
      done()
    })
    xhr.send()
  })

  it('passes through a non-matching request and restores the original constructor', () => {
    const host = { XMLHttpRequest: FakeXMLHttpRequest }
    const original = host.XMLHttpRequest
    const mock = createNetworkMock({ host })
    mock.configure({ enabled: true, rules: [{ url: 'https://example.test/mocked' }] })

    const xhr = new host.XMLHttpRequest()
    xhr.open('GET', 'https://example.test/live')
    xhr.send()

    expect(xhr.__RN_DEBUGGER_NETWORK_MOCK__).toBe(false)
    expect(xhr.status).toBe(204)
    mock.stop()
    expect(host.XMLHttpRequest).toBe(original)
  })

  it('matches a URL regular expression only when explicitly enabled', (done) => {
    const host = { XMLHttpRequest: FakeXMLHttpRequest }
    const mock = createNetworkMock({ host })
    mock.configure({
      enabled: true,
      rules: [{
        url: '^https://example\\.test/users/\\d+$',
        urlMatchType: 'regex',
        body: { id: 'matched-by-regex' },
      }],
    })

    const xhr = new host.XMLHttpRequest()
    xhr.open('GET', 'https://example.test/users/42')
    xhr.addEventListener('loadend', () => {
      expect(xhr.__RN_DEBUGGER_NETWORK_MOCK__).toBe(true)
      expect(xhr.responseText).toBe('{"id":"matched-by-regex"}')
      done()
    })
    xhr.send()
  })

  it('can replace the outbound request headers and body without mocking the response', () => {
    const host = { XMLHttpRequest: FakeXMLHttpRequest }
    const mock = createNetworkMock({ host })
    mock.configure({
      enabled: true,
      rules: [{
        url: 'https://example.test/live',
        mockRequestHeadersEnabled: true,
        mockRequestHeaders: { authorization: 'Bearer mock-token' },
        mockRequestBodyEnabled: true,
        mockRequestBody: '{"source":"mock"}',
        mockResponseHeadersEnabled: false,
        mockResponseBodyEnabled: false,
      }],
    })

    const xhr = new host.XMLHttpRequest()
    xhr.open('POST', 'https://example.test/live')
    xhr.setRequestHeader('authorization', 'Bearer real-token')
    xhr.send('{"source":"real"}')

    expect(xhr.__RN_DEBUGGER_NETWORK_MOCK__).toBe(false)
    expect(FakeXMLHttpRequest.lastInstance.requestHeaders)
      .toEqual({ authorization: 'Bearer mock-token' })
    expect(FakeXMLHttpRequest.lastInstance.requestBody).toBe('{"source":"mock"}')
  })

  it('can pass through a real response and replace only enabled response fields', (done) => {
    const host = { XMLHttpRequest: FakeXMLHttpRequest }
    const mock = createNetworkMock({ host })
    mock.configure({
      enabled: true,
      rules: [{
        url: 'https://example.test/live',
        mixedResponseEnabled: true,
        mockResponseHeadersEnabled: true,
        mockResponseBodyEnabled: false,
        headers: { 'x-mock-source': 'mixed' },
      }],
    })

    const xhr = new host.XMLHttpRequest()
    xhr.open('GET', 'https://example.test/live')
    xhr.addEventListener('loadend', () => {
      expect(xhr.__RN_DEBUGGER_NETWORK_MOCK__).toBe(true)
      expect(FakeXMLHttpRequest.lastInstance.requestBody).toBeUndefined()
      expect(xhr.status).toBe(204)
      expect(xhr.responseText).toBe('')
      expect(xhr.getResponseHeader('X-Mock-Source')).toBe('mixed')
      done()
    })
    xhr.send()
  })

  it('remains compatible with Agent network capture', async () => {
    const host = { XMLHttpRequest: FakeXMLHttpRequest }
    const events = []
    const mock = createNetworkMock({ host })
    const capture = createAgentCapture({ host, emit: (event) => events.push(event) })
    mock.configure({
      enabled: true,
      rules: [{ url: 'https://example.test/profile', body: { id: 'mock-user' } }],
    })
    capture.configure({ enabled: true, sensitiveDataMode: 'raw' })

    const xhr = new host.XMLHttpRequest()
    xhr.open('GET', 'https://example.test/profile')
    xhr.send()
    await new Promise((resolve) => { setTimeout(resolve, 0) })

    expect(events).toMatchObject([
      {
        kind: 'network-request',
        payload: { url: 'https://example.test/profile', mocked: true },
      },
      {
        kind: 'network-response',
        payload: {
          mocked: true,
          response: { body: { content: '{"id":"mock-user"}' } },
        },
      },
    ])
  })
})
