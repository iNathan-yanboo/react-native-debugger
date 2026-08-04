'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BridgeClient } = require('../src/bridge-client');

test('BridgeClient calls local bridge with token and skips empty query values', async () => {
  let captured;
  const client = new BridgeClient({
    bridgeUrl: 'http://127.0.0.1:43191/',
    token: 'bridge-token',
    fetchImpl: async (url, options) => {
      captured = { url: url.toString(), options };
      return new Response(JSON.stringify({ records: [] }), { status: 200 });
    },
  });
  const result = await client.getConsoleLogs({ sessionId: 'a/b', limit: 20, cursor: '', search: '', compact: true, maxValueBytes: 2048 });
  assert.deepEqual(result, { records: [] });
  assert.equal(captured.url, 'http://127.0.0.1:43191/v1/sessions/a%2Fb/logs?limit=20&compact=true&maxValueBytes=2048');
  assert.equal(captured.options.headers.Authorization, 'Bearer bridge-token');
});

test('BridgeClient forwards explicit body options but omits absent list filters', async () => {
  const urls = [];
  const client = new BridgeClient({
    bridgeUrl: 'http://127.0.0.1:43191',
    token: 't',
    fetchImpl: async (url) => {
      urls.push(url.toString());
      return new Response(JSON.stringify({ sensitiveDataMode: 'redacted' }), { status: 200 });
    },
  });
  await client.getNetworkRequests({ sessionId: 's1', includeHeaders: false, includeBodies: false, url: undefined, since: null });
  await client.getNetworkRequest({ sessionId: 's1', requestId: 'r1', includeHeaders: true, includeRequestBody: true, includeResponseBody: false, bodyPreviewBytes: 512 });
  assert.equal(urls[0], 'http://127.0.0.1:43191/v1/sessions/s1/network?includeHeaders=false&includeBodies=false');
  assert.equal(urls[1], 'http://127.0.0.1:43191/v1/sessions/s1/network/r1?includeHeaders=true&includeRequestBody=true&includeResponseBody=false&bodyPreviewBytes=512');
});

test('BridgeClient exposes bridge error payloads', async () => {
  const client = new BridgeClient({ bridgeUrl: 'http://127.0.0.1:43191', token: 't', fetchImpl: async () => new Response(JSON.stringify({ error: 'raw access is disabled' }), { status: 403 }) });
  await assert.rejects(client.listDebugSessions(), (error) => error.name === 'BridgeError' && error.statusCode === 403 && error.message === 'raw access is disabled');
});
