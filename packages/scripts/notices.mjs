// Read-only redistribution aid. Keep full texts, not just SPDX names.
import { readFile, readdir } from 'node:fs/promises';
for (const name of ['echarts', 'zrender', 'tslib', 'react', 'react-dom', 'scheduler']) {
  const root = new URL(`../node_modules/${name}/`, import.meta.url);
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  console.log(`\n# ${name} ${pkg.version} (${pkg.license})\n`);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isFile() && /^(LICENSE|NOTICE|COPYRIGHT)/i.test(entry.name)) console.log(await readFile(new URL(entry.name, root), 'utf8'));
    if (entry.isDirectory() && entry.name === 'licenses') {
      for (const file of await readdir(new URL('licenses/', root))) {
        console.log(`\n## ${file}\n` + await readFile(new URL(`licenses/${file}`, root), 'utf8'));
      }
    }
  }
}
