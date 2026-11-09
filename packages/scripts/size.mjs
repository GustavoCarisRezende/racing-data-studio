import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
const common = { bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, metafile: true, legalComments: 'inline', external: ['react', 'react-dom', 'react/jsx-runtime'], logLevel: 'silent' };
for (const [label, entryPoints] of [['renderer', ['sandbox-echarts/dist/index.js']], ['UI', ['sandbox-react/dist/index.js']]]) {
  const result = await build({ ...common, entryPoints });
  const bytes = result.outputFiles[0].contents;
  const source = result.outputFiles[0].text;
  if (/\beval\s*\(|new Function\s*\(/.test(source)) throw new Error(`${label}: unexpected eval in emitted bundle`);
  const contributing = Object.values(result.metafile.outputs).flatMap(output => Object.entries(output.inputs).filter(([, meta]) => meta.bytesInOutput > 0).map(([name]) => name));
  if (label === 'renderer' && contributing.some(name => /echarts\/lib\/chart\/(pie|map|scatter)\//.test(name))) throw new Error('Unrequested charts were bundled');
  console.log(JSON.stringify({ label, bytes: bytes.length, gzipBytes: gzipSync(bytes).length, contributingModules: contributing.length, excludesReactRuntime: true, containsWasm: false }));
}
