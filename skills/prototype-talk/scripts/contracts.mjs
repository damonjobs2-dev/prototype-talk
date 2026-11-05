const contractSlots = new Set(['api_name', 'method_path', 'request', 'response', 'auth', 'errors']);

export function interfaceContract(data, pagePath, operationId = null) {
  const rules = (data.rules || []).filter((item) => item.scope === 'technical' && item.page_path === pagePath && (item.operation_id || null) === operationId && !item.superseded_by && contractSlots.has(item.slot));
  const fields = (data.api_fields || []).filter((item) => item.page_path === pagePath && (item.operation_id || null) === operationId && !item.removed_at);
  const decisions = Object.fromEntries(rules.map((item) => [item.slot, item]));
  const missing = [];
  if ((rules.length || fields.length) && !decisions.method_path) missing.push('方法与路径');
  if (fields.some((item) => item.direction !== 'response') && !decisions.request) missing.push('请求整体约束');
  if (fields.some((item) => item.direction === 'response') && !decisions.response) missing.push('响应包裹与状态码');
  if ((rules.length || fields.length) && !decisions.auth) missing.push('权限与认证');
  if ((rules.length || fields.length) && !decisions.errors) missing.push('异常与重试');
  if (rules.some((item) => item.review_status === 'prototype_changed') || fields.some((item) => item.review_status === 'prototype_changed')) missing.push('原型变化后的复核');
  return {
    contract_id: operationId ? `operation:${operationId}` : `page:${pagePath}`,
    page_path: pagePath, operation_id: operationId, decisions, fields,
    status: !rules.length && !fields.length ? 'unstarted' : missing.length ? 'draft' : 'ready_for_review',
    missing,
  };
}

export function activeInterfaceContracts(data) {
  const scopes = new Map();
  for (const item of [...(data.rules || []).filter((rule) => rule.scope === 'technical' && contractSlots.has(rule.slot) && !rule.superseded_by), ...(data.api_fields || []).filter((field) => !field.removed_at)]) {
    const key = `${item.page_path}\n${item.operation_id || ''}`;
    scopes.set(key, { pagePath: item.page_path, operationId: item.operation_id || null });
  }
  return [...scopes.values()].map(({ pagePath, operationId }) => interfaceContract(data, pagePath, operationId));
}
