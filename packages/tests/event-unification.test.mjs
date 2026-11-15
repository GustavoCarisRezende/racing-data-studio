import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDataset, eventUnificationAvailable, parseModelDocumentV3 } from '@rds/sandbox-contracts';
import { buildChartModel, buildQuery, defaultVisualization, makeModelV3, withCalculationProfile } from '@rds/sandbox-core';
import { resolve } from './helpers.mjs';
import { v3Fixture } from './v3-fixture.mjs';

test('optional unification persists and is sent only for the required selection', async () => {
  const { descriptor: d, provider } = v3Fixture();
  d.capabilities.eventUnification = { fieldId: 'phase', requiredValues: ['z-prior', 'a-final'] };
  assertDataset(d);
  const filters = [{ fieldId: 'phase', op: 'in', values: ['z-prior', 'a-final'] }];
  assert.equal(eventUnificationAvailable(d, []), false);
  assert.equal(eventUnificationAvailable(d, filters), true);
  assert.equal(eventUnificationAvailable(d, [{ ...filters[0], values: ['a-final'] }]), false);
  const v = { ...withCalculationProfile(d, defaultVisualization(d), 'all-visits-v1'), unifyEvents: true };
  const selection = await resolve(provider);
  const saved = makeModelV3(d, [], v, filters, 'Unified');
  assert.equal(parseModelDocumentV3(saved, d).visualization.unifyEvents, true);
  assert.equal(buildQuery(d, selection, v, filters, 'both').unifyEvents, true);
  assert.equal(buildQuery(d, selection, v, [{ ...filters[0], values: ['a-final'] }], 'one').unifyEvents, undefined);
  assert.equal(buildQuery(d, selection, { ...v, unifyEvents: false }, filters, 'off').unifyEvents, undefined);
});

test('unified provider results form one series per entity and retain null gaps', async () => {
  const { descriptor: d, provider } = v3Fixture();
  d.capabilities.eventUnification = { fieldId: 'phase', requiredValues: ['z-prior', 'a-final'] };
  const v = { ...withCalculationProfile(d, defaultVisualization(d), 'all-visits-v1'), unifyEvents: true };
  const q = buildQuery(d, await resolve(provider), v, [{ fieldId: 'phase', op: 'in', values: ['z-prior', 'a-final'] }], 'unified');
  const { unifyEvents: _unifyEvents, ...legacyQuery } = q;
  const original = await provider.query(legacyQuery);
  // Simulate provider's already-unified result: it owns chronology and aggregation.
  const rows = original.rows.filter(row => row.values.phase === 'a-final');
  rows[0] = { ...rows[0], values: { ...rows[0].values, harvest: null } };
  const result = { ...original, rows, totalRows: rows.length };
  const chart = buildChartModel(d, q, result, 'line', 'en', 'Unified');
  assert.ok(chart.series.some(series => series.values.includes(null)));
  assert.ok(chart.series.every(series => !series.label.includes('Final')));
  assert.ok(chart.series.length < 6);
});
