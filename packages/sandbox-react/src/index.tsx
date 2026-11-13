import { Component, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { assertAnalysisList, assertCatalog, assertDataset, assertResult, assertSelection, assertVisualization, parseAnalysisDocument, parseSavedModelDocument } from '@rds/sandbox-contracts';
import type { AnalysisDocument, AnalysisStore, AnalysisSummary, DatasetDescriptor, DatasetSummary, Filter, ModelDocument, QueryRequest, QueryResult, ResolvedSelection, SandboxDataProvider, SandboxHostServices, SelectionRequest, TableConfiguration, VisualizationSpec } from '@rds/sandbox-contracts';
import { availableDimensions, buildChartModel, buildQuery, chartAvailable, compatibleScatterMetrics, createValueFormatter, defaultVisualization, editableKey, exportResult, fieldValueLabel, forPie, localize, logicalColumns, makeAnalysis, makeModel, makeModelV3, tableRows, visualizationDimensions, withCalculationProfile, withRequiredDimensions } from '@rds/sandbox-core';
import type { ChartModel } from '@rds/sandbox-core';
import { FilterEditor } from './filters.js';
import { QuickFilters, useFacetOptions } from './quick-filters.js';
import { Bindings } from './bindings.js';
import { TableColumns } from './table-columns.js';
import { ModelManager } from './model-manager.js';
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
  model?: ModelDocument;
  partitionIds: string[];
}
interface LoadRequest { datasetId: string; document?: unknown; model?: boolean }
interface ResultState { session: Session; query: QueryRequest; result: QueryResult }
type DatasetView = NonNullable<NonNullable<DatasetDescriptor['presentation']>['views']>[number];
const DEFAULT_SELECTION = { policy: 'latest' as const, partitionIds: [] as string[] };
function matchingView(descriptor: DatasetDescriptor, visualization: VisualizationSpec, filters: Filter[]): DatasetView | undefined {
  return descriptor.presentation?.views?.find(view => view.visualization.series === visualization.series && view.visualization.metric.metricId === visualization.metric.metricId && view.visualization.runningSum === visualization.runningSum && view.visualization.calculation?.profileId === visualization.calculation?.profileId && view.visualization.cumulativeScope === visualization.cumulativeScope && JSON.stringify(view.visualization.extraDimensions ?? []) === JSON.stringify(visualization.extraDimensions ?? []) && view.filters.every(filter => filters.some(item => JSON.stringify(item) === JSON.stringify(filter))));
}
function errorMessage(t: Translate, error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code === 'ORDER_UNAVAILABLE') return t('orderUnavailable');
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
  const canStoreV3 = store?.modelsV3?.documentVersion === 3;
  const modelStore = canStoreV3 ? store.modelsV3 : store?.models?.documentVersion === 2 ? store.models : undefined;
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
  const [modelList, setModelList] = useState<AnalysisSummary[]>([]);
  const [modelId, setModelId] = useState('');
  const [modelListError, setModelListError] = useState('');
  const [modelsLoading, setModelsLoading] = useState(false);
  const [baseline, setBaseline] = useState('');
  const signature = session ? editableKey(session.descriptor.id, title, session.visualization, session.filters) : '';
  const dirty = Boolean(signature && baseline && signature !== baseline);
  const [confirmation, setConfirmation] = useState<{ kind: 'discardChanges' | 'deleteModel'; title: string; resolve: (ok: boolean) => void } | null>(null);
  const confirmationRef = useRef(confirmation); confirmationRef.current = confirmation;
  const [storeRevision, setStoreRevision] = useState(0);
  const [working, setWorking] = useState(false);
  const [page, setPage] = useState(0);
  const [expandedFilter, setExpandedFilter] = useState<string | null>(null);
  const [activeView, setActiveView] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  useEffect(() => { host?.onDirtyChange?.(dirty); }, [dirty, host]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  useEffect(() => () => { confirmationRef.current?.resolve(false); }, []);
  useEffect(() => () => { host?.onDirtyChange?.(false); }, [host]);
  async function confirmAction(kind: 'discardChanges' | 'deleteModel', title: string) {
    const controller = new AbortController(); operation.current?.abort(); operation.current = controller;
    try {
      if (host?.confirm) { const ok = await host.confirm({ kind, title }, controller.signal); return !controller.signal.aborted && ok; }
      const focused = document.activeElement;
      const ok = await new Promise<boolean>(resolve => setConfirmation({ kind, title, resolve }));
      if (focused instanceof HTMLElement) focused.focus();
      return !controller.signal.aborted && ok;
    } catch (e) { if (!controller.signal.aborted) setError(errorMessage(t, e)); return false; }
    finally { if (operation.current === controller) operation.current = null; }
  }
  async function requestLoad(next: LoadRequest) { if (!dirty || await confirmAction('discardChanges', title)) setLoad(next); }

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
      const model = load.document !== undefined && load.model ? parseSavedModelDocument(load.document, descriptor) : undefined;
      if (model && (!descriptor.capabilities.latestSelection || !modelStore || (model.documentVersion === 3 && !canStoreV3))) throw new Error('Latest/model version unavailable');
      const document = load.document === undefined || load.model ? undefined : parseAnalysisDocument(load.document, descriptor);
      const resolved = await provider.resolveSelection({ protocolVersion: 1, datasetId: descriptor.id,
        ...(model ? model.binding : document ? { policy: 'pinned', partitionIds: document.selection.revisions.map(r => r.partitionId), revisions: document.selection.revisions } as const : selection) }, controller.signal);
      assertSelection(resolved);
      if (resolved.datasetId !== descriptor.id || (document && !sameRevisions(document.selection, resolved))) throw new Error('Pinned revision/transform unavailable');
      if (model?.binding.partitionIds.length && (resolved.revisions.length !== model.binding.partitionIds.length || !model.binding.partitionIds.every(id => resolved.revisions.some(r => r.partitionId === id)))) throw new Error('Latest partition scope mismatch');
      let visualization = model?.visualization ?? document?.visualization ?? descriptor.presentation?.defaultVisualization ?? defaultVisualization(descriptor);
      if (!document && !model && visualization) visualization = withRequiredDimensions(descriptor, visualization);
      if (!document && !model && !descriptor.presentation?.defaultVisualization && visualization && ChartRenderer && chartAvailable('line', descriptor, visualization)) visualization = { ...visualization, kind: 'line' };
      if (!document && !model && visualization && !ChartRenderer) visualization = { ...visualization, kind: 'table' };
      if (!controller.signal.aborted) {
        if (!visualization) { setError(tRef.current('noFields')); return; }
        const filters = model?.filters ?? document?.filters ?? descriptor.presentation?.defaultFilters ?? [];
        const nextTitle = model?.title ?? document?.title ?? localize(descriptor.presentation?.views?.[0]?.label ?? descriptor.label, locale);
        setSession({ descriptor, selection: resolved, visualization, filters, saved: document, model, partitionIds: model?.binding.partitionIds ?? (document ? document.selection.revisions.map(r => r.partitionId) : selection.partitionIds) });
        setBaseline(editableKey(descriptor.id, nextTitle, visualization, filters));
        setActiveView(document || model ? matchingView(descriptor, visualization, filters)?.id ?? '' : descriptor.presentation?.views?.[0]?.id ?? descriptor.id);
        setExpandedFilter(null);
        setAdvancedOpen(false);
        setTitle(nextTitle);
        if (model) { setModelId(model.id); setNotice('modelLoaded'); }
        else if (document) setNotice('loaded');
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
      try { query = buildQuery(session.descriptor, session.selection, session.visualization, session.filters, `query-${crypto.randomUUID()}`, { legacyPinned: Boolean(session.saved && !session.model) }); }
      catch { setError(tRef.current('invalid')); setQuerying(false); return; }
      void provider.query(query, controller.signal).then(response => {
        assertResult(response, query, session.descriptor);
        if (!controller.signal.aborted) setResult({ session, query, result: response });
      }).catch(e => { if (!controller.signal.aborted) { const field = e && typeof e === 'object' && 'fieldId' in e ? session.descriptor.fields.find(f => f.id === e.fieldId) : undefined; setError(field ? `${tRef.current('incompatibleFilter')}: ${localize(field.label, locale)}. ${tRef.current('removeFilterHelp')}` : errorMessage(tRef.current, e)); } })
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
    const controller = new AbortController(); setModelList([]); setModelId(''); setModelListError(''); setModelsLoading(Boolean(modelStore));
    if (modelStore) void modelStore.list(controller.signal).then(items => {
      assertAnalysisList(items); if (!controller.signal.aborted) { setModelList(items); setModelId(items.find(m => m.id === sessionRef.current?.model?.id)?.id ?? ''); }
    }).catch(e => { if (!controller.signal.aborted) setModelListError(errorMessage(tRef.current, e)); })
      .finally(() => { if (!controller.signal.aborted) setModelsLoading(false); });
    return () => controller.abort();
  }, [store, storeRevision]);
  useEffect(() => {
    setWorking(false);
    confirmationRef.current?.resolve(false); setConfirmation(null);
    return () => { operation.current?.abort(); operation.current = null; };
  }, [provider, store, host]);

  const current = result?.session === session ? result : null;
  const complete = current?.result.complete === true;
  const d = session?.descriptor;
  const v = session?.visualization;
  const dimensions = d ? availableDimensions(d) : [];
  const metric = d?.metrics.find(m => m.id === v?.metric.metricId);
  const modelsAvailable = Boolean(modelStore && d?.capabilities.latestSelection);
  const requiresV3 = Boolean(v && (v.calculation || v.extraDimensions !== undefined || session?.model?.documentVersion === 3));
  const modelSaveAvailable = modelsAvailable && (!requiresV3 || canStoreV3);
  const profile = d?.capabilities.runningSumProfiles?.find(p => p.id === v?.calculation?.profileId);
  const legacySave = v && !session?.model && ['line', 'bar', 'table'].includes(v.kind) && !v.secondaryMetric && !v.table && !v.cumulativeScope && !requiresV3;
  const primaryField = d?.fields.find(f => f.id === d.presentation?.primaryFilterFieldId);
  const scopes = useFacetOptions(provider, d, session?.selection, primaryField, [], Boolean(primaryField));
  const primaryFilter = session?.filters.find(f => f.fieldId === primaryField?.id);
  const primaryValues = primaryFilter?.op === 'in' ? primaryFilter.values : [];
  const scopeOptions = scopes.page?.values ?? [];
  const comparisonEnabled = primaryValues.length > 1;
  const chart = useMemo(() => {
    if (!current || !session || session.visualization.kind === 'table' || !current.result.complete || !current.result.rows.length) return null;
    try { return { model: buildChartModel(session.descriptor, current.query, current.result, session.visualization.kind, locale, title) }; }
    catch (e) { const code = e && typeof e === 'object' && 'code' in e ? e.code : ''; return { error: t(code === 'NEGATIVE_PIE' ? 'negativePie' : code === 'EMPTY_PIE' ? 'emptyPie' : code === 'LIMIT_EXCEEDED' ? session.visualization.kind === 'pie' ? 'tooManySlices' : 'chartLimit' : 'invalid') }; }
  }, [current, session, locale, title, t]);

  function update(patch: Partial<VisualizationSpec>) {
    if (!session) return;
    if (patch.kind === session.visualization.kind && Object.keys(patch).length === 1) return;
    let next = { ...session.visualization, ...patch };
    if (patch.kind === 'pie') { try { next = forPie(session.descriptor, next); } catch { setError(t('invalid')); return; } }
    if (patch.kind === 'line' && !dimensions.find(f => f.id === next.x)?.ordered) {
      const previousAxis = next.x;
      const defaultAxis = session.descriptor.presentation?.defaultVisualization?.x;
      const ordered = dimensions.find(f => f.id === defaultAxis && f.ordered && session.descriptor.metrics.find(m => m.id === next.metric.metricId)!.groupableBy.includes(f.id)) ?? dimensions.find(f => f.ordered && f.id !== session.descriptor.capabilities.multiSelection?.fieldId && session.descriptor.metrics.find(m => m.id === next.metric.metricId)!.groupableBy.includes(f.id));
      if (!ordered) { setError(t('invalid')); return; }
      next.x = ordered.id; if (next.series === null && previousAxis !== next.comparison) next.series = previousAxis;
    }
    if (patch.runningSum === false || (patch.kind && ['pie', 'scatter'].includes(patch.kind))) delete next.calculation;
    const m = session.descriptor.metrics.find(item => item.id === next.metric.metricId)!;
    if (patch.metric) {
      if (!m.groupableBy.includes(next.x)) next = { ...next, x: dimensions.find(f => m.groupableBy.includes(f.id))?.id ?? next.x };
      if (next.series && !m.groupableBy.includes(next.series)) next.series = null;
      if (next.comparison && !m.groupableBy.includes(next.comparison)) next.comparison = null;
    }
    if (next.series === next.x) next.series = null;
    if (next.comparison === next.x || next.comparison === next.series) next.comparison = null;
    if (next.extraDimensions) next.extraDimensions = next.extraDimensions.filter(id => ![next.x, next.series, next.comparison].includes(id));
    const constrained = withRequiredDimensions(session.descriptor, next);
    if (!constrained) { setError(t('invalid')); return; }
    next = constrained;
    if (next.kind === 'scatter') {
      const candidates = compatibleScatterMetrics(session.descriptor, next);
      const second = candidates.find(m => m.id === next.secondaryMetric?.metricId) ?? candidates[0];
      if (!second) { setError(t('invalid')); return; }
      next.secondaryMetric = { metricId: second.id, aggregation: second.aggregations.includes(next.secondaryMetric?.aggregation as never) ? next.secondaryMetric!.aggregation : second.defaultAggregation };
    } else delete next.secondaryMetric;
    if (['pie', 'scatter'].includes(next.kind)) next.runningSum = false;
    if (next.table) {
      const ids = [...visualizationDimensions(next), next.metric.metricId, ...(next.secondaryMetric ? [next.secondaryMetric.metricId] : [])];
      const columns = next.table.columns.filter(id => ids.includes(id));
      next.table = { version: 1, columns: columns.length ? columns : ids, ...(next.table.sort && ids.includes(next.table.sort.columnId) ? { sort: next.table.sort } : {}) };
    }
    const adjustedChart = !chartAvailable(next.kind, session.descriptor, next);
    if (adjustedChart) next.kind = 'table';
    if (!m.supportsRunningSum || next.metric.aggregation !== 'sum' || !dimensions.find(f => f.id === next.x)?.ordered) next.runningSum = false;
    try { assertVisualization(next, session.descriptor); } catch { setError(t('invalid')); return; }
    const nextView = matchingView(session.descriptor, next, session.filters);
    setActiveView(nextView?.id ?? '');
    if (editableKey(session.descriptor.id, title, next, session.filters) === signature) return;
    setSession({ ...session, visualization: next }); setNotice(patch.kind === 'pie' && next.x !== session.visualization.x ? 'pieGrouped' : adjustedChart ? 'chartAdjusted' : '');
  }
  function chooseCalculation(profileId: string) {
    if (!session) return;
    if (!profileId) { update({ calculation: undefined, extraDimensions: undefined, runningSum: false }); return; }
    try { const visualization = withCalculationProfile(session.descriptor, session.visualization, profileId); setSession({ ...session, visualization }); setActiveView(''); setNotice(''); }
    catch { setError(t('invalid')); }
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
  async function selectView(view: DatasetView) {
    if (!session) return;
    if (dirty && !await confirmAction('discardChanges', title)) return;
    const previous = session.descriptor.presentation?.views?.find(item => item.id === activeView);
    const replaced = new Set([...(previous?.filters ?? []).map(f => f.fieldId), ...view.filters.map(f => f.fieldId)]);
    const visualization = withRequiredDimensions(session.descriptor, ChartRenderer ? view.visualization : { ...view.visualization, kind: 'table' });
    if (!visualization) { setError(t('invalid')); return; }
    const filters = [...session.filters.filter(f => !replaced.has(f.fieldId)), ...view.filters];
    const nextTitle = localize(view.label, locale);
    setSession({ ...session, visualization, filters, model: undefined, saved: undefined });
    setBaseline(editableKey(session.descriptor.id, nextTitle, visualization, filters));
    setTitle(nextTitle); setActiveView(view.id); setNotice('');
  }
  function applyFilters(filters: Filter[]) {
    if (!session) return;
    const multi = session.descriptor.capabilities.multiSelection;
    const selection = filters.find(f => f.fieldId === multi?.fieldId);
    if (selection?.op === 'in' && selection.values.length > multi!.maxValues) { setError(t('selectionLimit')); return; }
    const visualization = multi ? withRequiredDimensions(session.descriptor, session.visualization) : session.visualization;
    if (!visualization) { setError(t('invalid')); return; }
    const nextView = matchingView(session.descriptor, session.visualization, filters);
    setActiveView(nextView?.id ?? '');
    if (editableKey(session.descriptor.id, title, visualization, filters) === signature) return;
    setSession({ ...session, visualization, filters }); setNotice('');
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
      if (!controller.signal.aborted && sessionRef.current === original) { setSession({ ...original, saved }); setTitle(saved.title); setBaseline(editableKey(original.descriptor.id, saved.title, original.visualization, original.filters)); setNotice('saved'); setStoreRevision(n => n + 1); }
    } catch (e) { if (!controller.signal.aborted) setError(errorMessage(t, e)); }
    finally { if (operation.current === controller) { setWorking(false); operation.current = null; } }
  }
  async function restore(model = false) {
    const target = model ? modelStore : store;
    const id = model ? modelId : savedId;
    if (!target || !id || (dirty && !await confirmAction('discardChanges', title))) return;
    const controller = new AbortController(); operation.current?.abort(); operation.current = controller;
    setWorking(true); setError('');
    try {
      const raw = await target.load(id, controller.signal);
      let value: unknown = raw;
      if (typeof raw === 'string') { if (raw.length > 256_000) throw new Error('Document too large'); value = JSON.parse(raw); }
      if (!value || typeof value !== 'object' || !('id' in value) || value.id !== id || !('datasetId' in value) || typeof value.datasetId !== 'string' || !catalog?.some(item => item.id === value.datasetId)) throw new Error('Unknown analysis/dataset');
      if (!controller.signal.aborted) setLoad({ datasetId: value.datasetId, document: value, model });
    } catch (e) { if (!controller.signal.aborted) setError(errorMessage(t, e)); }
    finally { if (operation.current === controller) { setWorking(false); operation.current = null; } }
  }
  async function saveModel(asNew = false) {
    if (!modelSaveAvailable || !store || !modelStore || !session || !complete || !title.trim()) return;
    const controller = new AbortController(); operation.current?.abort(); operation.current = controller;
    const original = session; setWorking(true); setError('');
    try {
      const previous = asNew ? undefined : session.model;
      const document = requiresV3 ? makeModelV3(session.descriptor, session.partitionIds, session.visualization, session.filters, title.trim(), previous) : makeModel(session.descriptor, session.partitionIds, session.visualization, session.filters, title.trim(), previous?.documentVersion === 2 ? previous : undefined);
      const response = canStoreV3 ? await store.modelsV3!.save(document, document.revision, controller.signal) : document.documentVersion === 2 ? await store.models!.save(document, document.revision, controller.signal) : undefined;
      const saved = parseSavedModelDocument(response, session.descriptor);
      if (saved.revision === null || saved.revision === document.revision || JSON.stringify({ ...saved, revision: document.revision }) !== JSON.stringify(document)) throw new Error('Store changed model content');
      if (!controller.signal.aborted && sessionRef.current === original) { setSession({ ...original, model: saved, saved: undefined }); setBaseline(editableKey(original.descriptor.id, saved.title, original.visualization, original.filters)); setTitle(saved.title); setNotice('modelSaved'); setStoreRevision(n => n + 1); }
    } catch (e) { if (!controller.signal.aborted) setError(errorMessage(t, e)); }
    finally { if (operation.current === controller) { setWorking(false); operation.current = null; } }
  }
  async function deleteModel() {
    const item = modelList.find(m => m.id === modelId);
    if (!modelStore || !item || !await confirmAction('deleteModel', item.title)) return;
    const controller = new AbortController(); operation.current?.abort(); operation.current = controller; setWorking(true); setError('');
    try {
      await modelStore.delete({ id: item.id, expectedRevision: item.revision }, controller.signal);
      if (!controller.signal.aborted) { if (sessionRef.current?.model?.id === item.id) { setSession({ ...sessionRef.current, model: undefined }); setBaseline('deleted'); } setNotice('modelDeleted'); setStoreRevision(n => n + 1); }
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
  async function restoreDefaults() {
    if (!host?.restoreDefaultModels || working) return;
    const controller = new AbortController(); operation.current?.abort(); operation.current = controller; setWorking(true); setError('');
    try { await host.restoreDefaultModels(controller.signal); if (!controller.signal.aborted) { setStoreRevision(n => n + 1); setNotice('defaultsRestored'); } }
    catch (e) { if (!controller.signal.aborted) setError(errorMessage(t, e)); }
    finally { if (operation.current === controller) { setWorking(false); operation.current = null; } }
  }

  return <section className="rds-sandbox" aria-label={t('sandbox')} aria-busy={loading || querying || working} lang={locale}>
    {confirmation && <div className="rds-sb-confirm" role="alertdialog" aria-modal="true" aria-labelledby={`${uid}-confirm`} onKeyDown={e => { if (e.key === 'Escape') { confirmation.resolve(false); setConfirmation(null); } if (e.key === 'Tab') { const buttons = e.currentTarget.querySelectorAll('button'); e.preventDefault(); (document.activeElement === buttons[0] ? buttons[1] : buttons[0])?.focus(); } }}><h3 id={`${uid}-confirm`}>{t(confirmation.kind)}</h3><p>{confirmation.title}</p><button type="button" autoFocus onClick={() => { confirmation.resolve(false); setConfirmation(null); }}>{t('cancel')}</button><button type="button" onClick={() => { confirmation.resolve(true); setConfirmation(null); }}>{t('confirm')}</button></div>}
    <div className="rds-sb-layout" inert={Boolean(confirmation)}>
      <aside className="rds-sb-panel rds-sb-data" aria-labelledby={`${uid}-datasets`}>
        <h2 id={`${uid}-datasets`}>{t('datasets')}</h2>
        {catalog === null ? <p role="status">{t('loading')}</p> : catalog.length === 0 ? <p>{t('empty')}</p> : catalog.length > 1 ? <label>{t('dataset')}<select disabled={working || loading} value={load?.datasetId ?? ''} onChange={e => void requestLoad({ datasetId: e.target.value })}>{catalog.map(item => <option key={item.id} value={item.id}>{localize(item.label, locale)}</option>)}</select></label> : null}
        {primaryField && provider.facet && !d?.capabilities.multiSelection && <div className="rds-sb-scope"><label>{localize(primaryField.label, locale)}<select disabled={working || scopes.loading || !scopeOptions.length} value={primaryValues.length ? JSON.stringify(primaryValues[0]) : ''} onChange={e => changeScope(e.target.value)}>{!primaryValues.length && <option value="">{t(primaryFilter ? 'advancedFilters' : 'all')}</option>}{primaryValues.length > 0 && !scopeOptions.some(item => item.value === primaryValues[0]) && <option value={JSON.stringify(primaryValues[0])}>{fieldValueLabel(primaryField, primaryValues[0]!, locale)}</option>}{scopeOptions.map(item => <option key={JSON.stringify(item.value)} value={JSON.stringify(item.value)}>{fieldValueLabel(primaryField, item.value, locale, item.label)}</option>)}</select></label>{scopes.page?.nextCursor && <button type="button" disabled={scopes.loading || scopeOptions.length >= 1000} onClick={scopes.more}>{t('more')}</button>}{scopes.error && <p role="alert">{t('error')}</p>}</div>}
        {d && session && modelsAvailable && <ModelManager t={t} items={modelList} selected={modelId} onSelect={setModelId} onOpen={() => void restore(true)} onDelete={() => void deleteModel()} onRefresh={() => setStoreRevision(n => n + 1)} onRestoreDefaults={host?.restoreDefaultModels ? () => void restoreDefaults() : undefined} onNew={() => void requestLoad({ datasetId: d.id })} onRename={() => { titleInput.current?.focus(); titleInput.current?.select(); }} onCopy={(session.model || session.saved) && complete && modelSaveAvailable ? () => void saveModel(true) : undefined} disabled={working || loading} loading={modelsLoading} error={modelListError} activeTitle={session.model?.title}
          views={d.presentation?.views?.length ? <nav className="rds-sb-dataset-list" aria-label={t('datasetViews')}>{d.presentation.views.map(view => <button type="button" key={view.id} disabled={working} aria-pressed={activeView === view.id} onClick={() => void selectView(view)}><Icon name="dataset" /><span>{localize(view.label, locale)}</span></button>)}</nav> : undefined}
          legacy={savedList.length > 0 && <details className="rds-sb-legacy"><summary>{t('restore')}</summary><label>{t('restore')}<select disabled={working} value={savedId} onChange={e => setSavedId(e.target.value)}>{savedList.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}</select></label><button type="button" disabled={working || !savedId} onClick={() => void restore()}>{t('open')}</button></details>}
        />}
        {!modelsAvailable && d && Boolean(d.presentation?.views?.length) && <nav className="rds-sb-dataset-list" aria-label={t('datasetViews')}>{d.presentation!.views!.map(view => <button type="button" key={view.id} disabled={working} aria-pressed={activeView === view.id} onClick={() => void selectView(view)}><Icon name="dataset" /><span>{localize(view.label, locale)}</span></button>)}</nav>}
        {session && <section id={`${uid}-filters`} className="rds-sb-filter-section" aria-labelledby={`${uid}-filters-heading`}>
          <div className="rds-sb-section-heading"><h3 id={`${uid}-filters-heading`}>{t('filters')}</h3>{session.filters.length > 0 && <button className="rds-sb-text-button" type="button" disabled={working} onClick={clearUserFilters}>{t('clear')}</button>}</div>
          <QuickFilters descriptor={session.descriptor} selection={session.selection} provider={provider} filters={session.filters} onChange={applyFilters} locale={locale} t={t} expanded={expandedFilter} onExpand={setExpandedFilter} disabled={working} />
          {profile && <div className="rds-sb-filter-routing" role="note"><p>{t('displayFilters')}: {profile.displayFilterFields.map(id => localize(d!.fields.find(f => f.id === id)!.label, locale)).join(', ')}</p><p>{t('populationFilters')}: {session.filters.filter(f => !profile.displayFilterFields.includes(f.fieldId)).map(filter => localize(d!.fields.find(f => f.id === filter.fieldId)!.label, locale)).join(', ') || t('none')}</p></div>}
          <details className="rds-sb-advanced" open={advancedOpen} onToggle={e => setAdvancedOpen(e.currentTarget.open)}><summary>{t('advancedFilters')}</summary>{advancedOpen && <FilterEditor key={session.descriptor.id} descriptor={session.descriptor} selection={session.selection} provider={provider} filters={session.filters} onChange={applyFilters} locale={locale} t={t} />}</details>
        </section>}
        {store && !modelsAvailable && savedList.length > 0 && <div className="rds-sb-saved"><label>{t('restore')}<select disabled={working} value={savedId} onChange={e => setSavedId(e.target.value)}>{savedList.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}</select></label><button type="button" disabled={working || !savedId} onClick={() => void restore()}>{t('open')}</button></div>}
      </aside>

      <section className="rds-sb-panel rds-sb-result" aria-labelledby={`${uid}-result`}>
        <h2 id={`${uid}-result`}>{t('builder')}</h2>
        <div className="rds-sb-toolbar">
          <div className="rds-sb-chart-types" role="group" aria-label={t('visualizationType')}>{session && d && v && (['line', 'bar', 'table', 'pie', 'scatter'] as const).filter(kind => d.capabilities.charts.includes(kind) && (kind === 'table' || ChartRenderer)).map(kind => <button key={kind} type="button" disabled={working || (kind === 'line' ? !dimensions.some(f => f.ordered && d.metrics.find(m => m.id === v.metric.metricId)!.groupableBy.includes(f.id)) : !chartAvailable(kind, d, v))} aria-pressed={v.kind === kind} onClick={() => update({ kind })}><Icon name={kind} />{t(kind)}</button>)}</div>
          <div className="rds-sb-actions">{modelsAvailable && (!session?.saved || !legacySave) ? <button type="button" disabled={!modelSaveAvailable || !complete || !title.trim() || working} onClick={() => void saveModel()}><Icon name="save" />{t('saveModel')}</button> : store && legacySave && <button type="button" disabled={!complete || !title.trim() || working} onClick={() => void save()}><Icon name="save" />{t('save')}</button>}
          {host?.exportFiles && <button type="button" disabled={!complete || working} onClick={() => void exportCsv()}><Icon name="export" />{t('export')}</button>}</div>
        </div>
        <div className="rds-sb-feedback">
        {(loading || querying || working) && <p role="status">{t('loading')}</p>}
        {notice && <p role="status">{t(notice)}</p>}
        {dirty && <p role="status">{t('unsaved')}</p>}
        {requiresV3 && !canStoreV3 ? <p role="status">{t('modelV3Unavailable')}</p> : v && !legacySave && !modelsAvailable && <p role="status">{t('legacySaveUnavailable')}</p>}
        {error && <p role="alert">{error}</p>}
        {current && !complete && <p role="alert">{t('incomplete')}</p>}
        {v && v.kind !== 'table' && !ChartRenderer && <p role="status">{t('rendererMissing')}</p>}
        {current?.result.warnings.map(w => <p key={w.code} role="note">{localize(w.message, locale)}</p>)}
        </div>
        <div className="rds-sb-visualization">
          <label className="rds-sb-title"><span className="rds-sb-sr">{t('title')}</span><input ref={titleInput} maxLength={200} value={title} disabled={!session || working} onChange={e => { setTitle(e.target.value); setNotice(''); }} /></label>
          {current?.result.rows.length === 0 && v?.kind !== 'table' && <p role="status">{t('noRows')}</p>}
          {chart && 'model' in chart && chart.model && chart.model.series.length > 12 && <p className="rds-sb-muted" role="note">{t('manySeries')}</p>}
          {chart && 'model' in chart && Boolean(chart.model?.omitted) && <p role="status">{t('omitted')}: {chart.model!.omitted}</p>}
          {chart && ('error' in chart ? <p role="alert">{chart.error} {t('refineChart')}</p> : ChartRenderer && chart.model ? <figure className="rds-sb-chart"><ChartBoundary key={`${current?.query.requestId}-${locale}`} fallback={t('error')}><ChartRenderer model={chart.model} locale={locale} /></ChartBoundary><figcaption>{t('chartHelp')}</figcaption></figure> : null)}
          {v?.kind === 'table' && current && d && <ResultTable descriptor={d} visualization={v} result={current.result} configuration={v.table} onConfiguration={table => update({ table })} page={page} setPage={setPage} locale={locale} t={t} uid={`${uid}-main`} />}
          {!current && !error && <div className="rds-sb-chart-placeholder">{loading || querying ? t('loading') : t('chooseDataset')}</div>}
        </div>
        {current && d && v?.kind !== 'table' && <details className="rds-sb-preview" open><summary><span>{t('dataPreview')}</span><span>{current.result.rows.length} {t('rows')}</span></summary><ResultTable descriptor={d} visualization={v} result={current.result} configuration={v?.table} onConfiguration={table => update({ table })} page={page} setPage={setPage} locale={locale} t={t} uid={uid} /></details>}
        {d && session && <details className="rds-sb-provenance"><summary>{t('provenance')}</summary><p>{t('pinned')}</p><ul>{d.sources.map((source, i) => <li key={i}>{source.name} — {source.attribution} — {source.license}</li>)}</ul><h3>{t('revisions')}</h3><ul>{session.selection.revisions.map(r => <li key={r.partitionId}>{r.partitionId}: {r.revisionId} · {r.sourceDataAt ?? '—'}</li>)}</ul><p>{session.selection.transformationVersion}</p>{d.limitations.length > 0 && <><h3>{t('limitations')}</h3><ul>{d.limitations.map((limitation, i) => <li key={i}>{localize(limitation, locale)}</li>)}</ul></>}</details>}
      </section>

      <aside className="rds-sb-panel rds-sb-config" aria-labelledby={`${uid}-config`}>
        <h2 id={`${uid}-config`}>{t('configuration')}</h2>
        {session && d && v && metric && <>
          <details className="rds-sb-config-section" open><summary>{t('fields')}</summary><Bindings descriptor={d} value={v} onChange={update} onProfileChange={chooseCalculation} locale={locale} t={t} disabled={working} />{profile && <p className="rds-sb-muted">{localize(profile.description, locale)}</p>}</details>
          <TableColumns descriptor={d} value={v} onChange={table => update({ table })} locale={locale} t={t} disabled={working} />
          <details className="rds-sb-config-section" open><summary>{t('aggregation')}</summary>{metric.aggregations.length === 1 || profile ? <div className="rds-sb-readonly"><span>{t('aggregationFunction')}</span><output>{t(v.metric.aggregation)}</output></div> : <label>{t('aggregationFunction')}<select disabled={working} value={v.metric.aggregation} onChange={e => update({ metric: { ...v.metric, aggregation: e.target.value as typeof v.metric.aggregation } })}>{metric.aggregations.map(aggregation => <option key={aggregation} value={aggregation}>{t(aggregation)}</option>)}</select></label>}
            {!profile && (!d.capabilities.runningSumProfiles?.length || v.runningSum) && v.extraDimensions === undefined && !['pie', 'scatter'].includes(v.kind) && d.capabilities.runningSum && metric.supportsRunningSum && v.metric.aggregation === 'sum' && dimensions.find(f => f.id === v.x)?.ordered && <><label className="rds-sb-check"><input type="checkbox" disabled={working} checked={v.runningSum} onChange={e => update({ runningSum: e.target.checked })} />{t('runningSum')}</label>{d.capabilities.runningSumScopes?.includes('beforeDisplayFilter') && <label>{t('runningSum')}<select disabled={working} value={v.cumulativeScope ?? 'filteredSelection'} onChange={e => update({ cumulativeScope: e.target.value as VisualizationSpec['cumulativeScope'] })}>{(d.capabilities.runningSumScopes ?? ['filteredSelection']).map(scope => <option key={scope} value={scope}>{t(scope)}</option>)}</select></label>}<p className="rds-sb-muted">{t(v.cumulativeScope === 'beforeDisplayFilter' ? 'beforeDisplayHelp' : 'cumulativeHelp')}</p></>}
          </details>
          {!profile && d.capabilities.comparisonDimensions.length > 0 && <details className="rds-sb-config-section" open><summary>{t('comparisonSection')}</summary>
            {primaryField && !d.capabilities.multiSelection && d.capabilities.comparisonDimensions.includes(primaryField.id) ? <><label className="rds-sb-check"><input type="checkbox" disabled={working || scopeOptions.length < 2} checked={comparisonEnabled} onChange={e => toggleComparison(e.target.checked)} />{t('compareSelections')}</label>
              {comparisonEnabled && <label>{t('comparisonSelection')}<select disabled={working} value={JSON.stringify(primaryValues[1])} onChange={e => changeScope(e.target.value, true)}>{scopeOptions.filter(item => item.value !== primaryValues[0]).map(item => <option key={JSON.stringify(item.value)} value={JSON.stringify(item.value)}>{fieldValueLabel(primaryField, item.value, locale, item.label)}</option>)}</select></label>}
              {primaryValues.length > 2 && <p className="rds-sb-muted">{t('selected')}: {primaryValues.map(value => fieldValueLabel(primaryField, value, locale)).join(', ')}</p>}
              {scopeOptions.length < 2 && !scopes.loading && <p className="rds-sb-muted">{t('needComparisonData')}</p>}
              <p className="rds-sb-muted">{t('comparisonHint')}</p>
            </> : <label>{t('comparison')}<select disabled={working || Boolean(v.comparison && (metric.requiredDimensions?.includes(v.comparison) || d.capabilities.multiSelection?.fieldId === v.comparison || d.metrics.find(m => m.id === v.secondaryMetric?.metricId)?.requiredDimensions?.includes(v.comparison)))} value={v.comparison ?? ''} onChange={e => update({ comparison: e.target.value || null, ...(d.capabilities.maxDimensions < 3 ? { series: null } : {}) })}><option value="">{t('none')}</option>{dimensions.filter(f => (d.capabilities.comparisonDimensions.includes(f.id) || d.capabilities.multiSelection?.fieldId === f.id) && f.id !== v.x && f.id !== v.series && metric.groupableBy.includes(f.id) && (!v.secondaryMetric || d.metrics.find(m => m.id === v.secondaryMetric?.metricId)?.groupableBy.includes(f.id))).map(f => <option key={f.id} value={f.id}>{localize(f.label, locale)}</option>)}</select></label>}
          </details>}
          <details className="rds-sb-config-section"><summary>{t('metricDetails')}</summary><p className="rds-sb-muted">{localize(metric.description, locale)}</p>{Boolean(metric.requiredDimensions?.length) && <p className="rds-sb-muted">{t('requiredGrouping')}: {metric.requiredDimensions!.map(key => localize(d.fields.find(f => f.id === key)!.label, locale)).join(', ')}</p>}<p className="rds-sb-muted">{t('availableCharts')}: {d.capabilities.charts.filter(kind => kind === 'table' || ChartRenderer).map(kind => t(kind)).join(' · ')}</p><p className="rds-sb-muted">{t('missing')}</p></details>
        </>}
      </aside>
    </div>
  </section>;
}

function ResultTable({ descriptor, visualization, result, configuration, onConfiguration, page, setPage, locale, t, uid }: { descriptor: DatasetDescriptor; visualization?: VisualizationSpec; result: QueryResult; configuration?: TableConfiguration; onConfiguration: (table: TableConfiguration) => void; page: number; setPage: (page: number) => void; locale: string; t: Translate; uid: string }) {
  const format = useMemo(() => createValueFormatter(locale), [locale]);
  const logical = logicalColumns(descriptor, result);
  const available = result.columns.filter(c => logical.some(column => column.id === c.id) || configuration?.columns.includes(c.id));
  const columns = configuration ? configuration.columns.flatMap(id => available.find(c => c.id === id) ?? []) : available;
  const rows = useMemo(() => tableRows(result, configuration), [result, configuration]);
  const derived = descriptor.capabilities.runningSumProfiles?.find(p => p.id === visualization?.calculation?.profileId);
  const columnLabel = (column: QueryResult['columns'][number]) => localize(derived?.metricId === column.id ? derived.measureLabel ?? derived.label : column.label, locale);
  const pageSize = 50;
  const pages = Math.max(1, Math.ceil(result.rows.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  return <section className="rds-sb-table-section" aria-labelledby={`${uid}-table`}>
    <h3 id={`${uid}-table`} className="rds-sb-sr">{t('table')} · {result.rows.length} {t('rows')}</h3>
    {!result.complete && <p role="note">{t('incomplete')}</p>}
    {result.rows.length === 0 ? <p>{t('noRows')}</p> : <><div className="rds-sb-table-scroll" role="region" aria-label={t('table')} tabIndex={0}><table><caption className="rds-sb-sr">{t('preview')} {safePage + 1}/{pages}</caption><thead><tr>{columns.map(column => <th key={column.id} scope="col" aria-sort={configuration?.sort?.columnId === column.id ? configuration.sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => onConfiguration({ version: 1, columns: columns.map(c => c.id), sort: { columnId: column.id, direction: configuration?.sort?.columnId === column.id && configuration.sort.direction === 'asc' ? 'desc' : 'asc' } })}>{columnLabel(column)}{column.unit ? ` (${column.unit})` : ''}</button></th>)}</tr></thead><tbody>{rows.slice(safePage * pageSize, (safePage + 1) * pageSize).map(row => <tr key={row.id}>{columns.map(column => {
      const field = descriptor.fields.find(f => f.id === column.id);
      const label = field?.labelField ? row.values[field.labelField] : undefined;
      return <td key={column.id}>{typeof label === 'string' && label.trim() ? label : field ? fieldValueLabel(field, row.values[column.id]!, locale) : format(row.values[column.id]!, column.type)}</td>;
    })}</tr>)}</tbody></table></div>
      {pages > 1 && <nav className="rds-sb-pagination" aria-label={t('preview')}><button type="button" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>{t('previous')}</button><span aria-live="polite">{safePage + 1}/{pages}</span><button type="button" disabled={safePage + 1 >= pages} onClick={() => setPage(safePage + 1)}>{t('next')}</button></nav>}</>}
  </section>;
}
