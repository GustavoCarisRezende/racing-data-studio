import type { MessageKey } from '../../i18n/messages';

type SnapshotOperation = 'rename' | 'delete';

export function snapshotErrorMessageKey(error: unknown, operation: SnapshotOperation): MessageKey {
  const text = String(error);
  if (text.includes('ACTIVE_SNAPSHOT')) return 'activeCannotDelete';
  if (text.includes('PINNED_BY_ANALYSIS')) return 'pinnedCannotDelete';
  if (text.includes('REFERENCE_CHECK_FAILED')) return 'deleteCheckFailed';
  if (text.includes('SNAPSHOT_DEPENDENTS_CHANGED')) return 'snapshotDependentsChanged';
  if (text.includes('NAME_CONFLICT')) return 'snapshotNameConflict';
  if (text.includes('INVALID_NAME')) return 'snapshotNameInvalid';
  if (text.includes('SNAPSHOT_NOT_FOUND')) return 'snapshotNotFound';
  return operation === 'rename' ? 'snapshotRenameError' : 'snapshotDeleteError';
}
