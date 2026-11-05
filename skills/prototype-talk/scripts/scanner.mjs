import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { classifyComponent, CATALOG_VERSION } from './component-catalog.mjs';
import { buildDataInventory } from './data-inventory.mjs';
import { analyzePageBehaviors } from './page-behavior.mjs';
import { extractDisplayFields } from './display-fields.mjs';
import { extractJsxControls } from './jsx-source.mjs';
import { buildSourceRegions } from './source-regions.mjs';
import anchorCore from '../assets/anchor-core.js';

const SOURCE_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.jsx', '.ts', '.tsx']);
const SNAPSHOT_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.jsx', '.ts', '.tsx', '.css', '.md', '.json']);
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage']);

export function listFiles(root, extensions = SNAPSHOT_EXTENSIONS) {
  const found = [];
  function visit(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.name.startsWith('.') || item.isSymbolicLink()) continue;
      const absolute = path.join(dir, item.name);
      if (item.isDirectory()) {
        const relative = path.relative(root, absolute).replaceAll(path.sep, '/');
        if (!SKIP_DIRS.has(item.name) && relative !== 'docs/prototype-talk') visit(absolute);
      } else if (extensions.has(path.extname(item.name).toLowerCase())) {
        found.push(absolute);
      }
    }
  }
  visit(root);
  return found.sort();
}

export function sourceFingerprint(root) {
  const hash = crypto.createHash('sha256');
  for (const file of listFiles(root)) {
    const stat = fs.statSync(file);
    hash.update(path.relative(root, file));
    hash.update(`${stat.size}:${stat.mtimeMs}`);
  }
  return hash.digest('hex').slice(0, 16);
}

function digest(value, length = 12) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, length);
}

function lineAt(content, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

function attributes(source) {
  const result = {};
  const re = /([:@\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of source.matchAll(re)) result[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  for (const match of source.matchAll(/(?:^|\s)(data-[\w-]+)(?=\s|\/?>|$)/g)) result[match[1].toLowerCase()] ??= '';
  return result;
}

function stripInterpolations(value) {
  let output = '';
  for (let index = 0; index < value.length; index++) {
    if (value[index] !== '$' || value[index + 1] !== '{') { output += value[index]; continue; }
    index += 2;
    let depth = 1;
    let quote = '';
    while (index < value.length && depth > 0) {
      const character = value[index];
      if (quote) {
        if (character === '\\') index++;
        else if (character === quote) quote = '';
      } else if (character === '"' || character === "'" || character === '`') quote = character;
      else if (character === '{') depth++;
      else if (character === '}') depth--;
      index++;
    }
    index--;
    output += ' ';
  }
  return output;
}

function cleanLabel(value) {
  const raw = String(value ?? '');
  if (/['"`]\s*\+\s*[\w$]+|\+\s*[\w$]+(?:\.[\w$]+)*\s*\+/.test(raw)) return '';
  return stripInterpolations(raw)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot);/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

export function isSyntheticLabel(value) {
  return /['"`]\s*\+\s*[\w$]+|\+\s*[\w$]+(?:\.[\w$]+)*\s*\+|\$\{/.test(String(value ?? ''));
}

function precedingLabel(content, offset) {
  const before = content.slice(Math.max(0, offset - 260), offset);
  const match = before.match(/<label\b[^>]*>([^<]*)<\/label>\s*$/i);
  return match ? cleanLabel(match[1]) : '';
}

function precedingRequired(content, offset) {
  const before = content.slice(Math.max(0, offset - 260), offset);
  return /<label\b[^>]*\brequired\b[^>]*>[^<]*<\/label>\s*$/i.test(before);
}

function booleanAttribute(source, name) {
  return new RegExp(`(?:^|\\s)${name}(?=\\s|\\/|$|=)`, 'i').test(source);
}

function controlFromMatch(match, file, root, content, ordinal) {
  const tag = match[1].toLowerCase();
  const rawAttributes = match[2] ?? '';
  // HTML matched inside a JS template can stop at an arrow (=>) in ${...}.
  // Such a fragment has no reliable label or anchor; the runtime can capture it.
  if (/\$\{[^}]*$/.test(rawAttributes)) return null;
  const attrs = attributes(rawAttributes);
  if (tag === 'input' && ['hidden', 'password'].includes(attrs.type)) return null;
  if (['div', 'span', 'i', 'li'].includes(tag) && !attrs.onclick && !['button', 'tab', 'checkbox', 'radio', 'switch', 'combobox', 'menuitem', 'treeitem', 'slider'].includes(attrs.role) && !attrs['data-action'] && !attrs['data-tab']) return null;
  const fieldLabel = ['input', 'select', 'textarea'].includes(tag) ? precedingLabel(content, match.index ?? 0) : '';
  const label = cleanLabel(attrs['aria-label'] || fieldLabel || attrs.title || match[3] || attrs.placeholder || attrs.value || attrs.name || attrs.id || tag);
  const data = Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith('data-') && !key.startsWith('data-tech-')));
  const anchor = attrs.id ? `#${attrs.id}` : Object.entries(data).map(([key, value]) => `[${key}${value ? `="${value}"` : ''}]`).join('') || attrs.onclick || attrs.href || label;
  const relative = path.relative(root, file).replaceAll(path.sep, '/');
  const line = lineAt(content, match.index ?? 0);
  const stableKey = `${relative}|${tag}|${anchor}|${ordinal}`;
  const interactionKind = tag === 'input' || tag === 'textarea' ? 'input' : tag === 'select' ? 'change' : attrs.type === 'submit' ? 'submit' : 'click';
  const nativeOptions = tag === 'select' ? [...(match[3] || '').matchAll(/<option\b([^>]*)>([^<]*)<\/option>/gi)].map((item) => ({ value: attributes(item[1]).value || '', text: cleanLabel(item[2]) })).filter((item) => item.text && !isSyntheticLabel(item.text)) : [];
  return {
    operation_id: `op_${digest(stableKey)}`,
    page_hint: relative.endsWith('.html') ? `/${relative}` : `/${path.basename(relative, path.extname(relative))}`,
    state: 'unknown',
    role: 'unknown',
    label: label || tag,
    tag,
    anchor: { selector: anchor, data, id: attrs.id || '', onclick: attrs.onclick || '', href: attrs.href || '', form: attrs.form || '', type: attrs.type || '', role: attrs.role || '', class_name: attrs.class || '', download: booleanAttribute(rawAttributes, 'download'), multiple: booleanAttribute(rawAttributes, 'multiple'), expanded: attrs['aria-expanded'] || '', source: { path: relative, line } },
    trigger: interactionKind,
    discovered_by: ['source_scan'],
    coverage: 'scan_only',
    related_code: [],
    option_source: nativeOptions.length ? { kind: 'code_literal', source: { path: relative, line }, options: nativeOptions, initializer: 'HTML <option>' } : null,
    field_meta: ['input', 'select', 'textarea'].includes(tag) ? {
      declared_editability: booleanAttribute(rawAttributes, 'disabled') ? 'disabled' : booleanAttribute(rawAttributes, 'readonly') ? 'readonly' : 'editable',
      required: booleanAttribute(rawAttributes, 'required') || precedingRequired(content, match.index ?? 0),
      max_length: attrs.maxlength ? Number(attrs.maxlength) || null : null,
      value_bindings: [],
    } : null,
  };
}

function closingArrayBracket(content, openAt) {
  let depth = 0;
  let quote = '';
  for (let index = openAt; index < content.length; index++) {
    const character = content[index];
    if (quote) {
      if (character === '\\') index++;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'" || character === '`') { quote = character; continue; }
    if (character === '[') depth++;
    else if (character === ']' && --depth === 0) return index;
  }
  return -1;
}

function customSelectOptionsIndex(content, relative) {
  const byId = new Map();
  const calls = /\bCustomSelect\.init\s*\(\s*(['"])([^'"]+)\1\s*,\s*\[/g;
  for (const call of content.matchAll(calls)) {
    const openAt = call.index + call[0].length - 1;
    const closeAt = closingArrayBracket(content, openAt);
    if (closeAt < 0 || !/^\s*\)/.test(content.slice(closeAt + 1))) continue;
    const literal = content.slice(openAt + 1, closeAt);
    const options = [];
    for (const item of literal.matchAll(/\{([^{}]*)\}/g)) {
      const value = item[1].match(/\bvalue\s*:\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/);
      const label = item[1].match(/\btext\s*:\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/);
      if (!value || !label) continue;
      options.push({ value: value[2], text: label[2] });
    }
    if (options.length) byId.set(call[2], { kind: 'code_literal', source: { path: relative, line: lineAt(content, call.index) }, options, initializer: 'CustomSelect.init' });
  }
  return byId;
}

function valueAssignmentIndex(content, relative) {
  const byId = new Map();
  const pattern = /(?:document\.)?getElementById\(\s*(['"])([^'"]+)\1\s*\)\.value\s*=\s*([^;\n]+)/g;
  for (const match of content.matchAll(pattern)) {
    const before = content.slice(0, match.index);
    const functions = [...before.matchAll(/\bfunction\s+([\w$]+)\s*\(/g)];
    const enclosing = functions.at(-1);
    const expression = match[3].trim().slice(0, 180);
    const rootVariable = expression.match(/^([A-Za-z_$][\w$]*)\./)?.[1] || '';
    let collection = '';
    let lookup = null;
    if (rootVariable && enclosing) {
      const prefix = content.slice(enclosing.index, match.index);
      const lookups = [...prefix.matchAll(new RegExp(`\\b(?:const|let|var)\\s+${rootVariable}\\s*=\\s*([A-Z][A-Z0-9_]*)\\.(?:find|filter)\\s*\\(`, 'g'))];
      const found = lookups.at(-1);
      if (found) { collection = found[1]; lookup = { path: relative, line: lineAt(content, enclosing.index + found.index) }; }
    }
    const entry = { expression, source: { path: relative, line: lineAt(content, match.index) }, function_name: enclosing?.[1] || '', collection, lookup };
    const list = byId.get(match[2]) || [];
    list.push(entry);
    byId.set(match[2], list);
  }
  return byId;
}

function extractControls(content, file, root) {
  const controls = [];
  const counts = new Map();
  const patterns = [
    /<(button|a|select|textarea|summary)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
    /<(input)\b([^>]*)>/gi,
    /<(div|span|i|li)\b([^>]*)>/gi,
  ];
  for (const re of patterns) {
    for (const match of content.matchAll(re)) {
      const attrs = attributes(match[2] ?? '');
      const marker = `${match[1]}|${attrs.id || attrs['data-action'] || attrs.onclick || attrs.href || cleanLabel(match[3])}`;
      const ordinal = (counts.get(marker) ?? 0) + 1;
      counts.set(marker, ordinal);
      const control = controlFromMatch(match, file, root, content, ordinal);
      if (control) controls.push(control);
    }
  }
  return controls.sort((a, b) => a.anchor.source.line - b.anchor.source.line);
}

function relatedCode(control, contentByRelativePath) {
  const tokens = [control.anchor.id, ...Object.keys(control.anchor.data), control.anchor.onclick.match(/^([\w$]+)\s*\(/)?.[1]]
    .filter(Boolean).filter((term) => term.length >= 4);
  const refs = [];
  const relative = control.anchor.source.path;
  const lines = contentByRelativePath.get(relative)?.split(/\r?\n/) || [];
  for (let index = 0; index < lines.length; index++) {
    if (!tokens.some((term) => lines[index].includes(term))) continue;
    if (Math.abs(index + 1 - control.anchor.source.line) < 2) continue;
    refs.push({ path: relative, line: index + 1, excerpt: lines[index].trim().slice(0, 180) });
    if (refs.length >= 5) return refs;
  }
  return refs;
}

export function scanSource(root) {
  const absoluteRoot = path.resolve(root);
  const all = listFiles(absoluteRoot);
  const sourceFiles = all.filter((file) => SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase()));
  const hash = crypto.createHash('sha256');
  const legacyHash = crypto.createHash('sha256');
  const fileHashes = {};
  for (const file of all) {
    const relative = path.relative(absoluteRoot, file).replaceAll(path.sep, '/');
    const content = fs.readFileSync(file);
    fileHashes[relative] = digest(content, 16);
    hash.update(relative);
    hash.update(content);
    if (!relative.endsWith('.css')) { legacyHash.update(relative); legacyHash.update(content); }
  }
  const sourceSnapshotId = `src_${hash.digest('hex').slice(0, 16)}`;
  const operations = [];
  const jsxParseErrors = [];
  const contentByRelativePath = new Map();
  const documentContents = new Map();
  const assignmentsByRelativePath = new Map();
  const customOptionsByRelativePath = new Map();
  const htmlEntry = all.find((file) => path.basename(file) === 'index.html') || all.find((file) => file.endsWith('.html'));
  const jsxPagePath = htmlEntry ? `/${path.relative(absoluteRoot, htmlEntry).replaceAll(path.sep, '/')}` : '/index.html';
  for (const file of sourceFiles) {
    const relative = path.relative(absoluteRoot, file).replaceAll(path.sep, '/');
    const content = fs.readFileSync(file, 'utf8');
    contentByRelativePath.set(relative, content);
    assignmentsByRelativePath.set(relative, valueAssignmentIndex(content, relative));
    customOptionsByRelativePath.set(relative, customSelectOptionsIndex(content, relative));
    if (/\.(?:jsx|tsx)$/i.test(relative)) {
      try { operations.push(...extractJsxControls(content, relative, jsxPagePath)); }
      catch (error) { jsxParseErrors.push({ path: relative, error: String(error.message || error).slice(0, 240) }); }
    } else operations.push(...extractControls(content, file, absoluteRoot));
  }
  for (const file of all.filter((item) => path.extname(item).toLowerCase() === '.md')) documentContents.set(path.relative(absoluteRoot, file).replaceAll(path.sep, '/'), fs.readFileSync(file, 'utf8'));
  for (const operation of operations) {
    operation.source_snapshot_id = sourceSnapshotId;
    operation.related_code = relatedCode(operation, contentByRelativePath);
    const customSelectId = operation.anchor.id || operation.anchor.onclick.match(/\bCustomSelect\.(?:toggle|open)\s*\(\s*(['"])([^'"]+)\1/)?.[2];
    if (customSelectId) operation.option_source ||= customOptionsByRelativePath.get(operation.anchor.source.path)?.get(customSelectId) || null;
    if (operation.field_meta && operation.anchor.id) {
      operation.field_meta.value_bindings = (assignmentsByRelativePath.get(operation.anchor.source.path)?.get(operation.anchor.id) || []).slice(0, 8);
      for (const binding of operation.field_meta.value_bindings) {
        if (!binding.collection) continue;
        for (const [relative, content] of contentByRelativePath) {
          const declaration = new RegExp(`\\b(?:const|let|var)\\s+${binding.collection}\\s*=`).exec(content);
          if (declaration) {
            binding.collection_source = { path: relative, line: lineAt(content, declaration.index) };
            if (/localStorage\.getItem\s*\(/.test(content.slice(declaration.index, declaration.index + 1800))) binding.collection_origin = 'browser_cache_or_default_mock';
            break;
          }
        }
      }
    }
    operation.component = classifyComponent(operation);
  }
  const unmatched = new Map();
  for (const operation of operations) if (operation.component.status === 'needs_research') {
    const signature = operation.component.evidence;
    const prior = unmatched.get(signature);
    if (prior) prior.count++;
    else unmatched.set(signature, { signature, count: 1, example: { operation_id: operation.operation_id, label: operation.label, source: operation.anchor.source } });
  }
  const dataInventory = buildDataInventory(contentByRelativePath, operations, documentContents);
  const regionGraph = buildSourceRegions(contentByRelativePath);
  return { source_root: absoluteRoot, source_snapshot_id: sourceSnapshotId, legacy_snapshot_id: `src_${legacyHash.digest('hex').slice(0, 16)}`, file_hashes: fileHashes, scanned_files: all.length, source_files: sourceFiles.length, jsx_parse_errors: jsxParseErrors, catalog_version: CATALOG_VERSION, unmatched_components: [...unmatched.values()], data_inventory: dataInventory, display_fields: [...extractDisplayFields(contentByRelativePath), ...regionGraph.fields], source_regions: regionGraph.regions, source_region_links: regionGraph.links, page_behaviors: analyzePageBehaviors(contentByRelativePath, operations, dataInventory), operations };
}

export const weakRuntimeAttribute = anchorCore.weakData;
export const runtimeIdentityConflict = anchorCore.runtimeIdentityConflict;
export const matchRuntimeControl = anchorCore.matchRuntimeControl;
const identityLabel = (value) => String(value || '').replace(/[\d０-９]+(?:[,.，]\d+)*/g, '').replace(/\s+/g, '').trim();

export function runtimeTraceTargetMismatch(operation, target) {
  if (!operation?.discovered_by?.includes('runtime') || operation.discovered_by.includes('jsx_ast')) return false;
  const expected = identityLabel(operation.label);
  const actual = identityLabel(target?.label);
  if (!expected || !actual || expected === actual || expected.length >= 4 && actual.includes(expected) || actual.length >= 4 && expected.includes(actual)) return false;
  let sharedPrefix = 0;
  while (sharedPrefix < Math.min(expected.length, actual.length) && expected[sharedPrefix] === actual[sharedPrefix]) sharedPrefix++;
  if (sharedPrefix >= 4) return false;
  return runtimeIdentityConflict(operation, target);
}
