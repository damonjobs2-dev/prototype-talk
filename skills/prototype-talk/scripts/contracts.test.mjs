import test from 'node:test';
import assert from 'node:assert/strict';
import { activeInterfaceContracts, interfaceContract } from './contracts.mjs';

test('page query and save operation keep separate contracts and field rows', () => {
  const data = {
    rules: [
      { scope: 'technical', page_path: '/customers.html', operation_id: null, slot: 'method_path', text: 'GET /customers' },
      { scope: 'technical', page_path: '/customers.html', operation_id: 'save', slot: 'method_path', text: 'POST /customers' },
      { scope: 'technical', page_path: '/customers.html', operation_id: 'save', slot: 'frontend', text: '校验后提交' },
    ],
    api_fields: [
      { page_path: '/customers.html', operation_id: null, key: 'items[].name', direction: 'response' },
      { page_path: '/customers.html', operation_id: 'save', key: 'name', direction: 'body' },
    ],
  };
  const contracts = activeInterfaceContracts(data);
  assert.equal(contracts.length, 2);
  assert.equal(interfaceContract(data, '/customers.html').decisions.method_path.text, 'GET /customers');
  assert.deepEqual(interfaceContract(data, '/customers.html', 'save').fields.map((item) => item.key), ['name']);
  assert.equal(interfaceContract(data, '/customers.html', 'save').decisions.method_path.text, 'POST /customers');
  assert.equal(interfaceContract(data, '/customers.html', 'other').status, 'unstarted');
});
