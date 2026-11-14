import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaultModelIds } from '../src/categories/f1/default-models.ts';

test('F1 presentation IDs exactly match reserved native restoration IDs', async () => {
  const source = await readFile(new URL('../src-tauri/src/f1/saved_models.rs', import.meta.url), 'utf8');
  const ids = [...new Set(source.match(/"f1-default-[a-z-]+"/g).map(s => s.slice(1, -1)))].sort();
  assert.deepEqual([...defaultModelIds].sort(), ids);
});
