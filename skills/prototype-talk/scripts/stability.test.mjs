import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditEvidence, auditModelResult } from './evidence-audit.mjs';
import { checkResultQuality } from './result-quality.mjs';
import { projectPages, buildPageEvidencePack } from './project-agent.mjs';
import { ReviewStore } from './store.mjs';
import { extractDisplayFields } from './display-fields.mjs';
import { matchRuntimeControl, scanSource } from './scanner.mjs';
import { sourceHints } from './agent.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-talk-stability-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-talk-stability-out-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'index.html'), '<div id="app"></div>');
  fs.writeFileSync(path.join(root, 'src', 'App.jsx'), [
    "const modeTabs = [{ id: 'hot', label: '热点' }, { id: 'follow', label: '订阅' }];",
    "const screen = new URLSearchParams(location.search).get('screen');",
    'const hotPage = <div>热点列表</div>;',
    'const followPage = <form><label>方案名称<input name="name" /></label><button type="submit">保存订阅</button></form>;',
    "const pages = { hot: hotPage, follow: followPage };",
    'const save = () => {',
    "  if (!name) { notify('请填写方案名称'); return; }",
    '  setPlans((rows) => [name, ...rows]);',
    '};',
  ].join('\n'));
  return { root, out, cleanup() { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true }); } };
}

test('submit quality check catches missing failure and success effects while accepting both branches', () => {
  const demo = fixture();
  try {
    const operation = { label: '保存订阅', trigger: 'click', anchor: { type: 'submit' } };
    const raw = { claims: [{ section: 'data', text: '新建方案写入本地列表', origin: 'source_observed', evidence: ['src/App.jsx:8'] }], expected_effects: [] };
    const audited = auditModelResult(demo.root, raw);
    assert.deepEqual(checkResultQuality(demo.root, operation, audited).map((item) => item.code), ['missing_failure_outcome', 'missing_success_outcome']);
    audited.claims.push({ section: 'constraint', text: '名称为空时停止提交', origin: 'source_observed', evidence: ['src/App.jsx:7'], evidence_audit: { valid: ['src/App.jsx:7'] } });
    assert.deepEqual(checkResultQuality(demo.root, operation, audited).map((item) => item.code).sort(), ['missing_failure_outcome', 'missing_success_outcome']);
    audited.expected_effects = [
      { target: '表单', change: '提示填写名称', condition: '名称为空', origin: 'source_observed', evidence_audit: { valid: ['src/App.jsx:7'] } },
      { target: '方案列表', change: '新增一条', condition: '校验通过', origin: 'source_observed', evidence_audit: { valid: ['src/App.jsx:8'] } },
    ];
    assert.deepEqual(checkResultQuality(demo.root, operation, audited), []);
  } finally { demo.cleanup(); }
});

test('React query screens are separate page briefs and runtime operations retain their screen', () => {
  const demo = fixture();
  try {
    const pages = projectPages(demo.root);
    assert.deepEqual(pages, ['/index.html', '/?screen=hot', '/?screen=follow']);
    const store = new ReviewStore(demo.root, demo.out);
    const { operation } = store.addTrace({ trigger: 'click', target: { tag: 'button', label: '保存订阅', type: 'submit', data: {} }, before: { route: '/?screen=follow', visible_text: '方案名称 保存订阅' }, after: { route: '/?screen=follow', visible_text: '方案名称 保存订阅' }, context_fields: ['方案名称'] });
    assert.deepEqual(operation.logical_screen_ids, ['/?screen=follow']);
    assert.deepEqual(store.publicState().operation_observations.at(-1).context_fields, ['方案名称']);
    const pack = buildPageEvidencePack({ sourceRoot: demo.root, pages: ['/?screen=follow'], allPages: pages, operations: store.data.operations, dataInventory: { requirement_sections: [] } });
    assert.ok(JSON.stringify(pack).includes('逻辑界面：订阅'));
  } finally { demo.cleanup(); }
});

test('JSX form fields include switch controls without treating a conditional label as a literal field', () => {
  const fields = extractDisplayFields(new Map([['src/Form.jsx', '<label className="field-label">方案名称<Input /></label><label className="field-label">{kind===\'a\'?\'监测关键词\':\'订阅主题\'}<Input /></label><div className="setting-row"><span><strong>预警提醒</strong></span><Switch /></div>']]));
  assert.deepEqual(fields.map((item) => [item.label, item.control_type]), [['方案名称', 'input'], ['预警提醒', 'switch']]);
});

test('a saved operation card links back to the matching logical-screen function by shared source evidence', () => {
  const demo = fixture();
  try {
    const store = new ReviewStore(demo.root, demo.out);
    const { operation } = store.addTrace({ trigger: 'click', target: { tag: 'button', label: '保存订阅', type: 'submit', data: {} }, before: { route: '/?screen=follow', visible_text: '方案名称 保存订阅' }, after: { route: '/?screen=follow', visible_text: '已保存' } });
    const job = store.createJob('initial', operation.operation_id);
    store.addResult(job, { title: '保存订阅', summary: '创建方案', claims: [{ section: 'data', text: '保存方案', origin: 'source_observed', evidence: ['src/App.jsx:7', 'src/App.jsx:8'] }], expected_effects: [], issues: [], expected_after: {} });
    const page = { path: '/?screen=follow', title: '订阅', purpose: '管理方案', layout: [], states: [], data: [], evidence: ['src/App.jsx:4'], functions: [
      { name: '创建方案', outcome: '保存新方案', evidence: ['src/App.jsx:7', 'src/App.jsx:8'], operation_ids: [] },
      { name: '浏览热点', outcome: '查看热点', evidence: ['src/App.jsx:3'], operation_ids: [] },
    ] };
    store.addProjectResult(store.createProjectJob([page.path]), [page]);
    assert.deepEqual(store.pageSpec(page.path).functions[0].operation_ids, [operation.operation_id]);
    assert.deepEqual(store.pageSpec(page.path).functions[1].operation_ids, []);
  } finally { demo.cleanup(); }
});

test('a React Aria button with the same generic attributes does not inherit another button’s operation', () => {
  const demo = fixture();
  try {
    const store = new ReviewStore(demo.root, demo.out);
    const add = { operation_id: 'op_add', label: '添加监测', tag: 'button', page_hint: '/', trigger: 'click', coverage: 'observed', discovered_by: ['runtime'], anchor: { id: 'react-aria-old', data: { 'data-slot': 'button', 'data-react-aria-pressable': 'true' }, source: null } };
    store.data.operations.push(add);
    const target = { tag: 'button', label: '首页', id: 'react-aria-new', data: { 'data-slot': 'button', 'data-react-aria-pressable': 'true' } };
    assert.equal(matchRuntimeControl(store.data.operations, target, '/'), null);
    const { operation, trace } = store.addTrace({ operation_id: add.operation_id, trigger: 'click', target, before: { route: '/', dialogs: [] }, after: { route: '/', dialogs: [] } });
    assert.equal(operation.label, '首页');
    assert.notEqual(trace.operation_id, add.operation_id);
  } finally { demo.cleanup(); }
});

test('stable semantic selector survives a changing React Aria id and stays on its own page', () => {
  const home = { operation_id: 'op_home', label: '首页', tag: 'button', page_hint: '/?screen=home', discovered_by: ['runtime'], anchor: { id: 'react-aria-old', selector: 'button[aria-label="首页"]', data: {} } };
  const otherPage = { ...home, operation_id: 'op_other', page_hint: '/?screen=follow' };
  const target = { label: '首页', tag: 'button', id: 'react-aria-new', selector: 'button[aria-label="首页"]', selector_unique: true, data: {} };
  assert.equal(matchRuntimeControl([home, otherPage], target, '/?screen=home'), home);
  assert.equal(matchRuntimeControl([home], target, '/?screen=follow'), null);
});

test('a card built from another button’s trace is quarantined when the review reopens', () => {
  const demo = fixture();
  try {
    const store = new ReviewStore(demo.root, demo.out);
    const add = { operation_id: 'op_add', label: '添加监测', tag: 'button', page_hint: '/', trigger: 'click', coverage: 'observed', discovered_by: ['runtime'], anchor: { id: 'react-aria-old', data: { 'data-slot': 'button', 'data-react-aria-pressable': 'true' }, source: null } };
    store.data.operations.push(add);
    store.data.traces.push({ trace_id: 'trace_home', operation_id: add.operation_id, source_snapshot_id: store.data.source_snapshot_id, target: { tag: 'button', label: '首页', id: 'react-aria-new', data: { 'data-slot': 'button', 'data-react-aria-pressable': 'true' } }, before: { route: '/', visible_text: '首页' }, after: { route: '/', visible_text: '首页' } });
    store.data.cards.push({ card_id: 'card_wrong', operation_id: add.operation_id, source_snapshot_id: store.data.source_snapshot_id, based_on_trace_ids: ['trace_home'], title: '添加监测', claims: [], expected_effects: [], quality_checks: [] });
    store.data.issues.push({ issue_id: 'issue_wrong', operation_id: add.operation_id, card_id: 'card_wrong', decision: 'candidate', text: '错误关联后的问题' });
    store.save();
    const reopened = new ReviewStore(demo.root, demo.out);
    assert.equal(reopened.latestCard(add.operation_id), null);
    assert.ok(reopened.data.cards.find((item) => item.card_id === 'card_wrong').invalidated_reason);
    assert.equal(reopened.publicState().cards.some((item) => item.card_id === 'card_wrong'), false);
    assert.equal(reopened.publicState().issues.some((item) => item.issue_id === 'issue_wrong'), false);
    assert.equal(reopened.publicState().operation_observations.some((item) => item.trace_id === 'trace_home'), false);
  } finally { demo.cleanup(); }
});

test('legacy source citations with line ranges remain verifiable', () => {
  const demo = fixture();
  try {
    const valid = auditEvidence(demo.root, 'source_observed', ['src/App.jsx:7-9']);
    assert.equal(valid.status, 'location_verified');
    assert.deepEqual(valid.valid, ['src/App.jsx:7-9']);
    assert.equal(auditEvidence(demo.root, 'source_observed', ['src/App.jsx:9-7']).status, 'missing_or_invalid');
  } finally { demo.cleanup(); }
});

test('scanner does not turn a truncated template expression into a button label', () => {
  const demo = fixture();
  try {
    fs.writeFileSync(path.join(demo.root, 'src', 'broken-template.js'), 'const html = `<button class="${items.find((item) => item.label === selected)?.active ? "on" : ""}" data-action="select">${selected}</button>`;');
    const operations = scanSource(demo.root).operations;
    assert.equal(operations.some((item) => item.label.includes('item.label === selected')), false);
  } finally { demo.cleanup(); }
});

test('runtime navigation evidence includes the nearby click handler', () => {
  const demo = fixture();
  try {
    fs.writeFileSync(path.join(demo.root, 'src', 'navigation.js'), [
      "const go = (next) => { history.replaceState(null, '', '?screen=' + next); };",
      ...Array(20).fill('// other UI code'),
      'const navigation = [',
      "  { id: 'hot', label: '首页' },",
      "  { id: 'follow', label: '订阅' },",
      '];',
      'const navigate = (id) => {',
      '  go(id);',
      '};',
      `return navigation.map((item) => <button className="${'x'.repeat(500)}" onClick={() => navigate(item.id)}>{item.label}</button>);`,
    ].join('\n'));
    const hints = sourceHints(demo.root, { label: '首页', anchor: { source: null, class_name: '' } }, { before: { visible_text: '首页 订阅' } });
    assert.match(hints, /go\(id\)/);
    assert.match(hints, /onClick.*navigate\(item\.id\)/);
    assert.match(hints, /const go =/);
  } finally { demo.cleanup(); }
});
