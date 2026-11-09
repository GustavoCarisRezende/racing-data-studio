import { Component, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { assertAnalysisList, assertCatalog, assertDataset, assertResult, assertSelection, parseAnalysisDocument } from '@rds/sandbox-contracts';
import type { AnalysisDocument, AnalysisStore, AnalysisSummary, DatasetDescriptor, DatasetSummary, Filter, QueryRequest, QueryResult, ResolvedSelection, SandboxDataProvider, SandboxHostServices, SelectionRequest, VisualizationSpec } from '@rds/sandbox-contracts';
import { availableDimensions, buildChartModel, buildQuery, chartAvailable, createValueFormatter, defaultVisualization, exportResult, fieldValueLabel, localize, makeAnalysis, withRequiredDimensions } from '@rds/sandbox-core';
import type { ChartModel } from '@rds/sandbox-core';
import { FilterEditor } from './filters.js';
import { QuickFilters, useFacetOptions } from './quick-filters.js';
import { Bindings } from './bindings.js';
import { Icon } from './icons.js';
import { translator } from './messages.js';
import type { MessageKey, Translate } from './messages.js';
export { translator } from './messages.js';
export type { MessageKey, Translate } from './messages.js';

export interface ChartRendererProps { model: ChartModel; locale: string }
export interface SandboxProps {
  provider: SandboxDataProvider;
  store?: AnalysisStore;
  host?: SandboxHostServices;
  locale?: string;
  messages?: Partial<Record<MessageKey, string>>;
  ChartRenderer?: ComponentType<ChartRendererProps>;
  /** Keep this object's identity stable. Changing it deliberately resolves a new view. */
  selection?: Omit<SelectionRequest, 'protocolVersion' | 'datasetId'>;
}
interface Session {
  descriptor: DatasetDescriptor;
  selection: ResolvedSelection;
  visualization: VisualizationSpec;
  filters: Filter[];
  saved?: AnalysisDocument;
}
interface LoadRequest { datasetId: string; document?: unknown }
interface ResultState { session: Session; query: QueryRequest; result: QueryResult }
type DatasetView = NonNullable<NonNullable<DatasetDescriptor['presentation']>['views']>[number];
const DEFAULT_SELECTION = { policy: 'latest' as const, partitionIds: [] as string[] };
function matchingView(descriptor: DatasetDescriptor, visualization: VisualizationSpec, filters: Filter[]): DatasetView | undefined {
  return descriptor.presentation?.views?.find(view => view.visualization.series === visualization.series && view.visualization.metric.metricId === visualization.metric.metricId && view.filters.every(filter => filters.some(item => JSON.stringify(item) === JSON.stringify(filter))));
}
function errorMessage(t: Translate, error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return `${t('error')}${/^[A-Z_]{1,40}$/.test(code) ? ` (${code})` : ''}`;
}
function sameRevisions(a: ResolvedSelection, b: ResolvedSelection): boolean {
  const sort = (s: ResolvedSelection) => [...s.revisions].sort((x, y) => x.partitionId.localeCompare(y.partitionId));
  return a.transformationVersion === b.transformationVersion && JSON.stringify(sort(a)) === JSON.stringify(sort(b));
}
class ChartBoundary extends Component<{ children: ReactNode; fallback: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p role="alert">{this.props.fallback}</p> : this.props.children; }
}

/** All I/O is injected. No global state, localStorage, source fetches, or native APIs. */
export function Sandbox({ provider, store, host, locale: requestedLocale = 'en-US', messages, ChartRenderer, selection = DEFAULT_SELECTION }: SandboxProps) {
  const locale = useMemo(() => { try { new Intl.NumberFormat(requestedLocale); return requestedLocale; } catch { return 'en-US'; } }, [requestedLocale]);
  const uid = useId();
  const t = useMemo(() => translator(locale, messages), [locale, messages]);
  const tRef = useRef(t); tRef.current = t;
  const [catalog, setCatalog] = useState<DatasetSummary[] | null>(null);
  const [load, setLoad] = useState<LoadRequest | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [result, setResult] = useState<ResultState | null>(null);
  const [loading, setLoading] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<MessageKey | ''>('');
  const [title, setTitle] = useState('');
  const [savedList, setSavedList] = useState<AnalysisSummary[]>([]);
  const [savedId, setSavedId] = useState('');
  const [storeRevision, setStoreRevision] = useState(0);
  const [working, setWorking] = useState(false);
  const [page, setPage] = useState(0);
  const [expandedFilter, setExpandedFilter] = useState<string | null>(null);
  const [activeView, setActiveView] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    const controller = new AbortController();
    setCatalog(null); setLoad(null); setSession(null); setError('');
    void provider.listDatasets(controller.signal).then(items => {
      assertCatalog(items);
      if (!controller.signal.aborted) { setCatalog(items); if (items[0]) setLoad({ datasetId: items[0].id }); }
    }).catch(e => { if (!controller.signal.aborted) { setError(errorMessage(tRef.current, e)); setCatalog([]); } });
    return () => controller.abort();
  }, [provider]);

  useEffect(() => {
    if (!load) return;
    const controller = new AbortController();
    setLoading(true); setSession(null); setResult(null); setError(''); setNotice('');
    void (async () => {
      const descriptor = await provider.describeDataset({ datasetId: load.datasetId, locale }, controller.signal);
      assertDataset(descriptor);
      if (descriptor.id !== load.datasetId) throw new Error('Dataset identity mismatch');
      const document = load.document === undefined ? undefined : parseAnalysisDocument(load.document, descriptor);
      const resolved = await provider.resolveSelection({ protocolVersion: 1, datasetId: descriptor.id,
        ...(document ? { policy: 'pinned', partitionIds: document.selection.revisions.map(r => r.partitionId), revisions: document.selection.revisions } as const : selection) }, controller.signal);
      assertSelection(resolved);
      if (resolved.datasetId !== descriptor.id || (document && !sameRevisions(document.selection, resolved))) throw new Error('Pinned revision/transform unavailable');
      let visualization = document?.visualization ?? descriptor.presentation?.defaultVisualization ?? defaultVisualization(descriptor);
      if (!document && !descriptor.presentation?.defaultVisualization && visualization && ChartRenderer && chartAvailable('line', descriptor, visualization)) visualization = { ...visualization, kind: 'line' };
      if (!document && visualization && !ChartRenderer) visualization = { ...visualization, kind: 'table' };
      if (!controller.signal.aborted) {
        if (!visualization) { setError(tRef.current('noFields')); return; }
        setSession({ descriptor, selection: resolved, visualization, filters: document?.filters ?? descriptor.presentation?.defaultFilters ?? [], saved: document });
        setActiveView(document ? matchingView(descriptor, visualization, document.filters)?.id ?? '' : descriptor.presentation?.views?.[0]?.id ?? descriptor.id);
        setExpandedFilter(null);
        setAdvancedOpen(false);
        setTitle(document?.title ?? localize(descriptor.presentation?.views?.[0]?.label ?? descriptor.label, locale));
        if (document) setNotice('loaded');
      }
    })().catch(e => { if (!controller.signal.aborted) setError(errorMessage(tRef.current, e)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // Locale changes reformat the existing result, never reset filters or snapshots.
  }, [load, provider, selection]);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    setQuerying(true); setError(''); setResult(null); setPage(0);
    // Coalesce multiple field/filter edits. Abort + identity check protect old responses.
    const timer = setTimeout(() => {
      let query: QueryRequest;
      try { query = buildQuery(session.descriptor, session.selection, session.visualization, session.filters, `query-${crypto.randomUUID()}`); }
      catch { setError(tRef.current('invalid')); setQuerying(false); return; }
      void provider.query(query, controller.signal).then(response => {
        assertResult(response, query, session.descriptor);
        if (!controller.signal.aborted) setResult({ session, query, result: response });
      }).catch(e => { if (!controller.signal.aborted) setError(errorMessage(tRef.current, e)); })
        .finally(() => { if (!controller.signal.aborted) setQuerying(false); });
    }, 100);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [session, provider]);

  useEffect(() => {
    const controller = new AbortController(); setSavedList([]); setSavedId('');
    if (store) void store.list(controller.signal).then(items => {
      assertAnalysisList(items);
      if (!controller.signal.aborted) { setSavedList(items); setSavedId(items[0]?.id ?? ''); }
    }).catch(e => { if (!controller.signal.aborted) setError(errorMessage(tRef.current, e)); });
    return () => controller.abort();
  }, [store, storeRevision]);
  useEffect(() => {
    setWorking(false);
    return () => { operation.current?.abort(); operation.current = null; };
  }, [provider, store, host]);

  const current = result?.session === session ? result : null;
  const complete = current?.result.complete === true;
  const d = session?.descriptor;
  const v = session?.visualization;
  const dimensions = d ? availableDimensions(d) : [];
  const metric = d?.metrics.find(m => m.id === v?.metric.metricId);
  const primaryField = d?.fields.find(f => f.id === d.presentation?.primaryFilterFieldId);
  const scopes = useFacetOptions(provider, d, session?.selection, primaryField, [], Boolean(primaryField));
  const primaryFilter = session?.filters.find(f => f.fieldId === primaryField?.id);
  const primaryValues = primaryFilter?.op === 'in' ? primaryFilter.values : [];
  const scopeOptions = scopes.page?.values ?? [];
  const comparisonEnabled = primaryValues.length > 1;
  const chart = useMemo(() => {
    if (!current || !session || session.visualization.kind === 'table' || !current.result.complete || !current.result.rows.length) return null;
    try { return { model: buildChartModel(session.descriptor, current.query, current.result, session.visualization.kind, locale, title) }; }
    catch { return { error: t('invalid') }; }
  }, [current, session, locale, title, t]);

  function update(patch: Partial<VisualizationSpec>) {
    if (!session) return;
    let next = { ...session.visualization, ...patch };
    const m = session.descriptor.metrics.find(item => item.id === next.metric.metricId)!;
    if (patch.metric) {
      if (!m.groupableBy.includes(next.x)) next = { ...next, x: dimensions.find(f => m.groupableBy.includes(f.id))?.id ?? next.x };
      if (next.series && !m.groupableBy.includes(next.series)) next.series = null;
      if (next.comparison && !m.groupableBy.includes(next.comparison)) next.comparison = null;
    }
    if (next.series === next.x) next.series = null;
    if (next.comparison === next.x || next.comparison === next.series) next.comparison = null;
    const constrained = withRequiredDimensions(session.descriptor, next);
    if (!constrained) { setError(t('invalid')); return; }
    next = constrained;
    const adjustedChart = !chartAvailable(next.kind, session.descriptor, next);
    if (adjustedChart) next.kind = 'table';
    if (!m.supportsRunningSum || next.metric.aggregation !== 'sum' || !dimensions.find(f => f.id === next.x)?.ordered) next.runningSum = false;
    const nextView = matchingView(session.descriptor, next, session.filters);
    const previousView = session.descriptor.presentation?.views?.find(view => view.id === activeView);
    if (previousView && title === localize(previousView.label, locale)) setTitle(localize(nextView?.label ?? session.descriptor.label, locale));
    setActiveView(nextView?.id ?? '');
    setSession({ ...session, visualization: next }); setNotice(adjustedChart ? 'chartAdjusted' : '');
  }
  function changeScope(value: string, comparison = false) {
    if (!session || !primaryField) return;
    const selected = scopeOptions.find(item => JSON.stringify(item.value) === value)?.value;
    if (selected === undefined) return;
    const first = comparison ? primaryValues[0] ?? scopeOptions[0]?.value : selected;
    const second = comparison ? selected : comparisonEnabled ? primaryValues.find(item => item !== selected) : undefined;
    const values = [first, second].filter((item): item is string | number | boolean => item !== undefined);
    setSession({ ...session, filters: [...session.filters.filter(f => f.fieldId !== primaryField.id), { fieldId: primaryField.id, op: 'in', values: [...new Set(values)] }] }); setNotice('');
  }
  function toggleComparison(enabled: boolean) {
    if (!session || !primaryField) return;
    const first = primaryValues[0] ?? scopeOptions[0]?.value;
    const second = scopeOptions.find(item => item.value !== first)?.value;
    const values = enabled ? [first, second] : [first];
    if (values.some(item => item === undefined)) return;
    setSession({ ...session, filters: [...session.filters.filter(f => f.fieldId !== primaryField.id), { fieldId: primaryField.id, op: 'in', values: values as (string | number | boolean)[] }] }); setNotice('');
  }
  function selectView(view: DatasetView) {
    if (!session) return;
    const previous = session.descriptor.presentation?.views?.find(item => item.id === activeView);
    const replaced = new Set([...(previous?.filters ?? []).map(f => f.fieldId), ...view.filters.map(f => f.fieldId)]);
    setSession({ ...session, visualization: ChartRenderer ? view.visualization : { ...view.visualization, kind: 'table' }, filters: [...session.filters.filter(f => !replaced.has(f.fieldId)), ...view.filters] });
    setTitle(localize(view.label, locale)); setActiveView(view.id); setNotice('');
  }
  function applyFilters(filters: Filter[]) {
    if (!session) return;
    const view = session.descriptor.presentation?.views?.find(item => item.id === activeView);
    const nextView = matchingView(session.descriptor, session.visualization, filters);
    setActiveView(nextView?.id ?? '');
    if ((view && title === localize(view.label, locale)) || title === localize(session.descriptor.label, locale)) setTitle(localize(nextView?.label ?? session.descriptor.label, locale));
    setSession({ ...session, filters }); setNotice('');
  }
  function clearUserFilters() {
    if (!session) return;
    const view = session.descriptor.presentation?.views?.find(item => item.id === activeView);
    applyFilters([...session.filters.filter(f => f.fieldId === primaryField?.id), ...(view?.filters ?? [])]);
  }
  async function save() {
    if (!store || !session || !complete || !title.trim()) return;
    const controller = new AbortController(); operation.current?.abort(); operation.current = controller;
    const original = session;
    setWorking(true); setError('');
    try {
      const document = makeAnalysis(session.descriptor, session.selection, session.visualization, session.filters, title.trim(), session.saved);
      const saved = parseAnalysisDocument(await store.save(document, document.revision, controller.signal), session.descriptor);
      if (saved.id !== document.id || saved.revision === null || !sameRevisions(saved.selection, document.selection) || JSON.stringify(saved.visualization) !== JSON.stringify(document.visualization) || JSON.stringify(saved.filters) !== JSON.stringify(document.filters) || saved.title !== document.title) throw new Error('Store changed analysis content');
      if (!controller.signal.aborted && sessionRef.current === original) { setSession({ ...original, saved }); setNotice('saved'); setStoreRevision(n => n + 1); }
    } catch (e) { if (!controller.signal.aborted) setError(errorMessage(t, e)); }
    finally { if (operation.current === controller) { setWorking(false); operation.current = null; } }
  }
  async function restore() {
    if (!store || !savedId) return;
    const controller = new AbortController(); operation.current?.abort(); operation.current = controller;
    setWorking(true); setError('');
    try {
      const raw = await store.load(savedId, controller.signal);
      let value: unknown = raw;
      if (typeof raw === 'string') { if (raw.length > 256_000) throw new Error('Document too large'); value = JSON.parse(raw); }
      if (!value || typeof value !== 'object' || !('id' in value) || value.id !== savedId || !('datasetId' in value) || typeof value.datasetId !== 'string' || !catalog?.some(item => item.id === value.datasetId)) throw new Error('Unknown analysis/dataset');
      if (!controller.signal.aborted) setLoad({ datasetId: value.datasetId, document: value });
    } catch (e) { if (!controller.signal.aborted) setError(errorMessage(t, e)); }
    finally { if (operation.current === controller) { setWorking(false); operation.current = null; } }
  }
  async function exportCsv() {
    if (!host?.exportFiles || !current || !session || !complete) return;
    const controller = new AbortController(); operation.current = controller; setWorking(true); setError('');
    try { await host.exportFiles(exportResult(session.descriptor, current.query, current.result, title), controller.signal); }
    catch (e) { if (!controller.signal.aborted) setError(errorMessage(t, e)); }
    finally { if (operation.current === controller) { setWorking(false); operation.current = null; } }
  }

  return <section className="rds-sandbox" aria-label={t('sandbox')} lang={locale}>
    <div className="rds-sb-layout">
      <aside className="rds-sb-panel rds-sb-data" aria-labelledby={`${uid}-datasets`}>
        <h2 id={`${uid}-datasets`}>{t('datasets')}</h2>
        {catalog === null ? <p role="status">{t('loading')}</p> : catalog.length === 0 ? <p>{t('empty')}</p> : catalog.length > 1 ? <label>{t('dataset')}<select disabled={working} value={load?.datasetId ?? ''} onChange={e => setLoad({ datasetId: e.target.value })}>{catalog.map(item => <option key={item.id} value={item.id}>{localize(item.label, locale)}</option>)}</select></label> : null}
        {primaryField && provider.facet && <div className="rds-sb-scope"><label>{localize(primaryField.label, locale)}<select disabled={working || scopes.loading || !scopeOptions.length} value={primaryValues.length ? JSON.stringify(primaryValues[0]) : ''} onChange={e => changeScope(e.target.value)}>{!primaryValues.length && <option value="">{t(primaryFilter ? 'advancedFilters' : 'all')}</option>}{primaryValues.length > 0 && !scopeOptions.some(item => item.value === primaryValues[0]) && <option value={JSON.stringify(primaryValues[0])}>{fieldValueLabel(primaryField, primaryValues[0]!, locale)}</option>}{scopeOptions.map(item => <option key={JSON.stringify(item.value)} value={JSON.stringify(item.value)}>{fieldValueLabel(primaryField, item.value, locale, item.label)}</option>)}</select></label>{scopes.page?.nextCursor && <button type="button" disabled={scopes.loading || scopeOptions.length >= 1000} onClick={scopes.more}>{t('more')}</button>}{scopes.error && <p role="alert">{t('error')}</p>}</div>}
        {d && <nav className="rds-sb-dataset-list" aria-label={t('dataset')}>
          {d.presentation?.views?.length ? d.presentation.views.map(view => <button type="button" key={view.id} disabled={working} aria-pressed={activeView === view.id} onClick={() => selectView(view)}><Icon name="dataset" /><span>{localize(view.label, locale)}</span></button>) : <button type="button" aria-pressed="true" onClick={() => setLoad({ datasetId: d.id })}><Icon name="dataset" /><span>{localize(d.label, locale)}</span></button>}
        </nav>}
        {session && <section id={`${uid}-filters`} className="rds-sb-filter-section" aria-labelledby={`${uid}-filters-heading`}>
          <div className="rds-sb-section-heading"><h3 id={`${uid}-filters-heading`}>{t('filters')}</h3>{session.filters.length > 0 && <button className="rds-sb-text-button" type="button" disabled={working} onClick={clearUserFilters}>{t('clear')}</button>}</div>
          <QuickFilters descriptor={session.descriptor} selection={session.selection} provider={provider} filters={session.filters} onChange={applyFilters} locale={locale} t={t} expanded={expandedFilter} onExpand={setExpandedFilter} disabled={working} />
          <details className="rds-sb-advanced" open={advancedOpen} onToggle={e => setAdvancedOpen(e.currentTarget.open)}><summary>{t('advancedFilters')}</summary>{advancedOpen && <FilterEditor key={session.descriptor.id} descriptor={session.descriptor} selection={session.selection} provider={provider} filters={session.filters} onChange={applyFilters} locale={locale} t={t} />}</details>
        </section>}
        {store && savedList.length > 0 && <div className="rds-sb-saved"><label>{t('restore')}<select disabled={working} value={savedId} onChange={e => setSavedId(e.target.value)}>{savedList.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}</select></label><button type="button" disabled={working || !savedId} onClick={() => void restore()}>{t('open')}</button></div>}
      </aside>

      <section className="rds-sb-panel rds-sb-result" aria-labelledby={`${uid}-result`}>
        <h2 id={`${uid}-result`}>{t('builder')}</h2>
        <div className="rds-sb-toolbar">
          <div className="rds-sb-chart-types" role="group" aria-label={t('visualizationType')}>{session && d && v && (['line', 'bar', 'table'] as const).filter(kind => chartAvailable(kind, d, v) && (kind === 'table' || ChartRenderer)).map(kind => <button key={kind} type="button" disabled={working} aria-pressed={v.kind === kind} onClick={() => update({ kind })}><Icon name={kind} />{t(kind)}</button>)}</div>
          <div className="rds-sb-actions">{store && <button type="button" disabled={!complete || !title.trim() || working} onClick={() => void save()}><Icon name="save" />{t('save')}</button>}
          {host?.exportFiles && <button type="button" disabled={!complete || working} onClick={() => void exportCsv()}><Icon name="export" />{t('export')}</button>}</div>
        </div>
        {session && d && v && <div className="rds-sb-encoding"><Bindings descriptor={d} value={v} onChange={update} locale={locale} t={t} disabled={working} compact /><a className="rds-sb-filter-link" href={`#${uid}-filters`}><Icon name="filter" />{t('filters')}<span>{session.filters.length}</span></a></div>}
        <div className="rds-sb-feedback">
        {(loading || querying || working) && <p role="status">{t('loading')}</p>}
        {notice && <p role="status">{t(notice)}</p>}
        {error && <p role="alert">{error}</p>}
        {current && !complete && <p role="alert">{t('incomplete')}</p>}
        {v && v.kind !== 'table' && !ChartRenderer && <p role="status">{t('rendererMissing')}</p>}
        {current?.result.warnings.map(w => <p key={w.code} role="note">{localize(w.message, locale)}</p>)}
        </div>
        <div className="rds-sb-visualization">
          <label className="rds-sb-title"><span className="rds-sb-sr">{t('title')}</span><input maxLength={200} value={title} disabled={!session || working} onChange={e => { setTitle(e.target.value); setNotice(''); }} /></label>
          {current?.result.rows.length === 0 && v?.kind !== 'table' && <p role="status">{t('noRows')}</p>}
          {chart && 'model' in chart && chart.model && chart.model.series.length > 12 && <p className="rds-sb-muted" role="note">{t('manySeries')}</p>}
          {chart && ('error' in chart ? <p role="alert">{chart.error} {t('refineChart')}</p> : ChartRenderer && chart.model ? <figure className="rds-sb-chart"><ChartBoundary key={`${current?.query.requestId}-${locale}`} fallback={t('error')}><ChartRenderer model={chart.model} locale={locale} /></ChartBoundary><figcaption>{t('chartHelp')}</figcaption></figure> : null)}
          {v?.kind === 'table' && current && d && <ResultTable descriptor={d} result={current.result} page={page} setPage={setPage} locale={locale} t={t} uid={`${uid}-main`} />}
          {!current && !error && <div className="rds-sb-chart-placeholder">{loading || querying ? t('loading') : t('chooseDataset')}</div>}
        </div>
        {current && d && v?.kind !== 'table' && <details className="rds-sb-preview" open><summary><span>{t('dataPreview')}</span><span>{current.result.rows.length} {t('rows')}</span></summary><ResultTable descriptor={d} result={current.result} page={page} setPage={setPage} locale={locale} t={t} uid={uid} /></details>}
        {d && session && <details className="rds-sb-provenance"><summary>{t('provenance')}</summary><p>{t('pinned')}</p><ul>{d.sources.map((source, i) => <li key={i}>{source.name} — {source.attribution} — {source.license}</li>)}</ul><h3>{t('revisions')}</h3><ul>{session.selection.revisions.map(r => <li key={r.partitionId}>{r.partitionId}: {r.revisionId} · {r.sourceDataAt ?? '—'}</li>)}</ul><p>{session.selection.transformationVersion}</p>{d.limitations.length > 0 && <><h3>{t('limitations')}</h3><ul>{d.limitations.map((limitation, i) => <li key={i}>{localize(limitation, locale)}</li>)}</ul></>}</details>}
      </section>

      <aside className="rds-sb-panel rds-sb-config" aria-labelledby={`${uid}-config`}>
        <h2 id={`${uid}-config`}>{t('configuration')}</h2>
        {session && d && v && metric && <>
          <details className="rds-sb-config-section" open><summary>{t('fields')}</summary><Bindings descriptor={d} value={v} onChange={update} locale={locale} t={t} disabled={working} /></details>
          <details className="rds-sb-config-section" open><summary>{t('aggregation')}</summary>{metric.aggregations.length === 1 ? <div className="rds-sb-readonly"><span>{t('aggregationFunction')}</span><output>{t(v.metric.aggregation)}</output></div> : <label>{t('aggregationFunction')}<select disabled={working} value={v.metric.aggregation} onChange={e => update({ metric: { ...v.metric, aggregation: e.target.value as typeof v.metric.aggregation } })}>{metric.aggregations.map(aggregation => <option key={aggregation} value={aggregation}>{t(aggregation)}</option>)}</select></label>}
            {d.capabilities.runningSum && metric.supportsRunningSum && v.metric.aggregation === 'sum' && dimensions.find(f => f.id === v.x)?.ordered && <><label className="rds-sb-check"><input type="checkbox" disabled={working} checked={v.runningSum} onChange={e => update({ runningSum: e.target.checked })} />{t('runningSum')}</label><p className="rds-sb-muted">{t('cumulativeHelp')}</p></>}
          </details>
          {d.capabilities.comparisonDimensions.length > 0 && <details className="rds-sb-config-section" open><summary>{t('comparisonSection')}</summary>
            {primaryField && d.capabilities.comparisonDimensions.includes(primaryField.id) ? <><label className="rds-sb-check"><input type="checkbox" disabled={working || scopeOptions.length < 2} checked={comparisonEnabled} onChange={e => toggleComparison(e.target.checked)} />{t('compareSelections')}</label>
              {comparisonEnabled && <label>{t('comparisonSelection')}<select disabled={working} value={JSON.stringify(primaryValues[1])} onChange={e => changeScope(e.target.value, true)}>{scopeOptions.filter(item => item.value !== primaryValues[0]).map(item => <option key={JSON.stringify(item.value)} value={JSON.stringify(item.value)}>{fieldValueLabel(primaryField, item.value, locale, item.label)}</option>)}</select></label>}
              {primaryValues.length > 2 && <p className="rds-sb-muted">{t('selected')}: {primaryValues.map(value => fieldValueLabel(primaryField, value, locale)).join(', ')}</p>}
              {scopeOptions.length < 2 && !scopes.loading && <p className="rds-sb-muted">{t('needComparisonData')}</p>}
              <p className="rds-sb-muted">{t('comparisonHint')}</p>
            </> : <label>{t('comparison')}<select disabled={working || Boolean(v.comparison && metric.requiredDimensions?.includes(v.comparison))} value={v.comparison ?? ''} onChange={e => update({ comparison: e.target.value || null, ...(d.capabilities.maxDimensions < 3 ? { series: null } : {}) })}><option value="">{t('none')}</option>{dimensions.filter(f => d.capabilities.comparisonDimensions.includes(f.id) && f.id !== v.x && f.id !== v.series && metric.groupableBy.includes(f.id)).map(f => <option key={f.id} value={f.id}>{localize(f.label, locale)}</option>)}</select></label>}
          </details>}
          <details className="rds-sb-config-section"><summary>{t('metricDetails')}</summary><p className="rds-sb-muted">{localize(metric.description, locale)}</p>{Boolean(metric.requiredDimensions?.length) && <p className="rds-sb-muted">{t('requiredGrouping')}: {metric.requiredDimensions!.map(key => localize(d.fields.find(f => f.id === key)!.label, locale)).join(', ')}</p>}<p className="rds-sb-muted">{t('availableCharts')}: {d.capabilities.charts.filter(kind => kind === 'table' || ChartRenderer).map(kind => t(kind)).join(' · ')}</p><p className="rds-sb-muted">{t('missing')}</p></details>
        </>}
      </aside>
    </div>
  </section>;
}

function ResultTable({ descriptor, result, page, setPage, locale, t, uid }: { descriptor: DatasetDescriptor; result: QueryResult; page: number; setPage: (page: number) => void; locale: string; t: Translate; uid: string }) {
  const format = useMemo(() => createValueFormatter(locale), [locale]);
  const auxiliary = new Set(result.columns.flatMap(column => descriptor.fields.find(f => f.id === column.id)?.labelField ?? []));
  const columns = result.columns.filter(column => !auxiliary.has(column.id));
  const pageSize = 50;
  const pages = Math.max(1, Math.ceil(result.rows.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  return <section className="rds-sb-table-section" aria-labelledby={`${uid}-table`}>
    <h3 id={`${uid}-table`} className="rds-sb-sr">{t('table')} · {result.rows.length} {t('rows')}</h3>
    {result.rows.length === 0 ? <p>{t('noRows')}</p> : <><div className="rds-sb-table-scroll" role="region" aria-label={t('table')} tabIndex={0}><table><caption className="rds-sb-sr">{t('preview')} {safePage + 1}/{pages}</caption><thead><tr>{columns.map(column => <th key={column.id} scope="col">{localize(column.label, locale)}{column.unit ? ` (${column.unit})` : ''}</th>)}</tr></thead><tbody>{result.rows.slice(safePage * pageSize, (safePage + 1) * pageSize).map(row => <tr key={row.id}>{columns.map(column => {
      const field = descriptor.fields.find(f => f.id === column.id);
      const label = field?.labelField ? row.values[field.labelField] : undefined;
      return <td key={column.id}>{typeof label === 'string' && label.trim() ? label : field ? fieldValueLabel(field, row.values[column.id]!, locale) : format(row.values[column.id]!, column.type)}</td>;
    })}</tr>)}</tbody></table></div>
      {pages > 1 && <nav className="rds-sb-pagination" aria-label={t('preview')}><button type="button" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>{t('previous')}</button><span aria-live="polite">{safePage + 1}/{pages}</span><button type="button" disabled={safePage + 1 >= pages} onClick={() => setPage(safePage + 1)}>{t('next')}</button></nav>}</>}
  </section>;
}
