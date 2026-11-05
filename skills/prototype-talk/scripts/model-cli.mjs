export function modelCliArgs(sourceRoot, schemaPath, env = process.env) {
  const transport = env.TECH_PROTOTYPE_TRANSPORT === 'default' ? 'default' : 'https';
  const args = ['exec', '--ignore-user-config', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral'];
  if (env.TECH_PROTOTYPE_MODEL) args.push('-m', env.TECH_PROTOTYPE_MODEL);
  args.push('-c', `model_reasoning_effort=${env.TECH_PROTOTYPE_REASONING || 'medium'}`);
  if (transport === 'https') {
    args.push(
      '-c', 'model_provider="prototype_talk_https"',
      '-c', 'model_providers.prototype_talk_https.name="Prototype Talk HTTPS"',
      '-c', 'model_providers.prototype_talk_https.base_url="https://chatgpt.com/backend-api/codex"',
      '-c', 'model_providers.prototype_talk_https.wire_api="responses"',
      '-c', 'model_providers.prototype_talk_https.requires_openai_auth=true',
      '-c', 'model_providers.prototype_talk_https.supports_websockets=false',
    );
  }
  args.push('-C', sourceRoot, '--output-schema', schemaPath, '-');
  return { args, transport };
}
