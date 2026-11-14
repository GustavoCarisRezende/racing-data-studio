import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { Sandbox } from '@rds/sandbox-react';
import { buildQuery, makeModel, makeModelV3, summarizeTableBy, withCalculationProfile } from '@rds/sandbox-core';
import { createMemoryModelStore, createMemoryStore } from '../examples/memory-provider.mjs';
import { syntheticF1From } from './f1-fixture.mjs';

const result = (round, driver, points) => ({ round: String(round), session: 'results', result: { Driver: { driverId: driver }, Constructor: { constructorId: 'team' }, points } });
const snapshot = (year, results) => ({ year, id: String(year), storedAt: '2026-01-02T00:00:00Z', sourceDataAt: '2026-01-01T00:00:00Z', calendar: [1, 2].map(round => ({ round: String(round), date: `${year}-03-0${round}`, time: '12:00:00Z', sprintDate: null, sprintTime: null })), results });
const snapshots = [snapshot(2024, [result(1, 'a', '1.1'), result(2, 'a', '2.2'), result(2, 'b', '4')]), snapshot(2025, [result(1, 'a', '7'), result(2, 'a', '8')])];
const baseline = { kind: 'table', x: 'round', metric: { metricId: 'points', aggregation: 'sum' }, series: 'driver', comparison: 'season', runningSum: false };
const filters = [{ fieldId: 'season', op: 'in', values: ['2024', '2025'] }];

test('recalculation converts a cumulative profile to source-grain query, preserving filters', async () => {
  const provider = syntheticF1From(snapshots);
  const d = await provider.describeDataset({ datasetId: 'f1.session_results', locale: 'en-US' });
  const selection = await provider.resolveSelection({ protocolVersion: 1, datasetId: d.id, policy: 'latest', partitionIds: [] });
  const cumulative = withCalculationProfile(d, baseline, 'driver-all-sessions-v1');
  const next = summarizeTableBy(d, cumulative, 'driver');
  assert.ok(next);
  assert.equal(next.runningSum, false);
  assert.equal(next.calculation, undefined);
  assert.equal(next.extraDimensions, undefined);
  const cropped = [...filters, { fieldId: 'round', op: 'in', values: [2] }];
  const before = buildQuery(d, selection, cumulative, cropped, 'cumulative-before');
  assert.deepEqual(before.displayFilters, [cropped[1]]);
  assert.ok(before.window);
  const q = buildQuery(d, selection, next, cropped, 'summary');
  assert.deepEqual(q.dimensions, ['driver', 'season']);
  assert.equal(q.window, undefined);
  assert.deepEqual(q.filters, cropped);
  const rows = (await provider.query(q)).rows.map(r => [r.values.driver, r.values.season, r.values.points]).sort();
  assert.deepEqual(rows, [['a', '2024', '2.2'], ['a', '2025', '8'], ['b', '2024', '4']]);
  const mean = summarizeTableBy(d, { ...baseline, metric: { metricId: 'points', aggregation: 'mean' } }, 'driver');
  const meanQuery = buildQuery(d, selection, mean, filters, 'summary-mean');
  assert.equal((await provider.query(meanQuery)).rows.find(r => r.values.driver === 'a' && r.values.season === '2024').values.points, '1.650000000000');
  const v2Store = createMemoryStore(d);
  const v2Saved = await v2Store.models.save(makeModel(d, [], next, cropped, 'Synthetic v2'), null);
  const v2Loaded = await v2Store.models.load(v2Saved.id);
  assert.equal(v2Loaded.documentVersion, 2);
  assert.equal(v2Loaded.visualization.x, 'driver');
  assert.deepEqual(v2Loaded.filters, cropped);
  assert.equal(summarizeTableBy(d, cumulative, 'points_raw'), null);
});

test('table UI recalculates driver/season totals, persists model v3 and reopens without migration', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://synthetic.invalid' });
  const old = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) { old.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value }); }
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  const provider = syntheticF1From(snapshots);
  const d = await provider.describeDataset({ datasetId: 'f1.session_results', locale: 'en-US' });
  const store = { ...createMemoryStore(d), modelsV3: createMemoryModelStore(d, 3) };
  const original = await store.modelsV3.save(makeModelV3(d, [], baseline, filters, 'Synthetic'), null);
  const queries = [];
  const query = provider.query;
  provider.query = async (...args) => { const response = await query(...args); queries.push({ q: args[0], response }); return response; };
  const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await delay(140); }); };
  const click = async text => { const b = [...document.querySelectorAll('button')].find(node => node.textContent === text); assert.ok(b, text); await act(async () => b.click()); await settle(); };
  try {
    await act(async () => root.render(createElement(Sandbox, { provider, store }))); await settle();
    await act(async () => document.querySelector('.rds-sb-model-card button[aria-label^="Edit model:"]').click()); await settle();
    assert.deepEqual((await store.modelsV3.load(original.id)), original, 'opening does not migrate or rewrite');
    const select = [...document.querySelectorAll('label')].find(l => l.firstChild?.textContent === 'Recalculate by').querySelector('select');
    await act(async () => { select.value = 'driver'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); await settle();
    assert.ok(document.body.textContent.includes('Result grouping: Driver · Season'));
    await click('Apply and recalculate');
    const last = queries.at(-1);
    assert.deepEqual(last.q.dimensions, ['driver', 'season']);
    assert.equal(last.q.window, undefined);
    assert.deepEqual(last.q.filters, filters);
    assert.deepEqual(last.response.rows.map(r => [r.values.driver, r.values.season, r.values.points]).sort(), [['a', '2024', '3.3'], ['a', '2025', '15'], ['b', '2024', '4']]);
    await click('Save model');
    const saved = await store.modelsV3.load(original.id);
    assert.equal(saved.documentVersion, 3);
    assert.equal(saved.visualization.x, 'driver');
    assert.equal(saved.visualization.comparison, 'season');
    assert.equal(saved.visualization.calculation, undefined);
    assert.deepEqual(saved.filters, filters);
    await act(async () => document.querySelector('.rds-sb-model-card button[aria-label^="Edit model:"]').click()); await settle();
    assert.deepEqual(queries.at(-1).q.dimensions, ['driver', 'season']);
    assert.ok(document.body.textContent.includes('Current query grouping: Driver · Season'));
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, value] of old) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; }
  }
});
