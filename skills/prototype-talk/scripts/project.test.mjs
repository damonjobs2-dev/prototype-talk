import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReviewStore } from './store.mjs';
import { scanSource } from './scanner.mjs';
import { pageBatches, progressiveBatches, movePageToFront, projectPages, validateProjectResult, interpretProjectBatch } from './project-agent.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-talk-project-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-talk-result-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<title>客户列表</title><main><h1>客户列表</h1><button id="addCustomer">新增客户</button></main>');
  fs.writeFileSync(path.join(root, 'PRD.md'), '# 客户管理\n新增客户后列表应出现记录。\n');
  return { root, out, cleanup() { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true }); } };
}

test('first-pass page spec keeps verified evidence and saves it beside review state', () => {
  const demo = fixture();
  try {
    const store = new ReviewStore(demo.root, demo.out);
    assert.deepEqual(projectPages(demo.root), ['/index.html']);
    assert.deepEqual(pageBatches(['/a.html', '/b.html'], 1), [['/a.html'], ['/b.html']]);
    const operation = store.data.operations.find((item) => item.label === '新增客户');
    const page = {
      path: '/index.html', title: '客户列表', purpose: '查看客户并新增客户。',
      layout: [{ text: '页面顶部有标题和新增客户入口。', origin: 'source_observed', evidence: ['index.html:1'] }],
      functions: [{ name: '新增客户', outcome: '创建客户并返回列表。', operation_ids: [operation.operation_id, 'op_fake'], origin: 'documented', evidence: ['PRD.md:2'] }],
      states: [], data: [{ text: '正式接口是 POST /customers。', origin: 'source_observed', evidence: ['missing.txt:1'] }], open_questions: [], evidence: ['index.html:1'],
    };
    const validated = validateProjectResult(demo.root, ['/index.html'], store.data.operations, { pages: [page] });
    assert.deepEqual(validated[0].functions[0].operation_ids, [operation.operation_id]);
    assert.equal(validated[0].data.length, 0);
    const job = store.createProjectJob(['/index.html']);
    store.addProjectResult(job, validated);
    assert.equal(store.pageSpec('/index.html').purpose, page.purpose);
    assert.match(fs.readFileSync(path.join(demo.out, 'project-spec.md'), 'utf8'), /新增客户/);
    assert.equal(new ReviewStore(demo.root, demo.out).createProjectJob(['/index.html']), null);
  } finally { demo.cleanup(); }
});

test('progressive page jobs put the entry first and prioritize the page being viewed', () => {
  assert.deepEqual(progressiveBatches(['/article/*', '/reports/*', '/home', '/alerts', '/subs']), [['/home'], ['/article/*', '/reports/*'], ['/alerts', '/subs']]);
  const queue = ['a', 'b', 'c'];
  const jobs = [{ job_id: 'a', pages: ['/home'] }, { job_id: 'b', pages: ['/article/*', '/reports/*'] }, { job_id: 'c', pages: ['/alerts', '/subs'] }];
  assert.equal(movePageToFront(queue, jobs, '/subs'), true);
  assert.deepEqual(queue, ['c', 'a', 'b']);
});

test('service restart keeps queued work and marks only interrupted work for explicit retry', () => {
  const demo = fixture();
  try {
    const store = new ReviewStore(demo.root, demo.out);
    const operation = store.data.operations.find((item) => item.label === '新增客户');
    const queuedPage = store.createProjectJob(['/index.html']);
    const queuedCard = store.createJob('on_demand', operation.operation_id);
    const interruptedCard = store.createJob('recheck', operation.operation_id);
    assert.equal(interruptedCard.job_id, queuedCard.job_id);
    store.updateJob(queuedCard.job_id, { status: 'analyzing' });
    const restarted = new ReviewStore(demo.root, demo.out);
    assert.equal(restarted.data.project_jobs.find((item) => item.job_id === queuedPage.job_id).status, 'queued');
    assert.equal(restarted.data.jobs.find((item) => item.job_id === queuedCard.job_id).status, 'failed');
    assert.match(restarted.data.jobs.find((item) => item.job_id === queuedCard.job_id).error, /运行中的任务已中断/);
  } finally { demo.cleanup(); }
});

test('public review state exposes latest operation outcomes without raw trace text', () => {
  const demo = fixture();
  try {
    const store = new ReviewStore(demo.root, demo.out);
    const operationId = store.data.operations[0].operation_id;
    const trace = (id, message, snapshotId = store.data.source_snapshot_id) => ({
      trace_id: id, operation_id: operationId, source_snapshot_id: snapshotId, recorded_at: id,
      before: { visible_text: '表单', dialogs: [] },
      after: { visible_text: `表单 ${message}`, dialogs: [message] },
    });
    store.data.traces.push(trace('old', '请填写客户名称'), trace('new', '保存成功'), trace('stale', '旧版本结果', 'previous_snapshot'));
    const publicState = store.publicState();
    assert.equal(publicState.traces, undefined);
    assert.deepEqual(publicState.operation_observations.map((item) => item.message), ['请填写客户名称', '保存成功']);
    assert.equal(JSON.stringify(publicState.operation_observations).includes('visible_text'), false);
  } finally { demo.cleanup(); }
});

test('a corrected rule updates the visible specification and both generated handoff documents', () => {
  const demo = fixture();
  try {
    const store = new ReviewStore(demo.root, demo.out);
    const operation = store.data.operations.find((item) => item.label === '新增客户');
    const first = store.addRule({ scope: 'product', page_path: '/index.html', operation_id: operation.operation_id, slot: '完成后', label: '完成后', text: '列表新增一条客户记录。' });
    const second = store.addRule({ scope: 'product', page_path: '/index.html', operation_id: operation.operation_id, slot: '完成后', label: '完成后', text: '列表新增客户及试用账号。', previous_text: first.text });
    assert.equal(store.data.rules.find((item) => item.rule_id === first.rule_id).superseded_by, second.rule_id);
    const prd = fs.readFileSync(path.join(demo.out, 'requirements.generated.md'), 'utf8');
    assert.match(prd, /列表新增客户及试用账号/);
    assert.doesNotMatch(prd, /列表新增一条客户记录/);
    store.addRule({ scope: 'technical', page_path: '/index.html', operation_id: operation.operation_id, slot: 'method_path', label: '方法与路径', text: 'POST /customers' });
    const design = fs.readFileSync(path.join(demo.out, 'technical-design.generated.md'), 'utf8');
    assert.match(design, /POST \/customers/);
    assert.match(design, /请求整体约束.*待技术确认/);
    const job = store.createJob('recheck', operation.operation_id);
    store.addResult(job, { title: '新增客户', summary: '保存客户', expected_after: {}, claims: [{ section: 'interface', text: '候选请求包含客户名称。', origin: 'proposed', evidence: [] }], issues: [] });
    assert.match(fs.readFileSync(path.join(demo.out, 'technical-design.generated.md'), 'utf8'), /模型整理的实现线索/);
    assert.match(fs.readFileSync(path.join(demo.out, 'handoff.generated.md'), 'utf8'), /仍有待确认项/);
    assert.throws(() => store.addRule({ scope: 'technical', page_path: '../bad', slot: 'method_path', label: '方法与路径', text: 'GET' }), /页面位置无效/);
  } finally { demo.cleanup(); }
});

test('technical document renders page query and operation write contracts once each', () => {
  const demo = fixture();
  try {
    const store = new ReviewStore(demo.root, demo.out);
    const operation = store.data.operations.find((item) => item.label === '新增客户');
    store.addRule({ scope: 'technical', page_path: '/index.html', slot: 'method_path', label: '方法与路径', text: 'GET /customers' });
    store.addRule({ scope: 'technical', page_path: '/index.html', operation_id: operation.operation_id, slot: 'method_path', label: '方法与路径', text: 'POST /customers' });
    store.upsertApiField({ page_path: '/index.html', operation_id: operation.operation_id, direction: 'body', key: 'name', label: '客户名称', description: '新建客户的名称', type: 'string' });
    const design = fs.readFileSync(path.join(demo.out, 'technical-design.generated.md'), 'utf8');
    assert.equal(design.match(/GET \/customers/g)?.length, 1);
    assert.equal(design.match(/POST \/customers/g)?.length, 1);
    assert.equal(design.match(/`name` \| 客户名称/g)?.length, 1);
    assert.equal(store.publicState().contracts.length, 2);
  } finally { demo.cleanup(); }
});

test('source edits rescan affected pages, hide stale cards, and retain untouched page briefs', () => {
  const demo = fixture();
  try {
    fs.writeFileSync(path.join(demo.root, 'second.html'), '<h1>第二页</h1><button id="openSecond">打开</button><table><th>标题</th></table>');
    const store = new ReviewStore(demo.root, demo.out);
    const first = store.data.operations.find((item) => item.label === '新增客户');
    const second = store.data.operations.find((item) => item.label === '打开');
    for (const [pagePath, title] of [['/index.html', '客户列表'], ['/second.html', '第二页']]) {
      const job = store.createProjectJob([pagePath]);
      store.addProjectResult(job, [{ path: pagePath, title, purpose: title, layout: [], functions: [], states: [], data: [], open_questions: [], evidence: [] }]);
    }
    const firstJob = store.createJob('initial_scan', first.operation_id);
    store.addResult(firstJob, { title: '新增客户', summary: '打开新增表单', expected_after: {}, claims: [], issues: [] });
    const secondJob = store.createJob('initial_scan', second.operation_id);
    store.addResult(secondJob, { title: '打开', summary: '进入第二页', expected_after: {}, claims: [], issues: [] });
    store.addRule({ scope: 'product', page_path: '/index.html', operation_id: first.operation_id, slot: '结果', label: '结果', text: '打开表单。' });
    const before = store.data.source_snapshot_id;
    fs.writeFileSync(path.join(demo.root, 'index.html'), '<title>客户列表</title><main><h1>客户列表</h1><button id="addCustomer">新增客户</button><table><th>客户名称</th></table></main>');
    const change = store.rescanIfChanged();
    assert.notEqual(store.data.source_snapshot_id, before);
    assert.deepEqual(change.affected_pages, ['/index.html']);
    assert.equal(store.latestCard(first.operation_id), null);
    assert.equal(store.pageSpec('/index.html'), null);
    assert.ok(store.latestCard(second.operation_id));
    assert.ok(store.pageSpec('/second.html'));
    assert.ok(store.data.display_fields.some((item) => item.page_path === '/index.html' && item.label === '客户名称'));
    assert.equal(store.data.rules.find((item) => item.operation_id === first.operation_id).review_status, 'prototype_changed');
    assert.throws(() => store.recordRuntimeFields({ page_path: '/index.html', loaded_at: new Date(Date.parse(change.created_at) - 1000).toISOString(), fields: [{ kind: 'table_column', label: '旧字段' }] }), /刷新页面/);
  } finally { demo.cleanup(); }
});

test('first scan after adding CSS tracking migrates an unchanged legacy snapshot without a false source change', () => {
  const demo = fixture();
  try {
    fs.writeFileSync(path.join(demo.root, 'app.css'), 'body { color: blue; }');
    const store = new ReviewStore(demo.root, demo.out);
    const operation = store.data.operations.find((item) => item.label === '新增客户');
    const job = store.createProjectJob(['/index.html']);
    store.addProjectResult(job, [{ path: '/index.html', title: '客户列表', purpose: '查看客户', layout: [], functions: [], states: [], data: [], open_questions: [], evidence: [] }]);
    const state = JSON.parse(fs.readFileSync(store.file, 'utf8'));
    const legacy = scanSource(demo.root).legacy_snapshot_id;
    state.source_snapshot_id = legacy;
    state.page_specs[0].source_snapshot_id = legacy;
    delete state.file_hashes;
    fs.writeFileSync(store.file, JSON.stringify(state));
    const upgraded = new ReviewStore(demo.root, demo.out);
    assert.ok(upgraded.pageSpec('/index.html'));
    assert.equal(upgraded.data.prototype_changes.length, 0);
    assert.ok(upgraded.data.operations.some((item) => item.operation_id === operation.operation_id));
  } finally { demo.cleanup(); }
});

test('prototype display fields remain fixed while technical API rows can be edited and removed', () => {
  const demo = fixture();
  try {
    fs.writeFileSync(path.join(demo.root, 'index.html'), '<h1>客户列表</h1><table><thead><tr><th>序号</th><th>登录名称</th><th>操作</th></tr></thead></table><script>const CUSTOMER_COLUMNS = [{key:"login",title:"登录名称",visible:true}];</script>');
    const store = new ReviewStore(demo.root, demo.out);
    const fields = store.data.display_fields.filter((item) => item.page_path === '/index.html');
    assert.equal(fields.length, 3);
    assert.equal(fields.find((item) => item.label === '序号').ui_only, true);
    const display = fields.find((item) => item.label === '登录名称');
    assert.equal(display.source_key, 'login');
    const initialDesign = fs.readFileSync(path.join(demo.out, 'technical-design.generated.md'), 'utf8');
    assert.match(initialDesign, /`login` \| 登录名称 \| 页面列表列「登录名称」/);
    assert.match(initialDesign, /原型预填；字段 ID 为 Demo 键候选/);
    assert.match(initialDesign, /原型固定；无需接口/);
    const api = store.upsertApiField({ page_path: '/index.html', direction: 'response', key: 'items[].loginName', label: '登录名称', description: '账号的登录名', type: 'string', required: true, display_field_id: display.field_id });
    store.addRule({ scope: 'technical', page_path: '/index.html', operation_id: null, slot: 'api_name', label: '接口名称与用途', text: '查询客户登录账号' });
    store.addRule({ scope: 'technical', page_path: '/index.html', operation_id: null, slot: 'method_path', label: '方法与路径', text: 'GET /customers/{id}/accounts' });
    assert.match(fs.readFileSync(path.join(demo.out, 'technical-design.generated.md'), 'utf8'), /items\[\]\.loginName/);
    assert.match(fs.readFileSync(path.join(demo.out, 'technical-design.generated.md'), 'utf8'), /查询客户登录账号[\s\S]*GET \/customers\/\{id\}\/accounts/);
    assert.doesNotMatch(fs.readFileSync(path.join(demo.out, 'handoff.generated.md'), 'utf8'), /页面接口字段已有定义，方法与路径仍待技术确认/);
    assert.doesNotMatch(fs.readFileSync(path.join(demo.out, 'handoff.generated.md'), 'utf8'), /登录名称：页面展示字段尚未映射/);
    store.removeApiField(api.field_id);
    assert.equal(store.data.display_fields.find((item) => item.field_id === display.field_id).status, 'current');
    assert.match(fs.readFileSync(path.join(demo.out, 'technical-design.generated.md'), 'utf8'), /`login` \| 登录名称 \| 页面列表列「登录名称」/);
    assert.match(fs.readFileSync(path.join(demo.out, 'handoff.generated.md'), 'utf8'), /登录名称：页面展示字段尚未映射/);
    assert.throws(() => store.upsertApiField({ page_path: '/index.html', direction: 'response', key: 'broken key', label: '错误', description: '无效' }), /字段 ID/);
  } finally { demo.cleanup(); }
});

test('runtime field samples and request usage survive a restart without a source change', () => {
  const demo = fixture();
  try {
    fs.writeFileSync(path.join(demo.root, 'index.html'), '<label>客户名称</label><input>');
    const store = new ReviewStore(demo.root, demo.out);
    store.recordRuntimeFields({ page_path: '/index.html', loaded_at: new Date().toISOString(), fields: [{ kind: 'form_field', label: '客户名称', visible: true, usage: 'filter', sample: '中新海针' }, { kind: 'form_field', label: '客户名称', visible: true, usage: 'form', sample: '' }] });
    const restarted = new ReviewStore(demo.root, demo.out);
    const fields = restarted.data.display_fields.filter((item) => item.label === '客户名称' && item.status !== 'removed');
    assert.equal(fields.length, 2);
    assert.deepEqual(fields.map((item) => item.observed_usage).sort(), ['filter', 'form']);
    assert.equal(fields.find((item) => item.observed_usage === 'filter').observed_sample, '中新海针');
    assert.match(fs.readFileSync(path.join(demo.out, 'technical-design.generated.md'), 'utf8'), /请求候选.*客户名称/);
  } finally { demo.cleanup(); }
});

test('single-HTML application exposes source-defined routes as logical pages', () => {
  const demo = fixture();
  try {
    fs.mkdirSync(path.join(demo.root, 'views'));
    fs.writeFileSync(path.join(demo.root, 'app.js'), `import { renderHome } from './views/home.js';\nimport { renderSubs } from './views/subs.js';\nfunction resolve(path) {\n if (path === '/' || path === '/home') return { html: renderHome() };\n if (path === '/subs') return { html: renderSubs() };\n}`);
    fs.writeFileSync(path.join(demo.root, 'views/home.js'), 'export function renderHome() { return `<h1>首页</h1><button>搜索</button>`; }');
    fs.writeFileSync(path.join(demo.root, 'views/subs.js'), 'export function renderSubs() { return `<h1>订阅</h1><button>新建方案</button>`; }');
    assert.deepEqual(projectPages(demo.root), ['/home', '/subs']);
    const store = new ReviewStore(demo.root, demo.out);
    const operation = store.data.operations.find((item) => item.label === '新建方案');
    const spec = validateProjectResult(demo.root, ['/subs'], store.data.operations, { pages: [{
      path: '/subs', title: '订阅', purpose: '创建和查看方案。', layout: [], states: [], data: [], open_questions: [], evidence: ['views/subs.js:1'],
      functions: [{ name: '新建方案', outcome: '创建一条方案记录。', operation_ids: [operation.operation_id], origin: 'source_observed', evidence: ['views/subs.js:1'] }],
    }] });
    assert.deepEqual(spec[0].functions[0].operation_ids, [operation.operation_id]);
  } finally { demo.cleanup(); }
});

test('initial data index includes exported collections used by SPA views', () => {
  const demo = fixture();
  try {
    fs.writeFileSync(path.join(demo.root, 'data.js'), 'export const subscriptions = [{ id: 1 }];\n');
    fs.writeFileSync(path.join(demo.root, 'view.js'), 'import { subscriptions } from "./data.js";\nsubscriptions.filter(item => item.id);\n');
    const store = new ReviewStore(demo.root, demo.out);
    const collection = store.data.data_inventory.collections.find((item) => item.name === 'subscriptions');
    assert.equal(collection.definitions[0].path, 'data.js');
    assert.equal(collection.read_count, 1);
    assert.equal(collection.kind, 'exported_data');
  } finally { demo.cleanup(); }
});

test('model batch can generate and save a page brief before any click', async () => {
  const demo = fixture();
  const stub = path.join(demo.out, 'fake-codex');
  fs.writeFileSync(stub, `#!/usr/bin/env node
let input=''; process.stdin.on('data', chunk => input+=chunk); process.stdin.on('end', () => {
  const isProject = process.argv.some(arg => arg.endsWith('project.schema.json'));
  const id = input.match(/"id":"(op_[a-f0-9]+)"/)?.[1] || '';
  const page = {path:'/index.html',title:'客户列表',purpose:'查看客户并新增客户。',layout:[{text:'顶部显示新增入口。',origin:'source_observed',evidence:['index.html:1']}],functions:[{name:'新增客户',outcome:'创建记录并返回列表。',operation_ids:[id],origin:'documented',evidence:['PRD.md:2']}],states:[],data:[],open_questions:[],evidence:['index.html:1']};
  const card = {title:'新增客户',summary:'创建客户记录。',page_context:{purpose:'管理客户。',layout:'顶部是操作区。',evidence:['index.html:1']},claims:[],issues:[],expected_effects:[],expected_after:{route_contains:'',visible_text:''}};
  process.stdout.write(JSON.stringify(isProject ? {pages:[page]} : card));
});
`);
  fs.chmodSync(stub, 0o755);
  const oldCli = process.env.TECH_PROTOTYPE_CODEX_CLI;
  process.env.TECH_PROTOTYPE_CODEX_CLI = stub;
  try {
    const store = new ReviewStore(demo.root, demo.out);
    let diagnostics;
    const pages = await interpretProjectBatch({ sourceRoot: demo.root, pages: projectPages(demo.root), allPages: projectPages(demo.root), operations: store.data.operations, dataInventory: store.data.data_inventory }, { onDiagnostics(value) { diagnostics = value; } });
    assert.ok(diagnostics.prompt_chars > 0);
    assert.ok(diagnostics.cli_stdout_chars > 0);
    assert.ok(diagnostics.cli_first_output_ms >= 0);
    const job = store.createProjectJob(['/index.html']);
    store.addProjectResult(job, pages);
    assert.equal(store.pageSpec('/index.html').purpose, '查看客户并新增客户。');
    assert.equal(store.data.traces.length, 0);
    assert.match(fs.readFileSync(path.join(demo.out, 'project-spec.md'), 'utf8'), /页面布局与展示/);
  } finally {
    if (oldCli === undefined) delete process.env.TECH_PROTOTYPE_CODEX_CLI;
    else process.env.TECH_PROTOTYPE_CODEX_CLI = oldCli;
    demo.cleanup();
  }
});
