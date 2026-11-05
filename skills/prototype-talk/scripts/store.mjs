import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { scanSource, matchRuntimeControl, runtimeIdentityConflict, runtimeTraceTargetMismatch, isSyntheticLabel, sourceFingerprint } from './scanner.mjs';
import { mergeRuntimeFields } from './display-fields.mjs';
import { COMPONENTS, classifyComponent, componentCoverageMarkdown } from './component-catalog.mjs';
import { dataInventoryMarkdown } from './data-inventory.mjs';
import { writeDocuments } from './documents.mjs';
import { groupOperationFamilies } from './operation-families.mjs';
import { auditModelResult } from './evidence-audit.mjs';
import { checkResultQuality } from './result-quality.mjs';
import { activeInterfaceContracts } from './contracts.mjs';
import { affectedPages } from './source-impact.mjs';
import { projectPages } from './project-agent.mjs';
import { logicalScreens, screenPath } from './logical-screens.mjs';
import { reconcileRegion } from './source-regions.mjs';

const stamp = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 12)}`;

function linkObservedFunctions(page, operations, cards, snapshotId) {
  let changed = false;
  for (const operation of operations.filter((item) => item.logical_screen_ids?.includes(page.path))) {
    if (page.functions?.some((item) => item.operation_ids?.includes(operation.operation_id))) continue;
    const card = cards.filter((item) => item.operation_id === operation.operation_id && item.source_snapshot_id === snapshotId && !item.invalidated_reason).at(-1);
    if (!card) continue;
    const references = new Set([...(card.claims || []), ...(card.expected_effects || [])].filter((item) => item.origin === 'source_observed').flatMap((item) => item.evidence_audit?.valid || []));
    const matches = (page.functions || []).map((item) => ({ item, score: (item.evidence || []).filter((ref) => references.has(ref)).length })).sort((a, b) => b.score - a.score);
    const best = matches[0];
    if (!best || best.score < 2 || best.score === matches[1]?.score) continue;
    best.item.operation_ids ||= [];
    best.item.operation_ids.push(operation.operation_id);
    changed = true;
  }
  return changed;
}

export class ReviewStore {
  constructor(sourceRoot, outputRoot) {
    this.sourceRoot = path.resolve(sourceRoot);
    this.outputRoot = path.resolve(outputRoot || path.join(this.sourceRoot, 'docs', 'prototype-talk'));
    fs.mkdirSync(this.outputRoot, { recursive: true });
    this.file = path.join(this.outputRoot, 'review-state.json');
    const scan = scanSource(this.sourceRoot);
    const previous = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : null;
    const projectLocal = this.outputRoot === path.join(this.sourceRoot, 'docs', 'prototype-talk');
    const matchingOperations = new Set(scan.operations.map((item) => item.operation_id));
    const canReuse = previous && (previous.source_root === this.sourceRoot || projectLocal && previous.operations?.some((item) => matchingOperations.has(item.operation_id)));
    this.data = canReuse ? previous : {
      schema_version: 1, source_root: this.sourceRoot, created_at: stamp(), operations: [], cards: [], traces: [], jobs: [], issues: [], supplements: [], history: [],
    };
    this.data.source_root = this.sourceRoot;
    this.data.logical_screens = [...logicalScreens(this.sourceRoot)].map(([path, value]) => ({ path, ...value }));
    this.data.supplements ||= [];
    this.data.rules ||= [];
    this.data.page_specs ||= [];
    this.data.project_jobs ||= [];
    this.data.display_fields ||= [];
    this.data.source_regions ||= [];
    this.data.source_region_links ||= [];
    this.data.api_fields ||= [];
    this.data.prototype_changes ||= [];
    this.applyScan(scan, true);
    let updated = this.quarantineMismatchedTraces();
    for (const card of this.data.cards) {
      if (card.claims?.every((item) => item.evidence_audit) && (card.expected_effects || []).every((item) => item.evidence_audit) && card.quality_checks) continue;
      const audited = auditModelResult(this.sourceRoot, card, {
        traceIds: this.data.traces.filter((item) => item.operation_id === card.operation_id && !item.invalidated_reason).map((item) => item.trace_id),
        supplementIds: this.data.supplements.map((item) => item.supplement_id),
        ruleIds: this.data.rules.map((item) => item.rule_id),
      });
      card.claims = audited.claims;
      card.expected_effects = audited.expected_effects;
      const operation = this.data.operations.find((item) => item.operation_id === card.operation_id);
      card.quality_checks = checkResultQuality(this.sourceRoot, operation, card);
      updated = true;
    }
    for (const page of this.data.page_specs.filter((item) => item.source_snapshot_id === this.data.source_snapshot_id)) updated = linkObservedFunctions(page, this.data.operations, this.data.cards, this.data.source_snapshot_id) || updated;
    if (updated) { this.save(); writeDocuments(this.outputRoot, this.data); }
  }

  quarantineMismatchedTraces() {
    const operations = new Map(this.data.operations.map((item) => [item.operation_id, item]));
    let changed = false;
    for (const trace of this.data.traces) {
      if (trace.invalidated_reason || !runtimeTraceTargetMismatch(operations.get(trace.operation_id), trace.target)) continue;
      trace.invalidated_reason = 'trace_target_mismatch';
      changed = true;
    }
    const badTraceIds = new Set(this.data.traces.filter((item) => item.invalidated_reason === 'trace_target_mismatch').map((item) => item.trace_id));
    for (const card of this.data.cards) {
      if (card.invalidated_reason || !card.based_on_trace_ids?.some((traceId) => badTraceIds.has(traceId))) continue;
      card.invalidated_reason = 'trace_target_mismatch';
      changed = true;
    }
    for (const operation of this.data.operations.filter((item) => item.discovered_by?.includes('runtime') && !item.discovered_by.includes('jsx_ast'))) {
      const screens = [...new Set(this.data.traces.filter((trace) => trace.operation_id === operation.operation_id && !trace.invalidated_reason).map((trace) => trace.logical_screen_id || screenPath(trace.before?.route)).filter(Boolean))];
      if (JSON.stringify(operation.logical_screen_ids || []) === JSON.stringify(screens)) continue;
      operation.logical_screen_ids = screens;
      changed = true;
    }
    return changed;
  }

  applyScan(scan, initial = false) {
    const previousSnapshot = this.data.source_snapshot_id;
    const previousHashes = this.data.file_hashes || {};
    const baselineMigration = initial && previousSnapshot && !Object.keys(previousHashes).length && previousSnapshot === scan.legacy_snapshot_id;
    const changedFiles = baselineMigration ? [] : [...new Set([...Object.keys(previousHashes), ...Object.keys(scan.file_hashes)])].filter((file) => previousHashes[file] !== scan.file_hashes[file]);
    if (!initial && previousSnapshot === scan.source_snapshot_id) return null;
    const oldFields = this.data.display_fields || [];
    const knownPages = [...new Set([...this.data.operations.map((item) => item.page_hint), ...this.data.page_specs.map((item) => item.path), ...scan.operations.map((item) => item.page_hint), ...scan.display_fields.map((item) => item.page_path)])].filter((item) => item?.startsWith('/'));
    const actualPages = [...new Set([...projectPages(this.sourceRoot), ...this.data.page_specs.map((item) => item.path)])];
    const affected = previousSnapshot ? affectedPages(this.sourceRoot, changedFiles, actualPages.length ? actualPages : knownPages, [...this.data.operations, ...scan.operations]) : [];
    const affectedSet = new Set(affected);
    if (previousSnapshot && previousSnapshot !== scan.source_snapshot_id) {
      for (const page of this.data.page_specs.filter((item) => item.source_snapshot_id === previousSnapshot && !affectedSet.has(item.path))) this.data.page_specs.push({ ...page, source_snapshot_id: scan.source_snapshot_id, reused_from_snapshot_id: previousSnapshot });
      for (const card of this.data.cards.filter((item) => !item.invalidated_reason && item.source_snapshot_id === previousSnapshot && !affectedSet.has(this.data.operations.find((op) => op.operation_id === item.operation_id)?.page_hint))) this.data.cards.push({ ...card, card_id: id('card'), claims: card.claims.map((claim) => ({ ...claim, claim_id: id('claim') })), source_snapshot_id: scan.source_snapshot_id, reused_from_card_id: card.card_id });
      for (const rule of this.data.rules.filter((item) => !item.superseded_by && affectedSet.has(item.page_path))) rule.review_status = 'prototype_changed';
      for (const field of this.data.api_fields.filter((item) => !item.removed_at && affectedSet.has(item.page_path))) field.review_status = 'prototype_changed';
      for (const job of [...this.data.jobs, ...this.data.project_jobs]) if (job.source_snapshot_id === previousSnapshot && ['queued', 'analyzing', 'validating'].includes(job.status)) { job.status = 'stale'; job.stage = '原型已变化'; job.updated_at = stamp(); }
    }
    const old = new Map(this.data.operations.map((item) => [item.operation_id, item]));
    this.data.operations = scan.operations.map((item) => {
      const prior = old.get(item.operation_id);
      if (!prior) return item;
      const priorTrace = this.data.traces.filter((trace) => trace.operation_id === item.operation_id && Object.keys(trace.target?.data || {}).length).at(-1);
      const dynamicInstance = Object.values(item.anchor.data).some(isSyntheticLabel) ? priorTrace?.target?.data : null;
      const merged = { ...item, label: prior.coverage === 'observed' && prior.label && !isSyntheticLabel(prior.label) && /^(div|span|i|li|button|请选择|请输入)/i.test(item.label) ? prior.label : item.label, coverage: prior.coverage === 'observed' ? 'observed' : item.coverage, role: prior.role || item.role, latest_runtime: prior.latest_runtime || null, instance_data: prior.instance_data || dynamicInstance || null, logical_screen_ids: prior.logical_screen_ids || [] };
      merged.component = classifyComponent(merged);
      return merged;
    });
    for (const item of old.values()) if (item.discovered_by?.includes('runtime') && !this.data.operations.some((x) => x.operation_id === item.operation_id)) this.data.operations.push(item);
    for (const trace of this.data.traces || []) {
      if (trace.invalidated_reason) continue;
      const screen = trace.logical_screen_id || screenPath(trace.before?.route);
      const operation = this.data.operations.find((item) => item.operation_id === trace.operation_id);
      if (screen && operation && !(operation.logical_screen_ids || []).includes(screen)) operation.logical_screen_ids = [...(operation.logical_screen_ids || []), screen];
    }
    // Rebuild compact matches for previously saved runtime controls as well.
    for (const operation of this.data.operations) operation.component = classifyComponent(operation);
    this.data.catalog_version = scan.catalog_version;
    this.data.unmatched_components = scan.unmatched_components;
    for (const operation of this.data.operations) if (operation.component?.status === 'needs_research' && !this.data.unmatched_components.some((item) => item.signature === operation.component.evidence)) this.data.unmatched_components.push({ signature: operation.component.evidence, count: 1, example: { operation_id: operation.operation_id, label: operation.label, source: operation.anchor?.source || null } });
    this.data.data_inventory = scan.data_inventory;
    this.data.page_behaviors = scan.page_behaviors;
    this.data.file_hashes = scan.file_hashes;
    this.data.source_snapshot_id = scan.source_snapshot_id;
    this.data.source_regions = scan.source_regions || [];
    this.data.source_region_links = scan.source_region_links || [];
    const previousFieldsById = new Map(oldFields.map((field) => [field.field_id, field]));
    const fresh = scan.display_fields.map((field) => {
      const prior = previousFieldsById.get(field.field_id);
      const keepObservation = prior && !affectedSet.has(field.page_path);
      return { ...field, source_snapshot_id: scan.source_snapshot_id,
        ...(keepObservation && prior.runtime_visible !== undefined ? { runtime_visible: prior.runtime_visible } : {}),
        ...(keepObservation && prior.observed_sample ? { observed_sample: prior.observed_sample } : {}),
        ...(keepObservation && prior.observed_usage ? { observed_usage: prior.observed_usage } : {}),
      };
    });
    const freshIds = new Set(fresh.map((field) => field.field_id));
    const retained = oldFields.filter((field) => !freshIds.has(field.field_id) && !fresh.some((item) => item.page_path === field.page_path && item.kind === field.kind && item.label === field.label && field.observed_usage === 'form' && item.evidence?.some((evidence) => /\.(?:jsx|tsx)$/.test(evidence.path)))).map((field) => ({ ...field, status: field.source === 'runtime_observed' ? affectedSet.has(field.page_path) ? 'needs_review' : 'current' : 'removed' }));
    this.data.display_fields = [...fresh, ...retained];
    if (previousSnapshot && previousSnapshot !== scan.source_snapshot_id && !baselineMigration) this.data.prototype_changes.push({ change_id: id('change'), from_snapshot_id: previousSnapshot, to_snapshot_id: scan.source_snapshot_id, changed_files: changedFiles, affected_pages: affected, added_field_ids: fresh.filter((field) => !oldFields.some((oldField) => oldField.field_id === field.field_id)).map((field) => field.field_id), changed_field_ids: fresh.filter((field) => { const oldField = oldFields.find((item) => item.field_id === field.field_id); return oldField && (oldField.label !== field.label || oldField.default_visible !== field.default_visible || oldField.source_key !== field.source_key); }).map((field) => field.field_id), removed_field_ids: retained.filter((field) => field.status === 'removed').map((field) => field.field_id), created_at: stamp() });
    const families = groupOperationFamilies(this.data.operations);
    this.data.scan_summary = { scanned_files: scan.scanned_files, source_files: scan.source_files, operation_count: scan.operations.length, operation_family_count: families.length, repeated_family_count: families.filter((item) => item.count > 1).length, data_collection_count: scan.data_inventory.collections.length, storage_key_count: scan.data_inventory.storage.length, unmatched_component_count: scan.unmatched_components.length, scanned_at: stamp() };
    if (initial) {
      for (const job of this.data.jobs) {
        if (job.status === 'queued') { job.stage = '等待服务恢复'; job.updated_at = stamp(); }
        else if (['collecting', 'analyzing', 'validating'].includes(job.status)) { job.status = job.generator === 'conversation' ? 'queued' : 'failed'; job.stage = job.generator === 'conversation' ? '等待当前对话继续' : job.stage; job.error = job.generator === 'conversation' ? '' : '本地服务重启，运行中的任务已中断，可重新解读'; job.updated_at = stamp(); }
      }
      for (const job of this.data.project_jobs) {
        if (job.status === 'queued') { job.stage = '等待服务恢复'; job.updated_at = stamp(); }
        else if (['analyzing', 'validating'].includes(job.status)) { job.status = job.generator === 'conversation' ? 'queued' : 'failed'; job.stage = job.generator === 'conversation' ? '等待当前对话继续' : job.stage; job.error = job.generator === 'conversation' ? '' : '本地服务重启，运行中的页面任务已中断'; job.updated_at = stamp(); }
      }
    }
    this.save();
    fs.writeFileSync(path.join(this.outputRoot, 'data-map.md'), dataInventoryMarkdown(scan.data_inventory, scan.source_snapshot_id), 'utf8');
    fs.writeFileSync(path.join(this.outputRoot, 'component-coverage.md'), componentCoverageMarkdown(this.data.operations, this.data.unmatched_components, scan.source_snapshot_id), 'utf8');
    writeDocuments(this.outputRoot, this.data);
    this.file_fingerprint = sourceFingerprint(this.sourceRoot);
    return this.data.prototype_changes.at(-1) || null;
  }

  rescanIfChanged() {
    const nextFingerprint = sourceFingerprint(this.sourceRoot);
    if (nextFingerprint === this.file_fingerprint) return null;
    this.file_fingerprint = nextFingerprint;
    const result = this.applyScan(scanSource(this.sourceRoot));
    return result;
  }

  save() {
    this.data.updated_at = stamp();
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(temp, this.file);
  }

  publicState() {
    const { traces, ...rest } = this.data;
    const validCards = rest.cards.filter((card) => !card.invalidated_reason);
    const invalidCardIds = new Set(rest.cards.filter((card) => card.invalidated_reason).map((card) => card.card_id));
    const operationObservations = traces
      .filter((trace) => !trace.invalidated_reason && trace.source_snapshot_id === this.data.source_snapshot_id)
      .map((trace) => ({
        operation_id: trace.operation_id,
        trace_id: trace.trace_id,
        recorded_at: trace.recorded_at,
        message: String(trace.after?.dialogs?.at(-1) || '').slice(0, 200),
        page_changed: trace.before?.visible_text !== trace.after?.visible_text,
        context_fields: [...new Set([...(trace.context_fields || []), ...this.data.display_fields.filter((field) => field.kind === 'form_field' && field.observed_usage !== 'filter' && trace.before?.visible_text?.includes(field.label)).map((field) => field.label)])].sort((a, b) => (trace.before?.visible_text?.indexOf(a) ?? -1) - (trace.before?.visible_text?.indexOf(b) ?? -1)),
        region_reconciliation: trace.region_reconciliation || reconcileRegion(this.data.source_region_links || [], trace),
      }));
    return { ...rest, cards: validCards, issues: rest.issues.filter((item) => !invalidCardIds.has(item.card_id)), trace_count: traces.filter((item) => !item.invalidated_reason).length, quarantined_trace_count: traces.filter((item) => item.invalidated_reason).length, operation_observations: operationObservations, contracts: activeInterfaceContracts(this.data), component_questions: Object.fromEntries(COMPONENTS.map(({ id, label, questions }) => [id, { label, questions }])) };
  }

  recordRuntimeFields(input) {
    const pagePath = String(input.page_path || '');
    if (!pagePath.startsWith('/') || pagePath.includes('..')) throw new Error('页面位置无效');
    const change = [...this.data.prototype_changes].reverse().find((item) => item.affected_pages?.includes(pagePath));
    const loadedAt = Date.parse(input.loaded_at || '');
    if (change?.affected_pages?.includes(pagePath) && (!Number.isFinite(loadedAt) || Date.parse(change.created_at) > loadedAt)) throw new Error('原型已变化，请刷新页面再采集');
    const incoming = (Array.isArray(input.fields) ? input.fields : []).slice(0, 120).map((item) => ({ ...item, page_path: pagePath }));
    const before = JSON.stringify(this.data.display_fields);
    this.data.display_fields = mergeRuntimeFields(this.data.display_fields, incoming, this.data.source_snapshot_id);
    if (JSON.stringify(this.data.display_fields) !== before) { this.save(); writeDocuments(this.outputRoot, this.data); }
    return this.data.display_fields.filter((item) => item.page_path === pagePath && item.status === 'current');
  }

  upsertApiField(input) {
    const pagePath = String(input.page_path || '');
    if (!pagePath.startsWith('/') || pagePath.includes('..') || pagePath.length > 250) throw new Error('页面位置无效');
    const operation = input.operation_id ? this.data.operations.find((item) => item.operation_id === input.operation_id) : null;
    if (input.operation_id && !operation) throw new Error('关联操作不存在');
    const direction = String(input.direction || 'response');
    if (!['path', 'query', 'header', 'body', 'response', 'context'].includes(direction)) throw new Error('字段位置无效');
    const key = String(input.key || '').trim().slice(0, 120);
    if (!/^[A-Za-z_$][\w$]*(?:\[\])?(?:\.[A-Za-z_$][\w$]*(?:\[\])?)*$/.test(key)) throw new Error('字段 ID 请填写 JSON 路径，如 items[].loginName');
    const mapping = String(input.display_field_id || '');
    if (mapping && !this.data.display_fields.some((field) => field.field_id === mapping && field.page_path === pagePath && field.status === 'current')) throw new Error('展示字段已变化，请重新选择映射');
    const label = String(input.label || '').trim().slice(0, 80);
    const description = String(input.description || '').trim().slice(0, 500);
    if (!label || !description) throw new Error('请填写字段名称和说明');
    const type = String(input.type || 'string');
    if (!['string', 'integer', 'number', 'boolean', 'object', 'array'].includes(type)) throw new Error('字段类型无效');
    const existing = input.field_id ? this.data.api_fields.find((item) => item.field_id === input.field_id && !item.removed_at) : null;
    if (input.field_id && !existing) throw new Error('接口字段不存在');
    const field = { field_id: existing?.field_id || id('api_field'), page_path: pagePath, operation_id: operation?.operation_id || null, direction, key, label, description, type, required: !!input.required, nullable: !!input.nullable, display_field_id: mapping || null, example: String(input.example || '').slice(0, 160), source: 'user', status: 'confirmed', review_status: 'current', source_snapshot_id: this.data.source_snapshot_id, updated_at: stamp() };
    if (existing) Object.assign(existing, field);
    else this.data.api_fields.push(field);
    this.save(); writeDocuments(this.outputRoot, this.data);
    return field;
  }

  removeApiField(fieldId) {
    const field = this.data.api_fields.find((item) => item.field_id === fieldId && !item.removed_at);
    if (!field) throw new Error('接口字段不存在');
    field.removed_at = stamp();
    this.save(); writeDocuments(this.outputRoot, this.data);
    return field;
  }

  latestCard(operationId) {
    return this.data.cards.filter((card) => card.operation_id === operationId && card.source_snapshot_id === this.data.source_snapshot_id && !card.invalidated_reason).at(-1) || null;
  }

  pageSpec(pagePath) {
    return this.data.page_specs.filter((spec) => spec.path === pagePath && spec.source_snapshot_id === this.data.source_snapshot_id).at(-1) || null;
  }

  createProjectJob(pages) {
    const missing = pages.filter((pagePath) => !this.pageSpec(pagePath));
    if (!missing.length) return null;
    const current = this.data.project_jobs.find((job) => job.source_snapshot_id === this.data.source_snapshot_id && ['queued', 'analyzing', 'validating'].includes(job.status) && missing.every((pagePath) => job.pages.includes(pagePath)));
    if (current) return current;
    const job = { job_id: id('project'), pages: missing, source_snapshot_id: this.data.source_snapshot_id, status: 'queued', stage: '等待首轮解读', error: '', created_at: stamp(), updated_at: stamp() };
    this.data.project_jobs.push(job);
    this.save();
    return job;
  }

  updateProjectJob(jobId, patch) {
    const job = this.data.project_jobs.find((item) => item.job_id === jobId);
    if (!job) throw new Error('项目解读任务不存在');
    Object.assign(job, patch, { updated_at: stamp() });
    this.save();
    return job;
  }

  addProjectResult(job, pages) {
    if (job.source_snapshot_id !== this.data.source_snapshot_id) return this.updateProjectJob(job.job_id, { status: 'stale', stage: '源码已变化', error: '本批结果未发布' });
    for (const page of pages) {
      if (!job.pages.includes(page.path)) continue;
      linkObservedFunctions(page, this.data.operations, this.data.cards, job.source_snapshot_id);
      this.data.page_specs.push({ ...page, source_snapshot_id: job.source_snapshot_id, job_id: job.job_id, generator: job.generator || 'codex_cli', version: this.data.page_specs.filter((item) => item.path === page.path).length + 1, created_at: stamp() });
    }
    this.writeProjectSpec();
    writeDocuments(this.outputRoot, this.data);
    return this.updateProjectJob(job.job_id, { status: 'returned', stage: '首轮解读已保存', result_pages: pages.map((page) => page.path) });
  }

  writeProjectSpec() {
    const sections = this.data.page_specs.filter((item) => item.source_snapshot_id === this.data.source_snapshot_id);
    const lines = ['# Prototype Talk · 项目首轮说明', '', `源码快照：${this.data.source_snapshot_id}`, '', '此文件由首轮模型解读生成。源码现状、文档要求和建议需按标记核对；详细确认状态保存在 review-state.json。', ''];
    const origin = { source_observed: '源码／原型', documented: '需求文档', proposed: '建议／待核对' };
    for (const page of sections) {
      lines.push(`## ${page.title}（${page.path}）`, '', page.purpose || '页面用途待核对。', '');
      for (const [title, values, format] of [
        ['页面布局与展示', page.layout, (item) => item.text],
        ['主要功能与验收结果', page.functions, (item) => `${item.name}：${item.outcome}`],
        ['关键状态', page.states, (item) => item.text],
        ['数据来源与去向', page.data, (item) => item.text],
      ]) if (values?.length) {
        lines.push(`### ${title}`, '');
        for (const item of values) lines.push(`- ${format(item)}（${origin[item.origin] || '待核对'}；${item.evidence?.join('、') || '依据待补'}）`);
        lines.push('');
      }
      if (page.open_questions?.length) { lines.push('### 待核对', '', ...page.open_questions.map((text) => `- ${text}`), ''); }
    }
    fs.writeFileSync(path.join(this.outputRoot, 'project-spec.md'), lines.join('\n'), 'utf8');
  }

  operationFor(target, route, before = {}) {
    const dialogContext = (before.dialogs || []).join('|');
    const prior = this.data.operations.filter((item) => item.discovered_by?.includes('runtime') && !item.discovered_by?.includes('jsx_ast')
      && item.label === target.label && item.tag === target.tag && item.page_hint === route
      && target.selector_unique && target.selector && item.anchor?.selector === target.selector
      && !runtimeIdentityConflict(item, target)
      && this.data.traces.some((trace) => trace.operation_id === item.operation_id && (trace.before?.dialogs || []).join('|') === dialogContext));
    if (prior.length === 1) return prior[0];
    return matchRuntimeControl(this.data.operations, target, route);
  }

  addTrace(input) {
    const target = input.target || {};
    let operation = input.operation_id ? this.data.operations.find((item) => item.operation_id === input.operation_id) : null;
    if (operation && runtimeIdentityConflict(operation, target)) operation = null;
    if (operation?.discovered_by?.includes('jsx_ast') && this.operationFor(target, input.before?.route || '', input.before)?.operation_id !== operation.operation_id) operation = null;
    if (!operation) operation = this.operationFor(target, input.before?.route || '', input.before);
    if (!operation) {
      const template = this.data.operations.find((item) => item.anchor?.source && item.page_hint === (input.before?.route || '') && item.tag === target.tag && Object.entries(target.data || {}).some(([key, value]) => value && isSyntheticLabel(item.anchor.data?.[key])));
      operation = template ? {
        ...template, operation_id: id('op'), template_operation_id: template.operation_id, label: target.label || template.label, anchor: { ...template.anchor, selector: target.selector || template.anchor.selector, data: target.data || {}, hierarchy: target.hierarchy || null, id: target.id || '', form: target.form || '', type: target.type || template.anchor.type || '', role: target.role || template.anchor.role || '', class_name: target.class_name || template.anchor.class_name || '', download: !!target.download, multiple: !!target.multiple, expanded: target.expanded || '', onclick: target.onclick || template.anchor.onclick || '', href: target.href || '' },
        discovered_by: ['source_template', 'runtime'], coverage: 'observed', instance_data: target.data || {}, latest_runtime: null,
      } : {
        operation_id: id('op'), page_hint: input.before?.route || 'unknown', state: 'unknown', role: 'unknown', label: target.label || '未命名交互', tag: target.tag || '',
        anchor: { selector: target.selector || '', data: target.data || {}, hierarchy: target.hierarchy || null, id: target.id || '', form: target.form || '', type: target.type || '', role: target.role || '', class_name: target.class_name || '', download: !!target.download, multiple: !!target.multiple, expanded: target.expanded || '', onclick: target.onclick || '', href: target.href || '', source: null },
        trigger: input.trigger || 'click', discovered_by: ['runtime'], coverage: 'observed', related_code: [], source_snapshot_id: this.data.source_snapshot_id,
      };
      this.data.operations.push(operation);
      const families = groupOperationFamilies(this.data.operations);
      this.data.scan_summary.operation_count = this.data.operations.length;
      this.data.scan_summary.operation_family_count = families.length;
      this.data.scan_summary.repeated_family_count = families.filter((item) => item.count > 1).length;
    } else {
      operation.coverage = 'observed';
      if (!operation.discovered_by.includes('runtime')) operation.discovered_by.push('runtime');
      if ((!operation.label || operation.label === operation.tag || operation.label === 'button' || operation.label === operation.anchor.onclick || /^(请选择|请输入)/.test(operation.label) || isSyntheticLabel(operation.label)) && target.label && !isSyntheticLabel(target.label)) operation.label = target.label;
      if (!operation.instance_data && Object.values(operation.anchor.data || {}).some(isSyntheticLabel) && Object.keys(target.data || {}).length) operation.instance_data = target.data;
      if (!operation.anchor.hierarchy && target.hierarchy && !operation.discovered_by.some((value) => ['source_scan', 'jsx_ast'].includes(value))) operation.anchor.hierarchy = target.hierarchy;
    }
    if (target.editability) operation.latest_runtime = { editability: target.editability, current_value: target.current_value || '', required: !!target.required, type: target.type || '', seen_at: stamp() };
    operation.component = classifyComponent(operation);
    if (operation.component.status === 'needs_research' && !this.data.unmatched_components.some((item) => item.signature === operation.component.evidence)) this.data.unmatched_components.push({ signature: operation.component.evidence, count: 1, example: { operation_id: operation.operation_id, label: operation.label, source: operation.anchor.source || null } });
    const trace = { ...input, trace_id: input.trace_id || id('trace'), operation_id: operation.operation_id, source_snapshot_id: this.data.source_snapshot_id, recorded_at: stamp() };
    trace.region_reconciliation = reconcileRegion(this.data.source_region_links || [], trace);
    const observedIds = new Set(trace.observed_region?.observed_field_ids || []);
    for (const field of this.data.display_fields) if (observedIds.has(field.field_id) && field.page_path === trace.observed_region.page_path) {
      field.runtime_visible = true;
      field.last_seen_snapshot_id = this.data.source_snapshot_id;
    }
    trace.logical_screen_id ||= screenPath(input.before?.route);
    if (trace.logical_screen_id && !(operation.logical_screen_ids || []).includes(trace.logical_screen_id)) operation.logical_screen_ids = [...(operation.logical_screen_ids || []), trace.logical_screen_id];
    this.data.traces.push(trace);
    this.save();
    return { operation, trace };
  }

  createJob(kind, operationId, traceIds = [], reason = '') {
    const current = this.data.jobs.find((job) => job.operation_id === operationId && job.source_snapshot_id === this.data.source_snapshot_id && ['queued', 'analyzing', 'validating'].includes(job.status));
    if (current) return current;
    const job = { job_id: id('job'), kind, operation_id: operationId, trace_ids: traceIds, source_snapshot_id: this.data.source_snapshot_id, reason, status: 'queued', stage: '已提交', created_at: stamp(), updated_at: stamp(), error: '' };
    this.data.jobs.push(job);
    this.save();
    return job;
  }

  updateJob(jobId, patch) {
    const job = this.data.jobs.find((item) => item.job_id === jobId);
    if (!job) throw new Error('任务不存在');
    Object.assign(job, patch, { updated_at: stamp() });
    this.save();
    return job;
  }

  addResult(job, result) {
    const audited = auditModelResult(this.sourceRoot, result, {
      traceIds: this.data.traces.filter((item) => job.trace_ids.includes(item.trace_id)).map((item) => item.trace_id),
      supplementIds: this.data.supplements.map((item) => item.supplement_id),
      ruleIds: this.data.rules.map((item) => item.rule_id),
    });
    const operationId = job.operation_id;
    const operation = this.data.operations.find((item) => item.operation_id === operationId);
    const qualityChecks = checkResultQuality(this.sourceRoot, operation, audited);
    const version = this.data.cards.filter((card) => card.operation_id === operationId).length + 1;
    const card = {
      card_id: id('card'), operation_id: operationId, version, source_snapshot_id: job.source_snapshot_id, job_id: job.job_id,
      generator: job.generator || 'codex_cli',
      based_on_trace_ids: job.trace_ids, title: audited.title, summary: audited.summary, page_context: audited.page_context || null, quick_facts: audited.quick_facts || [], expected_effects: audited.expected_effects || [], expected_after: audited.expected_after,
      review_state: 'ai_pending', reviewed_at: null, quality_checks: qualityChecks,
      claims: audited.claims.map((claim) => ({ ...claim, claim_id: id('claim'), confirmation_state: 'ai_pending', reviewed_at: null })),
      created_at: stamp(),
    };
    this.data.cards.push(card);
    for (const page of this.data.page_specs.filter((item) => item.source_snapshot_id === this.data.source_snapshot_id)) linkObservedFunctions(page, this.data.operations, this.data.cards, this.data.source_snapshot_id);
    const issues = audited.issues.map((issue) => ({ issue_id: id('issue'), operation_id: operationId, card_id: card.card_id, source: 'ai', decision: 'candidate', todo_status: null, text: issue.text, reason: issue.reason, evidence: issue.evidence, questions: issue.questions || [], kind: issue.kind || '', prd_fact: issue.prd_fact || '', demo_fact: issue.demo_fact || '', created_at: stamp() }));
    this.data.issues.push(...issues);
    this.updateJob(job.job_id, { status: 'returned', stage: '已返回', result_card_id: card.card_id, review_item_ids: issues.map((issue) => issue.issue_id) });
    writeDocuments(this.outputRoot, this.data);
    return { card, issues };
  }

  decideClaim(cardId, claimId, decision) {
    if (!['confirmed', 'rejected', 'ai_pending'].includes(decision)) throw new Error('无效的结论状态');
    const card = this.data.cards.find((item) => item.card_id === cardId);
    const claim = card?.claims.find((item) => item.claim_id === claimId);
    if (!claim) throw new Error('结论不存在');
    claim.confirmation_state = decision;
    claim.reviewed_at = decision === 'ai_pending' ? null : stamp();
    this.save();
    return claim;
  }

  decideCard(cardId, decision) {
    if (!['confirmed', 'rejected', 'ai_pending'].includes(decision)) throw new Error('无效的说明状态');
    const card = this.data.cards.find((item) => item.card_id === cardId);
    if (!card) throw new Error('说明不存在');
    card.review_state = decision;
    card.reviewed_at = decision === 'ai_pending' ? null : stamp();
    this.save();
    return card;
  }

  addUserIssue(input) {
    if (!String(input.text || '').trim()) throw new Error('问题不能为空');
    const issue = { issue_id: id('issue'), operation_id: input.operation_id || null, card_id: input.card_id || null, source: 'user', decision: 'accepted', todo_status: 'open', text: String(input.text).trim(), reason: input.reason || '', evidence: input.evidence || [], created_at: stamp() };
    this.data.issues.push(issue);
    this.save();
    return issue;
  }

  addSupplement(input) {
    const operation = this.data.operations.find((item) => item.operation_id === input.operation_id);
    if (!operation) throw new Error('补充记录缺少有效位置');
    const answers = (Array.isArray(input.answers) ? input.answers : []).slice(0, 6)
      .map((item) => ({ key: String(item.key || '').slice(0, 60), question: String(item.question || '').slice(0, 120), value: String(item.value || '').trim().slice(0, 300) }))
      .filter((item) => item.key && item.question && item.value);
    if (!answers.length) throw new Error('请至少补充一项');
    const supplement = { supplement_id: id('supplement'), operation_id: operation.operation_id, card_id: input.card_id || null, issue_id: input.issue_id || null, answers, source: 'user', created_at: stamp() };
    this.data.supplements.push(supplement);
    this.save();
    writeDocuments(this.outputRoot, this.data);
    return supplement;
  }

  addRule(input) {
    const scope = String(input.scope || '');
    if (!['product', 'technical'].includes(scope)) throw new Error('请选择产品或技术规则');
    const operation = input.operation_id ? this.data.operations.find((item) => item.operation_id === input.operation_id) : null;
    if (input.operation_id && !operation) throw new Error('规则关联的操作不存在');
    const pagePath = String(input.page_path || operation?.page_hint || '');
    if (!pagePath.startsWith('/') || pagePath.includes('..') || pagePath.length > 250) throw new Error('页面位置无效');
    const slot = String(input.slot || '').slice(0, 60);
    const label = String(input.label || '').trim().slice(0, 80);
    const value = String(input.text || '').trim().slice(0, 1200);
    if (!slot || !label || !value) throw new Error('请填写规则位置和内容');
    const prior = this.data.rules.filter((item) => !item.superseded_by && item.scope === scope && item.page_path === pagePath && item.operation_id === (operation?.operation_id || null) && item.slot === slot).at(-1);
    const rule = { rule_id: id('rule'), scope, page_path: pagePath, operation_id: operation?.operation_id || null, slot, label, text: value, previous_text: String(input.previous_text || '').slice(0, 1200), source: 'user', status: 'confirmed', review_status: 'current', source_snapshot_id: this.data.source_snapshot_id, created_at: stamp() };
    if (prior) prior.superseded_by = rule.rule_id;
    this.data.rules.push(rule);
    this.save();
    writeDocuments(this.outputRoot, this.data);
    return rule;
  }

  decideIssue(issueId, decision) {
    if (!['accepted', 'rejected', 'candidate'].includes(decision)) throw new Error('无效的问题状态');
    const issue = this.data.issues.find((item) => item.issue_id === issueId);
    if (!issue) throw new Error('问题不存在');
    issue.decision = decision;
    issue.todo_status = decision === 'accepted' ? (issue.todo_status || 'open') : null;
    issue.reviewed_at = stamp();
    this.save();
    return issue;
  }

  updateTodo(issueId, status) {
    if (!['open', 'in_progress', 'resolved'].includes(status)) throw new Error('无效的待办状态');
    const issue = this.data.issues.find((item) => item.issue_id === issueId && item.decision === 'accepted');
    if (!issue) throw new Error('待办不存在');
    issue.todo_status = status;
    this.save();
    return issue;
  }
}
