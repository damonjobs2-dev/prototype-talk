import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { auditEvidence } from './evidence-audit.mjs';

test('evidence audit separates real source, PRD, runtime and unsupported citations', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-talk-audit-'));
  try {
    fs.writeFileSync(path.join(root, 'app.js'), 'function save() {}\n');
    fs.writeFileSync(path.join(root, 'PRD.md'), '# 保存规则\n');
    assert.equal(auditEvidence(root, 'source_observed', ['app.js:1']).status, 'location_verified');
    assert.equal(auditEvidence(root, 'source_observed', ['PRD.md:1']).status, 'missing_or_invalid');
    assert.equal(auditEvidence(root, 'documented', ['PRD.md:1', 'PRD.md:99']).status, 'partially_resolved');
    assert.equal(auditEvidence(root, 'runtime_observed', ['trace_1'], { traceIds: ['trace_1'] }).status, 'location_verified');
    assert.equal(auditEvidence(root, 'runtime_observed', ['trace_missing'], { traceIds: ['trace_1'] }).status, 'missing_or_invalid');
    assert.equal(auditEvidence(root, 'source_observed', ['../outside.js:1']).status, 'missing_or_invalid');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
