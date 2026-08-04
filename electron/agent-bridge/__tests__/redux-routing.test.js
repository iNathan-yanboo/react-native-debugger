import { AgentEventStore } from '../event-store'
import { getReduxEventTypes } from '../runtime'

const ingestReduxMessage = (store, sessionId, request) => {
  getReduxEventTypes(request).forEach((type) => {
    store.ingest({ sessionId, type, payload: request })
  })
}

describe('Agent Bridge Redux routing', () => {
  test('keeps only state-bearing messages as the latest Redux state', () => {
    const store = new AgentEventStore()
    const sessionId = 'redux-session'
    store.registerSession({ sessionId })

    const initial = { type: 'INIT', payload: '{"cart":{"count":1}}' }
    ingestReduxMessage(store, sessionId, initial)
    ;['ERROR', 'Error', 'EXPORT', 'START', 'COMMIT'].forEach((type) => {
      ingestReduxMessage(store, sessionId, { type, payload: 'not-state' })
    })

    expect(store.latest(sessionId, 'redux').item.payload).toEqual(initial)
  })

  test('records an ACTION in actions and refreshes the latest Redux state', () => {
    const store = new AgentEventStore()
    const sessionId = 'redux-action-session'
    store.registerSession({ sessionId, sensitiveDataMode: 'redacted' })

    const action = {
      type: 'ACTION',
      action: '{"type":"ADD_ITEM"}',
      payload: '{"cart":{"count":2}}',
    }
    ingestReduxMessage(store, sessionId, action)

    expect(store.page(sessionId, 'actions').items).toHaveLength(1)
    expect(store.latest(sessionId, 'redux').item.payload).toEqual(action)
  })

  test('recognizes STATE and INIT without widening the protocol surface', () => {
    expect(getReduxEventTypes({ type: 'STATE' })).toEqual(['redux-state'])
    expect(getReduxEventTypes({ type: 'INIT' })).toEqual(['redux-state'])
    expect(getReduxEventTypes({ type: 'action' })).toEqual(['redux-action', 'redux-state'])
    expect(getReduxEventTypes({ type: 'EXPORT' })).toEqual([])
  })

  test('keeps only the latest full state when ingesting runtime Redux messages', () => {
    const store = new AgentEventStore()
    const sessionId = 'redux-runtime-session'
    store.registerSession({ sessionId })

    store.ingestReduxMessage({
      sessionId,
      request: {
        type: 'ACTION',
        action: '{"type":"ADD_ITEM"}',
        payload: '{"cart":{"count":1}}',
      },
    })
    store.ingestReduxMessage({
      sessionId,
      request: {
        type: 'ACTION',
        action: '{"type":"ADD_ITEM"}',
        payload: '{"cart":{"count":2}}',
      },
    })

    const actions = store.page(sessionId, 'actions', { limit: 10 }).items
    const events = store.page(sessionId, 'events', { limit: 10 }).items
    expect(actions).toHaveLength(2)
    expect(actions.every((item) => item.payload.payload === undefined)).toBe(true)
    expect(store.latest(sessionId, 'redux').item.payload.payload).toBe('{"cart":{"count":2}}')
    expect(events.filter((item) => item.kind === 'redux-state')).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ stateOmitted: true }) }),
      expect.objectContaining({ payload: expect.objectContaining({ stateOmitted: true }) }),
    ])
  })
})
