'use strict';

const fs = require('node:fs');
const path = require('node:path');

function getDiscoveryPath(argv = process.argv.slice(2), env = process.env) {
  const optionIndex = argv.indexOf('--discovery');
  if (optionIndex !== -1 && argv[optionIndex + 1]) return argv[optionIndex + 1];
  if (env.RNDEBUGGER_AGENT_DISCOVERY) return env.RNDEBUGGER_AGENT_DISCOVERY;
  return path.join(env.HOME || env.USERPROFILE || '.', '.react-native-debugger', 'agent-bridge.json');
}

function validateBridgeUrl(bridgeUrl) {
  let parsed;
  try {
    parsed = new URL(bridgeUrl);
  } catch (_) {
    throw new Error('Discovery file contains an invalid origin.');
  }

  const localHosts = new Set(['127.0.0.1', '::1', 'localhost']);
  if (parsed.protocol !== 'http:' || !localHosts.has(parsed.hostname)) {
    throw new Error('Agent Bridge must use an http:// loopback URL.');
  }
  return parsed.toString().replace(/\/$/, '');
}

function loadDiscovery(discoveryPath) {
  let raw;
  try {
    raw = fs.readFileSync(discoveryPath, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read Agent Bridge discovery file at ${discoveryPath}: ${error.message}`);
  }

  let discovery;
  try {
    discovery = JSON.parse(raw);
  } catch (_) {
    throw new Error(`Agent Bridge discovery file at ${discoveryPath} is not valid JSON.`);
  }

  if (!discovery || discovery.version !== 1 || typeof discovery.token !== 'string' || !discovery.token) {
    throw new Error('Agent Bridge discovery file must contain version: 1 and a non-empty token.');
  }

  return {
    bridgeUrl: validateBridgeUrl(discovery.origin),
    token: discovery.token,
    discoveryPath,
  };
}

module.exports = { getDiscoveryPath, loadDiscovery, validateBridgeUrl };
