import crypto from 'node:crypto';
import babelParser from './vendor/babel-parser/index.cjs';

const CONTROL_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea', 'summary']);
const ROLE_TAGS = new Set(['button', 'tab', 'checkbox', 'radio', 'switch', 'combobox', 'menuitem', 'treeitem', 'slider']);
const COMPONENT_TAGS = new Map([['Button', 'button'], ['IconButton', 'button'], ['Input', 'input'], ['Textarea', 'textarea'], ['TextArea', 'textarea'], ['Select', 'select'], ['SelectFilter', 'select'], ['Switch', 'input'], ['Checkbox', 'input'], ['Radio', 'input']]);
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
const compact = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 90);

function nameOf(node) {
  if (!node) return '';
  if (node.type === 'JSXIdentifier') return node.name;
  if (node.type === 'JSXMemberExpression') return `${nameOf(node.object)}.${nameOf(node.property)}`;
  if (node.type === 'JSXNamespacedName') return `${nameOf(node.namespace)}:${nameOf(node.name)}`;
  return '';
}

function literal(node) {
  if (!node) return '';
  if (node.type === 'StringLiteral') return node.value;
  if (node.type !== 'JSXExpressionContainer') return '';
  const value = node.expression;
  if (value?.type === 'StringLiteral' || value?.type === 'NumericLiteral') return String(value.value);
  if (value?.type === 'TemplateLiteral' && !value.expressions.length) return value.quasis.map((item) => item.value.cooked || item.value.raw).join('');
  return '';
}

function childText(children) {
  const text = [];
  for (const child of children || []) {
    if (child.type === 'JSXText') text.push(child.value);
    else if (child.type === 'JSXExpressionContainer') {
      const value = child.expression;
      if (value?.type === 'StringLiteral' || value?.type === 'NumericLiteral') text.push(String(value.value));
    } else if (child.type === 'JSXElement') {
      const tag = nameOf(child.openingElement?.name);
      if (!CONTROL_TAGS.has(tag.toLowerCase()) && !COMPONENT_TAGS.has(tag)) text.push(childText(child.children));
    }
  }
  return compact(text.join(' '));
}

function attributeMap(opening) {
  const attrs = new Map();
  for (const item of opening.attributes || []) if (item.type === 'JSXAttribute') attrs.set(nameOf(item.name), item);
  return attrs;
}

function expression(content, attribute) {
  const value = attribute?.value;
  if (!value) return '';
  if (value.type === 'JSXExpressionContainer' && value.expression?.start !== undefined) return compact(content.slice(value.expression.start, value.expression.end)).slice(0, 180);
  return compact(literal(value)).slice(0, 180);
}

export function extractJsxControls(content, relative, pagePath = '/index.html') {
  const ast = babelParser.parse(content, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'], errorRecovery: true });
  const operations = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'JSXElement') {
      const opening = node.openingElement;
      const originalTag = nameOf(opening.name);
      const tag = COMPONENT_TAGS.get(originalTag) || originalTag.toLowerCase();
      const attrs = attributeMap(opening);
      const value = (name) => literal(attrs.get(name)?.value);
      const role = value('role');
      const interactive = CONTROL_TAGS.has(tag) || ['div', 'span', 'li', 'label'].includes(tag) && (ROLE_TAGS.has(role) || attrs.has('onClick') || attrs.has('onPress'));
      if (interactive && !(tag === 'input' && ['hidden', 'password'].includes(value('type')))) {
        const sourceLine = opening.loc?.start.line || 1;
        const data = Object.fromEntries([...attrs].filter(([key]) => key.startsWith('data-') && !key.startsWith('data-tech-')).map(([key, item]) => [key, literal(item.value)]));
        const id = value('id');
        const handler = ['onClick', 'onPress', 'onChange', 'onValueChange', 'onSelectionChange', 'onSubmit'].map((key) => expression(content, attrs.get(key))).find(Boolean) || '';
        const label = compact(value('aria-label') || value('label') || value('title') || childText(node.children) || value('placeholder') || value('name') || id || tag);
        const selector = id ? `#${id}` : Object.entries(data).map(([key, text]) => `[${key}${text ? `="${text}"` : ''}]`).join('') || label;
        const field = ['input', 'select', 'textarea'].includes(tag);
        const type = originalTag === 'Switch' || originalTag === 'Checkbox' ? 'checkbox' : value('type');
        const trigger = tag === 'select' ? 'change' : tag === 'input' || tag === 'textarea' ? 'input' : tag === 'button' && type === 'submit' ? 'submit' : 'click';
        operations.push({
          operation_id: `op_${digest(`${relative}|${opening.start}|${originalTag}`)}`, page_hint: pagePath,
          state: 'unknown', role: 'unknown', label, tag,
          anchor: { selector, data, id, onclick: handler, href: value('href'), form: value('form'), type, role, class_name: value('className') || value('class'), download: attrs.has('download'), multiple: attrs.has('multiple'), expanded: value('aria-expanded'), source: { path: relative, line: sourceLine } },
          trigger, discovered_by: ['source_scan', 'jsx_ast'], coverage: 'scan_only', related_code: [], option_source: null,
          field_meta: field ? { declared_editability: attrs.has('disabled') || attrs.has('isDisabled') ? 'disabled' : attrs.has('readOnly') ? 'readonly' : 'editable', required: attrs.has('required') || attrs.has('isRequired'), max_length: Number(value('maxLength')) || null, value_bindings: [] } : null,
        });
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child === 'object' && child.type) visit(child);
      } else if (value && typeof value === 'object' && value.type) visit(value);
    }
  }
  visit(ast);
  return operations;
}
