import test from 'node:test';
import assert from 'node:assert/strict';
import { groupOperationFamilies } from './operation-families.mjs';

const operation = (id, label, onclick, extras = {}) => ({ operation_id: id, page_hint: '/customers.html', tag: 'button', trigger: 'click', label, anchor: { source: { path: 'customers.html', line: Number(id.slice(-1)) || 1 }, onclick, data: {} }, component: { id: 'button' }, discovered_by: ['source_scan'], related_code: [], ...extras });

test('same action and context become one family while different goals stay separate', () => {
  const operations = [
    operation('op_1', '编辑', 'editCustomer(this)'),
    operation('op_2', '编辑', 'editCustomer(this)'),
    operation('op_3', '编辑', 'editOrder(this)'),
    operation('op_4', '编辑', 'editCustomer(this)', { page_hint: '/orders.html' }),
    operation('op_5', '关闭', 'closeModal(this)'),
    operation('op_6', '关闭', 'closeModal(this)'),
  ];
  const groups = groupOperationFamilies(operations);
  assert.deepEqual(groups.find((item) => item.member_ids.includes('op_1')).member_ids, ['op_1', 'op_2']);
  assert.equal(groups.length, 5);
  assert.equal(groups.find((item) => item.member_ids.includes('op_5')).count, 1);
});

test('runtime instances of one source template share a family without collapsing different templates', () => {
  const template = operation('op_1', '客户', '', { anchor: { source: { path: 'customers.html', line: 10 }, data: { 'data-customer-id': '${id}' }, onclick: '' } });
  const a = operation('op_2', '客户甲', '', { template_operation_id: 'op_1', discovered_by: ['runtime'] });
  const b = operation('op_3', '客户乙', '', { template_operation_id: 'op_1', discovered_by: ['runtime'] });
  const groups = groupOperationFamilies([template, a, b]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 3);
  assert.equal(groups[0].basis, 'source_template');
});
