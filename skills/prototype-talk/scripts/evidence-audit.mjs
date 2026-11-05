import fs from 'node:fs';
import path from 'node:path';

const sourceExtensions = new Set(['.html', '.js', '.mjs', '.css', '.json', '.jsx', '.tsx', '.vue']);
const documentExtensions = new Set(['.md', '.txt']);

function fileLocation(root, reference) {
  const match = String(reference || '').match(/^(.+?):(\d+)(?:-(\d+))?$/);
  if (!match) return null;
  const relative = match[1];
  if (path.isAbsolute(relative) || relative.startsWith('docs/prototype-talk/')) return null;
  const absolute = path.resolve(root, relative);
  const realRoot = fs.realpathSync(root);
  if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`) || !fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return null;
  const realFile = fs.realpathSync(absolute);
  if (!realFile.startsWith(`${realRoot}${path.sep}`) || fs.statSync(realFile).size > 2_000_000) return null;
  const line = Number(match[2]);
  const endLine = match[3] ? Number(match[3]) : line;
  const lines = fs.readFileSync(realFile, 'utf8').split(/\r?\n/);
  if (line < 1 || endLine < line || endLine > lines.length || endLine - line > 200) return null;
  return { path: relative, line, kind: documentExtensions.has(path.extname(relative).toLowerCase()) ? 'document' : sourceExtensions.has(path.extname(relative).toLowerCase()) ? 'source' : 'other' };
}

export function auditEvidence(root, origin, references, { traceIds = [], supplementIds = [], ruleIds = [] } = {}) {
  if (origin === 'proposed') return { status: 'proposal', valid: [], invalid: [], semantic_support: 'not_checked' };
  const valid = [];
  const invalid = [];
  for (const reference of Array.isArray(references) ? references : []) {
    const value = String(reference || '');
    const file = fileLocation(root, value);
    const runtimeTrace = value.match(/^(trace_[^:]+)(?::(?:before|after|events(?:\[\d+(?:-\d+)?\])?))?$/)?.[1];
    const supported = origin === 'source_observed' && file?.kind === 'source' ||
      origin === 'documented' && file?.kind === 'document' ||
      origin === 'runtime_observed' && runtimeTrace && traceIds.includes(runtimeTrace) ||
      origin === 'user_supplied' && (supplementIds.includes(value.replace(/^supplement:/, '')) || ruleIds.includes(value.replace(/^rule:/, '')));
    (supported ? valid : invalid).push(value);
  }
  return { status: valid.length ? invalid.length ? 'partially_resolved' : 'location_verified' : 'missing_or_invalid', valid, invalid, semantic_support: 'not_checked' };
}

export function auditModelResult(root, result, context = {}) {
  const claims = (result.claims || []).map((claim) => ({ ...claim, evidence_audit: auditEvidence(root, claim.origin, claim.evidence, context) }));
  const expectedEffects = (result.expected_effects || []).map((effect) => ({ ...effect, evidence_audit: auditEvidence(root, effect.origin, effect.evidence, context) }));
  return { ...result, claims, expected_effects: expectedEffects };
}
