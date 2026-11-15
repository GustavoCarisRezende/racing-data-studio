import type { FormEvent } from 'react';
import type { MessageKey, Translate } from '../../i18n/messages';

type Snapshot = { id: number; name?: string | null; displayName?: string | null; isActive: boolean; canDelete?: boolean; deleteReason?: string | null };
type SnapshotError = { snapshotId: number; operation: 'rename' | 'delete'; message: MessageKey } | null;

type Props = {
  snapshot: Snapshot;
  active: boolean;
  renaming: boolean;
  snapshotName: string;
  snapshotError: SnapshotError;
  t: Translate;
  deleteReasonText: (reason?: string | null) => string;
  onRename: () => void;
  onNameChange: (value: string) => void;
  onCancelRename: () => void;
  onSaveRename: (event: FormEvent<HTMLFormElement>) => void;
  onCopyEvents: () => void;
  onRestore: () => void;
  onActivate: () => void;
  onDelete: () => void;
};

export function SnapshotActions({ snapshot, active, renaming, snapshotName, snapshotError, t, deleteReasonText, onRename, onNameChange, onCancelRename, onSaveRename, onCopyEvents, onRestore, onActivate, onDelete }: Props) {
  const renameError = snapshotError?.snapshotId === snapshot.id && snapshotError.operation === 'rename';
  const displayName = snapshot.displayName || snapshot.name || `#${snapshot.id}`;
  return <span className="snapshot-actions">
    {!snapshot.isActive && <button type="button" disabled={active} onClick={onActivate}>{t('activateSnapshot')}</button>}
    {renaming ? <form onSubmit={onSaveRename}>
      <label className="sr-only" htmlFor={`snapshot-name-${snapshot.id}`}>{t('snapshotName')}</label>
      <input id={`snapshot-name-${snapshot.id}`} value={snapshotName} maxLength={80} aria-invalid={renameError} aria-describedby={renameError ? `snapshot-rename-error-${snapshot.id}` : undefined} onChange={(event) => onNameChange(event.target.value)} autoFocus />
      <button type="submit" disabled={active || !snapshotName.trim()}>{t('save')}</button>
      <button type="button" onClick={onCancelRename}>{t('cancel')}</button>
      {renameError && <p className="snapshot-inline-error" id={`snapshot-rename-error-${snapshot.id}`} role="alert">{t(snapshotError?.message ?? 'snapshotRenameError')}</p>}
    </form> : <button type="button" disabled={active} onClick={onRename}>{t('renameSnapshot')}</button>}
    <button type="button" disabled={active} onClick={onCopyEvents}>{t('copyEvents')}</button>
    <button type="button" disabled={active || snapshot.isActive} onClick={onRestore}>{t('restore')}</button>
    <button className="snapshot-delete-icon" type="button" aria-label={`${t('deleteSnapshot')}: ${displayName}`} title={snapshot.isActive ? t('activeCannotDelete') : deleteReasonText(snapshot.deleteReason)} disabled={active || snapshot.isActive || snapshot.canDelete === false} onClick={onDelete}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m3 4v5m4-5v5" /></svg>
    </button>
  </span>;
}
