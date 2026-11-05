import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildOperationEvidencePack, promptFor as operationPrompt } from './agent.mjs';
import { buildPageEvidencePack, promptFor as pagePrompt } from './project-agent.mjs';

test('operation model reads a frozen local evidence pack, not changed source', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-talk-pack-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'form.js'), 'const title = "保存订阅";\nfunction save() { return "已保存"; }\n');
  fs.writeFileSync(path.join(root, 'requirements.md'), '# 订阅\n保存订阅后显示成功反馈。\n');
  const operation = { operation_id: 'op_save', label: '保存订阅', tag: 'button', trigger: 'click', page_hint: '/index.html', anchor: { source: { path: 'src/form.js', line: 1 }, onclick: 'save()' }, related_code: [] };
  const input = {
    sourceRoot: root, source_snapshot_id: 'snapshot-1', operation, reason: '固定样例',
    trace: { trace_id: 'trace-1', before: { route: '/?screen=follow', visible_text: '订阅' }, after: { route: '/?screen=follow', visible_text: '订阅\n保存成功' }, events: [] }, previousCard: null, pageSpec: null,
    dataInventory: { collections: [], storage: [], requests: [], requirement_sections: [{ path: 'requirements.md', line: 1, title: '订阅', body: '保存订阅后显示成功反馈。', ancestors: [] }] },
  };
  const frozen = buildOperationEvidencePack(input);
  const originalPrompt = operationPrompt({ evidencePack: frozen });
  assert.equal(operationPrompt(input), originalPrompt);
  assert.match(frozen.evidence_hash, /^[a-f0-9]{64}$/);
  assert.equal(frozen.source_snapshot_id, 'snapshot-1');
  assert.equal(frozen.logical_screen_id, '/?screen=follow');
  assert.match(originalPrompt, /requirements\.md:2/);
  fs.writeFileSync(path.join(root, 'src', 'form.js'), 'const title = "保存订阅";\nfunction save() { return "保存失败"; }\n');
  assert.equal(operationPrompt({ evidencePack: frozen }), originalPrompt);
  assert.notEqual(buildOperationEvidencePack(input).evidence_hash, frozen.evidence_hash);
});

test('page model receives the same bounded page pack when replayed', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-talk-page-pack-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>订阅</h1>\n<button>保存订阅</button>\n');
  const input = { sourceRoot: root, source_snapshot_id: 'snapshot-1', pages: ['/index.html'], allPages: ['/index.html'], operations: [], dataInventory: { collections: [], requests: [], edges: [], requirement_sections: [] } };
  const frozen = buildPageEvidencePack(input);
  assert.equal(pagePrompt({ evidencePack: frozen }), pagePrompt(input));
  assert.match(frozen.evidence_hash, /^[a-f0-9]{64}$/);
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>变更后的订阅</h1>\n');
  assert.notEqual(buildPageEvidencePack(input).evidence_hash, frozen.evidence_hash);
  assert.match(pagePrompt({ evidencePack: frozen }), /保存订阅/);
});

test('save action pack includes submit handler and matching PRD rule before model interpretation', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-talk-save-pack-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'Experience.jsx'), [
    'function useStored(key, initial) {',
    '  const [value, setValue] = useState(initial);',
    '  useEffect(() => { localStorage.setItem(key, JSON.stringify(value)); }, [key, value]);',
    '  return [value, setValue];',
    '}',
    "const [createdPlans, setCreatedPlans] = useStored('plans', []);",
    ...Array.from({ length: 30 }, (_, index) => `const unrelated${index} = ${index};`),
    'const submitPlan = () => {',
    "  if (!name || !keywords) return notify('请填写方案名称和监测词');",
    "  setCreatedPlans((items) => [plan, ...items]);",
    '};',
    "return <button className=\"primary-wide\" onClick={submitPlan}>{planDraft.id?'保存设置':'保存订阅'}</button>;",
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'requirements.md'), [
    '### 订阅',
    '页面说明',
    '新建监测方案：填写方案名称和监测关键词；取消不提交，提交后加入本机目录。',
    '新建雷达方案：填写方案配置；提交后加入本机目录。',
    '### 预警',
  ].join('\n'));
  const operation = { operation_id: 'op_save', label: '保存订阅', tag: 'button', trigger: 'click', page_hint: '/', anchor: { source: null, class_name: 'primary-wide' }, related_code: [] };
  const pageSpec = { path: '/index.html', purpose: '订阅', layout: Array.from({ length: 30 }, (_, i) => ({ text: `无关布局 ${i} ${'x'.repeat(180)}` })), functions: [{ name: '建立订阅', outcome: '填写并保存后加入本机方案目录。', operation_ids: [] }], states: [{ text: '方案名称或监测词为空时提示补填；创建成功后加入订阅。' }], data: [{ text: '新建方案保存到本地后成为当前订阅。' }], open_questions: [] };
  const pack = buildOperationEvidencePack({ sourceRoot: root, operation, trace: { trace_id: 'trace-1', before: { route: '/', visible_text: '保存订阅' }, after: { route: '/', visible_text: '请填写方案名称和监测词' } }, previousCard: null, dataInventory: { collections: [], storage: [], requests: [], requirement_sections: [{ path: 'requirements.md', line: 1, title: '订阅', body: '新建监测方案：填写方案名称和监测关键词；取消不提交，提交后加入本机目录。', ancestors: [] }] }, pageSpec, reason: '单版核对', source_snapshot_id: 'snapshot-1' });
  const prompt = operationPrompt({ evidencePack: pack });
  assert.match(prompt, /const submitPlan/);
  assert.match(prompt, /localStorage\.setItem/);
  assert.match(prompt, /requirements\.md:3: 新建监测方案/);
  assert.match(prompt, /创建成功后加入订阅/);
  assert.doesNotMatch(prompt, /无关布局 29/);
});
