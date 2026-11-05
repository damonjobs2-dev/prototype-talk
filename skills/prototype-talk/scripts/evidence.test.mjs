import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildEvidenceView } from './evidence.mjs';

test('evidence view keeps PRD, source and observed result separate for one operation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-evidence-'));
  try {
    fs.mkdirSync(path.join(root, 'pages'));
    fs.writeFileSync(path.join(root, '需求文档PRD.md'), '# 客户列表\n## 新增客户\n- 客户地域应必填\n## 编辑客户\n- 客户地域应必填\n');
    fs.writeFileSync(path.join(root, 'pages/list.html'), '<label class="required">客户地域</label>\n<button onclick="openRegion()">选择</button>\n');
    const data = {
      source_snapshot_id: 'snapshot1',
      operations: [{ operation_id: 'op1', label: '客户地域', page_hint: '/pages/list.html', source_snapshot_id: 'snapshot1', anchor: { source: { path: 'pages/list.html', line: 1 } } }],
      cards: [{ operation_id: 'op1', source_snapshot_id: 'snapshot1', claims: [{ text: '页面标记必填', origin: 'source_observed', confirmation_state: 'pending', evidence: ['pages/list.html:1', 'pages/list.html:1'] }] }],
      traces: [{ operation_id: 'op1', source_snapshot_id: 'snapshot1', trigger: 'click', before: { route: '/pages/list.html', visible_text: '未展开' }, after: { route: '/pages/list.html', visible_text: '已展开' }, recorded_at: '2026-11-03T00:00:00Z' }],
      data_inventory: { requirement_sections: [{ path: '需求文档PRD.md', line: 2, title: '新增客户', ancestors: ['客户列表'], body: '- 客户地域应必填' }, { path: '需求文档PRD.md', line: 4, title: '编辑客户', ancestors: ['客户列表'], body: '- 客户地域应必填' }] },
    };
    const view = buildEvidenceView(data, root, { operationId: 'op1', pagePath: '/pages/list.html', context: '新增客户' });
    assert.equal(view.cards[0].sources.find((item) => item.kind === 'requirement').locations[0].start, 3);
    assert.equal(view.cards[0].sources.filter((item) => item.kind === 'requirement').length, 1);
    assert.equal(view.cards[0].sources.find((item) => item.kind === 'requirement').locations.length, 2);
    assert.equal(view.cards[0].sources.find((item) => item.kind === 'demo').locations[0].path, 'pages/list.html');
    assert.equal(view.cards[0].runtime.changed, true);
    assert.equal(view.cards[1].sources.length, 1);
    assert.equal(view.cards[1].sources[0].locations.length, 1);
    data.cards[0].claims[0].evidence.push('../outside.txt:1');
    assert.equal(buildEvidenceView(data, root, { operationId: 'op1' }).cards[1].sources.length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('runtime-only JSX control still shows cited source and opened dialog', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-evidence-jsx-'));
  try {
    fs.writeFileSync(path.join(root, 'App.jsx'), '<button onClick={openChoice}>添加监测</button>');
    const data = {
      source_snapshot_id: 'snapshot1',
      operations: [{ operation_id: 'op1', label: '添加监测', page_hint: '/', source_snapshot_id: 'snapshot1', anchor: { source: null } }],
      cards: [{ operation_id: 'op1', source_snapshot_id: 'snapshot1', claims: [{ text: '打开选择弹窗', origin: 'source_observed', evidence_audit: { valid: ['App.jsx:1'] }, evidence: ['App.jsx:1'] }] }],
      traces: [{ operation_id: 'op1', source_snapshot_id: 'snapshot1', trigger: 'click', before: { route: '/', visible_text: '首页', dialogs: [] }, after: { route: '/', visible_text: '首页', dialogs: ['添加订阅'] } }],
      data_inventory: { requirement_sections: [] },
    };
    const view = buildEvidenceView(data, root, { operationId: 'op1' });
    assert.equal(view.cards[0].sources.find((item) => item.kind === 'demo').locations[0].path, 'App.jsx');
    assert.equal(view.cards[0].runtime.result, '出现弹窗：添加订阅');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
