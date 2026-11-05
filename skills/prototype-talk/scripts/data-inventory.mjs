// Conservative, evidence-linked project data index. It records code references, not inferred production contracts.
const location = (path, line) => ({ path, line });
const limited = (items, max = 12) => items.slice(0, max);

function requirementSections(documentContents) {
  const sections = [];
  for (const [file, content] of documentContents) {
    if (!/\.md$/i.test(file) || !/(?:prd|需求|产品说明|产品文档|requirement)/i.test(file)) continue;
    const lines = content.split(/\r?\n/);
    const stack = [];
    let current = null;
    const finish = () => {
      if (!current) return;
      current.body = current.body.join('\n').trim().slice(0, 2600);
      sections.push(current);
    };
    for (let index = 0; index < lines.length; index++) {
      const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*$/);
      if (!match) { if (current) current.body.push(lines[index]); continue; }
      finish();
      const level = match[1].length;
      while (stack.length && stack.at(-1).level >= level) stack.pop();
      const title = match[2].replace(/^\d+(?:\.\d+)*[.、]?\s*/, '').trim();
      current = { path: file, line: index + 1, level, title, ancestors: stack.map((item) => item.title), body: [] };
      stack.push({ level, title });
    }
    finish();
  }
  return sections.slice(0, 700);
}

export function buildDataInventory(contentByRelativePath, operations, documentContents = new Map()) {
  const collections = new Map();
  const storage = new Map();
  const requests = [];
  const documentRefs = [];
  const constants = new Map();
  for (const [file, content] of contentByRelativePath) {
    for (const match of content.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])([^'"\n]+)\2/g)) constants.set(`${file}:${match[1]}`, match[3]);
    content.split(/\r?\n/).forEach((line, index) => {
      for (const match of line.matchAll(/\bexport\s+(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\[|\{|new\s+(?:Map|Set)\b)/g)) {
        const item = collections.get(match[1]) || { name: match[1], definitions: [], readers: [], writers: [], storage_keys: [], kind: 'exported_data' };
        item.definitions.push(location(file, index + 1));
        collections.set(match[1], item);
      }
    });
  }
  for (const [file, content] of documentContents) content.split(/\r?\n/).forEach((line, index) => {
    if (/数据来源|数据流|字段|接口|存储|同步|写入|读取|更新|状态/.test(line) && line.trim()) documentRefs.push({ path: file, line: index + 1, excerpt: line.trim().slice(0, 180), status: 'document_pointer' });
  });
  for (const [file, content] of contentByRelativePath) {
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const ref = location(file, index + 1);
      for (const match of line.matchAll(/\b(?:const|let|var)\s+(MOCK_[A-Z0-9_]+)\s*=/g)) {
        const item = collections.get(match[1]) || { name: match[1], definitions: [], readers: [], writers: [], storage_keys: [] };
        item.definitions.push(ref);
        collections.set(match[1], item);
      }
      for (const match of line.matchAll(/\b([A-Za-z_$][\w$]*)\.(find|filter|map|forEach|some|every|reduce|push|splice|pop|shift|unshift|sort)\s*\(/g)) {
        if (!collections.has(match[1]) && !/^MOCK_[A-Z0-9_]+$/.test(match[1])) continue;
        const item = collections.get(match[1]) || { name: match[1], definitions: [], readers: [], writers: [], storage_keys: [] };
        const target = /^(push|splice|pop|shift|unshift|sort)$/.test(match[2]) ? item.writers : item.readers;
        target.push({ ...ref, method: match[2] });
        collections.set(match[1], item);
      }
      for (const match of line.matchAll(/\blocalStorage\.(getItem|setItem|removeItem)\s*\(\s*([^,)]+)/g)) {
        const raw = match[2].trim();
        const resolved = raw.match(/^(['"])(.*?)\1$/)?.[2] || constants.get(`${file}:${raw}`);
        const key = resolved || `<动态键:${raw}>`;
        const item = storage.get(key) || { key, reads: [], writes: [], unresolved_key: !resolved };
        (match[1] === 'getItem' ? item.reads : item.writes).push(ref);
        storage.set(key, item);
        for (const symbol of line.matchAll(/\bMOCK_[A-Z0-9_]+\b/g)) {
          const collection = collections.get(symbol[0]) || { name: symbol[0], definitions: [], readers: [], writers: [], storage_keys: [] };
          if (resolved && !collection.storage_keys.includes(key)) collection.storage_keys.push(key);
          collections.set(symbol[0], collection);
        }
      }
      for (const match of line.matchAll(/\b(?:fetch|axios\.(?:get|post|put|patch|delete))\s*\(\s*(['"`])([^'"`\n]+)\1/g)) {
        requests.push({ url: match[2], ...ref });
      }
    }
  }
  // A collection initialized from browser storage may read the key a few lines below its declaration.
  for (const item of collections.values()) for (const definition of item.definitions) {
    const lines = contentByRelativePath.get(definition.path)?.split(/\r?\n/) || [];
    const window = lines.slice(definition.line - 1, definition.line + 35).join('\n');
    for (const storageItem of storage.values()) if (!storageItem.unresolved_key && storageItem.reads.some((ref) => ref.path === definition.path && ref.line >= definition.line && ref.line <= definition.line + 35) && window.includes('localStorage.getItem')) {
      if (!item.storage_keys.includes(storageItem.key)) item.storage_keys.push(storageItem.key);
    }
  }
  const fields = operations.filter((item) => item.field_meta?.value_bindings?.length || item.option_source).map((item) => ({
    operation_id: item.operation_id, label: item.label, page: item.page_hint,
    value_from: limited((item.field_meta?.value_bindings || []).map((binding) => ({ collection: binding.collection || '', expression: binding.expression, source: binding.source })), 4),
    options_from: item.option_source ? { kind: item.option_source.kind, source: item.option_source.source, count: item.option_source.options.length } : null,
  }));
  const edges = [];
  for (const field of fields) {
    for (const binding of field.value_from) if (binding.collection) edges.push({ from: binding.collection, to: field.operation_id, relation: 'fills_field_value', status: 'source_observed', evidence: binding.source });
    if (field.options_from) edges.push({ from: `${field.options_from.source.path}:${field.options_from.source.line}`, to: field.operation_id, relation: 'provides_options', status: 'source_observed', evidence: field.options_from.source });
  }
  for (const item of collections.values()) for (const key of item.storage_keys) edges.push({ from: `localStorage:${key}`, to: item.name, relation: 'possible_initialization_or_persistence', status: 'candidate', evidence: item.definitions[0] || null });
  return {
    method: 'static_code_index',
    collections: [...collections.values()].sort((a, b) => a.name.localeCompare(b.name)).map((item) => ({ ...item, read_count: item.readers.length, write_count: item.writers.length })),
    storage: [...storage.values()].sort((a, b) => a.key.localeCompare(b.key)),
    requests,
    document_refs: documentRefs,
    document_ref_count: documentRefs.length,
    requirement_sections: requirementSections(documentContents),
    fields,
    edges,
    unresolved_option_count: operations.filter((item) => item.component?.id === 'single_select' && !item.option_source).length,
  };
}

export function dataInventoryMarkdown(inventory, snapshotId) {
  const ref = (item) => item ? `${item.path}:${item.line}` : '未定位';
  const rows = inventory.collections.map((item) => `| ${item.name} | ${ref(item.definitions[0])} | ${item.read_count} | ${item.write_count} | ${item.storage_keys.join('、') || '未关联'} |`).join('\n');
  const stores = inventory.storage.map((item) => `| ${item.key} | ${ref(item.reads[0])} | ${ref(item.writes[0])} |`).join('\n');
  const requests = inventory.requests.map((item) => `| ${item.url.replaceAll('|', '\\|')} | ${ref(item)} |`).join('\n');
  const documents = inventory.document_refs.map((item) => `| ${ref(item)} | ${item.excerpt.replaceAll('|', '\\|')} |`).join('\n');
  const edges = inventory.edges.map((item) => `| ${item.from} | ${item.relation} | ${item.to} | ${item.status === 'candidate' ? '候选' : '源码可见'} | ${ref(item.evidence)} |`).join('\n');
  return `# Prototype Talk · 项目数据索引\n\n源码快照：${snapshotId}\n\n本索引在首次扫描时生成，区分源码事实、文档位置和候选连接；相同名称不代表已确认的数据传递，正式接口仍需核对。\n\n## 数据集合\n\n| 集合 | 定义位置 | 读取次数 | 修改次数 | 关联本地存储 |\n| --- | --- | ---: | ---: | --- |\n${rows || '| 暂无 | | | | |'}\n\n## 浏览器存储\n\n| 键 | 读取位置 | 写入位置 |\n| --- | --- | --- |\n${stores || '| 暂无 | | |'}\n\n## 源码中的请求\n\n| 地址 | 位置 |\n| --- | --- |\n${requests || '| 暂无 | |'}\n\n## 文档中的数据线索（仅定位，尚未解释）\n\n| 位置 | 原文摘要 |\n| --- | --- |\n${documents || '| 暂无 | |'}\n\n## 已定位与候选的数据连接\n\n| 来源 | 关系 | 去向 | 状态 | 依据 |\n| --- | --- | --- | --- | --- |\n${edges || '| 暂无 | | | | |'}\n\n## 尚需追踪\n\n- ${inventory.unresolved_option_count} 个选择器的选项来源未由静态扫描直接定位。\n- 业务对象之间的复制、覆盖或实时引用关系需要沿读写链路核对，不能凭同名字段确认。\n`;
}
