import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Locale } from './i18n/messages';
import { readZoom, ZOOM_MAX, ZOOM_MIN, ZOOM_STORAGE_KEY, ZoomController, zoomShortcut, type ZoomAction } from './zoom';

function storage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
function settleLayout(): Promise<void> {
  return new Promise(resolve => {
    let first = 0, second = 0;
    const finish = () => { window.clearTimeout(timeout); cancelAnimationFrame(first); cancelAnimationFrame(second); resolve(); };
    // A hidden/minimized window may not deliver animation frames.
    const timeout = window.setTimeout(finish, 250);
    first = requestAnimationFrame(() => { second = requestAnimationFrame(finish); });
  });
}
function measureWorkspace() {
  const root = document.documentElement;
  const target = document.querySelector('.f1-sandbox .rds-sb-visualization')
    ?? document.querySelector('.event-layout')
    ?? document.querySelector('.content');
  const rect = target?.getBoundingClientRect();
  return {
    width: root.clientWidth, height: root.clientHeight,
    right: rect ? rect.right + window.scrollX : root.clientWidth - 12,
    bottom: rect ? rect.bottom + window.scrollY : root.clientHeight - 12,
  };
}

export function ZoomControls({ locale, onZoomChange }: { locale: Locale; onZoomChange?: (factor: number) => void }) {
  const [factor, setFactor] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'apply' | 'storage' | null>(null);
  const controller = useRef<ZoomController | null>(null);
  const desktop = isTauri();
  const pt = locale === 'pt-BR';
  useEffect(() => {
    if (!desktop) return;
    const instance = new ZoomController({
      apply: value => invoke<number>('set_application_zoom', { factor: value }),
      persist: value => {
        const store = storage();
        if (!store) throw new Error('Storage unavailable');
        store.setItem(ZOOM_STORAGE_KEY, String(value));
      },
      measure: measureWorkspace,
      settle: settleLayout,
      onChange: value => { setFactor(value); onZoomChange?.(value); },
      onBusy: setBusy,
      onError: setError,
    });
    controller.current = instance;
    const saved = readZoom(storage());
    if (saved !== 1) void instance.restore(saved);
    const onKeyDown = (event: KeyboardEvent) => {
      const action = zoomShortcut(event);
      if (!action) return;
      event.preventDefault();
      setError(null);
      void instance.request(action);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); instance.dispose(); controller.current = null; };
  }, [desktop, onZoomChange]);
  const request = (action: ZoomAction) => {
    setError(null);
    if (action === 'fit') window.scrollTo(0, 0);
    void controller.current?.request(action);
  };
  return <section className="zoom-controls" aria-label={pt ? 'Zoom da interface' : 'Interface zoom'} title={!desktop ? (pt ? 'Disponível no aplicativo desktop.' : 'Available in the desktop application.') : undefined}>
    <div className="zoom-controls-row">
      <span>Zoom</span>
      <button type="button" disabled={!desktop || busy || factor <= ZOOM_MIN} aria-label={pt ? 'Diminuir zoom (Ctrl − ou ⌘ −)' : 'Zoom out (Ctrl − or ⌘ −)'} onClick={() => request('out')}>−</button>
      <output aria-live="polite">{Math.round(factor * 100)}%</output>
      <button type="button" disabled={!desktop || busy || factor >= ZOOM_MAX} aria-label={pt ? 'Aumentar zoom (Ctrl + ou ⌘ +)' : 'Zoom in (Ctrl + or ⌘ +)'} onClick={() => request('in')}>+</button>
      <button type="button" disabled={!desktop || busy} onClick={() => request('reset')} title="Ctrl 0 / ⌘ 0">{pt ? 'Redefinir' : 'Reset'}</button>
    </div>
    <button type="button" className="zoom-fit" disabled={!desktop || busy} onClick={() => request('fit')}>{pt ? 'Ajustar à janela' : 'Fit to window'}</button>
    {error && <p role="alert">{error === 'storage'
      ? (pt ? 'Zoom aplicado, mas não foi possível salvar a preferência.' : 'Zoom applied, but the preference could not be saved.')
      : (pt ? 'Não foi possível alterar o zoom. Tente novamente.' : 'Could not change the zoom. Please try again.')}</p>}
  </section>;
}
