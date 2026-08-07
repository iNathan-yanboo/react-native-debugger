'use strict';

function createBridgeError(message, statusCode, details) {
  const error = new Error(message)
  error.name = 'BridgeError'
  error.statusCode = statusCode
  error.details = details
  return error
}

function addQuery(url, params = {}) {
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  return url;
}

class BridgeClient {
  constructor({ bridgeUrl, token, fetchImpl }) {
    if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required (Node.js 18 or newer).');
    this.bridgeUrl = bridgeUrl.replace(/\/$/, '');
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async request(pathname, params, pathParameterNames = [], method = 'GET') {
    const query = Object.fromEntries(Object.entries(params || {}).filter(([key]) => !pathParameterNames.includes(key)));
    const url = method === 'GET'
      ? addQuery(new URL(`${this.bridgeUrl}${pathname}`), query)
      : new URL(`${this.bridgeUrl}${pathname}`);
    let response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.token}`,
          ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
        },
        method,
        ...(method !== 'GET' ? { body: JSON.stringify(query) } : {}),
      });
    } catch (error) {
      throw createBridgeError(`Unable to reach React Native Debugger Agent Bridge: ${error.message}`)
    }

    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch (_) {
      throw createBridgeError('Agent Bridge returned a non-JSON response.', response.status, text.slice(0, 512))
    }
    if (!response.ok) throw createBridgeError(body.error || `Agent Bridge request failed (${response.status}).`, response.status, body)
    return body;
  }

  listDebugSessions(args = {}) { return this.request('/v1/sessions', args) }

  getConsoleLogs(args) { return this.request(`/v1/sessions/${encodeURIComponent(args.sessionId)}/logs`, args, ['sessionId']) }

  getReduxState(args) { return this.request(`/v1/sessions/${encodeURIComponent(args.sessionId)}/redux/state`, args, ['sessionId']) }

  getReduxActions(args) { return this.request(`/v1/sessions/${encodeURIComponent(args.sessionId)}/redux/actions`, args, ['sessionId']) }

  getNetworkRequests(args) { return this.request(`/v1/sessions/${encodeURIComponent(args.sessionId)}/network`, args, ['sessionId']) }

  getNetworkRequest(args) { return this.request(`/v1/sessions/${encodeURIComponent(args.sessionId)}/network/${encodeURIComponent(args.requestId)}`, args, ['sessionId', 'requestId']) }

  waitForDebugEvent(args) { return this.request(`/v1/sessions/${encodeURIComponent(args.sessionId)}/events`, { ...args, limit: 1 }, ['sessionId']) }

  listNetworkMocks(args = {}) { return this.request('/v1/network-mocks', args) }

  saveNetworkMock(args) { return this.request('/v1/network-mocks', args, [], 'POST') }

  setNetworkMockEnabled(args) {
    return this.request(`/v1/network-mocks/${encodeURIComponent(args.id)}/enabled`, args, ['id'], 'POST')
  }

  removeNetworkMock(args) {
    return this.request(`/v1/network-mocks/${encodeURIComponent(args.id)}`, args, ['id'], 'DELETE')
  }
}

module.exports = { BridgeClient, createBridgeError, addQuery };
