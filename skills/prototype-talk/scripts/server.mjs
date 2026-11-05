#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReviewStore } from './store.mjs';
import { interpret } from './agent.mjs';
import { interpretProjectBatch, projectPages, progressiveBatches, movePageToFront } from './project-agent.mjs';
import { buildEvidenceView } from './evidence.mjs';
import { validateOutputSchema } from './input.mjs';
import { bundleProjectViewer } from './bundle.mjs';
import { listFiles } from './scanner.mjs';
import { expectedMismatch } from './trace-match.mjs';
import { MODEL_DESTINATION, modelConsentRecord, canReuseModelConsent } from './model-consent.mjs';
import { acquireServerLock } from './server-lock.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const assetDir = path.resolve(scriptDir, '../assets');

function argsFrom(argv) {
  const args = { port: 4179, noAi: true };
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (item === '--source') args.source = argv[++index];
    else if (item === '--out') args.out = argv[++index];
    else if (item === '--web-root') args.webRoot = argv[++index];
    else if (item === '--port') args.port = Number(argv[++index]);
    else if (item === '--focus') args.focus = argv[++index];
    else if (item === '--model-parse' || item === '--ai') args.noAi = false;
    else if (item === '--index-only' || item === '--no-ai') args.noAi = true;
    else if (item === '--help') { console.log('用法: node server.mjs --source <Demo目录> [--web-root <已构建页面目录>] [--out <结果目录>] [--port 4179] [--focus 控件名] [--model-parse | --index-only]；JSX 项目默认使用 dist/ 作为浏览器预览，默认只建立本地索引'); process.exit(0); }
    else throw new Error(`未知参数：${item}`);
  }
  if (!args.source) throw new Error('需要 --source');
  if (!Number.isInteger(args.port) || args.port < 0 || args.port > 65535) throw new Error('无效端口');
  return args;
}

const args = argsFrom(process.argv.slice(2));
const sourceRoot = path.resolve(args.source);
const hasJsxSource = listFiles(sourceRoot, new Set(['.jsx', '.tsx'])).length > 0;
const runtimeRoot = args.webRoot ? path.resolve(sourceRoot, args.webRoot) : hasJsxSource ? path.join(sourceRoot, 'dist') : sourceRoot;
if (runtimeRoot !== sourceRoot && !runtimeRoot.startsWith(`${sourceRoot}${path.sep}`)) throw new Error('浏览器预览目录必须位于 Demo 项目内');
if ((hasJsxSource || args.webRoot) && !fs.existsSync(path.join(runtimeRoot, 'index.html'))) throw new Error(hasJsxSource ? 'JSX 原型需要已构建的 dist/index.html，或使用 --web-root 指向项目内的构建目录；源码扫描不会执行构建命令' : '浏览器预览目录缺少 index.html');
if (hasJsxSource) {
  const latestSourceTime = listFiles(sourceRoot, new Set(['.html', '.js', '.mjs', '.jsx', '.ts', '.tsx', '.css'])).reduce((latest, file) => Math.max(latest, fs.statSync(file).mtimeMs), 0);
  if (fs.statSync(path.join(runtimeRoot, 'index.html')).mtimeMs + 2000 < latestSourceTime) throw new Error('浏览器构建产物早于 JSX 源码；请更新 dist 后再预览，避免把旧页面与新源码混在一起评审');
}
if (!args.noAi) {
  const problems = ['interpret.schema.json', 'project.schema.json'].flatMap((name) => validateOutputSchema(path.join(scriptDir, name)));
  if (problems.length) throw new Error(`模型输出格式检查未通过：${problems.join('；')}`);
}
const releaseServerLock = acquireServerLock(path.resolve(args.out || path.join(sourceRoot, 'docs', 'prototype-talk')), args.port);
process.on('exit', releaseServerLock);
const store = new ReviewStore(sourceRoot, args.out);
if (!args.noAi && !canReuseModelConsent(store.data.model_consent, store.sourceRoot)) {
  store.data.model_consent = modelConsentRecord(store.sourceRoot, 'cli_model_parse');
  store.save();
}
bundleProjectViewer(store, scriptDir, assetDir);
const queue = [];
const projectQueue = [];
let activeOperations = 0;
const activeOperationIds = new Set();
const maxOperationConcurrency = 2;
let projectActive = 0;
let firstProjectJobId = '';
const maxProjectConcurrency = 2;

function enqueue(job) {
  if (job.status === 'queued' && !queue.includes(job.job_id)) {
    if (job.kind === 'on_demand' || job.kind === 'recheck') queue.unshift(job.job_id);
    else queue.push(job.job_id);
  }
  if (activeOperations < maxOperationConcurrency) setImmediate(processQueue);
}

function enqueueProject(job) {
  if (job?.status === 'queued' && !projectQueue.includes(job.job_id)) projectQueue.push(job.job_id);
  if (projectActive < maxProjectConcurrency) setImmediate(processProjectQueue);
}

function prioritizePage(pagePath) {
  const found = movePageToFront(projectQueue, store.data.project_jobs, pagePath);
  if (projectActive < maxProjectConcurrency) setImmediate(processProjectQueue);
  return found;
}

function syncSource() {
  const change = store.rescanIfChanged();
  if (change && !args.noAi) {
    const affected = projectPages(store.sourceRoot).filter((page) => change.affected_pages.includes(page));
    for (const batch of progressiveBatches(affected)) enqueueProject(store.createProjectJob(batch));
  }
  return change;
}

async function processProjectQueue() {
  if (projectActive >= maxProjectConcurrency || !projectQueue.length || firstProjectJobId && projectActive > 0) return;
  projectActive++;
  const jobId = projectQueue.shift();
  if (!firstProjectJobId && projectActive < maxProjectConcurrency && projectQueue.length) setImmediate(processProjectQueue);
  try {
    const job = store.data.project_jobs.find((item) => item.job_id === jobId);
    if (job?.status === 'queued') {
      const startedAt = Date.now();
      let modelStartedAt = startedAt;
      let validationStartedAt = 0;
      let diagnostics = {};
      store.updateProjectJob(jobId, { started_at: new Date(startedAt).toISOString(), queue_duration_ms: Math.max(0, startedAt - Date.parse(job.created_at || new Date(startedAt).toISOString())) });
      try {
        const pages = await interpretProjectBatch({ sourceRoot: store.sourceRoot, source_snapshot_id: job.source_snapshot_id, pages: job.pages, allPages: projectPages(store.sourceRoot), operations: store.data.operations, dataInventory: store.data.data_inventory, sourceRegions: store.data.source_regions, displayFields: store.data.display_fields }, {
          onDiagnostics(value) { diagnostics = value; },
          onStage(status) {
            if (status === 'preparing_evidence') { store.updateProjectJob(jobId, { status: 'analyzing', stage: '整理页面证据中' }); return; }
            if (status === 'analyzing') modelStartedAt = Date.now();
            if (status === 'validating') validationStartedAt = Date.now();
            store.updateProjectJob(jobId, { status, stage: status === 'analyzing' ? '生成页面说明中' : '核对依据中', ...(validationStartedAt ? { model_duration_ms: validationStartedAt - modelStartedAt } : {}) });
          },
        });
        const writeStartedAt = Date.now();
        store.addProjectResult(job, pages);
        store.updateProjectJob(jobId, { ...diagnostics, duration_ms: Date.now() - startedAt, validation_duration_ms: validationStartedAt ? writeStartedAt - validationStartedAt : null, write_duration_ms: Date.now() - writeStartedAt });
      } catch (error) {
        store.updateProjectJob(jobId, { ...diagnostics, status: 'failed', stage: '首轮解读失败', duration_ms: Date.now() - startedAt, ...(validationStartedAt ? { validation_duration_ms: Date.now() - validationStartedAt } : { model_duration_ms: Date.now() - modelStartedAt }), error: String(error.message || error).slice(0, 600) });
      }
    }
  } finally {
    projectActive--;
    if (jobId === firstProjectJobId) firstProjectJobId = '';
    setImmediate(processProjectQueue);
  }
}

async function processQueue() {
  if (activeOperations >= maxOperationConcurrency || !queue.length) return;
  const index = queue.findIndex((id) => {
    const queued = store.data.jobs.find((item) => item.job_id === id);
    return !queued || !activeOperationIds.has(queued.operation_id);
  });
  if (index < 0) return;
  const [jobId] = queue.splice(index, 1);
  const job = store.data.jobs.find((item) => item.job_id === jobId);
  if (!job || job.status !== 'queued') { setImmediate(processQueue); return; }
  if (args.noAi) {
    store.updateJob(jobId, { status: 'failed', stage: '模型解析项目未运行', error: '本次仅建立本地索引；使用 --model-parse 后可重新解析该操作' });
    setImmediate(processQueue); return;
  }
  activeOperations++;
  activeOperationIds.add(job.operation_id);
  if (activeOperations < maxOperationConcurrency && queue.length) setImmediate(processQueue);
  const startedAt = Date.now();
  let modelStartedAt = startedAt;
  let validationStartedAt = 0;
  let diagnostics = {};
  store.updateJob(jobId, { started_at: new Date(startedAt).toISOString(), queue_duration_ms: Math.max(0, startedAt - Date.parse(job.created_at || new Date(startedAt).toISOString())) });
  try {
    const operation = store.data.operations.find((item) => item.operation_id === job.operation_id);
    const trace = job.trace_ids.length ? store.data.traces.find((item) => item.trace_id === job.trace_ids.at(-1)) : null;
    const previousCard = store.latestCard(job.operation_id);
    const supplements = store.data.supplements.filter((item) => item.operation_id === job.operation_id);
    const rules = store.data.rules.filter((item) => item.operation_id === job.operation_id && !item.superseded_by);
    const routePath = (trace?.before?.route || '').split('#')[1]?.split('?')[0] || operation?.page_hint;
    const pageSpec = store.pageSpec(routePath) || store.pageSpec(operation?.page_hint) || store.data.page_specs.find((item) => item.source_snapshot_id === store.data.source_snapshot_id && item.path.endsWith('/*') && routePath?.startsWith(item.path.slice(0, -1))) || null;
    const result = await interpret({ sourceRoot: store.sourceRoot, source_snapshot_id: job.source_snapshot_id, operation, trace, previousCard, supplements, rules, dataInventory: store.data.data_inventory, sourceRegions: store.data.source_regions, sourceRegionLinks: store.data.source_region_links, displayFields: store.data.display_fields, pageSpec, reason: job.reason }, {
      onDiagnostics(value) { diagnostics = value; },
      onStage(stage) {
        if (stage === 'preparing_evidence') { store.updateJob(jobId, { status: 'analyzing', stage: '整理当前操作证据中' }); return; }
        if (stage === 'analyzing') modelStartedAt = Date.now();
        if (stage === 'validating') validationStartedAt = Date.now();
        store.updateJob(jobId, { status: stage, stage: stage === 'analyzing' ? '解读中' : '校验中', ...(validationStartedAt ? { model_duration_ms: validationStartedAt - modelStartedAt } : {}) });
      },
    });
    if (job.source_snapshot_id !== store.data.source_snapshot_id) store.updateJob(jobId, { status: 'stale', stage: '资料已变化', error: '结果未发布，请重新扫描' });
    else { const writeStartedAt = Date.now(); store.addResult(job, result); store.updateJob(jobId, { ...diagnostics, duration_ms: Date.now() - startedAt, validation_duration_ms: validationStartedAt ? writeStartedAt - validationStartedAt : null, write_duration_ms: Date.now() - writeStartedAt }); }
  } catch (error) {
    store.updateJob(jobId, { ...diagnostics, status: 'failed', stage: '解读失败', duration_ms: Date.now() - startedAt, ...(validationStartedAt ? { validation_duration_ms: Date.now() - validationStartedAt } : { model_duration_ms: Date.now() - modelStartedAt }), error: String(error.message || error).slice(0, 600) });
  } finally {
    activeOperations--;
    activeOperationIds.delete(job.operation_id);
    setImmediate(processQueue);
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff' };

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let value = '';
    request.on('data', (chunk) => { value += chunk; if (value.length > 1500000) { request.destroy(); reject(new Error('请求过大')); } });
    request.on('end', () => { try { resolve(value ? JSON.parse(value) : {}); } catch { reject(new Error('无效 JSON')); } });
    request.on('error', reject);
  });
}

function staticFile(response, root, relative, inject = false) {
  const absolute = path.resolve(root, relative);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) { json(response, 403, { error: '拒绝访问' }); return; }
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) { json(response, 404, { error: '文件不存在' }); return; }
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(absolute);
  if (realFile !== realRoot && !realFile.startsWith(`${realRoot}${path.sep}`)) { json(response, 403, { error: '拒绝访问目录外文件' }); return; }
  const ext = path.extname(absolute).toLowerCase();
  if (inject && ext === '.html') {
    let html = fs.readFileSync(absolute, 'utf8');
    const injection = '<link rel="stylesheet" href="/__tech/overlay.css"><script defer src="/__tech/finder.js"></script><script defer src="/__tech/anchor-core.js"></script><script defer src="/__tech/overlay.js"></script>';
    html = html.includes('</head>') ? html.replace('</head>', `${injection}</head>`) : `${injection}${html}`;
    response.writeHead(200, { 'Content-Type': MIME[ext], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(html);
    return;
  }
  response.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' || root === assetDir ? 'no-store' : 'public, max-age=60', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(absolute).pipe(response);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  try {
    const host = String(request.headers.host || '');
    const listeningPort = server.address()?.port;
    if (listeningPort && ![`127.0.0.1:${listeningPort}`, `localhost:${listeningPort}`].includes(host)) { json(response, 403, { error: '仅允许本机地址' }); return; }
    const origin = String(request.headers.origin || '');
    if (request.method !== 'GET' && origin && ![`http://127.0.0.1:${listeningPort}`, `http://localhost:${listeningPort}`].includes(origin)) { json(response, 403, { error: '来源不匹配' }); return; }
    if (pathname === '/__tech/state' && request.method === 'GET') {
      if (url.searchParams.get('since') === store.data.updated_at) json(response, 200, { unchanged: true, updated_at: store.data.updated_at });
      else json(response, 200, { ...store.publicState(), ai_enabled: !args.noAi, model_consent_reusable: canReuseModelConsent(store.data.model_consent, store.sourceRoot), output_directory: store.outputRoot, model_destination: `ChatGPT/Codex（${process.env.TECH_PROTOTYPE_TRANSPORT === 'default' ? 'CLI 默认传输' : 'HTTPS：chatgpt.com/backend-api/codex'}；${process.env.TECH_PROTOTYPE_MODEL || 'CLI 默认模型'}）` });
      return;
    }
    if (pathname === '/__tech/model-mode' && request.method === 'POST') {
      const input = await readBody(request);
      const reusedConsent = input.reuse_consent === true && canReuseModelConsent(store.data.model_consent, store.sourceRoot);
      if ((!reusedConsent && input.consent !== true) || input.source_root !== store.sourceRoot || input.destination !== MODEL_DESTINATION) {
        json(response, 400, { error: '请确认当前项目的源码、PRD、Mock、实际操作记录和 ChatGPT/Codex 目的地' }); return;
      }
      const pagePath = String(input.page_path || '');
      const operationId = String(input.operation_id || '');
      const validPage = pagePath && projectPages(store.sourceRoot).includes(pagePath);
      const validOperation = operationId && store.data.operations.some((item) => item.operation_id === operationId);
      if (!validPage && !validOperation) { json(response, 422, { error: '当前页面和操作未进入索引；请先点击原型控件或重新扫描' }); return; }
      const problems = ['interpret.schema.json', 'project.schema.json'].flatMap((name) => validateOutputSchema(path.join(scriptDir, name)));
      if (problems.length) { json(response, 409, { error: `模型输出格式检查未通过：${problems.join('；')}` }); return; }
      args.noAi = false;
      if (!reusedConsent) {
        store.data.model_consent = modelConsentRecord(store.sourceRoot, 'local_viewer');
        store.save();
      }
      if (validPage) enqueueProject(store.createProjectJob([pagePath]));
      if (validOperation) enqueue(store.createJob('on_demand', operationId, [], '用户在原型旁要求生成完整说明'));
      json(response, 202, { ai_enabled: true, page_path: pagePath, operation_id: operationId });
      return;
    }
    if (pathname === '/__tech/evidence' && request.method === 'GET') {
      json(response, 200, buildEvidenceView(store.data, store.sourceRoot, { operationId: url.searchParams.get('operation_id') || '', pagePath: url.searchParams.get('page_path') || '', context: (url.searchParams.get('context') || '').slice(0, 80), scope: url.searchParams.get('scope') || 'current' }));
      return;
    }
    if (pathname === '/__tech/prioritize' && request.method === 'POST') {
      const input = await readBody(request);
      const pagePath = String(input.page_path || '');
      json(response, 200, { prioritized: !args.noAi && prioritizePage(pagePath) });
      return;
    }
    if (pathname === '/__tech/project-jobs' && request.method === 'POST') {
      if (args.noAi) { json(response, 409, { error: '本次只建立本地索引；启动 --model-parse 后才能生成页面说明' }); return; }
      const input = await readBody(request);
      const pagePath = String(input.page_path || '');
      if (!projectPages(store.sourceRoot).includes(pagePath)) { json(response, 404, { error: '页面不在当前原型索引中' }); return; }
      const job = store.createProjectJob([pagePath]);
      if (!job) { json(response, 200, { status: 'returned', page_path: pagePath }); return; }
      enqueueProject(job);
      json(response, 202, job);
      return;
    }
    if (pathname === '/__tech/sync' && request.method === 'POST') { json(response, 200, { change: syncSource(), source_snapshot_id: store.data.source_snapshot_id }); return; }
    if (pathname === '/__tech/display-fields' && request.method === 'POST') { json(response, 200, store.recordRuntimeFields(await readBody(request))); return; }
    if (pathname === '/__tech/api-fields' && request.method === 'POST') { json(response, 201, store.upsertApiField(await readBody(request))); return; }
    if (pathname === '/__tech/api-fields/remove' && request.method === 'POST') { const input = await readBody(request); json(response, 200, store.removeApiField(input.field_id)); return; }
    if (pathname === '/__tech/trace' && request.method === 'POST') {
      const input = await readBody(request);
      const { operation, trace } = store.addTrace(input);
      const card = store.latestCard(operation.operation_id);
      const recheck = card && expectedMismatch(card, trace);
      const shouldAnalyze = !args.noAi && (!card || recheck);
      const job = shouldAnalyze ? store.createJob(recheck ? 'recheck' : 'on_demand', operation.operation_id, [trace.trace_id], recheck ? '实际结果与已有说明可能冲突，请核对前置条件' : '技术视图首次观察到此操作，请补解读') : null;
      if (job) enqueue(job);
      json(response, 200, { operation_id: operation.operation_id, trace_id: trace.trace_id, job_id: job?.job_id || null, status: job?.status || 'observed', recheck });
      return;
    }
    if (pathname === '/__tech/jobs' && request.method === 'POST') {
      if (args.noAi) { json(response, 409, { error: '本次只建立本地索引；启动 --model-parse 后才能解读操作' }); return; }
      const input = await readBody(request);
      const operation = store.data.operations.find((item) => item.operation_id === input.operation_id);
      if (!operation) { json(response, 404, { error: '操作不存在' }); return; }
      const job = store.createJob(input.kind || 'initial_scan', operation.operation_id, input.trace_ids || [], input.reason || '人工要求解读');
      enqueue(job);
      json(response, 202, job);
      return;
    }
    if (pathname === '/__tech/claim' && request.method === 'POST') {
      const input = await readBody(request);
      json(response, 200, store.decideClaim(input.card_id, input.claim_id, input.decision)); return;
    }
    if (pathname === '/__tech/card/decide' && request.method === 'POST') {
      const input = await readBody(request);
      json(response, 200, store.decideCard(input.card_id, input.decision)); return;
    }
    if (pathname === '/__tech/issues' && request.method === 'POST') { json(response, 201, store.addUserIssue(await readBody(request))); return; }
    if (pathname === '/__tech/supplements' && request.method === 'POST') {
      const supplement = store.addSupplement(await readBody(request));
      const job = args.noAi ? null : store.createJob('recheck', supplement.operation_id, [], '用户补充业务规则，请核对现有说明');
      if (job) enqueue(job);
      json(response, 201, { supplement, job_id: job?.job_id || null });
      return;
    }
    if (pathname === '/__tech/rules' && request.method === 'POST') {
      const rule = store.addRule(await readBody(request));
      const job = !args.noAi && rule.operation_id ? store.createJob('recheck', rule.operation_id, [], `用户确认了${rule.scope === 'product' ? '产品' : '技术'}规则，请结合新规则核对当前说明`) : null;
      if (job) enqueue(job);
      json(response, 201, { rule, job_id: job?.job_id || null });
      return;
    }
    if (pathname === '/__tech/issues/decide' && request.method === 'POST') { const input = await readBody(request); json(response, 200, store.decideIssue(input.issue_id, input.decision)); return; }
    if (pathname === '/__tech/todo' && request.method === 'GET') { json(response, 200, store.data.issues.filter((item) => item.decision === 'accepted' && !store.data.cards.some((card) => card.card_id === item.card_id && card.invalidated_reason))); return; }
    if (pathname === '/__tech/todo' && request.method === 'POST') { const input = await readBody(request); json(response, 200, store.updateTodo(input.issue_id, input.status)); return; }
    if (pathname === '/__tech/documents' && request.method === 'GET') {
      const name = url.searchParams.get('name');
      if (!['requirements.generated.md', 'technical-design.generated.md', 'handoff.generated.md'].includes(name)) { json(response, 404, { error: '文档不存在' }); return; }
      response.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(fs.readFileSync(path.join(store.outputRoot, name), 'utf8'));
      return;
    }
    if (['/__tech/overlay.js', '/__tech/overlay.css', '/__tech/anchor-core.js', '/__tech/finder.js'].includes(pathname)) { staticFile(response, assetDir, path.basename(pathname)); return; }
    if (pathname.startsWith('/__tech/')) { json(response, 404, { error: '未知接口' }); return; }
    if (pathname === '/docs/prototype-talk' || pathname.startsWith('/docs/prototype-talk/')) { json(response, 403, { error: '评审状态文件不通过 Demo 页面直接访问' }); return; }
    const relative = pathname.endsWith('/') ? `${pathname}index.html` : pathname === '/' ? '/index.html' : pathname;
    staticFile(response, runtimeRoot, `.${relative}`, true);
  } catch (error) {
    json(response, 500, { error: String(error.message || error).slice(0, 600) });
  }
});

server.listen(args.port, '127.0.0.1', () => {
  const address = server.address();
  console.log(`请在此地址查看 Prototype Talk 原型说明：http://127.0.0.1:${address.port}/`);
  if (hasJsxSource) console.log('项目自己的 Vite 开发地址只显示原 Demo，不加载 Prototype Talk 说明窗。');
  console.log(`扫描：${store.data.scan_summary.operation_count} 个控件候选，${store.data.scan_summary.scanned_files} 个资料文件`);
  console.log(`当前结果：${store.data.page_specs.filter((item) => item.source_snapshot_id === store.data.source_snapshot_id).length} 份页面说明、${store.data.cards.filter((item) => item.source_snapshot_id === store.data.source_snapshot_id && !item.invalidated_reason).length} 张交互卡。`);
  console.log(`结果目录：${store.outputRoot}`);
  if (runtimeRoot !== sourceRoot) console.log(`页面预览：${runtimeRoot}（源码证据仍读取 ${sourceRoot}）`);
  if (!args.noAi) {
    const pages = projectPages(store.sourceRoot);
    const batches = progressiveBatches(pages);
    const first = batches.length ? store.createProjectJob(batches[0]) : null;
    firstProjectJobId = first?.status === 'queued' ? first.job_id : '';
    if (first) enqueueProject(first);
    for (const job of store.data.project_jobs.filter((item) => item.status === 'queued' && item.source_snapshot_id === store.data.source_snapshot_id && item.job_id !== firstProjectJobId)) enqueueProject(job);
    for (const batch of batches.slice(1)) enqueueProject(store.createProjectJob(batch));
    for (const job of store.data.jobs.filter((item) => item.status === 'queued' && item.source_snapshot_id === store.data.source_snapshot_id)) enqueue(job);
    console.log(`首轮页面解读：${pages.length} 个页面，${projectQueue.length} 批待生成`);
  }
  if (args.noAi) console.log('本地索引完成；模型解析项目未运行，新的完整原型说明尚未生成。');
  if (args.focus && args.noAi) console.log('已记录重点控件；该控件尚未生成新的完整说明。');
  else if (args.focus) {
    const operation = store.data.operations.find((item) => item.label.includes(args.focus));
    if (operation) enqueue(store.createJob('initial_scan', operation.operation_id, [], `首次扫描重点：${args.focus}`));
    else console.log(`未找到重点控件：${args.focus}`);
  }
});
setInterval(() => { try { syncSource(); } catch (error) { console.error(`原型同步失败：${String(error.message || error).slice(0, 200)}`); } }, 2500).unref();
