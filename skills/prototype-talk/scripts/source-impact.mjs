import fs from 'node:fs';
import path from 'node:path';
import { listFiles } from './scanner.mjs';

function normalize(root, owner, target, knownFiles) {
  if (!target || /^(?:https?:|data:|#)/i.test(target)) return '';
  const clean = target.split(/[?#]/)[0];
  const start = clean.startsWith('/') ? path.resolve(root, `.${clean}`) : path.resolve(path.dirname(path.join(root, owner)), clean);
  const candidates = [start, `${start}.js`, `${start}.mjs`, `${start}.jsx`, `${start}.ts`, `${start}.tsx`, `${start}.css`, path.join(start, 'index.js'), path.join(start, 'index.jsx')];
  return candidates.map((item) => path.relative(root, item).replaceAll(path.sep, '/')).find((item) => knownFiles.has(item)) || '';
}

function dependencies(root, files) {
  const known = new Set(files);
  const reverse = new Map();
  for (const owner of files.filter((item) => /\.(?:html|js|mjs|jsx|ts|tsx|css)$/i.test(item))) {
    const absolute = path.join(root, owner);
    if (!fs.existsSync(absolute) || fs.statSync(absolute).size > 2_000_000) continue;
    const content = fs.readFileSync(absolute, 'utf8');
    const refs = [
      ...[...content.matchAll(/\b(?:import|export)\s+(?:[^'"\n]*?\s+from\s+)?['"]([^'"]+)['"]/g)].map((item) => item[1]),
      ...[...content.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((item) => item[1]),
      ...[...content.matchAll(/\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/g)].map((item) => item[1]),
      ...[...content.matchAll(/@import\s+['"]([^'"]+)['"]/g)].map((item) => item[1]),
    ];
    for (const ref of refs) {
      const child = normalize(root, owner, ref, known);
      if (!child) continue;
      if (!reverse.has(child)) reverse.set(child, new Set());
      reverse.get(child).add(owner);
    }
  }
  return reverse;
}

export function affectedPages(root, changedFiles, knownPages, operations) {
  if (!changedFiles.length) return [];
  const all = new Set(knownPages);
  const sourcePages = new Map();
  for (const operation of operations) {
    const source = operation.anchor?.source?.path;
    if (!source || !all.has(operation.page_hint)) continue;
    if (!sourcePages.has(source)) sourcePages.set(source, new Set());
    sourcePages.get(source).add(operation.page_hint);
  }
  const files = listFiles(root).map((item) => path.relative(root, item).replaceAll(path.sep, '/'));
  const reverse = dependencies(root, files);
  const result = new Set();
  for (const changed of changedFiles) {
    if (/\.(?:md|txt|json)$/i.test(changed)) return [...all];
    const directPage = changed.endsWith('.html') ? `/${changed}` : '';
    if (directPage) {
      if (!all.has(directPage)) return [...all];
      result.add(directPage);
      continue;
    }
    const seen = new Set();
    const queue = [changed];
    let matched = false;
    while (queue.length) {
      const file = queue.shift();
      if (seen.has(file)) continue;
      seen.add(file);
      const pages = sourcePages.get(file);
      if (pages?.size) {
        for (const page of pages) result.add(page);
        matched = true;
        queue.push(...[...(reverse.get(file) || [])].filter((parent) => sourcePages.has(parent)));
        continue;
      }
      if (file.endsWith('.html')) {
        const page = `/${file}`;
        if (!all.has(page)) return [...all];
        result.add(page); matched = true; continue;
      }
      queue.push(...(reverse.get(file) || []));
    }
    if (!matched) return [...all];
  }
  return [...result];
}
