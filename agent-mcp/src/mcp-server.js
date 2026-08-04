'use strict';

const readline = require('node:readline');

function toMcpToolResult(data) {
  const textSummary = {
    sensitiveDataMode: data.sensitiveDataMode,
    note: 'Full result is available in structuredContent.',
  };
  if (data.sensitiveDataWarning) textSummary.warning = data.sensitiveDataWarning;
  return {
    content: [{ type: 'text', text: JSON.stringify(textSummary) }],
    structuredContent: data,
  };
}

function jsonRpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function createMcpServer({ registry, input = process.stdin, output = process.stdout, serverInfo = { name: 'react-native-debugger-agent-mcp', version: '0.1.0' } }) {
  async function dispatch(request) {
    if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      return jsonRpcError(request && request.id, -32600, 'Invalid JSON-RPC request.');
    }

    const { id, method, params = {} } = request;
    try {
      if (method === 'initialize') {
        return { jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo } };
      }
      if (method === 'notifications/initialized') return null;
      if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: registry.list() } };
      if (method === 'tools/call') {
        if (typeof params.name !== 'string') return jsonRpcError(id, -32602, 'tools/call requires a tool name.');
        const data = await registry.call(params.name, params.arguments || {});
        return { jsonrpc: '2.0', id, result: toMcpToolResult(data) };
      }
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
    } catch (error) {
      return jsonRpcError(id, -32000, error.message, error.details);
    }
  }

  const lineReader = readline.createInterface({ input, crlfDelay: Infinity });
  lineReader.on('line', async (line) => {
    let request;
    try {
      request = JSON.parse(line);
    } catch (_) {
      output.write(`${JSON.stringify(jsonRpcError(null, -32700, 'Parse error.'))}\n`);
      return;
    }
    const response = await dispatch(request);
    if (response && request.id !== undefined) output.write(`${JSON.stringify(response)}\n`);
  });
  return { dispatch, close: () => lineReader.close() };
}

module.exports = { createMcpServer, toMcpToolResult };
