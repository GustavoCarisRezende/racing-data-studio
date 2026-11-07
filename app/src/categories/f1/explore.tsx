import { useEffect, useRef, useState } from 'react';
import type { Locale, Translate } from '../../i18n/messages';
import { sortPositions } from './sort';
import { formatDate } from './dates';
import { filterEvents } from './search';

export type Race = { round: string; raceName: string; date: string; Circuit?: { circuitName?: string } };
export type ResultRow = { round: string; type: string; result: { Driver?: { givenName?: string; familyName?: string; driverId?: string }; Constructor?: { name?: string }; positionText?: string; points?: string; status?: string } };
export type Details = { calendar: Race[]; results: ResultRow[] };

export function Explore({ t, locale, year, details, importedAt }: { t: Translate; locale: Locale; year: number; details: Details; importedAt: string }) {
  const [round, setRound] = useState<string | null>(null);
  const [session, setSession] = useState<'results' | 'sprint'>('results');
  const [focusedRow, setFocusedRow] = useState(0);
  const [dismissed, setDismissed] = useState('');
  const [query, setQuery] = useState('');
  const previewRef = useRef<HTMLElement>(null);
  useEffect(() => { setRound(details.calendar[0]?.round ?? null); setSession('results'); setFocusedRow(0); setQuery(''); }, [year, details]);
  const visibleEvents = filterEvents(details.calendar, query);
  const event = details.calendar.find((item) => item.round === round);
  const eventResults = details.results.filter((item) => item.round === round);
  const hasSprint = eventResults.some((item) => item.type === 'sprint');
  const selectedSession = session === 'sprint' && hasSprint ? 'sprint' : 'results';
  const results = sortPositions(eventResults.filter((item) => item.type === selectedSession));
  const oldEvents = year === new Date().getFullYear() ? details.calendar.filter((item) => {
    const date = Date.parse(`${item.date}T00:00:00Z`);
    return Number.isFinite(date) && date + 48 * 3600_000 < Date.now() && (!details.results.some((r) => r.round === item.round && r.type === 'results') || Date.parse(importedAt) < date);
  }) : [];
  const warningKey = `f1-stale-${year}-${importedAt}-${oldEvents.map((e) => e.round).join('-')}`;
  let storedDismissal = false;
  try { storedDismissal = localStorage.getItem('f1-stale-dismissed') === warningKey; } catch { /* storage unavailable */ }
  function dismiss() {
    setDismissed(warningKey);
    try { localStorage.setItem('f1-stale-dismissed', warningKey); } catch { /* keep dismissal in memory */ }
  }
  function moveRow(event: React.KeyboardEvent<HTMLTableRowElement>, index: number) {
    let next: number;
    if (event.key === 'ArrowDown') next = Math.min(index + 1, results.length - 1);
    else if (event.key === 'ArrowUp') next = Math.max(index - 1, 0);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = results.length - 1;
    else return;
    event.preventDefault();
    setFocusedRow(next);
    event.currentTarget.parentElement?.querySelectorAll('tr')[next]?.focus();
  }
  return <>
    {oldEvents.length > 0 && !storedDismissal && dismissed !== warningKey && <div className="f1-notice" role="status">{t('staleNotice')} <button type="button" onClick={dismiss}>{t('dismiss')}</button></div>}
    <div className="event-layout">
      <section className="event-calendar" aria-label={t('calendar')}>
        <h2><svg className="event-calendar-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 10h18M7 14h2M12 14h2M17 14h1M7 18h2M12 18h2"/></svg>{t('calendar')}</h2>
        <label className="sr-only" htmlFor="f1-event-search">{t('searchEvents')}</label>
        <div className="event-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg><input id="f1-event-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('searchEvents')} autoComplete="off" /></div>
        <div className="event-grid" role="region" aria-label={t('calendar')} tabIndex={0}>
          {visibleEvents.length === 0 ? <p className="event-empty" role="status">{t('noMatchingEvents')}</p> : visibleEvents.map((race) => <button type="button" key={race.round} className="event-card" aria-pressed={round === race.round} onClick={(click) => { setRound(race.round); setSession('results'); setFocusedRow(0); if (click.detail > 0 && window.matchMedia('(max-width: 950px)').matches) previewRef.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }}>
            <span className="event-round">R{race.round}</span><span className="event-card-copy"><strong>{race.raceName}</strong><span>{race.Circuit?.circuitName ?? '—'}</span></span><span className="event-date">{formatDate(race.date, locale)}</span>
          </button>)}
        </div>
      </section>
      <section ref={previewRef} className="event-preview" aria-label={t('results')}>
        <header className="event-detail-header"><span className="event-detail-kicker">{event ? `${t('round')} ${event.round}` : t('results')}</span><h2>{event?.raceName ?? t('results')}</h2>{event && <div className="event-detail-meta"><span><span className="event-meta-label">{t('circuit')}</span> {event.Circuit?.circuitName ?? '—'}</span><span><span className="event-meta-label">{t('date')}</span> {formatDate(event.date, locale)}</span></div>}</header>
        {!event ? <p>{t('selectEvent')}</p> : <>
          {hasSprint && <div className="session-toggle" role="group" aria-label={t('session')}><button type="button" aria-pressed={selectedSession === 'results'} onClick={() => { setSession('results'); setFocusedRow(0); }}>{t('race')}</button><button type="button" aria-pressed={selectedSession === 'sprint'} onClick={() => { setSession('sprint'); setFocusedRow(0); }}>{t('sprint')}</button></div>}
          {results.length === 0 ? <p>{t('noResultsYet')}</p> : <div className="table-wrap" role="region" aria-label={`${t('results')} · ${t('rowKeyboard')}`} tabIndex={0}><table><thead><tr><th>{t('position')}</th><th>{t('driver')}</th><th>{t('constructor')}</th><th>{t('points')}</th><th>{t('status')}</th></tr></thead><tbody>{results.map(({ result }, index) => <tr key={index} tabIndex={index === focusedRow ? 0 : -1} onFocus={() => setFocusedRow(index)} onKeyDown={(event) => moveRow(event, index)}><td>{result.positionText || '—'}</td><td>{[result.Driver?.givenName, result.Driver?.familyName].filter(Boolean).join(' ') || result.Driver?.driverId || '—'}</td><td>{result.Constructor?.name || '—'}</td><td>{result.points ?? '—'}</td><td>{result.status || '—'}</td></tr>)}</tbody></table></div>}
        </>}
      </section>
    </div>
  </>;
}
