import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortPositions } from '../src/categories/f1/sort.ts';

test('numeric positions sort numerically; special classifications keep their source order', () => {
  const values = ['10', 'R', '2', 'D', '1', '2', '', 'W'];
  const rows = values.map((value, index) => ({ result: { positionText: value }, index }));
  const sorted = sortPositions(rows);
  assert.deepEqual(sorted.map((r) => r.result.positionText), ['1', '2', '2', '10', 'R', 'D', '', 'W']);
  assert.deepEqual(sorted.filter((r) => r.result.positionText === '2').map((r) => r.index), [2, 5]);
  assert.deepEqual(rows.map((r) => r.result.positionText), values);
});
