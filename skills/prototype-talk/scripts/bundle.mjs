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
  const content = '<!-- Prototype Talk generated viewer guide -->\n# Prototype Talk 技术视图\n\n本目录保存项目的技术原型评审结果。`project-spec.md` 是首轮页面说明；`review-state.json` 保存规则、依据、待办和操作记录。`requirements.generated.md`、`technical-design.generated.md` 与 `handoff.generated.md` 根据当前确认项自动更新。\n\n在项目根目录运行（需要 Node.js）：\n\n```bash\nnode docs/prototype-talk/viewer/scripts/server.mjs --source . --port 4179 --model-parse\n```\n\n`--model-parse` 表示“模型解析项目”：先建立本地数据索引，再调用 Codex 模型读取相关源码、PRD、Mock 和操作记录，生成页面说明与功能卡片，结果保存在此目录。若只需建立本地索引、记录操作或查看已有结果，改用 `--index-only`；该模式不会生成新的完整说明。分享本目录前，请检查操作记录中是否包含不应交付的数据。\n';
  if (!fs.existsSync(readme)) fs.writeFileSync(readme, content, 'utf8');
  else {
    const existing = fs.readFileSync(readme, 'utf8');
    if (existing.includes('<!-- Prototype Talk generated viewer guide -->') || existing.includes('默认只在本地扫描、记录和查看。') || existing.includes('可去掉它来启用按需解读')) fs.writeFileSync(readme, content, 'utf8');
  }
}
