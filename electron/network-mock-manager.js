import { BrowserWindow } from 'electron'

let manager

const html = `<!doctype html>
<meta charset="utf-8">
<title>Network Mock Manager</title>
<style>
  :root { color: #1e293b; background: #f7f8fb; font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; min-width: 840px; height: 100vh; overflow: hidden; background: #f7f8fb; }
  button, input, select, textarea { font: inherit; }
  button { border: 1px solid #d7dce5; border-radius: 7px; padding: 7px 11px; background: #fff; color: #334155; cursor: pointer; }
  button:hover { background: #f4f7ff; border-color: #9db7f9; }
  button.primary { color: #fff; border-color: #2563eb; background: #2563eb; font-weight: 600; }
  button.primary:hover { background: #1d4ed8; }
  button.danger { color: #dc2626; border-color: #fecaca; }
  .icon-button { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 5px; flex: none; }
  .icon-button svg { width: 17px; height: 17px; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; fill: none; }
  .icon-button[hidden] { display: none; }
  .icon-button:focus-visible, .group-toggle:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
  #app { height: 100vh; min-height: 0; display: grid; grid-template-columns: 300px minmax(0, 1fr); }
  aside { min-height: 0; overflow: hidden; background: #fff; border-right: 1px solid #e3e7ee; display: flex; flex-direction: column; }
  .sidebar-head, .topbar { min-height: 72px; display: flex; align-items: center; padding: 16px 18px; border-bottom: 1px solid #e8ebf1; }
  .sidebar-head { gap: 9px; flex-wrap: wrap; }
  .sidebar-head h1 { margin: 0; font-size: 16px; letter-spacing: -.2px; }
  .count { color: #64748b; background: #f1f5f9; border-radius: 999px; padding: 3px 8px; font-size: 11px; }
  #new { margin-left: auto; }
  .sidebar-tools { flex: none; display: grid; gap: 8px; padding: 12px; border-bottom: 1px solid #e8ebf1; }
  #list { flex: 1; min-height: 0; margin: 0; padding: 8px; list-style: none; overflow-y: auto; overscroll-behavior: contain; }
  .group-head { margin: 10px 2px 4px; display: flex; align-items: center; border-radius: 7px; background: #f1f5f9; color: #475569; }
  .group-head .group-toggle { flex: 1; min-width: 0; border: 0; background: transparent; color: inherit; display: flex; align-items: center; gap: 6px; text-align: left; font-weight: 600; }
  .group-toggle svg { width: 16px; height: 16px; flex: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; fill: none; }
  .group-head:hover { background: #e8efff; }
  .group-head .group-check { width: 16px; height: 16px; margin: 0 10px; flex: none; accent-color: #2563eb; }
  .group-head .group-check[hidden] { display: none; }
  .rule { border: 1px solid transparent; border-radius: 8px; padding: 10px; margin-bottom: 3px; cursor: pointer; }
  .rule:hover { background: #f8fafc; }
  .rule.selected { background: #eff6ff; border-color: #bfdbfe; }
  .rule.batch-selected { background: #eef6ff; border-color: #93c5fd; }
  .rule-top { display: flex; align-items: center; gap: 7px; }
  .rule-check { width: 16px; height: 16px; margin: 0 2px 0 0; flex: none; accent-color: #2563eb; }
  .rule-actions { margin-left: auto; display: flex; gap: 4px; }
  .rule-actions button { width: 27px; height: 27px; }
  .rule-actions button:disabled { opacity: .5; cursor: default; }
  .batch-actions { display: none; align-items: center; gap: 6px; }
  .batch-actions.active { display: flex; }
  .batch-count { color: #475569; margin-right: auto; font-size: 12px; }
  .batch-actions button:disabled { opacity: .5; cursor: default; }
  .method { min-width: 42px; text-align: center; padding: 2px 5px; border-radius: 4px; background: #e0edff; color: #2563eb; font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
  .method.POST { color: #15803d; background: #dcfce7; }.method.PUT { color: #b45309; background: #ffedd5; }.method.DELETE { color: #dc2626; background: #fee2e2; }.method.PATCH { color: #7c3aed; background: #ede9fe; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #94a3b8; }.dot.on { background: #22c55e; }
  .rule-url { margin-top: 6px; color: #64748b; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
  .empty-list { padding: 44px 16px; text-align: center; color: #94a3b8; line-height: 1.65; }
  main { min-width: 0; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding-bottom: 78px; }
  .topbar { justify-content: space-between; background: rgba(255,255,255,.8); }
  .topbar h2 { margin: 0; font-size: 16px; }.hint { color: #94a3b8; font-size: 12px; }
  form { max-width: 1180px; padding: 22px 28px; margin: auto; }
  .section { margin-bottom: 18px; }.section-title { display: flex; align-items: center; justify-content: space-between; margin-bottom: 9px; font-weight: 650; color: #334155; }.section-title span { color: #94a3b8; font-weight: 400; font-size: 12px; }
  .config { display: grid; grid-template-columns: 110px 120px minmax(200px, 1fr) 125px; gap: 10px; }
  .group-field { margin-top: 12px; }
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
  <aside><div class="sidebar-head"><h1>网络 Mock</h1><span class="count" id="count">0 条规则</span><button class="icon-button primary" id="new" type="button" aria-label="新建规则" title="新建规则"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button><button class="icon-button" id="batch" type="button" aria-label="进入批量选择" title="进入批量选择" aria-pressed="false"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m7 12 3 3 7-7"/></svg></button></div><div class="sidebar-tools"><input id="search" type="search" placeholder="搜索 URL、方法或分组" aria-label="搜索 Mock 规则"><select id="groupFilter" aria-label="筛选分组"><option value="a:">全部分组</option></select><div class="batch-actions" id="batchActions"><span class="batch-count" id="batchCount">已选 0 条</span><button class="icon-button" id="selectVisible" type="button" aria-label="全选当前筛选结果" title="全选当前筛选结果"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m7 12 3 3 7-7"/></svg></button><button class="icon-button" id="batchEnable" type="button" aria-label="批量启用" title="批量启用"><svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7z"/></svg></button><button class="icon-button" id="batchDisable" type="button" aria-label="批量停用" title="批量停用"><svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg></button><button class="icon-button danger" id="batchDelete" type="button" aria-label="批量删除" title="批量删除"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/></svg></button></div></div><ul id="list"></ul></aside>
  <main><div class="topbar"><div><h2 id="title">新建 Mock 规则</h2><div class="hint">支持精确 URL 或正则 URL，并按请求方法命中</div></div><button class="icon-button danger" id="delete" type="button" aria-label="删除规则" title="删除规则" hidden><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/></svg></button></div>
    <form id="form"><input id="id" type="hidden">
      <section class="section"><div class="section-title">规则配置</div><div class="config">
        <label class="field">请求方法<select id="method"><option value="">任意</option><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select></label>
        <label class="field">URL 匹配<select id="urlMatchType"><option value="exact">精确匹配</option><option value="regex">正则匹配</option></select></label>
        <label class="field">URL<input id="url" required placeholder="https://api.example.com/v1/users"></label>
        <label class="field">状态码<input id="status" type="number" value="200"></label>
      </div><label class="field group-field">分组<input id="group" list="groupNames" placeholder="未分组；输入名称可新建分组" maxlength="80"><datalist id="groupNames"></datalist></label></section>
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
<div class="footer"><button class="icon-button" id="cancel" type="button" aria-label="取消编辑" title="取消编辑"><svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5 5 19"/></svg></button><button class="icon-button primary" id="save" type="button" aria-label="保存规则" title="保存规则"><svg viewBox="0 0 24 24"><path d="M4 3h14l3 3v15H3V3h1zM7 3v6h10V3M7 21v-8h10v8"/></svg></button></div>
<script>
  const { ipcRenderer } = require('electron')
  const $ = id => document.getElementById(id)
  let rules = []
  const collapsedGroups = new Set()
  const selectedIds = new Set()
  let batchMode = false
  let batchBusy = false
  const icons = {
    play: '<path d="m8 5 11 7-11 7z"/>',
    pause: '<rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    right: '<path d="m9 6 6 6-6 6"/>',
  }
  const icon = name => '<svg viewBox="0 0 24 24" aria-hidden="true">' + icons[name] + '</svg>'
  const filteredRules = () => {
    const query = $('search').value.trim().toLowerCase()
    const groupFilter = $('groupFilter').value
    return rules.filter(rule => {
      const group = rule.group || ''
      const groupMatches = groupFilter === 'a:' || (groupFilter === 'u:' ? !group : groupFilter === 'g:' + group)
      return groupMatches && (!query || [rule.url, rule.method || '*', group || '未分组'].some(value => String(value).toLowerCase().includes(query)))
    })
  }
  const updateBatchToolbar = filtered => {
    $('batchActions').classList.toggle('active', batchMode)
    $('batch').classList.toggle('primary', batchMode)
    $('batch').setAttribute('aria-pressed', String(batchMode))
    $('batch').setAttribute('aria-label', batchMode ? '退出批量选择' : '进入批量选择')
    $('batch').title = batchMode ? '退出批量选择' : '进入批量选择'
    $('batchCount').textContent = '已选 ' + selectedIds.size + ' 条'
    const allVisibleSelected = filtered.length > 0 && filtered.every(rule => selectedIds.has(rule.id))
    $('selectVisible').setAttribute('aria-label', allVisibleSelected ? '取消当前筛选结果的选择' : '全选当前筛选结果')
    $('selectVisible').title = allVisibleSelected ? '取消当前筛选结果的选择' : '全选当前筛选结果'
    $('selectVisible').disabled = !filtered.length || batchBusy
    ;['batchEnable', 'batchDisable', 'batchDelete'].forEach(id => { $(id).disabled = !selectedIds.size || batchBusy })
    $('batch').disabled = batchBusy
  }
  const text = value => typeof value === 'string' ? value : JSON.stringify(value || {}, null, 2)
  const empty = () => ({ id: '', group: '', url: '', urlMatchType: 'exact', method: '', status: 200, enabled: true, headers: {}, body: '', delayMs: 0, mockRequestHeaders: {}, mockRequestBody: '', mockRequestHeadersEnabled: false, mockRequestBodyEnabled: false, mockResponseHeadersEnabled: true, mockResponseBodyEnabled: true, mixedResponseEnabled: false, originalRequestHeaders: {}, originalRequestBody: '' })
  const updateBoxes = () => ['mockRequestHeadersEnabled','mockRequestBodyEnabled','mockResponseHeadersEnabled','mockResponseBodyEnabled'].forEach(id => $(id).closest('.mock-box').classList.toggle('off', !$(id).checked))
  const renderList = () => {
    const scrollTop = $('list').scrollTop
    const filtered = filteredRules()
    $('count').textContent = $('search').value.trim() || $('groupFilter').value !== 'a:' ? filtered.length + ' / ' + rules.length + ' 条' : rules.length + ' 条规则'
    updateBatchToolbar(filtered)
    $('list').innerHTML = ''
    if (!filtered.length) { $('list').innerHTML = '<li class="empty-list">' + (rules.length ? '没有匹配的 Mock 规则' : '还没有 Mock 规则<br>从 Network 右键创建，或点击新建规则。') + '</li>'; return }
    const groups = new Map()
    filtered.forEach(rule => { const group = rule.group || ''; if (!groups.has(group)) groups.set(group, []); groups.get(group).push(rule) })
    const selectedId = $('id').value
    groups.forEach((items, group) => {
      const heading = document.createElement('li'); heading.className = 'group-head'
      if (batchMode) {
        const check = document.createElement('input'); check.type = 'checkbox'; check.className = 'group-check'
        check.checked = items.every(rule => selectedIds.has(rule.id)); check.indeterminate = !check.checked && items.some(rule => selectedIds.has(rule.id)); check.disabled = batchBusy
        check.setAttribute('aria-label', '选择分组 ' + (group || '未分组') + ' 中当前筛选的 ' + items.length + ' 条规则')
        check.onchange = () => { items.forEach(rule => { if (check.checked) selectedIds.add(rule.id); else selectedIds.delete(rule.id) }); renderList() }
        heading.append(check)
      }
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'group-toggle'; toggle.setAttribute('aria-expanded', String(!collapsedGroups.has(group)))
      toggle.innerHTML = icon(collapsedGroups.has(group) ? 'right' : 'down')
      const label = document.createElement('span'); label.textContent = (group || '未分组') + ' (' + items.length + ')'; toggle.append(label)
      toggle.onclick = () => { if (collapsedGroups.has(group)) collapsedGroups.delete(group); else collapsedGroups.add(group); renderList() }
      heading.append(toggle); $('list').append(heading)
      if (collapsedGroups.has(group)) return
      items.forEach(rule => { const li = document.createElement('li'); li.className = 'rule' + (batchMode ? (selectedIds.has(rule.id) ? ' batch-selected' : '') : (rule.id === selectedId ? ' selected' : ''))
        li.onclick = () => { if (batchMode) { if (batchBusy) return; if (selectedIds.has(rule.id)) selectedIds.delete(rule.id); else selectedIds.add(rule.id); renderList() } else show(rule) }
        const top = document.createElement('div'); top.className = 'rule-top'
        if (batchMode) {
          const check = document.createElement('input'); check.type = 'checkbox'; check.className = 'rule-check'; check.checked = selectedIds.has(rule.id); check.disabled = batchBusy; check.setAttribute('aria-label', '选择 ' + rule.url)
          check.onclick = event => event.stopPropagation()
          check.onchange = () => { if (check.checked) selectedIds.add(rule.id); else selectedIds.delete(rule.id); renderList() }
          top.append(check)
        }
        const dot = document.createElement('i'); dot.className = 'dot' + (rule.enabled ? ' on' : ''); const method = document.createElement('b'); method.className = 'method ' + (rule.method || 'GET'); method.textContent = rule.method || '*'; const status = document.createElement('span'); status.textContent = rule.enabled ? '启用' : '禁用'; top.append(dot, method, status)
        if (!batchMode) {
          const actions = document.createElement('div'); actions.className = 'rule-actions'
          const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'icon-button'; toggle.innerHTML = icon(rule.enabled ? 'pause' : 'play'); toggle.setAttribute('aria-label', (rule.enabled ? '停用 ' : '启用 ') + rule.url); toggle.title = toggle.getAttribute('aria-label')
          toggle.onclick = event => { event.stopPropagation(); toggleRule(rule, toggle) }
          const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-button danger'; remove.innerHTML = icon('trash'); remove.setAttribute('aria-label', '删除 ' + rule.url); remove.title = remove.getAttribute('aria-label')
          remove.onclick = event => { event.stopPropagation(); deleteRule(rule.id) }
          actions.append(toggle, remove); top.append(actions)
        }
        const url = document.createElement('div'); url.className = 'rule-url'; url.textContent = rule.url; li.append(top, url); $('list').append(li) })
    })
    $('list').scrollTop = scrollTop
  }
  const updateGroups = () => {
    const selected = $('groupFilter').value
    const names = [...new Set(rules.map(rule => rule.group).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    $('groupFilter').innerHTML = '<option value="a:">全部分组</option><option value="u:">未分组</option>'
    $('groupNames').innerHTML = ''
    names.forEach(name => {
      const option = document.createElement('option'); option.value = 'g:' + name; option.textContent = name; $('groupFilter').append(option)
      const suggestion = document.createElement('option'); suggestion.value = name; $('groupNames').append(suggestion)
    })
    $('groupFilter').value = [...$('groupFilter').options].some(option => option.value === selected) ? selected : 'a:'
  }
  const show = rule => {
    const value = rule || empty()
    $('id').value = value.id || ''; $('group').value = value.group || ''; $('url').value = value.url || ''; $('urlMatchType').value = value.urlMatchType || 'exact'; $('method').value = value.method || ''; $('status').value = value.status || 200; $('delayMs').value = value.delayMs || 0
    $('mockRequestHeaders').value = text(value.mockRequestHeaders); $('mockRequestBody').value = text(value.mockRequestBody || '')
    $('headers').value = text(value.headers); $('body').value = text(value.body || '')
    $('originalRequestHeaders').value = text(value.originalRequestHeaders || value.requestHeaders); $('originalRequestBody').value = text(value.originalRequestBody || value.requestBody || '')
    $('mockRequestHeadersEnabled').checked = value.mockRequestHeadersEnabled === true; $('mockRequestBodyEnabled').checked = value.mockRequestBodyEnabled === true
    $('mockResponseHeadersEnabled').checked = value.mockResponseHeadersEnabled !== false; $('mockResponseBodyEnabled').checked = value.mockResponseBodyEnabled !== false; $('mixedResponseEnabled').checked = value.mixedResponseEnabled === true; $('enabled').checked = value.enabled !== false
    $('title').textContent = value.id ? '编辑 Mock 规则' : '新建 Mock 规则'; $('delete').hidden = !value.id; updateBoxes(); renderList()
  }
  const render = async () => {
    rules = await ipcRenderer.invoke('network-mock-list')
    const known = new Set(rules.map(rule => rule.id))
    selectedIds.forEach(id => { if (!known.has(id)) selectedIds.delete(id) })
    updateGroups(); renderList()
  }
  const toggleBatchMode = () => {
    if (batchBusy) return
    batchMode = !batchMode
    selectedIds.clear()
    renderList()
  }
  const selectVisible = () => {
    if (batchBusy) return
    const visible = filteredRules()
    const allSelected = visible.length && visible.every(rule => selectedIds.has(rule.id))
    visible.forEach(rule => { if (allSelected) selectedIds.delete(rule.id); else selectedIds.add(rule.id) })
    renderList()
  }
  const batchSetEnabled = async enabled => {
    if (!selectedIds.size || batchBusy) return
    const ids = [...selectedIds]
    batchBusy = true; renderList()
    try {
      await ipcRenderer.invoke('network-mock-batch-set-enabled', ids, enabled)
      if (selectedIds.has($('id').value)) $('enabled').checked = enabled
      await render()
    } catch (error) { alert(error.message || '批量切换规则失败') }
    finally { batchBusy = false; renderList() }
  }
  const batchDelete = async () => {
    if (!selectedIds.size || batchBusy) return
    const ids = [...selectedIds]
    if (!confirm('确定删除选中的 ' + ids.length + ' 条 Mock 规则？此操作不可撤销。')) return
    batchBusy = true; renderList()
    try {
      await ipcRenderer.invoke('network-mock-batch-delete', ids)
      if (selectedIds.has($('id').value)) show()
      selectedIds.clear()
      await render()
    } catch (error) { alert(error.message || '批量删除规则失败') }
    finally { batchBusy = false; renderList() }
  }
  const toggleRule = async (rule, button) => {
    button.disabled = true
    try {
      const saved = await ipcRenderer.invoke('network-mock-set-enabled', rule.id, !rule.enabled)
      if ($('id').value === rule.id) $('enabled').checked = saved.enabled
      await render()
    } catch (error) { button.disabled = false; alert(error.message || '切换规则失败') }
  }
  const deleteRule = async id => {
    if (!confirm('删除此 Mock 规则？')) return
    try {
      await ipcRenderer.invoke('network-mock-delete', id)
      if ($('id').value === id) show()
      await render()
    } catch (error) { alert(error.message || '删除规则失败') }
  }
  const parseHeaders = (id, label) => { try { const value = JSON.parse($(id).value || '{}'); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value } catch (error) { throw new Error(label + '必须是 JSON 对象') } }
  const parseBody = id => { try { return JSON.parse($(id).value) } catch (error) { return $(id).value } }
  const save = async () => { try {
    const id = $('id').value.trim()
    const saved = await ipcRenderer.invoke('network-mock-save', { id: id || undefined, group: $('group').value, url: $('url').value, urlMatchType: $('urlMatchType').value, method: $('method').value, status: $('status').value, enabled: $('enabled').checked, delayMs: $('delayMs').value,
      mockRequestHeadersEnabled: $('mockRequestHeadersEnabled').checked, mockRequestHeaders: parseHeaders('mockRequestHeaders', '请求头'), mockRequestBodyEnabled: $('mockRequestBodyEnabled').checked, mockRequestBody: parseBody('mockRequestBody'),
      mockResponseHeadersEnabled: $('mockResponseHeadersEnabled').checked, mockResponseBodyEnabled: $('mockResponseBodyEnabled').checked, mixedResponseEnabled: $('mixedResponseEnabled').checked, headers: parseHeaders('headers', '响应头'), body: parseBody('body'),
      originalRequestHeaders: parseHeaders('originalRequestHeaders', '原始请求头'), originalRequestBody: $('originalRequestBody').value,
    }); show(saved); await render()
  } catch (error) { alert(error.message || '保存失败') } }
  $('new').onclick = () => show(); $('cancel').onclick = () => show(); $('save').onclick = save; $('form').onsubmit = event => { event.preventDefault(); save() }; $('delete').onclick = () => { if ($('id').value) deleteRule($('id').value) }
  $('batch').onclick = toggleBatchMode; $('selectVisible').onclick = selectVisible
  $('batchEnable').onclick = () => batchSetEnabled(true); $('batchDisable').onclick = () => batchSetEnabled(false); $('batchDelete').onclick = batchDelete
  $('search').oninput = renderList; $('groupFilter').onchange = renderList
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
