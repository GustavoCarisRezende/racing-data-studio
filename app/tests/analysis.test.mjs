import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

let server, createProvider, createStore, contracts;
before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null, ws: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
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

test('F1 point aggregations use decimal arithmetic, propagate nulls and round means explicitly', async () => {
  const provider = createProvider(async () => [snapshot(2024, '1', [
    entry('1', 'results', 'a', '0.1'), entry('1', 'results', 'b', '0.2'), entry('1', 'results', 'c', '0.2'),
    entry('2', 'results', 'a', null), entry('2', 'results', 'b', '9'),
    entry('3', 'results', 'a', '-0.000000000001'), entry('3', 'results', 'b', '0'),
    entry('4', 'results', 'a', '1.000000000000001'), entry('4', 'results', 'b', '1.000000000000002'),
  ])]);
  const descriptor = await provider.describeDataset({ datasetId: 'f1.session_results', locale: 'en-US' });
  const selection = await provider.resolveSelection({ protocolVersion: 1, datasetId: descriptor.id, policy: 'latest', partitionIds: [] });
  const request = base(selection, descriptor);
  for (const [aggregation, expected] of [
    ['sum', ['0.5', null, '-0.000000000001', '2.000000000000003']],
    ['min', ['0.1', null, '-0.000000000001', '1.000000000000001']],
    ['max', ['0.2', null, '0', '1.000000000000002']],
    ['mean', ['0.166666666667', null, '-0.000000000001', '1.000000000000002']],
  ]) {
    const q = { ...request, metrics: [{ metricId: 'points', aggregation }] };
    const result = await provider.query(q);
    contracts.assertResult(result, q, descriptor);
    assert.deepEqual(result.rows.map(row => row.values.points), expected);
  }
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

test('v2 models have separate CRUD, validate output and keep latest binding', async () => {
  let saved;
  const store = createStore(async (command, args) => {
    if (command === 'f1_model_save') return saved = { ...args.document, revision: 'revision1' };
    if (command === 'f1_model_load') return saved;
    if (command === 'f1_models_list') return [{ id: saved.id, revision: saved.revision, title: saved.title, updatedAt: saved.updatedAt }];
    if (command === 'f1_model_delete') { assert.equal(args.expectedRevision, 'revision1'); saved = undefined; return; }
    throw new Error(command);
  });
  const model = { documentVersion: 2, kind: 'model', id: 'f1-test', revision: null, title: 'Synthetic', datasetId: 'f1.session_results', datasetSchemaVersion: '1', datasetSemanticVersion: '1', binding: { policy: 'latest', partitionIds: [] }, visualization: { kind: 'pie', x: 'team', metric: { metricId: 'points', aggregation: 'sum' }, series: null, comparison: 'season', runningSum: false, table: { version: 1, columns: ['team', 'season', 'points'] } }, filters: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
  assert.equal((await store.models.save(model, null)).revision, 'revision1');
  assert.deepEqual((await store.models.load(model.id)).binding, { policy: 'latest', partitionIds: [] });
  assert.equal((await store.models.list()).length, 1);
  await assert.rejects(store.models.save({ ...model, documentVersion: 3 }, null));
  await store.models.delete({ id: model.id, expectedRevision: 'revision1' });
  await assert.rejects(createStore(async () => { throw 'CONFLICT'; }).models.delete({ id: model.id, expectedRevision: 'revision1' }), error => error.code === 'CONFLICT');
});

test('v3 store retains calculation and fourth dimension with v2 compatibility', async () => {
  const model = { documentVersion: 3, kind: 'model', id: 'v3-test', revision: null, title: 'Synthetic', datasetId: 'f1.session_results', datasetSchemaVersion: '1', datasetSemanticVersion: '1', binding: { policy: 'latest', partitionIds: [] }, visualization: { kind: 'bar', x: 'round', metric: { metricId: 'points', aggregation: 'sum' }, series: 'driver', comparison: 'season', extraDimensions: ['session'], calculation: { version: 3, profileId: 'driver-all-sessions-v1' }, runningSum: true }, filters: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
  let saved;
  const store = createStore(async (command, args) => {
    if (command === 'f1_model_v3_save') return saved = { ...args.document, revision: 'revision1' };
    if (command === 'f1_model_v3_load') return saved;
    throw new Error(command);
  });
  await store.modelsV3.save(model, null);
  const reopened = await store.modelsV3.load(model.id);
  assert.equal(reopened.documentVersion, 3);
  assert.deepEqual(reopened.visualization.extraDimensions, ['session']);
  assert.equal(reopened.visualization.calculation.profileId, 'driver-all-sessions-v1');
  await assert.rejects(store.models.save(model, null));
});

test('model stores round-trip preference flags for v2/v3 and accept legacy documents without them', async () => {
  const persisted = new Map();
  let revision = 0;
  const store = createStore(async (command, args) => {
    if (command === 'f1_model_save' || command === 'f1_model_v3_save') {
      const saved = { ...args.document, revision: `revision-${++revision}` };
      persisted.set(saved.id, saved);
      return saved;
    }
    if (command === 'f1_model_load' || command === 'f1_model_v3_load') return persisted.get(args.id);
    throw new Error(command);
  });
  const common = { kind: 'model', revision: null, title: 'Preference flags', datasetId: 'f1.session_results', datasetSchemaVersion: '1', datasetSemanticVersion: '1', binding: { policy: 'latest', partitionIds: ['2024'] }, filters: [{ fieldId: 'season', op: 'in', values: ['2024'] }], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
  const v2 = { ...common, documentVersion: 2, id: 'flags-v2', visualization: { kind: 'line', x: 'round', metric: { metricId: 'points', aggregation: 'sum' }, series: null, comparison: 'season', runningSum: false, unifyLegends: true } };
  const v3 = { ...common, documentVersion: 3, id: 'flags-v3', visualization: { kind: 'bar', x: 'round', metric: { metricId: 'points', aggregation: 'sum' }, series: 'driver', comparison: 'season', extraDimensions: ['session'], calculation: { version: 3, profileId: 'driver-all-sessions-v1' }, runningSum: true, unifyLegends: false } };

  const savedV2 = await store.models.save({ ...v2, saveFilters: false, saveDataSelection: true }, null);
  const savedV3 = await store.modelsV3.save({ ...v3, saveFilters: true, saveDataSelection: false }, null);
  assert.deepEqual([savedV2.saveFilters, savedV2.saveDataSelection], [false, true]);
  assert.deepEqual([savedV3.saveFilters, savedV3.saveDataSelection], [true, false]);
  const loadedV2 = await store.models.load(v2.id);
  const loadedV3 = await store.modelsV3.load(v3.id);
  assert.deepEqual([loadedV2.saveFilters, loadedV2.saveDataSelection], [false, true]);
  assert.deepEqual([loadedV3.saveFilters, loadedV3.saveDataSelection], [true, false]);
  assert.equal(loadedV2.visualization.unifyLegends, true);
  assert.equal(loadedV3.visualization.unifyLegends, false);

  for (const id of [v2.id, v3.id]) {
    const legacy = persisted.get(id);
    delete legacy.saveFilters;
    delete legacy.saveDataSelection;
    delete legacy.visualization.unifyLegends;
  }
  const legacyV2 = await store.models.load(v2.id);
  const legacyV3 = await store.modelsV3.load(v3.id);
  assert.equal(Object.hasOwn(legacyV2, 'saveFilters'), false);
  assert.equal(Object.hasOwn(legacyV2, 'saveDataSelection'), false);
  assert.equal(Object.hasOwn(legacyV3, 'saveFilters'), false);
  assert.equal(Object.hasOwn(legacyV3, 'saveDataSelection'), false);
  assert.equal(Object.hasOwn(legacyV2.visualization, 'unifyLegends'), false);
  assert.equal(Object.hasOwn(legacyV3.visualization, 'unifyLegends'), false);
  await assert.rejects(store.models.save({ ...v2, visualization: { ...v2.visualization, unifyLegends: 'false' } }, null), error => error.code === 'INVALID_CONTRACT');
  await assert.rejects(store.modelsV3.save({ ...v3, visualization: { ...v3.visualization, unifyLegends: null } }, null), error => error.code === 'INVALID_CONTRACT');
});

test('presentation exposes only available views and keeps source names separate from filter IDs', async () => {
  const named = entry('1', 'results', 'synthetic_id', '12.50');
  named.result.Driver.givenName = 'Ana'; named.result.Driver.familyName = 'Lima';
  named.result.Constructor.name = 'Aurora Motors';
  const provider = createProvider(async () => [snapshot(2024, '1', [named]), snapshot(2025, '2', [named])]);
  const descriptor = await provider.describeDataset({ datasetId: 'f1.session_results', locale: 'pt-BR' });
  contracts.assertDataset(descriptor);
  assert.deepEqual(descriptor.presentation.views.map(v => v.id), ['events', 'race', 'teams']);
  assert.deepEqual(descriptor.presentation.views[0].filters, [{ fieldId: 'session', op: 'in', values: ['results', 'sprint'] }]);
  assert.equal(descriptor.presentation.views[0].label.translations['pt-BR'], 'Resultados dos eventos');
  assert.equal(descriptor.presentation.views.find(view => view.id === 'race').visualization.unifyEvents, false);
  assert.equal(descriptor.presentation.defaultVisualization.x, 'round');
  assert.equal(descriptor.presentation.defaultVisualization.unifyEvents, true);
  assert.deepEqual(descriptor.presentation.defaultFilters, [
    { fieldId: 'season', op: 'in', values: ['2025'] },
    { fieldId: 'session', op: 'in', values: ['results', 'sprint'] },
  ]);
  assert.deepEqual(descriptor.presentation.defaultFilters.find(f => f.fieldId === 'season').values, ['2025']);
  const selection = await provider.resolveSelection({ protocolVersion: 1, datasetId: descriptor.id, policy: 'latest', partitionIds: [] });
  const core = await server.ssrLoadModule('/@fs/' + new URL('../../packages/sandbox-core/dist/index.js', import.meta.url).pathname);
  const defaultQuery = core.buildQuery(descriptor, selection, descriptor.presentation.defaultVisualization, descriptor.presentation.defaultFilters, 'new-default');
  assert.equal(defaultQuery.unifyEvents, true);
  assert.deepEqual(defaultQuery.filters.find(filter => filter.fieldId === 'session'), { fieldId: 'session', op: 'in', values: ['results', 'sprint'] });
  const defaultResult = await provider.query(defaultQuery);
  contracts.assertResult(defaultResult, defaultQuery, descriptor);
  assert.equal(defaultResult.rows.length, 1, 'default view queries all available sessions without requiring a race-only filter');
  const facet = await provider.facet({ protocolVersion: 1, datasetId: descriptor.id, selection, fieldId: 'driver', filters: [], search: 'Ana Lima', limit: 100 });
  assert.deepEqual(facet.values, [{ value: 'synthetic_id', label: 'Ana Lima', count: 2 }]);
  const request = { ...base(selection, descriptor), dimensions: ['season', 'driver', 'team'], orderBy: [{ fieldId: 'season', direction: 'asc' }], filters: [{ fieldId: 'driver', op: 'in', values: ['synthetic_id'] }] };
  const result = await provider.query(request); contracts.assertResult(result, request, descriptor);
  assert.equal(result.rows[0].values.driver, 'synthetic_id');
  assert.equal(result.rows[0].values.driver_name, 'Ana Lima');
  assert.equal(result.rows[0].values.team_name, 'Aurora Motors');
});

test('multiple driver ID filters preserve matching rows across seasons and sessions', async () => {
  const provider = createProvider(async () => [
    snapshot(2024, '1', [
      entry('1', 'results', 'driver-a', '5'),
      entry('1', 'sprint', 'driver-b', '2'),
      entry('1', 'results', 'driver-c', '100'),
    ]),
    snapshot(2025, '2', [
      entry('1', 'results', 'driver-a', '7'),
      entry('1', 'sprint', 'driver-b', '3'),
      entry('1', 'results', 'driver-c', '200'),
    ]),
  ]);
  const descriptor = await provider.describeDataset({ datasetId: 'f1.session_results', locale: 'en-US' });
  const selection = await provider.resolveSelection({ protocolVersion: 1, datasetId: descriptor.id, policy: 'latest', partitionIds: [] });
  const query = {
    ...base(selection, descriptor),
    dimensions: ['season', 'session', 'driver'],
    orderBy: [{ fieldId: 'season', direction: 'asc' }, { fieldId: 'session', direction: 'asc' }, { fieldId: 'driver', direction: 'asc' }],
    filters: [
      { fieldId: 'driver', op: 'in', values: ['driver-a', 'driver-b'] },
      { fieldId: 'session', op: 'in', values: ['results', 'sprint'] },
    ],
  };
  const result = await provider.query(query);
  contracts.assertResult(result, query, descriptor);
  assert.deepEqual(result.rows.map(row => [row.values.season, row.values.session, row.values.driver, row.values.points]), [
    ['2024', 'results', 'driver-a', '5'],
    ['2024', 'sprint', 'driver-b', '2'],
    ['2025', 'results', 'driver-a', '7'],
    ['2025', 'sprint', 'driver-b', '3'],
  ]);
});

test('latest resolves fresh snapshots, supports explicit seasons, and keeps old token frozen', async () => {
  let input = [snapshot(2024, '1', [entry('1', 'results', 'a', '1')])];
  const provider = createProvider(async () => structuredClone(input));
  const descriptor = await provider.describeDataset({ datasetId: 'f1.session_results', locale: 'en-US' });
  const req = { protocolVersion: 1, datasetId: descriptor.id, policy: 'latest', partitionIds: [] };
  const old = await provider.resolveSelection(req);
  input = [snapshot(2024, '2', [entry('1', 'results', 'a', '5')]), snapshot(2025, '3', [entry('1', 'results', 'a', '9')])];
  const current = await provider.resolveSelection(req);
  assert.deepEqual(current.revisions.map(r => r.revisionId), ['2', '3']);
  assert.equal((await provider.query(base(old, descriptor))).rows[0].values.points, '1');
  const subset = await provider.resolveSelection({ ...req, partitionIds: ['2025'] });
  assert.equal((await provider.query(base(subset, descriptor))).rows[0].values.points, '9');
  await assert.rejects(provider.resolveSelection({ ...req, partitionIds: ['2023'] }));
  await assert.rejects(provider.resolveSelection({ ...req, partitionIds: ['2025', '2025'] }));
});

test('two scatter metrics share the same grouped rows across seasons', async () => {
  const provider = createProvider(async () => [snapshot(2024, '1', [entry('1', 'results', 'a', '1.25'), entry('1', 'sprint', 'a', '0.5')]), snapshot(2025, '2', [entry('1', 'results', 'a', '3')])]);
  const descriptor = await provider.describeDataset({ datasetId: 'f1.session_results', locale: 'en-US' });
  const selection = await provider.resolveSelection({ protocolVersion: 1, datasetId: descriptor.id, policy: 'latest', partitionIds: [] });
  const query = { ...base(selection, descriptor), dimensions: ['season', 'driver'], metrics: [{ metricId: 'points', aggregation: 'sum' }, { metricId: 'observations', aggregation: 'count' }], orderBy: [{ fieldId: 'season', direction: 'asc' }] };
  const result = await provider.query(query); contracts.assertResult(result, query, descriptor);
  assert.deepEqual(result.rows.map(r => [r.values.season, r.values.points, r.values.observations]), [['2024', '1.75', 2], ['2025', '3', 1]]);
});

test('v2 contract does not permit treating session as a display-only cumulative filter', async () => {
  const provider = createProvider(async () => [snapshot(2024, '1', [entry('1', 'sprint', 'a', '2'), entry('1', 'results', 'a', '5')])]);
  const descriptor = await provider.describeDataset({ datasetId: 'f1.session_results', locale: 'en-US' });
  const selection = await provider.resolveSelection({ protocolVersion: 1, datasetId: descriptor.id, policy: 'latest', partitionIds: [] });
  descriptor.capabilities.runningSum = true;
  descriptor.capabilities.queryVersions = [1, 2];
  descriptor.capabilities.runningSumScopes = ['filteredSelection', 'beforeDisplayFilter'];
  descriptor.metrics.find(metric => metric.id === 'points').supportsRunningSum = true;
  const request = { ...base(selection, descriptor), protocolVersion: 2, dimensions: ['round', 'driver', 'season'], filters: [], displayFilters: [{ fieldId: 'session', op: 'in', values: ['results'] }], orderBy: [{ fieldId: 'round', direction: 'asc' }], window: { kind: 'runningSum', metricId: 'points', orderBy: 'round', partitionBy: ['driver', 'season'], scope: 'beforeDisplayFilter' } };
  assert.throws(() => contracts.assertQuery(request, descriptor));
  // The unmodified production descriptor must continue to reject any running sum.
  await assert.rejects(provider.query(request));
});

test('team grouping updates table data and pie input when selecting a different team', async () => {
  const a = entry('1', 'results', 'a', '3'); a.result.Constructor = { constructorId: 'aurora', name: 'Aurora' };
  const b = entry('1', 'results', 'b', '7'); b.result.Constructor = { constructorId: 'boreal', name: 'Boreal' };
  const provider = createProvider(async () => [snapshot(2024, '1', [a, b])]);
  const descriptor = await provider.describeDataset({ datasetId: 'f1.session_results', locale: 'en-US' });
  const selection = await provider.resolveSelection({ protocolVersion: 1, datasetId: descriptor.id, policy: 'latest', partitionIds: [] });
  const query = { ...base(selection, descriptor), dimensions: ['team', 'season'], orderBy: [{ fieldId: 'team', direction: 'asc' }], filters: [{ fieldId: 'team', op: 'in', values: ['aurora'] }] };
  const first = await provider.query(query); contracts.assertResult(first, query, descriptor);
  assert.equal(first.rows[0].values.team_name, 'Aurora'); assert.equal(first.rows[0].values.points, '3');
  const next = { ...query, filters: [{ fieldId: 'team', op: 'in', values: ['boreal'] }] };
  const second = await provider.query(next); contracts.assertResult(second, next, descriptor);
  assert.equal(second.rows.length, 1); assert.equal(second.rows[0].values.team_name, 'Boreal'); assert.equal(second.rows[0].values.points, '7');
});

test('native default pie configuration produces exact source totals by team and season', async () => {
  const core = await server.ssrLoadModule('/@fs/' + new URL('../../packages/sandbox-core/dist/index.js', import.meta.url).pathname);
  const raw = JSON.parse(await readFile(new URL('./fixtures/f1-default-team-model.json', import.meta.url), 'utf8'));
  const a = entry('1', 'results', 'a', '3.25'); a.result.Constructor = { constructorId: 'alpha', name: 'Alpha' };
  const b = entry('1', 'sprint', 'b', '0.50'); b.result.Constructor = { constructorId: 'alpha', name: 'Alpha' };
  const c = entry('1', 'results', 'c', '7'); c.result.Constructor = { constructorId: 'beta', name: 'Beta' };
  const provider = createProvider(async () => [snapshot(2024, '1', [a, b, c]), snapshot(2025, '2', [a])]);
  const d = await provider.describeDataset({ datasetId: raw.datasetId, locale: 'en-US' });
  const model = contracts.parseModelDocument(raw, d);
  const selection = await provider.resolveSelection({ protocolVersion: 1, datasetId: d.id, ...model.binding });
  const request = core.buildQuery(d, selection, model.visualization, model.filters, 'default-pie');
  const result = await provider.query(request); contracts.assertResult(result, request, d);
  assert.deepEqual(result.rows.map(r => [r.values.team, r.values.season, r.values.points]), [['alpha', '2024', '3.75'], ['alpha', '2025', '3.25'], ['beta', '2024', '7']]);
  const chart = core.buildChartModel(d, request, result, 'pie', 'en-US', model.title);
  assert.deepEqual(chart.slices.map(s => s.value), [3.75, 3.25, 7]);
});

test('v3 cumulative uses chronological sessions before round/session display crop and isolates seasons', async () => {
  const calendar = [
    { round: '1', date: '2024-03-03', time: '15:00:00Z', sprintDate: '2024-03-02', sprintTime: '12:00:00Z' },
    { round: '2', date: '2024-03-10', time: '15:00:00Z', sprintDate: '2024-03-09', sprintTime: '12:00:00Z' },
  ];
  const s = snapshot(2024, '1', [entry('1', 'results', 'a', '5'), entry('1', 'sprint', 'a', '2'), entry('2', 'sprint', 'a', '1.5'), entry('2', 'results', 'a', '3'), entry('2', 'results', 'a', '0.5')]); s.calendar = calendar;
  const other = snapshot(2025, '2', [entry('1', 'results', 'a', '10')]); other.calendar = [{ round: '1', date: '2025-03-03', time: '15:00:00Z', sprintDate: null, sprintTime: null }];
  let input = [s, other]; const provider = createProvider(async () => structuredClone(input));
  const d = await provider.describeDataset({ datasetId: 'f1.session_results', locale: 'en-US' });
  const selection = await provider.resolveSelection({ protocolVersion: 1, datasetId: d.id, policy: 'latest', partitionIds: [] });
  const q = { ...base(selection, d), protocolVersion: 3, dimensions: ['round', 'driver', 'season', 'session'], window: { kind: 'runningSum', metricId: 'points', orderBy: 'round', partitionBy: ['driver', 'season'], scope: 'profile', profileId: 'driver-all-sessions-v1' }, displayFilters: [{ fieldId: 'round', op: 'range', min: 2 }, { fieldId: 'session', op: 'in', values: ['results'] }], orderBy: [{ fieldId: 'round', direction: 'desc' }] };
  const result = await provider.query(q); contracts.assertResult(result, q, d);
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].values.points, '12.0');
  const changedTeam = structuredClone(s); changedTeam.id = '6';
  changedTeam.results[0].result.Constructor.constructorId = 'previous-team';
  changedTeam.results[2].result.Constructor.constructorId = 'new-team';
  input = [changedTeam];
  const changedSelection = await provider.resolveSelection({ protocolVersion: 1, datasetId: d.id, policy: 'latest', partitionIds: [] });
  assert.equal((await provider.query({ ...q, selection: changedSelection })).rows[0].values.points, '12.0');
  await assert.rejects(provider.query({ ...q, selection: changedSelection, filters: [{ fieldId: 'team', op: 'in', values: ['new-team'] }] }), error => error.code === 'INVALID_QUERY' && error.fieldId === 'team');
  const legacy = { ...base(changedSelection, d), dimensions: ['round', 'season'], filters: [{ fieldId: 'team', op: 'in', values: ['new-team'] }], window: { kind: 'runningSum', metricId: 'points', orderBy: 'round', partitionBy: ['season'], scope: 'filteredSelection' } };
  await assert.rejects(provider.query(legacy), error => error.code === 'INVALID_QUERY' && error.fieldId === 'team');
  const all = await provider.query({ ...q, displayFilters: [] });
  assert.equal(all.rows.find(r => r.values.season === '2025').values.points, '10');
  const missing = structuredClone(s); missing.id = '3'; missing.calendar[0].sprintTime = null;
  input = [missing]; const missingSelection = await provider.resolveSelection({ protocolVersion: 1, datasetId: d.id, policy: 'latest', partitionIds: [] });
  await assert.rejects(provider.query({ ...q, selection: missingSelection }), error => error.code === 'ORDER_UNAVAILABLE');
  const tied = structuredClone(s); tied.id = '4'; tied.calendar[0].sprintDate = tied.calendar[0].date; tied.calendar[0].sprintTime = tied.calendar[0].time;
  input = [tied]; const tieSelection = await provider.resolveSelection({ protocolVersion: 1, datasetId: d.id, policy: 'latest', partitionIds: [] });
  await assert.rejects(provider.query({ ...q, selection: tieSelection }), error => error.code === 'ORDER_UNAVAILABLE');
  const unknown = structuredClone(s); unknown.id = '5'; unknown.results[1].result.points = null;
  input = [unknown]; const nullSelection = await provider.resolveSelection({ protocolVersion: 1, datasetId: d.id, policy: 'latest', partitionIds: [] });
  assert.equal((await provider.query({ ...q, selection: nullSelection })).rows[0].values.points, null);
});

test('team grouping retains driver cumulative identity, changes teams without reset and rejects ambiguous assignments', async () => {
  const core = await server.ssrLoadModule('/@fs/' + new URL('../../packages/sandbox-core/dist/index.js', import.meta.url).pathname);
  const item = (round, session, driver, team, points) => { const r = entry(round, session, driver, points); r.result.Constructor = { constructorId: team, name: team }; return r; };
  const one = snapshot(2024, '1', [item('1', 'sprint', 'a', 'old', '2'), item('1', 'results', 'a', 'old', '5'), item('2', 'results', 'a', 'new', '3'), item('1', 'results', 'b', 'old', '4'), item('2', 'results', 'b', 'old', null)]);
  one.calendar = [{ round: '1', date: '2024-03-03', time: '15:00:00Z', sprintDate: '2024-03-02', sprintTime: '12:00:00Z' }, { round: '2', date: '2024-03-10', time: '15:00:00Z', sprintDate: null, sprintTime: null }];
  const two = snapshot(2025, '2', [item('1', 'results', 'a', 'new', '11')]); two.calendar = [{ round: '1', date: '2025-03-03', time: '15:00:00Z', sprintDate: null, sprintTime: null }];
  let input = [one, two]; const provider = createProvider(async () => structuredClone(input));
  const d = await provider.describeDataset({ datasetId: 'f1.session_results', locale: 'en-US' });
  const selection = await provider.resolveSelection({ protocolVersion: 1, datasetId: d.id, policy: 'latest', partitionIds: [] });
  const view = core.withCalculationProfile(d, d.presentation.defaultVisualization, 'driver-sessions-by-team-v1');
  assert.equal(view.x, 'round'); assert.equal(view.series, 'team'); assert.ok(view.extraDimensions.includes('driver'));
  const query = core.buildQuery(d, selection, view, [], 'teams-v3');
  assert.deepEqual(query.window.partitionBy, ['driver', 'season']);
  const result = await provider.query(query); contracts.assertResult(result, query, d);
  const value = (year, round, driver, session) => result.rows.find(r => r.values.season === year && r.values.round === round && r.values.driver === driver && r.values.session === session)?.values;
  assert.equal(value('2024', 1, 'a', 'sprint').points, '2');
  assert.equal(value('2024', 1, 'a', 'results').points, '7');
  assert.equal(value('2024', 2, 'a', 'results').points, '10');
  assert.equal(value('2024', 2, 'a', 'results').team, 'new');
  assert.equal(value('2024', 2, 'b', 'results').points, null);
  assert.equal(value('2025', 1, 'a', 'results').points, '11');
  const cropped = await provider.query({ ...query, displayFilters: [{ fieldId: 'round', op: 'range', min: 2 }, { fieldId: 'session', op: 'in', values: ['results'] }] });
  assert.equal(cropped.rows.find(r => r.values.driver === 'a').values.points, '10');
  const chart = core.buildChartModel(d, query, result, 'bar', 'en-US', 'Synthetic');
  assert.ok(chart.series.some(s => s.label.includes('new') && s.label.includes('a')));
  assert.ok(chart.series.some(s => s.label.includes('old') && s.label.includes('b')));
  const ambiguous = structuredClone(one); ambiguous.id = '3'; ambiguous.results.push(item('1', 'results', 'a', 'new', '1'));
  input = [ambiguous]; const bad = await provider.resolveSelection({ protocolVersion: 1, datasetId: d.id, policy: 'latest', partitionIds: [] });
  await assert.rejects(provider.query({ ...query, selection: bad }), error => error.code === 'ORDER_UNAVAILABLE');
  const missing = structuredClone(one); missing.id = '4'; missing.calendar[0].sprintTime = null; input = [missing];
  const missingSelection = await provider.resolveSelection({ protocolVersion: 1, datasetId: d.id, policy: 'latest', partitionIds: [] });
  await assert.rejects(provider.query({ ...query, selection: missingSelection }), error => error.code === 'ORDER_UNAVAILABLE');
});

test('cumulative profile carries only known past absences; explicit zero and null remain distinct', async () => {
  const calendar = [
    { round: '1', date: '2026-03-01', time: '12:00:00Z', sprintDate: null, sprintTime: null },
    { round: '2', date: '2026-03-08', time: '12:00:00Z', sprintDate: '2026-03-07', sprintTime: '12:00:00Z' },
    { round: '3', date: '2026-03-15', time: '12:00:00Z', sprintDate: null, sprintTime: null },
    { round: '4', date: '2099-03-22', time: '12:00:00Z', sprintDate: null, sprintTime: null },
  ];
  const s = snapshot(2026, 'carry', [
    entry('1', 'results', 'a', '8'),
    entry('2', 'sprint', 'b', '2'), entry('2', 'results', 'a', '0'),
    entry('3', 'results', 'b', '0'),
    entry('4', 'results', 'b', '0'),
  ]);
  s.calendar = calendar; s.integrity = { validatedEndpoints: ['races', 'results', 'sprint'] };
  const provider = createProvider(async () => [s], () => Date.parse('2026-04-01T00:00:00Z'));
  const d = await provider.describeDataset({ datasetId: 'f1.session_results', locale: 'en-US' });
  const selection = await provider.resolveSelection({ protocolVersion: 1, datasetId: d.id, policy: 'latest', partitionIds: [] });
  const query = { ...base(selection, d), protocolVersion: 3, dimensions: ['round', 'driver', 'season', 'session'], filters: [{ fieldId: 'driver', op: 'in', values: ['a'] }], displayFilters: [{ fieldId: 'session', op: 'in', values: ['results', 'sprint'] }], window: { kind: 'runningSum', metricId: 'points', orderBy: 'round', partitionBy: ['driver', 'season'], scope: 'profile', profileId: 'driver-all-sessions-v1' } };
  const result = await provider.query(query); contracts.assertResult(result, query, d);
  assert.equal(result.rows.find(row => row.values.round === 1 && row.values.session === 'results').values.points, '8');
  assert.equal(result.rows.find(row => row.values.round === 2 && row.values.session === 'results').values.points, '8');
  assert.equal(result.rows.find(row => row.values.round === 2 && row.values.session === 'sprint').values.points, '8');
  assert.equal(result.rows.find(row => row.values.round === 3 && row.values.session === 'results').values.points, '8');
  assert.equal(result.rows.some(row => row.values.round === 4), false, 'future event must not create carry rows');

  const unknown = structuredClone(s); unknown.integrity = undefined; unknown.id = 'unknown';
  const unknownProvider = createProvider(async () => [unknown], () => Date.parse('2026-04-01T00:00:00Z'));
  const unknownSelection = await unknownProvider.resolveSelection({ protocolVersion: 1, datasetId: d.id, policy: 'latest', partitionIds: [] });
  const unknownResult = await unknownProvider.query({ ...query, selection: unknownSelection });
  assert.equal(unknownResult.rows.some(row => row.values.round === 2 && row.values.session === 'sprint' && row.values.driver === 'a'), false, 'missing integrity stays a gap');

  const nullData = structuredClone(s); nullData.id = 'null'; nullData.results[0].result.points = null;
  nullData.results.push(entry('3', 'results', 'a', '0'));
  const nullProvider = createProvider(async () => [nullData], () => Date.parse('2026-04-01T00:00:00Z'));
  const nullSelection = await nullProvider.resolveSelection({ protocolVersion: 1, datasetId: d.id, policy: 'latest', partitionIds: [] });
  const nullResult = await nullProvider.query({ ...query, selection: nullSelection });
  assert.equal(nullResult.rows.find(row => row.values.round === 2 && row.values.session === 'results')?.values.points, null);
  assert.equal(nullResult.rows.find(row => row.values.round === 3 && row.values.session === 'results')?.values.points, null);
});

test('event unification occurs after cumulative sums and sums simple session points', async () => {
  const s = snapshot(2026, 'unify', [
    entry('1', 'results', 'a', '8'),
    entry('2', 'sprint', 'a', '2'), entry('2', 'results', 'a', '18'),
  ]);
  s.calendar = [
    { round: '1', date: '2026-03-01', time: '12:00:00Z', sprintDate: null, sprintTime: null },
    { round: '2', date: '2026-03-08', time: '12:00:00Z', sprintDate: '2026-03-07', sprintTime: '12:00:00Z' },
  ];
  const provider = createProvider(async () => [s], () => Date.parse('2026-04-01T00:00:00Z'));
  const d = await provider.describeDataset({ datasetId: 'f1.session_results', locale: 'en-US' });
  assert.deepEqual(d.capabilities.eventUnification, { fieldId: 'session', requiredValues: ['results', 'sprint'] });
  assert.deepEqual(d.presentation.views.map(view => view.id), ['events', 'race', 'sprint', 'teams']);
  assert.deepEqual(d.presentation.views.find(view => view.id === 'race').filters, [{ fieldId: 'session', op: 'in', values: ['results'] }]);
  assert.deepEqual(d.presentation.views.find(view => view.id === 'sprint').filters, [{ fieldId: 'session', op: 'in', values: ['sprint'] }]);
  assert.equal(d.presentation.views.find(view => view.id === 'race').visualization.unifyEvents, false);
  assert.equal(d.presentation.views.find(view => view.id === 'sprint').visualization.unifyEvents, false);
  const selection = await provider.resolveSelection({ protocolVersion: 1, datasetId: d.id, policy: 'latest', partitionIds: [] });
  const profile = { ...base(selection, d), protocolVersion: 3, dimensions: ['round', 'driver', 'season', 'session'], filters: [{ fieldId: 'driver', op: 'in', values: ['a'] }], displayFilters: [{ fieldId: 'session', op: 'in', values: ['results', 'sprint'] }], window: { kind: 'runningSum', metricId: 'points', orderBy: 'round', partitionBy: ['driver', 'season'], scope: 'profile', profileId: 'driver-all-sessions-v1' } };
  const separate = await provider.query(profile);
  assert.equal(separate.rows.filter(row => row.values.round === 2).length, 2);
  const unified = await provider.query({ ...profile, unifyEvents: true });
  contracts.assertResult(unified, { ...profile, unifyEvents: true }, d);
  assert.equal(unified.rows.filter(row => row.values.round === 2).length, 1);
  assert.equal(unified.rows.find(row => row.values.round === 2).values.points, '28');
  assert.equal(unified.rows.find(row => row.values.round === 2).values.session, 'results');

  const simple = { ...base(selection, d), dimensions: ['round', 'driver', 'season', 'session'], filters: [{ fieldId: 'driver', op: 'in', values: ['a'] }, { fieldId: 'session', op: 'in', values: ['results', 'sprint'] }] };
  const simpleSeparate = await provider.query(simple);
  assert.equal(simpleSeparate.rows.filter(row => row.values.round === 2).length, 2);
  await assert.rejects(provider.query({ ...simple, filters: [{ fieldId: 'driver', op: 'in', values: ['a'] }], unifyEvents: true }), error => error.code === 'INVALID_QUERY');
  const simpleUnified = await provider.query({ ...simple, unifyEvents: true });
  assert.equal(simpleUnified.rows.find(row => row.values.round === 2).values.points, '20');
  assert.equal(simpleUnified.rows.find(row => row.values.round === 2).values.session, 'results');
});

test('event unification reaggregates raw simple values, preserves metric types, and needs no round chronology', async () => {
  const s = snapshot(2026, 'raw-unify', [
    entry('1', 'results', 'a', '2'), entry('1', 'results', 'a', '4'),
    entry('1', 'sprint', 'a', '100'),
  ]);
  const provider = createProvider(async () => [s]);
  const d = await provider.describeDataset({ datasetId: 'f1.session_results', locale: 'en-US' });
  const selection = await provider.resolveSelection({ protocolVersion: 1, datasetId: d.id, policy: 'latest', partitionIds: [] });
  const query = { ...base(selection, d), dimensions: ['team', 'season', 'session'], filters: [{ fieldId: 'session', op: 'in', values: ['results', 'sprint'] }], orderBy: [{ fieldId: 'team', direction: 'asc' }] };
  const countQuery = { ...query, metrics: [{ metricId: 'observations', aggregation: 'count' }], unifyEvents: true };
  const count = await provider.query(countQuery); contracts.assertResult(count, countQuery, d);
  assert.equal(count.rows.length, 1); assert.equal(count.rows[0].values.observations, 3); assert.equal(typeof count.rows[0].values.observations, 'number');

  const meanQuery = { ...query, metrics: [{ metricId: 'points', aggregation: 'mean' }], unifyEvents: true };
  const mean = await provider.query(meanQuery); contracts.assertResult(mean, meanQuery, d);
  assert.equal(mean.rows.length, 1);
  assert.equal(mean.rows[0].values.points, '35.333333333333');
  assert.equal(mean.rows[0].values.session, 'results', 'session representative is stable without round chronology');
});

test('unified raw reaggregation honors population filters not present in dimensions', async () => {
  const s = snapshot(2026, 'filtered-unify', [
    entry('1', 'results', 'a', '2'), entry('1', 'results', 'a', '4'), entry('1', 'sprint', 'a', '100'),
    entry('1', 'results', 'b', '1000'), entry('1', 'sprint', 'b', '2000'),
  ]);
  const provider = createProvider(async () => [s]);
  const d = await provider.describeDataset({ datasetId: 'f1.session_results', locale: 'en-US' });
  const selection = await provider.resolveSelection({ protocolVersion: 1, datasetId: d.id, policy: 'latest', partitionIds: [] });
  const common = { ...base(selection, d), dimensions: ['round', 'season', 'session'], filters: [{ fieldId: 'driver', op: 'in', values: ['a'] }, { fieldId: 'session', op: 'in', values: ['results', 'sprint'] }], unifyEvents: true };
  const meanQuery = { ...common, metrics: [{ metricId: 'points', aggregation: 'mean' }] };
  const mean = await provider.query(meanQuery); contracts.assertResult(mean, meanQuery, d);
  assert.equal(mean.rows.length, 1); assert.equal(mean.rows[0].values.points, '35.333333333333');
  const countQuery = { ...common, metrics: [{ metricId: 'observations', aggregation: 'count' }] };
  const count = await provider.query(countQuery); contracts.assertResult(count, countQuery, d);
  assert.equal(count.rows[0].values.observations, 3);

  const withoutRound = { ...common, dimensions: ['team', 'season', 'session'], orderBy: [{ fieldId: 'team', direction: 'asc' }] };
  const noRoundMeanQuery = { ...withoutRound, metrics: [{ metricId: 'points', aggregation: 'mean' }] };
  const noRoundMean = await provider.query(noRoundMeanQuery); contracts.assertResult(noRoundMean, noRoundMeanQuery, d);
  assert.equal(noRoundMean.rows.length, 1); assert.equal(noRoundMean.rows[0].values.points, '35.333333333333');
  const noRoundCountQuery = { ...withoutRound, metrics: [{ metricId: 'observations', aggregation: 'count' }] };
  const noRoundCount = await provider.query(noRoundCountQuery); contracts.assertResult(noRoundCount, noRoundCountQuery, d);
  assert.equal(noRoundCount.rows[0].values.observations, 3);
});

test('unified cumulative result stays unknown for an empty past race but uses sprint before a future race', async () => {
  const s = snapshot(2026, 'missing-race', [
    entry('1', 'results', 'a', '8'),
    entry('2', 'sprint', 'a', '2'),
  ]);
  s.calendar = [
    { round: '1', date: '2026-03-01', time: '12:00:00Z', sprintDate: null, sprintTime: null },
    { round: '2', date: '2026-03-08', time: '12:00:00Z', sprintDate: '2026-03-07', sprintTime: '12:00:00Z' },
  ];
  s.integrity = { validatedEndpoints: ['races', 'results', 'sprint'] };
  const provider = createProvider(async () => [s], () => Date.parse('2026-03-07T18:00:00Z'));
  const d = await provider.describeDataset({ datasetId: 'f1.session_results', locale: 'en-US' });
  const selection = await provider.resolveSelection({ protocolVersion: 1, datasetId: d.id, policy: 'latest', partitionIds: [] });
  const query = { ...base(selection, d), protocolVersion: 3, dimensions: ['round', 'driver', 'season', 'session'], filters: [{ fieldId: 'driver', op: 'in', values: ['a'] }], displayFilters: [{ fieldId: 'session', op: 'in', values: ['results', 'sprint'] }], unifyEvents: true, window: { kind: 'runningSum', metricId: 'points', orderBy: 'round', partitionBy: ['driver', 'season'], scope: 'profile', profileId: 'driver-all-sessions-v1' } };
  const future = await provider.query(query);
  assert.equal(future.rows.find(row => row.values.round === 2).values.points, '10');
  assert.equal(future.rows.find(row => row.values.round === 2).values.session, 'sprint');

  const past = createProvider(async () => [s], () => Date.parse('2026-03-09T00:00:00Z'));
  const pastSelection = await past.resolveSelection({ protocolVersion: 1, datasetId: d.id, policy: 'latest', partitionIds: [] });
  const pastResult = await past.query({ ...query, selection: pastSelection });
  assert.equal(pastResult.rows.find(row => row.values.round === 2).values.points, null);
});

test('line-chart provider preserves every driver and season at shared X/Y coordinates', async () => {
  const namedEntry = (driver, firstName, lastName, points) => {
    const result = entry('1', 'results', driver, points);
    result.result.Driver.givenName = firstName;
    result.result.Driver.familyName = lastName;
    return result;
  };
  const provider = createProvider(async () => [
    snapshot(2024, 'tooltip-2024', [
      namedEntry('driver-a', 'Ana', 'Lima', '0'),
      namedEntry('driver-b', 'Bruno', 'Costa', '5'),
    ]),
    snapshot(2025, 'tooltip-2025', [
      namedEntry('driver-a', 'Ana', 'Lima', '0'),
      namedEntry('driver-b', 'Bruno', 'Costa', '7'),
    ]),
  ]);
  const descriptor = await provider.describeDataset({ datasetId: 'f1.session_results', locale: 'en-US' });
  const selection = await provider.resolveSelection({ protocolVersion: 1, datasetId: descriptor.id, policy: 'latest', partitionIds: [] });
  const query = {
    ...base(selection, descriptor),
    dimensions: ['round', 'driver', 'season'],
    orderBy: [{ fieldId: 'round', direction: 'asc' }],
  };
  const result = await provider.query(query);
  contracts.assertResult(result, query, descriptor);
  assert.deepEqual(result.rows.map(row => [
    row.values.round, row.values.driver, row.values.driver_name, row.values.season, row.values.points,
  ]), [
    [1, 'driver-a', 'Ana Lima', '2024', '0'],
    [1, 'driver-a', 'Ana Lima', '2025', '0'],
    [1, 'driver-b', 'Bruno Costa', '2024', '5'],
    [1, 'driver-b', 'Bruno Costa', '2025', '7'],
  ]);

  const core = await server.ssrLoadModule('/@fs/' + new URL('../../packages/sandbox-core/dist/index.js', import.meta.url).pathname);
  const chart = core.buildChartModel(descriptor, query, result, 'line', 'en-US', 'Shared coordinates');
  assert.deepEqual(chart.series.map(series => [series.label, series.dimensions, series.values]), [
    ['Ana Lima · 2024', { driver: 'driver-a', season: '2024' }, [0]],
    ['Ana Lima · 2025', { driver: 'driver-a', season: '2025' }, [0]],
    ['Bruno Costa · 2024', { driver: 'driver-b', season: '2024' }, [5]],
    ['Bruno Costa · 2025', { driver: 'driver-b', season: '2025' }, [7]],
  ]);
});
