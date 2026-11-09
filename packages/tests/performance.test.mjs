import test from 'node:test';
import assert from 'node:assert/strict';
import { assertResult } from '@rds/sandbox-contracts';
import { buildChartModel, buildQuery, defaultVisualization, exportResult } from '@rds/sandbox-core';
import { descriptor, fixture, resolve } from './helpers.mjs';

test('bounded 5000-row query validates, plots and exports without sampling', async t => {
  const { provider } = fixture();
  const q = buildQuery(descriptor, await resolve(provider), defaultVisualization(descriptor), [], 'load-test');
  const r = { protocolVersion: 1, requestId: q.requestId, selectionToken: q.selection.token,
    columns: [{ id: 'week', label: { fallback: 'Week' }, type: 'integer' }, { id: 'harvest', label: { fallback: 'Harvest' }, type: 'decimal', unit: 'kg' }],
    rows: Array.from({ length: 5000 }, (_, i) => ({ id: `row-${i}`, values: { week: i + 1, harvest: '1.25' } })), complete: true, totalRows: 5000, warnings: [] };
  const start = performance.now();
  assertResult(r, q, descriptor);
  const chart = buildChartModel(descriptor, q, r, 'line', 'en-US', 'Synthetic load');
  const files = exportResult(descriptor, q, r, 'Synthetic load');
  assert.equal(chart.series[0].values.length, 5000);
  assert.equal(JSON.parse(files[1].text).rowCount, 5000);
  t.diagnostic(`Validation + chart model + CSV of 5000 rows: ${(performance.now() - start).toFixed(1)}ms (not WebView rendering)`);
});
