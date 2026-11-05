import fs from 'node:fs';
import path from 'node:path';
import { interfaceContract } from './contracts.mjs';

const text = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const safe = (value) => text(value).replace(/[\r\n|]/g, ' ');
const activeRules = (data, scope, pagePath, operationId = null) => (data.rules || []).filter((rule) =>
  rule.scope === scope && rule.page_path === pagePath && (operationId === null || rule.operation_id === operationId) && !rule.superseded_by);
const operationName = (data, operationId) => data.operations.find((item) => item.operation_id === operationId)?.label || operationId;
const operationPage = (data, operationId) => {
  const operation = data.operations.find((item) => item.operation_id === operationId);
  const page = operation?.logical_screen_ids?.[0] || operation?.page_hint;
  return page === '/' ? '/index.html' : page;
};
const displayLocation = (field) => field.kind === 'table_column' ? '列表列' : field.kind === 'detail_field' ? '详情字段' : field.observed_usage === 'filter' ? '筛选字段' : '表单字段';

export function renderDocuments(data) {
  const current = data.page_specs.filter((page) => page.source_snapshot_id === data.source_snapshot_id);
  const validCards = (data.cards || []).filter((card) => !card.invalidated_reason);
  const cardPages = validCards.map((card) => operationPage(data, card.operation_id)).filter((item) => item?.startsWith('/'));
  const pages = [...new Set([...current.map((page) => page.path), ...(data.rules || []).filter((rule) => !rule.superseded_by).map((rule) => rule.page_path), ...(data.display_fields || []).filter((field) => field.status !== 'removed').map((field) => field.page_path), ...(data.api_fields || []).filter((field) => !field.removed_at).map((field) => field.page_path), ...cardPages])];
  const header = (title) => [`# ${title}`, '', `源码快照：${data.source_snapshot_id}`, '', '自动生成；人工确认的规则优先展示。原型观察、需求决定和技术草案均保留来源。请在 Prototype Talk 中补充或纠正。', ''];
  const prd = header('Prototype Talk · 需求文档');
  const technical = header('Prototype Talk · 技术方案');
  const blockers = [];
  for (const pagePath of pages) {
    const page = current.filter((item) => item.path === pagePath).at(-1);
    const title = page?.title || pagePath;
    prd.push(`## ${title}`, '', `页面：${pagePath}`, '', page?.purpose || '页面用途待产品确认。', '');
    if (page?.layout?.length) prd.push('### 页面展示', '', ...page.layout.map((item) => `- ${safe(item.text)}（${item.origin === 'source_observed' ? '原型观察' : '资料要求'}）`), '');
    if (page?.functions?.length) prd.push('### 主要功能与验收', '', ...page.functions.map((item) => `- ${safe(item.name)}：${safe(item.outcome)}`), '');
    if (page?.states?.length) prd.push('### 页面状态', '', ...page.states.map((item) => `- ${safe(item.text)}（${item.origin === 'source_observed' ? '原型观察' : '资料要求'}）`), '');
    if (page?.data?.length) prd.push('### 业务数据', '', ...page.data.map((item) => `- ${safe(item.text)}（${item.origin === 'source_observed' ? '原型观察' : '资料要求'}）`), '');
    const displayFields = (data.display_fields || []).filter((field) => field.page_path === pagePath && field.status !== 'removed');
    if (displayFields.length) {
      prd.push('### 页面展示字段', '', '字段是否存在以原型为准；源码键和 Mock 示例不等于正式接口字段。', '', '| 字段名称 | 位置与可见性 | 原型依据／说明 |', '| --- | --- | --- |');
      for (const field of displayFields) prd.push(`| ${safe(field.label)} | ${displayLocation(field)}；${field.default_visible === true ? '默认显示' : field.default_visible === false ? '默认隐藏' : field.runtime_visible ? '当前可见' : '显隐待观察'} | ${field.ui_only ? '前端呈现；' : ''}${field.source_key ? `源码键 ${safe(field.source_key)}；` : ''}${field.binding_candidates?.length ? `绑定候选 ${field.binding_candidates.map((item) => safe(item.expression)).join('、')}；` : ''}${field.observed_sample ? `页面示例 ${safe(field.observed_sample)}；` : ''}${field.evidence?.map((item) => `${safe(item.path)}:${item.line}`).join('、') || '运行时观察'}${field.status === 'needs_review' ? '；原型变化待复核' : ''} |`);
      prd.push('');
    }
    const productRules = activeRules(data, 'product', pagePath);
    const pageRules = productRules.filter((rule) => !rule.operation_id);
    if (pageRules.length) prd.push('### 产品已补充', '', ...pageRules.map((rule) => `- **${safe(rule.label)}**：${safe(rule.text)}（人工确认${rule.review_status === 'prototype_changed' ? '；原型变化后待复核' : ''}）`), '');
    const operationIds = [...new Set([...productRules.map((rule) => rule.operation_id), ...(data.supplements || []).filter((item) => item.operation_id && operationPage(data, item.operation_id) === pagePath).map((item) => item.operation_id)].filter(Boolean))];
    for (const operationId of operationIds) {
      const rules = productRules.filter((rule) => rule.operation_id === operationId);
      const answers = (data.supplements || []).filter((item) => item.operation_id === operationId).flatMap((item) => item.answers || []);
      prd.push(`### ${safe(operationName(data, operationId))}`, '', ...rules.map((rule) => `- **${safe(rule.label)}**：${safe(rule.text)}（人工确认${rule.review_status === 'prototype_changed' ? '；原型变化后待复核' : ''}）`), ...answers.map((answer) => `- **${safe(answer.question)}**：${safe(answer.value)}（人工补充）`), '');
    }
    if (page?.open_questions?.length) prd.push('### 待核对', '', ...page.open_questions.map((item) => `- ${safe(item)}`), '');

    technical.push(`## ${title}`, '', `页面：${pagePath}`, '', page?.purpose ? `业务目标：${safe(page.purpose)}` : '业务目标待核对。', '');
    if (page?.layout?.length) technical.push('### 前端布局依据', '', ...page.layout.map((item) => `- ${safe(item.text)}（${item.origin === 'source_observed' ? '原型观察' : '资料要求'}）`), '');
    const pageApiFields = (data.api_fields || []).filter((field) => field.page_path === pagePath && !field.removed_at);
    const technicalRules = activeRules(data, 'technical', pagePath);
    const pageTechnicalRules = technicalRules.filter((rule) => !rule.operation_id);
    const pageContract = interfaceContract(data, pagePath);
    const pageEntry = (slot) => pageTechnicalRules.filter((rule) => rule.slot === slot).at(-1);
    const pageValue = (slot) => pageEntry(slot) ? `${safe(pageEntry(slot).text)}（技术确认${pageEntry(slot).review_status === 'prototype_changed' ? '；原型变化待复核' : ''}）` : '待技术确认';
    if (displayFields.length) {
      technical.push('### 前端展示字段与数据映射', '', '| 页面字段 | 展示方式 | 接口映射 |', '| --- | --- | --- |');
      for (const field of displayFields) {
        const mapping = pageApiFields.filter((item) => item.display_field_id === field.field_id).map((item) => item.key).join('、');
        technical.push(`| ${safe(field.label)}（${displayLocation(field)}） | ${field.ui_only ? '前端呈现' : field.default_visible === true ? '默认显示' : field.default_visible === false ? '默认隐藏' : field.runtime_visible ? '当前可见' : '显隐待观察'} | ${field.ui_only ? '无需接口字段' : mapping ? safe(mapping) : '待标明接口、计算或静态来源'} |`);
        if (!field.ui_only && !mapping && field.kind !== 'form_field') blockers.push(`${pagePath} / ${field.label}：页面展示字段尚未映射到响应、计算或静态来源`);
      }
      technical.push('');
    }
    if (pageContract.status !== 'unstarted') {
      technical.push('### 页面级接口契约', '', '这份契约只对应页面级用途；新增、保存等具体操作另列独立契约。', '', `- 用途：${pageValue('api_name')}`, `- 方法与路径：${pageValue('method_path')}`, `- 请求组合与约束：${pageValue('request')}`, `- 响应包裹与状态码：${pageValue('response')}`, `- 权限与认证：${pageValue('auth')}`, `- 异常与重试：${pageValue('errors')}`, '');
      for (const missing of pageContract.missing) blockers.push(`${pagePath} / 页面级接口：${missing}待确认`);
    }
    if (displayFields.length || pageApiFields.length) {
      technical.push('#### 字段定义', '', '页面字段按原型预填并固定存在；源码键和示例是候选，不能直接当作正式接口。技术补充字段可另加。', '', '| 归属 | 字段 ID | 字段名称 | 字段说明 | 类型 | 必有／可空 | 状态 |', '| --- | --- | --- | --- | --- | --- | --- |');
      for (const field of displayFields) {
        const mapped = pageContract.fields.filter((item) => item.display_field_id === field.field_id).at(-1);
        const location = displayLocation(field);
        const direction = field.ui_only ? '前端生成' : mapped?.direction || (field.kind === 'form_field' ? '请求候选' : '响应候选');
        const key = field.ui_only ? '—' : mapped?.key || field.source_key || '待定义';
        const description = mapped?.description || `页面${location}「${field.label}」${field.observed_sample ? `；Demo 示例：${field.observed_sample}` : ''}`;
        const status = field.ui_only ? '原型固定；无需接口' : mapped ? `技术已确认${mapped.review_status === 'prototype_changed' ? '；原型变化待复核' : ''}` : `原型预填；${field.source_key ? '字段 ID 为 Demo 键候选' : '字段 ID 待定义'}`;
        technical.push(`| ${safe(direction)} | \`${safe(key)}\` | ${safe(field.label)} | ${safe(description)} | ${mapped ? safe(mapped.type) : '待技术确认'} | ${mapped ? `${mapped.required ? '必有' : '可选'}${mapped.nullable ? '／可空' : ''}` : '待技术确认'} | ${safe(status)} |`);
      }
      const displayIds = new Set(displayFields.map((item) => item.field_id));
      for (const field of pageContract.fields.filter((item) => !displayIds.has(item.display_field_id))) technical.push(`| ${safe(field.direction)} · 页面 | \`${safe(field.key)}\` | ${safe(field.label)} | ${safe(field.description)} | ${safe(field.type)} | ${field.required ? '必有' : '可选'}${field.nullable ? '／可空' : ''} | ${field.display_field_id ? '原型字段已变化，映射待复核' : '技术补充'}${field.review_status === 'prototype_changed' ? '；原型变化待复核' : ''} |`);
      technical.push('');
    }
    if (pageTechnicalRules.length || pageApiFields.length) {
      technical.push('### 实现补充', '', `- 前端状态与处理：${pageValue('frontend')}`, `- 后端规则与数据：${pageValue('backend')}`, '');
    }
    const technicalIds = [...new Set([...technicalRules.map((rule) => rule.operation_id), ...pageApiFields.map((field) => field.operation_id), ...validCards.filter((card) => card.source_snapshot_id === data.source_snapshot_id && data.operations.find((item) => item.operation_id === card.operation_id)?.page_hint === pagePath).map((card) => card.operation_id)].filter(Boolean))];
    if (!technicalIds.length && pageContract.status === 'unstarted' && !pageTechnicalRules.length) { technical.push('接口与实现方案待技术补充。', ''); if (displayFields.some((field) => !field.ui_only)) blockers.push(`${pagePath}：页面有数据字段，接口或静态／计算来源尚待确认`); }
    for (const operationId of technicalIds) {
      technical.push(`### ${safe(operationName(data, operationId))}`, '');
      const rules = technicalRules.filter((rule) => rule.operation_id === operationId);
      const contract = interfaceContract(data, pagePath, operationId);
      const card = validCards.filter((item) => item.operation_id === operationId && item.source_snapshot_id === data.source_snapshot_id).at(-1);
      const entry = (slot) => rules.filter((rule) => rule.slot === slot).at(-1);
      const value = (slot) => entry(slot) ? `${safe(entry(slot).text)}（技术确认${entry(slot).review_status === 'prototype_changed' ? '；原型变化待复核' : ''}）` : '待技术确认';
      const businessRules = productRules.filter((rule) => rule.operation_id === operationId);
      if (businessRules.length) technical.push('#### 对应的产品规则', '', ...businessRules.map((rule) => `- ${safe(rule.label)}：${safe(rule.text)}`), '');
      const draftClaims = (card?.claims || []).filter((claim) => claim.confirmation_state !== 'rejected' && ['interface', 'field', 'data', 'flow', 'constraint'].includes(claim.section) && !['missing_or_invalid', 'partially_resolved'].includes(claim.evidence_audit?.status));
      if (draftClaims.length) technical.push('#### 模型整理的实现线索（待技术核对）', '', ...draftClaims.slice(0, 12).map((claim) => `- ${safe(claim.text)}（${safe(claim.origin)}；${(claim.evidence || []).map(safe).join('、') || '依据待补'}）`), '');
      const unsupportedClaims = (card?.claims || []).filter((claim) => ['missing_or_invalid', 'partially_resolved'].includes(claim.evidence_audit?.status));
      if (unsupportedClaims.length) blockers.push(`${pagePath} / ${operationName(data, operationId)}：${unsupportedClaims.length} 条模型判断的引用位置待核对`);
      if (entry('frontend')) technical.push('#### 前端方案', '', `- 页面状态与处理：${value('frontend')}`, '');
      if (contract.status !== 'unstarted') {
        technical.push('#### 本操作的前后端接口契约', '', `- 方法与路径：${value('method_path')}`, `- 请求整体约束：${value('request')}`, `- 成功响应：${value('response')}`, `- 权限与认证：${value('auth')}`, `- 错误与重试：${value('errors')}`, '');
        if (contract.fields.length) {
          technical.push('##### 本操作补充的接口字段', '', '| 归属 | 字段 ID | 字段名称 | 字段说明 | 类型 |', '| --- | --- | --- | --- | --- |');
          for (const field of contract.fields) technical.push(`| ${safe(field.direction)} | \`${safe(field.key)}\` | ${safe(field.label)} | ${safe(field.description)} | ${safe(field.type)} |`);
          technical.push('');
        }
        for (const missing of contract.missing) blockers.push(`${pagePath} / ${operationName(data, operationId)}：${missing}待确认`);
      }
      if (entry('backend')) technical.push('#### 后端规则与数据', '', `- ${value('backend')}`, '');
      technical.push('');
    }
  }
  for (const rule of (data.rules || []).filter((item) => !item.superseded_by && item.review_status === 'prototype_changed')) blockers.push(`${rule.page_path} / ${rule.label}：原型变化后需复核人工确认规则`);
  for (const field of (data.api_fields || []).filter((item) => !item.removed_at && item.review_status === 'prototype_changed')) blockers.push(`${field.page_path} / ${field.key}：原型变化后需复核接口字段`);
  if (!pages.length) {
    prd.push('页面解读尚未生成。可先在原型旁补充规则，文档会随之更新。', '');
    technical.push('页面解读尚未生成。技术人员可在原型旁补充接口与实现规则。', '');
  }
  const handoff = header('Prototype Talk · 开发交付检查');
  handoff.push('需求文档：`requirements.generated.md`', '', '技术方案：`technical-design.generated.md`', '', `当前状态：${blockers.length ? '仍有待确认项，不宜作为完整开发契约' : '已填写关键接口项，仍需技术评审与实现验证'}`, '', '## 待确认', '', ...(blockers.length ? blockers.map((item) => `- ${safe(item)}`) : ['- 暂无自动识别的契约缺口。']), '');
  return { 'requirements.generated.md': prd.join('\n'), 'technical-design.generated.md': technical.join('\n'), 'handoff.generated.md': handoff.join('\n') };
}

export function writeDocuments(outputRoot, data) {
  for (const [name, content] of Object.entries(renderDocuments(data))) fs.writeFileSync(path.join(outputRoot, name), content, 'utf8');
}
