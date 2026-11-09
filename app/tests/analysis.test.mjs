import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let server, createProvider, createStore, contracts;
before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null }, appType: 'custom' });
  ({ createF1AnalysisProvider: createProvider } = await server.ssrLoadModule('/src/categories/f1/analysis-provider.ts'));
  ({ createF1AnalysisStore: createStore } = await server.ssrLoadModule('/src/categories/f1/analysis-store.ts'));
  contracts = await server.ssrLoadModule('/@fs/' + new URL('../../packages/sandbox-contracts/dist/index.js', import.meta.url).pathname);
});
after(async () => { await server?.close(); });
const entry = (round, session, driver, points) => ({ round, session, result: { Driver: { driverId: driver }, Constructor: { constructorId: 'team' }, points } });
const snapshot = (year, id, results) => ({ year, id, storedAt: '2026-01-02T00:00:00Z', sourceDataAt: '2026-01-01T00:00:00Z', results });
const base = (selection, descriptor) => ({ protocolVersion: 1, requestId: 'q1', datasetId: descriptor.id, schemaVersion: descriptor.schemaVersion, semanticVersion: descriptor.semanticVersion, selection, dimensions: ['season', 'round'], metrics: [{ metricId: 'points', aggregation: 'sum' }], filters: [], orderBy: [{ fieldId: 'round', direction: 'asc' }], limit: 100 });

test('local snapshot results: exact totals, facets, filters, pinned selection and validation', async () => {
  let data = [snapshot(2024, '1', [entry('1', 'results', 'a', '0.1'), entry('1', 'results', 'a', '0.2'), entry('1', 'sprint', 'a', '1.5'), entry('2', 'results', 'b', null)]), snapshot(2025, '2', [entry('1', 'results', 'b', '3')])];
  const provider = createProvider(async () => structuredClone(data));
  assert.equal((await provider.listDatasets()).length, 1);
  const descriptor = await provider.describeDataset({ datasetId: 'f1.session_results', locale: 'en-US' });
  const selection = await provider.resolveSelection({ protocolVersion: 1, datasetId: descriptor.id, policy: 'latest', partitionIds: [] });
  data = [snapshot(2024, '3', [entry('1', 'results', 'a', '99')])];
  const request = base(selection, descriptor); const result = await provider.query(request);
  contracts.assertResult(result, request, descriptor);
  assert.deepEqual(result.rows.map(r => r.values.points), ['1.8', '3', null]);
  const race = await provider.query({ ...request, filters: [{ fieldId: 'session', op: 'in', values: ['results'] }] });
  assert.equal(race.rows[0].values.points, '0.3');
  const occurrences = await provider.query({ ...request, metrics: [{ metricId: 'observations', aggregation: 'count' }] });
  assert.equal(occurrences.rows[0].values.observations, 3);
  const facet = await provider.facet({ protocolVersion: 1, datasetId: descriptor.id, selection, fieldId: 'driver', filters: [], search: '', limit: 1 });
  assert.deepEqual(facet.values, [{ value: 'a', label: 'a', count: 3 }]);
  assert.equal((await provider.facet({ protocolVersion: 1, datasetId: descriptor.id, selection, fieldId: 'driver', filters: [], search: '', limit: 1, cursor: facet.nextCursor })).values[0].value, 'b');
  assert.deepEqual(await provider.resolveSelection({ protocolVersion: 1, datasetId: descriptor.id, policy: 'pinned', partitionIds: ['2024', '2025'], revisions: selection.revisions }), selection);
  await assert.rejects(provider.query({ ...request, dimensions: ['round'] }));
  await assert.rejects(provider.query({ ...request, limit: 1 }));
  await assert.rejects(provider.query({ ...request, selection: { ...selection, token: 'invalid' } }));
  await assert.rejects(provider.facet({ protocolVersion: 1, datasetId: descriptor.id, selection, fieldId: 'driver', filters: [], search: '', limit: 100, cursor: '-1' }));
});

test('empty catalog and malformed source fail closed', async () => {
  assert.deepEqual(await createProvider(async () => []).listDatasets(), []);
  await assert.rejects(createProvider(async () => [snapshot(2024, '1', [entry('1', 'results', 'x', 'NaN')])]).listDatasets());
});

test('reopening pinned revisions after restart does not silently switch to latest', async () => {
  const old = [snapshot(2024, '1', [entry('1', 'results', 'a', '0.1')])];
  const newer = [snapshot(2024, '2', [entry('1', 'results', 'a', '99')])];
  const initial = createProvider(async () => structuredClone(old));
  const selection = await initial.resolveSelection({ protocolVersion: 1, datasetId: 'f1.session_results', policy: 'latest', partitionIds: [] });
  const reopened = createProvider(async refs => structuredClone(refs ? old : newer));
  const pinned = await reopened.resolveSelection({ protocolVersion: 1, datasetId: 'f1.session_results', policy: 'pinned', partitionIds: ['2024'], revisions: selection.revisions });
  const descriptor = await reopened.describeDataset({ datasetId: 'f1.session_results', locale: 'en-US' });
  assert.equal((await reopened.query(base(pinned, descriptor))).rows[0].values.points, '0.1');
  const missing = createProvider(async () => structuredClone(newer));
  await assert.rejects(missing.resolveSelection({ protocolVersion: 1, datasetId: 'f1.session_results', policy: 'pinned', partitionIds: ['2024'], revisions: selection.revisions }));
});

test('store validates input and native output, and reports conflicts', async () => {
  const provider = createProvider(async () => [snapshot(2024, '1', [entry('1', 'results', 'a', '1')])]);
  const selection = await provider.resolveSelection({ protocolVersion: 1, datasetId: 'f1.session_results', policy: 'latest', partitionIds: [] });
  const doc = { documentVersion: 1, id: 'analysis-1', revision: null, title: 'Synthetic', datasetId: 'f1.session_results', datasetSchemaVersion: '1', datasetSemanticVersion: '1', selection, visualization: { kind: 'table', x: 'season', metric: { metricId: 'points', aggregation: 'sum' }, series: null, comparison: null, runningSum: false }, filters: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
  const store = createStore(async (command, args) => command === 'f1_analysis_save' ? { ...args.document, revision: 'abc' } : command === 'f1_analysis_load' ? { ...doc, revision: 'abc' } : [{ id: doc.id, revision: 'abc', title: doc.title, updatedAt: doc.updatedAt }]);
  assert.equal((await store.save(doc, null)).revision, 'abc');
  assert.equal((await store.load(doc.id)).id, doc.id);
  assert.equal((await store.list()).length, 1);
  await assert.rejects(store.save({ ...doc, documentVersion: 2 }, null));
  await assert.rejects(createStore(async () => { throw 'CONFLICT'; }).save(doc, null), error => error.code === 'CONFLICT');
});

test('presentation exposes only available views and keeps source names separate from filter IDs', async () => {
  const named = entry('1', 'results', 'synthetic_id', '12.50');
  named.result.Driver.givenName = 'Ana'; named.result.Driver.familyName = 'Lima';
  named.result.Constructor.name = 'Aurora Motors';
  const provider = createProvider(async () => [snapshot(2024, '1', [named]), snapshot(2025, '2', [named])]);
  const descriptor = await provider.describeDataset({ datasetId: 'f1.session_results', locale: 'pt-BR' });
  contracts.assertDataset(descriptor);
  assert.deepEqual(descriptor.presentation.views.map(v => v.id), ['race', 'teams']);
  assert.equal(descriptor.presentation.defaultVisualization.x, 'round');
  assert.deepEqual(descriptor.presentation.defaultFilters.find(f => f.fieldId === 'season').values, ['2025']);
  const selection = await provider.resolveSelection({ protocolVersion: 1, datasetId: descriptor.id, policy: 'latest', partitionIds: [] });
  const facet = await provider.facet({ protocolVersion: 1, datasetId: descriptor.id, selection, fieldId: 'driver', filters: [], search: 'Ana Lima', limit: 100 });
  assert.deepEqual(facet.values, [{ value: 'synthetic_id', label: 'Ana Lima', count: 2 }]);
  const request = { ...base(selection, descriptor), dimensions: ['season', 'driver', 'team'], orderBy: [{ fieldId: 'season', direction: 'asc' }], filters: [{ fieldId: 'driver', op: 'in', values: ['synthetic_id'] }] };
  const result = await provider.query(request); contracts.assertResult(result, request, descriptor);
  assert.equal(result.rows[0].values.driver, 'synthetic_id');
  assert.equal(result.rows[0].values.driver_name, 'Ana Lima');
  assert.equal(result.rows[0].values.team_name, 'Aurora Motors');
});
