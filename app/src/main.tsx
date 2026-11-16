import { StrictMode, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { categories } from './categories/registry';
import { messages, type Locale } from './i18n/messages';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { isFullscreenShortcut, openProject, GITHUB_URL, runFullscreenToggle } from './desktop-bridge';
import logo from './assets/rds-logo.svg';
import background from './assets/header-background.svg';
import categoryMark from './assets/category-mark.svg';
import { initialTutorialState, readTutorialStatus, tutorialReducer, tutorialStorage, writeTutorialStatus, type TutorialStep } from './onboarding';
import { nextTutorialStep, OnboardingTour } from './onboarding-tour';
import { RestartConfirmation } from './restart-confirmation';
import './style.css';

function App() {
  const [locale, setLocale] = useState<Locale>(() => navigator.language.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en-US');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [shellError, setShellError] = useState('');
  const [tutorial, dispatchTutorial] = useReducer(tutorialReducer, initialTutorialState);
  const [dirty, setDirty] = useState(false);
  const [hasLocalSnapshots, setHasLocalSnapshots] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const fullscreenBusy = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const tutorialElements = useRef(new Map<string, HTMLElement>());
  const t = (key: keyof typeof messages['en-US']) => messages[locale][key];
  const active = categories.find((category) => category.id === activeId);
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const filteredCategories = categories.filter((category) => normalize(t(category.name)).includes(normalize(query)));
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => {
    if (readTutorialStatus(tutorialStorage()) === 'eligible') dispatchTutorial({ type: 'start' });
  }, []);
  useEffect(() => {
    if (tutorial.status === 'completed' || tutorial.status === 'skipped') writeTutorialStatus(tutorialStorage(), tutorial.status);
  }, [tutorial.status]);
  const tutorialTarget = useCallback((target: string) => {
    const registered = tutorialElements.current.get(target);
    return registered?.isConnected ? registered : document.querySelector<HTMLElement>(`[data-tutorial-target="${target}"]`);
  }, []);
  const registerTutorialTarget = useCallback((target: string, element: HTMLElement | null) => {
    if (element) tutorialElements.current.set(target, element);
    else tutorialElements.current.delete(target);
  }, []);
  const setTutorialStep = useCallback((step: string) => dispatchTutorial({ type: 'advance', step: step as TutorialStep }), []);
  const restartTour = () => { setActiveId(null); setQuery(''); setDirty(false); setHasLocalSnapshots(false); dispatchTutorial({ type: 'start' }); };
  const beginRestart = () => {
    if (dirty) setConfirmRestart(true);
    else restartTour();
  };
  const confirmRestartTour = () => { setConfirmRestart(false); restartTour(); };
  const continueWithoutTarget = (step: TutorialStep) => {
    if (step === 'category') { setActiveId('f1'); dispatchTutorial({ type: 'advance', step: 'sync-intro' }); return; }
    const next: Partial<Record<TutorialStep, TutorialStep>> = {
      'sync-tab': 'sync-content', 'sync-year': 'snapshot-content', 'sync-run': 'snapshot-content',
      'snapshots-tab': 'snapshots-content', 'source-tab': 'source-content',
      'explore-tab': 'explore-content', 'sandbox-tab': 'models',
    };
    dispatchTutorial({ type: 'advance', step: next[step] ?? nextTutorialStep(step) ?? 'finish' });
  };
  const backTutorial = (step: TutorialStep) => {
    if (step === 'category') {
      setActiveId(null); dispatchTutorial({ type: 'back', step }); return;
    }
    const target = ({
      'sync-tab': 'f1-sync-tab', 'sync-content': 'f1-sync-tab', 'sync-year': 'f1-sync-tab', 'sync-run': 'f1-sync-tab',
      'snapshot-content': 'f1-sync-tab', 'snapshots-tab': 'f1-snapshots-tab', 'snapshots-content': 'f1-snapshots-tab',
      'source-tab': 'f1-source-tab', 'source-content': 'f1-source-tab',
      'explore-tab': 'f1-explore-tab', 'explore-content': 'f1-explore-tab',
      'sandbox-tab': 'f1-sandbox-tab', models: 'f1-sandbox-tab', filters: 'f1-sandbox-tab',
      seasons: 'f1-sandbox-tab', 'chart-types': 'f1-sandbox-tab', 'mode-switch': 'f1-sandbox-tab',
      fields: 'f1-sandbox-tab', behavior: 'f1-sandbox-tab', 'visualization-title': 'f1-sandbox-tab', save: 'f1-sandbox-tab', export: 'f1-sandbox-tab',
    } as Partial<Record<TutorialStep, string>>)[step];
    if (target) tutorialTarget(target)?.click();
    dispatchTutorial({ type: 'back', step });
  };
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isFullscreenShortcut(event) && isTauri()) {
        event.preventDefault();
        void runFullscreenToggle(fullscreenBusy, () => invoke('toggle_fullscreen'), () => setShellError(t('fullscreenError')));
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && searchRef.current && !dialogRef.current?.open) {
        event.preventDefault();
        searchRef.current.focus();
      } else if (event.key === 'Escape' && document.activeElement === searchRef.current) {
        searchRef.current?.blur();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [locale]);

  return <div className="app-shell">
    <header className="masthead">
      <div className="brand">
        <img className="brand-image" src={logo} alt={t('title')} />
        <span className="brand-separator" aria-hidden="true" />
        <strong className="brand-text" aria-hidden="true">{t('title')}</strong>
      </div>
      <div className="header-actions">
      <div className="locale-control">
        <label htmlFor="locale">{t('language')}</label>
        <div className="select-wrap">
          <select id="locale" aria-label={t('language')} value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
            <option value="pt-BR">Português (Brasil)</option><option value="en-US">English (US)</option>
          </select>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7 5 5 5-5" /></svg>
        </div>
      </div>
      <details className="tutorial-menu" onKeyDown={(event) => { if (event.key === 'Escape') event.currentTarget.open = false; }}>
        <summary aria-label={locale === 'pt-BR' ? 'Abrir menu' : 'Open menu'} title={locale === 'pt-BR' ? 'Menu' : 'Menu'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg></summary>
        <div className="tutorial-menu-options"><button type="button" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); beginRestart(); }}>{locale === 'pt-BR' ? 'Como usar o sistema' : 'How to use the system'}</button></div>
      </details>
      </div>
    </header>
    <main className="main">
      <img className="background-art" src={background} alt="" aria-hidden="true" />
      <div className="content">{active ? <div className="module-screen"><button className="back" type="button" onClick={() => { setActiveId(null); setDirty(false); setHasLocalSnapshots(false); }}>{t('back')}</button><active.Screen t={t} locale={locale} tutorial={{ step: tutorial.step, onStep: setTutorialStep, onTarget: registerTutorialTarget, onDirtyChange: setDirty, onLocalSnapshotsChange: setHasLocalSnapshots, hasLocalSnapshots }} /></div> : <>
        <section className="intro" aria-labelledby="categories-heading">
          <img className="intro-mark" src={categoryMark} alt="" aria-hidden="true" />
          <div className="intro-copy"><h1 id="categories-heading">{t('intro')}</h1><p>{t('subtitle')}</p></div>
        </section>
        <div className="search-box">
          <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.8" /><path d="m15.7 15.7 5 5" /></svg>
          <input ref={searchRef} type="search" aria-label={t('search')} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search')} autoComplete="off" />
          <kbd>Ctrl + K</kbd>
        </div>
        <section className="category-list" aria-label={t('intro')}>
          {filteredCategories.map((category) => <button className="category-card" key={category.id} type="button" data-tutorial-target={`category-${category.id}`} onClick={() => { setActiveId(category.id); setDirty(false); if (tutorial.step === 'category') dispatchTutorial({ type: 'advance', step: 'sync-intro' }); }} aria-label={t(category.openLabel)} aria-describedby={`category-${category.id}-description`}>
            <span className="card-accent" aria-hidden="true" /><category.Icon /><span className="card-divider" aria-hidden="true" />
            <span className="card-copy"><strong>{t(category.name)}</strong><span id={`category-${category.id}-description`}>{t(category.description)}</span></span>
            <svg className="card-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
          </button>)}
          {filteredCategories.length === 0 && <p className="empty-state" role="status">{t('noResults')}</p>}
        </section>
      </>}</div>
    </main>
    <footer className="footer">
      <a className="footer-link" href={GITHUB_URL} onClick={(event) => { event.preventDefault(); void openProject(isTauri(), (command) => invoke(command), (url, target, features) => window.open(url, target, features)).catch(() => setShellError(t('githubError'))); }}><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .9a11.1 11.1 0 0 0-3.51 21.64c.55.1.75-.24.75-.53v-1.87c-3.06.66-3.7-1.3-3.7-1.3-.5-1.27-1.22-1.61-1.22-1.61-1-.68.08-.67.08-.67 1.1.08 1.68 1.13 1.68 1.13.98 1.67 2.56 1.19 3.18.91.1-.71.38-1.19.7-1.47-2.45-.28-5.02-1.23-5.02-5.47 0-1.21.43-2.2 1.13-2.98-.11-.27-.49-1.41.11-2.94 0 0 .93-.3 3.05 1.14A10.6 10.6 0 0 1 12 6.77c.94 0 1.89.13 2.77.37 2.12-1.44 3.04-1.14 3.04-1.14.61 1.53.23 2.67.12 2.94.71.78 1.13 1.77 1.13 2.98 0 4.25-2.58 5.19-5.04 5.46.4.35.75 1.02.75 2.06v2.57c0 .3.2.63.76.53A11.11 11.11 0 0 0 12 .9Z" /></svg>{t('github')}</a>
      <span className="footer-disclaimer">{t('disclaimer')}</span>
      <button className="footer-about" type="button" aria-label={t('about')} onClick={() => dialogRef.current?.showModal()}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 10.5v6.2m0-10.3v.5" /></svg><span>{t('about')}</span>
      </button>
    </footer>
    {shellError && <p className="shell-error" role="alert">{shellError}</p>}
    <OnboardingTour state={tutorial} locale={locale} dispatch={dispatchTutorial} targetElement={tutorialTarget} hasLocalSnapshots={hasLocalSnapshots} onMissingTarget={continueWithoutTarget} onBack={backTutorial} />
    <dialog ref={dialogRef} aria-labelledby="about-title"><h2 id="about-title">{t('title')}</h2><h3>{t('aboutPurpose')}</h3><p>{t('aboutPurposeText')}</p><h3>{t('aboutStart')}</h3><p>{t('aboutStartText')}</p><h3>{t('aboutData')}</h3><p>{t('aboutDataText')}</p><h3>{t('aboutContribute')}</h3><p>{t('aboutContributeText')}</p><h3>{t('aboutLicenses')}</h3><p>{t('aboutLicensesText')}</p><button type="button" onClick={() => dialogRef.current?.close()}>{t('close')}</button></dialog>
    <RestartConfirmation open={confirmRestart} locale={locale} onCancel={() => setConfirmRestart(false)} onConfirm={confirmRestartTour} />
  </div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
