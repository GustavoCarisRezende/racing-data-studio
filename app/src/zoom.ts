export const ZOOM_STORAGE_KEY = 'racing-data-studio.zoom.v1';
export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 2;
export const FIT_LEVELS = [1, 0.95, 0.9, 0.85] as const;
const LEVELS = [0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
export type ZoomAction = 'in' | 'out' | 'reset' | 'fit';
export type ZoomStorage = Pick<Storage, 'getItem' | 'setItem'>;
export type ZoomMeasurement = { width: number; height: number; right: number; bottom: number };

export function validZoom(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= ZOOM_MIN && value <= ZOOM_MAX;
}
export function readZoom(storage: ZoomStorage | null): number {
  try {
    const raw = storage?.getItem(ZOOM_STORAGE_KEY);
    const value = raw ? Number(raw) : 1;
    return validZoom(value) ? Math.round(value * 100) / 100 : 1;
  } catch { return 1; }
}
export function zoomShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing' | 'defaultPrevented'>): ZoomAction | null {
  if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return null;
  if (event.key === '+' || event.key === '=') return 'in';
  if (event.key === '-') return 'out';
  if (event.key === '0') return 'reset';
  return null;
}
export function nextZoom(current: number, action: Exclude<ZoomAction, 'fit'>): number {
  if (action === 'reset') return 1;
  return action === 'in'
    ? LEVELS.find(level => level > current + 0.001) ?? ZOOM_MAX
    : [...LEVELS].reverse().find(level => level < current - 0.001) ?? ZOOM_MIN;
}
export function fitScore({ width, height, right, bottom }: ZoomMeasurement): number {
  if (![width, height, right, bottom].every(Number.isFinite) || width <= 0 || height <= 0 || right <= 0 || bottom <= 0) return 0;
  return Math.min(1, width / (right + 12), height / (bottom + 12));
}

type ZoomOptions = {
  apply: (factor: number) => Promise<number>;
  persist: (factor: number) => void;
  measure: () => ZoomMeasurement;
  settle: () => Promise<void>;
  onChange: (factor: number) => void;
  onBusy: (busy: boolean) => void;
  onError: (error: 'apply' | 'storage') => void;
};

/** Serialize native calls, including restoration, so fast shortcuts cannot race.
 * Fit probes a finite set of readable scales after real layout, accounting for
 * responsive breakpoints instead of repeatedly shrinking document.scrollHeight. */
export class ZoomController {
  current = 1;
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private disposed = false;
  private readonly options: ZoomOptions;
  constructor(options: ZoomOptions) { this.options = options; }
  dispose() { this.disposed = true; }
  private async apply(factor: number) {
    if (!validZoom(factor)) throw new Error('Invalid zoom');
    const actual = await this.options.apply(factor);
    if (!validZoom(actual)) throw new Error('Invalid native zoom response');
    this.current = Math.round(actual * 100) / 100;
    if (!this.disposed) this.options.onChange(this.current);
  }
  private save() {
    if (this.disposed) return;
    try { this.options.persist(this.current); } catch { this.options.onError('storage'); }
  }
  private enqueue(operation: () => Promise<void>): Promise<boolean> {
    if (this.disposed || this.pending >= 16) return Promise.resolve(false);
    this.pending++;
    this.options.onBusy(true);
    const job = this.queue.then(async () => {
      try {
        if (this.disposed) return false;
        await operation();
        return true;
      }
      catch { if (!this.disposed) this.options.onError('apply'); return false; }
      finally {
        this.pending--;
        if (!this.disposed && this.pending === 0) this.options.onBusy(false);
      }
    });
    this.queue = job;
    return job;
  }
  restore(factor: number) {
    return this.enqueue(async () => { if (validZoom(factor)) await this.apply(factor); });
  }
  request(action: ZoomAction) {
    return this.enqueue(async () => {
      if (action !== 'fit') {
        await this.apply(nextZoom(this.current, action));
        this.save();
        return;
      }
      const original = this.current;
      let best: number = 1, bestScore = -1;
      try {
        for (const factor of FIT_LEVELS) {
          if (this.disposed) return;
          if (this.current !== factor) await this.apply(factor);
          await this.options.settle();
          if (this.disposed) return;
          const score = fitScore(this.options.measure());
          if (score > bestScore) { best = factor; bestScore = score; }
          if (score >= 1) break;
        }
        if (this.current !== best) await this.apply(best);
        this.save();
      } catch (error) {
        // Do not leave a half-finished fit probe as the preferred scale.
        try { if (!this.disposed) await this.apply(original); } catch { this.save(); }
        throw error;
      }
    });
  }
}
