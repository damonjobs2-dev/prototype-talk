#!/usr/bin/env node
import { inspectInput } from './input.mjs';
import { spawnSync } from 'node:child_process';

const args = {};
for (let index = 2; index < process.argv.length; index++) {
  const item = process.argv[index];
  if (['--source', '--link', '--provider'].includes(item)) args[item.slice(2)] = process.argv[++index];
  else if (item === '--check-cli') args.checkCli = true;
  else if (item === '--help') { console.log('用法: node doctor.mjs --source <本地Demo目录> | --link <Figma/Axure链接> [--provider axure|figma-site] [--check-cli]；默认不检查可选 Codex CLI'); process.exit(0); }
  else throw new Error(`未知参数：${item}`);
}
if (!!args.source === !!args.link) throw new Error('请提供 --source 或 --link 中的一个');
try {
  const report = inspectInput(args.source || args.link, { provider: args.provider });
  if (report.input.kind === 'local_source' && report.status === 'ready_for_model_parse') {
    report.model_destination = '当前对话模型（默认；本地检查不会发送项目资料）；CLI 自动模式需另行核对目的地';
    report.model_cli = 'not_checked';
    if (args.checkCli) {
      const cli = process.env.TECH_PROTOTYPE_CODEX_CLI || 'codex';
      const check = spawnSync(cli, ['--version'], { encoding: 'utf8', timeout: 5000 });
      report.model_cli = check.status === 0 ? 'available' : 'unavailable';
      if (check.status !== 0) report.warning = `${report.warning}；未检测到 Codex CLI：当前对话模型仍可生成说明，只有 CLI 自动模式不可用`;
    }
  }
  console.log(JSON.stringify(report, null, 2));
  if (['blocked_by_schema', 'needs_input_adapter_or_fix'].includes(report.status)) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ status: 'blocked', error: error.message }));
  process.exitCode = 1;
}
