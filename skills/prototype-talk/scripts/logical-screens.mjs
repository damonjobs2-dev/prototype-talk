import fs from 'node:fs';
import path from 'node:path';
import { listFiles } from './scanner.mjs';

export function screenPath(route) {
  try {
    const url = new URL(route, 'http://prototype.local');
    const screen = url.searchParams.get('screen');
    return screen && /^[a-z][a-z0-9_-]{0,40}$/i.test(screen) ? `/?screen=${screen}` : '';
  } catch { return ''; }
}

export function logicalScreens(sourceRoot) {
  const screens = new Map();
  for (const file of listFiles(path.resolve(sourceRoot), new Set(['.jsx', '.tsx', '.js', '.mjs']))) {
    const source = fs.readFileSync(file, 'utf8');
    if (!/URLSearchParams\(location\.search\)\.get\(['"]screen['"]\)/.test(source)) continue;
    const tabs = source.match(/const\s+\w*[Tt]abs\s*=\s*\[([\s\S]{0,1600}?)\]/)?.[1] || '';
    for (const match of tabs.matchAll(/\{\s*id:\s*['"]([a-z][a-z0-9_-]*)['"]\s*,\s*label:\s*['"]([^'"]+)['"]/gi)) {
      const id = match[1];
      if (!new RegExp(`\\b${id}\\s*:\\s*${id}Page\\b|\\b${id}Page\\b`).test(source)) continue;
      screens.set(`/?screen=${id}`, { id, label: match[2], source: path.relative(sourceRoot, file).replaceAll(path.sep, '/') });
    }
  }
  return screens;
}
