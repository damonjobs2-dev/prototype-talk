import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importFigma, normalizeFigmaDocument } from './figma-import.mjs';

const sample = { name: '示例原型', version: 'v1', document: { id: '0:0', type: 'DOCUMENT', children: [{ id: '1:1', name: '首页', type: 'CANVAS', children: [{ id: '2:1', name: '提交', type: 'FRAME', absoluteBoundingBox: { x: 10, y: 20, width: 90, height: 30 }, interactions: [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'NODE', destinationId: '3:1', navigation: 'NAVIGATE' }] }] }] }] } };

test('Figma structure keeps node, layout and prototype interaction evidence separate from API claims', () => {
  const normalized = normalizeFigmaDocument(sample);
  const button = normalized.nodes.find((node) => node.id === '2:1');
  assert.equal(button.page_id, '1:1');
  assert.equal(button.bounds.width, 90);
  assert.equal(button.interactions[0].actions[0].destination_id, '3:1');
  assert.match(normalized.limitations[0], /不能证明正式数据来源/);
});

test('Figma importer writes a bounded local evidence file without exposing the access token', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-talk-figma-'));
  try {
    const result = await importFigma('https://www.figma.com/design/test-key/demo', out, 'test-secret', async (_url, options) => {
      assert.equal(options.headers['X-Figma-Token'], 'test-secret');
      return { ok: true, headers: { get: () => '100' }, text: async () => JSON.stringify(sample) };
    });
    const saved = fs.readFileSync(result.output, 'utf8');
    assert.equal(result.nodes, 3);
    assert.equal(saved.includes('test-secret'), false);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});
