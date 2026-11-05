import crypto from 'node:crypto';

const generic = /^(?:button|input|select|textarea|a|div|span|i|li|default|custom|关闭|收起|展开|[+\-×])$/i;
const dynamic = /\$\{|['"`]\s*\+|\+\s*[\w$]/;

function handlerIdentity(operation) {
  const anchor = operation.anchor || {};
  if (anchor.onclick) return `inline:${anchor.onclick.replace(/\s+/g, '')}`;
  if (anchor.href && anchor.href !== '#') return `href:${anchor.href}`;
  const dataKeys = Object.keys(anchor.data || {});
  const related = (operation.related_code || []).find((ref) => dataKeys.some((key) =>
    ref.excerpt?.includes(`[${key}]`) || ref.excerpt?.includes(`['${key}']`) || ref.excerpt?.includes(`["${key}"]`)));
  return related ? `delegated:${related.path}:${related.line}` : '';
}

function signature(operation, templateIds) {
  if (operation.template_operation_id) return `template:${operation.template_operation_id}`;
  if (templateIds.has(operation.operation_id)) return `template:${operation.operation_id}`;
  if (!['click', 'submit'].includes(operation.trigger) || generic.test(operation.label || '') || dynamic.test(operation.label || '')) return `single:${operation.operation_id}`;
  const handler = handlerIdentity(operation);
  if (!handler) return `single:${operation.operation_id}`;
  const data = Object.entries(operation.anchor?.data || {}).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, dynamic.test(value) ? '<runtime-value>' : value]);
  return JSON.stringify([operation.page_hint, operation.anchor?.source?.path || '', operation.tag, operation.trigger, operation.component?.id || '', operation.label, handler, data]);
}

export function groupOperationFamilies(operations) {
  const templateIds = new Set(operations.map((item) => item.template_operation_id).filter(Boolean));
  const groups = new Map();
  for (const operation of operations) {
    const key = signature(operation, templateIds);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(operation);
  }
  return [...groups.entries()].map(([key, members]) => ({
    family_id: `family_${crypto.createHash('sha256').update(key).digest('hex').slice(0, 12)}`,
    representative_id: members.find((item) => item.discovered_by?.includes('runtime'))?.operation_id || members[0].operation_id,
    page_hint: members[0].page_hint,
    label: members.find((item) => item.discovered_by?.includes('runtime'))?.label || members[0].label,
    member_ids: members.map((item) => item.operation_id),
    count: members.length,
    basis: key.startsWith('template:') ? 'source_template' : key.startsWith('single:') ? 'unique_control' : 'same_handler_and_context',
  }));
}
