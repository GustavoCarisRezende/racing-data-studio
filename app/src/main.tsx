import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { categories } from './categories/registry';
import { messages, type Locale } from './i18n/messages';
import logo from './assets/rds-logo.svg';
import background from './assets/header-background.svg';
import categoryMark from './assets/category-mark.svg';
import './style.css';

function App() {
  const [locale, setLocale] = useState<Locale>(() => navigator.language.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en-US');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const t = (key: keyof typeof messages['en-US']) => messages[locale][key];
  const active = categories.find((category) => category.id === activeId);
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const filteredCategories = categories.filter((category) => normalize(t(category.name)).includes(normalize(query)));
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && searchRef.current && !dialogRef.current?.open) {
        event.preventDefault();
        searchRef.current.focus();
      } else if (event.key === 'Escape' && document.activeElement === searchRef.current) {
        searchRef.current?.blur();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return <div className="app-shell">
    <header className="masthead">
      <div className="brand">
        <img className="brand-image" src={logo} alt={t('title')} />
        <span className="brand-separator" aria-hidden="true" />
        <strong className="brand-text" aria-hidden="true">{t('title')}</strong>
      </div>
      <div className="locale-control">
        <label htmlFor="locale">{t('language')}</label>
        <div className="select-wrap">
          <select id="locale" aria-label={t('language')} value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
            <option value="pt-BR">Português (Brasil)</option><option value="en-US">English (US)</option>
          </select>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7 5 5 5-5" /></svg>
        </div>
      </div>
    </header>
    <main className="main">
      <img className="background-art" src={background} alt="" aria-hidden="true" />
      <div className="content">{active ? <div className="module-screen"><button className="back" type="button" onClick={() => setActiveId(null)}>{t('back')}</button><active.Screen t={t} locale={locale} /></div> : <>
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
          {filteredCategories.map((category) => <button className="category-card" key={category.id} type="button" onClick={() => setActiveId(category.id)} aria-label={t(category.openLabel)} aria-describedby={`category-${category.id}-description`}>
            <span className="card-accent" aria-hidden="true" /><category.Icon /><span className="card-divider" aria-hidden="true" />
            <span className="card-copy"><strong>{t(category.name)}</strong><span id={`category-${category.id}-description`}>{t(category.description)}</span></span>
            <svg className="card-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
          </button>)}
          {filteredCategories.length === 0 && <p className="empty-state" role="status">{t('noResults')}</p>}
        </section>
      </>}</div>
    </main>
    <footer className="footer">
      <span className="footer-link"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .9a11.1 11.1 0 0 0-3.51 21.64c.55.1.75-.24.75-.53v-1.87c-3.06.66-3.7-1.3-3.7-1.3-.5-1.27-1.22-1.61-1.22-1.61-1-.68.08-.67.08-.67 1.1.08 1.68 1.13 1.68 1.13.98 1.67 2.56 1.19 3.18.91.1-.71.38-1.19.7-1.47-2.45-.28-5.02-1.23-5.02-5.47 0-1.21.43-2.2 1.13-2.98-.11-.27-.49-1.41.11-2.94 0 0 .93-.3 3.05 1.14A10.6 10.6 0 0 1 12 6.77c.94 0 1.89.13 2.77.37 2.12-1.44 3.04-1.14 3.04-1.14.61 1.53.23 2.67.12 2.94.71.78 1.13 1.77 1.13 2.98 0 4.25-2.58 5.19-5.04 5.46.4.35.75 1.02.75 2.06v2.57c0 .3.2.63.76.53A11.11 11.11 0 0 0 12 .9Z" /></svg>{t('github')}</span>
      <span className="footer-disclaimer">{t('disclaimer')}</span>
      <button className="footer-about" type="button" aria-label={t('about')} onClick={() => dialogRef.current?.showModal()}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 10.5v6.2m0-10.3v.5" /></svg><span>{t('about')}</span>
      </button>
    </footer>
    <dialog ref={dialogRef} aria-labelledby="about-title"><h2 id="about-title">{t('title')}</h2><p>{t('projectInfo')}</p><button type="button" onClick={() => dialogRef.current?.close()}>{t('close')}</button></dialog>
  </div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
