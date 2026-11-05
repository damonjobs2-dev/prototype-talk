import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classifyInput, inspectInput } from './input.mjs';

test('remote link routing distinguishes design structure from published browser observation', () => {
  assert.equal(classifyInput('https://www.figma.com/design/ABC/demo?node-id=1-2').kind, 'figma_file');
  assert.equal(classifyInput('https://demo-prototype.figma.site/').evidence_level, 'browser_observation');
  assert.equal(classifyInput('https://example.axure.cloud/prototype').kind, 'axure_link');
  assert.equal(classifyInput('https://custom.example/prototype', 'axure').kind, 'axure_link');
  assert.equal(classifyInput('https://custom.example/site', 'figma-site').kind, 'published_web');
  assert.throws(() => classifyInput('https://example.com/prototype'), /无法识别/);
  assert.equal(inspectInput('https://demo-prototype.figma.site/').status, 'needs_live_inspection');
});

test('local preflight reports source mapping coverage without claiming rules are confirmed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-talk-doctor-'));
  try {
    fs.writeFileSync(path.join(root, 'index.html'), '<button data-action="save">保存</button>');
    fs.writeFileSync(path.join(root, 'app.js'), 'document.addEventListener("click", e => { if (e.target.closest("[data-action=save]")) save(); });');
    const report = inspectInput(root);
    assert.equal(report.status, 'ready_for_model_parse');
    assert.equal(report.page_count, 1);
    assert.ok(report.control_count > 0);
    assert.match(report.warning, /候选线索/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('React JSX preflight needs a built page and then exposes source controls', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-talk-jsx-doctor-'));
  try {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'index.html'), '<div id="root"></div><script type="module" src="/src/App.jsx"></script>');
    fs.writeFileSync(path.join(root, 'src', 'App.jsx'), 'export default function App(){ return <button onClick={() => save()}>保存</button>; }');
    const missingBuild = inspectInput(root);
    assert.equal(missingBuild.status, 'needs_input_adapter_or_fix');
    assert.match(missingBuild.problems.join('；'), /dist\/index.html/);
    fs.mkdirSync(path.join(root, 'dist'));
    fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<div id="root"></div><script src="/assets/app.js"></script>');
    const ready = inspectInput(root);
    assert.equal(ready.status, 'ready_for_model_parse');
    assert.equal(ready.source_adapter, 'jsx_ast');
    assert.equal(ready.control_count, 1);
    assert.equal(ready.runtime_root, path.join(root, 'dist'));
    const newer = new Date(Date.now() + 10_000);
    fs.utimesSync(path.join(root, 'src', 'App.jsx'), newer, newer);
    const stale = inspectInput(root);
    assert.equal(stale.status, 'needs_input_adapter_or_fix');
    assert.equal(stale.runtime_build_stale, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
