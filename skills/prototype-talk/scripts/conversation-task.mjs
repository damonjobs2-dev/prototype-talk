#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { tokenPath } from './conversation-bridge.mjs';

const [command, ...argv] = process.argv.slice(2);
const args = {};
for (let index = 0; index < argv.length; index++) {
  if (!['--source', '--port', '--out', '--output', '--file'].includes(argv[index])) throw new Error(`未知参数：${argv[index]}`);
  args[argv[index].slice(2)] = argv[++index];
}
if (!['next', 'submit'].includes(command) || !args.source || !args.port || command === 'submit' && !args.file) {
  throw new Error('用法: node conversation-task.mjs next --source <Demo目录> --port <端口> [--output <任务JSON>]；node conversation-task.mjs submit --source <Demo目录> --port <端口> --file <结果JSON>');
}
const sourceRoot = path.resolve(args.source);
const token = fs.readFileSync(tokenPath(sourceRoot, Number(args.port)), 'utf8').trim();
const endpoint = `http://127.0.0.1:${Number(args.port)}/__tech/conversation/${command}`;
const body = command === 'next' ? {} : JSON.parse(fs.readFileSync(path.resolve(args.file), 'utf8'));
const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-prototype-talk-token': token }, body: JSON.stringify(body) });
const value = await response.json();
if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
if (args.output) {
  fs.writeFileSync(path.resolve(args.output), JSON.stringify(value, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: value.status, job_id: value.job_id || '', type: value.type || '', output: path.resolve(args.output) }));
} else console.log(JSON.stringify(value, null, 2));
