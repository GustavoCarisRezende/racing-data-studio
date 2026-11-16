export const TUTORIAL_STORAGE_KEY = 'racing-data-studio.tutorial.v1';
export const TUTORIAL_VERSION = 1;
export function tutorialStorage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

export type TutorialStep =
  | 'welcome' | 'category' | 'sync-intro' | 'sync-tab' | 'sync-content' | 'sync-year' | 'sync-run'
  | 'snapshot-content' | 'snapshots-tab' | 'snapshots-content'
  | 'source-tab' | 'source-content' | 'explore-tab' | 'explore-content' | 'sandbox-tab'
  | 'models' | 'filters' | 'seasons' | 'chart-types' | 'mode-switch'
  | 'fields' | 'behavior' | 'visualization-title' | 'save' | 'export' | 'finish';
export type TutorialState = { step: TutorialStep | null; status: 'idle' | 'active' | 'completed' | 'skipped' };
export type TutorialAction =
  | { type: 'start' }
  | { type: 'advance'; step?: TutorialStep }
  | { type: 'back'; step: TutorialStep }
  | { type: 'complete' }
  | { type: 'skip' }
  | { type: 'dismiss' };

export const initialTutorialState: TutorialState = { step: null, status: 'idle' };
export function tutorialReducer(state: TutorialState, action: TutorialAction): TutorialState {
  switch (action.type) {
    case 'start': return { step: 'welcome', status: 'active' };
    case 'advance': return action.step ? { step: action.step, status: 'active' } : { step: 'finish', status: 'active' };
    case 'back': return { step: action.step, status: 'active' };
    case 'complete': return { step: null, status: 'completed' };
    case 'skip': return { step: null, status: 'skipped' };
    case 'dismiss': return initialTutorialState;
  }
}
export function afterSyncExplanation(hasLocalSnapshots: boolean): TutorialStep {
  return hasLocalSnapshots ? 'snapshot-content' : 'sync-year';
}
export function afterYearSelection(selectedYear: number, suggestedYear: number, suggestionAvailable: boolean): TutorialStep | null {
  return selectedYear === suggestedYear || !suggestionAvailable ? 'sync-run' : null;
}
export function afterSyncResult(success: boolean): TutorialStep | null {
  return success ? 'snapshot-content' : null;
}

export function readTutorialStatus(storage: Pick<Storage, 'getItem'> | null | undefined): 'eligible' | 'completed' | 'skipped' {
  try {
    const value = storage?.getItem(TUTORIAL_STORAGE_KEY);
    if (!value) return 'eligible';
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && (parsed as { version?: unknown }).version === TUTORIAL_VERSION) {
      const status = (parsed as { status?: unknown }).status;
      if (status === 'completed' || status === 'skipped') return status;
    }
  } catch { /* storage can be unavailable; keep the tour usable for this session */ }
  return 'eligible';
}
export function writeTutorialStatus(storage: Pick<Storage, 'setItem'> | null | undefined, status: 'completed' | 'skipped'): void {
  try { storage?.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify({ version: TUTORIAL_VERSION, status })); }
  catch { /* completion remains in memory for this session */ }
}

export type TutorialRect = { top: number; left: number; width: number; height: number };
export type TutorialBridge = {
  step: string | null;
  onStep: (step: string) => void;
  onTarget: (target: string, element: HTMLElement | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onLocalSnapshotsChange?: (hasSnapshots: boolean) => void;
  hasLocalSnapshots?: boolean;
};
export function tutorialRect(rect: Pick<DOMRect, 'top' | 'left' | 'width' | 'height'>, viewportWidth: number, viewportHeight: number): TutorialRect {
  const left = Math.max(8, Math.min(rect.left, viewportWidth - 8));
  const top = Math.max(8, Math.min(rect.top, viewportHeight - 8));
  return { left, top, width: Math.max(0, Math.min(rect.width, viewportWidth - left - 8)), height: Math.max(0, Math.min(rect.height, viewportHeight - top - 8)) };
}
