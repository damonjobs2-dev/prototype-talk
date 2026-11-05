import test from 'node:test';
import assert from 'node:assert/strict';
import { blindPair, traceEligibleForBenchmark } from './benchmark.mjs';
import { renderBlindReview } from './blind-review.mjs';

test('blind review hides A/B mapping and escapes prototype text', () => {
  const frozen = {
    case_id: 'op_1', project_label: '示例', pack: { logical_screen_id: '/?screen=follow' },
    baseline: { title: '</script><script>alert(1)</script>', summary: '首轮', claims: [], issues: [], expected_effects: [] },
    source_job_duration_ms: 30000,
  };
  const result = { reviewed: { title: '复核', summary: '修订', claims: [], issues: [], expected_effects: [] }, timing: { review_model_ms: 20000 } };
  const pair = blindPair(frozen, result, { version_1: 'reviewed', version_2: 'baseline' });
  assert.equal(pair.key.version_1, 'reviewed');
  assert.equal(pair.visible.versions[0].label, '版本 1');
  const html = renderBlindReview([pair.visible]);
  assert.ok(!html.includes('version_1'));
  assert.ok(!html.includes('reviewed'));
  assert.ok(!html.includes('baseline'));
  assert.ok(!html.includes('</script><script>alert(1)</script>'));
  assert.match(html, /\\u003c\/script\\u003e/);
  assert.ok(!html.includes('<h4>操作结果</h4>'));
  assert.ok(html.includes('原型预览尚未生成'));
});

test('benchmark rejects a trace for a different control', () => {
  const operation = { label: '添加监测', anchor: { label: '添加监测' } };
  assert.equal(traceEligibleForBenchmark(operation, { target: { label: '首页' } }), false);
  assert.equal(traceEligibleForBenchmark(operation, { target: { label: '添加监测' } }), true);
});

test('paused blind review explains why scoring has stopped', () => {
  const html = renderBlindReview([], { paused: true, reason: '样例不合格' });
  assert.match(html, /const reviewStatus = \{"paused":true,"reason":"样例不合格"\}/);
  assert.match(html, /document\.querySelector\('#cases'\)\.hidden = true/);
});
