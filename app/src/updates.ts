export type UpdateStatus = {
  enabled: boolean;
  phase: 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'current' | 'error';
  currentVersion: string;
  version: string | null;
  notes: string | null;
  downloaded: number;
  total: number | null;
  error: string | null;
};

export const AUTO_DOWNLOAD_KEY = 'rds.updates.autoDownload';
export function isUpdateStatus(value: unknown): value is UpdateStatus {
  if (value === null || typeof value !== 'object') return false;
  const s = value as Partial<UpdateStatus>;
  return typeof s.enabled === 'boolean' && typeof s.currentVersion === 'string'
    && typeof s.phase === 'string' && ['disabled', 'idle', 'checking', 'available', 'downloading', 'ready', 'installing', 'current', 'error'].includes(s.phase)
    && typeof s.downloaded === 'number' && Number.isFinite(s.downloaded) && s.downloaded >= 0
    && (s.total === null || (typeof s.total === 'number' && Number.isFinite(s.total) && s.total >= 0))
    && (s.version === null || typeof s.version === 'string')
    && (s.notes === null || typeof s.notes === 'string') && (s.error === null || typeof s.error === 'string');
}
export const updateBusy = (status: UpdateStatus | null) =>
  status !== null && ['checking', 'downloading', 'installing'].includes(status.phase);
export const canInstallUpdate = (status: UpdateStatus | null, dirty: boolean, blocked: boolean) =>
  status?.enabled === true && status.phase === 'ready' && !dirty && !blocked;
export function updateProgress(status: UpdateStatus): number | null {
  if (!status.total || status.total <= 0) return null;
  return Math.min(100, Math.max(0, Math.floor(status.downloaded / status.total * 100)));
}
export function readAutoDownload(storage: Pick<Storage, 'getItem'> | null): boolean {
  try { return storage?.getItem(AUTO_DOWNLOAD_KEY) === 'true'; } catch { return false; }
}
