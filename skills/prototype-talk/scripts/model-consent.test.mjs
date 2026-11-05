import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_INPUT_SCOPE, modelConsentRecord, canReuseModelConsent } from './model-consent.mjs';

test('a saved project authorization covers operation records on later viewer starts', () => {
  const root = '/projects/demo';
  const consent = modelConsentRecord(root, 'cli_model_parse');
  assert.ok(MODEL_INPUT_SCOPE.includes('operation_records'));
  assert.equal(canReuseModelConsent(consent, root), true);
  assert.equal(canReuseModelConsent(consent, '/projects/other'), false);
  assert.equal(canReuseModelConsent({ ...consent, input_scope: ['source', 'prd', 'mock'] }, root), false);
  assert.equal(canReuseModelConsent({ ...consent, destination: 'other' }, root), false);
});
