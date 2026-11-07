import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTabIndex } from '../src/categories/f1/tabs.ts';

test('horizontal tabs support arrow wrap, Home and End', () => {
  assert.equal(nextTabIndex('ArrowRight', 4, 5), 0);
  assert.equal(nextTabIndex('ArrowLeft', 0, 5), 4);
  assert.equal(nextTabIndex('Home', 3, 5), 0);
  assert.equal(nextTabIndex('End', 1, 5), 4);
  assert.equal(nextTabIndex('Tab', 1, 5), null);
  assert.equal(nextTabIndex('ArrowLeft', 0, 0), null);
});
