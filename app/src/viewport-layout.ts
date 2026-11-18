/** Page zoom changes CSS viewport dimensions, but not the window's usable size.
 * Preserve the compact header when zooming out; width still protects controls
 * from collisions when the effective viewport becomes narrow. */
export function compactCategoryViewport(width: number, height: number, zoom: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && Number.isFinite(zoom)
    && width >= 900 && height > 0 && zoom >= 0.7 && zoom <= 2
    && height * zoom <= 850 + (zoom === 1 ? 0 : zoom);
}
