#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function percentile(values, quantile) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.ceil(quantile * sorted.length) - 1];
}

function jobsSummary(jobs) {
  const byStatus = {};
  for (const job of jobs) byStatus[job.status] = (byStatus[job.status] || 0) + 1;
  const timing = {};
  for (const key of ['queue_duration_ms', 'evidence_build_ms', 'evidence_chars', 'prompt_build_ms', 'prompt_chars', 'cli_first_output_ms', 'cli_retry_count', 'cli_stdout_chars', 'model_duration_ms', 'validation_duration_ms', 'write_duration_ms', 'duration_ms']) {
    const values = jobs.map((item) => item[key]).filter((value) => Number.isFinite(value));
    timing[key] = { samples: values.length, median: percentile(values, 0.5), p90: percentile(values, 0.9) };
  }
  return { total: jobs.length, by_status: byStatus, timing };
}

export function summarizeMetrics(data) {
  const current = (job) => job.source_snapshot_id === data.source_snapshot_id;
  const projectJobs = (data.project_jobs || []).filter(current);
  const cardJobs = (data.jobs || []).filter(current);
  const pageSpecs = (data.page_specs || []).filter(current);
  const operations = data.operations || [];
  const currentCards = (data.cards || []).filter((item) => current(item) && !item.invalidated_reason);
  return {
    source_snapshot_id: data.source_snapshot_id,
    pages_with_brief: new Set(pageSpecs.map((item) => item.path)).size,
    operations: operations.length,
    operation_families: data.scan_summary?.operation_family_count ?? null,
    operations_with_card: new Set(currentCards.map((item) => item.operation_id)).size,
    page_jobs: jobsSummary(projectJobs),
    operation_jobs: jobsSummary(cardJobs),
    note: '只统计当前源码快照；历史任务和未记录耗时的旧任务不进入耗时样本。任务成功不代表内容已核对。',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--state') { console.error('用法: node metrics.mjs --state <docs/prototype-talk/review-state.json>'); process.exitCode = 1; }
  else {
    try { console.log(JSON.stringify(summarizeMetrics(JSON.parse(fs.readFileSync(path.resolve(args[1]), 'utf8'))), null, 2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
