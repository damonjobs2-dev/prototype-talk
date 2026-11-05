// Narrow, evidence-linked page behavior extraction for source-backed list views.
// It records what a handler actually reads or counts; it does not design a production API.

const lineAt = (source, offset) => source.slice(0, offset).split('\n').length;

function closingBrace(source, opening) {
  let depth = 0;
  let mode = 'code';
  for (let index = opening; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (mode === 'line') { if (char === '\n') mode = 'code'; continue; }
    if (mode === 'block') { if (char === '*' && next === '/') { mode = 'code'; index++; } continue; }
    if (mode !== 'code') {
      if (char === '\\') { index++; continue; }
      if (char === mode) mode = 'code';
      continue;
    }
    if (char === '/' && next === '/') { mode = 'line'; index++; continue; }
    if (char === '/' && next === '*') { mode = 'block'; index++; continue; }
    if (char === "'" || char === '"' || char === '`') { mode = char; continue; }
    if (char === '{') depth++;
    if (char === '}' && --depth === 0) return index;
  }
  return -1;
}

function functionsIn(source, path) {
  const functions = new Map();
  for (const match of source.matchAll(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g)) {
    const opening = match.index + match[0].length - 1;
    const end = closingBrace(source, opening);
    if (end < 0) continue;
    // A later declaration at the same page scope takes precedence in the Demo.
    functions.set(match[1], { name: match[1], body: source.slice(opening + 1, end), source: { path, line: lineAt(source, match.index) } });
  }
  return functions;
}

function searchFields(body) {
  const match = body.match(/\[\s*((?:(?:[\w$]+\.)+[\w$]+\s*,?\s*){2,})\]\s*\.some\s*\(/);
  return match ? [...match[1].matchAll(/(?:[\w$]+\.)+[\w$]+/g)].map((item) => item[0]).slice(0, 10) : [];
}

function selectedCollection(body) {
  return [...body.matchAll(/\b(MOCK_[A-Z0-9_]+)\.(?:filter|find|map|some)\s*\(/g)].map((item) => item[1])[0] || '';
}

function renderEvidence(functions, collection) {
  const renderers = [...functions.values()].filter((item) => /^render[\w$]*(?:Table|List|Grid)$/i.test(item.name) && (!collection || item.body.includes(collection)));
  const renderer = renderers.at(-1);
  if (!renderer) return null;
  const count = renderer.body.match(/(?:total|count)[\w$]*\.textContent\s*=\s*['"]共\s*['"]\s*\+\s*([A-Za-z_$][\w$]*)\.length/i);
  const sort = renderer.body.match(/\.sort\s*\([^\n]{0,180}?(?:b\.([\w$]+)[^\n]{0,90}?a\.\1|a\.([\w$]+)[^\n]{0,90}?b\.\2)/);
  return { handler: renderer.name, source: renderer.source, count_variable: count?.[1] || '', sort_field: sort?.[1] || sort?.[2] || '' };
}

function collectionOrigin(collectionName, inventory, contentByRelativePath) {
  const collection = inventory.collections.find((item) => item.name === collectionName);
  if (!collection) return null;
  const definition = collection.definitions[0] || null;
  const source = definition && contentByRelativePath.get(definition.path) || '';
  const defaultName = collectionName.replace(/^MOCK_/, '_DEFAULT_');
  const defaultSamples = source.includes(defaultName) && source.includes(`append(${defaultName}`);
  return { name: collectionName, definition, storage_keys: collection.storage_keys.slice(0, 4), default_samples: defaultSamples };
}

export function analyzePageBehaviors(contentByRelativePath, operations, inventory) {
  const byPage = new Map();
  for (const operation of operations) {
    const handler = operation.anchor?.onclick?.match(/^\s*([A-Za-z_$][\w$]*)\s*\(/)?.[1];
    if (!handler || !/^(?:search|query|filter|reset)/i.test(handler)) continue;
    const path = operation.anchor?.source?.path;
    if (!path || !contentByRelativePath.has(path)) continue;
    const item = byPage.get(path) || { path, actions: [], render: null, collection: null };
    item.actions.push({ operation_id: operation.operation_id, label: operation.label, handler });
    byPage.set(path, item);
  }
  for (const page of byPage.values()) {
    const source = contentByRelativePath.get(page.path);
    const functions = functionsIn(source, page.path);
    page.actions = page.actions.map((action) => {
      const target = functions.get(action.handler);
      if (!target) return { ...action, source: null, evidence_status: 'handler_not_resolved' };
      const collection = selectedCollection(target.body);
      const fields = searchFields(target.body);
      const helpers = [...target.body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map((item) => item[1]).filter((name) => /^_[A-Za-z_$]/.test(name) && /(?:Match|Status|Row)/.test(name)).slice(0, 8);
      return { ...action, source: target.source, collection, search_fields: fields, helpers: [...new Set(helpers)], evidence_status: 'source_observed' };
    });
    const collectionName = page.actions.find((action) => action.collection)?.collection || '';
    page.render = collectionName ? renderEvidence(functions, collectionName) : null;
    page.collection = collectionOrigin(collectionName, inventory, contentByRelativePath);
  }
  return [...byPage.values()];
}
