import fs from 'fs'
import path from 'path'

export const createDiscoveryDocument = ({
  port,
  token,
  pid = process.pid,
  startedAt = Date.now(),
}) => ({
  version: 1,
  pid,
  origin: `http://127.0.0.1:${port}`,
  token,
  startedAt,
})

// Kept separate from the Bridge lifecycle so production callers can decide where
// discovery lives and tests can replace the write with a pure function.
export const writeDiscoveryFile = (filePath, document, fileSystem = fs) => {
  fileSystem.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  fileSystem.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, {
    mode: 0o600,
  })
  fileSystem.chmodSync(filePath, 0o600)
  return document
}

export const removeDiscoveryFile = (filePath, fileSystem = fs) => {
  if (fileSystem.existsSync(filePath)) fileSystem.unlinkSync(filePath)
}
