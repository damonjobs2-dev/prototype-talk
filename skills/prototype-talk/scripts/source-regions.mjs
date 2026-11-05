import crypto from 'node:crypto';
import path from 'node:path';
import babelParser from './vendor/babel-parser/index.cjs';

const idFor = (value) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
const lineAt = (text, offset) => text.slice(0, offset).split('\n').length;
const clean = (text) => String(text || '').replace(/\s+/g, ' ').trim();
const displayNames = { title: '标题', name: '名称', user: '用户名称', platform: '平台', movement: '升温幅度', onListTime: '在榜时长', period: '周期', rank: '排名', heat: '热度', signal: '提示信息', type: '类型', label: '选项名称', n: '数量', total: '总数', pos: '正向数', neu: '中性数', neg: '负向数', sens: '敏感数', sent: '敏感数', updatedAt: '更新时间', monitorPlanCount: '监测方案数', unreadWarnings: '未读预警数', unreadAlerts: '未读预警数' };

function sourceFields(text, file, pagePath) {
  let ast;
  try { ast = babelParser.parse(text, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'], errorRecovery: true }); }
  catch { return []; }
  const fields = new Map();
  const snippet = (node) => clean(text.slice(node.start, node.end)).slice(0, 100);
  const add = (key, node, condition, nearby = '', selector = '') => {
    if (!key || /^(?:id|key|className|style|map|filter|slice|find|some|every|includes|length|join|padStart|toFixed)$/.test(key.split('.').at(-1)) || /^(?:Number|String|Math)$/.test(key)) return;
    const property = key.split('.').at(-1);
    const label = displayNames[property] || (nearby && nearby.length <= 12 ? nearby : property);
    const identity = `${pagePath}|display_value|${key}`;
    const existing = fields.get(identity);
    if (existing) { if (!condition) existing.source_conditions = []; else if (existing.source_conditions.length && !existing.source_conditions.includes(condition)) existing.source_conditions.push(condition); if (selector && !existing.dom_candidates.some((item) => item.selector === selector)) existing.dom_candidates.push({ selector, condition }); return; }
    fields.set(identity, { field_id: `ui_${idFor(identity)}`, page_path: pagePath, kind: 'display_value', label, section: '页面展示', control_type: '', source_key: key, default_visible: null, ui_only: false, evidence: [{ path: file, line: node.loc?.start.line || lineAt(text, node.start), excerpt: key }], binding_candidates: [], source: 'source_scan', status: 'current', source_conditions: condition ? [condition] : [], dom_candidates: selector ? [{ selector, condition }] : [] });
  };
  function dataRefs(node, condition, nearby = '', selector = '') {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'JSXElement') { visit(node, condition, selector); return; }
    if (node.type === 'CallExpression') {
      if (node.callee?.type === 'Identifier' && /^(?:icon|svg|iconHtml)$/i.test(node.callee.name)) return;
      for (const argument of node.arguments || []) dataRefs(argument, condition, nearby, selector);
      return;
    }
    if (node.type === 'MemberExpression' && !node.computed && node.object?.type === 'Identifier' && node.property?.type === 'Identifier') {
      if (!/^(?:event|e|window|document|console|Math|Date)$/.test(node.object.name)) add(`${node.object.name}.${node.property.name}`, node, condition, nearby, selector);
      return;
    }
    if (node.type === 'Identifier' && !/^(?:item|index|type|true|false|undefined|null)$/.test(node.name) && nearby) {
      add(node.name, node, condition, nearby, selector);
      return;
    }
    if (node.type === 'ConditionalExpression') {
      const test = snippet(node.test);
      dataRefs(node.consequent, [condition, test].filter(Boolean).join(' && '), nearby, selector);
      dataRefs(node.alternate, [condition, `!(${test})`].filter(Boolean).join(' && '), nearby, selector);
      return;
    }
    if (node.type === 'LogicalExpression' && node.operator === '&&') {
      dataRefs(node.right, [condition, snippet(node.left)].filter(Boolean).join(' && '), nearby, selector);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'comments' || key === 'extra') continue;
      if (Array.isArray(value)) { for (const child of value) if (child?.type) dataRefs(child, condition, nearby, selector); }
      else if (value?.type) dataRefs(value, condition, nearby, selector);
    }
  }
  function visit(node, condition = '', parentSelector = '') {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ConditionalExpression') {
      const test = snippet(node.test);
      visit(node.consequent, [condition, test].filter(Boolean).join(' && '), parentSelector);
      visit(node.alternate, [condition, `!(${test})`].filter(Boolean).join(' && '), parentSelector);
      return;
    }
    if (node.type === 'LogicalExpression' && node.operator === '&&') {
      visit(node.right, [condition, snippet(node.left)].filter(Boolean).join(' && '), parentSelector);
      return;
    }
    if (node.type === 'IfStatement') {
      const test = snippet(node.test);
      visit(node.consequent, [condition, test].filter(Boolean).join(' && '), parentSelector);
      if (node.alternate) visit(node.alternate, [condition, `!(${test})`].filter(Boolean).join(' && '), parentSelector);
      return;
    }
    if (node.type === 'TemplateLiteral' && node.quasis.some((item) => /<\/?[a-z]/i.test(item.value.raw))) {
      let previous = '';
      for (let index = 0; index < node.expressions.length; index++) {
        previous += node.quasis[index]?.value.raw || '';
        const open = previous.lastIndexOf('<') > previous.lastIndexOf('>');
        if (!open) {
          const tags = [...previous.matchAll(/<\/?([a-z][\w-]*)([^>]*)>/gi)];
          const stack = [];
          for (const tag of tags) {
            if (previous[tag.index + 1] === '/') { const at = stack.findLastIndex((item) => item.tag === tag[1]); if (at >= 0) stack.splice(at); }
            else if (!tag[0].endsWith('/>')) stack.push({ tag: tag[1], className: tag[2].match(/\bclass\s*=\s*['"]([^'"]+)/)?.[1]?.split(/\s+/)[0] || '' });
          }
          const last = stack.at(-1);
          const classes = stack.filter((item) => item.className).slice(-2).map((item) => `.${item.className}`);
          const selector = `${classes.join(' ')}${last && !last.className && classes.length ? ` ${last.tag}` : ''}`.trim();
          const nearby = clean(previous.split(/<[^>]*>/).at(-1)).slice(-12);
          dataRefs(node.expressions[index], condition, nearby, selector);
        }
        visit(node.expressions[index], condition, parentSelector);
        previous += '…';
      }
      return;
    }
    if (node.type === 'JSXElement') {
      const tag = node.openingElement?.name?.name || '';
      const classAttr = node.openingElement?.attributes?.find((item) => item.type === 'JSXAttribute' && item.name?.name === 'className');
      const classText = classAttr?.value?.type === 'StringLiteral' ? classAttr.value.value : classAttr?.value?.expression?.type === 'TemplateLiteral' ? classAttr.value.expression.quasis?.[0]?.value?.raw : '';
      const firstClass = classText?.match(/[A-Za-z][\w-]*/)?.[0] || '';
      const ownSelector = firstClass ? `.${firstClass}` : parentSelector && /^[a-z][\w-]*$/i.test(tag) ? `${parentSelector} ${tag}` : parentSelector;
      let nearby = '';
      for (const child of node.children || []) {
        if (child.type === 'JSXText') nearby = clean(child.value).slice(-12);
        else if (child.type === 'JSXExpressionContainer') { dataRefs(child.expression, condition, nearby, ownSelector); visit(child.expression, condition, ownSelector); }
        else visit(child, condition, ownSelector);
      }
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'comments' || key === 'extra') continue;
      if (Array.isArray(value)) { for (const child of value) if (child?.type) visit(child, condition, parentSelector); }
      else if (value?.type) visit(value, condition, parentSelector);
    }
  }
  visit(ast.program);
  return [...fields.values()].slice(0, 100);
}

// This is a conservative source graph. Dynamic handlers keep candidate edges and
// conditions; the browser trace later establishes which edge actually ran.
export function buildSourceRegions(contents) {
  const entries = [...contents];
  const regions = [];
  const links = [];
  const fields = [];
  for (const [file, source] of entries) {
    if (!file.endsWith('.html')) continue;
    const pagePath = `/${file}`;
    const title = clean(source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || path.posix.basename(file));
    regions.push({ region_id: pagePath, kind: 'page', label: title, page_path: pagePath, source: [{ path: file, line: 1 }], status: 'source_inferred' });
    for (const match of source.matchAll(/<a\b([^>]*\bhref\s*=\s*['"][^'"]+['"][^>]*)>([\s\S]*?)<\/a>/gi)) {
      const href = match[1].match(/\bhref\s*=\s*['"]([^'"]+)['"]/i)?.[1] || '';
      if (!href || /^(?:https?:|javascript:|#)/i.test(href)) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(pagePath), href.split(/[?#]/)[0]));
      if (!target.startsWith('/') || !target.endsWith('.html')) continue;
      const label = clean(match[2].replace(/<[^>]*>/g, ' '));
      if (label) links.push({ trigger_label: label, target_region_id: target, condition: '链接导航', evidence: [{ path: file, line: lineAt(source, match.index) }], status: 'source_inferred' });
    }
  }
  for (const [file, source] of entries) {
    if (!/\.(?:js|mjs|ts)$/.test(file) || !/location\.hash|parseHash\(/.test(source)) continue;
    for (const match of source.matchAll(/if\s*\((path\s*===\s*['"][^'"]+['"](?:\s*\|\|\s*path\s*===\s*['"][^'"]+['"])?)\)\s*return\s*\{\s*html:\s*(\w+)\([^)]*\)[^}]*?title:\s*['"]([^'"]+)['"]/g)) {
      const [, condition, renderer, label] = match;
      const pagePath = [...condition.matchAll(/path\s*===\s*['"](\/[\w-]*)['"]/g)].map((item) => item[1]).find((item) => item !== '/') || '/';
      const imported = source.match(new RegExp(`import\\s*\\{[^}]*\\b${renderer}\\b[^}]*\\}\\s*from\\s*['"]([^'"]+)['"]`))?.[1]?.split('?')[0];
      const importBase = imported ? path.posix.normalize(path.posix.join(path.posix.dirname(file), imported)) : file;
      const sourceFile = contents.has(importBase) ? importBase : file;
      const renderLine = (contents.get(sourceFile) || source).search(new RegExp(`\\bfunction\\s+${renderer}\\b`));
      regions.push({ region_id: pagePath, kind: 'page', label, page_path: pagePath, source: [{ path: file, line: lineAt(source, match.index) }, { path: sourceFile, line: renderLine < 0 ? 1 : lineAt(contents.get(sourceFile) || source, renderLine) }], component: renderer, status: 'source_inferred' });
      links.push({ trigger_label: label, target_region_id: pagePath, condition: `路由 = '${pagePath}'`, evidence: [{ path: file, line: lineAt(source, match.index) }], status: 'source_inferred' });
      fields.push(...sourceFields(contents.get(sourceFile) || source, sourceFile, pagePath));
    }
  }
  for (const [file, source] of entries) {
    if (!/URLSearchParams\(location\.search\)\.get\(['"]screen['"]\)/.test(source)) continue;
    const tabs = source.match(/const\s+\w*[Tt]abs\s*=\s*\[([\s\S]{0,1600}?)\]/)?.[1] || '';
    const navigation = source.match(/const\s+navigation\s*=\s*[^;]{0,300}?\[([\s\S]{0,1600}?)\];/)?.[1] || '';
    const tabsAt = source.indexOf(tabs);
    const navigationAt = source.indexOf(navigation);
    const mapping = source.match(/const\s+topLevel\s*=\s*\{([^}]+)\}\[tab\]/)?.[1] || '';
    for (const match of tabs.matchAll(/\{\s*id:\s*['"]([a-z][a-z0-9_-]*)['"]\s*,\s*label:\s*['"]([^'"]+)['"]/gi)) {
      const [, screen, label] = match;
      const variable = mapping.match(new RegExp(`\\b${screen}\\s*:\\s*(\\w+)`))?.[1];
      if (!variable) continue;
      const pagePath = `/?screen=${screen}`;
      const declaration = new RegExp(`\\bconst\\s+${variable}\\s*=\\s*<([A-Z][\\w]*)`).exec(source);
      const component = declaration?.[1] || '';
      const imported = component && source.match(new RegExp(`import\\s+${component}\\s+from\\s+['"]([^'"]+)['"]`))?.[1];
      const importBase = imported ? path.posix.normalize(path.posix.join(path.posix.dirname(file), imported)) : '';
      const componentFile = importBase ? [importBase, `${importBase}.jsx`, `${importBase}.tsx`, `${importBase}/index.jsx`, `${importBase}/index.tsx`].find((candidate) => contents.has(candidate)) || file : file;
      const componentSource = contents.get(componentFile) || source;
      const componentAt = componentSource.search(new RegExp(`(?:function|const)\\s+${component || variable}\\b`));
      const aliasEntries = [...navigation.matchAll(new RegExp(`\\{\\s*id:\\s*['"]${screen}['"]\\s*,\\s*label:\\s*['"]([^'"]+)['"]`, 'g'))].map((item) => ({ label: item[1], line: lineAt(source, navigationAt + item.index) }));
      const aliases = aliasEntries.map((item) => item.label);
      const tabLine = lineAt(source, tabsAt + match.index);
      const region = { region_id: pagePath, kind: 'page', label, aliases, page_path: pagePath, source: [{ path: file, line: tabLine }, { path: componentFile, line: componentAt < 0 ? 1 : lineAt(componentSource, componentAt) }], component: component || variable, status: 'source_inferred' };
      regions.push(region);
      const handlerNames = [...new Set([...source.matchAll(/on(?:Press|Click)\s*=\s*\{\(\)\s*=>\s*(\w+)\(id\)\}/g)].map((item) => item[1]))];
      const handlerChain = handlerNames.flatMap((name) => { const at = source.search(new RegExp(`\\bconst\\s+${name}\\s*=`)); return at < 0 ? [] : [{ name, path: file, line: lineAt(source, at) }]; });
      const goAt = source.search(/\bconst\s+go\s*=/);
      if (handlerChain.some((item) => source.slice(source.indexOf(`const ${item.name} =`), source.indexOf(`const ${item.name} =`) + 240).includes('go(')) && goAt >= 0) handlerChain.push({ name: 'go', path: file, line: lineAt(source, goAt) });
      for (const triggerLabel of [...new Set([label, ...aliases])]) links.push({ trigger_label: triggerLabel, target_region_id: pagePath, condition: `导航 id = '${screen}'${triggerLabel !== label ? '，使用替代导航标签' : ''}`, handler_chain: handlerChain, evidence: [{ path: file, line: aliasEntries.find((item) => item.label === triggerLabel)?.line || tabLine }, ...handlerChain.map((item) => ({ path: item.path, line: item.line }))], status: 'source_inferred' });
      fields.push(...sourceFields(componentSource, componentFile, pagePath));
    }
  }
  return { regions, links, fields };
}

export function reconcileRegion(sourceLinks, trace) {
  const observed = trace.observed_region || null;
  const candidates = sourceLinks.filter((link) => link.trigger_label === trace.target?.label);
  if (!candidates.length) return { status: observed ? 'runtime_only' : 'unresolved', source_targets: [], observed_region: observed };
  if (!observed) return { status: 'source_only', source_targets: candidates.map((item) => item.target_region_id), observed_region: null };
  return { status: candidates.some((item) => item.target_region_id === observed.page_path) ? 'matched' : 'mismatch', source_targets: candidates.map((item) => item.target_region_id), observed_region: observed };
}
