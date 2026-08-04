'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMcpServer } = require('../src/mcp-server');
const { createToolRegistry } = require('../src/tools');

test('MCP server exposes tools and marks raw result as sensitive', async () => {
  const registry = createToolRegistry({ listDebugSessions: async () => ({ sessions: [], sensitiveDataMode: 'raw' }) });
  const server = createMcpServer({ registry, input: new (require('node:stream').PassThrough)(), output: new (require('node:stream').PassThrough)() });
  const listing = await server.dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(listing.result.tools.length, 7);
  const response = await server.dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_debug_sessions', arguments: {} } });
  assert.equal(response.result.structuredContent.sensitiveDataMode, 'raw');
  assert.match(response.result.structuredContent.sensitiveDataWarning, /^RAW:/);
  assert.match(response.result.content[0].text, /^\{"sensitiveDataMode":"raw"/);
  server.close();
});

test('tool registry applies token-efficient defaults before calling the bridge', async () => {
  const received = {};
  const registry = createToolRegistry({
    listDebugSessions: async (args) => { received.sessions = args; return { sensitiveDataMode: 'redacted' }; },
    getConsoleLogs: async (args) => { received.console = args; return { sensitiveDataMode: 'redacted' }; },
    getReduxActions: async (args) => { received.actions = args; return { sensitiveDataMode: 'redacted' }; },
    getNetworkRequests: async (args) => { received.networkList = args; return { sensitiveDataMode: 'redacted' }; },
    getNetworkRequest: async (args) => { received.networkDetail = args; return { sensitiveDataMode: 'redacted' }; },
    getReduxState: async (args) => { received.state = args; return { sensitiveDataMode: 'redacted' }; },
    waitForDebugEvent: async (args) => { received.wait = args; return { sensitiveDataMode: 'redacted' }; },
  });
  await registry.call('list_debug_sessions', {});
  await registry.call('get_console_logs', { sessionId: 's' });
  await registry.call('get_redux_actions', { sessionId: 's' });
  await registry.call('get_network_requests', { sessionId: 's' });
  await registry.call('get_network_request', { sessionId: 's', requestId: 'r' });
  await registry.call('get_redux_state', { sessionId: 's' });
  await registry.call('wait_for_debug_event', { sessionId: 's' });
  assert.deepEqual(received.sessions, { maxResultBytes: 32768 });
  assert.deepEqual(received.console, { sessionId: 's', compact: true, maxValueBytes: 2048, limit: 20, maxResultBytes: 32768 });
  assert.deepEqual(received.actions, { sessionId: 's', includeState: false, compact: true, limit: 20, maxResultBytes: 32768 });
  assert.deepEqual(received.networkList, { sessionId: 's', includeHeaders: false, includeBodies: false, limit: 20, maxResultBytes: 32768 });
  assert.deepEqual(received.networkDetail, { sessionId: 's', requestId: 'r', includeHeaders: true, includeRequestBody: true, includeResponseBody: true, bodyPreviewBytes: 8192, maxResultBytes: 32768 });
  assert.deepEqual(received.state, { sessionId: 's', maxValueBytes: 16384, maxResultBytes: 32768 });
  assert.deepEqual(received.wait, { sessionId: 's', compact: true, includeState: false, includeHeaders: false, includeBodies: false, maxValueBytes: 2048, bodyPreviewBytes: 4096, maxResultBytes: 16384 });
});

test('tool schemas expose token-efficient options to MCP clients', () => {
  const registry = createToolRegistry({});
  const byName = Object.fromEntries(registry.list().map((tool) => [tool.name, tool]));
  assert.equal(byName.get_console_logs.inputSchema.properties.compact.default, true);
  assert.equal(byName.get_console_logs.inputSchema.properties.maxValueBytes.default, 2048);
  assert.ok(byName.get_console_logs.inputSchema.properties.search);
  assert.ok(byName.get_redux_state.inputSchema.properties.path);
  assert.equal(byName.get_redux_actions.inputSchema.properties.includeState.default, false);
  assert.equal(byName.get_network_requests.inputSchema.properties.includeBodies.default, false);
  assert.equal(byName.get_network_request.inputSchema.properties.includeResponseBody.default, true);
  assert.equal(byName.get_console_logs.inputSchema.properties.maxResultBytes.maximum, 1048576);
  assert.equal(byName.get_redux_state.inputSchema.properties.maxValueBytes.default, 16384);
  assert.equal(byName.get_redux_state.inputSchema.properties.maxResultBytes.maximum, 1048576);
  assert.equal(byName.get_redux_state.inputSchema.properties.maxResultBytes.default, 32768);
  assert.equal(byName.get_network_request.inputSchema.properties.bodyPreviewBytes.default, 8192);
  assert.equal(byName.wait_for_debug_event.inputSchema.properties.maxResultBytes.default, 16384);
  assert.ok(byName.wait_for_debug_event.inputSchema.properties.eventTypes.items.enum.includes('redux_state'));
  assert.ok(byName.wait_for_debug_event.inputSchema.properties.path);
});

test('MCP tool response carries a large payload only in structuredContent', async () => {
  const largeValue = 'large-payload-marker-'.repeat(8192);
  const registry = createToolRegistry({
    getConsoleLogs: async () => ({ sensitiveDataMode: 'raw', records: [{ value: largeValue }] }),
  });
  const server = createMcpServer({ registry, input: new (require('node:stream').PassThrough)(), output: new (require('node:stream').PassThrough)() });
  const response = await server.dispatch({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_console_logs', arguments: { sessionId: 's' } } });
  const serialized = JSON.stringify(response);
  assert.equal(serialized.split(largeValue).length - 1, 1);
  assert.ok(response.result.content[0].text.length < 200);
  assert.match(response.result.content[0].text, /RAW:/);
  server.close();
});
