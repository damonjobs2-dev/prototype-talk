import test from 'node:test';
import assert from 'node:assert/strict';
import anchors from '../assets/anchor-core.js';
import { ReviewStore } from './store.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const hierarchy = (page, scopes = [], item = null) => ({ page, scopes, item });
const operation = (id, h, extra = {}) => ({
  operation_id: id, page_hint: h.page, label: '修改', tag: 'button', discovered_by: ['runtime'], coverage: 'observed',
  anchor: { id: '', selector: 'button', data: {}, onclick: '', href: '', hierarchy: h }, ...extra,
});

test('DOM ancestry yields page, named dialog, form and stable row identity', () => {
  const doc = { body: {}, getElementById: () => null };
  const node = (tagName, attrs, parentElement) => ({
    tagName, className: attrs.class || '', id: attrs.id || '', parentElement, ownerDocument: doc,
    getAttribute: (name) => attrs[name] || null, querySelector: () => null, querySelectorAll: () => [],
  });
  const dialog = node('DIV', { class: 'modal', 'aria-label': '新增客户' }, doc.body);
  const form = node('FORM', { id: 'customerForm' }, dialog);
  const row = node('TR', { 'data-row-key': 'C10010' }, form);
  row.matches = (selector) => selector.includes('tr');
  const button = node('BUTTON', {}, row);
  button.closest = () => row;
  assert.deepEqual(anchors.hierarchyFor(button, '/customers'), hierarchy('/customers', [
    { kind: 'dialog', key: '新增客户' }, { kind: 'form', key: 'customerForm' },
  ], { kind: 'row', key: 'C10010' }));
});

test('row identity distinguishes repeated buttons without relying on row order', () => {
  const first = operation('first', hierarchy('/customers', [{ kind: 'section', key: '客户列表' }], { kind: 'row', key: 'C10010' }));
  const second = operation('second', hierarchy('/customers', [{ kind: 'section', key: '客户列表' }], { kind: 'row', key: 'C10011' }));
  const clicked = { tag: 'button', label: '修改', data: {}, hierarchy: hierarchy('/customers', [{ kind: 'section', key: '客户列表' }], { kind: 'row', key: 'C10011' }) };
  assert.equal(anchors.matchRuntimeControl([first, second], clicked, '/customers'), second);
  assert.equal(anchors.matchRuntimeControl([second, first], clicked, '/customers'), second);
});

test('dialog identity separates same-label controls from other regions', () => {
  const create = operation('create', hierarchy('/customers', [{ kind: 'dialog', key: '新增客户' }]));
  const edit = operation('edit', hierarchy('/customers', [{ kind: 'dialog', key: '修改客户' }]));
  create.label = edit.label = '保存';
  const clicked = { tag: 'button', label: '保存', data: {}, hierarchy: hierarchy('/customers', [{ kind: 'dialog', key: '修改客户' }]) };
  assert.equal(anchors.matchRuntimeControl([create, edit], clicked, '/customers'), edit);
});

test('nested sections require the exact section chain rather than its first label', () => {
  const outer = { kind: 'section', key: '客户管理' };
  const a = operation('a', hierarchy('/customers', [outer, { kind: 'section', key: '基础信息' }]));
  const b = operation('b', hierarchy('/customers', [outer, { kind: 'section', key: '账号信息' }]));
  const clicked = { tag: 'button', label: '修改', data: {}, hierarchy: hierarchy('/customers', [outer, { kind: 'section', key: '账号信息' }]) };
  assert.equal(anchors.matchRuntimeControl([a, b], clicked, '/customers'), b);
});

test('a legacy runtime control without row identity cannot claim a row click', () => {
  const legacy = operation('legacy', hierarchy('/customers'));
  const clicked = { tag: 'button', label: '修改', data: {}, hierarchy: hierarchy('/customers', [], { kind: 'row', key: 'C10011' }) };
  assert.equal(anchors.matchRuntimeControl([legacy], clicked, '/customers'), null);
});

test('stable region identity survives volatile generated ids and rejects another logical page', () => {
  const current = operation('current', hierarchy('/?screen=follow', [{ kind: 'tabpanel', key: '订阅' }]));
  current.label = '首页';
  current.anchor.id = 'react-aria-old';
  const clicked = { tag: 'button', label: '首页', id: 'react-aria-new', data: {}, hierarchy: hierarchy('/?screen=follow', [{ kind: 'tabpanel', key: '订阅' }]) };
  assert.equal(anchors.matchRuntimeControl([current], clicked, '/?screen=follow'), current);
  assert.equal(anchors.matchRuntimeControl([current], clicked, '/?screen=hot'), null);
});

test('the review store persists hierarchy and does not reuse another row operation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-talk-anchors-'));
  try {
    fs.writeFileSync(path.join(root, 'index.html'), '<main>客户列表</main>');
    const store = new ReviewStore(root);
    const trace = (key) => store.addTrace({ trigger: 'click', target: { tag: 'button', label: '修改', data: {}, hierarchy: hierarchy('/index.html', [], { kind: 'row', key }) }, before: { route: '/index.html' }, after: { route: '/index.html' } });
    const first = trace('C10010');
    const second = trace('C10011');
    assert.notEqual(first.operation.operation_id, second.operation.operation_id);
    assert.equal(trace('C10010').operation.operation_id, first.operation.operation_id);
    assert.equal(store.data.operations.find((item) => item.operation_id === second.operation.operation_id).anchor.hierarchy.item.key, 'C10011');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
