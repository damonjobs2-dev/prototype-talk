import fs from 'node:fs';
import path from 'node:path';

const MAX_LINES = 6;
const MAX_CARDS = 10;
const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();

function sourceKind(file) {
  return /(?:prd|需求|规范|说明|评审)/i.test(path.basename(file)) && /\.(?:md|txt|docx?)$/i.test(file) ? 'requirement' : 'demo';
}

function readReference(root, reference) {
  const match = String(reference || '').match(/^(.+?):(\d+)(?:-(\d+))?$/);
  if (!match) return null;
  const file = match[1].replace(/^\/+/, '');
  const start = Number(match[2]);
  const end = Number(match[3] || match[2]);
  if (!start || end < start || end - start > 500 || file.startsWith('docs/prototype-talk/')) return null;
  const absolute = path.resolve(root, file);
  if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return null;
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(absolute);
  if (!realFile.startsWith(`${realRoot}${path.sep}`)) return null;
  if (!/\.(?:md|txt|html?|jsx?|tsx?|css|json)$/i.test(file) || fs.statSync(realFile).size > 2_000_000) return null;
  const lines = fs.readFileSync(realFile, 'utf8').split(/\r?\n/);
  if (start > lines.length) return { kind: sourceKind(file), path: file, start, end, excerpt: '', missing: true };
  const shownEnd = Math.min(end, start + MAX_LINES - 1, lines.length);
  return { kind: sourceKind(file), path: file, start, end, excerpt: lines.slice(start - 1, shownEnd).join('\n').slice(0, 950), truncated: end > shownEnd };
}

function uniqueSources(root, refs) {
  const rows = refs.map((item) => { const row = readReference(root, typeof item === 'string' ? item : item.ref); return row && { ...row, context: typeof item === 'string' ? '' : item.context || '' }; }).filter(Boolean);
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.kind}\n${clean(row.excerpt)}`;
    const existing = groups.get(key);
    const location = { path: row.path, start: row.start, end: row.end, context: row.context, missing: !!row.missing };
    if (existing) {
      if (!existing.locations.some((item) => item.path === location.path && item.start === location.start && item.end === location.end)) existing.locations.push(location);
    } else groups.set(key, { kind: row.kind, excerpt: row.excerpt, truncated: !!row.truncated, locations: [location] });
  }
  return [...groups.values()];
}

function matchingRequirements(data, root, label, context) {
  if (!label || label.length < 2) return [];
  const sections = (data.data_inventory?.requirement_sections || []).filter((item) => /(?:prd|需求|规范|说明|评审)/i.test(item.path) && (item.title.includes(label) || item.body.includes(label)));
  const ranked = sections.map((item) => ({ item, score: (item.title.includes(context) && context ? 5 : 0) + (item.ancestors || []).some((part) => String(part).includes(context) && context) * 3 + item.title.includes(label) * 2 + (item.body.includes(label) ? 1 : 0) })).sort((a, b) => b.score - a.score);
  const refs = [];
  for (const { item } of ranked.slice(0, 3)) {
    const absolute = path.resolve(root, item.path);
    if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`) || !fs.existsSync(absolute)) continue;
    const lines = fs.readFileSync(absolute, 'utf8').split(/\r?\n/);
    const from = Math.max(0, item.line - 1);
    const sectionEnd = Math.min(lines.length, from + 1 + item.body.split(/\r?\n/).length);
    const found = lines.map((line, index) => ({ line, index })).filter(({ line, index }) => index > from && index < sectionEnd && line.includes(label)).slice(0, 2);
    for (const { index } of found) refs.push({ ref: `${item.path}:${index + 1}`, context: item.title });
    if (refs.length >= 6) break;
  }
  return refs;
}

function specificRequirementRefs(data, root, label) {
  if (!label || label.length < 2) return [];
  const files = [...new Set((data.data_inventory?.requirement_sections || []).map((item) => item.path))];
  const refs = [];
  for (const file of files) {
    const absolute = path.resolve(root, file);
    if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`) || !fs.existsSync(absolute)) continue;
    for (const [index, line] of fs.readFileSync(absolute, 'utf8').split(/\r?\n/).entries()) {
      if (line.trim().startsWith(`新建${label}`) || line.trim().startsWith(`创建${label}`)) refs.push({ ref: `${file}:${index + 1}`, context: label });
    }
  }
  return refs.slice(0, 2);
}

function runtimeObservation(data, operationId) {
  const trace = (data.traces || []).filter((item) => item.operation_id === operationId && item.source_snapshot_id === data.source_snapshot_id).at(-1);
  if (!trace) return null;
  const beforeRoute = trace.before?.route || '';
  const afterRoute = trace.after?.route || '';
  const beforeDialogs = trace.before?.dialogs || [];
  const afterDialogs = trace.after?.dialogs || [];
  const changed = beforeRoute !== afterRoute || trace.before?.visible_text !== trace.after?.visible_text || JSON.stringify(beforeDialogs) !== JSON.stringify(afterDialogs);
  const action = ({ click: '点击', input: '输入', change: '选择', submit: '提交' })[trace.trigger] || '操作';
  const card = (data.cards || []).filter((item) => item.operation_id === operationId && item.source_snapshot_id === data.source_snapshot_id).at(-1);
  const observedEffect = card?.expected_effects?.find((item) => item.origin === 'runtime_observed' && item.evidence_audit?.valid?.length)?.change;
  const result = beforeRoute !== afterRoute ? `页面从 ${beforeRoute} 进入 ${afterRoute}` : afterDialogs.length > beforeDialogs.length ? `出现弹窗：${clean(afterDialogs.at(-1)).slice(0, 90)}` : changed ? observedEffect || '页面可见内容发生变化；具体业务结果仍需核对' : '已记录操作，尚未捕捉到可验证的页面变化';
  return { action, result, recorded_at: trace.recorded_at, trace_id: trace.trace_id, changed };
}

export function buildEvidenceView(data, root, { operationId = '', pagePath = '', context = '', scope = 'current' } = {}) {
  const operation = scope === 'current' ? data.operations.find((item) => item.operation_id === operationId) : null;
  const page = pagePath || operation?.page_hint || '';
  const card = operation && (data.cards || []).filter((item) => item.operation_id === operation.operation_id && item.source_snapshot_id === data.source_snapshot_id).at(-1);
  const cards = [];
  if (operation) {
    const documentedRefs = (card?.claims || []).filter((item) => item.origin === 'documented').flatMap((item) => item.evidence_audit?.valid || []).slice(0, 5);
    const specificRefs = specificRequirementRefs(data, root, operation.label);
    const requirementRefs = [...documentedRefs, ...(documentedRefs.length || specificRefs.length ? specificRefs : matchingRequirements(data, root, operation.label, context))].slice(0, 8);
    const handler = operation.anchor?.onclick?.match(/^([A-Za-z_$][\w$]*)\s*\(/)?.[1];
    const implementation = handler && (operation.related_code || []).find((item) => item.excerpt?.includes(`function ${handler}`));
    const demoRefs = [operation.anchor?.source && { ...operation.anchor.source, start: Math.max(1, operation.anchor.source.line - 2), end: operation.anchor.source.line + 1 }, implementation && { ...implementation, start: implementation.line, end: implementation.line + 5 }, ...(operation.field_meta?.value_bindings || []).flatMap((item) => [item.lookup, item.source, item.collection_source])].filter(Boolean).map((item) => `${item.path}:${item.start || item.line}${item.end ? `-${item.end}` : ''}`);
    demoRefs.push(...(card?.claims || []).filter((item) => item.origin === 'source_observed').flatMap((item) => item.evidence_audit?.valid || []).slice(0, 8));
    cards.push({ id: `operation:${operation.operation_id}`, title: operation.label, type: 'comparison', note: '按来源对照当前功能；资料出现不等于规则已通过验证。', sources: uniqueSources(root, [...requirementRefs, ...demoRefs]), runtime: runtimeObservation(data, operation.operation_id), stale: operation.source_snapshot_id !== data.source_snapshot_id });
    const grouped = new Map();
    for (const claim of (card?.claims || []).filter((item) => item.confirmation_state !== 'rejected')) {
      const key = clean(claim.text);
      if (!grouped.has(key)) grouped.set(key, { text: claim.text, refs: [], invalid_refs: [], states: [] });
      grouped.get(key).refs.push(...(claim.evidence || []));
      grouped.get(key).invalid_refs.push(...(claim.evidence_audit?.invalid || []));
      grouped.get(key).states.push(claim.confirmation_state || 'pending');
    }
    for (const [index, item] of [...grouped.values()].slice(0, MAX_CARDS - 1).entries()) cards.push({ id: `claim:${index}`, title: item.text, type: 'claim', note: item.states.every((value) => value === 'confirmed') ? '说明已由评审核对；各来源仍需分别检查。' : '模型整理的判断，尚待逐项核对。', sources: uniqueSources(root, item.refs), invalid_refs: [...new Set(item.invalid_refs)], runtime: null, stale: card.source_snapshot_id !== data.source_snapshot_id });
  } else {
    const spec = (data.page_specs || []).filter((item) => item.path === page && item.source_snapshot_id === data.source_snapshot_id).at(-1);
    const facts = [...(spec?.functions || []).map((item) => ({ title: `${item.name}：${item.outcome}`, refs: item.evidence || [] })), ...(spec?.states || []).map((item) => ({ title: item.text, refs: item.evidence || [] })), ...(spec?.data || []).map((item) => ({ title: item.text, refs: item.evidence || [] }))];
    for (const [index, fact] of facts.slice(0, MAX_CARDS).entries()) cards.push({ id: `page:${index}`, title: fact.title, type: 'claim', note: '页面初稿，按来源核对。', sources: uniqueSources(root, fact.refs), runtime: null, stale: false });
    if (!cards.length) cards.push({ id: 'page:overview', title: page || '当前页面', type: 'comparison', note: '点击页面中的具体操作，可查看该功能的 PRD、源码与实际操作对照。', sources: [], runtime: null, stale: false });
  }
  return { page_path: page, operation_id: operation?.operation_id || null, source_snapshot_id: data.source_snapshot_id, cards };
}
