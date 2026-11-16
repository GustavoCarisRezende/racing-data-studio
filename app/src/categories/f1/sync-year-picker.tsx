import { useEffect, useId, useRef, useState } from 'react';
import type { Translate } from '../../i18n/messages';
import { filterSyncYears, isYearChoiceValid } from './year-search';

type Props = {
  years: number[];
  importedYears: number[] | null;
  localLoaded: boolean;
  year: number;
  disabled: boolean;
  imported: boolean;
  t: Translate;
  onSelect: (year: number) => void;
  onImport: () => void;
  suggestedYear?: number;
  suggestedYearLabel?: string;
  tutorialYearFallback?: boolean;
  pending?: boolean;
  onSelectSuggested?: (year: number) => void;
};

export function SyncYearPicker({ years, importedYears, localLoaded, year, disabled, imported, t, onSelect, onImport, suggestedYear, suggestedYearLabel, tutorialYearFallback, pending, onSelectSuggested }: Props) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const filtered = filterSyncYears(years, query, onlyMissing, localLoaded ? importedYears : null);
  const valid = isYearChoiceValid(year, filtered);
  const listId = `${id}-options`;
  const effectiveActiveIndex = Math.min(activeIndex, filtered.length - 1);

  useEffect(() => {
    if (!open || !disabled) return;
    close();
  }, [disabled, open]);

  useEffect(() => {
    if (open && !disabled) inputRef.current?.focus();
  }, [disabled, open]);

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close();
    }
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  useEffect(() => {
    if (effectiveActiveIndex !== activeIndex) setActiveIndex(effectiveActiveIndex);
    if (open && effectiveActiveIndex >= 0) {
      const option = document.getElementById(`${id}-option-${effectiveActiveIndex}`);
      if (option && typeof option.scrollIntoView === 'function') option.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, effectiveActiveIndex, filtered.length, id, open]);

  function close() {
    setOpen(false);
  }

  function openPicker() {
    if (disabled || open) return;
    setOpen(true);
    setActiveIndex(-1);
  }

  function choose(choice: number) {
    if (disabled || !filtered.includes(choice)) return;
    onSelect(choice);
    setQuery('');
    close();
    rootRef.current?.querySelector<HTMLButtonElement>('.sync-year-trigger')?.focus();
  }

  function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) close();
      else openPicker();
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (filtered.length) {
        setActiveIndex((previousIndex) => {
          const index = Math.min(previousIndex, filtered.length - 1);
          return index < 0
          ? event.key === 'ArrowDown' ? 0 : filtered.length - 1
          : event.key === 'ArrowDown' ? (index + 1) % filtered.length : (index - 1 + filtered.length) % filtered.length;
        });
      }
    } else if (event.key === 'Enter' && filtered.length) {
      event.preventDefault();
      choose(filtered[activeIndex < 0 ? 0 : Math.min(activeIndex, filtered.length - 1)]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
      rootRef.current?.querySelector<HTMLButtonElement>('.sync-year-trigger')?.focus();
    } else if (event.key === 'Tab') {
      close();
    }
  }

  const searchLabel = t('searchYear');
  return <div className="sync-year-picker" ref={rootRef}>
    <div className="sync-year-selection">
      <label id={`${id}-label`}>{t('season')}</label>
      <div className="sync-year-combobox">
        <button
          type="button"
          className="sync-year-trigger"
          data-tutorial-target={tutorialYearFallback ? 'f1-sync-year' : undefined}
          aria-labelledby={`${id}-label ${id}-selected`}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-invalid={!valid}
          aria-describedby={!valid ? `${id}-invalid` : undefined}
          disabled={disabled}
          onClick={() => { if (open) close(); else openPicker(); }}
          onKeyDown={handleTriggerKeyDown}
        ><span id={`${id}-selected`}>{valid ? year : `${year} · ${t('selectYear')}`}</span></button>
        {open && <div className="sync-year-popup">
          <label className="sr-only" htmlFor={`${id}-search`}>{searchLabel}</label>
          <input
            ref={inputRef}
            id={`${id}-search`}
            type="search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={effectiveActiveIndex >= 0 ? `${id}-option-${effectiveActiveIndex}` : undefined}
            autoComplete="off"
            value={query}
            onChange={(event) => { setQuery(event.target.value.replace(/\D/g, '').slice(0, 4)); setActiveIndex(-1); }}
            onKeyDown={handleKeyDown}
            onBlur={(event) => {
              if (!rootRef.current?.contains(event.relatedTarget as Node | null)) close();
            }}
          />
          <div className="sync-year-listbox" id={listId} role="listbox" aria-label={searchLabel}>
            {filtered.length === 0
              ? <p className="sync-year-empty" role="status">{onlyMissing && !localLoaded ? t('missingSeasonsUnavailable') : t('noYears')}</p>
              : filtered.map((choice, index) => <div
                  key={choice}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={choice === year}
                  className={index === effectiveActiveIndex ? 'sync-year-option is-active' : 'sync-year-option'}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(choice)}
                >{choice}{importedYears?.includes(choice) ? ` · ${t('imported')}` : ''}</div>)}
          </div>
        </div>}
      </div>
      {!valid && <span className="sr-only" id={`${id}-invalid`}>{t('selectYear')}</span>}
    </div>
    {suggestedYear !== undefined && years.includes(suggestedYear) && onSelectSuggested && <button type="button" data-tutorial-target="f1-sync-year" disabled={disabled} onClick={() => onSelectSuggested(suggestedYear)}>{suggestedYearLabel ?? t('season')} {suggestedYear}</button>}
    <button type="button" data-tutorial-target="f1-sync-run" data-tutorial-pending={pending ? 'true' : undefined} onClick={onImport} disabled={disabled || !localLoaded || !valid}>{t(imported ? 'updateSeason' : 'importSeason')}</button>
    <label className="sync-only-missing" htmlFor={`${id}-missing`}>
      <input
        id={`${id}-missing`}
        type="checkbox"
        checked={onlyMissing}
        disabled={disabled || !localLoaded}
        onChange={(event) => { setOnlyMissing(event.target.checked); setActiveIndex(-1); }}
      />
      {t('onlyMissingSeasons')}
    </label>
    {!valid && <p className="sync-year-invalid" role="status">{t('selectYear')}</p>}
  </div>;
}
