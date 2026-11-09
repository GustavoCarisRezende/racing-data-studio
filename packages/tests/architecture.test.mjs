import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

test('contracts/core have no React, Tauri, category, network or storage dependencies', async () => {
  for (const name of ['sandbox-contracts', 'sandbox-core']) {
    const root = new URL(`../${name}/`, import.meta.url);
    const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
    assert.deepEqual(Object.keys(pkg.dependencies ?? {}), name === 'sandbox-core' ? ['@rds/sandbox-contracts'] : []);
    for (const file of await readdir(new URL('src/', root))) {
      const source = await readFile(new URL(`src/${file}`, root), 'utf8');
      assert.ok(!/from ['"](?:react|@tauri|.*categories\/|.*\/app\/)/.test(source));
      assert.ok(!/\b(?:fetch|localStorage|indexedDB)\s*[.(]/.test(source));
    }
  }
});
