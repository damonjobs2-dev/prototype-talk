import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeMetrics } from './metrics.mjs';

test('metrics separates current snapshot jobs and reports missing timing samples honestly', () => {
  const result = summarizeMetrics({
    source_snapshot_id: 'new', scan_summary: { operation_family_count: 2 }, operations: [{ operation_id: 'a' }, { operation_id: 'b' }],
    page_specs: [{ path: '/index.html', source_snapshot_id: 'new' }], cards: [{ operation_id: 'a', source_snapshot_id: 'new' }],
    project_jobs: [{ source_snapshot_id: 'new', status: 'returned', duration_ms: 1000, queue_duration_ms: 40 }, { source_snapshot_id: 'old', status: 'failed', duration_ms: 2000 }],
    jobs: [{ source_snapshot_id: 'new', status: 'failed' }],
  });
  assert.equal(result.page_jobs.total, 1);
  assert.equal(result.page_jobs.timing.duration_ms.median, 1000);
  assert.deepEqual(result.operation_jobs.timing.duration_ms, { samples: 0, median: null, p90: null });
  assert.equal(result.operations_with_card, 1);
  assert.equal(result.operation_families, 2);
});
