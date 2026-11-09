import type { CategoryModule } from '../types';
import type { Locale, Translate } from '../../i18n/messages';
import car from '../../assets/formula-car.svg';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Explore, type Details } from './explore';
import { formatTimestamp } from './dates';
import { nextTabIndex } from './tabs';

type LocalSeason = { year: number; importedAt: string | null; dataAt: string | null };
type Progress = { year: number; phase: string; offset: number };
type Snapshot = { id: number; importedAt: string; dataAt: string };
type View = 'sandbox' | 'explore' | 'sync' | 'snapshots' | 'source';
const views: View[] = ['sandbox', 'explore', 'sync', 'snapshots', 'source'];
const AnalysisScreen = lazy(() => import('./analysis-screen'));

function F1Screen({ t, locale }: { t: Translate; locale: Locale }) {
  const desktop = isTauri();
  const current = new Date().getFullYear();
  const fallback = Array.from({ length: Math.max(0, Math.min(current, 2100) - 1949) }, (_, i) => 1950 + i);
  const [year, setYear] = useState(current);
  const [years, setYears] = useState<number[]>(fallback);
  const [local, setLocal] = useState<LocalSeason[]>([]);
  const [catalogState, setCatalogState] = useState<'loading' | 'remote' | 'fallback'>('loading');
  const [progress, setProgress] = useState<Progress | null>(null);
  const wasRunning = useRef(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [errorKind, setErrorKind] = useState<'sync' | 'restore' | 'copy'>('sync');
  const [copied, setCopied] = useState<number | null>(null);
  const [localError, setLocalError] = useState('');
  const [details, setDetails] = useState<Details | null>(null);
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<View | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const initialView = useRef(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = local.find((item) => item.year === year);
  const imported = Boolean(selected?.importedAt);
  const active = working || progress !== null;
  const options = Array.from(new Set([...years, ...local.map((item) => item.year), year])).filter((y) => y >= 1950 && y <= 2100).sort((a, b) => b - a);

  useEffect(() => {
    if (!desktop) { setCatalogState('fallback'); return; }
    if (view !== 'sync') return;
    let alive = true;
    invoke<number[]>('f1_remote_seasons').then((data) => { if (alive) { setYears(data); setCatalogState('remote'); } }).catch(() => { if (alive) setCatalogState('fallback'); });
    return () => { alive = false; };
  }, [desktop, view]);
  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    const load = () => invoke<LocalSeason[]>('f1_local_seasons').then((data) => { if (alive) { setLocal(data); setLocalError(''); if (!initialView.current) { initialView.current = true; const first = data.find((item) => item.importedAt); if (first) setYear(first.year); setView(first ? 'explore' : 'sync'); } } }).catch((e: unknown) => { if (alive) setLocalError(String(e)); });
    void load();
    return () => { alive = false; };
  }, [desktop, revision]);
  useEffect(() => {
    if (!desktop || view !== 'snapshots') return;
    let alive = true;
    invoke<Snapshot[]>('f1_snapshots', { year }).then((items) => { if (alive) setSnapshots(items); }).catch((e: unknown) => { if (alive) setLocalError(String(e)); });
    return () => { alive = false; };
  }, [desktop, view, year, revision]);
  useEffect(() => {
    setDetails(null);
    if (!desktop || !imported) return;
    let alive = true;
    invoke<Details>('f1_season_details', { year }).then((data) => { if (alive) setDetails(data); }).catch((e: unknown) => { if (alive) setLocalError(String(e)); });
    return () => { alive = false; };
  }, [desktop, year, imported, revision]);
  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    const poll = () => { void invoke<Progress | null>('f1_sync_status').then((value) => { if (alive) { if (wasRunning.current && !value) setRevision((n) => n + 1); wasRunning.current = value !== null; setProgress(value); } }).catch((e: unknown) => { if (alive) setLocalError(String(e)); }); };
    poll();
    const timer = window.setInterval(poll, 1000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [desktop]);

  async function sync() {
    setWorking(true); setError(''); setErrorKind('sync');
    try { await invoke('f1_sync', { year }); setView('explore'); }
    catch (e: unknown) { setError(String(e)); }
    finally { setWorking(false); setProgress(null); setRevision((n) => n + 1); }
  }
  async function restore(id: number) {
    if (!window.confirm(t('restoreConfirm'))) return;
    setWorking(true); setError(''); setErrorKind('restore');
    try { await invoke('f1_restore_snapshot', { year, id }); setDetails(null); }
    catch (e: unknown) { setError(String(e)); }
    finally { setWorking(false); setProgress(null); setRevision((n) => n + 1); }
  }
  async function copyEvents(id: number) {
    setWorking(true); setError(''); setCopied(null); setErrorKind('copy');
    try { setCopied(await invoke<number>('f1_copy_snapshot_events', { year, id })); }
    catch (e: unknown) { setError(String(e)); }
    finally { setWorking(false); setProgress(null); }
  }
  function selectTab(item: View) {
    initialView.current = true;
    setView(item); setError(''); setCopied(null);
  }
  function navigateTabs(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const target = nextTabIndex(event.key, index, views.length);
    if (target === null) return;
    event.preventDefault();
    selectTab(views[target]);
    tabRefs.current[target]?.focus();
  }
  const phase = progress?.phase === 'races' ? t('phaseRaces') : progress?.phase === 'results' ? t('phaseResults') : progress?.phase === 'sprint' ? t('phaseSprint') : progress?.phase === 'saving' ? t('phaseSaving') : t('phaseStarting');
  return <section className="f1-screen">
    <h1>{view === 'sandbox' ? `${t('f1Heading')} · ${t('sandbox')}` : t('f1Heading')}</h1>
    {view === 'sandbox' && <p className="f1-analysis-description">{t('sandboxIntro')}</p>}
    {!desktop && <p role="status">{t('desktopOnly')}</p>}
    {desktop && <>
      <div className="f1-tab-scroll"><div className="f1-nav" role="tablist" aria-label={t('f1Tabs')}>
        {views.map((item, index) => <button key={item} ref={(node) => { tabRefs.current[index] = node; }} id={`f1-tab-${item}`} type="button" role="tab" aria-selected={view === item} aria-controls="f1-tabpanel" tabIndex={view === item || (view === null && index === 0) ? 0 : -1} onKeyDown={(event) => navigateTabs(event, index)} onClick={() => selectTab(item)}>{t(item === 'sandbox' ? 'sandbox' : item === 'explore' ? 'explore' : item === 'sync' ? 'manageSync' : item === 'snapshots' ? 'manageSnapshots' : 'dataSource')}</button>)}
      </div></div>
      {view && <div id="f1-tabpanel" role="tabpanel" tabIndex={0} aria-labelledby={`f1-tab-${view}`}>
      {view === 'sandbox' && <section className="f1-sandbox"><Suspense fallback={<p role="status">{t('loading')}</p>}><AnalysisScreen locale={locale} /></Suspense></section>}
      {view === 'source' && <section><h2>{t('dataSource')}</h2><p>{t('sourceNotice')}</p><p><a href="https://github.com/jolpica/jolpica-f1/blob/main/TERMS.md" target="_blank" rel="noreferrer">{t('sourceTerms')}</a> · <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noreferrer">CC BY-NC-SA 4.0</a></p></section>}
      {view === 'sync' && <><p>{t('futureNotice')}</p>
      {catalogState === 'loading' && <p role="status">{t('catalog')}</p>}
      {catalogState === 'fallback' && <p role="status">{t('fallbackNotice')}</p>}</>}
      {view !== 'source' && view !== 'sandbox' && <>
      <div className="season-controls">
        <label htmlFor="season-year">{t('season')}</label>
        <select id="season-year" value={year} disabled={active} onChange={(event) => { setDetails(null); setSnapshots([]); setCopied(null); setYear(Number(event.target.value)); }}>
          {(view === 'sync' ? options : [...new Set([...local.filter((entry) => entry.importedAt).map((entry) => entry.year), year])].sort((a, b) => b - a)).map((item) => <option key={item} value={item}>{item}{local.some((entry) => entry.year === item && entry.importedAt) ? ` · ${t('imported')}` : ''}</option>)}
        </select>
        {view === 'sync' && <button type="button" onClick={() => void sync()} disabled={active}>{imported ? t('updateSeason') : t('importSeason')}</button>}
      </div>
      <p aria-live="polite">{progress ? `${local.some((entry) => entry.year === progress.year && entry.importedAt) ? t('updating') : t('importing')} ${progress.year}: ${phase} · ${progress.offset} ${t('offset')}` : working ? t('loading') : imported ? `${t('imported')} · ${t('lastImport')}: ${formatTimestamp(selected?.importedAt, locale)}` : t('notImported')}</p>
      {error && <div className="sync-error" role="alert"><strong>{t(errorKind === 'sync' ? 'syncError' : errorKind === 'restore' ? 'restoreError' : 'copyError')}</strong><details><summary>{t('retryDetails')}</summary><pre>{error}</pre></details></div>}
      {view === 'explore' && <>{!imported && <p>{t('noLocal')}</p>}{imported && !details && !localError && <p>{t('loading')}</p>}{details && imported && selected?.dataAt && <Explore t={t} locale={locale} year={year} details={details} importedAt={selected.dataAt} />}</>}
      {view === 'snapshots' && <><details className="snapshot-help"><summary>{t('snapshotHelpTitle')}</summary><p>{t('snapshotHelpDatabase')}</p><p>{t('snapshotHelpEvents')}</p><p>{t('snapshotHelpSafety')}</p></details>{copied !== null && <p role="status">{t('copySuccess')} {copied}</p>}{snapshots.length === 0 ? <p>{t('noSnapshots')}</p> : <ul className="snapshot-list">{snapshots.map((snapshot, index) => <li key={snapshot.id}><span>#{snapshot.id} · {formatTimestamp(snapshot.importedAt, locale)} UTC{snapshot.dataAt !== snapshot.importedAt ? ` · ${t('sourceDataAt')}: ${formatTimestamp(snapshot.dataAt, locale)}` : ''}{index === 0 ? ` · ${t('activeSnapshot')}` : ''}</span><span><button type="button" disabled={active} onClick={() => void copyEvents(snapshot.id)}>{t('copyEvents')}</button>{' '}<button type="button" disabled={active || index === 0} onClick={() => void restore(snapshot.id)}>{t('restore')}</button></span></li>)}</ul>}</>}
      </>}
      {localError && <div className="sync-error" role="alert">{t('loadError')} <details><summary>{t('retryDetails')}</summary><pre>{localError}</pre></details></div>}
      </div>}
      {!view && localError && <div className="sync-error" role="alert">{t('loadError')} <details><summary>{t('retryDetails')}</summary><pre>{localError}</pre></details></div>}
    </>}
  </section>;
}

function F1Icon() {
  return <img className="car-icon" src={car} alt="" aria-hidden="true" />;
}

export const f1: CategoryModule = {
  id: 'f1', name: 'f1Heading', description: 'f1Description', openLabel: 'open', Icon: F1Icon, Screen: F1Screen,
};
