import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('model output schemas require every declared object property', () => {
  for (const file of ['interpret.schema.json', 'project.schema.json']) {
    const schema = JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
    const missing = [];
    function inspect(node, location) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'object' && node.properties) {
        for (const property of Object.keys(node.properties)) {
          if (!node.required?.includes(property)) missing.push(`${location}.${property}`);
        }
      }
      for (const [key, value] of Object.entries(node)) inspect(value, `${location}.${key}`);
    }
    inspect(schema, file);
    assert.deepEqual(missing, [], `${file} must satisfy Codex structured output requirements`);
  }
});
