import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
