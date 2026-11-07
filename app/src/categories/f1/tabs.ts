/** Roving tab navigation; unrelated keys keep their normal browser behavior. */
export function nextTabIndex(key: string, index: number, count: number): number | null {
  if (count <= 0 || index < 0 || index >= count) return null;
  if (key === 'ArrowRight') return (index + 1) % count;
  if (key === 'ArrowLeft') return (index + count - 1) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}
