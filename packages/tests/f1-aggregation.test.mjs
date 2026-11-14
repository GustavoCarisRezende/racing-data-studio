import test from 'node:test';
import assert from 'node:assert/strict';
import { assertResult } from '@rds/sandbox-contracts';
import { syntheticF1From } from './f1-fixture.mjs';

test('F1 decimal aggregates propagate nulls and round means without binary floats', async () => {
  const entry = (round, driver, points) => ({ round, session: 'results', result: { Driver: { driverId: driver }, Constructor: { constructorId: 'team' }, points } });
  const provider = syntheticF1From([{ year: 2024, id: '1', storedAt: '2026-01-02T00:00:00Z', sourceDataAt: '2026-01-01T00:00:00Z', results: [
    entry('1', 'a', '0.1'), entry('1', 'b', '0.2'), entry('1', 'c', '0.2'),
    entry('2', 'a', null), entry('2', 'b', '9'),
    entry('3', 'a', '-0.000000000001'), entry('3', 'b', '0'),
    entry('4', 'a', '1.000000000000001'), entry('4', 'b', '1.000000000000002'),
  ] }]);
  const d = await provider.describeDataset({ datasetId: 'f1.session_results', locale: 'en-US' });
  const selection = await provider.resolveSelection({ protocolVersion: 1, datasetId: d.id, policy: 'latest', partitionIds: [] });
  for (const [aggregation, expected] of [
    ['sum', ['0.5', null, '-0.000000000001', '2.000000000000003']],
    ['min', ['0.1', null, '-0.000000000001', '1.000000000000001']],
    ['max', ['0.2', null, '0', '1.000000000000002']],
    ['mean', ['0.166666666667', null, '-0.000000000001', '1.000000000000002']],
  ]) {
    const q = { protocolVersion: 1, requestId: 'test', datasetId: d.id, schemaVersion: d.schemaVersion, semanticVersion: d.semanticVersion, selection, dimensions: ['season', 'round'], metrics: [{ metricId: 'points', aggregation }], filters: [], orderBy: [{ fieldId: 'round', direction: 'asc' }], limit: 100 };
    const result = await provider.query(q);
    assertResult(result, q, d);
    assert.deepEqual(result.rows.map(row => row.values.points), expected);
  }
});

test('query grouped by driver and season recalculates across rounds without mixing seasons', async () => {
  const entry = (round, driver, points) => ({ round, session: 'results', result: { Driver: { driverId: driver }, points } });
  const snapshot = (year, results) => ({ year, id: String(year), storedAt: '2026-01-02T00:00:00Z', sourceDataAt: '2026-01-01T00:00:00Z', results });
  const provider = syntheticF1From([snapshot(2024, [entry('1', 'a', '1.1'), entry('2', 'a', '2.2'), entry('2', 'b', '4')]), snapshot(2025, [entry('1', 'a', '7')])]);
  const d = await provider.describeDataset({ datasetId: 'f1.session_results', locale: 'en-US' });
  const selection = await provider.resolveSelection({ protocolVersion: 1, datasetId: d.id, policy: 'latest', partitionIds: [] });
  const q = { protocolVersion: 1, requestId: 'driver-season', datasetId: d.id, schemaVersion: d.schemaVersion, semanticVersion: d.semanticVersion, selection, dimensions: ['driver', 'season'], metrics: [{ metricId: 'points', aggregation: 'sum' }], filters: [], orderBy: [], limit: 100 };
  const result = await provider.query(q);
  assertResult(result, q, d);
  assert.deepEqual(result.rows.map(r => [r.values.driver, r.values.season, r.values.points]).sort(), [['a', '2024', '3.3'], ['a', '2025', '7'], ['b', '2024', '4']]);
});
