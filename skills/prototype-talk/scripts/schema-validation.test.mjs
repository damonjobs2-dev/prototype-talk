import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateJsonSchema } from './schema-validation.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectSchema = JSON.parse(fs.readFileSync(path.join(here, 'project.schema.json'), 'utf8'));

test('conversation handoff rejects incomplete page facts before publishing', () => {
  const page = { path: '/index.html', title: '首页', purpose: '查看数据', layout: [{ text: '显示列表', origin: 'source_observed', evidence: ['index.html:1'] }], functions: [], states: [], data: [], open_questions: [], evidence: ['index.html:1'] };
  assert.deepEqual(validateJsonSchema({ pages: [page] }, projectSchema), []);
  const errors = validateJsonSchema({ pages: [{ ...page, layout: [{ text: '显示列表', origin: 'certain', evidence: [] }], unsupported: true }] }, projectSchema);
  assert.ok(errors.some((error) => error.includes('origin')));
  assert.ok(errors.some((error) => error.includes('unsupported')));
  assert.ok(validateJsonSchema({ pages: [{ ...page, evidence: 'index.html:1' }] }, projectSchema).some((error) => error.includes('evidence')));
});
