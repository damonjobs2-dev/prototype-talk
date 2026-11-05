import fs from 'node:fs';
import path from 'node:path';

function citedSource(root, items) {
  const references = items
    .filter((item) => item.origin === 'source_observed')
    .flatMap((item) => item.evidence_audit?.valid || []);
  const lines = [];
  for (const reference of new Set(references)) {
    const match = reference.match(/^(.+?):(\d+)(?:-(\d+))?$/);
    if (!match) continue;
    const file = path.resolve(root, match[1]);
    if (!file.startsWith(`${path.resolve(root)}${path.sep}`) || !fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const index = Number(match[2]) - 1;
    const end = match[3] ? Number(match[3]) : Number(match[2]);
    lines.push(content.slice(Math.max(0, index - 1), Math.min(content.length, Math.max(index + 2, Math.min(index + 30, end)))).join('\n'));
  }
  return lines.join('\n');
}

export function checkResultQuality(root, operation, result) {
  const checks = [];
  const add = (code, text) => checks.push({ code, text, severity: 'needs_review' });
  for (const item of [...(result.claims || []), ...(result.expected_effects || [])]) {
    if (item.origin !== 'proposed' && item.evidence_audit?.status === 'missing_or_invalid') {
      add('invalid_evidence', `“${item.text || item.change || item.target}”的引用无法定位到对应类型的资料。`);
    }
  }
  const submit = operation?.trigger === 'submit' || operation?.anchor?.type === 'submit' || /^(保存|提交|创建|新建|确认删除)/.test(operation?.label || '');
  for (const item of [...(result.claims || []), ...(result.expected_effects || [])]) {
    if (item.origin !== 'source_observed' || !item.evidence_audit?.valid?.length) continue;
    const wording = `${item.text || ''} ${item.change || ''} ${item.condition || ''}`;
    const evidence = citedSource(root, [item]);
    if (/编辑|修改|更新/.test(wording) && !/\b(?:edit|update|override|draft|patch|set[A-Z])\b|\.id\b|覆盖/.test(evidence)) add('branch_evidence_mismatch', `“${item.text || item.change}”引用的位置未能定位编辑或更新分支，请核对引用语义。`);
    if (/校验未通过|缺少|为空|不合法/.test(wording) && !/\bif\s*\(|\breturn\b|\berror\b|\bvalidate\b|\bnotify\b|\btoast\b/.test(evidence)) add('branch_evidence_mismatch', `“${item.text || item.change}”引用的位置未能定位校验失败分支，请核对引用语义。`);
  }
  if (!submit) return checks;
  const cited = citedSource(root, [...(result.claims || []), ...(result.expected_effects || [])]);
  const effects = result.expected_effects || [];
  const failed = effects.some((item) => /为空|未通过|缺少|失败|无效|不合法|错误|驳回/.test(`${item.condition} ${item.change}`));
  const success = effects.some((item) => /通过|成功|有效|新建|创建|保存|已完成/.test(`${item.condition} ${item.change}`) && !/未通过|失败|无效|不合法/.test(`${item.condition} ${item.change}`));
  const hasValidation = /\bif\s*\([^\n]{0,200}\)[^\n]{0,180}\breturn\b|\bif\s*\([^\n]{0,200}\)[\s\S]{0,160}\breturn\b/.test(cited);
  const hasWrite = /\bset[A-Z]\w*\s*\(|\blocalStorage\.(?:setItem|removeItem)\s*\(|\b(?:fetch|axios|save|create|submit)\s*\(/.test(cited);
  if (hasValidation && !failed) add('missing_failure_outcome', '源码有校验返回分支，但卡片没有交代未通过时的提示和页面状态。');
  if (hasWrite && !success) add('missing_success_outcome', '源码有数据写入或提交分支，但卡片没有交代通过后的数据和页面结果。');
  if (hasWrite && !(result.claims || []).some((item) => item.section === 'data' && item.origin !== 'proposed')) add('missing_data_effect', '源码有数据写入或提交分支，但卡片没有说明写入对象或数据去向。');
  return checks;
}
