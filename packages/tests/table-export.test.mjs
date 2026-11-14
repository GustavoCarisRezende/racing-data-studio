import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery, defaultVisualization, exportTableResult } from '@rds/sandbox-core';
import { v2Fixture } from './v2-fixture.mjs';
import { resolve } from './helpers.mjs';

test('CSV includes all ordered visible rows, escapes formulas, and carries provenance', async () => {
  const { provider, descriptor: d } = v2Fixture();
  const q = buildQuery(d, await resolve(provider), defaultVisualization(d), [], 'export-table');
  const result = await provider.query(q);
  const sample = result.rows[0];
  result.rows = Array.from({ length: 60 }, (_, i) => ({ id: `row-${i}`, values: { ...sample.values, week: i + 1, campaign: i === 0 ? '=synthetic' : '2024', harvest: `${i}.25` } }));
  result.totalRows = result.rows.length;
  const table = { version: 2, columns: ['campaign', 'harvest'], sorts: [{ columnId: 'harvest', direction: 'desc' }], groupBy: 'campaign' };
  const [csv, manifest] = exportTableResult(d, q, result, 'Synthetic', table, 'en-US');
  const lines = csv.text.trimEnd().split('\r\n');
  assert.equal(lines.length, 61);
  assert.equal(lines[0], '"Campaign","Harvest"');
  assert.ok(lines.some(line => line.includes("\"'=synthetic\"")));
  assert.equal(lines[1], '"2024","59.25"');
  const metadata = JSON.parse(manifest.text);
  assert.equal(metadata.rowCount, 60);
  assert.deepEqual(metadata.table, table);
  assert.deepEqual(metadata.sources, d.sources);
  assert.throws(() => exportTableResult(d, q, { ...result, complete: false }, 'x', table, 'en-US'));
});
