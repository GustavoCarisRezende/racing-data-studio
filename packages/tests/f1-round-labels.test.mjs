import test from 'node:test';
import assert from 'node:assert/strict';
import { assertResult } from '@rds/sandbox-contracts';
import { buildChartModel } from '@rds/sandbox-core';
import { syntheticF1From } from './f1-fixture.mjs';

test('round labels retain season identity and do not invent missing or ambiguous event names', async () => {
  const snapshot = (year, name) => ({ year, id: String(year), storedAt: '2026-01-02T00:00:00Z', sourceDataAt: '2026-01-01T00:00:00Z',
    calendar: [{ round: '1', raceName: name, date: null, time: null, sprintDate: null, sprintTime: null }],
    results: [{ round: '1', session: 'results', result: { Driver: { driverId: 'a' }, Constructor: { constructorId: 'x' }, points: '1' } }, { round: '2', session: 'results', result: { Driver: { driverId: 'a' }, points: '2' } }] });
  const provider = syntheticF1From([snapshot(2024, 'North GP'), snapshot(2025, 'South GP')]);
  const d = await provider.describeDataset({ datasetId: 'f1.session_results', locale: 'en-US' });
  const selection = await provider.resolveSelection({ protocolVersion: 1, datasetId: d.id, policy: 'latest', partitionIds: [] });
  const q = { protocolVersion: 1, requestId: 'rounds', datasetId: d.id, schemaVersion: d.schemaVersion, semanticVersion: d.semanticVersion, selection, dimensions: ['round', 'season'], metrics: [{ metricId: 'points', aggregation: 'sum' }], filters: [], orderBy: [{ fieldId: 'round', direction: 'asc' }], limit: 100 };
  const result = await provider.query(q); assertResult(result, q, d);
  assert.deepEqual(result.rows.filter(r => r.values.round === 1).map(r => r.values.round_name), ['1 · North GP', '1 · South GP']);
  assert.ok(result.rows.filter(r => r.values.round === 2).every(r => r.values.round_name === null));
  const chart = buildChartModel(d, q, result, 'line', 'en-US', 'Synthetic');
  assert.deepEqual(chart.categories.map(c => c.label), ['1', '2']);
  const facet = await provider.facet({ protocolVersion: 1, datasetId: d.id, selection, fieldId: 'round', filters: [], search: '', limit: 100 });
  assert.equal(facet.values.find(item => item.value === 1).label, '1');
  const single = await provider.facet({ protocolVersion: 1, datasetId: d.id, selection, fieldId: 'round', filters: [{ fieldId: 'season', op: 'in', values: ['2024'] }], search: '', limit: 100 });
  assert.equal(single.values.find(item => item.value === 1).label, '1 · North GP');
});
