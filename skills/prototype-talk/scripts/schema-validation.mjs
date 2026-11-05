export function validateJsonSchema(value, schema, limit = 12) {
  const errors = [];
  const visit = (item, node, location) => {
    if (errors.length >= limit) return;
    if (node.$ref) {
      const name = node.$ref.match(/^#\/\$defs\/(.+)$/)?.[1];
      if (!name || !schema.$defs?.[name]) { errors.push(`${location}: 未知 schema 引用`); return; }
      visit(item, schema.$defs[name], location);
      return;
    }
    if (node.type === 'object') {
      if (!item || Array.isArray(item) || typeof item !== 'object') { errors.push(`${location}: 应为对象`); return; }
      for (const key of node.required || []) if (!(key in item)) errors.push(`${location}.${key}: 缺少必填项`);
      for (const [key, child] of Object.entries(item)) {
        if (!node.properties?.[key]) { if (node.additionalProperties === false) errors.push(`${location}.${key}: 未定义字段`); }
        else visit(child, node.properties[key], `${location}.${key}`);
      }
    } else if (node.type === 'array') {
      if (!Array.isArray(item)) { errors.push(`${location}: 应为数组`); return; }
      item.forEach((entry, index) => visit(entry, node.items, `${location}[${index}]`));
    } else if (node.type && typeof item !== node.type) errors.push(`${location}: 应为 ${node.type}`);
    if (node.enum && !node.enum.includes(item)) errors.push(`${location}: 值不在允许范围`);
  };
  visit(value, schema, '$');
  return errors.slice(0, limit);
}
