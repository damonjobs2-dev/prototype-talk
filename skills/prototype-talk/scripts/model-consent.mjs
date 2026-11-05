export const MODEL_DESTINATION = 'ChatGPT/Codex';
export const MODEL_INPUT_SCOPE = ['source', 'prd', 'mock', 'operation_records'];

export function modelConsentRecord(sourceRoot, method) {
  return {
    source_root: sourceRoot,
    destination: MODEL_DESTINATION,
    input_scope: [...MODEL_INPUT_SCOPE],
    confirmed_at: new Date().toISOString(),
    method,
  };
}

export function canReuseModelConsent(consent, sourceRoot) {
  return consent?.source_root === sourceRoot
    && consent.destination === MODEL_DESTINATION
    && MODEL_INPUT_SCOPE.every((item) => consent.input_scope?.includes(item));
}
