import test from 'node:test';
import assert from 'node:assert/strict';
import * as echarts from 'echarts/core.js';
import { assertDataset, assertQuery, assertResult, parseAnalysisDocument, parseModelDocument } from '@rds/sandbox-contracts';
import { buildChartModel, buildQuery, defaultVisualization, makeAnalysis, makeModel, tableRows, withRequiredDimensions } from '@rds/sandbox-core';
import { toEChartsOption } from '@rds/sandbox-echarts';
import { v2Fixture } from './v2-fixture.mjs';
import { resolve } from './helpers.mjs';
import { descriptor as legacyDescriptor } from './helpers.mjs';

test('v2 cumulative: calculate before axis crop; v1 filtered-selection remains unchanged', async () => {
  const { provider, descriptor: d } = v2Fixture();
  const selection = await resolve(provider);
  const v = withRequiredDimensions(d, { ...defaultVisualization(d), kind: 'line', series: 'plot', runningSum: true, cumulativeScope: 'beforeDisplayFilter' });
  const filters = [{ fieldId: 'campaign', op: 'in', values: ['2023', '2024'] }, { fieldId: 'plot', op: 'in', values: ['north'] }, { fieldId: 'week', op: 'range', min: 2 }];
  const q = buildQuery(d, selection, v, filters, 'crop');
  assert.equal(q.protocolVersion, 2);
  assert.deepEqual(q.displayFilters, [filters[2]]);
  assert.ok(!q.filters.some(f => f.fieldId === 'week'));
  assert.deepEqual(q.window.partitionBy, ['plot', 'campaign']);
  const r = await provider.query(q); assertResult(r, q, d);
  assert.deepEqual(r.rows.filter(row => row.values.campaign === '2023').map(row => row.values.harvest), ['22.75', '22.75']);
  const legacy = buildQuery(d, selection, { ...v, cumulativeScope: undefined }, filters, 'legacy');
  assert.equal(legacy.protocolVersion, 1);
  assert.equal((await provider.query(legacy)).rows.find(row => row.values.campaign === '2023').values.harvest, '12.50');
  assert.throws(() => assertQuery({ ...q, protocolVersion: 1 }, d));
  assert.throws(() => assertQuery({ ...q, filters }, d), /Display axis/);
  assert.throws(() => assertQuery({ ...q, window: { ...q.window, partitionBy: ['plot'] } }, d), /partition/);
  assert.throws(() => assertResult({ ...r, protocolVersion: 1 }, q, d));
  // Descending display order must never reverse the accumulation itself.
  const descending = { ...q, orderBy: [{ fieldId: 'week', direction: 'desc' }] };
  assert.equal((await provider.query(descending)).rows.find(row => row.values.campaign === '2024').values.harvest, '39.00');
});

test('real pie/scatter SVGs, two measures, negatives, missing pairs, zeros, limits and compatibility', async () => {
  const { provider, descriptor: d } = v2Fixture(), selection = await resolve(provider);
  const base = defaultVisualization(d);
  const pieQuery = buildQuery(d, selection, { ...base, kind: 'pie' }, [], 'pie');
  const pieResult = await provider.query(pieQuery);
  const pie = buildChartModel(d, pieQuery, pieResult, 'pie', 'en-US', '<script>fixture</script>');
  assert.ok(pie.slices.length > 0); assert.ok(pie.omitted > 0);
  const scatterQuery = buildQuery(d, selection, { ...base, kind: 'scatter', secondaryMetric: { metricId: 'cost', aggregation: 'sum' } }, [], 'scatter');
  assert.equal(scatterQuery.metrics.length, 2); assert.ok(scatterQuery.dimensions.includes('campaign'));
  const scatterResult = await provider.query(scatterQuery);
  const scatter = buildChartModel(d, scatterQuery, scatterResult, 'scatter', 'pt-BR', 'Dispersão');
  assert.ok(scatter.omitted > 0);
  assert.ok(scatter.series.flatMap(s => s.points).some(p => p.value[0] < 0));
  for (const model of [pie, scatter]) {
    const option = toEChartsOption(model);
    assert.equal(option.series[0].type, model.kind);
    assert.equal(option.tooltip.renderMode, 'richText');
    const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 640, height: 340 });
    try { chart.setOption(option); const svg = chart.renderToSVGString(); assert.ok(svg.includes('<path')); assert.ok(!svg.includes('<script>')); } finally { chart.dispose(); }
  }
  const negative = structuredClone(pieResult); negative.rows[0].values.harvest = '-1.00';
  assert.throws(() => buildChartModel(d, pieQuery, negative, 'pie', 'en-US', 'x'), e => e.code === 'NEGATIVE_PIE');
  const zeros = structuredClone(pieResult); zeros.rows.forEach(r => { r.values.harvest = '0.00'; });
  assert.throws(() => buildChartModel(d, pieQuery, zeros, 'pie', 'en-US', 'x'), e => e.code === 'EMPTY_PIE');
  const unsafe = structuredClone(pieResult); unsafe.rows[0].values.harvest = '9007199254740991.01';
  assert.throws(() => buildChartModel(d, pieQuery, unsafe, 'pie', 'en-US', 'x'), e => e.code === 'LIMIT_EXCEEDED');
  assert.throws(() => buildChartModel(d, pieQuery, { ...pieResult, complete: false }, 'pie', 'en-US', 'x'));
  assert.throws(() => buildQuery(d, selection, { ...base, kind: 'scatter' }, [], 'bad'), /two|requires/i);
  assert.throws(() => buildQuery(d, selection, { ...base, kind: 'scatter', secondaryMetric: base.metric }, [], 'bad'), /distinct/);
  const incompatible = structuredClone(d); incompatible.metrics[1].groupableBy = ['campaign'];
  assert.throws(() => buildQuery(incompatible, selection, { ...base, kind: 'scatter', secondaryMetric: { metricId: 'cost', aggregation: 'sum' } }, [], 'incompatible'), /grouping/);
  assert.throws(() => toEChartsOption({ ...scatter, series: [{ id: 'x', label: 'x', values: [], points: [{ id: 'x', label: 'x', value: [Infinity, 2] }] }] }));
  assert.throws(() => toEChartsOption({ ...pie, slices: [{ id: 'x', label: 'x', value: -1 }] }));
});

test('models: latest reopening, no snapshot payload, CAS create/update/delete, strict versions, pinned v1 unchanged', async () => {
  const fixture = v2Fixture(), { provider, store, descriptor: d } = fixture;
  const selection = await resolve(provider), v = defaultVisualization(d);
  const pinned = makeAnalysis(d, selection, v, [], 'Pinned');
  const document = makeModel(d, [], { ...v, table: { version: 1, columns: ['harvest', 'campaign'], sort: { columnId: 'harvest', direction: 'desc' } } }, [], 'Model');
  const saved = await store.models.save(document, null);
  assert.ok(!JSON.stringify(saved).includes('fixture-1')); assert.equal(saved.binding.policy, 'latest');
  assert.equal((await store.models.list()).length, 1);
  assert.throws(() => parseAnalysisDocument(saved, d), e => e.code === 'UNSUPPORTED_VERSION');
  assert.throws(() => parseModelDocument({ ...saved, documentVersion: 3 }, d), e => e.code === 'UNSUPPORTED_VERSION');
  assert.throws(() => parseModelDocument({ ...saved, selection }, d));
  assert.throws(() => parseModelDocument({ ...saved, binding: { ...saved.binding, token: 'pinned' } }, d));
  assert.throws(() => parseAnalysisDocument({ ...pinned, visualization: document.visualization }, d), /v2/);
  assert.throws(() => parseModelDocument({ ...saved, visualization: { ...v, table: { version: 2, columns: ['harvest'] } } }, d));
  assert.throws(() => parseModelDocument({ ...saved, visualization: { ...v, comparison: null } }, d), /grouping/);
  assert.throws(() => parseModelDocument({ ...saved, filters: [{ fieldId: 'campaign', op: 'in', values: ['2022', '2023', '2024', '2025'] }] }, d), /selections/);
  await assert.rejects(store.models.save(saved, null), e => e.code === 'CONFLICT');
  const updated = await store.models.save({ ...saved, title: 'Renamed' }, saved.revision);
  await assert.rejects(store.models.delete({ id: saved.id, expectedRevision: saved.revision }), e => e.code === 'CONFLICT');
  const before = await provider.query(buildQuery(d, selection, v, [], 'before'));
  const rows = fixture.getRows(); rows[0].harvest_kg = '999.00'; fixture.updateRows(rows);
  const opened = parseModelDocument(await store.models.load(saved.id), d);
  const latest = await provider.resolveSelection({ protocolVersion: 1, datasetId: d.id, ...opened.binding });
  assert.notEqual(latest.token, selection.token);
  assert.notDeepEqual((await provider.query(buildQuery(d, latest, opened.visualization, opened.filters, 'after'))).rows, before.rows);
  const old = parseAnalysisDocument(pinned, d);
  const pinnedSelection = await provider.resolveSelection({ protocolVersion: 1, datasetId: d.id, policy: 'pinned', partitionIds: old.selection.revisions.map(r => r.partitionId), revisions: old.selection.revisions });
  assert.deepEqual((await provider.query(buildQuery(d, pinnedSelection, v, [], 'still-old'))).rows, before.rows);
  await store.models.delete({ id: updated.id, expectedRevision: updated.revision });
  assert.deepEqual(await store.models.list(), []);
  await assert.rejects(store.models.load(updated.id), e => e.code === 'REVISION_MISSING');
});

test('exact stable table sorting before pagination, nulls last, and generic three-season grouping', async () => {
  const { provider, descriptor: d } = v2Fixture(); assertDataset(d);
  const v = defaultVisualization(d); assert.equal(v.comparison, 'campaign');
  const withoutComparisonHint = { ...d, capabilities: { ...d.capabilities, comparisonDimensions: [] } };
  assert.equal(defaultVisualization(withoutComparisonHint).comparison, 'campaign');
  const q = buildQuery(d, await resolve(provider), v, [{ fieldId: 'campaign', op: 'in', values: ['2023', '2024', '2025'] }], 'multi');
  const result = await provider.query(q);
  assert.equal(new Set(result.rows.map(r => r.values.campaign)).size, 3);
  const r = { columns: [{ id: 'n', type: 'decimal' }], rows: ['9007199254740993.01', null, '9007199254740993.00', '9007199254740993.01', '-2.00'].map((n, i) => ({ id: String(i), values: { n } })) };
  assert.deepEqual(tableRows(r, { version: 1, columns: ['n'], sort: { columnId: 'n', direction: 'asc' } }).map(r => r.id), ['4', '2', '0', '3', '1']);
  assert.deepEqual(tableRows(r, { version: 1, columns: ['n'], sort: { columnId: 'n', direction: 'desc' } }).map(r => r.id), ['0', '3', '2', '4', '1']);
  const large = { columns: r.columns, rows: Array.from({ length: 101 }, (_, i) => ({ id: String(i), values: { n: `${100 - i}.00` } })) };
  assert.equal(tableRows(large, { version: 1, columns: ['n'], sort: { columnId: 'n', direction: 'asc' } }).slice(0, 50)[0].id, '100');
});

test('a pre-capability pinned v1 document keeps its old grouping without silently adding a season', async () => {
  const { provider, descriptor: d } = v2Fixture(), selection = await resolve(provider);
  const oldVisualization = defaultVisualization(legacyDescriptor);
  const document = makeAnalysis(legacyDescriptor, selection, oldVisualization, [], 'Old pinned');
  const parsed = parseAnalysisDocument(document, d);
  assert.equal(parsed.visualization.comparison, null);
  assert.throws(() => buildQuery(d, selection, parsed.visualization, [], 'new'), /preserved/);
  const query = buildQuery(d, selection, parsed.visualization, [], 'old', { legacyPinned: true });
  assert.deepEqual(query.dimensions, ['week']);
  assert.equal(query.protocolVersion, 1);
  assert.doesNotThrow(() => assertQuery(query, d));
  assert.throws(() => makeModel(d, [], oldVisualization, [], 'Not a model'), /grouping/);
});
