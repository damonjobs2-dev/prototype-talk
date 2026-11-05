import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSource, listFiles } from './scanner.mjs';
import { projectPages } from './project-agent.mjs';
import { groupOperationFamilies } from './operation-families.mjs';

export function classifyInput(value, provider = '') {
  let url;
  try { url = new URL(value); } catch { return { kind: 'local_source', path: path.resolve(value) }; }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('原型链接必须使用 HTTP 或 HTTPS');
  const host = url.hostname.toLowerCase();
  if (provider && !['figma', 'figma-site', 'axure'].includes(provider)) throw new Error('provider 只支持 figma、figma-site 或 axure');
  if (host === 'figma.com' || host === 'www.figma.com') {
    const match = url.pathname.match(/^\/(?:file|design|proto)\/([^/]+)/);
    if (!match) throw new Error('Figma 链接需指向 Design 文件或 Prototype');
    return { kind: 'figma_file', provider: 'figma', host, file_key: match[1], node_id: url.searchParams.get('node-id') || '', evidence_level: 'design_structure_if_authorized' };
  }
  if (provider === 'figma-site' || host === 'figma.site' || host.endsWith('.figma.site')) return { kind: 'published_web', provider: 'figma', host, evidence_level: 'browser_observation' };
  if (provider === 'axure' || host === 'axure.cloud' || host.endsWith('.axure.cloud') || host === 'axshare.com' || host.endsWith('.axshare.com')) return { kind: 'axure_link', provider: 'axure', host, evidence_level: 'inspect_if_available_else_browser_observation' };
  throw new Error('无法识别原型链接；自定义域名请指定 --provider axure 或 --provider figma-site');
}

export function validateOutputSchema(file) {
  const schema = JSON.parse(fs.readFileSync(file, 'utf8'));
  const problems = [];
  function walk(node, location) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'object' && node.properties) {
      if (node.additionalProperties !== false) problems.push(`${location}: additionalProperties 必须为 false`);
      for (const key of Object.keys(node.properties)) if (!node.required?.includes(key)) problems.push(`${location}.${key}: 未列入 required`);
    }
    for (const [key, value] of Object.entries(node)) walk(value, `${location}.${key}`);
  }
  walk(schema, path.basename(file));
  return problems;
}

export function inspectInput(value, { provider = '', schemaDirectory = path.dirname(fileURLToPath(import.meta.url)) } = {}) {
  const input = classifyInput(value, provider);
  const schemaProblems = ['interpret.schema.json', 'project.schema.json'].flatMap((name) => validateOutputSchema(path.join(schemaDirectory, name)));
  if (input.kind !== 'local_source') return {
    input, status: schemaProblems.length ? 'blocked_by_schema' : 'needs_live_inspection', schema_problems: schemaProblems,
    available_now: input.kind === 'figma_file' ? ['识别文件和节点链接'] : ['识别链接类型'],
    next_step: input.kind === 'figma_file' ? '检查文件访问权限和图层/原型节点，再采集页面与交互' : '在浏览器中验证访问、页面结构和实际交互；无法从分享页证明源码或正式接口',
  };
  if (!fs.existsSync(input.path) || !fs.statSync(input.path).isDirectory()) throw new Error('本地 Demo 目录不存在');
  const files = listFiles(input.path);
  const pages = projectPages(input.path);
  const scan = pages.length ? scanSource(input.path) : null;
  const actionable = scan?.operations.filter((item) => ['click', 'submit'].includes(item.trigger)) || [];
  const mapped = actionable.filter((item) => item.anchor?.onclick || item.related_code?.length);
  const otherSources = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const relative = path.relative(input.path, absolute).replaceAll(path.sep, '/');
        if (!['node_modules', 'dist', 'build', '.next', 'coverage'].includes(entry.name) && relative !== 'docs/prototype-talk') visit(absolute);
      } else if (/\.vue$/i.test(entry.name)) otherSources.push(absolute);
    }
  };
  visit(input.path);
  const problems = [...schemaProblems];
  if (!pages.length) problems.push('未找到可作为入口的 HTML 页面或已识别路由');
  if (otherSources.length) problems.push(`发现 ${otherSources.length} 个 Vue 文件；当前源码扫描器尚未解析这些组件`);
  if (scan?.jsx_parse_errors?.length) problems.push(`有 ${scan.jsx_parse_errors.length} 个 JSX/TSX 文件解析失败：${scan.jsx_parse_errors[0].path} · ${scan.jsx_parse_errors[0].error}`);
  const jsxSourceCount = files.filter((file) => /\.(jsx|tsx)$/i.test(file)).length;
  const builtRoot = path.join(input.path, 'dist');
  const builtEntry = path.join(builtRoot, 'index.html');
  if (jsxSourceCount && !fs.existsSync(builtEntry)) problems.push('JSX/TSX 源码已读取，但本地预览需要可运行的 dist/index.html；先提供构建产物再启动');
  const latestSourceTime = jsxSourceCount ? files.filter((file) => /\.(?:html|js|mjs|jsx|ts|tsx|css)$/i.test(file)).reduce((latest, file) => Math.max(latest, fs.statSync(file).mtimeMs), 0) : 0;
  const runtimeBuildStale = jsxSourceCount && fs.existsSync(builtEntry) && fs.statSync(builtEntry).mtimeMs + 2000 < latestSourceTime;
  if (runtimeBuildStale) problems.push('dist/index.html 早于当前源码；预览与源码证据可能不是同一版本，请更新构建产物');
  const runtimeRoot = jsxSourceCount ? fs.existsSync(builtEntry) ? builtRoot : null : input.path;
  return {
    input, status: problems.length ? 'needs_input_adapter_or_fix' : 'ready_for_model_parse', problems,
    source_adapter: jsxSourceCount ? 'jsx_ast' : 'html_javascript', runtime_root: runtimeRoot,
    jsx_source_count: jsxSourceCount, jsx_parse_errors: scan?.jsx_parse_errors || [],
    runtime_build_stale: !!runtimeBuildStale,
    scanned_files: files.length, page_count: pages.length, control_count: scan?.operations.length || 0,
    operation_family_count: scan ? groupOperationFamilies(scan.operations).length : 0,
    requirement_section_count: scan?.data_inventory?.requirement_sections?.length || 0,
    data_collection_count: scan?.data_inventory?.collections?.length || 0,
    actionable_count: actionable.length, handler_candidate_count: mapped.length,
    unresolved_handler_examples: actionable.filter((item) => !item.anchor?.onclick && !item.related_code?.length).slice(0, 8).map((item) => ({ label: item.label, source: item.anchor?.source })),
    warning: jsxSourceCount ? '这是单页 React/JSX 原型；源码控件是静态候选，条件渲染的界面仍需运行时逐个检查，处理函数线索不等于已确认业务规则' : '处理函数位置只是源码候选线索；正式业务规则仍需结合 PRD、Mock 和实际操作核对',
  };
}
