import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export function tokenPath(sourceRoot, port) {
  const key = crypto.createHash('sha256').update(`${path.resolve(sourceRoot)}:${port}`).digest('hex').slice(0, 24);
  return path.join(os.tmpdir(), `prototype-talk-conversation-${key}.token`);
}

export function operationInput(store, job) {
  const operation = store.data.operations.find((item) => item.operation_id === job.operation_id);
  if (!operation) throw new Error('操作已不在当前索引中');
  const trace = job.trace_ids.length ? store.data.traces.find((item) => item.trace_id === job.trace_ids.at(-1)) : null;
  const routePath = (trace?.before?.route || '').split('#')[1]?.split('?')[0] || operation.page_hint;
  const pageSpec = store.pageSpec(routePath) || store.pageSpec(operation.page_hint) || null;
  return {
    sourceRoot: store.sourceRoot, source_snapshot_id: job.source_snapshot_id, operation, trace,
    previousCard: store.latestCard(job.operation_id),
    supplements: store.data.supplements.filter((item) => item.operation_id === job.operation_id),
    rules: store.data.rules.filter((item) => item.operation_id === job.operation_id && !item.superseded_by),
    dataInventory: store.data.data_inventory, sourceRegions: store.data.source_regions,
    sourceRegionLinks: store.data.source_region_links, displayFields: store.data.display_fields,
    pageSpec, reason: job.reason,
  };
}

export function pageInput(store, job, allPages) {
  return {
    sourceRoot: store.sourceRoot, source_snapshot_id: job.source_snapshot_id, pages: job.pages,
    allPages, operations: store.data.operations, dataInventory: store.data.data_inventory,
    sourceRegions: store.data.source_regions, displayFields: store.data.display_fields,
  };
}
