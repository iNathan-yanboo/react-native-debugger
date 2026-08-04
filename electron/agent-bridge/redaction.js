const REDACTED_VALUE = '[REDACTED]'
const SENSITIVE_KEY = /authorization|proxy-authorization|cookie|set-cookie|token|password|secret|api[-_]?key|session|code/i

const redactUrl = (value) => value.replace(
  /([?&](?:token|access_token|refresh_token|password|secret|code|session)=[^&#]*)/gi,
  (match) => `${match.slice(0, match.indexOf('=') + 1)}${REDACTED_VALUE}`,
)

export function redactValue(value, seen = new WeakSet()) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if ((trimmed.startsWith('{') && trimmed.endsWith('}'))
      || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return JSON.stringify(redactValue(JSON.parse(value), seen))
      } catch (error) {
        // Keep non-JSON strings readable and apply URL/query redaction below.
      }
    }
    return redactUrl(value)
  }
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen))
  return Object.keys(value).reduce((result, key) => ({
    ...result,
    [key]: SENSITIVE_KEY.test(key) ? REDACTED_VALUE : redactValue(value[key], seen),
  }), {})
}

export { REDACTED_VALUE }
