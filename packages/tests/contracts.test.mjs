import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertDataset, assertQuery, assertResult, assertSelection, assertFacetPage, parseAnalysisDocument, compareDecimal } from '@rds/sandbox-contracts';
import { buildQuery, defaultVisualization, makeAnalysis } from '@rds/sandbox-core';
import { descriptor, fixture, resolve } from './helpers.mjs';

test('generic fixture satisfies versioned contracts and exact decimal result', async () => {
  assertDataset(descriptor);
  const { provider } = fixture(), selection = await resolve(provider);
  assertSelection(selection);
  const q = buildQuery(descriptor, selection, defaultVisualization(descriptor), [], 'query-1');
  assertQuery(q, descriptor);
  const result = await provider.query(q);
  assertResult(result, q, descriptor);
  assert.equal(result.rows[0].values.harvest, '39.60');
  assert.equal(result.rows[1].values.harvest, null);
  assert.equal(result.rows[2].values.harvest, '33.00');
});

test('rejects malformed descriptors, numeric assumptions and ID collisions', () => {
  const reject = mutate => { const d = structuredClone(descriptor); mutate(d); assert.throws(() => assertDataset(d)); };
  reject(d => { d.protocolVersion = 2; });
  reject(d => { d.fields[0].id = '__proto__'; });
  reject(d => { d.fields[0].type = 'float'; });
  reject(d => { d.fields.push(d.fields[0]); });
  reject(d => { d.metrics[0].id = 'week'; });
  reject(d => { d.metrics[0].fieldId = 'week'; });
  reject(d => { d.metrics[0].defaultAggregation = 'mean'; });
  reject(d => { d.metrics[0].additive = false; });
  reject(d => { d.capabilities.charts = ['line']; });
  reject(d => { d.capabilities.maxRows = 1e9; });
});

test('typed queries reject unknown fields, wrong filter scalars, unsafe windows and excessive work', async () => {
  const { provider } = fixture(), selection = await resolve(provider);
  const q = buildQuery(descriptor, selection, defaultVisualization(descriptor), [], 'query-1');
  const reject = mutate => { const changed = structuredClone(q); mutate(changed); assert.throws(() => assertQuery(changed, descriptor)); };
  reject(q => { q.dimensions = ['arbitrary-sql']; });
  reject(q => { q.dimensions = ['week', 'week']; });
  reject(q => { q.limit = 5001; });
  reject(q => { q.metrics[0].aggregation = 'countDistinct'; });
  reject(q => { q.filters = [{ fieldId: 'week', op: 'in', values: ['1'] }]; });
  reject(q => { q.filters = [{ fieldId: 'harvest_kg', op: 'range', min: 0 }]; });
  reject(q => { q.filters = [{ fieldId: 'week', op: 'range', min: 3, max: 1 }]; });
  reject(q => { q.filters = [{ fieldId: 'plot', op: 'regex', value: '(a+)+' }]; });
  reject(q => { q.filters = [{ fieldId: 'week', op: 'in', values: [] }]; });
  reject(q => { q.orderBy = [{ fieldId: 'not-selected', direction: 'asc' }]; });
  reject(q => { q.dimensions.push('campaign'); q.window = { kind: 'runningSum', scope: 'filteredSelection', metricId: 'harvest', orderBy: 'week', partitionBy: [] }; });
  reject(q => { q.selection.datasetId = 'other'; });
});

test('validates results against request identity, total, field schema and decimal precision', async () => {
  const { provider } = fixture(), selection = await resolve(provider);
  const q = buildQuery(descriptor, selection, defaultVisualization(descriptor), [], 'query-1');
  const r = await provider.query(q);
  const reject = mutate => { const changed = structuredClone(r); mutate(changed); assert.throws(() => assertResult(changed, q, descriptor)); };
  reject(r => { r.requestId = 'old'; });
  reject(r => { r.selectionToken = 'old'; });
  reject(r => { r.rows[0].values.harvest = 39.6; });
  reject(r => { r.rows[0].values.harvest = 'NaN'; });
  reject(r => { r.rows[0].values.week = 1.5; });
  reject(r => { r.rows.push(r.rows[0]); });
  reject(r => { r.totalRows = 100; });
  reject(r => { r.rows[0].values.unexpected = 'x'; });
});

test('saved document rejects future versions, invalid date, invalid visualization and malicious extra options are not used', async () => {
  const { provider } = fixture();
  const document = makeAnalysis(descriptor, await resolve(provider), defaultVisualization(descriptor), [], 'Harvest');
  assert.deepEqual(parseAnalysisDocument(JSON.stringify(document), descriptor), document);
  const reject = mutate => { const changed = structuredClone(document); mutate(changed); assert.throws(() => parseAnalysisDocument(changed, descriptor)); };
  reject(a => { a.documentVersion = 2; });
  reject(a => { a.title = ''; });
  reject(a => { a.updatedAt = 'yesterday'; });
  reject(a => { a.visualization.kind = 'pie'; });
  reject(a => { a.visualization.x = 'plot'; a.visualization.kind = 'line'; });
  reject(a => { a.visualization.comparison = 'plot'; });
  const extra = { ...document, rendererOptions: { tooltip: '<script>bad</script>' } };
  assert.equal(Object.hasOwn(parseAnalysisDocument(extra, descriptor), 'rendererOptions'), false);
  assert.throws(() => parseAnalysisDocument('x'.repeat(256001), descriptor));
});

test('facet values retain typed IDs and reject unsafe or inconsistent values', () => {
  assertFacetPage({ values: [{ value: 1, label: 'One', count: 2 }], nextCursor: 'next' }, 'integer');
  assert.throws(() => assertFacetPage({ values: [{ value: '1', label: 'One' }] }, 'integer'));
  assert.throws(() => assertFacetPage({ values: [{ value: 1, label: 'One' }, { value: 1, label: 'Duplicate' }] }, 'integer'));
});

test('language-neutral golden request/response can be consumed by a Rust adapter', async () => {
  const q = JSON.parse(await readFile(new URL('../fixtures/query.request.json', import.meta.url), 'utf8'));
  const r = JSON.parse(await readFile(new URL('../fixtures/query.result.json', import.meta.url), 'utf8'));
  assertQuery(q, descriptor); assertResult(r, q, descriptor);
  const { provider } = fixture();
  assert.deepEqual(await provider.query(q), r);
});

test('decimal bounds are compared without Number rounding and documents never call nested toJSON', async () => {
  assert.equal(compareDecimal('9007199254740992.01', '9007199254740992.02'), -1);
  assert.equal(compareDecimal('-0.00', '0.0'), 0);
  assert.equal(compareDecimal('-12.9', '-12.89'), -1);
  const { provider } = fixture();
  const a = makeAnalysis(descriptor, await resolve(provider), defaultVisualization(descriptor), [], 'Safe');
  a.selection.toJSON = () => { throw new Error('must not execute'); };
  a.filters = [{ fieldId: 'week', op: 'range', min: 1, toJSON: () => { throw new Error('must not execute'); } }];
  const safe = parseAnalysisDocument(a, descriptor);
  assert.equal(Object.hasOwn(safe.selection, 'toJSON'), false);
  assert.equal(Object.hasOwn(safe.filters[0], 'toJSON'), false);
});

test('presentation and fixed code labels are optional, bounded and cannot reference unknown fields', () => {
  const d = structuredClone(descriptor);
  d.presentation = { primaryFilterFieldId: 'campaign', filters: [{ fieldId: 'plot', label: { fallback: 'Plots' } }], defaultVisualization: defaultVisualization(d), defaultFilters: [{ fieldId: 'campaign', op: 'in', values: ['2024'] }], views: [] };
  assertDataset(d);
  const wrong = structuredClone(d); wrong.presentation.primaryFilterFieldId = 'missing';
  assert.throws(() => assertDataset(wrong));
  const wrongFilter = structuredClone(d); wrongFilter.presentation.filters[0].fieldId = 'harvest_kg';
  assert.throws(() => assertDataset(wrongFilter));
  const wrongLabel = structuredClone(d); wrongLabel.fields[0].valueLabels = [{ value: '1', label: { fallback: 'One' } }];
  assert.throws(() => assertDataset(wrongLabel));
});
