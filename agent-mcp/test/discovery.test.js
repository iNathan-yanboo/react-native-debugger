'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateBridgeUrl, getDiscoveryPath, loadDiscovery } = require('../src/discovery');

test('only accepts loopback http bridges', () => {
  assert.equal(validateBridgeUrl('http://127.0.0.1:43191/'), 'http://127.0.0.1:43191');
  assert.throws(() => validateBridgeUrl('https://example.com'), /loopback/);
  assert.throws(() => validateBridgeUrl('http://192.168.1.5:43191'), /loopback/);
});

test('discovery path supports explicit flag and environment', () => {
  assert.equal(getDiscoveryPath(['--discovery', '/tmp/bridge.json'], {}), '/tmp/bridge.json');
  assert.equal(getDiscoveryPath([], { RNDEBUGGER_AGENT_DISCOVERY: '/tmp/env.json' }), '/tmp/env.json');
});

test('loads the documented discovery contract', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rndebugger-agent-mcp-'));
  const discoveryPath = path.join(directory, 'agent-bridge.json');
  fs.writeFileSync(discoveryPath, JSON.stringify({ version: 1, origin: 'http://127.0.0.1:43191', token: 'one-time-token' }));
  assert.deepEqual(loadDiscovery(discoveryPath), { bridgeUrl: 'http://127.0.0.1:43191', token: 'one-time-token', discoveryPath });
  fs.rmSync(directory, { recursive: true });
});
