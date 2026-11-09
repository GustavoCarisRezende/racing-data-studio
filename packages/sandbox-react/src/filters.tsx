import { useEffect, useId, useState } from 'react';
import { assertFacetPage, compareDecimal, isScalarOfType } from '@rds/sandbox-contracts';
import type { DatasetDescriptor, FacetPage, FieldDescriptor, Filter, FilterOperator, ResolvedSelection, SandboxDataProvider, Scalar } from '@rds/sandbox-contracts';
import { fieldValueLabel, localize } from '@rds/sandbox-core';
import type { Translate } from './messages.js';

function parseBound(value: string, field: FieldDescriptor): string | number {
  if (field.type === 'integer') {
    if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('integer');
    return Number(value);
  }
  if (!isScalarOfType(value, field.type)) throw new Error('scalar');
  return value;
}
export function FilterEditor({ descriptor: d, selection, provider, filters, onChange, locale, t }: {
  descriptor: DatasetDescriptor; selection: ResolvedSelection; provider: SandboxDataProvider; filters: Filter[];
  onChange: (filters: Filter[]) => void; locale: string; t: Translate;
}) {
  const uid = useId();
  const fields = d.fields.filter(f => f.availability !== 'unavailable' && f.filters.some(op => op !== 'in' || provider.facet));
  const [fieldId, setFieldId] = useState(fields[0]?.id ?? '');
  const field = fields.find(f => f.id === fieldId);
  const [op, setOp] = useState<FilterOperator>('contains');
  const [value, setValue] = useState('');
  const [maximum, setMaximum] = useState('');
  const [chosen, setChosen] = useState<Exclude<Scalar, null>[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<FacetPage | null>(null);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const supported = field?.filters.filter(operator => operator !== 'in' || provider.facet) ?? [];
  const effectiveOp = supported.includes(op) ? op : supported[0];
  useEffect(() => {
    const existing = filters.find(filter => filter.fieldId === fieldId);
    setOp(existing && supported.includes(existing.op) ? existing.op : supported[0] ?? 'contains');
  }, [fieldId, filters]);
  useEffect(() => {
    const existing = filters.find(filter => filter.fieldId === fieldId && filter.op === effectiveOp);
    setValue(existing?.op === 'contains' ? existing.value : existing?.op === 'range' && existing.min !== undefined ? String(existing.min) : '');
    setMaximum(existing?.op === 'range' && existing.max !== undefined ? String(existing.max) : '');
    setChosen(existing?.op === 'in' ? [...existing.values] : []);
    setSearch(''); setPage(null); setCursor(undefined); setError('');
  }, [fieldId, effectiveOp, filters]);
  useEffect(() => {
    if (effectiveOp !== 'in' || !field || !provider.facet) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    // Debounce remote/native facet work; no user regex or SQL is forwarded.
    const timer = setTimeout(() => {
      void provider.facet!({ protocolVersion: 1, datasetId: d.id, selection, fieldId: field.id, filters: filters.filter(f => f.fieldId !== field.id), search, limit: 100, ...(cursor ? { cursor } : {}) }, controller.signal)
        .then(result => { assertFacetPage(result, field.type, 100); if (!controller.signal.aborted) setPage(previous => cursor && previous ? { ...result, values: [...previous.values, ...result.values].filter((v, index, all) => all.findIndex(x => x.value === v.value) === index).slice(0, 1000) } : result); })
        .catch(() => { if (!controller.signal.aborted) setError(t('error')); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [field, effectiveOp, provider, d.id, selection, filters, search, cursor, t]);

  function apply() {
    if (!field || !effectiveOp) return;
    try {
      let filter: Filter;
      if (effectiveOp === 'in') {
        if (!chosen.length) throw new Error('empty');
        filter = { fieldId, op: 'in', values: chosen };
      } else if (effectiveOp === 'contains') {
        if (!value.trim()) throw new Error('empty');
        filter = { fieldId, op: effectiveOp, value };
      } else if (effectiveOp === 'range') {
        if (!value && !maximum) throw new Error('empty');
        const min = value ? parseBound(value, field) : undefined;
        const max = maximum ? parseBound(maximum, field) : undefined;
        if (min !== undefined && max !== undefined && (field.type === 'decimal' ? compareDecimal(String(min), String(max)) > 0 : field.type === 'integer' ? Number(min) > Number(max) : field.type === 'datetime' ? Date.parse(String(min)) > Date.parse(String(max)) : String(min) > String(max))) throw new Error('reversed');
        filter = { fieldId, op: 'range', ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
      } else filter = { fieldId, op: effectiveOp };
      onChange([...filters.filter(f => f.fieldId !== fieldId), filter]); setError('');
    } catch { setError(t('invalidFilter')); }
  }
  return <section className="rds-sb-filters" aria-labelledby={`${uid}-heading`}>
    <h3 id={`${uid}-heading`}>{t('filters')}</h3>
    {filters.length > 0 && <><ul className="rds-sb-filter-list">{filters.map(filter => {
      const f = d.fields.find(item => item.id === filter.fieldId)!;
      const detail = filter.op === 'in' ? f.labelField ? `${filter.values.length} ${t('selected')}` : filter.values.map(v => fieldValueLabel(f, v, locale)).join(', ') : filter.op === 'contains' ? filter.value : filter.op === 'range' ? `${filter.min ?? '…'} – ${filter.max ?? '…'}` : '';
      return <li key={filter.fieldId}><span>{localize(f.label, locale)} · {t(filter.op)} {detail}</span><button type="button" aria-label={`${t('remove')}: ${localize(f.label, locale)}`} onClick={() => onChange(filters.filter(x => x !== filter))}>×</button></li>;
    })}</ul><button type="button" onClick={() => onChange([])}>{t('clear')}</button></>}
    {fields.length > 0 && <details><summary>{t('addFilter')}</summary>
      <label>{t('field')}<select value={fieldId} onChange={e => setFieldId(e.target.value)}>{fields.map(f => <option key={f.id} value={f.id}>{localize(f.label, locale)}</option>)}</select></label>
      <label>{t('operator')}<select value={effectiveOp ?? ''} onChange={e => setOp(e.target.value as FilterOperator)}>{supported.map(operator => <option key={operator} value={operator}>{t(operator)}</option>)}</select></label>
      {effectiveOp === 'contains' && <label>{t('contains')}<input maxLength={300} value={value} onChange={e => setValue(e.target.value)} /></label>}
      {effectiveOp === 'contains' && field?.description && <p className="rds-sb-muted">{localize(field.description, locale)}</p>}
      {effectiveOp === 'range' && <><label>{t('min')}<input type={field?.type === 'date' ? 'date' : 'text'} inputMode={field?.type === 'decimal' || field?.type === 'integer' ? 'decimal' : 'text'} placeholder={field?.type === 'decimal' ? '0.00' : undefined} maxLength={100} value={value} onChange={e => setValue(e.target.value)} /></label><label>{t('max')}<input type={field?.type === 'date' ? 'date' : 'text'} maxLength={100} value={maximum} onChange={e => setMaximum(e.target.value)} /></label></>}
      {effectiveOp === 'range' && (field?.type === 'decimal' || field?.type === 'datetime') && <p className="rds-sb-muted">{t(field.type === 'decimal' ? 'decimalHint' : 'datetimeHint')}</p>}
      {effectiveOp === 'in' && <><label>{t('search')}<input type="search" maxLength={300} value={search} onChange={e => { setSearch(e.target.value); setCursor(undefined); setPage(null); }} /></label>
        <fieldset className="rds-sb-facet"><legend>{t('in')}</legend>{page?.values.map(item => <label key={JSON.stringify(item.value)}><input type="checkbox" checked={chosen.includes(item.value)} disabled={!chosen.includes(item.value) && chosen.length >= 200} onChange={e => setChosen(old => e.target.checked ? [...old, item.value] : old.filter(v => v !== item.value))} />{field ? fieldValueLabel(field, item.value, locale, item.label) : item.label}{item.count !== undefined ? ` (${item.count})` : ''}</label>)}{page?.values.length === 0 && <p>{t('noValues')}</p>}</fieldset>
        {page?.nextCursor && <button type="button" disabled={loading || page.values.length >= 1000} onClick={() => setCursor(page.nextCursor)}>{t('more')}</button>}
        {(chosen.length >= 200 || (page?.values.length ?? 0) >= 1000) && <p role="status">{t('facetLimit')}</p>}
      </>}
      {loading && <p role="status">{t('loading')}</p>}
      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={!effectiveOp || (effectiveOp === 'in' && !chosen.length)} onClick={apply}>{t('apply')}</button>
    </details>}
  </section>;
}
