import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJsxControls } from './jsx-source.mjs';

test('JSX source records native and component controls with source handlers', () => {
  const source = `import React from 'react';
export default function Screen() {
  return <main>
    <Button aria-label="保存方案" onPress={() => savePlan()}>保存</Button>
    <input aria-label="方案名称" value={name} onChange={setName}/>
    <div className="decorative">装饰文字</div>
    <button type="submit">提交</button>
  </main>;
}`;
  const controls = extractJsxControls(source, 'src/Screen.jsx');
  assert.deepEqual(controls.map((item) => item.label), ['保存方案', '方案名称', '提交']);
  assert.equal(controls[0].anchor.onclick, '() => savePlan()');
  assert.equal(controls[0].anchor.source.line, 4);
  assert.equal(controls[1].trigger, 'input');
  assert.equal(controls[2].trigger, 'submit');
  assert.ok(controls.every((item) => item.page_hint === '/index.html'));
});
