'use strict';

const rawWarning = 'RAW: sensitive debug data. Keep it local.';

const sessionSchema = { type: 'string', minLength: 1, description: 'The sessionId returned by list_debug_sessions.' };
const commonQuery = {
  limit: { type: 'integer', minimum: 1, maximum: 1000 },
  cursor: { type: 'string' },
  since: { type: 'string', description: 'ISO-8601 timestamp or bridge event cursor, depending on the endpoint.' },
  maxResultBytes: { type: 'integer', minimum: 0, maximum: 1048576, description: 'Maximum total response payload bytes retained by the bridge. The bridge truncates remaining records when the limit is reached.' },
};
const maxValueBytesSchema = {
  type: 'integer',
  minimum: 0,
  maximum: 1048576,
  description: 'Maximum bytes retained for an individual serialized value. Values above the limit are truncated by the bridge.',
};
const bodyPreviewBytesSchema = {
  type: 'integer',
  minimum: 0,
  maximum: 262144,
  description: 'Maximum bytes returned for each request or response body preview.',
};

function withDefaults(args, defaults) {
  return { ...defaults, ...args };
}

function makeResult(payload) {
  const sensitiveDataMode = payload.sensitiveDataMode;
  if (sensitiveDataMode !== 'redacted' && sensitiveDataMode !== 'raw') throw new Error('Agent Bridge response is missing a valid sensitiveDataMode.');
  const result = { ...payload };
  if (sensitiveDataMode === 'raw') result.sensitiveDataWarning = rawWarning;
  return result;
}

function createToolRegistry(client) {
  const definitions = [
    { name: 'list_debug_sessions', description: 'List React Native Debugger sessions retained by the local bridge.', inputSchema: { type: 'object', properties: { ...commonQuery } }, call: (args) => client.listDebugSessions(withDefaults(args, { maxResultBytes: 32768 })) },
    { name: 'get_console_logs', description: 'Read structured console and uncaught-error records from one debug session. Compact output omits redundant value detail.', inputSchema: { type: 'object', required: ['sessionId'], properties: { sessionId: sessionSchema, level: { type: 'string', enum: ['debug', 'log', 'info', 'warn', 'error'] }, search: { type: 'string', description: 'Case-insensitive text search over rendered console content.' }, compact: { type: 'boolean', default: true }, maxValueBytes: { ...maxValueBytesSchema, default: 2048 }, ...commonQuery } }, call: (args) => client.getConsoleLogs(withDefaults(args, { compact: true, maxValueBytes: 2048, limit: 20, maxResultBytes: 32768 })) },
    { name: 'get_redux_state', description: 'Read the latest Redux state snapshot, or a subtree selected by path, for one debug session.', inputSchema: { type: 'object', required: ['sessionId'], properties: { sessionId: sessionSchema, path: { type: 'string', description: 'Optional JSON Pointer path to one state subtree, for example /cart/items.' }, maxValueBytes: { ...maxValueBytesSchema, default: 16384 }, maxResultBytes: { ...commonQuery.maxResultBytes, default: 32768 } } }, call: (args) => client.getReduxState(withDefaults(args, { maxValueBytes: 16384, maxResultBytes: 32768 })) },
    { name: 'get_redux_actions', description: 'Read captured Redux action/state-transition records. State snapshots are excluded unless explicitly requested.', inputSchema: { type: 'object', required: ['sessionId'], properties: { sessionId: sessionSchema, actionType: { type: 'string' }, includeState: { type: 'boolean', default: false }, compact: { type: 'boolean', default: true }, maxValueBytes: maxValueBytesSchema, ...commonQuery } }, call: (args) => client.getReduxActions(withDefaults(args, { includeState: false, compact: true, limit: 20, maxResultBytes: 32768 })) },
    { name: 'get_network_requests', description: 'Read compact fetch/XMLHttpRequest summaries for one debug session. Headers and bodies are excluded unless explicitly requested.', inputSchema: { type: 'object', required: ['sessionId'], properties: { sessionId: sessionSchema, method: { type: 'string' }, url: { type: 'string' }, status: { type: 'integer' }, includeHeaders: { type: 'boolean', default: false }, includeBodies: { type: 'boolean', default: false }, bodyPreviewBytes: bodyPreviewBytesSchema, ...commonQuery } }, call: (args) => client.getNetworkRequests(withDefaults(args, { includeHeaders: false, includeBodies: false, limit: 20, maxResultBytes: 32768 })) },
    { name: 'get_network_request', description: 'Read one captured network request. Headers and bounded request/response body previews are included by default.', inputSchema: { type: 'object', required: ['sessionId', 'requestId'], properties: { sessionId: sessionSchema, requestId: { type: 'string', minLength: 1 }, includeHeaders: { type: 'boolean', default: true }, includeRequestBody: { type: 'boolean', default: true }, includeResponseBody: { type: 'boolean', default: true }, bodyPreviewBytes: { ...bodyPreviewBytesSchema, default: 8192 }, maxResultBytes: { ...commonQuery.maxResultBytes, default: 32768 } } }, call: (args) => client.getNetworkRequest(withDefaults(args, { includeHeaders: true, includeRequestBody: true, includeResponseBody: true, bodyPreviewBytes: 8192, maxResultBytes: 32768 })) },
    { name: 'wait_for_debug_event', description: 'Long-poll for the next compact, projected debug event. This is read-only and times out after at most 30 seconds.', inputSchema: { type: 'object', required: ['sessionId'], properties: { sessionId: sessionSchema, eventTypes: { type: 'array', items: { type: 'string', enum: ['console', 'redux_action', 'redux_state', 'network'] } }, timeoutMs: { type: 'integer', minimum: 1, maximum: 30000 }, after: { type: 'integer', minimum: 0 }, compact: { type: 'boolean', default: true }, includeState: { type: 'boolean', default: false }, path: { type: 'string', description: 'Optional JSON Pointer path used when includeState=true and a redux_state event is returned.' }, includeHeaders: { type: 'boolean', default: false }, includeBodies: { type: 'boolean', default: false }, maxValueBytes: { ...maxValueBytesSchema, default: 2048 }, bodyPreviewBytes: { ...bodyPreviewBytesSchema, default: 4096 }, maxResultBytes: { ...commonQuery.maxResultBytes, default: 16384 } } }, call: (args) => client.waitForDebugEvent(withDefaults(args, { compact: true, includeState: false, includeHeaders: false, includeBodies: false, maxValueBytes: 2048, bodyPreviewBytes: 4096, maxResultBytes: 16384 })) },
  ];

  const byName = new Map(definitions.map((definition) => [definition.name, definition]));
  return {
    list: () => definitions.map(({ call, ...definition }) => definition),
    async call(name, args = {}) {
      const tool = byName.get(name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      const payload = await tool.call(args);
      return makeResult(payload);
    },
  };
}

module.exports = { createToolRegistry, makeResult, rawWarning };
