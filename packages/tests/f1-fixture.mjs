import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { syntheticSnapshots } from '../examples/synthetic-f1.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({ absWorkingDir: root, entryPoints: ['../app/src/categories/f1/analysis-provider.ts'], nodePaths: [root + 'node_modules'], bundle: true, platform: 'node', format: 'esm', write: false });
const adapter = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].contents).toString('base64'));
export function syntheticF1() { return adapter.createF1AnalysisProvider(async () => structuredClone(syntheticSnapshots)); }
