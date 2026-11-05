(() => {
  'use strict';
  const API = '/__tech';
  const anchors = globalThis.PrototypeTalkAnchor;
  if (!anchors) throw new Error('Prototype Talk anchor module did not load');
  const loadedAt = Date.now();
  const POSITION_KEY = 'tech-review-panel-position';
  const initialOperationId = new URLSearchParams(location.search).get('tech_operation') || '';
  const state = { data: null, activeOperationId: initialOperationId, activeJobId: '', tab: 'product', scope: initialOperationId ? 'current' : 'page', reviewScope: 'current', listScope: 'page', search: '', localStatus: '', unmatchedTargetLabel: '', collapsed: false, skippedQuestions: new Set(), expandedApiGroups: new Set(), expandedContract: false, evidence: null, pendingAnswer: null, ruleDraft: null, apiDraft: null, removeApiFieldId: '', showIssueForm: false };
  const userEditedFields = new Set();
  let panel;
  let body;
  let pending = null;
  let pendingInputs = [];
  let inputTimer;
  let inputBeforeText = '';
  let inputBeforeState = null;
  let finalizeTimer;
  let maxTimer;
  let lastPriorityPage = '';
  let fieldInventoryTimer;
  let lastFieldSignature = '';

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const route = () => {
    const query = new URLSearchParams(location.search);
    query.delete('tech_operation');
    const search = query.toString();
    return `${location.pathname}${search ? `?${search}` : ''}${location.hash}`;
  };
  const own = (element) => panel && (element === panel || panel.contains(element));
  const compact = (value, limit = 140) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
  const visibleText = () => {
    const root = document.querySelector('#view, main, .page-content, .main-content') || document.body;
    let value = root?.innerText || '';
    if (root === document.body && panel) value = value.replace(panel.innerText || '', '');
    return value.slice(0, 2400);
  };
  const snapshot = () => ({ route: route(), title: document.title, visible_text: visibleText(), dialog_title: visibleDialogTitle(), selected_tab: compact([...document.querySelectorAll('[role="tab"][aria-selected="true"],.inner-tabs .active,.nav-tab.active')].find(visibleElement)?.textContent || '', 45), dialogs: [...document.querySelectorAll('[role="dialog"],.overlay,.modal-mask,.toast,[role="status"]')].filter((node) => !own(node)).map((node) => compact(node.innerText, 350)).filter(Boolean).slice(0, 5) });
  const dataset = (element) => Object.fromEntries([...element.attributes].filter((attr) => attr.name.startsWith('data-') && !attr.name.startsWith('data-tech-')).slice(0, 10).map((attr) => [attr.name, attr.value]));
  const volatileId = anchors.volatileId;
  const stableData = (data) => Object.entries(data).filter(([key, value]) => value && !weakIdentityData(key, value));
  function stableSelector(element, data, id) {
    const tag = element.tagName.toLowerCase();
    if (id) return `#${CSS.escape(id)}`;
    const entry = ['data-testid', 'data-test', 'data-qa'].map((name) => [name, data[name]]).find(([, value]) => value) || stableData(data)[0];
    if (entry) return `${tag}[${entry[0]}=${JSON.stringify(entry[1])}]`;
    for (const name of ['aria-label', 'name', 'href']) {
      const value = element.getAttribute(name);
      if (value) return `${tag}[${name}=${JSON.stringify(value)}]`;
    }
    return tag;
  }
  function valueOf(element) {
    if (!('value' in element)) return '';
    if (['checkbox', 'radio'].includes(element.type)) return element.checked ? '已勾选' : '未勾选';
    const value = String(element.value ?? '');
    if (!value) return '';
    if (element.type === 'password' || /token|secret|password|手机号|邮箱|phone|email/i.test(`${element.name || ''} ${element.id || ''}`) || /\b1\d{10}\b/.test(value) || /@/.test(value)) return `[已脱敏，长度 ${value.length}]`;
    return value.slice(0, 100);
  }
  function descriptor(element, includeTransientSelector = false) {
    const data = dataset(element);
    const fieldGroup = element.closest('.modal-form-item,.form-item,.form-group,.field,label');
    const fieldLabel = fieldGroup?.matches('label') ? fieldGroup.textContent : fieldGroup?.querySelector('label')?.textContent;
    const menuCategory = Object.entries(data).find(([key]) => /menu-count$/.test(key))?.[1];
    const contextualLabel = menuCategory ? `${menuCategory} · 二级菜单权限` : '';
    const label = compact(contextualLabel || element.getAttribute('aria-label') || fieldLabel || element.getAttribute('title') || element.innerText || element.getAttribute('placeholder') || element.name || element.id || element.tagName, 90);
    const isField = element.matches('input,textarea,select');
    const editability = isField ? element.disabled || element.getAttribute('aria-disabled') === 'true' ? 'disabled' : element.readOnly ? 'readonly' : 'editable' : undefined;
    const id = volatileId(element.id) ? '' : element.id || '';
    const selector = stableSelector(element, data, id);
    const selectorUnique = document.querySelectorAll(selector).length === 1;
    let transientSelector = '';
    if (includeTransientSelector && !selectorUnique && globalThis.PrototypeTalkFinder) {
      try {
        transientSelector = globalThis.PrototypeTalkFinder(element, {
          idName: (value) => !volatileId(value),
          className: (value) => !/^(?:css-|sc-|jsx-)|[0-9a-f]{8,}/i.test(value),
          attr: (name, value) => ['data-testid', 'data-test', 'data-qa', 'aria-label', 'name', 'href'].includes(name) && !!value,
        });
      } catch { /* a temporary selector is optional */ }
    }
    return { tag: element.tagName.toLowerCase(), label, id, data, selector, selector_unique: selectorUnique, transient_selector: transientSelector, hierarchy: anchors.hierarchyFor(element, route()), name: element.name || '', type: element.type || '', role: element.getAttribute('role') || '', class_name: String(element.className || ''), download: element.hasAttribute('download'), multiple: !!element.multiple, expanded: element.getAttribute('aria-expanded') || '', form: element.getAttribute('form') || element.form?.id || '', onclick: element.getAttribute('onclick') || '', href: element.getAttribute('href') || '', editability, current_value: isField ? valueOf(element) : undefined, required: isField ? element.required || !!fieldGroup?.querySelector('label.required') : undefined };
  }
  function currentCard(operationId) { return state.data?.cards?.filter((card) => card.operation_id === operationId && card.source_snapshot_id === state.data?.source_snapshot_id).at(-1) || null; }
  function latestRule(scope, operationId, slot) { return state.data?.rules?.filter((item) => !item.superseded_by && item.scope === scope && item.operation_id === (operationId || null) && (item.page_path === currentPagePath() || currentPagePath().startsWith('/?screen=') && item.page_path === '/index.html') && item.slot === slot).at(-1) || null; }
  function currentOperation() { return state.data?.operations?.find((item) => item.operation_id === state.activeOperationId) || null; }
  function currentPagePath() {
    const hashPath = location.hash.replace(/^#/, '').split('?')[0];
    const paths = [
      ...(state.data?.logical_screens?.map((item) => item.path) || []),
      ...(state.data?.page_specs?.filter((item) => item.source_snapshot_id === state.data?.source_snapshot_id).map((item) => item.path) || []),
      ...(state.data?.project_jobs?.filter((item) => item.source_snapshot_id === state.data?.source_snapshot_id).flatMap((item) => item.pages || []) || []),
    ];
    const screen = new URLSearchParams(location.search).get('screen');
    const screenPage = screen ? `/?screen=${screen}` : '';
    if (hashPath && paths.includes(hashPath)) return hashPath;
    if (screenPage && paths.includes(screenPage)) return screenPage;
    const wildcard = paths.find((item) => item.endsWith('/*') && hashPath.startsWith(item.slice(0, -1)));
    return wildcard || (location.pathname === '/' ? '/index.html' : location.pathname);
  }
  function currentPageSpec() { return state.data?.page_specs?.filter((item) => item.path === currentPagePath() && item.source_snapshot_id === state.data?.source_snapshot_id).at(-1) || null; }
  function pageFunction(operation) { return currentPageSpec()?.functions?.find((item) => item.operation_ids?.includes(operation?.operation_id)) || null; }
  const weakIdentityData = anchors.weakData;
  function operationOnCurrentPage(operation) {
    const currentRoute = route();
    const discovered = operation.discovered_by || [];
    if (discovered.includes('runtime') && !discovered.includes('source_scan') && !discovered.includes('source_template') && !discovered.includes('jsx_ast')) return operation.page_hint === currentRoute;
    const logical = currentRoute.includes('#/') ? `/${currentRoute.split('#/')[1].split('?')[0]}` : currentRoute.split(/[?#]/)[0];
    if (logical === operation.page_hint || operation.page_hint === '/index.html' && logical === '/') return true;
    return !(currentRoute.includes('#/') || logical.startsWith('/pages/'));
  }
  function matchOperation(target) {
    return anchors.matchRuntimeControl((state.data?.operations || []).filter(operationOnCurrentPage), target, route());
  }
  function setActive(id, fromDemo = false) {
    releaseOperationLink();
    state.activeOperationId = id || '';
    state.unmatchedTargetLabel = '';
    state.scope = 'current';
    state.pendingAnswer = null;
    state.ruleDraft = null;
    state.apiDraft = null;
    state.showIssueForm = false;
    if (!fromDemo) state.tab = 'product';
    render();
  }
  function releaseOperationLink() {
    const url = new URL(location.href);
    if (!url.searchParams.has('tech_operation')) return;
    url.searchParams.delete('tech_operation');
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }
  function api(path, options = {}) { return fetch(`${API}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } }).then(async (response) => { const value = await response.json(); if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`); return value; }); }
  async function refresh() {
    try {
      const previousVersion = state.data?.updated_at;
      const previousStatus = state.localStatus;
      const next = await api(`/state${previousVersion ? `?since=${encodeURIComponent(previousVersion)}` : ''}`);
      if (next.unchanged) return;
      state.data = next;
      prioritizeCurrentPage();
      scheduleFieldInventory();
      const job = state.data.jobs?.find((item) => item.job_id === state.activeJobId);
      if (job && ['returned', 'failed', 'stale'].includes(job.status)) state.localStatus = '';
      if (!previousVersion || previousVersion !== state.data.updated_at || previousStatus !== state.localStatus) render();
    } catch (error) { state.localStatus = `连接本地服务失败：${error.message}`; render(); }
  }
  function prioritizeCurrentPage() {
    if (!state.data?.ai_enabled || currentPageSpec()) return;
    const path = currentPagePath();
    if (path === lastPriorityPage) return;
    lastPriorityPage = path;
    api('/prioritize', { method: 'POST', body: JSON.stringify({ page_path: path }) }).catch(() => {});
  }
  function contextFieldsFor(element) {
    const container = element?.closest('form,[role="dialog"],.sheet,.modal,.drawer,.form-panel') || element?.closest('section');
    if (!container) return [];
    return [...container.querySelectorAll('input:not([type="hidden"]),textarea,select')].filter(visibleElement).map((node) => descriptor(node).label).filter(Boolean).slice(0, 40);
  }
  function observedRegion(trace) {
    const pagePath = currentPagePath();
    const fieldLabels = (root) => [...root.querySelectorAll('label,thead th,dt')].filter(visibleElement).map((node) => compact(node.textContent, 80).replace(/\s*\*\s*$/, '')).filter(Boolean).slice(0, 80);
    const actionLabels = (root) => [...new Set([...root.querySelectorAll('button,[role="button"]')].filter(visibleElement).map((node) => compact(node.getAttribute('aria-label') || node.textContent, 60)).filter((value) => value && !/^(关闭|取消|×)$/.test(value)))].slice(0, 12);
    const observedFieldIds = (root) => (state.data?.display_fields || []).filter((field) => field.page_path === pagePath && field.status !== 'removed' && sourceConditionMatches(field) && (field.dom_candidates || []).some((candidate) => { try { return [...root.querySelectorAll(candidate.selector)].some((node) => visibleElement(node) && compact(node.textContent)); } catch { return false; } })).map((field) => field.field_id).slice(0, 80);
    const dialog = [...document.querySelectorAll('[role="dialog"],.modal-mask.show,.modal.show,.drawer,.sheet')].find(visibleElement);
    if (dialog && trace.after.dialog_title && trace.after.dialog_title !== trace.before.dialog_title) return { scope: 'dialog', page_path: pagePath, label: trace.after.dialog_title, field_labels: fieldLabels(dialog), action_labels: actionLabels(dialog), observed_field_ids: observedFieldIds(dialog) };
    if (trace.before.route !== trace.after.route) return { scope: 'page', page_path: pagePath, label: state.data?.source_regions?.find((item) => item.page_path === pagePath)?.label || document.title, field_labels: fieldLabels(document), observed_field_ids: observedFieldIds(document) };
    if (['input', 'textarea', 'select'].includes(trace.target?.tag)) return { scope: 'field', page_path: pagePath, label: trace.target.label, field_labels: [trace.target.label] };
    if (dialog) return { scope: 'dialog', page_path: pagePath, label: trace.after.dialog_title || '当前弹窗', field_labels: fieldLabels(dialog), action_labels: actionLabels(dialog), observed_field_ids: observedFieldIds(dialog) };
    if (trace.after.selected_tab && trace.after.selected_tab !== trace.before.selected_tab) {
      const panelRegion = [...document.querySelectorAll('[role="tabpanel"]')].find(visibleElement) || document.querySelector('#view,main,.page-content,.main-content') || document.body;
      return { scope: 'section', page_path: pagePath, label: trace.after.selected_tab, field_labels: fieldLabels(panelRegion), observed_field_ids: observedFieldIds(panelRegion) };
    }
    const linked = state.data?.source_region_links?.find((item) => item.trigger_label === trace.target?.label && item.target_region_id === pagePath);
    if (linked) return { scope: 'page', page_path: pagePath, label: trace.target.label, field_labels: fieldLabels(document), observed_field_ids: observedFieldIds(document) };
    return null;
  }
  function begin(trigger, target, extra = null, element = null) {
    if (pending) finalize(false);
    releaseOperationLink();
    const before = trigger === 'input_completed' && inputBeforeState ? inputBeforeState : snapshot();
    pending = { trace_id: `trace_browser_${crypto.randomUUID()}`, operation_id: '', trigger, target, before, context_fields: contextFieldsFor(element), events: [...pendingInputs, { type: trigger, at: Date.now(), target, detail: extra }], started_at: new Date().toISOString() };
    pendingInputs = [];
    inputBeforeState = null;
    const matched = matchOperation(target);
    if (matched) { pending.operation_id = matched.operation_id; setActive(matched.operation_id, true); }
    else { state.activeOperationId = ''; state.unmatchedTargetLabel = target.label || '当前交互'; state.scope = 'current'; render(); }
    state.localStatus = state.data?.ai_enabled && !matched ? '采集中：原交互正在执行，等待页面反馈' : '';
    render();
    scheduleFinalize(950);
    maxTimer = setTimeout(() => finalize(false), 6500);
  }
  function scheduleFinalize(delay = 950) { clearTimeout(finalizeTimer); finalizeTimer = setTimeout(() => finalize(false), delay); }
  function finalize(beacon) {
    if (!pending) return;
    clearTimeout(finalizeTimer); clearTimeout(maxTimer);
    let field = pending.target?.id ? document.getElementById(pending.target.id) : null;
    if (!field && pending.target?.transient_selector) {
      try { field = document.querySelector(pending.target.transient_selector); } catch { /* DOM changed after interaction */ }
    }
    if (field?.matches('input,textarea,select')) {
      const current = descriptor(field);
      if (current.label === pending.target.label && JSON.stringify(current.hierarchy) === JSON.stringify(pending.target.hierarchy)) pending.target = current;
    }
    const trace = { ...pending, after: snapshot(), finished_at: new Date().toISOString() };
    trace.observed_region = observedRegion(trace);
    pending = null;
    state.localStatus = state.data?.ai_enabled && !currentCard(trace.operation_id) ? state.data.model_mode === 'conversation' ? '已排队：等待当前对话处理' : '已提交：等待本地解读任务' : '';
    render();
    const payload = JSON.stringify(trace);
    if (beacon && navigator.sendBeacon) { navigator.sendBeacon(`${API}/trace`, new Blob([payload], { type: 'application/json' })); return; }
    api('/trace', { method: 'POST', body: payload }).then((result) => {
      state.activeJobId = result.job_id || '';
      setActive(result.operation_id, true);
      if (!result.job_id) state.localStatus = '';
      refresh();
    }).catch((error) => { state.localStatus = `记录失败：${error.message}`; render(); });
  }
  function captureClick(event) {
    if (own(event.target)) return;
    const element = event.target.closest('button,a,[role="button"],[onclick],[data-action],[data-tab],input[type="submit"],input[type="button"]');
    if (!element || element.disabled) return;
    begin('click', descriptor(element, true), null, element);
  }
  function captureFocus(event) {
    if (own(event.target) || !event.target.matches('input,textarea,select')) return;
    if (['hidden', 'button', 'submit', 'reset'].includes(event.target.type) || event.target.disabled) return;
    begin('focus', descriptor(event.target, true), null, event.target);
  }
  function captureLockedPointer(event) {
    if (own(event.target)) return;
    const group = event.target.closest('.modal-form-item,.form-item,.form-group,.field');
    const field = event.target.matches('input,textarea,select') ? event.target : group?.querySelector('input,textarea,select');
    if (!field || (!field.disabled && !field.readOnly)) return;
    if (!field.disabled && event.target !== group?.querySelector('label')) return;
    begin('inspect', descriptor(field, true));
  }
  function captureInput(event) {
    if (own(event.target) || !event.target.matches('input,textarea,select')) return;
    const field = descriptor(event.target);
    userEditedFields.add(`${route()}|${field.selector}`);
    const item = { type: event.type, at: Date.now(), field, value: valueOf(event.target) };
    if (pending) {
      pending.events.push(item);
      if (pending.target?.tag === field.tag && pending.target?.selector === field.selector) pending.target = field;
      scheduleFinalize();
    }
    else {
      if (pendingInputs.length === 0) { inputBeforeText = visibleText(); inputBeforeState = snapshot(); }
      pendingInputs = pendingInputs.filter((prior) => prior.field?.selector !== field.selector);
      pendingInputs.push(item);
      clearTimeout(inputTimer);
      inputTimer = setTimeout(() => {
        if (pendingInputs.length && visibleText() !== inputBeforeText) begin('input_completed', field, { value: item.value });
      }, 1000);
    }
  }
  function captureNavigation(event) {
    if (pending) { pending.events.push({ type: event.type, at: Date.now(), route: route() }); scheduleFinalize(); }
    else if (currentOperation() && !operationOnCurrentPage(currentOperation())) {
      state.activeOperationId = '';
      state.scope = 'page';
      state.unmatchedTargetLabel = '';
      render();
    }
    prioritizeCurrentPage();
    scheduleFieldInventory();
  }
  function observeMutations(records) {
    const meaningful = records.some((record) => !own(record.target) && ![...record.addedNodes].every((node) => own(node)));
    if (!meaningful) return;
    scheduleFieldInventory();
    if (!pending) return;
    pending.events.push({ type: 'dom_change', at: Date.now(), route: route(), visible_text: visibleText().slice(0, 500) });
    if (pending.events.length > 40) pending.events = pending.events.slice(-40);
    scheduleFinalize(950);
  }
  function sourceTag(origin) { return ({ source_observed: '源码事实', runtime_observed: '操作观察', documented: '文档要求', user_supplied: '人工补充', proposed: '技术建议' })[origin] || origin; }
  function statusLabel(status) { return ({ queued: '已提交', analyzing: '解读中', validating: '校验中', returned: '已返回，待逐条核对', failed: '解读失败', stale: '资料已过期' })[status] || status; }
  function formatJobTime(milliseconds) {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  function jobTimingText(job, now = Date.now()) {
    if (!job) return '';
    const createdAt = Date.parse(job.created_at || '');
    const startedAt = Date.parse(job.started_at || '');
    const queued = Number.isFinite(job.queue_duration_ms) ? job.queue_duration_ms : Number.isFinite(createdAt) && Number.isFinite(startedAt) ? Math.max(0, startedAt - createdAt) : null;
    if (job.status === 'queued' && Number.isFinite(createdAt)) return `排队中 · 已等待 ${formatJobTime(now - createdAt)}`;
    if (['analyzing', 'validating'].includes(job.status) && Number.isFinite(startedAt)) return state.data?.model_mode === 'conversation' ? '当前对话已领取，写回后显示结果' : `${job.status === 'analyzing' ? '生成中' : '校验中'} · 已用 ${formatJobTime(now - startedAt)}${queued !== null ? ` · 排队 ${formatJobTime(queued)}` : ''}`;
    if (['returned', 'failed'].includes(job.status) && Number.isFinite(job.duration_ms)) return `${queued !== null ? '本次总耗时' : '本次生成用时'} ${formatJobTime(job.duration_ms + (queued || 0))}${queued !== null ? ` · 排队 ${formatJobTime(queued)}` : ''}`;
    return '';
  }
  function jobTimingHtml(job) {
    const value = jobTimingText(job);
    return value ? `<span class="tr-job-timing" data-job-timing="${escapeHtml(job.job_id)}">${escapeHtml(value)}</span>` : '';
  }
  function updateJobTimers() {
    for (const element of panel?.querySelectorAll('[data-job-timing]') || []) {
      const job = [...(state.data?.jobs || []), ...(state.data?.project_jobs || [])].find((item) => item.job_id === element.dataset.jobTiming);
      if (job) element.textContent = jobTimingText(job);
    }
  }
  function sectionLabel(section) { return ({ behavior: '交互', constraint: '校验', field: '字段', data: '数据', interface: '接口', flow: '流程', visual: '样式' })[section] || section; }
  function isChoiceOperation(operation) { return ['single_select', 'multi_select'].includes(operation?.component?.id) || operation?.tag === 'select' || /select(?=[A-Z]|\b)|dropdown|picker|regionPanel|请选择|下拉/i.test(`${operation?.label || ''} ${operation?.anchor?.onclick || ''}`); }
  function isFieldOperation(operation) { return ['input', 'textarea', 'select'].includes(operation?.tag) || isChoiceOperation(operation); }
  function operationType(operation) {
    const family = operation?.component?.id;
    if (['checkbox', 'radio_group', 'switch'].includes(family)) return 'toggle';
    if (family === 'disclosure') return 'expand';
    if (family === 'tab') return 'tab';
    if (family === 'navigation' || /(?:location\.(?:href|assign|replace)|window\.location)\s*(?:=|\()/.test(operation?.anchor?.onclick || '') || operation?.tag === 'a' && operation?.anchor?.href) return 'navigation';
    if (['single_select', 'multi_select'].includes(family)) return 'choice';
    if (family === 'submit_action') return 'submit';
    const type = operation?.latest_runtime?.type || operation?.anchor?.type || '';
    if (type === 'checkbox' || type === 'radio') return 'toggle';
    if (Object.keys(operation?.anchor?.data || {}).some((key) => /menu-count$/.test(key)) || /toggle\w*Details\s*\(/.test(operation?.anchor?.onclick || '')) return 'expand';
    if (Object.keys(operation?.anchor?.data || {}).some((key) => /(?:^|-)tab$/.test(key)) || /^switch\w*Tab\s*\(/.test(operation?.anchor?.onclick || '')) return 'tab';
    if (isChoiceOperation(operation)) return 'choice';
    if (isFieldOperation(operation)) return 'field';
    if (operation?.trigger === 'submit' || type === 'submit' && !!operation?.anchor?.form || /^(submit|save|confirm|delete)\w*\s*\(/i.test(operation?.anchor?.onclick || '') || /^(保存|提交|确认删除|删除)/.test(operation?.label || '')) return 'submit';
    return 'action';
  }
  function operationTitle(operation, card) {
    const label = String(card?.title || operation?.label || '').replace(/^(请输入|请选择)/, '');
    if (/['"`]\s*\+|\$\{|\.length\s*\+/.test(label)) return operationType(operation) === 'toggle' ? '勾选数量' : '动态文本（待命名）';
    return /^(div|span|i|li|button)?$/i.test(label) ? (isChoiceOperation(operation) ? '下拉选择（待命名）' : '未命名交互') : label;
  }
  function candidateIssues(card) { return state.data?.issues?.filter((issue) => issue.card_id === card?.card_id) || []; }
  function issueKind(issue) {
    if (issue.kind) return issue.kind;
    const text = `${issue.text || ''} ${issue.reason || ''}`;
    if (/PRD|需求文档/.test(text) && /Demo|原型|当前.*表单|实现/.test(text)) return 'prd_demo_mismatch';
    if (/运行验收|实际操作.*验证|尚未实测|操作记录/.test(text)) return 'test_gap';
    if (/接口|服务端|权限/.test(text)) return 'technical_gap';
    return 'product_question';
  }
  function issueDisplayHtml(issue, card) {
    const kind = issueKind(issue);
    const actions = `<div class="tr-actions"><button data-issue="${escapeHtml(issue.issue_id)}" data-issue-decision="accepted">加入待办</button><button data-issue="${escapeHtml(issue.issue_id)}" data-issue-decision="rejected">忽略</button></div>`;
    if (kind === 'prd_demo_mismatch') {
      const documented = (card?.claims || []).filter((item) => item.origin === 'documented').map((item) => item.text.replace(/^PRD\s*要求/, '')).slice(0, 3);
      const prd = issue.prd_fact || documented.join('；') || '请到证据核对查看需求原文';
      const demo = issue.demo_fact || String(issue.reason || '').split(/[；;]/)[0] || '请到证据核对查看原型实现';
      return `<div class="tr-issue tr-mismatch"><strong>PRD 与 Demo 不一致</strong><div class="tr-diff-row"><span>PRD 要求</span><p>${escapeHtml(prd)}</p></div><div class="tr-diff-row"><span>Demo 当前</span><p>${escapeHtml(demo)}</p></div><button data-view="evidence">查看两侧依据</button>${actions}</div>`;
    }
    const title = kind === 'test_gap' ? '尚未实测' : kind === 'technical_gap' ? '技术实现待核对' : '产品规则待确认';
    return `<div class="tr-issue"><strong>${title}</strong><p>${escapeHtml(issue.text)}</p><div class="tr-small">${escapeHtml(issue.reason || '待补充依据')}</div>${kind === 'product_question' ? issueQuestionsHtml(issue) : ''}${actions}</div>`;
  }
  function liveFieldState(operation) {
    let element = operation?.anchor?.id ? document.getElementById(operation.anchor.id) : null;
    if (!element && operation?.anchor?.selector) {
      try { element = document.querySelector(operation.anchor.selector); } catch { /* source expression is not a CSS selector */ }
    }
    return element?.matches('input,textarea,select') && element.getClientRects().length ? descriptor(element) : null;
  }
  function fieldFactsHtml(operation) {
    if (!isFieldOperation(operation)) return '';
    const meta = operation.field_meta || { declared_editability: '', value_bindings: [] };
    const live = liveFieldState(operation);
    const runtime = live || operation.latest_runtime;
    if (!runtime && !meta.declared_editability) return '';
    const editability = runtime?.editability || meta.declared_editability;
    const status = { disabled: '禁用，当前不可操作', readonly: '只读，当前不可修改', editable: '可填写' }[editability] || '待确认';
    const value = runtime?.current_value || '';
    const rows = [`<div><span>状态</span><strong>${escapeHtml(status)}</strong></div>`];
    if (value) rows.push(`<div><span>${live ? '当前显示' : '上次看到'}</span><strong>${escapeHtml(value)}</strong></div>`);
    return `<div class="tr-reading-rows">${rows.join('')}</div>`;
  }
  function sourceDetails(operation) {
    const bindings = operation.field_meta?.value_bindings || [];
    const binding = bindings.length === 1 ? bindings[0] : null;
    const expression = binding?.expression.replace(/\s*\|\|.*$/, '') || '';
    const entity = ({ MOCK_ORDERS: '订单', MOCK_CUSTOMERS: '客户', MOCK_ACCOUNTS: '账号' })[binding?.collection] || '记录';
    const property = expression.match(/^[\w$]+\.([\w$]+)$/)?.[1];
    const source = expression.includes('?') ? '由页面条件分支选择（Demo）；具体字段见来源依据' : binding?.collection?.startsWith('MOCK_') && property ? `当前${entity}的 ${property} 字段（Demo 模拟数据）` : binding?.collection ? `${binding.collection} → ${expression}` : expression;
    const evidence = [operation.anchor?.source, binding?.lookup, binding?.source, binding?.collection_source].filter(Boolean).map((item) => `${item.path}:${item.line}`);
    const path = binding ? `${binding.function_name || '页面逻辑'} → ${binding.collection ? `${binding.collection}.find(当前记录) → ` : ''}${binding.expression} → #${operation.anchor.id}` : '尚未定位到直接赋值；可继续检查组件状态或接口响应。';
    return { source, bindings, binding, evidence, path };
  }
  function fieldValueRole(operation) {
    const observed = liveFieldState(operation) || operation.latest_runtime || null;
    const editability = observed?.editability || operation.field_meta?.declared_editability || 'unknown';
    const value = observed?.current_value || '';
    const hasBinding = !!operation.field_meta?.value_bindings?.length;
    const changedHere = userEditedFields.has(`${route()}|${operation.anchor?.selector || ''}`);
    if (changedHere && !['readonly', 'disabled'].includes(editability)) return isChoiceOperation(operation) ? 'user_selected' : 'user_entered';
    if (isChoiceOperation(operation) && !hasBinding && !value) return 'user_selected';
    if (editability === 'editable' && !hasBinding && !value) return 'user_entered';
    if (hasBinding) return 'prefilled';
    return 'unresolved';
  }
  function sourceQuestionSet(operation, knownSource, valueRole) {
    const type = operationType(operation);
    if (type === 'toggle') return [
      { key: 'source_initial', label: '初始勾选状态由哪份配置提供？', type: 'choice', options: ['套餐配置', '订单权益', '账号单独配置', '固定默认值', '暂未确定'] },
      { key: 'source_field', label: '这项勾选控制哪项业务权限？', type: 'text', placeholder: '例如：允许新建报告' },
    ];
    if (type === 'choice') return knownSource ? [
      { key: 'source_production', label: '正式系统的选项是否沿用这份列表？', type: 'choice', options: ['沿用页面选项', '改由接口或字典提供', '依赖其他字段', '暂未确定'] },
      { key: 'source_field', label: '选项会随哪个业务条件变化？', type: 'text', placeholder: '例如：随客户类型变化' },
    ] : [
      { key: 'source_options', label: '可选项从哪里来？', type: 'choice', options: ['固定列表', 'Mock 数据', '接口返回', '依赖其他字段', '暂未确定'] },
      { key: 'source_field', label: '谁负责维护这些选项？', type: 'text', placeholder: '例如：运营人员在套餐配置中维护' },
    ];
    if (valueRole === 'user_entered') return [];
    return [
      ...(!knownSource ? [{ key: 'source_value', label: '当前值从哪个业务对象带入？', type: 'text', placeholder: '例如：当前订单关联的客户' }] : []),
      { key: 'source_production', label: '正式系统应从哪个业务对象读取？', type: 'text', placeholder: '例如：当前订单关联的客户' },
    ];
  }
  function savedAnswerRows(operationId, predicate, issueId = null) {
    const answers = (state.data?.supplements || []).filter((item) => item.operation_id === operationId && (item.issue_id || null) === issueId).flatMap((item) => item.answers || []).filter((answer) => predicate(answer.key));
    return answers.map((answer) => `<div><span>${escapeHtml(answer.question)}</span><strong>${escapeHtml(answer.value)} <small>人工补充</small></strong></div>`).join('');
  }
  function dataSourceHtml(operation) {
    if (!isFieldOperation(operation)) return '';
    const details = sourceDetails(operation);
    const kind = operationType(operation);
    const valueRole = fieldValueRole(operation);
    const optionSource = operation.option_source;
    const options = (optionSource?.options || []).filter((item) => item.value !== '' && item.text);
    const sourceText = details.source || (details.bindings.length > 1 ? `发现 ${details.bindings.length} 处赋值，需按当前流程核对` : '尚未定位，待核对');
    const sourceRows = kind === 'choice'
      ? `${valueRole === 'prefilled' ? `<div><span>当前选中值</span><strong>${escapeHtml(sourceText)}</strong></div>` : '<div><span>选中值</span><strong>由用户选择</strong></div>'}<div><span>选项来源</span><strong>${optionSource ? `页面初始化写入 ${options.length} 项（Demo）` : '尚未定位，待核对'}</strong></div>${options.length ? `<div><span>当前选项</span><strong>${escapeHtml(options.map((item) => item.text).slice(0, 8).join('、'))}${options.length > 8 ? '…' : ''}</strong></div>` : ''}`
      : valueRole === 'user_entered' ? '<div><span>填写方式</span><strong>用户输入</strong></div>' : `<div><span>${kind === 'toggle' ? '初始状态来源' : '当前值来源'}</span><strong>${escapeHtml(sourceText)}</strong></div>`;
    const code = Object.entries(operation.anchor?.data || {}).find(([key, value]) => /permission|field-code/.test(key) && value && !/['"`]\s*\+|\$\{/.test(value))?.[1];
    const sourceKeys = (key) => /^(source_|options_source$|toggle_source$|production_source$)/.test(key);
    const saved = savedAnswerRows(operation.operation_id, sourceKeys);
    const collectionNote = details.binding?.collection_origin === 'browser_cache_or_default_mock' ? '<div class="tr-detail-text">该模拟集合可能读取浏览器缓存或默认 Mock；当前记录来自哪一支仍需核对。</div>' : '';
    const optionEvidence = optionSource?.source ? `${optionSource.source.path}:${optionSource.source.line} · ${optionSource.initializer}` : '';
    const valueEvidence = details.binding ? `<div class="tr-detail-text">${escapeHtml(details.path)}</div>${collectionNote}<div class="tr-evidence">${escapeHtml(details.evidence.join('；') || '暂无可定位依据')}</div>` : '';
    const evidenceHtml = optionEvidence || valueEvidence ? `<details class="tr-evidence-detail"><summary>来源依据</summary>${optionEvidence ? `<div class="tr-evidence">${escapeHtml(optionEvidence)}</div>` : ''}${valueEvidence}</details>` : '';
    return `<section class="tr-source-facts tr-data-source"><div class="tr-source-heading">${valueRole === 'user_entered' ? '字段数据流' : '数据来源'}</div>${sourceRows}${code ? `<div><span>权限编码</span><strong>${escapeHtml(code)}</strong></div>` : ''}${saved}${evidenceHtml}</section>`;
  }
  function renderClaim(card, claim) {
    const status = claim.confirmation_state || 'ai_pending';
    const action = status === 'ai_pending' ? `<button class="tr-accept" data-claim="${escapeHtml(claim.claim_id)}" data-card="${escapeHtml(card.card_id)}" data-decision="confirmed">确认</button><button data-claim="${escapeHtml(claim.claim_id)}" data-card="${escapeHtml(card.card_id)}" data-decision="rejected">不准确</button>` : `<button data-claim="${escapeHtml(claim.claim_id)}" data-card="${escapeHtml(card.card_id)}" data-decision="ai_pending">重新核对</button>`;
    const audit = claim.evidence_audit;
    const warning = audit && ['missing_or_invalid', 'partially_resolved'].includes(audit.status) ? `<div class="tr-small">引用${audit.status === 'partially_resolved' ? '部分' : ''}无法定位；请在证据核对中检查原文。</div>` : '';
    return `<article class="tr-claim"><div class="tr-claim-head"><span class="tr-pill">${escapeHtml(sectionLabel(claim.section))}</span><strong>${escapeHtml(claim.text)}</strong></div>${warning}<div class="tr-actions">${action}</div><details class="tr-evidence-detail"><summary>详细规则与依据</summary>${claim.detail ? `<div class="tr-detail-text">${escapeHtml(claim.detail)}</div>` : ''}<div class="tr-origin">${escapeHtml(sourceTag(claim.origin))} · ${audit?.status === 'location_verified' ? '位置已核对，内容仍待确认' : audit?.status === 'proposal' ? '技术建议' : '引用待核对'}</div><div class="tr-evidence">${claim.evidence?.length ? escapeHtml(claim.evidence.join('；')) : '暂无可定位依据，属于技术建议'}</div></details></article>`;
  }
  function guidanceFor(operation, card) {
    const kind = operationType(operation);
    const editability = liveFieldState(operation)?.editability || operation.latest_runtime?.editability || operation.field_meta?.declared_editability;
    const optionalFilterInput = isFieldOperation(operation) && !operation.field_meta?.required && liveElement(operation)?.closest('.account-filter-row,.filter-row,.search-bar,.search-form,.filters,.query-form');
    if (isFieldOperation(operation) && ['readonly', 'disabled'].includes(editability)) return { issueId: '', title: '补充修改路径', questions: [
      { key: 'change_path', label: '如果要更换，应通过哪个流程？', type: 'text', placeholder: '例如：到订单变更流程申请' },
    ] };
    if (operation?.component?.status === 'needs_research') return { issueId: '', title: '组件类型待研究', questions: [] };
    const componentQuestions = state.data?.component_questions?.[operation?.component?.id];
    if (componentQuestions?.questions?.length) {
      const answered = new Set((state.data?.supplements || []).filter((item) => item.operation_id === operation.operation_id && !item.issue_id).flatMap((item) => item.answers || []).map((answer) => answer.key));
      const constraints = (card?.claims || []).filter((claim) => claim.section === 'constraint' && claim.confirmation_state !== 'rejected').map((claim) => `${claim.text} ${claim.detail || ''}`).join(' ');
      const observedEffect = (card?.expected_effects || []).some((effect) => effect.target?.trim() && effect.change?.trim() && ['runtime_observed', 'source_observed', 'documented', 'user_supplied'].includes(effect.origin) && effect.evidence_audit?.status === 'location_verified');
      const knownRegion = latestObservedRegion(operation)?.observed_region || linkedPageTarget(operation);
      const questions = componentQuestions.questions.filter((question) => !answered.has(question.key) && !(question.key === 'required' && (optionalFilterInput || operation.field_meta?.required || /必填|选填/.test(constraints))) && !(question.key === 'format' && /格式|字符|长度|唯一|重名/.test(constraints)) && !(question.key === 'validate_at' && /输入时|失焦|提交时/.test(constraints)) && !(question.key === 'selection_mode' && ['single_select', 'multi_select'].includes(operation.component.id)) && !(question.key === 'radio_exclusive' && operation.component.id === 'radio_group') && !(question.key === 'nav_target' && (navigationDestination(operation) || knownRegion)) && !(question.key === 'button_effect' && (observedEffect || navigationDestination(operation) === currentPagePath() || knownRegion)) && !(question.key === 'button_data_change' && (navigationDestination(operation) || knownRegion?.scope === 'page' || (card?.claims || []).some((claim) => claim.section === 'data' && claim.origin === 'source_observed' && claim.evidence_audit?.status === 'location_verified'))));
      return questions.length ? { issueId: '', title: `补充${componentQuestions.label}规则`, questions } : null;
    }
    if (kind === 'expand') return null;
    if (kind === 'toggle') return { issueId: '', title: '补充勾选规则', questions: [
      { key: 'toggle_effect', label: '勾选或取消后，控制哪些功能？', type: 'text', placeholder: '例如：允许使用智能巡查及其子功能' },
      { key: 'toggle_linkage', label: '与上级、下级选项如何联动？', type: 'choice', options: ['上级控制全部子项', '子项可独立选择', '不联动', '暂未确定'] },
      { key: 'toggle_effective', label: '更改什么时候生效？', type: 'choice', options: ['点击后立即生效', '保存当前页面后', '后续创建订单或账号时', '暂未确定'] },
    ] };
    if (kind === 'tab') return { issueId: '', title: '补充视图切换规则', questions: [
      { key: 'tab_content', label: '切换后展示哪组内容？', type: 'text', placeholder: '例如：数据配额配置' },
      { key: 'tab_loading', label: '切换时是否重新获取数据？', type: 'choice', options: ['不重新获取', '每次重新获取', '首次进入时获取', '暂未确定'] },
    ] };
    if (kind === 'choice') return { issueId: '', title: '补充选择规则', questions: [
      { key: 'selection_mode', label: '一次可以选几个？', type: 'choice', options: ['单选', '多选', '暂未确定'] },
      { key: 'dependency', label: '会随哪个字段或模块变化？', type: 'text', placeholder: '例如：客户区域改变后，地域选项变化' },
      { key: 'impact', label: '选中后影响哪个模块或结果？', type: 'text', placeholder: '例如：影响客户标签和统计' },
    ] };
    if (kind === 'field') return { issueId: '', title: '补充字段规则', questions: [
      { key: 'required', label: '什么时候必须填写？', type: 'choice', options: ['总是必填', '选填', '满足条件时必填', '暂未确定'] },
      { key: 'validation', label: '还有哪些格式或唯一性规则？', type: 'text', placeholder: '例如：全局唯一，提交时校验' },
      { key: 'destination', label: '提交后写入哪个对象或接口？', type: 'text', placeholder: '例如：customer.name' },
      { key: 'impact', label: '这个值影响哪个模块？', type: 'text', placeholder: '例如：客户查询、账号显示' },
    ] };
    if (kind === 'action') return { issueId: '', title: '补充点击行为', questions: [
      { key: 'visible_change', label: '点击后当前页面哪里变化？', type: 'text', placeholder: '例如：打开权限配置弹窗' },
      { key: 'data_change', label: '这一步是否修改数据？', type: 'choice', options: ['只打开或切换界面', '会立即修改数据', '暂未确定'] },
    ] };
    return { issueId: '', title: '补充提交结果', questions: [
      { key: 'success', label: '成功后应该出现什么结果？', type: 'text', placeholder: '例如：列表新增一条记录' },
      { key: 'failure', label: '失败时如何提示或回退？', type: 'text', placeholder: '例如：保留输入并显示错误' },
      { key: 'affected', label: '会影响哪些对象或模块？', type: 'text', placeholder: '例如：客户和试用账号' },
    ] };
  }
  function questionHtml(question) {
    const attributes = `data-question-key="${escapeHtml(question.key)}" data-question-label="${escapeHtml(question.label)}"`;
    const control = question.type === 'choice' ? `<select ${attributes}><option value="">请选择</option>${(question.options || []).map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('')}</select>` : `<input type="text" ${attributes} placeholder="${escapeHtml(question.placeholder || '请简短填写')}">`;
    return `<label class="tr-question"><span>${escapeHtml(question.label)}</span>${control}</label>`;
  }
  function issueQuestionsHtml(issue) {
    if (issueKind(issue) !== 'product_question') return '';
    if (!issue.questions?.length) return '';
    return `<details class="tr-evidence-detail"><summary>补充这个待决问题</summary><div data-supplement-form data-issue-id="${escapeHtml(issue.issue_id)}">${issue.questions.slice(0, 4).map(questionHtml).join('')}<p class="tr-inline-error" aria-live="polite"></p><button class="tr-primary" data-action="save-supplement">保存补充</button></div></details>`;
  }
  function issuePromptList(issue) {
    if (issueKind(issue) !== 'product_question') return [];
    if (issue.questions?.length) return issue.questions;
    const text = `${issue.text || ''} ${issue.reason || ''}`;
    if (/唯一性|同名|重名/.test(text)) return [{ key: 'unique_scope', label: '正式环境中，同名范围怎么算？', type: 'choice', options: ['全部客户', '同一租户内', '其他范围', '暂未确定'] }];
    if (/接口|数据来源|选项来源/.test(text)) return [{ key: 'source_or_service', label: '正式数据由哪个接口或服务提供？', type: 'text', placeholder: '可填接口路径或服务名' }];
    return [{ key: 'issue_resolution', label: '这条待核对问题，应该采用什么规则？', type: 'text', placeholder: '用一句话写确定的规则' }];
  }
  function guidanceHtml(operation, card) {
    const allSupplements = (state.data?.supplements || []).filter((item) => item.operation_id === operation.operation_id);
    const saved = allSupplements.filter((item) => !item.issue_id).flatMap((item) => item.answers || []);
    const answered = new Set(saved.map((item) => item.key));
    const source = isFieldOperation(operation) ? sourceQuestionSet(operation, isChoiceOperation(operation) ? !!operation.option_source : !!sourceDetails(operation).source, fieldValueRole(operation)) : [];
    const component = guidanceFor(operation, card)?.questions || [];
    const pageBehavior = currentPageBehavior();
    const isListAction = pageBehavior && (operationType(operation) === 'navigation' || pageBehavior.actions.some((item) => item.operation_id === operation.operation_id));
    const derived = isListAction ? [
      ...(pageBehavior.render?.count_variable ? [{ key: 'list_count_unit', label: '正式列表的总数按什么统计？', type: 'text', placeholder: '例如：按页面展示行数，而不是账号数' }] : []),
      ...(pageBehavior.actions.some((item) => item.search_fields?.length) ? [{ key: 'list_search_scope', label: '正式搜索应覆盖哪些信息？', type: 'text', placeholder: '例如：与 Demo 一致，搜索客户名、登录名、手机和邮箱' }] : []),
    ] : [];
    const issue = candidateIssues(card).find((item) => item.decision === 'candidate' && issueKind(item) === 'product_question' && issuePromptList(item).some((question) => !allSupplements.filter((entry) => entry.issue_id === item.issue_id).flatMap((entry) => entry.answers || []).some((answer) => answer.key === question.key) && !state.skippedQuestions.has(`${operation.operation_id}:${question.key}`)));
    const issueAnswered = new Set(allSupplements.filter((item) => item.issue_id === issue?.issue_id).flatMap((item) => item.answers || []).map((item) => item.key));
    const issueQuestions = (issue ? issuePromptList(issue) : []).filter((question) => !issueAnswered.has(question.key));
    const questions = [...issueQuestions, ...derived, ...source, ...component].filter((question, index, all) => all.findIndex((item) => item.key === question.key) === index && !(issueQuestions.includes(question) ? issueAnswered : answered).has(question.key) && !state.skippedQuestions.has(`${operation.operation_id}:${question.key}`));
    const savedHtml = saved.length ? `<details class="tr-detail-group"><summary>我补充的规则 <span>${saved.length}</span></summary><div class="tr-saved-answers">${savedAnswerRows(operation.operation_id, () => true)}</div></details>` : '';
    const question = questions[0];
    if (!question) return savedHtml;
    const questionIssueId = issueQuestions.includes(question) ? issue.issue_id : '';
    const pending = state.pendingAnswer?.operation_id === operation.operation_id && state.pendingAnswer.key === question.key && (state.pendingAnswer.issue_id || '') === questionIssueId ? state.pendingAnswer : null;
    const others = (state.data?.operations || []).filter((item) => item.operation_id !== operation.operation_id && item.label && item.label === operation.label).length;
    const control = pending ? `<div class="tr-decision-selected"><span>你的回答</span><strong>${escapeHtml(pending.value)}</strong></div><p class="tr-small">应用到当前元素。${others ? `另有 ${others} 处同名元素，需分别核对关联，暂不自动套用。` : ''}</p><div class="tr-actions"><button class="tr-accept" data-action="confirm-answer">保存这条规则</button><button data-action="cancel-answer">重新选择</button></div>` : question.type === 'choice' ? `<div class="tr-answer-options">${(question.options || []).filter((option) => option !== '暂未确定').map((option) => `<button type="button" data-answer-choice="${escapeHtml(option)}" data-answer-key="${escapeHtml(question.key)}" data-answer-label="${escapeHtml(question.label)}" data-answer-issue-id="${escapeHtml(questionIssueId)}">${escapeHtml(option)}</button>`).join('')}</div>` : `<div class="tr-answer-input"><input data-quick-answer-input data-answer-key="${escapeHtml(question.key)}" data-answer-label="${escapeHtml(question.label)}" data-answer-issue-id="${escapeHtml(questionIssueId)}" placeholder="${escapeHtml(question.placeholder || '用一句话回答')}"><button data-action="prepare-answer">确认</button></div>`;
    return `<section class="tr-decision"><div class="tr-decision-kicker">${questionIssueId ? '评审待核对' : '请产品确认'}</div>${questionIssueId ? `<p class="tr-decision-context">${escapeHtml(compact(issue.text, 100))}</p>` : ''}<h4>${escapeHtml(question.label)}</h4>${control}<p class="tr-inline-error" aria-live="polite"></p>${!pending ? '<button class="tr-skip" data-action="skip-answer">暂不确定，先看下一项</button>' : ''}</section>${savedHtml}`;
  }
  function issueFormHtml(open = false) {
    return `<details class="tr-detail-group" ${open ? 'open' : ''}><summary>标记待修改问题</summary><div class="tr-issue-form"><label class="tr-question"><span>哪里不对或缺了什么？</span><input data-issue-field="problem" placeholder="例如：未说明下拉项的来源"></label><label class="tr-question"><span>期望是什么？</span><input data-issue-field="expected" placeholder="例如：由行业字典接口返回"></label><label class="tr-question"><span>影响哪个模块？</span><input data-issue-field="impact" placeholder="例如：客户创建和筛选"></label><p class="tr-inline-error" aria-live="polite"></p><button class="tr-primary" data-action="mark-issue">加入待办</button></div></details>`;
  }
  function pageName() { return compact(document.querySelector('main h1,.page-title,.card-title')?.textContent || [...document.querySelectorAll('.inner-tabs .active,[role="tab"][aria-selected="true"]')].find(visibleElement)?.textContent || document.title || location.pathname, 32); }
  function containerName(operation) {
    const element = operation?.anchor?.id ? document.getElementById(operation.anchor.id) : null;
    const container = element?.closest('.modal-mask,[role="dialog"],.drawer,.modal') || [...document.querySelectorAll('.modal-mask.show,[role="dialog"][open],.drawer.show,.modal.show')].find((item) => item.getBoundingClientRect().width > 0);
    return compact(container?.querySelector('.modal-header h3,.modal-header h2,.drawer-title,[role="heading"]')?.textContent || '', 35);
  }
  function contextText() {
    const operation = currentOperation();
    return [pageName(), containerName(operation), operation && operationTitle(operation, currentCard(operation.operation_id))].filter(Boolean).join(' › ');
  }
  function requirementContext(operation = currentOperation()) {
    const sections = state.data?.data_inventory?.requirement_sections || [];
    const normalize = (value) => String(value || '').replace(/[\s·：:（）()]/g, '').toLowerCase();
    const name = normalize(pageName());
    const page = sections.find((item) => normalize(item.title) === name && item.level >= 2);
    if (!page) return { page: null, children: [], current: null };
    const children = sections.filter((item) => item.path === page.path && item.ancestors.includes(page.title) && item.level === page.level + 1);
    const container = normalize(containerName(operation));
    const label = normalize(operation?.label);
    const current = children.find((item) => container && normalize(item.title) === container) || children.find((item) => label && normalize(item.title) === label) || children.find((item) => label && item.body && normalize(item.body).includes(label)) || null;
    return { page, children, current };
  }
  function requirementGroups(section) {
    if (!section?.body) return [];
    const groups = [{ title: '', items: [] }];
    for (const raw of section.body.split('\n')) {
      const line = raw.trim();
      if (!line || /^\|(?:\s*[-:]|.*\|\s*[-:])/.test(line)) continue;
      if (!/^[-*]|^\d+[.、]/.test(line) && /^.{2,32}[：:]$/.test(line)) { groups.push({ title: line.replace(/[：:]$/, ''), items: [] }); continue; }
      if (/^[-*]\s+|^\d+[.、]\s*/.test(line)) groups.at(-1).items.push(line.replace(/^[-*]\s+|^\d+[.、]\s*/, '').replaceAll('`', ''));
      else if (line.length <= 130 && !line.startsWith('|')) groups.at(-1).items.push(line.replaceAll('`', ''));
    }
    return groups.filter((item) => item.items.length);
  }
  function requirementSummary(section, group, max = 5) {
    const items = (group?.items || []).map((item) => item.replace(/[。；;，,]+$/, ''));
    const separator = items.some((item) => item.length > 18 || /[，；。]/.test(item)) ? '；' : '、';
    const value = items.slice(0, max).join(separator);
    return `<div class="tr-prd-block"><strong>${escapeHtml(section.title)}${group?.title ? ` · ${escapeHtml(group.title)}` : ''}</strong><p>${escapeHtml(value)}${items.length > max ? '等' : ''}</p><span>${escapeHtml(section.path)}:${section.line}</span></div>`;
  }
  function observedLayoutHtml() {
    const visible = (item) => item && item.getBoundingClientRect().width > 0 && item.getBoundingClientRect().height > 0;
    const buttons = [...document.querySelectorAll('button')].filter((item) => !own(item) && visible(item)).map((item) => item.textContent.trim());
    const regions = [];
    if (buttons.some((item) => /^(搜索|查询)$/.test(item)) && document.querySelector('input,select')) regions.push('顶部为查询条件与搜索操作');
    if ([...document.querySelectorAll('table')].some(visible)) regions.push('中部为数据列表');
    if ([...document.querySelectorAll('.pagination,[class*="pagination"]')].some(visible)) regions.push('底部为分页操作');
    const container = containerName(currentOperation());
    if (container) regions.push(`${container}在当前页面以${[...document.querySelectorAll('.drawer.show,.modal-mask.show,[role="dialog"][open],.modal.show')].find(visible)?.matches('.drawer') ? '抽屉' : '弹窗'}显示`);
    return regions.length ? `<section class="tr-reading-section"><h4>当前原型布局</h4><p>${escapeHtml(regions.join('；'))}。</p><div class="tr-small">依据当前页面可见结构；具体间距、颜色和响应式规则仍需设计资料确认。</div></section>` : '';
  }
  function pageRegionMapHtml(spec = null) {
    const visible = (node) => node && !own(node) && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
    const regions = [];
    if (spec?.layout?.length) regions.push(...spec.layout.slice(0, 5).map((item, index) => ({ label: `区域 ${index + 1}`, text: item.text })));
    else {
      const buttons = [...document.querySelectorAll('button')].filter((item) => !own(item) && visible(item)).map((item) => item.textContent.trim());
      if ([...document.querySelectorAll('.inner-tabs,[role="tablist"]')].some(visible)) regions.push({ label: '页签区', text: '在同一业务对象下切换不同内容视图。' });
      if (buttons.some((item) => /^(搜索|查询)$/.test(item))) regions.push({ label: '筛选区', text: '输入或选择条件后搜索；重置可清空条件。' });
      if ([...document.querySelectorAll('table')].some(visible)) regions.push({ label: '列表区', text: '展示当前记录与可执行操作。' });
      if ([...document.querySelectorAll('.pagination,[class*="pagination"]')].some(visible)) regions.push({ label: '分页区', text: '切换列表页码和每页数量。' });
      const dialog = [...document.querySelectorAll('.modal-mask.show,[role="dialog"][open],.drawer.show,.modal.show')].find(visible);
      if (dialog) regions.push({ label: '弹窗', text: `${compact(dialog.querySelector('.modal-header h3,.modal-header h2,.drawer-title,[role="heading"]')?.textContent || '当前操作', 25)}覆盖在列表上，完成或取消后返回页面。` });
    }
    return regions.length ? `<section class="tr-reading-section"><h4>页面怎么展示</h4><div class="tr-region-map">${regions.map((item) => `<div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.text)}</strong></div>`).join('')}</div></section>` : '<section class="tr-reading-section"><h4>页面怎么展示</h4><p class="tr-muted">当前页面区域尚未识别；可点击页面元素逐项查看。</p></section>';
  }
  function visibleElement(node) { return !!node && !own(node) && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0; }
  function liveElement(operation) {
    const choose = (candidates) => {
      const matches = candidates.filter(visibleElement).filter((node) => anchors.matchRuntimeControl([operation], descriptor(node), route()) === operation);
      return matches.length === 1 ? matches[0] : null;
    };
    let element = operation?.anchor?.id ? choose([document.getElementById(operation.anchor.id)]) : null;
    if (!element && operation?.anchor?.selector) {
      try {
        const selector = operation.anchor.selector;
        element = choose([...document.querySelectorAll(selector)]);
      } catch { /* invalid source selector */ }
    }
    if (!element && operation?.anchor?.onclick) element = choose([...document.querySelectorAll('[onclick]')].filter((node) => node.getAttribute('onclick') === operation.anchor.onclick));
    if (!element && operation?.label) element = choose([...document.querySelectorAll('[role="tab"],.inner-tab,.nav-tab')].filter((node) => compact(node.textContent, 90) === operation.label));
    return element;
  }
  function navigationDestination(operation) {
    const source = operation?.anchor?.onclick || '';
    const match = source.match(/(?:location\.(?:href|assign|replace)\s*(?:=|\()|window\.location\s*=)\s*(['"])([^'"]+)\1/);
    const target = operation?.anchor?.href || match?.[2] || '';
    if (!target || /^javascript:/i.test(target)) return '';
    try { return new URL(target, new URL(operation.page_hint || location.pathname, location.origin)).pathname; } catch { return ''; }
  }
  function visibleDialogTitle() {
    const dialog = [...document.querySelectorAll('.modal-mask.show,.modal.show,[role="dialog"]')].find(visibleElement);
    return compact(dialog?.getAttribute('aria-label') || dialog?.querySelector('.modal-header h3,.modal-header h2,.modal-title,.sheet-head strong,.hot-guide-head strong,[role="heading"]')?.textContent || '', 45);
  }
  function pageVisualState() {
    const selected = [...document.querySelectorAll('[role="tab"][aria-selected="true"],.inner-tabs .active,.nav-tab.active')].find(visibleElement);
    const table = [...document.querySelectorAll('table')].find(visibleElement);
    const headers = table ? [...table.querySelectorAll('thead th')].filter(visibleElement).map((item) => compact(item.textContent, 30)).filter(Boolean) : [];
    const rows = table ? [...table.querySelectorAll('tbody tr')].filter((item) => getComputedStyle(item).display !== 'none' && (visibleElement(item) || [...item.children].some(visibleElement))).length : 0;
    const total = [...document.querySelectorAll('.pagination,#accountTotalText,[id$="TotalText"]')].filter(visibleElement).map((item) => compact(item.textContent, 35).match(/共\s*\d+\s*条/)?.[0]).find(Boolean) || '';
    const filters = [...document.querySelectorAll('input:not([type="hidden"]),select,.custom-select,.pkg-cascader')].filter((item) => visibleElement(item) && item.closest('.account-filter-row,.filter-row,.search-bar,.search-form,.filters,.query-form')).map((item) => compact(item.getAttribute('aria-label') || item.getAttribute('placeholder') || item.querySelector('.custom-select-text,.pkg-cascader-text')?.textContent || '', 32).replace(/^请(?:选择|输入)/, '')).filter(Boolean);
    return { selected: compact(selected?.textContent || '', 40), table, headers, rows, total, filters: [...new Set(filters)] };
  }
  function sourceConditionMatches(field) {
    const conditions = field.source_conditions || [];
    if (!conditions.length) return true;
    const edition = [...(document.querySelector('.app-shell')?.classList || [])].find((item) => item.startsWith('edition-'))?.slice(8) || '';
    return conditions.some((condition) => {
      if (/view\s*===?\s*['"](?:platform|domain)['"]/.test(condition)) return false;
      if (edition && new RegExp(`!\\(edition\\s*===?\\s*['"]${edition}['"]\\)`).test(condition)) return false;
      const explicit = condition.match(/edition\s*===?\s*['"]([^'"]+)['"]/);
      return !explicit || !edition || explicit[1] === edition;
    });
  }
  function sourceFieldVisibleNow(field) { return (field.dom_candidates || []).some((candidate) => { try { return [...document.querySelectorAll(candidate.selector)].some((node) => visibleElement(node) && compact(node.textContent)); } catch { return false; } }); }
  function activeDisplayFields() {
    const fields = (state.data?.display_fields || []).filter((field) => field.page_path === currentPagePath() && field.status !== 'removed' && sourceConditionMatches(field));
    const hasBoundValues = fields.some((field) => field.kind === 'display_value' && sourceFieldVisibleNow(field));
    return hasBoundValues ? fields.filter((field) => field.kind !== 'display_value' || sourceFieldVisibleNow(field)) : fields;
  }
  function activeApiFields(operationId = null) { return (state.data?.api_fields || []).filter((field) => (field.page_path === currentPagePath() || operationId && currentPagePath().startsWith('/?screen=') && field.page_path === '/index.html' && field.operation_id === operationId) && field.operation_id === operationId && !field.removed_at); }
  function linkedPageTarget(operation) {
    if (!operation) return null;
    const observation = (state.data?.operation_observations || []).filter((item) => item.operation_id === operation.operation_id).at(-1)?.region_reconciliation?.observed_region;
    if (observation?.scope === 'page' && observation.page_path === currentPagePath()) return observation;
    const link = state.data?.source_region_links?.find((item) => item.trigger_label === operation.label && item.target_region_id === currentPagePath());
    return link ? { scope: 'page', page_path: link.target_region_id, label: operation.label } : null;
  }
  function latestOperationObservation(operation) { return (state.data?.operation_observations || []).filter((item) => item.operation_id === operation?.operation_id).at(-1) || null; }
  function latestObservedRegion(operation) { return latestOperationObservation(operation)?.region_reconciliation || null; }
  function visibleRegionHeadings() {
    const root = document.querySelector('#view,main,.page-content,.main-content') || document.body;
    return [...new Set([...root.querySelectorAll('h1,h2,h3,[class*="section-head"] strong,[class*="section-title"] strong')].filter(visibleElement).map((node) => compact(node.textContent, 36)).filter((value) => value && value.length < 36))].slice(0, 4);
  }
  function interfaceDisplayFields(operation = null) {
    if (operation) {
      const observations = (state.data?.operation_observations || []).filter((item) => item.operation_id === operation.operation_id);
      const region = observations.at(-1)?.region_reconciliation?.observed_region;
      const linked = state.data?.source_region_links?.find((item) => item.trigger_label === operation.label && item.target_region_id === currentPagePath());
      if ((region?.scope === 'page' && region.page_path === currentPagePath()) || linked) return activeDisplayFields();
      if (region?.scope === 'section' && region.page_path === currentPagePath()) return activeDisplayFields().filter((field) => field.kind !== 'display_value' || sourceFieldVisibleNow(field));
      if (region?.scope === 'field') return activeDisplayFields().filter((field) => field.label === region.label);
      if (region?.scope === 'dialog') {
        const labels = new Set(region.field_labels || []);
        return (state.data?.display_fields || []).filter((field) => field.status !== 'removed' && field.kind === 'form_field' && labels.has(field.label) && (field.page_path === currentPagePath() || currentPagePath().startsWith('/?screen=') && field.page_path === '/index.html'));
      }
    }
    const visible = collectDisplayFields();
    const fields = activeDisplayFields().filter((field) => visible.some((item) => item.kind === field.kind && item.label === field.label && (!field.observed_usage || item.usage === field.observed_usage)));
    const fallback = fields.length ? fields : activeDisplayFields().filter((field) => field.kind === 'table_column' && field.default_visible === true);
    const seen = new Set();
    const distinct = fallback.filter((field) => { const key = `${field.kind}:${field.label}:${field.observed_usage || ''}`; if (seen.has(key)) return false; seen.add(key); return true; });
    if (!operation) return distinct;
    const target = liveElement(operation);
    if (!target) {
      if (isFieldOperation(operation)) return distinct.filter((field) => field.label === (operation.field_meta?.label || operation.label));
      if (operationType(operation) === 'submit') {
        const observations = (state.data?.operation_observations || []).filter((item) => item.operation_id === operation.operation_id);
        const order = observations.at(-1)?.context_fields || [];
        const labels = new Set(observations.flatMap((item) => item.context_fields || []));
        const seen = new Set();
        return activeDisplayFields().filter((field) => { if (field.kind !== 'form_field' || !labels.has(field.label) || seen.has(field.label)) return false; seen.add(field.label); return true; }).sort((a, b) => (order.indexOf(a.label) < 0 ? 999 : order.indexOf(a.label)) - (order.indexOf(b.label) < 0 ? 999 : order.indexOf(b.label)));
      }
      return [];
    }
    const source = `${operation.anchor?.selector || ''} ${operation.anchor?.onclick || ''}`;
    const usage = target?.closest('.modal-mask,.modal,.drawer,[role="dialog"]') ? 'form' : target?.closest('.account-filter-row,.filter-row,.search-bar,.search-form,.filters,.query-form,.search-grid,.inline-search-body,[class*="search-"],[class*="filter-"]') ? 'filter' : target?.closest('table') ? 'display' : /(?:add|edit|create|modal)/i.test(source) ? 'form' : /(?:search|filter|query)/i.test(source) ? 'filter' : null;
    const inContext = usage ? distinct.filter((field) => usage === 'display' ? field.kind !== 'form_field' : field.kind === 'form_field' && (!field.observed_usage || field.observed_usage === usage)) : distinct;
    if (isFieldOperation(operation)) {
      const label = operation.field_meta?.label || operation.label;
      const matched = inContext.filter((field) => field.label === label);
      if (matched.length) return matched;
      const sameName = distinct.filter((field) => field.label === label);
      if (sameName.length) return sameName;
    }
    return inContext.length ? inContext : distinct;
  }
  function collectDisplayFields() {
    const fields = [];
    const sampleSafe = (label, value) => /手机号|邮箱|电话|身份证|密码|密钥|token/i.test(label) || /@|\b1\d{10}\b/.test(value) ? '示例已脱敏' : compact(value, 60);
    const add = (kind, node, sample = '') => {
      if (own(node) || !visibleElement(node) || kind === 'form_field' && node.closest('.pagination,[class*="pagination"],[class*="pager"]')) return;
      const label = compact(node.textContent || '', 80).replace(/\s*\*\s*$/, '');
      const usage = kind === 'form_field' ? node.closest('.account-filter-row,.filter-row,.search-bar,.search-form,.filters,.query-form,.search-grid,.inline-search-body,[class*="search-"],[class*="filter-"]') ? 'filter' : 'form' : 'display';
      if (label && !fields.some((item) => item.kind === kind && item.label === label && item.usage === usage)) fields.push({ kind, label, visible: true, sample: sampleSafe(label, sample), usage });
    };
    for (const table of document.querySelectorAll('table')) {
      if (own(table) || !visibleElement(table)) continue;
      const row = [...table.querySelectorAll('tbody tr')].find(visibleElement);
      for (const [index, node] of [...table.querySelectorAll('thead th')].entries()) add('table_column', node, row?.children[index]?.textContent || '');
    }
    for (const node of document.querySelectorAll('label')) add('form_field', node);
    for (const node of document.querySelectorAll('dt')) add('detail_field', node, node.nextElementSibling?.textContent || '');
    for (const field of activeDisplayFields()) if (field.kind === 'display_value' && sourceFieldVisibleNow(field)) fields.push({ kind: 'display_value', label: field.label, key: field.source_key, visible: true, usage: 'display' });
    return fields.slice(0, 120);
  }
  function scheduleFieldInventory() {
    clearTimeout(fieldInventoryTimer);
    fieldInventoryTimer = setTimeout(() => {
      if (!state.data) return;
      const pagePath = currentPagePath();
      const change = [...(state.data.prototype_changes || [])].reverse().find((item) => item.affected_pages?.includes(pagePath));
      if (change?.affected_pages?.includes(pagePath) && Date.parse(change.created_at) > loadedAt) return;
      const fields = collectDisplayFields();
      const signature = JSON.stringify([state.data.source_snapshot_id, pagePath, fields]);
      if (signature === lastFieldSignature) return;
      lastFieldSignature = signature;
      api('/display-fields', { method: 'POST', body: JSON.stringify({ page_path: pagePath, loaded_at: new Date(loadedAt).toISOString(), fields }) }).then(refresh).catch(() => { lastFieldSignature = ''; });
    }, 650);
  }
  function sourceChangeHtml() {
    const change = [...(state.data?.prototype_changes || [])].reverse().find((item) => item.affected_pages?.includes(currentPagePath()));
    const affected = change?.affected_pages?.includes(currentPagePath());
    const currentRules = (state.data?.rules || []).filter((item) => !item.superseded_by && item.page_path === currentPagePath() && item.review_status === 'prototype_changed').length;
    const reload = affected && Date.parse(change.created_at) > loadedAt;
    return `<div class="tr-source-sync"><span>${reload ? '原型文件已变化，请刷新页面查看新版；旧页面的字段不会重新写入索引。' : affected ? `原型已更新：新增 ${change.added_field_ids?.length || 0} 项、修改 ${change.changed_field_ids?.length || 0} 项、移除 ${change.removed_field_ids?.length || 0} 项展示字段；${currentRules} 条确认规则需复核。` : '页面字段以当前原型为准；修改原型后会自动同步。'}</span><button data-action="${reload ? 'reload-prototype' : 'sync-source'}">${reload ? '刷新原型' : '同步原型'}</button></div>`;
  }
  function displayFieldsHtml(technical = false) {
    const fields = activeDisplayFields();
    const mapped = new Set((state.data?.api_fields || []).filter((item) => !item.removed_at).map((item) => item.display_field_id));
    return `<section class="tr-reading-section tr-display-fields"><h4>页面展示字段 · ${fields.length}</h4><p class="tr-small">字段是否存在由原型决定；Mock 和页面只证明展示要求，正式接口字段仍需技术映射。</p>${fields.length ? `<div class="tr-field-grid">${fields.slice(0, 80).map((field) => `<div class="tr-field-row"><strong>${escapeHtml(field.label)}</strong><span>${escapeHtml(field.kind === 'table_column' ? '列表列' : field.kind === 'form_field' ? field.observed_usage === 'filter' ? '筛选字段' : '表单字段' : field.kind === 'display_value' ? '页面数据' : '详情字段')} · ${field.default_visible === true ? '默认显示' : field.default_visible === false ? '默认隐藏，可配置' : field.runtime_visible ? '当前可见' : '源码候选，待页面核对'}${field.ui_only ? ' · 前端呈现' : ''}${field.status === 'needs_review' ? ' · 原型变化待复核' : ''}</span>${field.observed_sample ? `<small>页面示例：${escapeHtml(field.observed_sample)}</small>` : ''}${technical ? `<small>${field.ui_only ? '无需接口字段' : mapped.has(field.field_id) ? '已映射接口字段' : field.kind === 'form_field' ? field.observed_usage === 'filter' ? '待确认查询参数' : '待确认提交字段' : '待映射响应或计算来源'}</small>` : field.source_key ? `<small>源码键：${escapeHtml(field.source_key)}（不等于正式接口字段）${field.binding_candidates?.length ? `；绑定候选：${escapeHtml(field.binding_candidates.map((item) => item.expression).join('、'))}` : ''}</small>` : ''}</div>`).join('')}</div>` : '<p class="tr-muted">当前还没有识别到展示字段；打开含列表或表单的页面后会补充。</p>'}</section>`;
  }
  function measuredStyle(node) {
    const rect = node.getBoundingClientRect();
    const css = getComputedStyle(node);
    const round = (value) => Math.round(value * 10) / 10;
    return { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height), font: `${css.fontSize} / ${css.lineHeight} · ${css.fontWeight}`, family: css.fontFamily.split(',')[0].replaceAll('"', ''), color: css.color, background: css.backgroundColor, padding: css.padding, border: css.border, radius: css.borderRadius, display: css.display, position: css.position };
  }
  function frontendVisualHtml(operation = null) {
    const element = liveElement(operation);
    const state = pageVisualState();
    const measured = element ? measuredStyle(element) : null;
    const candidates = [['页签', '.inner-tabs,[role="tablist"]'], ['筛选区', '.account-filter-row,.filter-row,.search-bar,.search-form'], ['列表', 'table'], ['分页', '.pagination']];
    const regions = candidates.map(([label, selector]) => [label, [...document.querySelectorAll(selector)].find(visibleElement)]).filter(([, node]) => node).map(([label, node]) => ({ label, ...measuredStyle(node) }));
    const detailNodes = [...document.querySelectorAll('.account-filter-row input,.account-filter-row .custom-select,.filter-row input,.filter-row .custom-select,table thead th')].filter(visibleElement).slice(0, 16);
    const details = detailNodes.map((node) => {
      const label = compact(node.getAttribute('aria-label') || node.getAttribute('placeholder') || node.querySelector('.custom-select-text')?.textContent || node.textContent, 24).replace(/^请(?:选择|输入)/, '');
      return { label: label || node.tagName.toLowerCase(), ...measuredStyle(node) };
    });
    const rows = measured ? `<div class="tr-reading-rows"><div><span>位置</span><strong>x ${measured.x} · y ${measured.y} px</strong></div><div><span>尺寸</span><strong>${measured.width} × ${measured.height} px</strong></div><div><span>文字</span><strong>${escapeHtml(measured.font)} · ${escapeHtml(measured.family)}</strong></div><div><span>颜色</span><strong>${escapeHtml(measured.color)} · 背景 ${escapeHtml(measured.background)}</strong></div></div><details class="tr-evidence-detail"><summary>其他 CSS 属性</summary><div class="tr-reading-rows"><div><span>内边距</span><strong>${escapeHtml(measured.padding)}</strong></div><div><span>边框</span><strong>${escapeHtml(measured.border)}</strong></div><div><span>圆角</span><strong>${escapeHtml(measured.radius)}</strong></div><div><span>布局</span><strong>${escapeHtml(measured.display)} · ${escapeHtml(measured.position)}</strong></div></div></details>` : '<p class="tr-muted">当前页面找不到该元素，先打开对应页面后可读取精确样式。</p>';
    return `<section class="tr-tech-section"><h4>前端 · 元素与布局</h4><p class="tr-small">当前视口 ${innerWidth} × ${innerHeight} px 的 DOM/CSS 实测值；滚动或屏幕宽度变化后会重算。</p>${operation ? rows : ''}${regions.length ? `<details class="tr-evidence-detail"><summary>页面区域尺寸</summary><div class="tr-reading-rows">${regions.map((item) => `<div><span>${escapeHtml(item.label)}</span><strong>x ${item.x} · y ${item.y} · ${item.width} × ${item.height} px</strong></div>`).join('')}</div></details>` : ''}${details.length ? `<details class="tr-evidence-detail"><summary>筛选控件与表头样式 · ${details.length}</summary><div class="tr-reading-rows">${details.map((item) => `<div><span>${escapeHtml(item.label)}</span><strong>${item.width} × ${item.height} px · ${escapeHtml(item.font)} · ${escapeHtml(item.color)}</strong></div>`).join('')}</div></details>` : ''}${state.selected ? `<p class="tr-small">当前选中：${escapeHtml(state.selected)}</p>` : ''}</section>`;
  }
  function currentPageBehavior() {
    return (state.data?.page_behaviors || []).find((item) => `/${item.path}` === currentPagePath()) || null;
  }
  function readableField(expression) {
    const field = String(expression || '').split('.').at(-1);
    const names = { name: '名称', loginName: '登录名称', phone: '手机号', email: '邮箱', customerId: '客户 ID', createdAt: '创建时间' };
    return expression.startsWith('customer.') && field === 'name' ? '客户名称' : names[field] || field || expression;
  }
  function sourceBehaviorHtml(behavior) {
    const search = behavior?.actions?.find((item) => /^search/i.test(item.handler) && item.evidence_status === 'source_observed');
    if (!search) return '';
    const scope = search.search_fields?.length ? search.search_fields.map(readableField).join('、') : '';
    const helpers = search.helpers || [];
    const rows = [];
    if (scope) rows.push(['关键词范围', scope, `${search.source.path}:${search.source.line}`]);
    if (helpers.some((name) => /PackageMatch/i.test(name))) rows.push(['套餐筛选', '按账号与套餐的匹配规则筛选', `${search.source.path}:${search.source.line}`]);
    if (helpers.some((name) => /ProductStatus/i.test(name))) rows.push(['服务状态', '按账号下的产品行状态筛选', `${search.source.path}:${search.source.line}`]);
    if (!rows.length) return '';
    return `<div class="tr-reading-rows">${rows.map(([label, value, source]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)} <small>源码 ${escapeHtml(source)}</small></strong></div>`).join('')}</div>`;
  }
  function frontendBehaviorHtml(operation = null) {
    const view = pageVisualState();
    const behavior = currentPageBehavior();
    const kind = operation && operationType(operation);
    const destination = operation && navigationDestination(operation);
    const reached = destination && destination === currentPagePath() || !!linkedPageTarget(operation);
    const searchAction = behavior?.actions?.find((item) => item.operation_id === operation?.operation_id && /^search/i.test(item.handler));
    const trigger = !operation ? '进入当前页面' : kind === 'navigation' || linkedPageTarget(operation) ? `点击“${operation.label}”并进入目标页` : searchAction ? '点击搜索，按当前条件刷新列表' : `操作“${operation.label}”`;
    const visible = [view.selected ? `${view.selected}页签已选中` : '', view.filters.length ? `${view.filters.length} 个筛选项` : '', view.table ? `${view.rows} 行、${view.headers.length} 列` : '', view.total].filter(Boolean).join('；');
    const card = operation && currentCard(operation.operation_id);
    const latestObservation = operation && state.data?.operation_observations?.filter((item) => item.operation_id === operation.operation_id).at(-1);
    const observed = card?.expected_effects?.find((item) => item.evidence_audit?.valid?.some((reference) => /^trace_/.test(reference)))?.change
      || card?.expected_effects?.find((item) => item.origin === 'runtime_observed' && item.evidence_audit?.valid?.length)?.change
      || card?.claims?.find((item) => item.origin === 'runtime_observed' && item.evidence_audit?.valid?.length)?.text;
    const recorded = latestObservation
      ? latestObservation.message || (latestObservation.page_changed ? '页面内容已变化，具体结果请结合原型核对' : '本次操作已记录，未识别到页面变化')
      : observed || '';
    const inCurrentContext = !operation || !!liveElement(operation) || reached;
    const current = inCurrentContext && (reached || !operation || behavior?.actions?.some((item) => item.operation_id === operation.operation_id)) ? visible || '当前页面状态尚未识别' : recorded || '当前操作的页面结果仍需实际验证';
    const resultSource = latestObservation?.message ? '最近一次操作' : recorded && !inCurrentContext ? '已记录操作' : '当前页面实测';
    const hasZeroMatch = card?.claims?.some((item) => /没有命中|零命中/.test(item.text));
    const pending = kind === 'submit' ? `<div><span>待实测</span><strong>${hasZeroMatch ? '零命中时的页面反馈' : '未覆盖的校验与异常分支'}</strong></div><div><span>待技术定义</span><strong>正式接口失败处理与重试</strong></div>` : '';
    return `<section class="tr-tech-section"><h4>前端 · 操作与页面状态</h4><div class="tr-reading-rows"><div><span>触发</span><strong>${escapeHtml(trigger)}</strong></div><div><span>当前结果</span><strong>${escapeHtml(current)} <small>${resultSource}</small></strong></div>${pending}</div>${sourceBehaviorHtml(behavior)}<p class="tr-small">源码规则只说明 Demo 当前行为；正式产品规则需要确认。</p></section>`;
  }
  function sharedContractHtml(operation = null) {
    const view = pageVisualState();
    const behavior = currentPageBehavior();
    const page = currentPagePath().replace(/^\//, '');
    const requests = (state.data?.data_inventory?.requests || []).filter((item) => item.path === page);
    const localStorageClaim = operation && currentCard(operation.operation_id)?.claims?.some((item) => item.section === 'data' && /本机存储|浏览器存储|localStorage/.test(`${item.text} ${item.detail}`));
    const observedMethod = requests.length ? `源码发现 ${requests.slice(0, 2).map((item) => item.url).join('、')}；是否用于本操作待核对` : localStorageClaim ? 'Demo 使用本机存储；正式方法与路径待定义' : operation && isFieldOperation(operation) ? '所属操作的方法与路径待技术定义' : '待技术定义';
    const contract = state.data?.contracts?.find((item) => item.page_path === currentPagePath() && item.operation_id === (operation?.operation_id || null));
    const decided = (slot) => contract?.decisions?.[slot]?.text || latestRule('technical', operation?.operation_id, slot)?.text;
    const fixedIds = new Set(interfaceDisplayFields(operation).map((item) => item.field_id));
    const structuredFields = operation ? [...activeApiFields(null).filter((item) => fixedIds.has(item.display_field_id)), ...activeApiFields(operation.operation_id)] : activeApiFields(null);
    const hasRequest = structuredFields.some((item) => item.direction !== 'response');
    const hasResponse = structuredFields.some((item) => item.direction === 'response');
    const remaining = [['method_path', '方法与路径'], ['request', '请求字段'], ['response', '响应结构'], ['auth', '鉴权'], ['errors', '异常处理']].filter(([slot]) => !decided(slot) && !(slot === 'request' && hasRequest) && !(slot === 'response' && hasResponse)).map(([, label]) => label);
    const listPage = !operation && !!view.table;
    const count = behavior?.render?.count_variable;
    const responseShape = decided('response') || (listPage ? '建议 items[] 与 total；正式结构待技术确认' : '待技术定义');
    const selectedField = operation && isFieldOperation(operation);
    const filterField = selectedField && interfaceDisplayFields(operation).some((field) => field.observed_usage === 'filter');
    const fieldPurpose = filterField ? `查询${pageName()}（当前字段：${operation.label}）` : `${containerName(operation) || pageName()}表单（当前字段：${operation.label}）`;
    const purpose = decided('api_name') || (selectedField ? fieldPurpose : operation ? operationTitle(operation, currentCard(operation.operation_id)) : view.table ? `查询${pageName()}列表` : pageName());
    const open = state.expandedContract || state.ruleDraft?.scope === 'technical' && ['api_name', 'method_path', 'request', 'response', 'auth', 'errors'].includes(state.ruleDraft.slot);
    return `<section class="tr-tech-section tr-contract"><div class="tr-contract-head"><h4>接口契约</h4><span>${remaining.length ? `草案 · ${remaining.length} 项待定` : '关键项已确认'}</span></div>${selectedField ? '<p class="tr-small">当前字段属于所属操作，不单独代表一个接口。</p>' : ''}<div class="tr-reading-rows"><div><span>用途</span><strong>${escapeHtml(purpose)}</strong></div><div><span>方法／路径</span><strong>${escapeHtml(decided('method_path') || observedMethod)}</strong></div>${listPage || decided('response') ? `<div><span>响应包裹</span><strong>${escapeHtml(responseShape)}</strong></div>` : ''}${listPage ? `<div><span>总数口径</span><strong>${escapeHtml(count ? `Demo 取 ${count}.length；正式口径待产品确认` : '待产品确认')}</strong></div>` : ''}</div>${apiFieldsHtml(operation)}<details class="tr-contract-decisions" data-interface-decisions ${open ? 'open' : ''}><summary>编辑接口用途、路径、权限和异常</summary>${technicalRuleSectionHtml(operation, 'contract')}</details>${remaining.length ? `<div class="tr-contract-pending"><strong>仍待确定</strong><span>${escapeHtml(remaining.join('、'))}</span></div>` : ''}</section>`;
  }
  function backendImplementationHtml(operation = null) {
    const behavior = currentPageBehavior();
    const collection = behavior?.collection;
    const search = behavior?.actions?.find((item) => /^search/i.test(item.handler) && item.evidence_status === 'source_observed');
    const rows = [];
    const cardData = operation ? (currentCard(operation.operation_id)?.claims || []).filter((item) => item.section === 'data' && item.origin === 'source_observed' && item.evidence_audit?.valid?.length).slice(0, 4) : [];
    for (const item of cardData) rows.push([item.text, item.detail || item.text, { path: item.evidence[0]?.split(':')[0] || '', line: item.evidence[0]?.split(':')[1] || '' }]);
    if (collection) rows.push(['Demo 数据', `${collection.name}${collection.storage_keys.length ? `；浏览器缓存 ${collection.storage_keys.join('、')}` : ''}${collection.default_samples ? '；另有默认样例' : ''}`, collection.definition]);
    if (search?.collection) rows.push(['查询链路', `${search.handler}() 读取 ${search.collection} 并按当前对象筛选`, search.source]);
    if (behavior?.render?.count_variable) rows.push(['展示行数', `${behavior.render.handler}() 以 ${behavior.render.count_variable}.length 计数${behavior.render.sort_field ? `；按 ${readableField(behavior.render.sort_field)} 排序` : ''}`, behavior.render.source]);
    const pending = operation && operationType(operation) === 'submit' ? '正式保存接口、请求与响应字段、权限、失败处理和重试规则' : '正式数据源、权限与数据隔离；列表行展开、状态计算和计数由哪一端负责；排序分页、异常及性能边界';
    return `<section class="tr-tech-section"><h4>Demo 处理与后端待定</h4>${rows.length ? `<div class="tr-reading-rows">${rows.map(([label, value, source]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)} <small>${escapeHtml(source ? `${source.path}:${source.line}` : '')}</small></strong></div>`).join('')}</div>` : '<p class="tr-muted">当前操作的读取、计算或写入链路尚未定位。</p>'}<div class="tr-contract-pending"><strong>技术待定</strong><span>${escapeHtml(pending)}</span></div><p class="tr-small">以上是 Demo 的本地处理线索，不等于正式后端实现。</p></section>`;
  }
  function visualEvidenceHtml(operation = null) {
    return `<details class="tr-detail-group tr-visual-evidence"><summary>视觉实测与源码依据</summary>${frontendVisualHtml(operation)}<div class="tr-small">坐标和样式只对应当前视口；其他尺寸需另测响应式表现。</div></details>`;
  }
  function jobHtml(operation, card) {
    const job = state.data?.jobs?.find((item) => item.job_id === state.activeJobId && item.operation_id === operation?.operation_id && item.source_snapshot_id === state.data?.source_snapshot_id) || state.data?.jobs?.filter((item) => item.operation_id === operation?.operation_id && item.source_snapshot_id === state.data?.source_snapshot_id).at(-1);
    if (job && ['queued', 'analyzing', 'validating'].includes(job.status)) return `<div class="tr-update-status">这一步正在补全说明 · ${escapeHtml(statusLabel(job.status))}。可先查看下方的页面与源码线索。${jobTimingHtml(job)}</div>`;
    if (job?.status === 'failed' && !card) return `<div class="tr-update-status">解读失败：${escapeHtml(job.error || '可稍后重试')}${jobTimingHtml(job)}</div>`;
    if (job?.status === 'returned' && card && jobTimingText(job)) return `<div class="tr-generation-time">卡片已生成${jobTimingHtml(job)}</div>`;
    if (state.data?.ai_enabled && !card && operation) return `<div class="tr-update-status">这一步还没有完整解读。已显示可定位的线索；${state.data.model_mode === 'conversation' ? '点击后进入待解析队列，当前对话处理后显示结果。' : '点击后会在后台补全。'}</div>`;
    return '';
  }
  function ruleEditorHtml(scope, slot) {
    const draft = state.ruleDraft;
    if (!draft || draft.scope !== scope || draft.slot !== slot || draft.operation_id !== (state.scope === 'page' ? null : state.activeOperationId || null)) return '';
    const prompt = scope === 'product' ? `${draft.mode === 'replace' ? '纠正' : '补充'}“${draft.label}”的业务规则、适用条件或验收方式` : `填写“${draft.label}”的技术决定、字段或接口约定`;
    const initial = draft.mode === 'replace' && draft.previous_text !== '待技术确认' ? draft.previous_text : '';
    return `<div class="tr-rule-editor" data-rule-editor-scope="${escapeHtml(scope)}" data-rule-editor-slot="${escapeHtml(slot)}"><div class="tr-small">当前说明：${escapeHtml(compact(draft.previous_text || '尚未明确', 180))}</div><label>${escapeHtml(prompt)}<textarea data-rule-text rows="3" placeholder="${escapeHtml(scope === 'product' ? '例如：仅展示当前客户的有效账号；停用账号另行筛选' : '例如：GET /customers/{id}/accounts，返回 items 和 total')}">${escapeHtml(draft.value ?? initial)}</textarea></label><div class="tr-actions"><button class="tr-accept" data-action="save-rule">保存并更新文档</button><button data-action="cancel-rule">取消</button></div><p class="tr-inline-error" aria-live="polite"></p></div>`;
  }
  function technicalRuleSectionHtml(operation = null, category = 'implementation') {
    const contract = category === 'contract';
    const slots = contract ? operation ? [['method_path', '方法与路径'], ['request', '请求组合与约束'], ['response', '响应包裹与状态码'], ['auth', '权限与认证'], ['errors', '异常与重试']] : [['api_name', '接口名称与用途'], ['method_path', '方法与路径'], ['request', '请求组合与约束'], ['response', '响应包裹与状态码'], ['auth', '权限与认证'], ['errors', '异常与重试']] : [['frontend', '前端状态与处理'], ['backend', '后端规则与数据']];
    const rows = slots.map(([slot, label]) => { const saved = latestRule('technical', operation?.operation_id || null, slot); return `<div class="tr-rule-item"><div><span>${escapeHtml(label)}</span><strong>${escapeHtml(saved?.text || '待技术确认')}${saved?.review_status === 'prototype_changed' ? ' · 原型变化待复核' : ''}</strong></div><button data-edit-rule="technical" data-rule-slot="${slot}" data-rule-label="${escapeHtml(label)}" data-rule-mode="replace">${saved ? '调整' : '补充'}</button></div>${ruleEditorHtml('technical', slot)}`; }).join('');
    if (contract) return `<div class="tr-contract-rule-list"><p class="tr-small">字段 ID、类型及说明在上方逐行核对；这里补充接口整体约定。</p>${rows}</div>`;
    return `<section class="tr-tech-section tr-rule-section"><h4>前端与后端实现补充</h4><p class="tr-small">补充页面状态及服务端规则；保存后同步到项目技术方案。</p>${rows}</section>`;
  }
  function apiFieldEditorHtml() {
    const draft = state.apiDraft;
    if (!draft) return '';
    const fixed = activeDisplayFields().find((field) => field.field_id === draft.fixed_display_field_id);
    const option = (value, label, selected) => `<option value="${escapeHtml(value)}" ${selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    const name = fixed ? `<label>字段名称（来自原型）<input data-api-input="label" value="${escapeHtml(fixed.label)}" readonly></label>` : `<label>字段名称<input data-api-input="label" value="${escapeHtml(draft.label || '')}" placeholder="例如 登录名称"></label>`;
    const mapping = fixed ? `<p class="tr-small">对应页面字段：${escapeHtml(fixed.label)}。这个字段固定存在，名称随原型同步。</p>` : `<label>对应页面展示字段<select data-api-input="display_field_id">${option('', '不直接对应页面字段', !draft.display_field_id)}${activeDisplayFields().filter((field) => !field.ui_only).map((field) => option(field.field_id, field.label, draft.display_field_id === field.field_id)).join('')}</select></label>`;
    return `<div class="tr-api-editor"><h5>${draft.field_id ? '调整接口字段' : fixed ? '确认原型字段的接口映射' : '新增接口字段'}</h5>${fixed ? '<p class="tr-small">原型已决定这个字段需要呈现；这里核对接口字段 ID、位置、类型和说明。</p>' : ''}<label>字段位置<select data-api-input="direction">${[['response','成功响应'],['path','路径参数'],['query','查询参数'],['header','请求头'],['body','请求体'],['context','服务端上下文']].map(([value,label]) => option(value,label,draft.direction === value)).join('')}</select></label><label>字段 ID / JSON 路径<input data-api-input="key" value="${escapeHtml(draft.key || '')}" placeholder="例如 items[].loginName"></label>${name}<label>字段说明<input data-api-input="description" value="${escapeHtml(draft.description || '')}" placeholder="说明含义、取值及用途"></label><div class="tr-api-two"><label>类型<select data-api-input="type">${['string','integer','number','boolean','object','array'].map((value) => option(value,value,draft.type === value)).join('')}</select></label><label>示例值<input data-api-input="example" value="${escapeHtml(draft.example || '')}" placeholder="可留空"></label></div><div class="tr-api-two"><label><input type="checkbox" data-api-input="required" ${draft.required ? 'checked' : ''}> 必有</label><label><input type="checkbox" data-api-input="nullable" ${draft.nullable ? 'checked' : ''}> 可为 null</label></div>${mapping}<p class="tr-inline-error" aria-live="polite"></p><div class="tr-actions"><button class="tr-accept" data-action="save-api-field">保存字段</button><button data-action="cancel-api-field">取消</button></div></div>`;
  }
  function apiFieldsHtml(operation = null) {
    const operationId = operation?.operation_id || null;
    const fixed = interfaceDisplayFields(operation);
    const fixedIds = new Set(fixed.map((field) => field.field_id));
    const fields = operationId ? [...activeApiFields(null).filter((field) => fixedIds.has(field.display_field_id)), ...activeApiFields(operationId)] : activeApiFields(null);
    const mapped = (field) => fields.filter((item) => item.display_field_id === field.field_id).at(-1);
    const location = (field) => field.kind === 'table_column' ? '列表展示' : field.kind === 'detail_field' ? '详情展示' : field.kind === 'display_value' ? '页面展示' : field.observed_usage === 'filter' ? '筛选条件' : '表单填写';
    const candidateDescription = (field) => `${field.kind === 'table_column' ? '列表显示当前值' : field.kind === 'detail_field' ? '详情显示当前值' : field.kind === 'display_value' ? '页面显示该数据；正式接口映射待核对' : field.observed_usage === 'filter' ? '作为查询条件，匹配规则待核对' : field.control_type === 'switch' ? '开关选择；提交时应映射为布尔值' : field.control_type === 'select' ? '从选项中选择；提交规则待核对' : '由用户填写；提交规则待核对'}${field.observed_sample ? `；Demo 示例：${field.observed_sample}` : ''}`;
    const directionLabel = { response: '响应', path: '路径', query: '查询', header: '请求头', body: '请求体', context: '服务端上下文' };
    const fieldStatus = (field, match) => field.ui_only ? '前端生成 · 无需接口' : match ? `已确认 · ${directionLabel[match.direction] || match.direction} · ${match.type}${match.review_status === 'prototype_changed' ? ' · 原型变化待复核' : ''}` : `${field.kind === 'form_field' ? field.observed_usage === 'filter' ? '查询参数候选' : '请求体候选' : '响应字段候选'} · ID/类型待定${field.source_key ? field.runtime_visible ? ' · 源码与页面可见' : ' · 源码推断，待页面核对' : ''}`;
    const fixedRow = (field, grouped = false) => {
      const match = mapped(field);
      const key = field.ui_only ? '前端生成' : match?.key || field.source_key || '待定义';
      const edit = field.ui_only ? '' : `<button class="tr-api-inline-edit" data-prefill-api-field="${escapeHtml(field.field_id)}" title="编辑接口映射" aria-label="编辑${escapeHtml(field.label)}的${escapeHtml(location(field))}接口映射">✎</button>`;
      return `<div class="tr-api-row tr-api-fixed${grouped ? ' tr-api-subrow' : ''}"><div class="tr-api-main"><code class="${key === '待定义' ? 'tr-api-key-pending' : ''}">${escapeHtml(key)}</code><strong>${escapeHtml(grouped ? location(field) : field.label)}</strong><span>${escapeHtml(match?.description || candidateDescription(field))}</span></div><div class="tr-api-meta">${escapeHtml(grouped ? fieldStatus(field, match) : `${location(field)} · ${fieldStatus(field, match)}`)}${field.default_visible === false ? ' · 默认隐藏' : ''}</div>${edit}${state.apiDraft?.fixed_display_field_id === field.field_id ? apiFieldEditorHtml() : ''}</div>`;
    };
    const groups = new Map();
    for (const field of fixed) { if (!groups.has(field.label)) groups.set(field.label, []); groups.get(field.label).push(field); }
    const fixedRows = [...groups].map(([label, items]) => {
      if (items.length === 1) return fixedRow(items[0]);
      const contexts = [...new Set(items.map(location))].join('、');
      const groupId = `${currentPagePath()}:${label}`;
      const open = state.expandedApiGroups.has(groupId) || items.some((field) => state.apiDraft?.fixed_display_field_id === field.field_id);
      return `<div class="tr-api-group"><div class="tr-api-main tr-api-group-main"><code>${items.length} 个用途</code><strong>${escapeHtml(label)}</strong><span>${escapeHtml(contexts)}</span></div><details data-api-group="${escapeHtml(groupId)}" ${open ? 'open' : ''}><summary>查看各场景</summary>${items.map((field) => fixedRow(field, true)).join('')}</details></div>`;
    }).join('');
    const extras = fields.filter((field) => !fixedIds.has(field.display_field_id));
    const extraRows = extras.map((field) => `<div class="tr-api-row"><div class="tr-api-main"><code>${escapeHtml(field.key)}</code><strong>${escapeHtml(field.label)}</strong><span>${escapeHtml(field.description)}</span></div><div class="tr-api-meta">${escapeHtml(({response:'响应',path:'路径',query:'查询',header:'请求头',body:'请求体',context:'服务端上下文'})[field.direction])} · ${escapeHtml(field.type)} · ${field.required ? '必有' : '可选'}${field.nullable ? ' · 可空' : ''}${field.display_field_id ? ' · 对应其他页面状态的原型字段' : ' · 技术新增'}${field.review_status === 'prototype_changed' ? ' · 原型变化待复核' : ''}</div><div class="tr-actions"><button data-edit-api-field="${escapeHtml(field.field_id)}">调整</button>${field.display_field_id ? '' : state.removeApiFieldId === field.field_id ? `<button class="tr-accept" data-action="confirm-remove-api-field" data-field-id="${escapeHtml(field.field_id)}">确认移除</button>` : `<button data-action="remove-api-field" data-field-id="${escapeHtml(field.field_id)}">移除</button>`}</div></div>`).join('');
    const fixedHeading = operation ? `当前操作字段 · ${groups.size} 项` : `页面字段 · ${groups.size} 项${fixed.length !== groups.size ? `，涉及 ${fixed.length} 处用途` : ''}`;
    const empty = operation && !liveElement(operation) ? '源码尚未定位到该操作的目标区域；执行一次操作后会用实际页面核对。' : '当前目标区域暂未识别到字段；可执行操作后核对实际展示。';
    return `<div class="tr-api-fields"><h5>字段定义</h5><p class="tr-small">同名字段按名称合并；展开可看筛选、表单和展示的不同用途。页面字段来自原型，接口 ID 与类型仍需技术核对。</p><h5>${escapeHtml(fixedHeading)}</h5>${fixed.length ? `<div class="tr-api-head"><span>字段 ID</span><span>字段名称</span><span>字段说明</span></div>${fixedRows}` : `<p class="tr-muted">${escapeHtml(empty)}</p>`}${extras.length ? `<h5>技术补充字段 · ${extras.length} 项</h5><div class="tr-api-head"><span>字段 ID</span><span>字段名称</span><span>字段说明</span></div>${extraRows}` : ''}<div class="tr-actions"><button data-action="add-api-field" data-direction="response">＋ 响应字段</button><button data-action="add-api-field" data-direction="query">＋ 请求字段</button></div>${state.apiDraft?.fixed_display_field_id ? '' : apiFieldEditorHtml()}</div>`;
  }
  function factListHtml(title, claims) {
    const visible = (claims || []).filter((claim) => claim.confirmation_state !== 'rejected');
    if (!visible.length) return '';
    return `<section class="tr-reading-section"><h4>${escapeHtml(title)}</h4><ul class="tr-fact-list">${visible.map((claim) => `<li><div>${escapeHtml(claim.text)}</div></li>`).join('')}</ul></section>`;
  }
  function resultHtml(card) {
    if (!card?.expected_effects?.length) return '';
    return `<section class="tr-reading-section"><h4>操作结果与验收</h4>${card.expected_effects.map((effect) => `<div class="tr-result-row"><strong>${escapeHtml(effect.target)}：${escapeHtml(effect.change)}</strong><div>如何确认：${escapeHtml(effect.verification || '待补充')}</div>${effect.condition ? `<div class="tr-small">条件：${escapeHtml(effect.condition)}</div>` : ''}${effect.evidence_audit?.status === 'missing_or_invalid' ? '<div class="tr-small">依据位置无法核对，结果仍待确认。</div>' : ''}</div>`).join('')}</section>`;
  }
  function businessDataHtml(operation) {
    if (!isFieldOperation(operation)) return '';
    const role = fieldValueRole(operation);
    const source = sourceDetails(operation);
    const options = operation.option_source?.options?.filter((item) => item.text && item.value !== '') || [];
    const rows = [];
    if (role === 'user_entered') rows.push(['填写方式', '由用户填写（初始为空）']);
    else if (role === 'user_selected') rows.push(['选中值', '由用户选择']);
    else if (role === 'prefilled') rows.push(['当前值', source.source || '页面存在预填逻辑，具体条件待核对']);
    else rows.push(['当前值', '显示值的产生方式待核对']);
    if (isChoiceOperation(operation)) rows.push(['可选项', operation.option_source ? `Demo 页面定义了 ${options.length} 项${options.length && options.length <= 5 ? `：${options.map((item) => item.text).join('、')}` : ''}` : '选项生成方式待追踪']);
    return `<section class="tr-reading-section"><h4>业务数据</h4><div class="tr-reading-rows">${rows.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div></section>`;
  }
  function productHtml() {
    const operation = currentOperation();
    if (!operation) return state.unmatchedTargetLabel && state.data?.ai_enabled ? `<div class="tr-update-status">正在识别“${escapeHtml(state.unmatchedTargetLabel)}”及本次操作反馈；原交互可以继续使用。</div>` : '<div class="tr-empty">点击原型里的字段或按钮，查看对应的产品说明。</div>';
    const card = currentCard(operation.operation_id);
    const firstPassFunction = pageFunction(operation);
    const kind = operationType(operation);
    const title = operationTitle(operation, card);
    const searchAction = currentPageBehavior()?.actions?.find((item) => item.operation_id === operation.operation_id && /^search/i.test(item.handler));
    const regionCheck = latestObservedRegion(operation);
    const actualRegion = regionCheck?.observed_region;
    const linkedTarget = linkedPageTarget(operation);
    const reachedDestination = kind === 'navigation' && navigationDestination(operation) === currentPagePath() || !!linkedTarget;
    const dialogTitle = reachedDestination ? visibleDialogTitle() : '';
    const regionPurpose = actualRegion?.scope === 'dialog' ? `打开“${actualRegion.label}”弹窗，查看并填写其中内容。` : actualRegion?.scope === 'section' ? `切换到“${actualRegion.label}”内容区。` : actualRegion?.scope === 'page' ? `进入“${actualRegion.label}”页面，查看该页内容。` : '';
    const purpose = regionCheck?.status === 'mismatch' ? `本次打开“${actualRegion?.label || '其他区域'}”，与源码候选目标不一致。` : card?.summary || firstPassFunction?.outcome || regionPurpose || (reachedDestination ? `已进入${linkedTarget?.label || pageName()}${dialogTitle ? `，打开“${dialogTitle}”` : ''}。` : kind === 'navigation' ? `打开${title}对应的页面。` : searchAction ? '按当前查询条件筛选并展示列表结果。' : kind === 'choice' ? `选择${title}，用于当前查询或填写。` : isFieldOperation(operation) ? `${fieldValueRole(operation) === 'user_entered' ? '由用户填写' : '展示或选择'}${title}。` : kind === 'expand' ? '展开或收起这组内容。' : '这一步的业务结果尚待核对。');
    const claims = (card?.claims || []).filter((item) => item.confirmation_state !== 'rejected' && (item.confirmation_state === 'confirmed' || item.origin !== 'proposed' && item.evidence_audit?.status !== 'missing_or_invalid'));
    const rows = [];
    const add = (label, value, origin = '') => {
      if (!value) return;
      const saved = latestRule('product', operation.operation_id, label);
      const shown = saved?.text || value;
      rows.push(`<div class="tr-focus-row tr-editable-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(compact(shown, 300))}</strong><small>${escapeHtml(saved ? '产品已补充 · 当前操作' : origin)}</small><div class="tr-row-actions"><button data-edit-rule="product" data-rule-slot="${escapeHtml(label)}" data-rule-label="${escapeHtml(label)}" data-rule-mode="append">补充</button><button data-edit-rule="product" data-rule-slot="${escapeHtml(label)}" data-rule-label="${escapeHtml(label)}" data-rule-mode="replace">纠正</button></div></div>${ruleEditorHtml('product', label)}`);
    };
    if (isFieldOperation(operation)) {
      const live = liveFieldState(operation) || operation.latest_runtime || {};
      const editability = live.editability || operation.field_meta?.declared_editability || 'unknown';
      const role = fieldValueRole(operation);
      add('当前状态', ({ readonly: '只读，不能在这里改', disabled: '禁用，不能在这里操作', editable: '可编辑' })[editability] || '待核对', '页面状态');
      if (role === 'user_entered') add('值从哪里来', '用户在此输入，初始为空', '页面状态');
      else if (role === 'user_selected') add('值从哪里来', '用户从选项中选择', '页面状态');
      else add('值从哪里来', sourceDetails(operation).source || '尚未定位', sourceDetails(operation).source ? '源码线索' : '待核对');
      if (isChoiceOperation(operation)) {
        const options = (operation.option_source?.options || []).filter((item) => item.value !== '' && item.text);
        add('选项从哪里来', operation.option_source ? `Demo 定义了 ${options.length} 个选项${options.length && options.length <= 4 ? `：${options.map((item) => item.text).join('、')}` : ''}` : '尚未定位', operation.option_source ? '源码线索' : '待核对');
      }
      const constraints = claims.filter((item) => item.section === 'constraint').map((item) => item.text.replace(/[。；;\s]+$/, ''));
      const mainRule = constraints.find((item) => /字符|长度|格式|位数|位指定/.test(item)) || constraints.find((item) => /必填|选填/.test(item));
      const basic = [operation.field_meta?.required && !/必填/.test(mainRule || '') ? '必填' : '', operation.field_meta?.max_length && !new RegExp(String(operation.field_meta.max_length)).test(mainRule || '') ? `最多 ${operation.field_meta.max_length} 字符` : ''].filter(Boolean);
      const extra = constraints.filter((item) => item !== mainRule && !((/必填/.test(item) && (mainRule || '').includes('必填')) || (/长度|字符|最多/.test(item) && (mainRule || '').includes(String(operation.field_meta?.max_length || ''))))).slice(0, 2);
      add('填写与校验', [mainRule, ...basic, ...extra].filter(Boolean).join('；') || '暂无明确规则', constraints.length ? '源码或需求线索' : basic.length ? '页面标记' : '待核对');
      const data = claims.find((item) => item.section === 'data' || item.section === 'field');
      if (data) add('提交后去向', data.text, sourceTag(data.origin));
    } else if (actualRegion?.scope === 'page' || !actualRegion && linkedTarget) {
      const target = actualRegion || linkedTarget;
      add('触发条件', `点击“${operation.label || title}”入口`, actualRegion ? '本次操作' : '源码导航线索');
      add('目标页面', `${actualRegion ? '已进入' : '预计进入'}“${target.label}”${target.page_path === currentPagePath() && latestOperationObservation(operation) && !latestOperationObservation(operation).page_changed ? '；当前已在此页时保持页面' : ''}`, actualRegion ? '本次操作观察' : '源码候选');
      if (target.page_path === currentPagePath()) {
        const headings = visibleRegionHeadings();
        if (headings.length) add('页面内容', `当前可见：${headings.join('、')}`, '当前页面观察');
      }
    } else if (actualRegion?.scope === 'dialog') {
      add('触发条件', `点击“${operation.label || title}”入口`, '本次操作');
      add('打开区域', `已打开“${actualRegion.label}”弹窗`, '本次操作观察');
      if (actualRegion.field_labels?.length) add('可见内容', `包含${actualRegion.field_labels.slice(0, 5).join('、')}${actualRegion.field_labels.length > 5 ? '等字段' : '字段'}`, '本次操作观察');
      if (actualRegion.action_labels?.length) add('可选操作', actualRegion.action_labels.slice(0, 5).join('、'), '本次操作观察');
    } else if (actualRegion?.scope === 'section') {
      add('切换结果', `已显示“${actualRegion.label}”内容区`, '本次操作观察');
      const headings = visibleRegionHeadings();
      if (actualRegion.page_path === currentPagePath() && headings.length) add('当前内容', headings.join('、'), '当前页面观察');
    } else if (kind === 'navigation') {
      const destination = navigationDestination(operation);
      const reached = destination && currentPagePath() === destination;
      const view = reached ? pageVisualState() : null;
      add('触发条件', `点击“${title}”入口`, '原型源码');
      add('跳转结果', reached ? `已进入${pageName()}${visibleDialogTitle() ? `，打开“${visibleDialogTitle()}”` : ''}${view.selected ? `，${view.selected}已选中` : ''}` : destination ? `将打开 ${destination}` : '目标页面待核对', reached ? '当前页面观察' : '源码线索');
      if (view?.table) add('页面展示', `${view.filters.length ? `筛选区含 ${view.filters.length} 项；` : ''}列表可见 ${view.rows} 行、${view.headers.length} 列${view.total ? `；${view.total}` : ''}`, '当前页面观察');
    } else if (searchAction) {
      const view = pageVisualState();
      add('触发条件', '点击搜索，按当前筛选条件刷新列表', '原型源码');
      if (searchAction.search_fields?.length) add('关键词搜索', searchAction.search_fields.map(readableField).join('、'), '源码线索');
      add('当前结果', `${view.rows} 行${view.total ? `；${view.total}` : ''}`, '当前页面观察');
    } else if (kind === 'expand') {
      add('页面变化', '展开或收起这一组的二级选项', '原型交互');
      add('下一步', '点击具体选项，核对勾选与联动规则');
    } else if (kind === 'tab') {
      add('页面变化', claims.find((item) => item.section === 'behavior')?.text || '切换到对应内容区', claims.length ? '需求线索' : '原型交互');
    } else if (kind === 'toggle') {
      add('页面变化', claims.find((item) => item.section === 'behavior')?.text || '勾选状态切换', claims.length ? '需求线索' : '原型交互');
      add('保存与生效', claims.find((item) => item.section === 'data' || item.section === 'flow')?.text || '尚未确定', claims.length ? '需求线索' : '待核对');
    } else if (kind === 'submit') {
      const submitted = claims.find((item) => item.section === 'field' && /提交|保存|输入|表单/.test(`${item.text} ${item.detail}`)) || claims.find((item) => item.section === 'data' && /提交值|表单值|请求字段/.test(item.text));
      if (submitted) add('提交内容', submitted.section === 'data' ? submitted.detail.split('；')[0] : submitted.text, sourceTag(submitted.origin));
      const validations = claims.filter((item) => item.section === 'constraint' && /必填|非空|为空|格式|长度|校验|限制/.test(item.text));
      add('提交校验', validations.slice(0, 2).map((item) => item.text.replace(/[。；;\s]+$/, '')).join('；') || '待核对', validations.length ? '源码或需求线索' : '待核对');
      const changes = claims.filter((item) => item.section === 'data').sort((a, b) => Number(/持久化|存储|写入|提交值/.test(b.text)) - Number(/持久化|存储|写入|提交值/.test(a.text)));
      add('数据变化', changes.slice(0, 2).map((item) => item.text.replace(/[。；;\s]+$/, '')).join('；') || '尚未确定', changes.length ? '源码或需求线索' : '待核对');
      const effects = card?.expected_effects || [];
      const failed = effects.filter((item) => /为空|未通过|缺少|失败|无效/.test(item.condition));
      const passed = effects.filter((item) => !failed.includes(item));
      if (failed.length) add('未通过时', failed.map((item) => `${item.target}：${item.change}`).join('；'), '验收结果');
      add('通过后', passed.map((item) => `${item.target}：${item.change}`).join('；') || '尚未确定', passed.length ? '验收结果' : '待核对');
    } else {
      add('触发后', claims.find((item) => item.section === 'behavior' || item.section === 'flow')?.text || firstPassFunction?.outcome || '处理步骤待核对', claims.length ? '需求线索' : '待核对');
      const effect = card?.expected_effects?.[0];
      add('应出现的结果', effect ? `${effect.target}：${effect.change}` : '尚未确定', effect ? sourceTag(effect.origin) : '待核对');
    }
    const manual = (state.data?.supplements || []).filter((item) => item.operation_id === operation.operation_id).flatMap((item) => item.answers || []);
    for (const answer of manual.slice(-2)) add(answer.question, answer.value, '你已补充 · 当前元素');
    const status = card ? ({ confirmed: '已确认', rejected: '有误，待修改', ai_pending: '初稿，待核对' })[card.review_state || 'ai_pending'] : '基于页面与源码的初步说明';
    const unresolvedEvidence = (card?.claims || []).filter((item) => item.evidence_audit?.status === 'missing_or_invalid').length;
    let html = `<div class="tr-element-heading"><div><span class="tr-eyebrow">${escapeHtml(isFieldOperation(operation) ? '字段' : '操作')} · ${escapeHtml(status)}</span><h3 class="tr-card-title">${escapeHtml(title)}</h3></div><button data-action="locate" title="在原型中定位">定位</button></div><p class="tr-lead">${escapeHtml(compact(purpose, 180))}</p>${regionCheck?.status === 'mismatch' ? `<div class="tr-update-status">源码候选目标：${escapeHtml((regionCheck.source_targets || []).join('、') || '未定位')}；本次实际打开：${escapeHtml(actualRegion?.label || '未定位')}。请在“证据核对”查看两边依据。</div>` : ''}${unresolvedEvidence ? `<div class="tr-update-status">${unresolvedEvidence} 条模型判断的引用无法定位，请到“证据核对”检查。</div>` : ''}${jobHtml(operation, card)}<section class="tr-focus-card"><h4>一眼看懂</h4>${rows.join('')}</section>`;
    const mismatches = candidateIssues(card).filter((issue) => issue.decision === 'candidate' && issueKind(issue) === 'prd_demo_mismatch');
    if (mismatches.length) html += `<section class="tr-reading-section"><h4>需求与原型的差异</h4>${mismatches.map((issue) => issueDisplayHtml(issue, card)).join('')}</section>`;
    if (card?.quality_checks?.length) html += `<section class="tr-reading-section tr-quality-alert"><h4>说明仍需补齐</h4>${card.quality_checks.map((item) => `<p>${escapeHtml(item.text)}</p>`).join('')}</section>`;
    const openTodos = (state.data?.issues || []).filter((item) => item.operation_id === operation.operation_id && item.decision === 'accepted' && item.todo_status !== 'resolved');
    if (openTodos.length) html += `<button class="tr-todo-link" data-view="review">有 ${openTodos.length} 项待修改，查看清单 →</button>`;
    if (card?.expected_effects?.length && kind !== 'field' && kind !== 'choice') html += `<details class="tr-detail-group"><summary>全部验收结果 <span>${card.expected_effects.length}</span></summary>${resultHtml(card)}</details>`;
    html += guidanceHtml(operation, card);
    if (card) html += `<div class="tr-card-review"><span>上面的产品说明准确吗？</span><div class="tr-actions">${card.review_state === 'confirmed' ? '<span class="tr-pill confirmed">已确认</span>' : `<button class="tr-accept" data-card-review="confirmed" data-card="${escapeHtml(card.card_id)}">确认产品说明</button>`}<button data-action="show-issue">有误或缺失</button></div></div>`;
    if (state.showIssueForm) html += issueFormHtml(true);
    if (state.data?.ai_enabled) html += `<button class="tr-primary tr-recheck" data-action="reanalyze">${state.data.model_mode === 'conversation' ? '加入待解析队列' : card ? '重新核对说明' : '立即解读'}</button>`;
    html += '<p class="tr-doc-links"><a href="/__tech/documents?name=requirements.generated.md" target="_blank" rel="noopener">查看自动更新的需求文档 ↗</a></p>';
    return html;
  }
  function technicalHtml() {
    const operation = currentOperation();
    if (!operation) return state.unmatchedTargetLabel && state.data?.ai_enabled ? `<div class="tr-update-status">正在识别“${escapeHtml(state.unmatchedTargetLabel)}”及本次操作反馈；原交互可以继续使用。</div>` : '<div class="tr-empty">点击原型里的字段或按钮，查看这个功能对应的实现方案。</div>';
    const card = currentCard(operation.operation_id);
    const claims = (card?.claims || []).filter((item) => item.confirmation_state !== 'rejected');
    const section = requirementContext(operation).current || requirementContext(operation).page;
    const firstPassFunction = pageFunction(operation);
    const observedGoal = linkedPageTarget(operation) ? `进入${linkedPageTarget(operation).label}页面，查看该页展示内容。` : operationType(operation) === 'navigation' && navigationDestination(operation) === currentPagePath() ? `进入${operationTitle(operation, card)}页面，查看筛选区与列表。` : currentPageBehavior()?.actions?.some((item) => item.operation_id === operation.operation_id && /^search/i.test(item.handler)) ? '按当前查询条件筛选并展示列表结果。' : '';
    const goal = compact(card?.summary || firstPassFunction?.outcome || observedGoal || '此操作的业务目标待产品确认。', 190);
    let html = `<div class="tr-element-heading"><div><span class="tr-eyebrow">技术说明 · ${escapeHtml(card?.review_state === 'confirmed' ? '产品已确认' : '逐项核对中')}</span><h3 class="tr-card-title">${escapeHtml(operationTitle(operation, card))}</h3></div><button data-action="locate">定位</button></div>${jobHtml(operation, card)}`;
    html += `<section class="tr-tech-section tr-goal"><h4>这一步要完成什么</h4><p>${escapeHtml(goal)}</p>${section ? `<small>${escapeHtml(section.path)}:${section.line} · 需求资料</small>` : ''}</section>`;
    html += frontendBehaviorHtml(operation);
    html += guidanceHtml(operation, card);
    html += backendImplementationHtml(operation);
    html += sharedContractHtml(operation);
    html += technicalRuleSectionHtml(operation);
    if (isFieldOperation(operation)) {
      const meta = operation.field_meta || {};
      const constraints = claims.filter((item) => item.section === 'constraint');
      const rule = constraints.length ? constraints.map((item) => item.text.replace(/[。；;\s]+$/, '')).join('；') : [meta.required ? '必填' : '', meta.max_length ? `最多 ${meta.max_length} 字符` : ''].filter(Boolean).join('；') || '尚未明确';
      html += `<section class="tr-tech-section"><h4>当前字段</h4><div class="tr-reading-rows"><div><span>控件</span><strong>${escapeHtml(state.data?.component_questions?.[operation.component?.id]?.label || operation.component?.id || operation.tag || '待识别')}</strong></div><div><span>输入规则</span><strong>${escapeHtml(rule)}</strong></div></div>${dataSourceHtml(operation)}</section>`;
    }
    if (claims.length || card?.expected_effects?.length) html += `<details class="tr-detail-group"><summary>已有说明与验收依据</summary>${factListHtml('已生成的规则', claims)}${resultHtml(card)}</details>`;
    html += visualEvidenceHtml(operation);
    html += `<details class="tr-detail-group tr-provenance"><summary>版本与来源</summary><div class="tr-small">${card ? `第 ${card.version} 版 · ` : ''}${escapeHtml(operation.anchor?.source ? `${operation.anchor.source.path}:${operation.anchor.source.line}` : '运行时发现')}<br>资料快照：${escapeHtml(state.data?.source_snapshot_id || '加载中')}</div></details>`;
    if (state.data?.ai_enabled) html += '<button class="tr-primary tr-recheck" data-action="reanalyze">基于当前规则生成技术建议</button>';
    html += '<p class="tr-doc-links"><a href="/__tech/documents?name=technical-design.generated.md" target="_blank" rel="noopener">查看自动更新的技术方案 ↗</a> · <a href="/__tech/documents?name=handoff.generated.md" target="_blank" rel="noopener">开发交付检查 ↗</a></p>';
    return html;
  }
  function pageOverviewHtml() {
    const operation = currentOperation();
    const spec = currentPageSpec();
    if (spec) {
      const facts = (title, items) => items?.length ? `<section class="tr-reading-section"><h4>${escapeHtml(title)}</h4><ul class="tr-fact-list">${items.slice(0, 4).map((item) => `<li><div>${escapeHtml(item.text)}</div></li>`).join('')}</ul></section>` : '';
      const functions = spec.functions?.length ? `<section class="tr-reading-section"><h4>主要功能与验收结果</h4>${spec.functions.map((item) => `<div class="tr-result-row"><strong>${escapeHtml(item.name)}</strong><div>${escapeHtml(item.outcome)}</div></div>`).join('')}</section>` : '';
      const gaps = (spec.open_questions || []).filter((item) => !/PRD|需求文档/.test(item) || !/Demo|原型/.test(item));
      const differences = (spec.open_questions || []).filter((item) => !gaps.includes(item));
      const differenceHtml = differences.length ? `<section class="tr-reading-section"><h4>需求与原型的差异</h4>${differences.map((item) => {
        const facts = item.match(/^(.*?PRD[^，；。]+)[，；](Demo[^；。]+)/);
        if (!facts) return `<div class="tr-issue tr-mismatch"><p>${escapeHtml(item.split('依据：')[0])}</p><button data-view="evidence">查看依据</button></div>`;
        return `<div class="tr-issue tr-mismatch"><div class="tr-diff-row"><span>PRD 要求</span><p>${escapeHtml(facts[1].replace(/^PRD\s*要求/, ''))}</p></div><div class="tr-diff-row"><span>Demo 当前</span><p>${escapeHtml(facts[2].replace(/^Demo/, ''))}</p></div><button data-view="evidence">查看依据</button></div>`;
      }).join('')}</section>` : '';
      const questions = gaps.length ? `<section class="tr-reading-section"><h4>仍需补充的规则或证据</h4><ul class="tr-fact-list">${gaps.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>` : '';
      return `<h3 class="tr-card-title">${escapeHtml(spec.title)}</h3>${sourceChangeHtml()}<p class="tr-small">模型初稿 · 待核对</p><p class="tr-lead">${escapeHtml(spec.purpose || '页面用途仍需核对。')}</p>${pageRegionMapHtml(spec)}${displayFieldsHtml()}${functions}${facts('关键状态', spec.states)}${facts('数据来源与去向', spec.data)}${differenceHtml}${questions}`;
    }
    const projectJob = state.data?.project_jobs?.find((item) => item.source_snapshot_id === state.data?.source_snapshot_id && item.pages?.includes(currentPagePath()) && ['queued', 'analyzing', 'validating'].includes(item.status));
    if (state.data?.ai_enabled && projectJob) return `<h3 class="tr-card-title">${escapeHtml(pageName())}</h3>${sourceChangeHtml()}<div class="tr-update-status">${state.data.model_mode === 'conversation' ? '页面说明已排队，等待当前对话处理' : '页面说明正在后台补全'} · ${escapeHtml(projectJob.stage || '等待生成')}。目前可先按原型查看页面结构并点击功能点。${jobTimingHtml(projectJob)}</div>${observedLayoutHtml()}${displayFieldsHtml()}`;
    const failedProjectJob = state.data?.project_jobs?.filter((item) => item.source_snapshot_id === state.data?.source_snapshot_id && item.pages?.includes(currentPagePath()) && item.status === 'failed').at(-1);
    if (state.data?.ai_enabled && failedProjectJob) return `<h3 class="tr-card-title">${escapeHtml(pageName())}</h3>${sourceChangeHtml()}<p class="tr-lead">页面说明生成失败</p><p class="tr-muted">${escapeHtml(failedProjectJob.error || '本批模型解读未完成。')}</p><button class="tr-primary" data-action="retry-page">重试当前页</button>${observedLayoutHtml()}${displayFieldsHtml()}`;
    const pageCards = (state.data?.cards || []).filter((item) => item.source_snapshot_id === state.data?.source_snapshot_id && state.data?.operations?.some((entry) => entry.operation_id === item.operation_id && entry.page_hint === location.pathname));
    const context = pageCards.filter((item) => item.page_context?.purpose || item.page_context?.layout).at(-1)?.page_context;
    const { page, children, current } = requirementContext(operation);
    const query = children.find((item) => /查询条件|筛选条件/.test(item.title));
    const list = children.find((item) => /列表字段|列表展示/.test(item.title));
    const capabilities = [['查询', query], ['查看', list], ['新增', children.find((item) => /新增/.test(item.title))], ['编辑', children.find((item) => /编辑/.test(item.title))]].filter((item) => item[1]).map((item) => item[0]);
    const inferredPurpose = page ? `${pageName()}支持${capabilities.join('、') || '相关业务操作'}。` : '';
    const view = pageVisualState();
    const observedPurpose = view.table ? `展示${view.selected || pageName()}列表${view.filters.length ? '，可按页面条件筛选' : ''}，并查看每条记录的操作。` : '';
    let html = `<h3 class="tr-card-title">${escapeHtml(pageName())}</h3><p class="tr-lead">${escapeHtml(context?.purpose || inferredPurpose || observedPurpose || '当前页面用途仍需补充。')}</p>`;
    html += sourceChangeHtml() + pageRegionMapHtml() + displayFieldsHtml();
    const observedActions = [...document.querySelectorAll('button')].filter((item) => visibleElement(item) && /搜索|重置|新增|开通|列设置|添加/.test(item.textContent || '')).map((item) => compact(item.textContent, 20)).slice(0, 5);
    if (capabilities.length || observedActions.length) html += `<section class="tr-reading-section"><h4>在这里能做什么</h4><div class="tr-task-chips">${(capabilities.length ? capabilities.map((item) => `${item}客户`) : observedActions).map((item) => `<span>${escapeHtml(item)}</span>`).join('')}</div><p class="tr-small">点击原型中的具体字段或按钮，查看规则与结果。</p></section>`;
    const rules = query ? requirementGroups(query).flatMap((item) => item.items).filter((item) => /匹配|过滤|查询|重置|条件/.test(item)).slice(0, 2) : [];
    if (rules.length) html += `<section class="tr-reading-section"><h4>关键交互</h4><ul class="tr-fact-list">${rules.map((item) => `<li>${escapeHtml(compact(item, 100))}</li>`).join('')}</ul></section>`;
    if (!page && !context?.purpose) html += '<p class="tr-small">以上是当前页面可见的结构与操作；业务规则和正式数据来源仍需逐项核对。</p>';
    return html;
  }
  function reviewHtml() {
    const operation = currentOperation();
    const card = operation && currentCard(operation.operation_id);
    const claims = card?.claims || [];
    let html = `<h3 class="tr-card-title">待核对</h3><p class="tr-small">这里核对说明是否准确，并决定发现的问题是否需要修改；只有确认加入的事项才进入待修改清单。</p>${reviewScopeHtml()}`;
    const functions = currentPageSpec()?.functions || [];
    if (functions.length) {
      const rows = functions.map((item) => {
        const cards = (item.operation_ids || []).map(currentCard).filter(Boolean);
        const status = !(item.operation_ids || []).length ? '尚未对应到控件' : cards.length === item.operation_ids.length && cards.every((entry) => entry.review_state === 'confirmed') ? '已确认' : cards.length ? '已有说明，待核对' : '尚未逐项解读';
        return `<div class="tr-result-row"><strong>${escapeHtml(item.name)}</strong><div>${escapeHtml(item.outcome)}</div><small>${escapeHtml(status)}</small></div>`;
      });
      html += `<details class="tr-detail-group"><summary>本页功能覆盖 <span>${functions.length}</span></summary><p class="tr-small">按页面初稿归纳；未绑定控件和未访问的分支仍需人工检查。</p>${rows.join('')}</details>`;
    }
    if (state.reviewScope === 'current' && operation) {
      const pendingClaims = claims.filter((item) => !item.confirmation_state || item.confirmation_state === 'ai_pending');
      const confirmedClaims = claims.filter((item) => item.confirmation_state === 'confirmed');
      const rejectedClaims = claims.filter((item) => item.confirmation_state === 'rejected');
      if (pendingClaims.length) html += `<section class="tr-reading-section"><h4>说明待核对 · ${pendingClaims.length}</h4>${pendingClaims.map((item) => renderClaim(card, item)).join('')}</section>`;
      if (confirmedClaims.length) html += `<details class="tr-detail-group"><summary>已确认说明 <span>${confirmedClaims.length}</span></summary>${confirmedClaims.map((item) => renderClaim(card, item)).join('')}</details>`;
      if (rejectedClaims.length) html += `<details class="tr-detail-group"><summary>标记不准确 <span>${rejectedClaims.length}</span></summary>${rejectedClaims.map((item) => renderClaim(card, item)).join('')}</details>`;
      const issues = candidateIssues(card).filter((issue) => issue.decision === 'candidate');
      if (issues.length) html += `<section class="tr-reading-section"><h4>发现的问题 · ${issues.length}</h4>${issues.map((issue) => issueDisplayHtml(issue, card)).join('')}</section>`;
      if (card?.quality_checks?.length) html += `<section class="tr-reading-section tr-quality-alert"><h4>生成结果未通过完整性检查</h4>${card.quality_checks.map((item) => `<p>${escapeHtml(item.text)}</p>`).join('')}</section>`;
    }
    if (state.reviewScope === 'all') {
      const candidates = (state.data?.issues || []).filter((issue) => issue.decision === 'candidate');
      if (candidates.length) html += `<section class="tr-reading-section"><h4>项目发现的问题 · ${candidates.length}</h4>${candidates.slice(0, 20).map((issue) => issueDisplayHtml(issue, state.data?.cards?.find((card) => card.card_id === issue.card_id))).join('')}${candidates.length > 20 ? '<p class="tr-small">先显示前 20 项，请按页面逐项核对。</p>' : ''}</section>`;
    }
    if (!claims.length && state.reviewScope === 'current' && !(card && candidateIssues(card).length)) html += '<p class="tr-muted">当前操作没有待核对的说明或候选问题。</p>';
    return html;
  }
  function evidenceHtml() {
    const operation = state.scope === 'current' ? currentOperation() : null;
    if (state.scope === 'current' && !operation) return '<div class="tr-empty">点击原型中的功能点，再查看需求文档、Demo 源码和实际操作的对照。</div>';
    const params = new URLSearchParams({ scope: state.scope, page_path: currentPagePath(), operation_id: operation?.operation_id || '', context: operation ? containerName(operation) : '' });
    const key = `${params}:${state.data?.source_snapshot_id || ''}`;
    if (state.evidence?.key !== key) {
      state.evidence = { key, status: 'loading' };
      api(`/evidence?${params}`).then((data) => { if (state.evidence?.key === key) { state.evidence = { key, status: 'ready', data }; if (state.tab === 'evidence') render(); } }).catch((error) => { if (state.evidence?.key === key) { state.evidence = { key, status: 'error', message: error.message }; if (state.tab === 'evidence') render(); } });
    }
    if (state.evidence.status === 'loading') return '<h3 class="tr-card-title">证据核对</h3><p class="tr-muted">正在整理当前功能的资料…</p>';
    if (state.evidence.status === 'error') return `<h3 class="tr-card-title">证据核对</h3><p class="tr-muted">读取失败：${escapeHtml(state.evidence.message)}</p>`;
    const lane = (sources, kind, title, empty) => `<div class="tr-evidence-lane"><h5>${title}</h5>${sources.filter((item) => item.kind === kind).length ? sources.filter((item) => item.kind === kind).map((item) => `<div class="tr-evidence-source"><div class="tr-evidence-locations">${item.locations.map((location) => `<span>${escapeHtml(location.path)}:${location.start}${location.end !== location.start ? `–${location.end}` : ''}${location.context ? ` · ${escapeHtml(location.context)}` : ''}${location.missing ? ' · 原文已变化' : ''}</span>`).join('')}</div>${item.excerpt ? `<pre>${escapeHtml(item.excerpt)}</pre>` : '<p>原文已无法定位，请重新核对。</p>'}${item.truncated ? '<small>长片段仅展示开头几行</small>' : ''}</div>`).join('') : `<p class="tr-muted">${empty}</p>`}</div>`;
    const cards = state.evidence.data?.cards || [];
    const cardHtml = (card) => {
      const hasPrd = card.sources.some((item) => item.kind === 'requirement');
      const hasDemo = card.sources.some((item) => item.kind === 'demo');
      const hasResult = !!card.runtime?.changed;
      const missing = [!hasPrd && 'PRD', !hasDemo && 'Demo 源码', !hasResult && '可验证的操作结果'].filter(Boolean);
      return `<article class="tr-evidence-card"><div class="tr-evidence-card-head"><h4>${escapeHtml(card.title)}</h4><span>${escapeHtml(missing.length ? `待补：${missing.join('、')}` : '三类线索齐全 · 一致性待核对')}</span></div><p class="tr-small">${escapeHtml(card.note)}${card.stale ? ' · 原型已变化，旧引用待复核' : ''}</p>${card.invalid_refs?.length ? `<p class="tr-small">引用位置无法定位：${escapeHtml(card.invalid_refs.join('、'))}</p>` : ''}${lane(card.sources, 'requirement', 'PRD 怎么规定', '未找到当前判断对应的文档原文。')}${lane(card.sources, 'demo', 'Demo 怎么实现', '未找到当前判断对应的源码位置。')}<div class="tr-evidence-lane"><h5>实际操作怎样</h5>${card.runtime ? `<p><strong>${escapeHtml(card.runtime.action)}：</strong>${escapeHtml(card.runtime.result)}</p><small>${escapeHtml(card.runtime.recorded_at || '')} · 本地操作记录</small>` : '<p class="tr-muted">尚无与这条判断绑定的操作记录。</p>'}</div></article>`;
    };
    return `<h3 class="tr-card-title">证据核对</h3><p class="tr-small">${operation ? `当前功能：${escapeHtml(operationTitle(operation, currentCard(operation.operation_id)))}` : `当前页面：${escapeHtml(pageName())}`}。资料齐全后仍需核对规则是否一致。</p>${cards.map(cardHtml).join('')}`;
  }
  function reviewScopeHtml() { return `<div class="tr-scope"><button data-review-scope="current" aria-pressed="${state.reviewScope === 'current'}">当前操作</button><button data-review-scope="all" aria-pressed="${state.reviewScope === 'all'}">整个项目</button></div>`; }
  function reviewTodoHtml() {
    const operation = currentOperation();
    return `<h3 class="tr-card-title">待修改清单</h3><p class="tr-small">只收录评审已确认或手动标记的问题；完成后可以在这里关闭。</p>${reviewScopeHtml()}${todoHtml(state.reviewScope === 'current' ? operation?.operation_id : null)}${operation && state.reviewScope === 'current' ? issueFormHtml() : ''}`;
  }
  function listRowHtml(item) {
    const card = currentCard(item.operation_id);
    const place = state.listScope === 'all' ? item.page_hint : item.anchor?.source?.line ? `源码第 ${item.anchor.source.line} 行` : '运行时发现';
    return `<li><button data-open-operation="${escapeHtml(item.operation_id)}"><strong>${escapeHtml(operationTitle(item, card))}</strong><span class="tr-small">${escapeHtml(operationType(item) === 'toggle' ? '选择项' : isFieldOperation(item) ? '字段' : '操作')} · ${escapeHtml(place)}</span></button></li>`;
  }
  function listHtml() {
    const operations = state.data?.operations || [];
    const scoped = state.listScope === 'all' ? operations : operations.filter((item) => item.page_hint === location.pathname);
    const term = state.search.trim().toLowerCase();
    const filtered = term ? scoped.filter((item) => `${item.label} ${item.anchor?.source?.path || ''}`.toLowerCase().includes(term)) : scoped;
    const explained = filtered.filter((item) => currentCard(item.operation_id));
    const clicked = filtered.filter((item) => !currentCard(item.operation_id) && item.coverage === 'observed');
    const other = filtered.filter((item) => !currentCard(item.operation_id) && item.coverage !== 'observed');
    const group = (title, items, open = true) => `<details class="tr-detail-group" ${open ? 'open' : ''}><summary>${title} <span>${items.length}</span></summary><ul class="tr-list">${items.slice(0, term ? 50 : 25).map(listRowHtml).join('') || '<li class="tr-muted">暂无</li>'}</ul>${items.length > (term ? 50 : 25) ? `<p class="tr-small">只显示前 ${term ? 50 : 25} 项，可搜索缩小范围。</p>` : ''}</details>`;
    const unmatched = filtered.filter((item) => item.component?.status === 'needs_research');
    return `<h3 class="tr-card-title">说明覆盖检查</h3><p class="tr-small">检查范围是页面中的字段、按钮等交互位置：哪些已有说明、哪些点过却没有说明、哪些控件还未识别。这里不判断需求对错；请在“待核对”处理准确性。</p><div class="tr-scope"><button data-list-scope="page" aria-pressed="${state.listScope === 'page'}">本页</button><button data-list-scope="all" aria-pressed="${state.listScope === 'all'}">全部页面</button></div><div class="tr-coverage-stats"><span>已有说明 <strong>${explained.length}</strong></span><span>点过待说明 <strong>${clicked.length}</strong></span><span>组件待识别 <strong>${unmatched.length}</strong></span></div><input class="tr-search" type="search" placeholder="搜索字段或按钮" value="${escapeHtml(state.search)}">${group('已有说明', explained)}${group('点过但缺少说明', clicked)}${group('组件类型待识别', unmatched, Boolean(term))}${group('尚未逐个查看的源码候选', other.filter((item) => item.component?.status !== 'needs_research'), Boolean(term))}`;
  }
  function dataMapHtml() {
    const inventory = state.data?.data_inventory;
    if (!inventory) return '<p class="tr-muted">项目数据索引尚未生成。</p>';
    const ref = (item) => item ? `${item.path}:${item.line}` : '未定位';
    const collections = inventory.collections || [];
    const storage = inventory.storage || [];
    return `<div class="tr-list-intro"><strong>源码数据线索</strong><p>供技术排查：这里记录源码中定义、读取和修改数据的位置。名称相同不代表数据已关联，也不能据此认定正式系统的接口。</p></div><div class="tr-source-facts"><div class="tr-source-heading">扫描结果</div><div><span>项目数据集合</span><strong>${collections.length}</strong></div><div><span>浏览器存储键</span><strong>${storage.length}</strong></div><div><span>选择项待追踪</span><strong>${inventory.unresolved_option_count || 0}</strong></div></div><details class="tr-detail-group"><summary>数据的读写位置 <span>${collections.length}</span></summary>${collections.slice(0, 50).map((item) => `<div class="tr-effect"><strong>${escapeHtml(item.name)}</strong><div class="tr-small">定义：${escapeHtml(ref(item.definitions[0]))} · 读取 ${item.read_count} 处 · 修改 ${item.write_count} 处</div>${item.storage_keys.length ? `<div class="tr-small">浏览器存储：${escapeHtml(item.storage_keys.join('、'))}</div>` : ''}</div>`).join('') || '<p class="tr-muted">暂无可定位集合。</p>'}</details><details class="tr-detail-group"><summary>浏览器存储位置 <span>${storage.length}</span></summary>${storage.slice(0, 50).map((item) => `<div class="tr-effect"><strong>${escapeHtml(item.key)}</strong><div class="tr-small">读取：${escapeHtml(ref(item.reads[0]))} · 写入：${escapeHtml(ref(item.writes[0]))}</div></div>`).join('') || '<p class="tr-muted">暂无。</p>'}</details><p class="tr-small">完整排查索引保存在项目 docs/prototype-talk/data-map.md。</p>`;
  }
  function todoHtml(operationId = null) {
    const issues = state.data?.issues?.filter((item) => item.decision === 'accepted' && (!operationId || item.operation_id === operationId)) || [];
    return `<section class="tr-reading-section"><h4>已确认待办 · ${issues.filter((item) => item.todo_status !== 'resolved').length}</h4>${issues.map((item) => `<div class="tr-claim"><p>${escapeHtml(item.text)}</p><div class="tr-small">${escapeHtml(item.source === 'user' ? '用户标记' : '评审确认')} · ${escapeHtml(item.todo_status === 'resolved' ? '已解决' : '待修改')}</div><div class="tr-actions"><button data-open-operation="${escapeHtml(item.operation_id || '')}">查看位置</button>${item.todo_status !== 'resolved' ? `<button data-todo="${escapeHtml(item.issue_id)}" data-todo-status="resolved">标记完成</button>` : ''}</div></div>`).join('') || '<p class="tr-muted">当前范围没有正式待办。</p>'}</section>`;
  }
  function technicalPageHtml() {
    const spec = currentPageSpec();
    const functions = spec?.functions || [];
    return `<h3 class="tr-card-title">${escapeHtml(pageName())} · 技术概览</h3>${sourceChangeHtml()}<p class="tr-lead">${escapeHtml(spec?.purpose || '这份页面说明把可见行为、接口契约和 Demo 数据处理放在一起，供产品与技术逐项核对。')}</p>${frontendBehaviorHtml()}${displayFieldsHtml(true)}${sharedContractHtml()}${technicalRuleSectionHtml()}${backendImplementationHtml()}${functions.length ? `<details class="tr-detail-group"><summary>页面功能初稿 · ${functions.length}</summary><ul class="tr-fact-list">${functions.map((item) => `<li><strong>${escapeHtml(item.name)}</strong><div>${escapeHtml(item.outcome)}</div></li>`).join('')}</ul></details>` : ''}${visualEvidenceHtml()}<details class="tr-detail-group"><summary>项目数据索引</summary>${dataMapHtml()}</details>`;
  }
  function reviewCombinedHtml() {
    const operation = currentOperation();
    const card = operation && currentCard(operation.operation_id);
    const current = state.reviewScope === 'current';
    const latestCardIds = new Set((state.data?.cards || []).filter((item) => currentCard(item.operation_id)?.card_id === item.card_id).map((item) => item.card_id));
    const candidates = (state.data?.issues || []).filter((item) => item.decision === 'candidate' && (!item.card_id || latestCardIds.has(item.card_id)) && (!current || item.operation_id === operation?.operation_id));
    const openTodos = (state.data?.issues || []).filter((item) => item.decision === 'accepted' && item.todo_status !== 'resolved' && (!current || item.operation_id === operation?.operation_id));
    let html = `<h3 class="tr-card-title">评审与待办</h3><p class="tr-small">先核对说明，决定问题是否需要修改；已加入待办的事项会单独列在下面。</p>${reviewScopeHtml()}<div class="tr-review-summary"><span><strong>${candidates.length}</strong> 待决定</span><span><strong>${openTodos.length}</strong> 待修改</span></div>`;
    if (current && card) html += `<section class="tr-reading-section"><h4>当前产品说明</h4><p>${escapeHtml(compact(card.summary || card.title || '', 180))}</p><div class="tr-actions">${card.review_state === 'confirmed' ? '<span class="tr-pill confirmed">已确认</span>' : `<button class="tr-accept" data-card-review="confirmed" data-card="${escapeHtml(card.card_id)}">确认产品说明</button>`}<button data-action="show-issue">有误或缺失</button></div></section>`;
    if (candidates.length) html += `<section class="tr-reading-section"><h4>待决定的问题</h4>${candidates.slice(0, 20).map((issue) => `<div class="tr-issue"><p>${escapeHtml(issue.text)}</p><div class="tr-small">${escapeHtml(issue.reason || '依据待补')}</div><div class="tr-actions">${current ? '<button data-view="product">去原型旁回答</button>' : `<button data-open-operation="${escapeHtml(issue.operation_id || '')}">查看位置</button>`}<button data-issue="${escapeHtml(issue.issue_id)}" data-issue-decision="accepted">加入待办</button><button data-issue="${escapeHtml(issue.issue_id)}" data-issue-decision="rejected">忽略</button></div></div>`).join('')}</section>`;
    else html += '<p class="tr-muted">当前范围没有待决定的问题。</p>';
    html += todoHtml(current ? operation?.operation_id || '__none__' : null);
    if (current && operation) html += issueFormHtml(state.showIssueForm);
    html += `<details class="tr-detail-group"><summary>覆盖检查与交互索引</summary>${listHtml()}</details>`;
    return html;
  }
  function locateCurrentElement() {
    const operation = currentOperation();
    if (!operation) return;
    const element = liveElement(operation);
    if (!element || own(element) || !element.getClientRects().length) {
      state.localStatus = '当前页面未显示该元素，请先打开对应页面或弹窗。';
      render(); return;
    }
    state.localStatus = '';
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    element.classList.add('tr-target-flash');
    setTimeout(() => element.classList.remove('tr-target-flash'), 2200);
  }
  function render() {
    if (!panel || !body) return;
    panel.classList.toggle('tr-collapsed', state.collapsed);
    panel.querySelector('[data-action="collapse"]').textContent = state.collapsed ? '展开' : '收起';
    if (state.collapsed) return;
    for (const tab of panel.querySelectorAll('.tr-tabs [data-view]')) tab.setAttribute('aria-selected', String(tab.dataset.view === state.tab));
    const operation = currentOperation();
    const title = operation ? operationTitle(operation, currentCard(operation.operation_id)) : '';
    panel.querySelector('.tr-context').innerHTML = `<button data-scope="page" aria-current="${state.scope === 'page' ? 'page' : 'false'}">${escapeHtml(pageName())}</button>${title ? `<span>›</span><button data-scope="current" aria-current="${state.scope === 'current' ? 'page' : 'false'}">${escapeHtml(containerName(operation) ? `${containerName(operation)} · ${title}` : title === pageName() ? '当前入口' : title)}</button>` : ''}`;
    const editor = panel.querySelector('.tr-rule-editor');
    if (state.ruleDraft && editor?.dataset.ruleEditorScope === state.ruleDraft.scope && editor?.dataset.ruleEditorSlot === state.ruleDraft.slot) state.ruleDraft.value = editor.querySelector('[data-rule-text]')?.value;
    if (state.apiDraft && panel.querySelector('.tr-api-editor')) for (const control of panel.querySelectorAll('[data-api-input]')) state.apiDraft[control.dataset.apiInput] = control.type === 'checkbox' ? control.checked : control.value;
    for (const group of panel.querySelectorAll('details[data-api-group]')) { if (group.open) state.expandedApiGroups.add(group.dataset.apiGroup); else state.expandedApiGroups.delete(group.dataset.apiGroup); }
    const contractDetails = panel.querySelector('details[data-interface-decisions]');
    if (contractDetails) state.expandedContract = contractDetails.open;
    const generatedHere = state.scope === 'page' ? !!currentPageSpec() : !!(operation && currentCard(operation.operation_id));
    const scanNotice = state.data && !state.data.ai_enabled && !generatedHere && ['product', 'technical'].includes(state.tab) ? `<div class="tr-update-status"><strong>已找到页面与源码线索，完整说明待生成</strong><p>下方是原型中已观察到的事实；业务规则、数据链路与依据仍需模型核对。可回到对话调用 Skill 选择解析方式。</p><button class="tr-primary" data-action="enable-model">${state.data.model_consent_reusable ? '用 Codex CLI 生成当前说明' : '授权并启用 Codex CLI 自动解析'}</button></div>` : '';
    body.innerHTML = scanNotice + (state.tab === 'product' ? state.scope === 'page' ? pageOverviewHtml() : productHtml() : state.tab === 'technical' ? state.scope === 'page' ? technicalPageHtml() : technicalHtml() : state.tab === 'evidence' ? evidenceHtml() : reviewCombinedHtml());
    const readyPages = state.data?.page_specs?.filter((item) => item.source_snapshot_id === state.data?.source_snapshot_id).length || 0;
    const pendingPages = state.data?.project_jobs?.filter((item) => item.source_snapshot_id === state.data?.source_snapshot_id && ['queued', 'analyzing', 'validating'].includes(item.status)).reduce((sum, item) => sum + item.pages.length, 0) || 0;
    const savedResults = readyPages || (state.data?.cards || []).some((item) => item.source_snapshot_id === state.data?.source_snapshot_id);
    panel.querySelector('.tr-counter').textContent = state.localStatus || (state.data?.ai_enabled ? `${state.data.model_mode === 'conversation' ? '当前对话处理' : 'CLI 自动解析'} · 页面初稿 ${readyPages}${pendingPages ? `，${state.data.model_mode === 'conversation' ? '待处理' : '生成中'} ${pendingPages}` : ''}` : savedResults ? '本地索引完成 · 查看既有解析结果（本次未解析）' : '本地索引完成 · 完整原型说明尚未生成');
    updateJobTimers();
  }
  async function postAction(path, data) { try { await api(path, { method: 'POST', body: JSON.stringify(data) }); state.localStatus = ''; await refresh(); } catch (error) { state.localStatus = error.message; render(); } }
  function handlePanelClick(event) {
    const element = event.target.closest('button');
    if (!element) return;
    if (element.dataset.view) { state.tab = element.dataset.view; body.scrollTop = 0; render(); return; }
    if (element.dataset.scope) { state.scope = element.dataset.scope; state.apiDraft = null; body.scrollTop = 0; render(); return; }
    if (element.dataset.reviewScope) { state.reviewScope = element.dataset.reviewScope; render(); return; }
    if (element.dataset.listScope) { state.listScope = element.dataset.listScope; render(); return; }
    if (element.dataset.action === 'collapse') { state.collapsed = !state.collapsed; render(); return; }
    if (element.dataset.action === 'enable-model') {
      const root = state.data?.source_root || '';
      const destination = state.data?.model_destination || 'ChatGPT/Codex（CLI 默认模型）';
      const reuseConsent = !!state.data?.model_consent_reusable;
      if (!reuseConsent && !confirm(`Prototype Talk 将读取并发送以下资料到 ${destination}：\n项目：${root}\n范围：相关页面源码、PRD、Mock、实际操作记录（包括控件、输入变化和操作前后页面状态）。\n\n仅用于生成本项目的说明卡，结果保存在：${state.data?.output_directory || `${root}/docs/prototype-talk`}。允许吗？`)) return;
      state.localStatus = reuseConsent ? '沿用本项目已确认的资料范围，正在生成当前说明' : '已确认资料范围，正在启动当前说明的模型解析'; render();
      api('/model-mode', { method: 'POST', body: JSON.stringify({ consent: !reuseConsent, reuse_consent: reuseConsent, source_root: root, destination: 'ChatGPT/Codex', page_path: currentPagePath(), operation_id: state.scope === 'current' ? state.activeOperationId : '' }) }).then(() => { state.localStatus = ''; refresh(); }).catch((error) => { state.localStatus = `启动解析失败：${error.message}`; render(); });
      return;
    }
    if (element.dataset.action === 'sync-source') { api('/sync', { method: 'POST', body: '{}' }).then(refresh).catch((error) => { state.localStatus = `同步失败：${error.message}`; render(); }); return; }
    if (element.dataset.action === 'retry-page') { api('/project-jobs', { method: 'POST', body: JSON.stringify({ page_path: currentPagePath() }) }).then(() => { state.localStatus = '当前页已重新排队'; refresh(); }).catch((error) => { state.localStatus = error.message; render(); }); return; }
    if (element.dataset.action === 'reload-prototype') { location.reload(); return; }
    if (element.dataset.action === 'add-api-field') { state.apiDraft = { page_path: currentPagePath(), operation_id: state.scope === 'current' ? state.activeOperationId || null : null, direction: element.dataset.direction || 'response', key: '', label: '', description: '', type: 'string', required: true, nullable: false, example: '', display_field_id: '' }; render(); panel.querySelector('[data-api-input="key"]')?.focus(); return; }
    if (element.dataset.prefillApiField) {
      const field = activeDisplayFields().find((item) => item.field_id === element.dataset.prefillApiField);
      if (!field || field.ui_only) return;
      const existing = [...activeApiFields(null), ...(state.scope === 'current' && state.activeOperationId ? activeApiFields(state.activeOperationId) : [])].filter((item) => item.display_field_id === field.field_id).at(-1);
      const live = collectDisplayFields().find((item) => item.kind === field.kind && item.label === field.label && (!field.observed_usage || item.usage === field.observed_usage));
      const usage = live?.usage || field.observed_usage;
      const direction = field.kind === 'form_field' ? usage === 'filter' ? 'query' : 'body' : 'response';
      const locationLabel = field.kind === 'table_column' ? '列表列' : field.kind === 'detail_field' ? '详情字段' : usage === 'filter' ? '筛选字段' : '表单字段';
      state.apiDraft = existing ? { ...existing, fixed_display_field_id: field.field_id } : { page_path: currentPagePath(), operation_id: state.scope === 'current' ? state.activeOperationId || null : null, direction, key: /^[A-Za-z_$][\w$]*$/.test(field.source_key || '') ? field.source_key : '', label: field.label, description: `${locationLabel}「${field.label}」${field.observed_sample ? `；Demo 示例：${field.observed_sample}` : ''}`, type: 'string', required: false, nullable: false, example: field.observed_sample === '示例已脱敏' ? '' : field.observed_sample || '', display_field_id: field.field_id, fixed_display_field_id: field.field_id };
      render(); panel.querySelector('[data-api-input="key"]')?.focus(); return;
    }
    if (element.dataset.editApiField) { const field = state.data?.api_fields?.find((item) => item.field_id === element.dataset.editApiField); if (field) { state.apiDraft = { ...field }; render(); panel.querySelector('[data-api-input="key"]')?.focus(); } return; }
    if (element.dataset.action === 'cancel-api-field') { state.apiDraft = null; render(); return; }
    if (element.dataset.action === 'save-api-field' && state.apiDraft) {
      const form = element.closest('.tr-api-editor');
      const input = { ...state.apiDraft };
      for (const control of form.querySelectorAll('[data-api-input]')) input[control.dataset.apiInput] = control.type === 'checkbox' ? control.checked : control.value.trim();
      element.disabled = true;
      api('/api-fields', { method: 'POST', body: JSON.stringify(input) }).then(() => { state.apiDraft = null; state.localStatus = '接口字段已保存，技术方案已更新'; refresh(); }).catch((error) => { element.disabled = false; form.querySelector('.tr-inline-error').textContent = error.message; });
      return;
    }
    if (element.dataset.action === 'remove-api-field') { state.removeApiFieldId = element.dataset.fieldId; render(); return; }
    if (element.dataset.action === 'confirm-remove-api-field') { api('/api-fields/remove', { method: 'POST', body: JSON.stringify({ field_id: element.dataset.fieldId }) }).then(() => { state.removeApiFieldId = ''; state.localStatus = '接口行已移除，页面展示字段仍保留'; refresh(); }).catch((error) => { state.localStatus = error.message; render(); }); return; }
    if (element.dataset.action === 'locate') { locateCurrentElement(); return; }
    if (element.dataset.editRule) {
      const parent = element.closest('.tr-editable-row,.tr-rule-item');
      state.ruleDraft = { scope: element.dataset.editRule, slot: element.dataset.ruleSlot, label: element.dataset.ruleLabel, mode: element.dataset.ruleMode, operation_id: state.scope === 'page' ? null : state.activeOperationId || null, previous_text: parent?.querySelector('strong')?.textContent?.trim() || '' };
      render();
      panel.querySelector('[data-rule-text]')?.focus();
      return;
    }
    if (element.dataset.action === 'cancel-rule') { state.ruleDraft = null; render(); return; }
    if (element.dataset.action === 'save-rule' && state.ruleDraft) {
      const form = element.closest('.tr-rule-editor');
      const entered = form.querySelector('[data-rule-text]')?.value.trim();
      if (!entered) { form.querySelector('.tr-inline-error').textContent = '请填写这一条规则。'; return; }
      const draft = state.ruleDraft;
      const text = draft.mode === 'append' && draft.previous_text && draft.previous_text !== '待技术确认' ? `${draft.previous_text.replace(/[。；;\s]+$/, '')}；${entered}` : entered;
      element.disabled = true;
      api('/rules', { method: 'POST', body: JSON.stringify({ scope: draft.scope, page_path: currentPagePath(), operation_id: draft.operation_id, slot: draft.slot, label: draft.label, text, previous_text: draft.previous_text }) }).then(() => { state.ruleDraft = null; state.localStatus = '规则已保存，需求与技术文档已更新'; refresh(); }).catch((error) => { element.disabled = false; form.querySelector('.tr-inline-error').textContent = error.message; });
      return;
    }
    if (element.dataset.answerChoice !== undefined) { state.pendingAnswer = { operation_id: state.activeOperationId, issue_id: element.dataset.answerIssueId || null, key: element.dataset.answerKey, question: element.dataset.answerLabel, value: element.dataset.answerChoice }; render(); return; }
    if (element.dataset.action === 'prepare-answer') {
      const input = panel.querySelector('[data-quick-answer-input]');
      if (!input?.value.trim()) { panel.querySelector('.tr-decision .tr-inline-error').textContent = '请用一句话回答。'; return; }
      state.pendingAnswer = { operation_id: state.activeOperationId, issue_id: input.dataset.answerIssueId || null, key: input.dataset.answerKey, question: input.dataset.answerLabel, value: input.value.trim() }; render(); return;
    }
    if (element.dataset.action === 'cancel-answer') { state.pendingAnswer = null; render(); return; }
    if (element.dataset.action === 'skip-answer') { const input = panel.querySelector('[data-quick-answer-input]'); const key = input?.dataset.answerKey || panel.querySelector('[data-answer-choice]')?.dataset.answerKey; if (key) state.skippedQuestions.add(`${state.activeOperationId}:${key}`); state.pendingAnswer = null; render(); return; }
    if (element.dataset.action === 'confirm-answer' && state.pendingAnswer) {
      const answer = state.pendingAnswer;
      state.pendingAnswer = null;
      postAction('/supplements', { operation_id: answer.operation_id, card_id: currentCard(answer.operation_id)?.card_id || null, issue_id: answer.issue_id || null, answers: [{ key: answer.key, question: answer.question, value: answer.value }] });
      return;
    }
    if (element.dataset.cardReview) { postAction('/card/decide', { card_id: element.dataset.card, decision: element.dataset.cardReview }); return; }
    if (element.dataset.action === 'show-issue') { state.showIssueForm = true; render(); panel.querySelector('.tr-issue-form [data-issue-field="problem"]')?.focus(); return; }
    if (element.dataset.openOperation !== undefined) { if (element.dataset.openOperation) setActive(element.dataset.openOperation); return; }
    if (element.dataset.claim) { postAction('/claim', { card_id: element.dataset.card, claim_id: element.dataset.claim, decision: element.dataset.decision }); return; }
    if (element.dataset.issue) { postAction('/issues/decide', { issue_id: element.dataset.issue, decision: element.dataset.issueDecision }); return; }
    if (element.dataset.todo) { postAction('/todo', { issue_id: element.dataset.todo, status: element.dataset.todoStatus }); return; }
    if (element.dataset.action === 'save-supplement') {
      const form = element.closest('[data-supplement-form]');
      const answers = [...form.querySelectorAll('[data-question-key]')].map((control) => ({ key: control.dataset.questionKey, question: control.dataset.questionLabel, value: control.value.trim() })).filter((answer) => answer.value);
      if (!answers.length) { form.querySelector('.tr-inline-error').textContent = '请至少回答一项。'; return; }
      postAction('/supplements', { operation_id: state.activeOperationId, card_id: currentCard(state.activeOperationId)?.card_id || null, issue_id: form.dataset.issueId || null, answers });
      return;
    }
    if (element.dataset.action === 'mark-issue') {
      const form = element.closest('.tr-issue-form');
      const problem = form.querySelector('[data-issue-field="problem"]')?.value.trim();
      const expected = form.querySelector('[data-issue-field="expected"]')?.value.trim();
      const impact = form.querySelector('[data-issue-field="impact"]')?.value.trim();
      if (!problem) { form.querySelector('.tr-inline-error').textContent = '请先写清哪里不对或缺了什么。'; return; }
      const text = [problem, expected && `期望：${expected}`, impact && `影响：${impact}`].filter(Boolean).join('；');
      postAction('/issues', { operation_id: state.activeOperationId, card_id: currentCard(state.activeOperationId)?.card_id || null, text });
      return;
    }
    if (element.dataset.action === 'reanalyze' && state.activeOperationId) {
      api('/jobs', { method: 'POST', body: JSON.stringify({ operation_id: state.activeOperationId, kind: 'recheck', reason: state.tab === 'technical' ? '根据已确认的产品规则和现有技术补充，整理本操作的技术建议及待决接口项' : '用户要求重新核对当前说明' }) }).then((job) => { state.activeJobId = job.job_id; state.localStatus = ''; refresh(); }).catch((error) => { state.localStatus = error.message; render(); });
    }
  }
  function enableDrag() {
    const head = panel.querySelector('.tr-head');
    let drag;
    head.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      head.setPointerCapture(event.pointerId);
    });
    head.addEventListener('pointermove', (event) => {
      if (!drag) return;
      panel.style.left = `${Math.max(0, Math.min(innerWidth - panel.offsetWidth, event.clientX - drag.x))}px`;
      panel.style.top = `${Math.max(0, Math.min(innerHeight - 40, event.clientY - drag.y))}px`;
      panel.style.bottom = 'auto';
      panel.style.right = 'auto';
    });
    head.addEventListener('pointerup', () => { if (!drag) return; drag = null; localStorage.setItem(POSITION_KEY, JSON.stringify({ left: panel.style.left, top: panel.style.top })); });
  }
  function init() {
    panel = document.createElement('aside');
    panel.id = 'tech-review-panel';
    panel.setAttribute('data-tech-ui', '');
    panel.innerHTML = '<div class="tr-head"><span class="tr-title">Prototype Talk <small>原型说明</small></span><button type="button" data-action="collapse">收起</button></div><div class="tr-context"></div><div class="tr-tabs" role="tablist" aria-label="说明视角"><button type="button" data-view="product" aria-selected="true">产品说明</button><button type="button" data-view="technical" aria-selected="false">技术说明</button><button type="button" data-view="evidence" aria-selected="false">证据核对</button><button type="button" data-view="review" aria-selected="false">评审待办</button></div><div class="tr-body"></div><div class="tr-counter"></div>';
    document.body.append(panel);
    body = panel.querySelector('.tr-body');
    try { const position = JSON.parse(localStorage.getItem(POSITION_KEY) || 'null'); if (position?.left && position?.top) { panel.style.left = position.left; panel.style.top = position.top; panel.style.bottom = 'auto'; panel.style.right = 'auto'; } } catch { /* ignore */ }
    panel.addEventListener('click', handlePanelClick);
    panel.addEventListener('input', (event) => { if (event.target.classList.contains('tr-search')) { state.search = event.target.value; const start = event.target.selectionStart; render(); const next = panel.querySelector('.tr-search'); next?.focus(); next?.setSelectionRange(start, start); } });
    enableDrag();
    document.addEventListener('click', captureClick, true);
    document.addEventListener('pointerdown', captureLockedPointer, true);
    document.addEventListener('focusin', captureFocus, true);
    document.addEventListener('input', captureInput, true);
    document.addEventListener('change', captureInput, true);
    document.addEventListener('submit', (event) => { if (own(event.target)) return; if (pending) { pending.events.push({ type: 'submit', at: Date.now(), target: descriptor(event.target) }); scheduleFinalize(); } else begin('submit', descriptor(event.target)); }, true);
    addEventListener('hashchange', captureNavigation);
    addEventListener('popstate', captureNavigation);
    addEventListener('pagehide', () => finalize(true));
    new MutationObserver(observeMutations).observe(document.body, { childList: true, characterData: true, subtree: true, attributes: true });
    refresh();
    scheduleFieldInventory();
    setInterval(refresh, 1700);
    setInterval(updateJobTimers, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
