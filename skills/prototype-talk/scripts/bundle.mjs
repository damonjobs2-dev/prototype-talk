import fs from 'node:fs';
import path from 'node:path';

function copyRuntimeTree(sourceDir, targetDir, excludeTests = false) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store' || excludeTests && (entry.name === 'test.mjs' || entry.name.endsWith('.test.mjs'))) continue;
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) copyRuntimeTree(source, target, excludeTests);
    else if (entry.isFile() && source !== target) fs.copyFileSync(source, target);
  }
}

export function bundleProjectViewer(store, scriptDir, assetDir) {
  if (store.outputRoot !== path.join(store.sourceRoot, 'docs', 'prototype-talk')) return;
  const viewerRoot = path.join(store.outputRoot, 'viewer');
  const scriptTarget = path.join(viewerRoot, 'scripts');
  const assetTarget = path.join(viewerRoot, 'assets');
  copyRuntimeTree(scriptDir, scriptTarget, true);
  copyRuntimeTree(assetDir, assetTarget);
  const readme = path.join(store.outputRoot, 'README.md');
  const content = '<!-- Prototype Talk generated viewer guide -->\n# Prototype Talk 原型说明\n\n本目录保存项目的原型评审结果。`project-spec.md` 是首轮页面说明；`review-state.json` 保存规则、依据、待办和操作记录。`requirements.generated.md`、`technical-design.generated.md` 与 `handoff.generated.md` 根据当前确认项自动更新。\n\n首次调用 Prototype Talk Skill 时，在对话中选择解析方式并确认项目资料范围。当前对话模型可在聊天期间生成说明；Codex CLI 是聊天结束后继续自动处理的可选方式；仅本地索引不会生成新说明。\n\n在项目根目录运行（需要 Node.js）：\n\n```bash\nnode docs/prototype-talk/viewer/scripts/server.mjs --source . --port 4179\n```\n\n未指定模式时，服务建立本地索引并把未完成的页面、交互放进待解析队列；当前对话中的 Skill 领取、解释并写回卡片。关闭对话后，浏览器点击只会排队，无法自行唤醒对话。需要无人值守时，可在确认 Codex CLI 的数据目的地和输入范围并获明确授权后使用 `--cli-model --model-authorized`。若只看已有结果，使用 `--index-only`。分享本目录前，请检查操作记录中是否包含不应交付的数据。\n';
  if (!fs.existsSync(readme)) fs.writeFileSync(readme, content, 'utf8');
  else {
    const existing = fs.readFileSync(readme, 'utf8');
    if (existing.includes('<!-- Prototype Talk generated viewer guide -->') || existing.includes('默认只在本地扫描、记录和查看。') || existing.includes('可去掉它来启用按需解读')) fs.writeFileSync(readme, content, 'utf8');
  }
}
