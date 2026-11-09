import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChartModel, buildQuery, defaultVisualization, exportResult, formatScalar, localize, makeAnalysis } from '@rds/sandbox-core';
import { fixture, resolve, descriptor } from './helpers.mjs';

test('comparison partitions accumulation and preserves missing values and absent cells', async () => {
  const { provider } = fixture(), selection = await resolve(provider);
  const v = { ...defaultVisualization(descriptor), kind: 'line', series: 'plot', comparison: 'campaign', runningSum: true };
  const q = buildQuery(descriptor, selection, v, [], 'q');
  assert.deepEqual(q.window.partitionBy, ['plot', 'campaign']);
  const r = await provider.query(q);
  const north2023 = r.rows.filter(row => row.values.plot === 'north' && row.values.campaign === '2023');
  assert.deepEqual(north2023.map(row => row.values.harvest), ['10.25', '22.75', '22.75']);
  const north2024 = r.rows.filter(row => row.values.plot === 'north' && row.values.campaign === '2024');
  assert.deepEqual(north2024.map(row => row.values.harvest), ['11.75', '25.00', '39.00']);
  const south2023 = r.rows.filter(row => row.values.plot === 'south' && row.values.campaign === '2023');
  assert.deepEqual(south2023.map(row => row.values.harvest), ['8.10', null, null]);
  const chart = buildChartModel(descriptor, q, r, 'line', 'en-US', 'Harvest');
  assert.equal(chart.series.length, 4);
  const south2024 = chart.series.find(s => s.id === JSON.stringify(['south', '2024']));
  assert.deepEqual(south2024.values, [9.5, null, null]);
});

test('filtered-selection cumulative is explicitly not season-to-date', async () => {
  const { provider } = fixture(), selection = await resolve(provider);
  const v = { ...defaultVisualization(descriptor), runningSum: true, series: 'campaign' };
  const q = buildQuery(descriptor, selection, v, [{ fieldId: 'week', op: 'range', min: 3 }], 'q');
  assert.equal(q.window.scope, 'filteredSelection');
  const r = await provider.query(q);
  assert.deepEqual(r.rows.map(row => row.values.harvest), ['9.00', '24.00']);
});

test('exact decimals, local dates and translations do not change IDs', () => {
  assert.equal(formatScalar('12345678901234567890.1250', 'decimal', 'pt-BR'), '12.345.678.901.234.567.890,1250');
  assert.equal(formatScalar('2024-01-01', 'date', 'pt-BR'), '01/01/2024');
  assert.equal(formatScalar(null, 'decimal', 'en-US'), '—');
  assert.equal(formatScalar('-0.1250', 'decimal', 'pt-BR'), '-0,1250');
  assert.equal(localize(descriptor.label, 'pt-BR'), 'Colheita do pomar');
  assert.equal(localize(descriptor.label, 'fr-FR'), 'Orchard harvest');
  assert.equal(localize({ fallback: 'Driver', translations: { 'pt-BR': '' } }, 'pt-BR'), 'Driver');
});

test('complete CSV exports all rows with attribution, canonical values and spreadsheet protection', async () => {
  const { provider } = fixture(), selection = await resolve(provider);
  const q = buildQuery(descriptor, selection, { ...defaultVisualization(descriptor), series: 'plot', comparison: 'campaign' }, [], 'q');
  const r = await provider.query(q);
  r.rows[0].values.plot_name = '=HYPERLINK("bad")';
  const files = exportResult(descriptor, q, r, 'Harvest');
  assert.equal(files.length, 2);
  assert.ok(files[0].text.includes('"\'=HYPERLINK(""bad"")"'));
  assert.equal(files[0].text.split('\r\n').length, r.rows.length + 2);
  const manifest = JSON.parse(files[1].text);
  assert.equal(manifest.sources[0].license, 'Apache-2.0');
  assert.deepEqual(manifest.query.selection, selection);
  assert.equal(manifest.rowCount, 11);
  assert.throws(() => exportResult(descriptor, q, { ...r, complete: false }, 'x'));
});

test('chart rejects partial results, duplicate grouped cells, unsafe magnitudes and excessive series', async () => {
  const { provider } = fixture(), selection = await resolve(provider);
  const q = buildQuery(descriptor, selection, defaultVisualization(descriptor), [], 'q');
  const r = await provider.query(q);
  assert.throws(() => buildChartModel(descriptor, q, { ...r, complete: false }, 'bar', 'en-US', 'x'));
  assert.throws(() => buildChartModel(descriptor, q, { ...r, rows: [...r.rows, r.rows[0]] }, 'bar', 'en-US', 'x'));
  const huge = structuredClone(r); huge.rows[0].values.harvest = '999999999999999999';
  assert.throws(() => buildChartModel(descriptor, q, huge, 'bar', 'en-US', 'x'));
});

test('injected store roundtrip, revisions, conflicts and pinned data', async () => {
  const { provider, store } = fixture(), selection = await resolve(provider);
  const a = makeAnalysis(descriptor, selection, defaultVisualization(descriptor), [], 'First');
  const first = await store.save(a, null);
  assert.equal(first.revision, '1');
  assert.deepEqual(await store.load(first.id), first);
  const second = await store.save({ ...first, title: 'Second' }, '1');
  assert.equal(second.revision, '2');
  await assert.rejects(store.save(first, '1'), { code: 'CONFLICT' });
  await assert.rejects(provider.resolveSelection({ protocolVersion: 1, datasetId: descriptor.id, policy: 'pinned', partitionIds: [], revisions: [{ ...selection.revisions[0], revisionId: 'missing' }] }), { code: 'REVISION_MISSING' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(provider.query(buildQuery(descriptor, selection, defaultVisualization(descriptor), [], 'q'), controller.signal), { code: 'ABORTED' });
});

test('required dimensions cannot be accidentally summed away or omitted from a window', async () => {
  const { provider } = fixture(), selection = await resolve(provider);
  const d = structuredClone(descriptor); d.metrics[0].requiredDimensions = ['campaign'];
  const initial = defaultVisualization(d);
  assert.equal(initial.comparison, 'campaign');
  const q = buildQuery(d, selection, { ...initial, runningSum: true }, [], 'required');
  assert.deepEqual(q.window.partitionBy, ['campaign']);
  assert.throws(() => buildQuery(d, selection, { ...initial, comparison: null }, [], 'invalid'));
});
