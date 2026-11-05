import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanSource, matchRuntimeControl } from './scanner.mjs';
import { ReviewStore } from './store.mjs';
import { COMPONENTS } from './component-catalog.mjs';
import { compactTrace, sourceHints } from './agent.mjs';
import { expectedMismatch } from './trace-match.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tech-prototype-demo-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'tech-prototype-review-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<button data-action="create">新建方案</button><button type="submit" form="planForm">提交</button><input name="keywords" placeholder="关键词">');
  fs.writeFileSync(path.join(root, 'app.js'), 'const html = `<button data-kind="smart">雷达方案</button>`; document.addEventListener("click", event => event.target.closest("[data-action]"));');
  return { root, out, cleanup() { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true }); } };
}

test('source scan finds static and template controls and matches runtime anchors', () => {
  const demo = fixture();
  try {
    const scan = scanSource(demo.root);
    assert.equal(scan.operations.length, 4);
    assert.ok(scan.operations.some((item) => item.label === '雷达方案'));
    const matched = matchRuntimeControl(scan.operations, { tag: 'button', label: '新建方案', data: { 'data-action': 'create' } }, '/index.html');
    assert.equal(matched?.label, '新建方案');
    assert.ok(scan.source_snapshot_id.startsWith('src_'));
  } finally { demo.cleanup(); }
});

test('repeated JSX labels do not claim an unrelated runtime control', () => {
  const operations = [1, 2].map((line) => ({
    label: '订阅', tag: 'button', page_hint: '/index.html', discovered_by: ['source_scan', 'jsx_ast'],
    anchor: { id: '', form: '', onclick: `handler${line}`, href: '', data: {}, source: { path: 'src/App.jsx', line } },
  }));
  assert.equal(matchRuntimeControl(operations, { label: '订阅', tag: 'button', data: {}, onclick: '' }, '/index.html'), null);
  assert.equal(matchRuntimeControl(operations, { label: '订阅', tag: 'button', data: {}, onclick: 'handler2' }, '/index.html'), operations[1]);
});

test('ambiguous JSX controls stay separate until a stable anchor identifies them', () => {
  const demo = fixture();
  try {
    fs.writeFileSync(path.join(demo.root, 'App.jsx'), 'export default function App(){ return <><button onClick={()=>foo()}>订阅</button><button onClick={()=>bar()}>订阅</button></>; }');
    const store = new ReviewStore(demo.root);
    const candidates = store.data.operations.filter((item) => item.label === '订阅' && item.discovered_by.includes('jsx_ast'));
    assert.equal(candidates.length, 2);
    const { operation } = store.addTrace({ operation_id: candidates[0].operation_id, trigger: 'click', target: { tag: 'button', label: '订阅', data: {}, onclick: '' }, before: { route: '/index.html', visible_text: '添加订阅' }, after: { route: '/index.html', visible_text: '方案名称' } });
    assert.notEqual(operation.operation_id, candidates[0].operation_id);
    assert.equal(operation.anchor.source, null);
    const repeated = store.addTrace({ operation_id: candidates[1].operation_id, trigger: 'click', target: { tag: 'button', label: '订阅', data: {}, onclick: '' }, before: { route: '/index.html', visible_text: '添加订阅' }, after: { route: '/index.html', visible_text: '方案名称' } });
    assert.notEqual(repeated.operation.operation_id, operation.operation_id);
  } finally { demo.cleanup(); }
});

test('compact operation evidence retains dialog results and exact trace id', () => {
  const summary = JSON.parse(compactTrace({ trace_id: 'trace_example', trigger: 'click', target: { label: '添加监测' }, before: { route: '/', visible_text: '首页', dialogs: [] }, after: { route: '/', visible_text: '首页', dialogs: ['添加订阅 监测方案 雷达方案'] }, events: [{ type: 'click' }] }));
  assert.equal(summary.trace_id, 'trace_example');
  assert.deepEqual(summary.after.dialogs, ['添加订阅 监测方案 雷达方案']);
});

test('a runtime JSX control exposes its nearby handler instead of truncating a long source line', () => {
  const demo = fixture();
  try {
    fs.writeFileSync(path.join(demo.root, 'App.jsx'), "const submitPlan = () => saveDraft();\n" + 'x'.repeat(6000) + '<button onClick={submitPlan}>保存订阅</button>');
    const hints = sourceHints(demo.root, { label: '保存订阅', anchor: { source: null, class_name: '' } }, { before: { visible_text: '方案名称' } });
    assert.ok(hints.includes('<button onClick={submitPlan}>保存订阅</button>'));
    assert.ok(hints.includes('const submitPlan = () => saveDraft()'));
  } finally { demo.cleanup(); }
});

test('replaying a list outcome across separate DOM lines does not start a false recheck', () => {
  const card = { expected_after: { route_contains: '/', visible_text: '方案名称、监测关键词、领域、保存订阅' } };
  const trace = { after: { route: '/', visible_text: '方案名称\n监测关键词\n领域\n保存订阅', dialogs: [] } };
  assert.equal(expectedMismatch(card, trace), false);
  assert.equal(expectedMismatch(card, { after: { route: '/', visible_text: '方案名称\n监测关键词\n保存订阅', dialogs: [] } }), true);
});

test('valueless data attributes link template buttons to delegated handlers', () => {
  const demo = fixture();
  try {
    fs.writeFileSync(path.join(demo.root, 'app.js'), [
      'const markup = `<button aria-label="新建对话" data-ai-new>新建</button>`;',
      'document.addEventListener("click", (event) => {',
      '  if (event.target.closest("[data-ai-new]")) startNewConversation();',
      '});',
    ].join('\n'));
    const operation = scanSource(demo.root).operations.find((item) => item.label === '新建对话');
    assert.ok(operation);
    assert.equal(Object.hasOwn(operation.anchor.data, 'data-ai-new'), true);
    assert.ok(operation.related_code.some((item) => item.line === 3));
  } finally { demo.cleanup(); }
});

test('list behavior follows the search handler and effective renderer, not an unrelated collection read', () => {
  const demo = fixture();
  try {
    fs.writeFileSync(path.join(demo.root, 'account.html'), `<button onclick="searchAccounts()">搜索</button><table id="accountTable"></table><script>
      const customer = { id: 1, name: '客户' };
      function searchAccounts() {
        const keyword = document.getElementById('keyword').value;
        const accounts = MOCK_ACCOUNTS.filter(a => a.customerId === customer.id);
        return accounts.filter(a => !keyword || [customer.name, a.loginName, a.phone, a.email].some(value => String(value).includes(keyword)));
      }
      function renderAccountTable() { totalEl.textContent = '共 ' + accounts.length + ' 条'; }
      function renderAccountTable() {
        const productRows = MOCK_ACCOUNTS.filter(a => a.customerId === customer.id).flatMap(a => a.products);
        totalEl.textContent = '共 ' + productRows.length + ' 条';
      }
    </script>`);
    fs.writeFileSync(path.join(demo.root, 'mock.js'), `const _DEFAULT_ACCOUNTS = []; const MOCK_ACCOUNTS = (function () {
      const saved = JSON.parse(localStorage.getItem('mock:accounts:v1') || '[]');
      const append = (items) => saved.push(...items);
      append(_DEFAULT_ACCOUNTS); return saved;
    })();`);
    const page = scanSource(demo.root).page_behaviors.find((item) => item.path === 'account.html');
    assert.deepEqual(page.actions[0].search_fields, ['customer.name', 'a.loginName', 'a.phone', 'a.email']);
    assert.equal(page.render.count_variable, 'productRows');
    assert.equal(page.render.source.line, 9);
    assert.deepEqual(page.collection.storage_keys, ['mock:accounts:v1']);
    assert.equal(page.collection.default_samples, true);
  } finally { demo.cleanup(); }
});

test('custom dropdown literal options have a source while dynamic options remain unresolved', () => {
  const demo = fixture();
  try {
    fs.writeFileSync(path.join(demo.root, 'account.html'), `
      <div onclick="CustomSelect.toggle('serviceStatus')">请选择服务状态</div>
      <div onclick="CustomSelect.toggle('region')">请选择地域</div>
      <select id="nativeStatus"><option value="">请选择状态</option><option value="on">已启用</option></select>
      <script>CustomSelect.init('serviceStatus', [
        { value: '', text: '请选择服务状态' },
        { value: 'active', text: '生效中' },
        { value: 'expired', text: '已过期' }
      ]); CustomSelect.init('region', REGIONS);</script>`);
    const operations = scanSource(demo.root).operations;
    const status = operations.find((item) => item.anchor.onclick === "CustomSelect.toggle('serviceStatus')");
    const region = operations.find((item) => item.anchor.onclick === "CustomSelect.toggle('region')");
    const native = operations.find((item) => item.anchor.id === 'nativeStatus');
    assert.deepEqual(status.option_source.options.map((item) => item.text), ['请选择服务状态', '生效中', '已过期']);
    assert.equal(status.option_source.source.path, 'account.html');
    assert.equal(region.option_source, null);
    assert.deepEqual(native.option_source.options.map((item) => item.text), ['请选择状态', '已启用']);
  } finally { demo.cleanup(); }
});

test('project-local review folder is created automatically and does not change source snapshot', () => {
  const demo = fixture();
  try {
    const before = scanSource(demo.root).source_snapshot_id;
    const store = new ReviewStore(demo.root);
    assert.equal(store.outputRoot, path.join(demo.root, 'docs', 'prototype-talk'));
    assert.ok(fs.existsSync(store.file));
    assert.ok(fs.existsSync(path.join(store.outputRoot, 'component-coverage.md')));
    assert.ok(store.publicState().component_questions.text_input.questions.length);
    assert.equal(store.data.operations.some((item) => Object.hasOwn(item.component, 'questions')), false);
    assert.equal(scanSource(demo.root).source_snapshot_id, before);
    const moved = fs.mkdtempSync(path.join(os.tmpdir(), 'tech-prototype-moved-'));
    try {
      fs.cpSync(demo.root, moved, { recursive: true });
      const reopened = new ReviewStore(moved);
      assert.equal(reopened.data.source_root, moved);
      assert.equal(reopened.data.created_at, store.data.created_at);
    } finally { fs.rmSync(moved, { recursive: true, force: true }); }
  } finally { demo.cleanup(); }
});

test('component catalog covers Web and App families and marks unknown custom controls for research', () => {
  const demo = fixture();
  try {
    assert.ok(COMPONENTS.some((item) => item.id === 'gesture' && item.platforms.includes('app')));
    fs.writeFileSync(path.join(demo.root, 'controls.html'), '<input type="date" id="start"><input type="file" id="attachment"><div onclick="mysteryWidget()">自定义控件</div>');
    const operations = scanSource(demo.root).operations;
    assert.equal(operations.find((item) => item.anchor.id === 'start').component.id, 'date_time');
    assert.equal(operations.find((item) => item.anchor.id === 'attachment').component.id, 'file_upload');
    const unknown = operations.find((item) => item.anchor.onclick === 'mysteryWidget()');
    assert.equal(unknown.component.status, 'needs_research');
    assert.ok(scanSource(demo.root).unmatched_components.some((item) => item.example.operation_id === unknown.operation_id));
  } finally { demo.cleanup(); }
});

test('data inventory is built before review and keeps source, reads, writes, and storage evidence apart', () => {
  const demo = fixture();
  try {
    fs.writeFileSync(path.join(demo.root, 'mock.js'), "const STORE_KEY = 'demo:items';\nconst MOCK_ITEMS = (() => { const cached = localStorage.getItem(STORE_KEY); return cached ? JSON.parse(cached) : []; })();\nMOCK_ITEMS.filter(item => item.active);\nMOCK_ITEMS.push({ active: true });\nlocalStorage.setItem(STORE_KEY, JSON.stringify(MOCK_ITEMS));\n");
    fs.writeFileSync(path.join(demo.root, '需求文档PRD.md'), '## 客户列表\n### 查询条件\n- 客户名称\n- 状态\n### 新增客户\n提交后新增客户。\n');
    const store = new ReviewStore(demo.root);
    const items = store.data.data_inventory.collections.find((item) => item.name === 'MOCK_ITEMS');
    assert.equal(items.definitions[0].path, 'mock.js');
    assert.equal(items.read_count, 1);
    assert.equal(items.write_count, 1);
    assert.deepEqual(items.storage_keys, ['demo:items']);
    assert.ok(store.data.data_inventory.storage.some((item) => item.key === 'demo:items' && item.reads.length && item.writes.length));
    assert.ok(store.data.data_inventory.document_refs.some((item) => item.path === '需求文档PRD.md' && item.excerpt.includes('状态')));
    assert.deepEqual(store.data.data_inventory.requirement_sections.filter((item) => item.ancestors.includes('客户列表')).map((item) => item.title), ['查询条件', '新增客户']);
    assert.ok(fs.readFileSync(path.join(store.outputRoot, 'data-map.md'), 'utf8').includes('MOCK_ITEMS'));
  } finally { demo.cleanup(); }
});

test('trace, claim review, candidate issue and user Todo remain separate', () => {
  const demo = fixture();
  try {
    const store = new ReviewStore(demo.root, demo.out);
    const { operation, trace } = store.addTrace({ target: { tag: 'button', label: '提交', form: 'planForm', data: {} }, trigger: 'click', before: { route: '/index.html' }, after: { route: '/index.html', visible_text: '成功' }, events: [{ type: 'click' }] });
    assert.equal(operation.coverage, 'observed');
    const job = store.createJob('on_demand', operation.operation_id, [trace.trace_id], 'test');
    assert.equal(job.status, 'queued');
    const { card, issues } = store.addResult(job, { title: '提交方案', summary: '测试', page_context: { purpose: '创建方案', layout: '表单区域', evidence: ['需求文档PRD.md:1'] }, quick_facts: [{ label: '结果', value: '新增方案' }], expected_after: { route_contains: '', visible_text: '成功' }, expected_effects: [{ target: '方案', change: '新增记录', condition: '校验通过', verification: '列表新增一条', origin: 'source_observed', evidence: ['app.js:1'] }], claims: [{ section: 'behavior', text: '提交后显示成功', origin: 'runtime_observed', evidence: [trace.trace_id] }, { section: 'interface', text: '建议新增接口', origin: 'proposed', evidence: [] }], issues: [{ text: '接口未定义', reason: '缺少 API 文档', evidence: [], questions: [{ key: 'owner', label: '由哪个服务处理？', type: 'text', options: [], placeholder: '服务名' }] }] });
    assert.equal(card.claims.length, 2);
    assert.equal(card.quick_facts[0].value, '新增方案');
    assert.equal(card.expected_effects[0].target, '方案');
    assert.equal(new ReviewStore(demo.root, demo.out).latestCard(operation.operation_id).page_context.purpose, '创建方案');
    assert.equal(card.claims[0].confirmation_state, 'ai_pending');
    store.decideClaim(card.card_id, card.claims[0].claim_id, 'confirmed');
    assert.equal(store.latestCard(operation.operation_id).claims[1].confirmation_state, 'ai_pending');
    assert.equal(issues[0].decision, 'candidate');
    assert.equal(issues[0].todo_status, null);
    assert.equal(issues[0].questions[0].key, 'owner');
    const supplement = store.addSupplement({ operation_id: operation.operation_id, card_id: card.card_id, issue_id: issues[0].issue_id, answers: [{ key: 'owner', question: '由哪个服务处理？', value: '客户服务' }] });
    assert.equal(supplement.answers[0].value, '客户服务');
    assert.equal(issues[0].todo_status, null);
    assert.equal(new ReviewStore(demo.root, demo.out).data.supplements[0].supplement_id, supplement.supplement_id);
    store.decideIssue(issues[0].issue_id, 'accepted');
    assert.equal(issues[0].todo_status, 'open');
    const own = store.addUserIssue({ operation_id: operation.operation_id, text: '用户标记的问题' });
    assert.equal(own.decision, 'accepted');
    assert.equal(own.todo_status, 'open');
    store.decideCard(card.card_id, 'confirmed');
    assert.equal(card.review_state, 'confirmed');
    assert.equal(card.claims[1].confirmation_state, 'ai_pending');
    assert.equal(new ReviewStore(demo.root, demo.out).data.cards[0].review_state, 'confirmed');
    store.addResult(store.createJob('recheck', operation.operation_id, [trace.trace_id], 'recheck'), { title: '提交方案', summary: '新版', expected_after: { route_contains: '', visible_text: '' }, claims: [], issues: [] });
    assert.equal(store.data.cards.length, 2);
    assert.equal(store.data.cards[0].claims[0].confirmation_state, 'confirmed');
  } finally { demo.cleanup(); }
});

test('inline handlers distinguish same-label controls on a management page', () => {
  const demo = fixture();
  try {
    fs.writeFileSync(path.join(demo.root, 'management.html'), '<button onclick="submitOrder()">确认</button><button onclick="confirmDelete()">确认</button><div onclick="openRegion()"><span>客户地域</span></div>');
    const controls = scanSource(demo.root).operations;
    const matched = matchRuntimeControl(controls, { tag: 'button', label: '确认', onclick: 'confirmDelete()', data: {} }, '/management.html');
    assert.equal(matched?.anchor.onclick, 'confirmDelete()');
    assert.ok(controls.some((item) => item.anchor.onclick === 'openRegion()'));
  } finally { demo.cleanup(); }
});

test('scripted page tab is recognized as navigation with a target page', () => {
  const demo = fixture();
  try {
    fs.writeFileSync(path.join(demo.root, 'detail-order.html'), '<a id="accountTabLink" class="inner-tab" onclick="location.href=\'detail-account.html?id=\' + customerId">账号管理</a>');
    const operation = scanSource(demo.root).operations.find((item) => item.anchor.id === 'accountTabLink');
    assert.equal(operation?.component?.id, 'navigation');
    assert.equal(operation?.label, '账号管理');
  } finally { demo.cleanup(); }
});

test('field focus resolves the nearby form label and keeps the source anchor', () => {
  const demo = fixture();
  try {
    fs.writeFileSync(path.join(demo.root, 'customer.html'), '<div class="modal-form-item"><label class="modal-label required">客户名称</label><input id="addCustName" maxlength="50" placeholder="请输入2-50位客户名称"></div>');
    const field = scanSource(demo.root).operations.find((item) => item.anchor.id === 'addCustName');
    assert.equal(field.label, '客户名称');
    assert.equal(field.anchor.source.line, 1);
    const matched = matchRuntimeControl(scanSource(demo.root).operations, { tag: 'input', id: 'addCustName', label: '客户名称', data: {} }, '/customer.html');
    assert.equal(matched?.operation_id, field.operation_id);
  } finally { demo.cleanup(); }
});

test('runtime label for a custom dropdown survives a source rescan', () => {
  const demo = fixture();
  try {
    fs.writeFileSync(path.join(demo.root, 'customer.html'), '<div onclick="CustomSelect.toggle(\'industry\')"><span>请选择行业类型</span></div>');
    const store = new ReviewStore(demo.root, demo.out);
    const { operation } = store.addTrace({ target: { tag: 'div', label: '行业类型', onclick: "CustomSelect.toggle('industry')", data: {} }, trigger: 'click', before: { route: '/customer.html' }, after: { route: '/customer.html' }, events: [{ type: 'click' }] });
    assert.equal(operation.label, '行业类型');
    const reopened = new ReviewStore(demo.root, demo.out);
    assert.equal(reopened.data.operations.find((item) => item.operation_id === operation.operation_id).label, '行业类型');
  } finally { demo.cleanup(); }
});

test('dynamic count button takes its runtime category label instead of source concatenation', () => {
  const demo = fixture();
  try {
    fs.writeFileSync(path.join(demo.root, 'account.html'), "const head = '<button data-acct-product-menu-count=\"' + escape(category) + '\" onclick=\"toggleMenu(this)\">' + selected + '/' + fields.length + '</button>';", 'utf8');
    const store = new ReviewStore(demo.root, demo.out);
    const operation = store.data.operations.find((item) => item.anchor.onclick === 'toggleMenu(this)');
    assert.equal(operation.label, 'button');
    store.addTrace({ operation_id: operation.operation_id, target: { tag: 'button', label: '新建报告 · 二级菜单权限', onclick: 'toggleMenu(this)', data: { 'data-acct-product-menu-count': '新建报告' } }, trigger: 'click', before: { route: '/account.html' }, after: { route: '/account.html' }, events: [] });
    assert.equal(operation.label, '新建报告 · 二级菜单权限');
    const reopened = new ReviewStore(demo.root, demo.out);
    assert.equal(reopened.data.operations.find((item) => item.operation_id === operation.operation_id).label, '新建报告 · 二级菜单权限');
  } finally { demo.cleanup(); }
});

test('dynamic permission checkboxes keep separate runtime codes and checked state', () => {
  const demo = fixture();
  try {
    fs.writeFileSync(path.join(demo.root, 'rights.html'), "const row = '<label><input type=\"checkbox\" data-menu-permission=\"' + escape(field.code) + '\"><span>' + escape(field.name) + '</span></label>';", 'utf8');
    const store = new ReviewStore(demo.root, demo.out);
    const target = (code, label) => ({ tag: 'input', type: 'checkbox', label, data: { 'data-menu-permission': code }, selector: `[data-menu-permission="${code}"]`, editability: 'editable', current_value: '已勾选' });
    const first = store.addTrace({ target: target('report.menu.create', '新建报告菜单'), trigger: 'focus', before: { route: '/rights.html' }, after: { route: '/rights.html' }, events: [] }).operation;
    const second = store.addTrace({ target: target('report.menu.search', '搜索主题'), trigger: 'focus', before: { route: '/rights.html' }, after: { route: '/rights.html' }, events: [] }).operation;
    assert.notEqual(first.operation_id, second.operation_id);
    assert.equal(first.anchor.data['data-menu-permission'], 'report.menu.create');
    assert.equal(first.latest_runtime.current_value, '已勾选');
    assert.equal(first.latest_runtime.type, 'checkbox');
  } finally { demo.cleanup(); }
});

test('shared menu-count handler keeps categories separate after the first click', () => {
  const demo = fixture();
  try {
    fs.writeFileSync(path.join(demo.root, 'rights.html'), "const row = '<button data-menu-count=\"' + escape(category) + '\" onclick=\"toggleMenu(this)\">' + selected + '/' + fields.length + '</button>';", 'utf8');
    const store = new ReviewStore(demo.root, demo.out);
    const target = (name) => ({ tag: 'button', type: 'button', label: `${name} · 二级菜单权限`, onclick: 'toggleMenu(this)', data: { 'data-menu-count': name }, selector: `[data-menu-count="${name}"]` });
    const first = store.addTrace({ target: target('新建报告'), trigger: 'click', before: { route: '/rights.html' }, after: { route: '/rights.html' }, events: [] }).operation;
    const second = store.addTrace({ operation_id: first.operation_id, target: target('智能巡查'), trigger: 'click', before: { route: '/rights.html' }, after: { route: '/rights.html' }, events: [] }).operation;
    assert.notEqual(first.operation_id, second.operation_id);
    assert.equal(first.label, '新建报告 · 二级菜单权限');
    assert.equal(second.label, '智能巡查 · 二级菜单权限');
    assert.equal(second.anchor.source.path, 'rights.html');
    const reopened = new ReviewStore(demo.root, demo.out);
    assert.equal(reopened.data.operations.find((item) => item.operation_id === first.operation_id).instance_data['data-menu-count'], '新建报告');
    assert.equal(reopened.data.operations.find((item) => item.operation_id === second.operation_id).label, '智能巡查 · 二级菜单权限');
  } finally { demo.cleanup(); }
});

test('readonly field records editability and the source of its displayed value', () => {
  const demo = fixture();
  try {
    fs.mkdirSync(path.join(demo.root, 'mock'));
    fs.writeFileSync(path.join(demo.root, 'mock', 'data.js'), 'const MOCK_ORDERS = (() => { const saved = localStorage.getItem("orders"); return saved ? JSON.parse(saved) : [{id:1, customer:"示例客户"}]; })();');
    fs.writeFileSync(path.join(demo.root, 'order.html'), '<label>所属客户</label><input id="editOrderCustomer" readonly>\n<script>function openEditOrder(id) { const order = MOCK_ORDERS.find(o => o.id === id); document.getElementById("editOrderCustomer").value = order.customer || ""; }</script>');
    const store = new ReviewStore(demo.root, demo.out);
    const field = store.data.operations.find((item) => item.anchor.id === 'editOrderCustomer');
    assert.equal(field.field_meta.declared_editability, 'readonly');
    assert.equal(field.field_meta.value_bindings[0].expression, 'order.customer || ""');
    assert.equal(field.field_meta.value_bindings[0].collection, 'MOCK_ORDERS');
    assert.equal(field.field_meta.value_bindings[0].collection_source.path, 'mock/data.js');
    assert.equal(field.field_meta.value_bindings[0].collection_origin, 'browser_cache_or_default_mock');
    store.addTrace({ target: { tag: 'input', id: 'editOrderCustomer', label: '所属客户', data: {}, editability: 'readonly', current_value: '示例客户' }, trigger: 'focus', before: { route: '/order.html' }, after: { route: '/order.html' }, events: [] });
    assert.equal(new ReviewStore(demo.root, demo.out).data.operations.find((item) => item.operation_id === field.operation_id).latest_runtime.current_value, '示例客户');
  } finally { demo.cleanup(); }
});
