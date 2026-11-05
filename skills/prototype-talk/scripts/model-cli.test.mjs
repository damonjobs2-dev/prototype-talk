import test from 'node:test';
import assert from 'node:assert/strict';
import { modelCliArgs } from './model-cli.mjs';

test('model calls use authenticated HTTPS without WebSocket retry by default', () => {
  const { args, transport } = modelCliArgs('/tmp/demo', '/tmp/schema.json', {});
  assert.equal(transport, 'https');
  assert.ok(args.includes('model_providers.prototype_talk_https.supports_websockets=false'));
  assert.ok(args.includes('model_providers.prototype_talk_https.requires_openai_auth=true'));
  assert.ok(args.includes('model_providers.prototype_talk_https.base_url="https://chatgpt.com/backend-api/codex"'));
});

test('the previous CLI transport remains an explicit fallback', () => {
  const { args, transport } = modelCliArgs('/tmp/demo', '/tmp/schema.json', { TECH_PROTOTYPE_TRANSPORT: 'default' });
  assert.equal(transport, 'default');
  assert.ok(!args.some((arg) => arg.includes('supports_websockets')));
});
