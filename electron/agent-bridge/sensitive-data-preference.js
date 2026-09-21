export const DEFAULT_SENSITIVE_DATA_MODE = 'redacted'
export const SENSITIVE_DATA_MODE_KEY = 'sensitiveDataMode'
export const SENSITIVE_DATA_MODES = new Set(['redacted', 'raw'])

export const readSensitiveDataMode = (store, persist = true) => {
  if (!persist) return DEFAULT_SENSITIVE_DATA_MODE
  const storedMode = store.get(SENSITIVE_DATA_MODE_KEY)
  return SENSITIVE_DATA_MODES.has(storedMode)
    ? storedMode
    : DEFAULT_SENSITIVE_DATA_MODE
}

export const writeSensitiveDataMode = (store, sensitiveDataMode, persist = true) => {
  if (!SENSITIVE_DATA_MODES.has(sensitiveDataMode)) return
  store.set(
    SENSITIVE_DATA_MODE_KEY,
    persist ? sensitiveDataMode : DEFAULT_SENSITIVE_DATA_MODE,
  )
}
