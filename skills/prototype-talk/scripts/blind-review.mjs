import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const template = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/blind-review-template.html');

export function renderBlindReview(cases, status = { paused: false, reason: '' }) {
  const safeJson = JSON.stringify(cases).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  const safeStatus = JSON.stringify(status).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  return fs.readFileSync(template, 'utf8').replace('__BLIND_CASES__', safeJson).replace('__BLIND_STATUS__', safeStatus);
}
