#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyInput } from './input.mjs';

function clean(value, limit = 300) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit); }
function safeUrl(value) {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

export function normalizeBrowserEvidence(capture) {
  const input = classifyInput(capture.url, capture.provider || '');
  if (!['published_web', 'axure_link', 'figma_file'].includes(input.kind)) throw new Error('浏览器证据需要 Figma 或 Axure 原型链接');
  if (!Array.isArray(capture.pages) || !capture.pages.length) throw new Error('至少需要一页实际浏览器观察');
  const pages = capture.pages.slice(0, 100).map((page, pageIndex) => {
    if (!page.title || !page.url) throw new Error(`第 ${pageIndex + 1} 页缺少标题或 URL`);
    const interactions = (page.interactions || []).slice(0, 100).map((item, index) => {
      if (!item.control || !item.action || !item.before || !item.after) throw new Error(`第 ${pageIndex + 1} 页的第 ${index + 1} 条操作缺少前后状态`);
      return { control: clean(item.control, 120), action: clean(item.action, 120), before: clean(item.before, 500), after: clean(item.after, 500), evidence: `browser:page:${pageIndex + 1}:interaction:${index + 1}` };
    });
    return { title: clean(page.title, 120), url: safeUrl(page.url), visible_regions: (page.visible_regions || []).slice(0, 60).map((item) => clean(item, 180)), interactions, evidence: `browser:page:${pageIndex + 1}` };
  });
  return { kind: 'browser_observation', provider: input.provider, source_host: input.host, pages, limitations: ['仅证明当前浏览器可见内容和实际观察到的交互；不能证明设计源文件、正式数据来源或接口定义'] };
}

export function saveBrowserEvidence(capture, outputDirectory) {
  const result = normalizeBrowserEvidence(capture);
  const output = path.resolve(outputDirectory, 'inputs', 'browser-observations.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(result, null, 2), 'utf8');
  const markdown = ['# 原型链接观察记录', '', `来源：${result.source_host}`, '', '本记录只包含浏览器实际看到的页面与操作结果。', ''];
  for (const page of result.pages) {
    markdown.push(`## ${page.title}`, '', `页面：${page.url}`, '');
    if (page.visible_regions.length) markdown.push('可见区域：', '', ...page.visible_regions.map((region) => `- ${region}`), '');
    for (const item of page.interactions) markdown.push(`### ${item.control} · ${item.action}`, '', `- 操作前：${item.before}`, `- 操作后：${item.after}`, `- 证据：${item.evidence}`, '');
  }
  markdown.push('待核对：设计源文件、数据来源、接口定义及未操作到的状态。', '');
  const document = path.resolve(outputDirectory, 'link-evidence.md');
  fs.writeFileSync(document, markdown.join('\n'), 'utf8');
  return { output, document, pages: result.pages.length, interactions: result.pages.reduce((sum, page) => sum + page.interactions.length, 0) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = {};
  for (let index = 2; index < process.argv.length; index++) {
    const item = process.argv[index];
    if (['--file', '--out'].includes(item)) args[item.slice(2)] = process.argv[++index];
    else if (item === '--help') { console.log('用法: node browser-evidence.mjs --file <浏览器观察JSON> --out <结果目录>'); process.exit(0); }
    else throw new Error(`未知参数：${item}`);
  }
  if (!args.file || !args.out) throw new Error('需要 --file 和 --out');
  try { console.log(JSON.stringify(saveBrowserEvidence(JSON.parse(fs.readFileSync(args.file, 'utf8')), args.out))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
