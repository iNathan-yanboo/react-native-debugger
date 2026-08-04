import fs from 'fs'
import os from 'os'
import path from 'path'
import { AgentEventStore } from '../event-store'
import { DiskHistoryStore } from '../history-store'

const session = {
  sessionId: 'metro-8081',
  sensitiveDataMode: 'raw',
  metadata: { metroPort: 8081 },
}

test('keeps independent bounded event streams per session and paginates with cursors', () => {
  const store = new AgentEventStore({ limits: { logs: 2 }, clock: jest.fn(() => 100) })
  store.registerSession(session)
  store.ingest({ sessionId: session.sessionId, type: 'log', payload: { message: 'one' } })
  store.ingest({ sessionId: session.sessionId, type: 'log', payload: { message: 'two' } })
  store.ingest({ sessionId: session.sessionId, type: 'log', payload: { message: 'three' } })
  store.ingest({
    sessionId: 'metro-8082',
    type: 'log',
    sensitiveDataMode: 'redacted',
    payload: { message: 'other session' },
  })

  const firstPage = store.page(session.sessionId, 'logs', { limit: 1 })
  expect(firstPage.session.sensitiveDataMode).toBe('raw')
  expect(firstPage.items.map((item) => item.payload.message)).toEqual(['two'])
  expect(firstPage.hasMore).toBe(true)
  expect(store.page(session.sessionId, 'logs', { cursor: firstPage.nextCursor, limit: 1 }))
    .toMatchObject({ hasMore: false, items: [{ payload: { message: 'three' } }] })
  expect(store.page('metro-8082', 'logs').items).toHaveLength(1)
  expect(store.page(session.sessionId, 'events', { limit: 10 })).toMatchObject({
    sensitiveDataMode: 'raw',
    items: [
      { kind: 'log', payload: { message: 'one' } },
      { kind: 'log', payload: { message: 'two' } },
      { kind: 'log', payload: { message: 'three' } },
    ],
  })
})

test('allows the Electron integration to switch modes without rewriting existing events', () => {
  const store = new AgentEventStore()
  store.registerSession(session)
  store.ingest({
    sessionId: session.sessionId,
    type: 'log',
    payload: { message: 'captured while raw' },
  })

  expect(store.setSessionSensitiveDataMode(session.sessionId, 'redacted'))
    .toMatchObject({ sensitiveDataMode: 'redacted' })
  store.ingest({
    sessionId: session.sessionId,
    type: 'log',
    payload: { message: 'captured while redacted' },
  })

  const allEvents = store.page(session.sessionId, 'logs', { limit: 10 })
  expect(allEvents).toMatchObject({
    sensitiveDataMode: 'raw',
    session: { sensitiveDataMode: 'redacted' },
    items: [
      { sensitiveDataMode: 'raw', payload: { message: 'captured while raw' } },
      { sensitiveDataMode: 'redacted', payload: { message: 'captured while redacted' } },
    ],
  })
  expect(store.page(session.sessionId, 'logs', {
    cursor: allEvents.items[0].cursor,
    limit: 10,
  })).toMatchObject({
    sensitiveDataMode: 'redacted',
    items: [{ sensitiveDataMode: 'redacted' }],
  })
  expect(store.registerSession({ sessionId: 'new-after-disconnect' }))
    .toMatchObject({ sensitiveDataMode: 'redacted' })
})

test('returns network request details and removes evicted detail records', () => {
  const store = new AgentEventStore({ limits: { network: 1 } })
  store.registerSession(session)
  store.ingest({
    sessionId: session.sessionId,
    type: 'network',
    payload: { requestId: 'request-1', url: '/first', response: { body: 'secret' } },
  })
  expect(store.getNetworkDetail(session.sessionId, 'request-1')).toMatchObject({
    session: { sensitiveDataMode: 'raw' },
    item: { payload: { requestId: 'request-1' } },
  })
  store.ingest({
    sessionId: session.sessionId,
    type: 'network',
    payload: { requestId: 'request-2', url: '/second' },
  })
  expect(store.getNetworkDetail(session.sessionId, 'request-1')).toBeNull()
})

test('correlates network request and response events by requestId', () => {
  const store = new AgentEventStore()
  store.registerSession(session)
  store.ingest({
    sessionId: session.sessionId,
    type: 'network-request',
    payload: { requestId: 7, method: 'GET', url: '/orders' },
  })
  store.setSessionSensitiveDataMode(session.sessionId, 'redacted')
  store.ingest({
    sessionId: session.sessionId,
    type: 'network-response',
    payload: { requestId: 7, response: { status: 200 } },
  })

  expect(store.page(session.sessionId, 'network')).toMatchObject({
    sensitiveDataMode: 'raw',
    items: [{
      kind: 'network-response',
      sensitiveDataMode: 'raw',
      payload: {
        requestId: '7',
        method: 'GET',
        url: '/orders',
        response: { status: 200 },
      },
    }],
  })
  expect(store.getNetworkDetail(session.sessionId, '7')).toMatchObject({
    item: { payload: { method: 'GET', response: { status: 200 } } },
  })
  expect(store.page(session.sessionId, 'events').items).toHaveLength(2)
})

test('moves disconnected session payloads out of the main-process store', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rnd-agent-store-'))
  try {
    const store = new AgentEventStore({
      historyStore: new DiskHistoryStore({ directory }),
    })
    store.registerSession(session)
    store.ingest({
      sessionId: session.sessionId,
      type: 'network',
      payload: { requestId: 'archived-request', response: { body: 'large body' } },
    })

    store.archiveSession(session.sessionId)

    expect(store.sessions.has(session.sessionId)).toBe(false)
    expect(store.listSessions()).toMatchObject([{ sessionId: session.sessionId, storage: 'disk' }])
    expect(store.getNetworkDetail(session.sessionId, 'archived-request')).toMatchObject({
      item: { payload: { response: { body: 'large body' } } },
    })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
