import { BrowserWindow } from 'electron'

let manager

const html = `<!doctype html>
<meta charset="utf-8">
<title>Network Mock Manager</title>
<style>
  :root { color: #1e293b; background: #f7f8fb; font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; min-width: 840px; background: #f7f8fb; }
  button, input, select, textarea { font: inherit; }
  button { border: 1px solid #d7dce5; border-radius: 7px; padding: 7px 11px; background: #fff; color: #334155; cursor: pointer; }
  button:hover { background: #f4f7ff; border-color: #9db7f9; }
  button.primary { color: #fff; border-color: #2563eb; background: #2563eb; font-weight: 600; }
  button.primary:hover { background: #1d4ed8; }
  button.danger { color: #dc2626; border-color: #fecaca; }
  #app { min-height: 100vh; display: grid; grid-template-columns: 300px minmax(0, 1fr); }
  aside { background: #fff; border-right: 1px solid #e3e7ee; display: flex; flex-direction: column; min-height: 100vh; }
  .sidebar-head, .topbar { min-height: 72px; display: flex; align-items: center; padding: 16px 18px; border-bottom: 1px solid #e8ebf1; }
  .sidebar-head { gap: 9px; }
  .sidebar-head h1 { margin: 0; font-size: 16px; letter-spacing: -.2px; }
  .count { color: #64748b; background: #f1f5f9; border-radius: 999px; padding: 3px 8px; font-size: 11px; }
  #new { margin-left: auto; }
  #list { margin: 0; padding: 8px; list-style: none; overflow: auto; }
  .rule { border: 1px solid transparent; border-radius: 8px; padding: 10px; margin-bottom: 3px; cursor: pointer; }
  .rule:hover { background: #f8fafc; }
  .rule.selected { background: #eff6ff; border-color: #bfdbfe; }
  .rule-top { display: flex; align-items: center; gap: 7px; }
  .method { min-width: 42px; text-align: center; padding: 2px 5px; border-radius: 4px; background: #e0edff; color: #2563eb; font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
  .method.POST { color: #15803d; background: #dcfce7; }.method.PUT { color: #b45309; background: #ffedd5; }.method.DELETE { color: #dc2626; background: #fee2e2; }.method.PATCH { color: #7c3aed; background: #ede9fe; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #94a3b8; }.dot.on { background: #22c55e; }
  .rule-url { margin-top: 6px; color: #64748b; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
  .empty-list { padding: 44px 16px; text-align: center; color: #94a3b8; line-height: 1.65; }
  main { min-width: 0; padding-bottom: 78px; }
  .topbar { justify-content: space-between; background: rgba(255,255,255,.8); }
  .topbar h2 { margin: 0; font-size: 16px; }.hint { color: #94a3b8; font-size: 12px; }
  form { max-width: 1180px; padding: 22px 28px; margin: auto; }
  .section { margin-bottom: 18px; }.section-title { display: flex; align-items: center; justify-content: space-between; margin-bottom: 9px; font-weight: 650; color: #334155; }.section-title span { color: #94a3b8; font-weight: 400; font-size: 12px; }
  .config { display: grid; grid-template-columns: 110px 120px minmax(200px, 1fr) 125px; gap: 10px; }
  .field { display: flex; flex-direction: column; gap: 6px; color: #64748b; font-size: 12px; }.field.wide { grid-column: span 2; }
  input, select, textarea { width: 100%; border: 1px solid #d9dee8; border-radius: 7px; background: #fff; color: #1e293b; padding: 8px 9px; outline: none; }
  input:focus, select:focus, textarea:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px rgba(59,130,246,.12); }
  textarea { min-height: 126px; resize: vertical; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.5; }
  .switches { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .mock-box { border: 1px solid #e0e5ed; border-radius: 9px; padding: 12px; background: #fff; }.mock-box.off { opacity: .58; background: #fafbfd; }
  .mock-title { display: flex; align-items: center; justify-content: space-between; margin-bottom: 9px; font-weight: 600; }.mock-title small { color: #94a3b8; font-weight: 400; }
  .toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #475569; cursor: pointer; }.toggle input { width: 14px; height: 14px; accent-color: #2563eb; }
  details { border: 1px solid #e0e5ed; border-radius: 9px; background: #fff; padding: 0 13px 12px; } summary { padding: 12px 0; cursor: pointer; font-weight: 600; }.evidence { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }.readonly { background: #f8fafc; color: #64748b; }
  .delay { display: flex; align-items: end; gap: 10px; }.delay .field { max-width: 180px; }.delay p { margin: 0 0 9px; color: #94a3b8; font-size: 12px; }
  .footer { position: fixed; bottom: 0; right: 0; left: 300px; height: 64px; padding: 12px 28px; background: rgba(255,255,255,.93); border-top: 1px solid #e5e9f0; display: flex; justify-content: flex-end; gap: 8px; backdrop-filter: blur(9px); }
  @media (max-width: 900px) { #app { grid-template-columns: 230px minmax(0,1fr); }.footer { left: 230px; }.config, .switches, .evidence { grid-template-columns: 1fr; }.field.wide { grid-column: auto; } }
</style>
<div id="app">
  <aside><div class="sidebar-head"><h1>网络 Mock</h1><span class="count" id="count">0 条规则</span><button class="primary" id="new">新建规则</button></div><ul id="list"></ul></aside>
  <main><div class="topbar"><div><h2 id="title">新建 Mock 规则</h2><div class="hint">支持精确 URL 或正则 URL，并按请求方法命中</div></div><button class="danger" id="delete" hidden>删除规则</button></div>
    <form id="form"><input id="id" type="hidden">
      <section class="section"><div class="section-title">规则配置</div><div class="config">
        <label class="field">请求方法<select id="method"><option value="">任意</option><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select></label>
        <label class="field">URL 匹配<select id="urlMatchType"><option value="exact">精确匹配</option><option value="regex">正则匹配</option></select></label>
        <label class="field">URL<input id="url" required placeholder="https://api.example.com/v1/users"></label>
        <label class="field">状态码<input id="status" type="number" value="200"></label>
      </div></section>
      <section class="section"><div class="section-title">请求 Mock <span>仅在不 Mock 响应时会发送到真实服务</span></div><div class="switches">
        <div class="mock-box" data-box="mockRequestHeadersEnabled"><div class="mock-title">请求头 <label class="toggle"><input id="mockRequestHeadersEnabled" type="checkbox">启用</label></div><textarea id="mockRequestHeaders" placeholder='{"authorization":"Bearer mock-token"}'></textarea></div>
        <div class="mock-box" data-box="mockRequestBodyEnabled"><div class="mock-title">请求正文 <label class="toggle"><input id="mockRequestBodyEnabled" type="checkbox">启用</label></div><textarea id="mockRequestBody" placeholder='{"example":"mock request body"}'></textarea></div>
      </div></section>
      <section class="section"><div class="section-title">响应 Mock <label class="toggle"><input id="mixedResponseEnabled" type="checkbox">混合响应（真实请求后覆盖已启用项）</label></div><div class="switches">
        <div class="mock-box" data-box="mockResponseHeadersEnabled"><div class="mock-title">响应头 <label class="toggle"><input id="mockResponseHeadersEnabled" type="checkbox" checked>启用</label></div><textarea id="headers" placeholder='{"content-type":"application/json"}'>{}</textarea></div>
        <div class="mock-box" data-box="mockResponseBodyEnabled"><div class="mock-title">响应正文 <label class="toggle"><input id="mockResponseBodyEnabled" type="checkbox" checked>启用</label></div><textarea id="body" placeholder='{"code":0,"data":{}}'></textarea></div>
      </div></section>
      <section class="section delay"><label class="field">响应延迟（毫秒）<input id="delayMs" type="number" min="0" value="0"></label><p>用于模拟慢接口；请求 Mock 且不 Mock 响应时，会延迟发出真实请求。</p></section>
      <section class="section"><details><summary>原始请求证据（只读）</summary><div class="evidence"><label class="field">原始请求头<textarea id="originalRequestHeaders" class="readonly" readonly></textarea></label><label class="field">原始请求正文<textarea id="originalRequestBody" class="readonly" readonly></textarea></label></div></details></section>
      <label class="toggle"><input id="enabled" type="checkbox" checked> 启用此规则</label>
    </form>
  </main>
</div>
<div class="footer"><button id="cancel">取消</button><button class="primary" id="save">保存规则</button></div>
<script>
  const { ipcRenderer } = require('electron')
  const $ = id => document.getElementById(id)
  let rules = []
  const text = value => typeof value === 'string' ? value : JSON.stringify(value || {}, null, 2)
  const empty = () => ({ id: '', url: '', urlMatchType: 'exact', method: '', status: 200, enabled: true, headers: {}, body: '', delayMs: 0, mockRequestHeaders: {}, mockRequestBody: '', mockRequestHeadersEnabled: false, mockRequestBodyEnabled: false, mockResponseHeadersEnabled: true, mockResponseBodyEnabled: true, mixedResponseEnabled: false, originalRequestHeaders: {}, originalRequestBody: '' })
  const updateBoxes = () => ['mockRequestHeadersEnabled','mockRequestBodyEnabled','mockResponseHeadersEnabled','mockResponseBodyEnabled'].forEach(id => $(id).closest('.mock-box').classList.toggle('off', !$(id).checked))
  const show = rule => {
    const value = rule || empty()
    $('id').value = value.id || ''; $('url').value = value.url || ''; $('urlMatchType').value = value.urlMatchType || 'exact'; $('method').value = value.method || ''; $('status').value = value.status || 200; $('delayMs').value = value.delayMs || 0
    $('mockRequestHeaders').value = text(value.mockRequestHeaders); $('mockRequestBody').value = text(value.mockRequestBody || '')
    $('headers').value = text(value.headers); $('body').value = text(value.body || '')
    $('originalRequestHeaders').value = text(value.originalRequestHeaders || value.requestHeaders); $('originalRequestBody').value = text(value.originalRequestBody || value.requestBody || '')
    $('mockRequestHeadersEnabled').checked = value.mockRequestHeadersEnabled === true; $('mockRequestBodyEnabled').checked = value.mockRequestBodyEnabled === true
    $('mockResponseHeadersEnabled').checked = value.mockResponseHeadersEnabled !== false; $('mockResponseBodyEnabled').checked = value.mockResponseBodyEnabled !== false; $('mixedResponseEnabled').checked = value.mixedResponseEnabled === true; $('enabled').checked = value.enabled !== false
    $('title').textContent = value.id ? '编辑 Mock 规则' : '新建 Mock 规则'; $('delete').hidden = !value.id; updateBoxes()
  }
  const render = async () => {
    rules = await ipcRenderer.invoke('network-mock-list'); $('count').textContent = rules.length + ' 条规则'; $('list').innerHTML = ''
    if (!rules.length) { $('list').innerHTML = '<li class="empty-list">还没有 Mock 规则<br>从 Network 右键创建，或点击新建规则。</li>'; return }
    const selectedId = $('id').value
    rules.forEach(rule => { const li = document.createElement('li'); li.className = 'rule' + (rule.id === selectedId ? ' selected' : ''); li.onclick = () => show(rule)
      const top = document.createElement('div'); top.className = 'rule-top'; const dot = document.createElement('i'); dot.className = 'dot' + (rule.enabled ? ' on' : ''); const method = document.createElement('b'); method.className = 'method ' + (rule.method || 'GET'); method.textContent = rule.method || '*'; const status = document.createElement('span'); status.textContent = rule.enabled ? '启用' : '禁用'; top.append(dot, method, status)
      const url = document.createElement('div'); url.className = 'rule-url'; url.textContent = rule.url; li.append(top, url); $('list').append(li) })
  }
  const parseHeaders = (id, label) => { try { const value = JSON.parse($(id).value || '{}'); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value } catch (error) { throw new Error(label + '必须是 JSON 对象') } }
  const parseBody = id => { try { return JSON.parse($(id).value) } catch (error) { return $(id).value } }
  const save = async () => { try {
    const id = $('id').value.trim()
    const saved = await ipcRenderer.invoke('network-mock-save', { id: id || undefined, url: $('url').value, urlMatchType: $('urlMatchType').value, method: $('method').value, status: $('status').value, enabled: $('enabled').checked, delayMs: $('delayMs').value,
      mockRequestHeadersEnabled: $('mockRequestHeadersEnabled').checked, mockRequestHeaders: parseHeaders('mockRequestHeaders', '请求头'), mockRequestBodyEnabled: $('mockRequestBodyEnabled').checked, mockRequestBody: parseBody('mockRequestBody'),
      mockResponseHeadersEnabled: $('mockResponseHeadersEnabled').checked, mockResponseBodyEnabled: $('mockResponseBodyEnabled').checked, mixedResponseEnabled: $('mixedResponseEnabled').checked, headers: parseHeaders('headers', '响应头'), body: parseBody('body'),
      originalRequestHeaders: parseHeaders('originalRequestHeaders', '原始请求头'), originalRequestBody: $('originalRequestBody').value,
    }); await render(); show(saved)
  } catch (error) { alert(error.message || '保存失败') } }
  $('new').onclick = () => show(); $('cancel').onclick = () => show(); $('save').onclick = save; $('form').onsubmit = event => { event.preventDefault(); save() }; $('delete').onclick = async () => { if ($('id').value && confirm('删除此 Mock 规则？')) { await ipcRenderer.invoke('network-mock-delete', $('id').value); show(); render() } }
  ;['mockRequestHeadersEnabled','mockRequestBodyEnabled','mockResponseHeadersEnabled','mockResponseBodyEnabled'].forEach(id => $(id).onchange = updateBoxes)
  ipcRenderer.on('network-mock-edit', (event, draft) => show(draft)); show(); render()
</script>`

export const openNetworkMockManager = (parent, draft) => {
  if (manager && !manager.isDestroyed()) {
    manager.show()
    manager.focus()
    if (draft) manager.webContents.send('network-mock-edit', draft)
    return manager
  }
  manager = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    parent,
    title: 'Network Mock Manager',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  })
  manager.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  manager.webContents.once('did-finish-load', () => {
    if (draft) manager.webContents.send('network-mock-edit', draft)
  })
  manager.on('closed', () => { manager = null })
  return manager
}
