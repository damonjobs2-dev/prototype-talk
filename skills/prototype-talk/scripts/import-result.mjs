#!/usr/bin/env node
import fs from 'node:fs';
import { ReviewStore } from './store.mjs';

const args = {};
for (let index = 2; index < process.argv.length; index += 2) args[process.argv[index].replace(/^--/, '')] = process.argv[index + 1];
if (!args.source || !args.out || !args.file || (!args.operation && !args.label)) throw new Error('用法: node import-result.mjs --source <目录> --out <结果目录> --file <结果JSON> --operation <ID> 或 --label <控件名>');
const store = new ReviewStore(args.source, args.out);
const operation = args.operation ? store.data.operations.find((item) => item.operation_id === args.operation) : store.data.operations.find((item) => item.label === args.label);
if (!operation) throw new Error('未找到操作');
const result = JSON.parse(fs.readFileSync(args.file, 'utf8'));
if (!result.title || !Array.isArray(result.claims) || !Array.isArray(result.issues)) throw new Error('结果缺少 title、claims 或 issues');
const job = store.createJob('initial_scan', operation.operation_id, [], '本次 Codex 会话导入的参考解读');
job.generator = 'assistant_reference';
store.save();
const { card, issues } = store.addResult(job, result);
console.log(JSON.stringify({ operation_id: operation.operation_id, card_id: card.card_id, version: card.version, claims: card.claims.length, candidate_issues: issues.length }));
