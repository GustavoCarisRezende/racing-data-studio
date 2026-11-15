import test from 'node:test';
import assert from 'node:assert/strict';
import { filterYears, filterSyncYears, isYearChoiceValid } from '../src/categories/f1/year-search.ts';

test('year query filters locally and yields no matches without network work', () => {
  assert.deepEqual(filterYears([2026, 2025, 2024, 1994], '202'), [2026, 2025, 2024]);
  assert.deepEqual(filterYears([2026, 2025, 2024, 1994], '1888'), []);
});

test('a selected year removed by the query is no longer a valid import choice', () => {
  const filtered = filterYears([2026, 2025, 2024], '2025');
  assert.deepEqual(filtered, [2025]);
  assert.equal(isYearChoiceValid(2026, filtered), false);
  assert.equal(isYearChoiceValid(2025, filtered), true);
});

test('only-missing filter combines with local search and excludes imported years', () => {
  const filtered = filterSyncYears([2026, 2025, 2024, 1994], '202', true, [2025]);
  assert.deepEqual(filtered, [2026, 2024]);
  assert.equal(isYearChoiceValid(2025, filtered), false);
  assert.deepEqual(filterSyncYears([2026, 2025, 2024], '2025', true, [2025]), []);
});

test('unknown local seasons fail closed instead of implying all catalog years are missing', () => {
  assert.deepEqual(filterSyncYears([2026, 2025], '', true, null), []);
});
