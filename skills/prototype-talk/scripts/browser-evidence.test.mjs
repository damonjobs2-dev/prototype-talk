import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBrowserEvidence } from './browser-evidence.mjs';

test('click-only capture preserves observed before and after without inventing technical sources', () => {
  const result = normalizeBrowserEvidence({
    url: 'https://demo-prototype.figma.site/?token=private',
    pages: [{ title: '产品概览', url: 'https://demo-prototype.figma.site/?token=private', visible_regions: ['侧边菜单'], interactions: [{ control: '数据分析', action: '点击', before: '子菜单收起', after: '显示我运营的账号和我关注的账号' }] }],
  });
  assert.equal(result.pages[0].interactions[0].evidence, 'browser:page:1:interaction:1');
  assert.equal(result.pages[0].url.includes('token='), false);
  assert.match(result.limitations[0], /不能证明设计源文件/);
  assert.throws(() => normalizeBrowserEvidence({ url: 'https://demo-prototype.figma.site/', pages: [{ title: '页面', url: 'https://demo-prototype.figma.site/', interactions: [{ control: '按钮', action: '点击' }] }] }), /缺少前后状态/);
});
