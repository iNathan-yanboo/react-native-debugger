#!/usr/bin/env node
'use strict';

const { getDiscoveryPath, loadDiscovery } = require('./discovery');
const { BridgeClient } = require('./bridge-client');
const { createToolRegistry } = require('./tools');
const { createMcpServer } = require('./mcp-server');

function main() {
  const discovery = loadDiscovery(getDiscoveryPath());
  const client = new BridgeClient({ ...discovery, fetchImpl: global.fetch.bind(global) });
  createMcpServer({ registry: createToolRegistry(client) });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`react-native-debugger-agent-mcp: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main };
