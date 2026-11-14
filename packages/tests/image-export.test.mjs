import test from 'node:test';
import assert from 'node:assert/strict';
import { renderExportSvg, exportChartImage } from '@rds/sandbox-echarts';

const model = { kind: 'pie', title: 'Title <script>alert(1)</script> 🏁', description: 'Synthetic', xLabel: 'x', yLabel: 'y', categories: [], slices: [{ id: 'a', label: 'Slice \u0001</text><script>alert(1)</script><image href="https://invalid.test">', value: 3 }, { id: 'b', label: 'Second', value: 7 }], series: [{ id: 'a', label: 'Slice \u0001</text><script>alert(1)</script><image href="https://invalid.test">', values: [3] }, { id: 'b', label: 'Second', values: [7] }] };
test('SVG uses ECharts, escapes untrusted text, and independently includes legend and pie labels', async () => {
  const all = renderExportSvg(model, { showLegend: true, showLabels: true });
  assert.ok(all.svg.startsWith('<svg '));
  assert.ok(!all.svg.includes('<script>'));
  assert.ok(all.svg.includes('&lt;script&gt;'));
  assert.ok(all.svg.includes('🏁'));
  assert.ok(all.svg.includes('<path'));
  assert.ok(all.height > 646);
  const neither = renderExportSvg(model, { showLegend: false, showLabels: false });
  assert.equal(neither.height, 646);
  assert.ok(!neither.svg.includes('Second'));
  const labels = renderExportSvg(model, { showLegend: false, showLabels: true });
  assert.ok(labels.svg.includes('Second'));
  const legend = renderExportSvg(model, { showLegend: true, showLabels: false });
  assert.ok(legend.svg.includes('Second'));
  assert.ok(!all.svg.includes('<image'));
  assert.ok(!all.svg.includes('\u0001'));
  const file = await exportChartImage(model, { format: 'svg', showLegend: true, showLabels: false });
  assert.equal(file.format, 'svg');
  const exported = new TextDecoder().decode(file.bytes);
  assert.ok(exported.includes('Second') && exported.includes('<path') && !exported.includes('<script>'));
  assert.throws(() => renderExportSvg({ ...model, series: Array.from({ length: 101 }, (_, i) => ({ id: String(i), label: 'x', values: [1] })) }, { showLegend: true, showLabels: true }));
});

test('rasterization uses local canvas, JPEG background and cleans resources', async () => {
  const oldImage = globalThis.Image, oldDocument = globalThis.document;
  const oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  const operations = [], revoked = [];
  class FakeImage { set src(value) { if (value) queueMicrotask(() => this.onload?.()); } removeAttribute() {} }
  globalThis.Image = FakeImage;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ set fillStyle(value) { operations.push(['fillStyle', value]); }, fillRect: () => operations.push(['fillRect']), drawImage: () => operations.push(['drawImage']) }), toBlob: (callback, type) => callback(new Blob([new Uint8Array([1, 2, 3])], { type })) }) };
  URL.createObjectURL = () => 'blob:synthetic';
  URL.revokeObjectURL = value => revoked.push(value);
  try {
    const png = await exportChartImage(model, { format: 'png', showLegend: false, showLabels: false });
    assert.deepEqual([...png.bytes], [1, 2, 3]);
    assert.ok(!operations.some(op => op[0] === 'fillRect'));
    const jpeg = await exportChartImage(model, { format: 'jpeg', showLegend: true, showLabels: true });
    assert.equal(jpeg.format, 'jpeg');
    assert.ok(operations.some(op => op[0] === 'fillStyle' && op[1] === '#111923'));
    assert.deepEqual(revoked, ['blob:synthetic', 'blob:synthetic']);
    class FailingImage { set src(value) { if (value) queueMicrotask(() => this.onerror?.()); } removeAttribute() {} }
    globalThis.Image = FailingImage;
    await assert.rejects(exportChartImage(model, { format: 'png', showLegend: false, showLabels: false }));
    assert.deepEqual(revoked, ['blob:synthetic', 'blob:synthetic', 'blob:synthetic']);
  } finally {
    globalThis.Image = oldImage; globalThis.document = oldDocument;
    URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke;
  }
});
