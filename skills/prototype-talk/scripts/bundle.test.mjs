import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bundleProjectViewer } from './bundle.mjs';

test('project viewer bundles core scripts and assets for standalone use', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-talk-bundle-'));
  try {
    const scriptDir = fileURLToPath(new URL('.', import.meta.url));
    bundleProjectViewer({ sourceRoot: root, outputRoot: path.join(root, 'docs', 'prototype-talk') }, scriptDir, path.join(scriptDir, '..', 'assets'));
    const bundled = path.join(root, 'docs', 'prototype-talk', 'viewer', 'scripts');
    for (const name of ['server.mjs', 'bundle.mjs', 'input.mjs', 'doctor.mjs', 'jsx-source.mjs', 'operation-families.mjs', 'metrics.mjs', 'evidence-audit.mjs', 'contracts.mjs', 'source-impact.mjs', 'figma-import.mjs', 'browser-evidence.mjs']) assert.equal(fs.existsSync(path.join(bundled, name)), true, `${name} missing`);
    assert.equal(fs.existsSync(path.join(bundled, 'vendor', 'babel-parser', 'index.cjs')), true);
    assert.equal(fs.existsSync(path.join(root, 'docs', 'prototype-talk', 'viewer', 'assets', 'anchor-core.js')), true);
    assert.equal(fs.existsSync(path.join(root, 'docs', 'prototype-talk', 'viewer', 'assets', 'finder.js')), true);
    assert.equal(fs.existsSync(path.join(root, 'docs', 'prototype-talk', 'viewer', 'assets', 'finder.LICENSE')), true);
    assert.equal(fs.existsSync(path.join(root, 'docs', 'prototype-talk', 'viewer', 'assets', 'blind-review-template.html')), true);
    assert.match(fs.readFileSync(path.join(root, 'docs', 'prototype-talk', 'README.md'), 'utf8'), /--model-parse/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('exported viewer loads using only its bundled runtime files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-talk-standalone-'));
  try {
    const scriptDir = fileURLToPath(new URL('.', import.meta.url));
    bundleProjectViewer({ sourceRoot: root, outputRoot: path.join(root, 'docs', 'prototype-talk') }, scriptDir, path.join(scriptDir, '..', 'assets'));
    const serverPath = path.join(root, 'docs', 'prototype-talk', 'viewer', 'scripts', 'server.mjs');
    const result = spawnSync(process.execPath, [serverPath, '--help'], { cwd: root, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /用法: node server\.mjs/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
