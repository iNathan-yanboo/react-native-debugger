import fs from 'fs'
import os from 'os'
import path from 'path'
import { DiskHistoryStore } from '../history-store'

const createSnapshot = (sessionId, lastActivityAt = 100) => ({
  sessionId,
  sensitiveDataMode: 'redacted',
  metadata: { status: 'disconnected' },
  startedAt: lastActivityAt - 1,
  lastActivityAt,
  nextCursor: 3,
  buffers: {
    logs: [{ cursor: 1, kind: 'log', payload: { message: sessionId } }],
    redux: [],
    actions: [],
    network: [{ cursor: 2, kind: 'network', payload: { requestId: `${sessionId}-request` } }],
    events: [],
  },
  networkDetails: [[`${sessionId}-request`, {
    cursor: 2,
    kind: 'network',
    payload: { requestId: `${sessionId}-request` },
  }]],
})

describe('DiskHistoryStore', () => {
  let directory

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rnd-agent-history-'))
  })

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true })
  })

  test('archives records with user-only permissions and loads them on demand', () => {
    const store = new DiskHistoryStore({ directory, clock: () => 200 })
    const snapshot = createSnapshot('session one')
    const summary = {
      sessionId: snapshot.sessionId,
      sensitiveDataMode: snapshot.sensitiveDataMode,
      metadata: snapshot.metadata,
      startedAt: snapshot.startedAt,
      lastActivityAt: snapshot.lastActivityAt,
      counts: { logs: 1, redux: 0, actions: 0, network: 1, events: 0 },
    }

    store.archive({ summary, snapshot })

    expect(store.list()).toMatchObject([{ sessionId: 'session one', storage: 'disk' }])
    expect(store.load('session one')).toMatchObject({
      sessionId: 'session one',
      buffers: { logs: [{ payload: { message: 'session one' } }] },
      networkDetails: [['session one-request', { payload: { requestId: 'session one-request' } }]],
    })
    const files = fs.readdirSync(directory)
    expect(files.some((name) => name.endsWith('.ndjson'))).toBe(true)
    expect(files.some((name) => name.endsWith('.meta.json'))).toBe(true)
    expect(fs.statSync(directory).mode.toString(8).slice(-3)).toBe('700')
    files.forEach((name) => {
      expect(fs.statSync(path.join(directory, name)).mode.toString(8).slice(-3)).toBe('600')
    })
  })

  test('removes expired and over-limit history archives', () => {
    let now = 100
    const store = new DiskHistoryStore({
      directory,
      maxSessions: 1,
      ttlMs: 10,
      clock: () => now,
    })
    const archive = (sessionId) => {
      const snapshot = createSnapshot(sessionId, now)
      store.archive({
        snapshot,
        summary: {
          sessionId,
          sensitiveDataMode: 'redacted',
          metadata: {},
          startedAt: now,
          lastActivityAt: now,
          counts: {},
        },
      })
    }

    archive('old')
    now = 105
    archive('new')
    expect(store.list().map(({ sessionId }) => sessionId)).toEqual(['new'])
    now = 116
    store.prune()
    expect(store.list()).toEqual([])
  })

  test('cleans up incomplete archive files left by an interrupted write', () => {
    const store = new DiskHistoryStore({ directory })
    fs.writeFileSync(path.join(directory, 'leftover.tmp'), 'partial')
    fs.writeFileSync(path.join(directory, 'orphan.ndjson'), 'partial')

    store.prune()

    expect(fs.readdirSync(directory)).toEqual([])
  })
})
