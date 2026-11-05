#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReviewStore } from './store.mjs';
import { blindPair } from './benchmark.mjs';
import { renderBlindReview } from './blind-review.mjs';

const [sourceArg, directoryArg, firstPortArg = '4201', secondPortArg = '4202'] = process.argv.slice(2);
if (!sourceArg || !directoryArg) throw new Error('用法: benchmark-preview.mjs <source-root> <benchmark-dir> [version-1-port] [version-2-port]');
const sourceRoot = path.resolve(sourceArg);
const directory = path.resolve(directoryArg);
const ports = [Number(firstPortArg), Number(secondPortArg)];
if (ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65535) || ports[0] === ports[1]) throw new Error('预览端口无效');
const sourceState = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'docs/prototype-talk/review-state.json'), 'utf8'));
const keys = JSON.parse(fs.readFileSync(path.join(directory, 'answer-key.json'), 'utf8'));
const stores = ports.map((port, index) => {
  const output = path.join(directory, `preview-version-${index + 1}`);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'review-state.json'), JSON.stringify(sourceState, null, 2) + '\n');
  return { port, output, store: new ReviewStore(sourceRoot, output) };
});

const visible = [];
for (const key of keys) {
  const frozen = JSON.parse(fs.readFileSync(path.join(directory, `${key.case_id}.json`), 'utf8'));
  const reviewed = JSON.parse(fs.readFileSync(path.join(directory, `${key.case_id}.review.json`), 'utf8'));
  if (frozen.source_snapshot_id !== sourceState.source_snapshot_id) throw new Error(`案例过期：${key.case_id}`);
  const pair = blindPair(frozen, reviewed, key);
  for (let index = 0; index < 2; index++) {
    const kind = index === 0 ? key.version_1 : key.version_2;
    const selected = kind === 'baseline' ? frozen.baseline : reviewed.reviewed;
    const auditIssues = kind === 'reviewed' ? (reviewed.audit_flags || []).map((flag) => ({
      text: '操作结果或结论的依据待核对',
      reason: `引用位置未通过程序校验：${flag.text}`,
      evidence: [],
      questions: [],
    })) : [];
    const draft = { ...selected, issues: [...(selected.issues || []), ...auditIssues] };
    const { store } = stores[index];
    const job = store.createJob('benchmark_preview', key.case_id, frozen.audit_context?.traceIds || [], '盲评查看');
    store.addResult(job, draft);
    const url = new URL(frozen.pack.logical_screen_id || '/', `http://127.0.0.1:${ports[index]}`);
    url.searchParams.set('tech_operation', key.case_id);
    pair.visible.versions[index] = { label: `版本 ${index + 1}`, viewer_url: url.toString() };
  }
  visible.push(pair.visible);
}
const statusFile = path.join(directory, 'evaluation-status.json');
const evaluationStatus = fs.existsSync(statusFile) ? JSON.parse(fs.readFileSync(statusFile, 'utf8')) : { paused: false, reason: '' };
fs.writeFileSync(path.join(directory, 'blind-review.html'), renderBlindReview(visible, evaluationStatus));
for (const item of stores) console.log(`版本 ${stores.indexOf(item) + 1}：node skills/prototype-talk/scripts/server.mjs --source ${sourceRoot} --out ${item.output} --port ${item.port} --index-only`);
console.log(`盲评页面：${path.join(directory, 'blind-review.html')}`);
