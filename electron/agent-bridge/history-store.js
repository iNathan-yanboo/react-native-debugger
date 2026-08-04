import fs from 'fs'
import path from 'path'

const ARCHIVE_VERSION = 1
const DATA_SUFFIX = '.ndjson'
const META_SUFFIX = '.meta.json'

const safeFileKey = (sessionId) => Buffer.from(String(sessionId)).toString('hex')

const cloneForDisk = (value) => {
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

const readJson = (fileSystem, filePath) => {
  try {
    return JSON.parse(fileSystem.readFileSync(filePath, 'utf8'))
  } catch (error) {
    return null
  }
}

const writeAtomically = (fileSystem, filePath, value) => {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fileSystem.writeFileSync(temporaryPath, value, { mode: 0o600 })
  fileSystem.renameSync(temporaryPath, filePath)
  fileSystem.chmodSync(filePath, 0o600)
}

export class DiskHistoryStore {
  constructor({
    directory,
    maxBytes = 64 * 1024 * 1024,
    maxSessions = 2,
    ttlMs = 24 * 60 * 60 * 1000,
    clock = () => Date.now(),
    fileSystem = fs,
  } = {}) {
    if (!directory) throw new Error('directory is required')
    this.directory = directory
    this.maxBytes = maxBytes
    this.maxSessions = maxSessions
    this.ttlMs = ttlMs
    this.clock = clock
    this.fileSystem = fileSystem
  }

  ensureDirectory() {
    this.fileSystem.mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    this.fileSystem.chmodSync(this.directory, 0o700)
  }

  paths(sessionId) {
    const base = path.join(this.directory, safeFileKey(sessionId))
    return {
      data: `${base}${DATA_SUFFIX}`,
      meta: `${base}${META_SUFFIX}`,
    }
  }

  list() {
    this.ensureDirectory()
    return this.fileSystem.readdirSync(this.directory)
      .filter((name) => name.endsWith(META_SUFFIX))
      .map((name) => readJson(this.fileSystem, path.join(this.directory, name)))
      .filter(Boolean)
      .sort((left, right) => right.archivedAt - left.archivedAt)
      .map((entry) => entry.summary)
  }

  getSummary(sessionId) {
    const { meta } = this.paths(sessionId)
    const entry = readJson(this.fileSystem, meta)
    return entry ? entry.summary : null
  }

  archive({ summary, snapshot }) {
    this.ensureDirectory()
    this.prune()
    const archivedAt = this.clock()
    const safeSummary = {
      ...cloneForDisk(summary),
      storage: 'disk',
      archivedAt,
    }
    const { data, meta } = this.paths(summary.sessionId)
    const temporaryPath = `${data}.${process.pid}.${archivedAt}.tmp`
    let descriptor
    try {
      descriptor = this.fileSystem.openSync(temporaryPath, 'w', 0o600)
      const writeRecord = (record) => {
        this.fileSystem.writeSync(descriptor, `${JSON.stringify(record)}\n`, null, 'utf8')
      }
      writeRecord({
        type: 'session',
        version: ARCHIVE_VERSION,
        value: {
          sessionId: snapshot.sessionId,
          sensitiveDataMode: snapshot.sensitiveDataMode,
          metadata: snapshot.metadata,
          startedAt: snapshot.startedAt,
          lastActivityAt: snapshot.lastActivityAt,
          nextCursor: snapshot.nextCursor,
        },
      })
      Object.keys(snapshot.buffers).forEach((collection) => {
        snapshot.buffers[collection].forEach((item) => {
          writeRecord({ type: 'buffer', collection, item })
        })
      })
      snapshot.networkDetails.forEach(([requestId, item]) => {
        writeRecord({ type: 'network-detail', requestId, item })
      })
      this.fileSystem.closeSync(descriptor)
      descriptor = null
      this.fileSystem.renameSync(temporaryPath, data)
      this.fileSystem.chmodSync(data, 0o600)
      const dataSize = this.fileSystem.statSync(data).size
      writeAtomically(this.fileSystem, meta, JSON.stringify({
        version: ARCHIVE_VERSION,
        archivedAt,
        dataSize,
        summary: safeSummary,
      }))
      this.prune()
      return safeSummary
    } catch (error) {
      if (descriptor !== undefined && descriptor !== null) this.fileSystem.closeSync(descriptor)
      try {
        if (this.fileSystem.existsSync(temporaryPath)) this.fileSystem.unlinkSync(temporaryPath)
      } catch (cleanupError) {
        // Keep the original archive intact if temporary-file cleanup fails.
      }
      throw error
    }
  }

  load(sessionId) {
    const { data } = this.paths(sessionId)
    if (!this.fileSystem.existsSync(data)) return null
    const snapshot = {
      sessionId,
      buffers: {},
      networkDetails: [],
    }
    const content = this.fileSystem.readFileSync(data, 'utf8')
    content.split('\n').filter(Boolean).forEach((line) => {
      const record = JSON.parse(line)
      if (record.type === 'session') Object.assign(snapshot, record.value)
      if (record.type === 'buffer') {
        if (!snapshot.buffers[record.collection]) snapshot.buffers[record.collection] = []
        snapshot.buffers[record.collection].push(record.item)
      }
      if (record.type === 'network-detail') snapshot.networkDetails.push([record.requestId, record.item])
    })
    return snapshot
  }

  prune() {
    this.ensureDirectory()
    const now = this.clock()
    const names = this.fileSystem.readdirSync(this.directory)
    const metaNames = new Set(names.filter((name) => name.endsWith(META_SUFFIX)))
    names.filter((name) => name.endsWith('.tmp')).forEach((name) => {
      try {
        this.fileSystem.unlinkSync(path.join(this.directory, name))
      } catch (error) {
        // The next startup or archive will retry cleanup of this known temp file.
      }
    })
    names.filter((name) => name.endsWith(DATA_SUFFIX)).forEach((name) => {
      const metaName = `${name.slice(0, -DATA_SUFFIX.length)}${META_SUFFIX}`
      if (metaNames.has(metaName)) return
      try {
        this.fileSystem.unlinkSync(path.join(this.directory, name))
      } catch (error) {
        // Do not let an orphaned archive prevent new debugging sessions.
      }
    })
    const entries = names
      .filter((name) => name.endsWith(META_SUFFIX))
      .map((name) => ({
        metaPath: path.join(this.directory, name),
        entry: readJson(this.fileSystem, path.join(this.directory, name)),
      }))
      .filter(({ entry }) => entry)
      .sort(({ entry: left }, { entry: right }) => left.archivedAt - right.archivedAt)

    const retained = entries.filter(({ entry }) => {
      const expired = this.ttlMs >= 0 && now - entry.archivedAt > this.ttlMs
      if (expired) this.remove(entry.summary.sessionId)
      return !expired
    })
    let totalBytes = retained.reduce((total, { entry, metaPath }) => (
      total + (entry.dataSize || 0) + this.fileSystem.statSync(metaPath).size
    ), 0)
    while (retained.length > this.maxSessions || totalBytes > this.maxBytes) {
      const oldest = retained.shift()
      totalBytes -= oldest.entry.dataSize || 0
      totalBytes -= this.fileSystem.statSync(oldest.metaPath).size
      this.remove(oldest.entry.summary.sessionId)
    }
  }

  remove(sessionId) {
    const paths = this.paths(sessionId)
    ;[paths.data, paths.meta].forEach((filePath) => {
      try {
        if (this.fileSystem.existsSync(filePath)) this.fileSystem.unlinkSync(filePath)
      } catch (error) {
        // Cleanup is best-effort; the next prune will retry this known archive path.
      }
    })
  }
}

export const createDiskHistoryStore = (options) => new DiskHistoryStore(options)
