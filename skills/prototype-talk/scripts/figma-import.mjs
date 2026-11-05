#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyInput } from './input.mjs';

function compactInteraction(item) {
  const actions = item.actions || (item.action ? [item.action] : []);
  return { trigger: item.trigger?.type || '', actions: actions.map((action) => ({ type: action.type || '', navigation: action.navigation || '', destination_id: action.destinationId || '' })) };
}

export function normalizeFigmaDocument(response, selectedNodeId = '') {
  const roots = selectedNodeId ? [response.nodes?.[selectedNodeId]?.document].filter(Boolean) : [response.document].filter(Boolean);
  if (!roots.length) throw new Error('指定的 Figma 节点不存在或当前账号不可读取');
  const nodes = [];
  const pages = [];
  const visit = (node, parentId = '', pageId = '') => {
    if (nodes.length >= 30000) throw new Error('Figma 节点超过 30000 个，请使用带 node-id 的链接缩小范围');
    const currentPage = node.type === 'CANVAS' ? node.id : pageId;
    if (node.type === 'CANVAS') pages.push({ id: node.id, name: node.name });
    const bounds = node.absoluteBoundingBox;
    nodes.push({
      id: node.id, parent_id: parentId, page_id: currentPage, type: node.type, name: node.name || '',
      text: node.type === 'TEXT' ? node.characters || '' : '',
      bounds: bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null,
      font: node.type === 'TEXT' && node.style ? { family: node.style.fontFamily || '', size: node.style.fontSize || null, weight: node.style.fontWeight || null } : null,
      interactions: (node.interactions || []).map(compactInteraction),
      evidence: `figma:node:${node.id}`,
    });
    for (const child of node.children || []) visit(child, node.id, currentPage);
  };
  for (const root of roots) visit(root);
  return { kind: 'figma_design_structure', name: response.name || '', version: response.version || '', pages, nodes, limitations: ['设计节点和原型交互不能证明正式数据来源、接口或运行时结果'] };
}

async function readLimited(response, limit) {
  if (!response.body?.getReader) {
    const value = await response.text();
    if (value.length > limit) throw new Error('Figma 文件响应过大，请提供带 node-id 的链接');
    return value;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let value = '';
  while (true) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    size += chunk.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error('Figma 文件响应过大，请提供带 node-id 的链接'); }
    value += decoder.decode(chunk, { stream: true });
  }
  return value + decoder.decode();
}

export async function importFigma(link, outputDirectory, token, fetchImpl = fetch) {
  const input = classifyInput(link);
  if (input.kind !== 'figma_file') throw new Error('需要 Figma Design 文件或 Prototype 链接；figma.site 发布页请走浏览器观察流程');
  if (!token) throw new Error('缺少 FIGMA_ACCESS_TOKEN；此链接无法通过 Figma 文件 API 读取设计结构');
  const nodeId = input.node_id.replaceAll('-', ':');
  const endpoint = nodeId ? `https://api.figma.com/v1/files/${encodeURIComponent(input.file_key)}/nodes?ids=${encodeURIComponent(nodeId)}` : `https://api.figma.com/v1/files/${encodeURIComponent(input.file_key)}`;
  const response = await fetchImpl(endpoint, { headers: { 'X-Figma-Token': token } });
  if (!response.ok) throw new Error(`Figma 文件读取失败（HTTP ${response.status}）；请核对文件权限和 file_content:read 授权`);
  const length = Number(response.headers?.get('content-length') || 0);
  if (length > 30_000_000) throw new Error('Figma 文件响应过大，请提供带 node-id 的链接');
  const raw = await readLimited(response, 30_000_000);
  const normalized = normalizeFigmaDocument(JSON.parse(raw), nodeId);
  const output = path.resolve(outputDirectory, 'inputs', 'figma-design.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ ...normalized, provider: 'figma', file_key: input.file_key, selected_node_id: nodeId }, null, 2), 'utf8');
  return { output, pages: normalized.pages.length, nodes: normalized.nodes.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = {};
  for (let index = 2; index < process.argv.length; index++) {
    const item = process.argv[index];
    if (['--link', '--out'].includes(item)) args[item.slice(2)] = process.argv[++index];
    else if (item === '--help') { console.log('用法: FIGMA_ACCESS_TOKEN=<token> node figma-import.mjs --link <Figma文件链接> --out <结果目录>'); process.exit(0); }
    else throw new Error(`未知参数：${item}`);
  }
  if (!args.link || !args.out) throw new Error('需要 --link 和 --out');
  importFigma(args.link, args.out, process.env.FIGMA_ACCESS_TOKEN).then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
