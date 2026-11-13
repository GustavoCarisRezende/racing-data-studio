import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { assertFacetPage } from '@rds/sandbox-contracts';
import type { DatasetDescriptor, FacetPage, FieldDescriptor, Filter, LocalizedText, ResolvedSelection, SandboxDataProvider, Scalar } from '@rds/sandbox-contracts';
import { fieldValueLabel, localize } from '@rds/sandbox-core';
import { Icon } from './icons.js';
import type { Translate } from './messages.js';

/** Stable request context: changing this field's own membership never resets its list. */
export function useFacetOptions(provider: SandboxDataProvider, descriptor: DatasetDescriptor | undefined, selection: ResolvedSelection | undefined, field: FieldDescriptor | undefined, filters: Filter[], enabled = true, search = '') {
  const signature = JSON.stringify(filters.filter(f => f.fieldId !== field?.id));
  const otherFilters = useMemo(() => filters.filter(f => f.fieldId !== field?.id), [signature, field?.id]);
  const key = JSON.stringify([descriptor?.id, selection?.token, field?.id, signature, search]);
  const [pagination, setPagination] = useState<{ key: string; cursor: string }>();
  const cursor = pagination?.key === key ? pagination.cursor : undefined;
  const [state, setState] = useState<{ key: string; page?: FacetPage; loading: boolean; error: boolean }>({ key: '', loading: false, error: false });
  const known = useRef(new Map<string, string>());
  const identity = `${descriptor?.id}/${selection?.token}/${field?.id}`;
  const lastIdentity = useRef(identity);
  if (lastIdentity.current !== identity) { known.current = new Map(); lastIdentity.current = identity; }
  useEffect(() => {
    if (!enabled || !provider.facet || !descriptor || !selection || !field) return;
    const controller = new AbortController();
    setState(old => ({ key, page: old.key === key ? old.page : undefined, loading: true, error: false }));
    const timer = setTimeout(() => {
      void provider.facet!({ protocolVersion: 1, datasetId: descriptor.id, selection, fieldId: field.id, filters: otherFilters, search, limit: 100, ...(cursor ? { cursor } : {}) }, controller.signal)
        .then(page => {
          assertFacetPage(page, field.type, 100);
          if (controller.signal.aborted || lastIdentity.current !== identity) return;
          for (const item of page.values) known.current.set(JSON.stringify(item.value), item.label);
          while (known.current.size > 2000) known.current.delete(known.current.keys().next().value!);
          setState(old => ({ key, loading: false, error: false, page: cursor && old.key === key && old.page ? { ...page, values: [...old.page.values, ...page.values].filter((item, i, all) => all.findIndex(other => other.value === item.value) === i).slice(0, 1000) } : page }));
        }).catch(() => { if (!controller.signal.aborted) setState({ key, loading: false, error: true }); });
    }, search ? 150 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [provider, descriptor, selection, field, otherFilters, key, cursor, enabled, search]);
  return { page: state.key === key ? state.page : undefined, loading: state.key === key && state.loading, error: state.key === key && state.error,
    known: known.current, more: () => { if (state.page?.nextCursor) setPagination({ key, cursor: state.page.nextCursor }); } };
}

export function QuickFilters({ descriptor: d, selection, provider, filters, onChange, locale, t, expanded, onExpand, disabled }: {
  descriptor: DatasetDescriptor; selection: ResolvedSelection; provider: SandboxDataProvider; filters: Filter[]; onChange: (filters: Filter[]) => void;
  locale: string; t: Translate; expanded: string | null; onExpand: (fieldId: string | null) => void; disabled: boolean;
}) {
  const multi = d.capabilities.multiSelection;
  const base: { fieldId: string; label?: LocalizedText }[] = d.presentation?.filters ?? d.fields.filter(f => f.role === 'dimension' && f.filters.includes('in') && f.id !== d.presentation?.primaryFilterFieldId).map(f => ({ fieldId: f.id }));
  const fields = multi ? [{ fieldId: multi.fieldId }, ...base.filter(f => f.fieldId !== multi.fieldId)] : base;
  return <div className="rds-sb-quick-filters">{fields.map(item => {
    const field = d.fields.find(f => f.id === item.fieldId);
    return field && field.availability !== 'unavailable' && provider.facet ? <QuickFacet key={field.id} descriptor={d} selection={selection} provider={provider} field={field} label={item.label ? localize(item.label, locale) : localize(field.label, locale)} filters={filters} onChange={onChange} locale={locale} t={t} open={expanded === field.id} onOpen={onExpand} disabled={disabled} /> : null;
  })}</div>;
}

function QuickFacet({ descriptor, selection, provider, field, label, filters, onChange, locale, t, open, onOpen, disabled }: {
  descriptor: DatasetDescriptor; selection: ResolvedSelection; provider: SandboxDataProvider; field: FieldDescriptor; label: string; filters: Filter[];
  onChange: (filters: Filter[]) => void; locale: string; t: Translate; open: boolean; onOpen: (fieldId: string | null) => void; disabled: boolean;
}) {
  const uid = useId();
  const [search, setSearch] = useState('');
  const options = useFacetOptions(provider, descriptor, selection, field, filters, open, search);
  const filter = filters.find(f => f.fieldId === field.id);
  const chosen = filter?.op === 'in' ? filter.values : [];
  const maximum = descriptor.capabilities.multiSelection?.fieldId === field.id ? descriptor.capabilities.multiSelection.maxValues : 200;
  const choices = [...chosen.filter(value => !options.page?.values.some(item => item.value === value)).map(value => ({ value, label: options.known.get(JSON.stringify(value)) ?? fieldValueLabel(field, value, locale), count: undefined })), ...(options.page?.values ?? [])];
  const setChosen = (values: Exclude<Scalar, null>[]) => onChange([...filters.filter(f => f.fieldId !== field.id), ...(values.length ? [{ fieldId: field.id, op: 'in' as const, values }] : [])]);
  const selectedLabels = chosen.map(value => field.labelField && !options.known.has(JSON.stringify(value)) ? '' : fieldValueLabel(field, value, locale, options.known.get(JSON.stringify(value))));
  return <details className="rds-sb-quick-filter" open={open} onToggle={e => {
    if (e.currentTarget.open && !open) onOpen(field.id);
    if (!e.currentTarget.open && open) onOpen(null);
  }}>
    <summary><Icon name="filter" /><span>{label}</span><span className="rds-sb-filter-count">{chosen.length || (filter ? '•' : t('all'))}</span></summary>
    {chosen.length > 0 && <p className="rds-sb-selection-summary" title={selectedLabels.filter(Boolean).join(', ')}>{selectedLabels.some(Boolean) ? selectedLabels.filter(Boolean).slice(0, 2).join(', ') : `${chosen.length} ${t('selected')}`}{chosen.length > 2 && selectedLabels.some(Boolean) ? ` +${chosen.length - 2}` : ''}</p>}
    {open && <div className="rds-sb-filter-body">
      <label className="rds-sb-sr" htmlFor={`${uid}-search`}>{t('search')}: {label}</label>
      <input id={`${uid}-search`} type="search" placeholder={`${t('search')}: ${label.toLocaleLowerCase(locale)}`} value={search} maxLength={300} onChange={e => setSearch(e.target.value)} />
      <button className="rds-sb-all" type="button" aria-pressed={!filter} disabled={disabled} onClick={() => setChosen([])}>{t('all')} · {t('noRestriction')}</button>
      <fieldset className="rds-sb-facet" disabled={disabled}><legend className="rds-sb-sr">{label}</legend>{choices.map(item => <label key={JSON.stringify(item.value)}><input type="checkbox" checked={chosen.includes(item.value)} disabled={!chosen.includes(item.value) && chosen.length >= maximum} onChange={e => setChosen(e.target.checked ? [...chosen, item.value] : chosen.filter(v => v !== item.value))} /><span>{fieldValueLabel(field, item.value, locale, item.label)}</span><small aria-hidden="true">{item.count}</small></label>)}</fieldset>
      {chosen.length >= maximum && <p role="status">{t('selectionLimit')} ({maximum})</p>}
      {options.loading && <p role="status">{t('loading')}</p>}
      {options.error && <p role="alert">{t('error')}</p>}
      {options.page?.values.length === 0 && !choices.length && <p>{t('noValues')}</p>}
      {options.page?.nextCursor && <button type="button" disabled={options.loading || options.page.values.length >= 1000} onClick={options.more}>{t('more')}</button>}
      <p className="rds-sb-muted">{chosen.length ? `${chosen.length} ${t('selected')}` : t('selectToFilter')}</p>
    </div>}
  </details>;
}
