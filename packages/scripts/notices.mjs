// Read-only redistribution aid. Keep full texts, not just SPDX names.
import { readFile, readdir } from 'node:fs/promises';
const packages = ['echarts', 'zrender', 'tslib', 'react', 'react-dom', 'scheduler'];
if (process.argv.includes('--desktop')) packages.unshift('@tauri-apps/api');
for (const name of packages) {
  const modules = name === '@tauri-apps/api' ? '../../app/node_modules/' : '../node_modules/';
  const root = new URL(`${modules}${name}/`, import.meta.url);
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  console.log(`\n# ${name} ${pkg.version} (${pkg.license})\n`);
  const entries = await readdir(root, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en-US'));
  for (const entry of entries) {
    if (entry.isFile() && /^(LICENSE|NOTICE|COPYRIGHT)/i.test(entry.name)) console.log(await readFile(new URL(entry.name, root), 'utf8'));
    if (entry.isDirectory() && entry.name === 'licenses') {
      for (const file of (await readdir(new URL('licenses/', root))).sort()) {
        console.log(`\n## ${file}\n` + await readFile(new URL(`licenses/${file}`, root), 'utf8'));
      }
    }
  }
}
