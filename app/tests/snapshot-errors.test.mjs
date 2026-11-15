import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotErrorMessageKey } from '../src/categories/f1/snapshot-errors.ts';

test('snapshot rename and delete failures map to useful localized message keys', () => {
  const cases = [
    ['ACTIVE_SNAPSHOT', 'activeCannotDelete'],
    ['PINNED_BY_ANALYSIS', 'pinnedCannotDelete'],
    ['REFERENCE_CHECK_FAILED', 'deleteCheckFailed'],
    ['NAME_CONFLICT', 'snapshotNameConflict'],
    ['INVALID_NAME', 'snapshotNameInvalid'],
    ['SNAPSHOT_NOT_FOUND', 'snapshotNotFound'],
  ];
  for (const [code, messageKey] of cases) {
    assert.equal(snapshotErrorMessageKey(code, 'delete'), messageKey);
    assert.equal(snapshotErrorMessageKey(code, 'rename'), messageKey);
  }
  assert.equal(snapshotErrorMessageKey(new Error('internal detail'), 'rename'), 'snapshotRenameError');
  assert.equal(snapshotErrorMessageKey(new Error('internal detail'), 'delete'), 'snapshotDeleteError');
});
