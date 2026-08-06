import crypto from 'crypto'
import http from 'http'
import { openNetworkMockManager } from './network-mock-manager'

const MAX_DRAFT_BYTES = 2 * 1024 * 1024
const REGISTER_RETRY_INTERVAL_MS = 250
const REGISTER_RETRY_COUNT = 20
const registeredWindows = new WeakSet()
const bridges = new WeakMap()

const createToken = () => crypto.randomBytes(24).toString('hex')
const wait = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds)
})

const tryRegisterDevtoolsMenu = async (win, script, attempt = 0) => {
  let result
  try {
    result = await win.devToolsWebContents.executeJavaScript(script)
    if (result && result.registered) return { result, error: null }
  } catch (error) {
    if (attempt + 1 >= REGISTER_RETRY_COUNT) return { result, error }
  }
  if (attempt + 1 >= REGISTER_RETRY_COUNT) return { result, error: null }
  await wait(REGISTER_RETRY_INTERVAL_MS)
  return tryRegisterDevtoolsMenu(win, script, attempt + 1)
}

const sendJson = (response, status, payload) => {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  })
  response.end(JSON.stringify(payload))
}

const readBody = (request) => new Promise((resolve, reject) => {
  let size = 0
  const chunks = []
  request.on('data', (chunk) => {
    size += chunk.length
    if (size > MAX_DRAFT_BYTES) {
      reject(new Error('Network mock draft is too large'))
      request.destroy()
      return
    }
    chunks.push(chunk)
  })
  request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  request.on('error', reject)
})

const normalizeHeaders = (headers) => {
  if (Array.isArray(headers)) {
    return headers.reduce((result, header) => ({ ...result, [header.name]: header.value }), {})
  }
  if (headers && typeof headers === 'object') return headers
  return {}
}

const normalizeDraft = (draft = {}) => ({
  url: String(draft.url || ''),
  method: String(draft.method || 'GET').toUpperCase(),
  status: Number.isFinite(Number(draft.status)) ? Number(draft.status) : 200,
  statusText: String(draft.statusText || 'OK'),
  requestHeaders: normalizeHeaders(draft.requestHeaders),
  requestBody: typeof draft.requestBody === 'undefined' ? '' : draft.requestBody,
  headers: normalizeHeaders(draft.responseHeaders),
  body: typeof draft.body === 'undefined' ? '' : draft.body,
  enabled: true,
})

const startBridge = (win) => new Promise((resolve, reject) => {
  const token = createToken()
  const path = `/network-mock/${token}`
  const server = http.createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      })
      response.end()
      return
    }
    if (request.method !== 'POST' || request.url !== path) {
      sendJson(response, 404, { error: 'Not found' })
      return
    }
    try {
      const payload = JSON.parse(await readBody(request))
      const draft = normalizeDraft(payload)
      if (!draft.url) throw new Error('Mock URL is required')
      openNetworkMockManager(win, draft)
      sendJson(response, 200, { ok: true })
    } catch (error) {
      sendJson(response, 400, { error: error.message || 'Invalid mock draft' })
    }
  })
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    resolve({
      endpoint: `http://127.0.0.1:${port}${path}`,
      close: () => server.close(),
    })
  })
})

const createActionScript = (endpoint) => `(async () => {
  const NetworkModule = await import('./panels/network/network.js');
  const NetworkLogView = NetworkModule.NetworkLogView && NetworkModule.NetworkLogView.NetworkLogView;
  if (!NetworkLogView || typeof NetworkLogView.prototype.handleContextMenuForRequest !== 'function') {
    return { registered: false, reason: 'Network request context-menu API unavailable' };
  }
  const value = (request, key) => typeof request[key] === 'function' ? request[key]() : request[key];
  const resolvedValue = async (request, key) => Promise.resolve(value(request, key));
  const headers = (request, key) => value(request, key) || [];
  const textFromContent = (content) => {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return textFromContent(content[0]);
    if (!content || typeof content !== 'object') return '';
    // Chromium has used all of these shapes across its DevTools frontend
    // versions. Keep the mock integration compatible with bundled Electron.
    if (typeof content.content === 'string') return content.content;
    if (typeof content.text === 'string') return content.text;
    if (typeof content.data === 'string') return content.data;
    return '';
  };
  const safeRead = async (request, key) => {
    try { return await resolvedValue(request, key); } catch (error) { return null; }
  };
  const readDraft = async (request) => {
    if (!request) return null;
    const requestContent = await safeRead(request, 'requestContentData')
      || await safeRead(request, 'requestContent');
    const requestBody = await safeRead(request, 'requestFormData')
      || await safeRead(request, 'postData')
      || await safeRead(request, 'requestBody');
    const body = textFromContent(requestContent);
    return {
      url: value(request, 'url') || value(request, 'urlInternal') || '',
      method: value(request, 'requestMethod') || value(request, 'method') || 'GET',
      status: value(request, 'statusCode') || 200,
      statusText: value(request, 'statusText') || 'OK',
      requestHeaders: headers(request, 'requestHeaders'),
      requestBody: textFromContent(requestBody),
      responseHeaders: headers(request, 'responseHeaders'),
      body,
    };
  };
  const openManager = async (request) => {
      const draft = await readDraft(request);
      if (!draft || !draft.url) return false;
      const response = await fetch(${JSON.stringify(endpoint)}, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      return response.ok;
  };
  const networkLogViewPrototype = NetworkLogView.prototype;
  if (networkLogViewPrototype.__reactNativeDebuggerNetworkMockPatched) {
    return { registered: true, reused: true };
  }
  const originalHandleContextMenuForRequest = networkLogViewPrototype.handleContextMenuForRequest;
  networkLogViewPrototype.handleContextMenuForRequest = function(contextMenu, request) {
    const result = originalHandleContextMenuForRequest.call(this, contextMenu, request);
    if (request && contextMenu && typeof contextMenu.footerSection === 'function') {
      contextMenu.footerSection().appendItem(
        'Mock selected Network request',
        () => openManager(request).catch((error) => {
          console.warn('[RNDebugger] Failed to open Network Mock manager:', error);
        }),
      );
    }
    return result;
  }
  networkLogViewPrototype.__reactNativeDebuggerNetworkMockPatched = true;
  return { registered: true };
})()`

export const registerNetworkMockDevtoolsMenu = async (win) => {
  if (!win.devToolsWebContents || registeredWindows.has(win)) return
  registeredWindows.add(win)
  try {
    const bridge = await startBridge(win)
    bridges.set(win, bridge)
    const { result, error } = await tryRegisterDevtoolsMenu(
      win,
      createActionScript(bridge.endpoint),
    )
    if (result && result.registered) return
    console.warn(
      '[RNDebugger] Network Mock DevTools action unavailable:',
      error || (result && result.reason),
    )
  } catch (error) {
    console.warn('[RNDebugger] Failed to register Network Mock DevTools action:', error)
  }
}

export const unregisterNetworkMockDevtoolsMenu = (win) => {
  const bridge = bridges.get(win)
  if (bridge) bridge.close()
  bridges.delete(win)
}
