import {
  DEFAULT_SENSITIVE_DATA_MODE,
  SENSITIVE_DATA_MODE_KEY,
  readSensitiveDataMode,
  writeSensitiveDataMode,
} from '../sensitive-data-preference'

const createStore = (storedMode) => ({
  get: jest.fn(() => storedMode),
  set: jest.fn(),
})

test('restores a persisted raw-mode preference for a new session', () => {
  const store = createStore('raw')

  expect(readSensitiveDataMode(store)).toBe('raw')
  expect(store.get).toHaveBeenCalledWith(SENSITIVE_DATA_MODE_KEY)
})

test('defaults to redacted mode when mode persistence is disabled', () => {
  const store = createStore('raw')

  expect(readSensitiveDataMode(store, false)).toBe(DEFAULT_SENSITIVE_DATA_MODE)
  writeSensitiveDataMode(store, 'raw', false)
  expect(store.set).toHaveBeenCalledWith(SENSITIVE_DATA_MODE_KEY, DEFAULT_SENSITIVE_DATA_MODE)
})

test('persists the selected raw or redacted mode only', () => {
  const store = createStore()

  writeSensitiveDataMode(store, 'raw')
  writeSensitiveDataMode(store, 'redacted')

  expect(store.set).toHaveBeenNthCalledWith(1, SENSITIVE_DATA_MODE_KEY, 'raw')
  expect(store.set).toHaveBeenNthCalledWith(2, SENSITIVE_DATA_MODE_KEY, 'redacted')
})
