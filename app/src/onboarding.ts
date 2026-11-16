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
export type TutorialCornerRadii = {
  topLeft: [number, number];
  topRight: [number, number];
  bottomRight: [number, number];
  bottomLeft: [number, number];
};

function radiusPair(value: string, width: number, height: number): [number, number] {
  const parts = value.trim().split(/\s+/);
  const resolve = (part: string | undefined, size: number) => {
    if (!part) return 0;
    const amount = Number.parseFloat(part);
    if (!Number.isFinite(amount)) return 0;
    return part.endsWith('%') ? size * amount / 100 : amount;
  };
  return [resolve(parts[0], width), resolve(parts[1] ?? parts[0], height)];
}

export function tutorialCornerRadii(radii: Pick<CSSStyleDeclaration,
  'borderTopLeftRadius' | 'borderTopRightRadius' | 'borderBottomRightRadius' | 'borderBottomLeftRadius'>,
width: number, height: number, inset = 4): TutorialCornerRadii {
  const expand = (value: string) => {
    const [x, y] = radiusPair(value, width, height);
    return [x ? x + inset : 0, y ? y + inset : 0] as [number, number];
  };
  return {
    topLeft: expand(radii.borderTopLeftRadius),
    topRight: expand(radii.borderTopRightRadius),
    bottomRight: expand(radii.borderBottomRightRadius),
    bottomLeft: expand(radii.borderBottomLeftRadius),
  };
}

export type TutorialShield = {
  top: number; left: number; width: number; height: number;
  borderTopLeftRadius?: string; borderTopRightRadius?: string;
  borderBottomRightRadius?: string; borderBottomLeftRadius?: string;
};

export function tutorialCutoutPath(rect: TutorialRect, radii?: TutorialCornerRadii): string {
  const { left: x, top: y, width: w, height: h } = rect;
  const tl = radii?.topLeft ?? [0, 0], tr = radii?.topRight ?? [0, 0];
  const br = radii?.bottomRight ?? [0, 0], bl = radii?.bottomLeft ?? [0, 0];
  return `M ${x + tl[0]} ${y} H ${x + w - tr[0]} A ${tr[0]} ${tr[1]} 0 0 1 ${x + w} ${y + tr[1]} V ${y + h - br[1]} A ${br[0]} ${br[1]} 0 0 1 ${x + w - br[0]} ${y + h} H ${x + bl[0]} A ${bl[0]} ${bl[1]} 0 0 1 ${x} ${y + h - bl[1]} V ${y + tl[1]} A ${tl[0]} ${tl[1]} 0 0 1 ${x + tl[0]} ${y} Z`;
}

export function tutorialShields(rect: TutorialRect | null, width: number, height: number, radii?: TutorialCornerRadii): TutorialShield[] {
  if (!rect) return [{ top: 0, left: 0, width, height }];
  const x1 = Math.max(0, rect.left), y1 = Math.max(0, rect.top);
  const x2 = Math.min(width, x1 + rect.width), y2 = Math.min(height, y1 + rect.height);
  const topLeft = radii?.topLeft ?? [0, 0], topRight = radii?.topRight ?? [0, 0];
  const bottomRight = radii?.bottomRight ?? [0, 0], bottomLeft = radii?.bottomLeft ?? [0, 0];
  return [
    { top: 0, left: 0, width: x1 + topLeft[0], height: y1 + topLeft[1], borderBottomRightRadius: `${topLeft[0]}px ${topLeft[1]}px` },
    { top: 0, left: x1 + topLeft[0], width: Math.max(0, x2 - x1 - topLeft[0] - topRight[0]), height: y1 },
    { top: 0, left: x2 - topRight[0], width: Math.max(0, width - x2 + topRight[0]), height: y1 + topRight[1], borderBottomLeftRadius: `${topRight[0]}px ${topRight[1]}px` },
    { top: y2 - bottomLeft[1], left: 0, width: x1 + bottomLeft[0], height: Math.max(0, height - y2 + bottomLeft[1]), borderTopRightRadius: `${bottomLeft[0]}px ${bottomLeft[1]}px` },
    { top: y2, left: x1 + bottomLeft[0], width: Math.max(0, x2 - x1 - bottomLeft[0] - bottomRight[0]), height: Math.max(0, height - y2) },
    { top: y2 - bottomRight[1], left: x2 - bottomRight[0], width: Math.max(0, width - x2 + bottomRight[0]), height: Math.max(0, height - y2 + bottomRight[1]), borderTopLeftRadius: `${bottomRight[0]}px ${bottomRight[1]}px` },
    { top: y1 + topLeft[1], left: 0, width: x1, height: Math.max(0, y2 - y1 - topLeft[1] - bottomLeft[1]) },
    { top: y1 + topRight[1], left: x2, width: Math.max(0, width - x2), height: Math.max(0, y2 - y1 - topRight[1] - bottomRight[1]) },
  ];
}

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
