import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { affectedPages } from './source-impact.mjs';

test('local view change affects its route; shared dependency affects every importing route', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-talk-impact-'));
  try {
    fs.mkdirSync(path.join(root, 'views'));
    fs.writeFileSync(path.join(root, 'index.html'), '<script type="module" src="./app.js"></script>');
    fs.writeFileSync(path.join(root, 'app.js'), "import './views/customers.js'; import './views/orders.js';");
    fs.writeFileSync(path.join(root, 'views/customers.js'), "import './shared.js';");
    fs.writeFileSync(path.join(root, 'views/orders.js'), "import './shared.js';");
    fs.writeFileSync(path.join(root, 'views/shared.js'), 'export const label = "测试";');
    const pages = ['/customers', '/orders'];
    const operations = [
      { page_hint: '/customers', anchor: { source: { path: 'views/customers.js' } } },
      { page_hint: '/orders', anchor: { source: { path: 'views/orders.js' } } },
    ];
    assert.deepEqual(affectedPages(root, ['views/customers.js'], pages, operations), ['/customers']);
    assert.deepEqual(affectedPages(root, ['views/shared.js'], pages, operations).sort(), pages);
    assert.deepEqual(affectedPages(root, ['index.html'], pages, operations).sort(), pages);
    fs.writeFileSync(path.join(root, 'views/orders.js'), "import './customers.js';");
    assert.deepEqual(affectedPages(root, ['views/customers.js'], pages, operations).sort(), pages);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('React JSX edit invalidates its single page', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prototype-talk-jsx-impact-'));
  try {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'index.html'), '<script type="module" src="/src/main.jsx"></script>');
    fs.writeFileSync(path.join(root, 'src/main.jsx'), "import App from './App.jsx';");
    fs.writeFileSync(path.join(root, 'src/App.jsx'), '<button>保存</button>');
    const result = affectedPages(root, ['src/App.jsx'], ['/index.html'], [{ page_hint: '/index.html', anchor: { source: { path: 'src/App.jsx' } } }]);
    assert.deepEqual(result, ['/index.html']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
