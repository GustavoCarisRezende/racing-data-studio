import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageExporter, createTextExporter } from '../src/categories/f1/export-service.ts';

const files = [{ name: 'ignored.csv', mediaType: 'text/csv;charset=utf-8', text: '"A"\r\n"1"\r\n' }];
test('CSV export invokes only the chooser-backed command and reports cancellation and errors', async () => {
  const calls = [];
  const exportFiles = createTextExporter(async (command, args) => { calls.push([command, args]); return true; });
  await exportFiles(files);
  assert.deepEqual(calls.map(([command, args]) => [command, args.kind, Object.hasOwn(args, 'path')]), [['f1_export_text', 'csv', false]]);
  await assert.rejects(createTextExporter(async () => false)(files), error => error.code === 'EXPORT_CANCELLED');
  await assert.rejects(createTextExporter(async () => { throw 'EXPORT_CREATE_FAILED'; })(files), error => error.code === 'EXPORT_CREATE_FAILED');
  await assert.rejects(exportFiles([]), error => error.code === 'INVALID_EXPORT');
  const manifest = { name: 'ignored.json', mediaType: 'application/json', text: '{"format":"rds-table-export","version":1}' };
  await exportFiles([...files, manifest]);
  assert.deepEqual(calls[1], ['f1_export_text', { kind: 'csv', content: files[0].text, manifest: manifest.text }]);
  await assert.rejects(exportFiles([...files, manifest, manifest]), error => error.code === 'INVALID_EXPORT');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(exportFiles(files, controller.signal), error => error.name === 'AbortError');
  assert.equal(calls.length, 2);
});

test('SVG/PNG exports are bounded, base64 encoded without paths and cancellation is reported', async () => {
  const calls = [];
  const send = createImageExporter(async (command, args) => { calls.push({ command, args }); return true; });
  const bytes = Uint8Array.from({ length: 0x6000 + 5 }, (_, i) => i % 256);
  await send({ format: 'png', bytes });
  assert.equal(calls[0].command, 'f1_export_text');
  assert.equal(calls[0].args.kind, 'png');
  assert.deepEqual(Buffer.from(calls[0].args.content, 'base64'), Buffer.from(bytes));
  assert.ok(!Object.hasOwn(calls[0].args, 'path'));
  await assert.rejects(createImageExporter(async () => false)({ format: 'svg', bytes }), error => error.code === 'EXPORT_CANCELLED');
  await assert.rejects(send({ format: 'gif', bytes }), error => error.code === 'INVALID_EXPORT');
  await assert.rejects(send({ format: 'jpeg', bytes }), error => error.code === 'INVALID_EXPORT');
});
