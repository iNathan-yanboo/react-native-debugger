import { REDACTED_VALUE, redactValue } from '../redaction'

test('redacts nested values, serialized JSON, headers, and query parameters', () => {
  const input = {
    headers: {
      Authorization: 'Bearer secret',
      Accept: 'application/json',
    },
    url: 'https://example.test/orders?access_token=secret&store=1',
    serialized: JSON.stringify({
      user: { password: 'secret', name: 'tester' },
    }),
  }

  expect(redactValue(input)).toEqual({
    headers: {
      Authorization: REDACTED_VALUE,
      Accept: 'application/json',
    },
    url: 'https://example.test/orders?access_token=[REDACTED]&store=1',
    serialized: JSON.stringify({
      user: { password: REDACTED_VALUE, name: 'tester' },
    }),
  })
})

test('handles circular values without throwing', () => {
  const value = { token: 'secret' }
  value.self = value

  expect(redactValue(value)).toEqual({
    token: REDACTED_VALUE,
    self: '[Circular]',
  })
})
