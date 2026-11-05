import crypto from 'node:crypto';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
const clean = (value) => String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
const lineAt = (content, offset) => content.slice(0, offset).split('\n').length;
const uiOnly = (label, key) => /^(_seq|_action)$/.test(key || '') || /^(序号|操作|选择)$/.test(label);

export function fieldId(pagePath, kind, identity) { return `ui_${hash(`${pagePath}|${kind}|${identity}`)}`; }

export function extractDisplayFields(contents) {
  const fields = [];
  const seen = new Set();
  const add = ({ pagePath, kind, label, key = '', visible = null, section = '', controlType = '', evidence, source = 'source_scan', candidates = [] }) => {
    if (!label || /\$\{|['"`]\s*\+|[{}]/.test(label)) return;
    const id = fieldId(pagePath, kind, key || label);
    if (seen.has(id)) return;
    seen.add(id);
    fields.push({ field_id: id, page_path: pagePath, kind, label, section, control_type: controlType, source_key: key, default_visible: visible, ui_only: uiOnly(label, key), evidence: evidence ? [evidence] : [], binding_candidates: candidates, source, status: 'current' });
  };
  for (const [file, content] of contents) {
    if (/\.(?:jsx|tsx)$/.test(file)) {
      const pagePath = '/index.html';
      for (const match of content.matchAll(/<label\b[^>]{0,180}>\s*([^<]{1,60})\s*<(Input|input|Select|select|Textarea|textarea)\b/g)) {
        add({ pagePath, kind: 'form_field', label: clean(match[1]), controlType: match[2].toLowerCase(), evidence: { path: file, line: lineAt(content, match.index) } });
      }
      for (const match of content.matchAll(/<div\b[^>]*className=["'][^"']*setting-row[^"']*["'][^>]*>[\s\S]{0,280}?<strong>([^<]{1,60})<\/strong>[\s\S]{0,220}?<Switch\b/g)) {
        add({ pagePath, kind: 'form_field', label: clean(match[1]), controlType: 'switch', evidence: { path: file, line: lineAt(content, match.index) } });
      }
      continue;
    }
    if (!file.endsWith('.html')) continue;
    const pagePath = `/${file}`;
    // Column configurations include hidden-but-available columns that a screenshot misses.
    for (const block of content.matchAll(/\b(?:const|let|var)\s+(\w*COLUMNS\w*)\s*=\s*\[([\s\S]*?)\];/g)) {
      for (const row of block[2].matchAll(/\{([^{}]{0,500})\}/g)) {
        const key = row[1].match(/\bkey\s*:\s*['"]([^'"]+)['"]/)?.[1] || '';
        const label = row[1].match(/\btitle\s*:\s*['"]([^'"]+)['"]/)?.[1] || '';
        if (!key || !label) continue;
        const expressions = key.startsWith('_') ? [] : [...new Set([...content.matchAll(/\b[A-Za-z_$][\w$]*\.([A-Za-z_$][\w$]*)/g)].map((match) => match[1]).filter((name) => name === key || name.startsWith(key) && name.length <= key.length + 8))].slice(0, 3);
        add({ pagePath, kind: 'table_column', label: clean(label), key, visible: !/\bvisible\s*:\s*false\b/.test(row[1]), section: block[1], candidates: expressions.map((name) => ({ expression: name, status: 'candidate' })), evidence: { path: file, line: lineAt(content, block.index + row.index), excerpt: `key: ${key}` } });
      }
    }
    for (const match of content.matchAll(/<(th|label|dt)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      const label = clean(match[2]);
      if (!label || label.length > 45 || /^(请选择|请输入)/.test(label)) continue;
      const kind = match[1].toLowerCase() === 'th' ? 'table_column' : match[1].toLowerCase() === 'dt' ? 'detail_field' : 'form_field';
      if (kind === 'form_field' && /^(前往\s*页|每页条数|全选)$/.test(label)) continue;
      // A configured column and its rendered <th> are the same product field.
      if (kind === 'table_column' && fields.some((field) => field.page_path === pagePath && field.kind === kind && field.label === label)) continue;
      add({ pagePath, kind, label, evidence: { path: file, line: lineAt(content, match.index) } });
    }
  }
  return fields;
}

export function mergeRuntimeFields(existing, incoming, snapshotId) {
  const next = [...existing];
  for (const raw of incoming) {
    const pagePath = String(raw.page_path || '');
    const label = clean(raw.label);
    if (!pagePath.startsWith('/') || !label || !['table_column', 'form_field', 'detail_field', 'display_value'].includes(raw.kind)) continue;
    const found = next.find((item) => item.page_path === pagePath && item.kind === raw.kind && item.label === label && (!raw.key || item.source_key === raw.key) && item.status !== 'removed' && (!raw.usage || item.observed_usage === raw.usage || !item.observed_usage && item.source === 'source_scan'));
    if (found) { found.runtime_visible = raw.visible !== false; if (!found.observed_sample && raw.sample) found.observed_sample = clean(raw.sample); if (['filter', 'form', 'display'].includes(raw.usage)) found.observed_usage = raw.usage; found.last_seen_snapshot_id = snapshotId; continue; }
    const fieldIdValue = fieldId(pagePath, raw.kind, raw.key || `${label}|${raw.usage || ''}`);
    if (next.some((item) => item.field_id === fieldIdValue)) continue;
    next.push({ field_id: fieldIdValue, page_path: pagePath, kind: raw.kind, label, source_key: '', default_visible: null, runtime_visible: raw.visible !== false, observed_sample: clean(raw.sample), observed_usage: ['filter', 'form', 'display'].includes(raw.usage) ? raw.usage : null, ui_only: uiOnly(label, ''), evidence: [], source: 'runtime_observed', status: 'current', last_seen_snapshot_id: snapshotId });
  }
  return next;
}
