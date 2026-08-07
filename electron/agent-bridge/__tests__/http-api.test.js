import http from 'http'
import { createAgentBridge } from '..'

const request = ({
  port,
  path,
  token,
  method = 'GET',
  origin,
  body,
}) => new Promise((resolve, reject) => {
  const clientRequest = http.request({
    host: '127.0.0.1',
    port,
    path,
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
  }, (response) => {
    let responseBody = ''
    response.on('data', (chunk) => { responseBody += chunk })
    response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(responseBody) }))
  })
  clientRequest.on('error', reject)
  clientRequest.end(body ? JSON.stringify(body) : undefined)
})

describe('Agent Bridge HTTP API', () => {
  let bridge

  beforeEach(() => {
    bridge = createAgentBridge({ token: 'test-token' })
    bridge.registerSession({ sessionId: 's 1', sensitiveDataMode: 'raw' })
    bridge.ingest({
      sessionId: 's 1',
      type: 'log',
      payload: { level: 'info', message: 'hello' },
    })
    bridge.ingest({
      sessionId: 's 1',
      type: 'log',
      payload: { level: 'error', message: 'boom' },
    })
    bridge.ingest({
      sessionId: 's 1',
      type: 'log',
      payload: {
        level: 'info',
        arguments: ['needle order', { detail: 'x'.repeat(1000) }],
      },
    })
    bridge.ingest({
      sessionId: 's 1',
      type: 'redux-state',
      payload: {
        type: 'STATE',
        payload: '{"cart":{"items":[{"name":"pizza","price":42}]}}',
      },
    })
    bridge.ingest({
      sessionId: 's 1',
      type: 'redux-action',
      payload: {
        type: 'ACTION',
        action: '{"type":"PERFORM_ACTION","action":{"type":"INCREMENT","amount":1}}',
        payload: '{"cart":{"items":[{"name":"pizza","price":43}]}}',
      },
    })
    bridge.ingest({
      sessionId: 's 1',
      type: 'network',
      payload: {
        requestId: 'request/1',
        method: 'GET',
        url: 'https://example.test/orders',
        headers: { Authorization: 'Bearer test' },
        body: { content: '{"request":true}' },
        response: {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: { content: '{"response":"abcdefghijklmnop"}' },
        },
      },
    })
  })

  afterEach(async () => bridge.stop())

  test('only exposes authenticated GET endpoints on loopback', async () => {
    const discovery = await bridge.start()
    const { port } = new URL(discovery.origin)
    expect(discovery.origin).toMatch(/^http:\/\/127\.0\.0\.1:/)
    expect(discovery.token).toBe('test-token')
    const unauthenticated = await request({ port, path: '/v1/sessions' })
    expect(unauthenticated).toMatchObject({ status: 401, body: { error: 'unauthorized' } })

    const sessions = await request({
      port,
      path: '/v1/sessions',
      token: bridge.token,
    })
    expect(sessions).toMatchObject({
      status: 200,
      body: {
        sensitiveDataMode: 'raw',
        sessions: [{ sessionId: 's 1', sensitiveDataMode: 'raw' }],
      },
    })
    const boundedSessions = await request({
      port,
      path: '/v1/sessions?maxResultBytes=180',
      token: bridge.token,
    })
    expect(boundedSessions.body).toMatchObject({
      resultTruncated: true,
      maxResultBytes: 180,
      sessions: [{ sessionId: 's 1' }],
    })
    const logs = await request({
      port,
      path: '/v1/sessions/s%201/logs?limit=1',
      token: bridge.token,
    })
    expect(logs).toMatchObject({
      status: 200,
      body: {
        sensitiveDataMode: 'raw',
        session: { sensitiveDataMode: 'raw' },
        items: [{ payload: { message: 'hello' } }],
      },
    })
    const filteredLogs = await request({
      port,
      path: '/v1/sessions/s%201/logs?level=error',
      token: bridge.token,
    })
    expect(filteredLogs).toMatchObject({
      status: 200,
      body: { items: [{ payload: { level: 'error', message: 'boom' } }] },
    })
    const searchedLogs = await request({
      port,
      path: '/v1/sessions/s%201/logs?search=NEEDLE&compact=true&maxValueBytes=80',
      token: bridge.token,
    })
    expect(searchedLogs).toMatchObject({
      status: 200,
      body: {
        items: [{
          payload: {
            level: 'info',
            message: expect.stringContaining('needle order'),
          },
        }],
      },
    })
    expect(searchedLogs.body.items[0].payload.arguments).toBeUndefined()
    expect(searchedLogs.body.items[0].payload.searchMatched).toBe(true)
    expect(searchedLogs.body.items[0].payload.messageTruncated).toBe(true)
    const boundedLogs = await request({
      port,
      path: '/v1/sessions/s%201/logs?compact=true&limit=3&maxResultBytes=700',
      token: bridge.token,
    })
    expect(boundedLogs.body).toMatchObject({
      resultTruncated: true,
      maxResultBytes: 700,
      hasMore: true,
    })
    const reduxState = await request({
      port,
      path: '/v1/sessions/s%201/redux/state',
      token: bridge.token,
    })
    expect(reduxState).toMatchObject({
      status: 200,
      body: {
        sensitiveDataMode: 'raw',
        item: { payload: { type: 'STATE' } },
      },
    })
    const selectedReduxState = await request({
      port,
      path: '/v1/sessions/s%201/redux/state?path=%2Fcart%2Fitems%2F0%2Fname&maxValueBytes=100',
      token: bridge.token,
    })
    expect(selectedReduxState).toMatchObject({
      status: 200,
      body: {
        item: {
          payload: {
            path: '/cart/items/0/name',
            value: 'pizza',
          },
        },
      },
    })
    const reduxActions = await request({
      port,
      path: '/v1/sessions/s%201/redux/actions',
      token: bridge.token,
    })
    expect(reduxActions).toMatchObject({
      status: 200,
      body: { items: [{ payload: { action: expect.stringContaining('INCREMENT') } }] },
    })
    const filteredActions = await request({
      port,
      path: '/v1/sessions/s%201/redux/actions?actionType=INCREMENT&compact=true&includeState=false',
      token: bridge.token,
    })
    expect(filteredActions.body.items).toHaveLength(1)
    expect(filteredActions.body.items[0]).toMatchObject({
      payload: {
        action: {
          action: { type: 'INCREMENT', amount: 1 },
        },
      },
    })
    expect(filteredActions.body.items[0].payload.state).toBeUndefined()
    const events = await request({
      port,
      path: '/v1/sessions/s%201/events?after=0&limit=1&timeoutMs=1',
      token: bridge.token,
    })
    expect(events).toMatchObject({
      status: 200,
      body: { sensitiveDataMode: 'raw', event: { cursor: 1 } },
    })
    const networkEvents = await request({
      port,
      path: '/v1/sessions/s%201/events?after=0&eventTypes=network&timeoutMs=1',
      token: bridge.token,
    })
    expect(networkEvents).toMatchObject({
      status: 200,
      body: { event: { kind: 'network' } },
    })
    const reduxStateEvent = await request({
      port,
      path: '/v1/sessions/s%201/events?after=3&eventTypes=redux-state&timeoutMs=1',
      token: bridge.token,
    })
    expect(reduxStateEvent).toMatchObject({
      status: 200,
      body: {
        event: {
          kind: 'redux-state',
          payload: {
            messageType: 'STATE',
            stateOmitted: true,
          },
        },
      },
    })
    expect(reduxStateEvent.body.event.payload.value).toBeUndefined()
    const reduxStateEventWithValue = await request({
      port,
      path: '/v1/sessions/s%201/events?after=3&eventTypes=redux-state&timeoutMs=1&includeState=true&path=%2Fcart%2Fitems%2F0%2Fname&maxValueBytes=100',
      token: bridge.token,
    })
    expect(reduxStateEventWithValue).toMatchObject({
      status: 200,
      body: {
        event: {
          kind: 'redux-state',
          payload: {
            messageType: 'STATE',
            path: '/cart/items/0/name',
            value: 'pizza',
          },
        },
      },
    })
    const filteredNetwork = await request({
      port,
      path: '/v1/sessions/s%201/network?method=GET&status=200&url=orders',
      token: bridge.token,
    })
    expect(filteredNetwork.body.items).toHaveLength(1)
    expect(filteredNetwork.body.items[0].payload.headers).toBeUndefined()
    expect(filteredNetwork.body.items[0].payload.body).toBeUndefined()
    expect(filteredNetwork.body.items[0].payload.response.body).toBeUndefined()
    const detail = await request({
      port,
      path: '/v1/sessions/s%201/network/request%2F1?bodyPreviewBytes=8',
      token: bridge.token,
    })
    expect(detail).toMatchObject({
      status: 200,
      body: {
        item: {
          payload: {
            headers: { Authorization: 'Bearer test' },
            body: {
              content: '{"reques',
              previewTruncated: true,
            },
            response: {
              status: 200,
              body: {
                content: '{"respon',
                previewTruncated: true,
              },
            },
          },
        },
      },
    })
    bridge.registerSession({
      sessionId: 's 1',
      sensitiveDataMode: 'raw',
      metadata: { status: 'disconnected' },
    })
    const disconnectedStartedAt = Date.now()
    const disconnectedWait = await request({
      port,
      path: '/v1/sessions/s%201/events?after=999&timeoutMs=30000',
      token: bridge.token,
    })
    expect(disconnectedWait).toMatchObject({
      status: 200,
      body: { sessionDisconnected: true, event: null },
    })
    expect(Date.now() - disconnectedStartedAt).toBeLessThan(1000)
    const post = await request({
      port,
      path: '/v1/sessions',
      method: 'POST',
      token: bridge.token,
    })
    expect(post.status).toBe(405)
    const browserOrigin = await request({
      port,
      path: '/v1/sessions',
      token: bridge.token,
      origin: 'http://example.test',
    })
    expect(browserOrigin).toMatchObject({
      status: 403,
      body: { error: 'browser_origin_not_allowed' },
    })
  })

  test('rejects a non-loopback host before starting a server', async () => {
    await expect(bridge.start({ host: '0.0.0.0' })).rejects.toThrow('127.0.0.1')
  })

  test('manages Network Mock rules through the authenticated loopback API', async () => {
    const rules = []
    const mockBridge = createAgentBridge({
      token: 'mock-token',
      networkMocks: {
        list: () => rules,
        save: (draft) => {
          const rule = { id: draft.id || 'rule-1', ...draft }
          const index = rules.findIndex((item) => item.id === rule.id)
          if (index === -1) rules.push(rule)
          else rules[index] = rule
          return rule
        },
        setEnabled: (id, enabled) => {
          const rule = rules.find((item) => item.id === id)
          rule.enabled = enabled
          return rule
        },
        remove: (id) => {
          rules.splice(rules.findIndex((item) => item.id === id), 1)
        },
      },
    })
    const discovery = await mockBridge.start()
    const { port } = new URL(discovery.origin)
    const saved = await request({
      port,
      token: mockBridge.token,
      method: 'POST',
      path: '/v1/network-mocks',
      body: { url: 'https://example.test/mock', method: 'GET' },
    })
    expect(saved.body).toMatchObject({ sensitiveDataMode: 'raw', rule: { id: 'rule-1' } })
    const listed = await request({ port, token: mockBridge.token, path: '/v1/network-mocks' })
    expect(listed.body.rules).toHaveLength(1)
    const disabled = await request({
      port,
      token: mockBridge.token,
      method: 'POST',
      path: '/v1/network-mocks/rule-1/enabled',
      body: { enabled: false },
    })
    expect(disabled.body.rule.enabled).toBe(false)
    const removed = await request({
      port,
      token: mockBridge.token,
      method: 'DELETE',
      path: '/v1/network-mocks/rule-1',
    })
    expect(removed.body).toMatchObject({ deleted: true, id: 'rule-1' })
    await mockBridge.stop()
  })

  test('writes discovery through an injectable filesystem adapter', async () => {
    await bridge.start()
    const fileSystem = {
      mkdirSync: jest.fn(),
      writeFileSync: jest.fn(),
      chmodSync: jest.fn(),
    }
    const document = bridge.publishDiscovery('/tmp/rnd-agent.json', fileSystem)
    expect(document).toEqual(bridge.discovery)
    expect(fileSystem.writeFileSync).toHaveBeenCalledWith(
      '/tmp/rnd-agent.json',
      expect.stringContaining('test-token'),
      { mode: 0o600 },
    )
    expect(fileSystem.chmodSync).toHaveBeenCalledWith('/tmp/rnd-agent.json', 0o600)
  })
})
