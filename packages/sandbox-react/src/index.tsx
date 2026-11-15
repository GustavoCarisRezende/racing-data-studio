import { Component, Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { assertAnalysisList, assertCatalog, assertDataset, assertResult, assertSelection, assertVisualization, eventUnificationAvailable, parseAnalysisDocument, parseSavedModelDocument } from '@rds/sandbox-contracts';
import type { AnalysisDocument, AnalysisStore, AnalysisSummary, DatasetDescriptor, DatasetSummary, Filter, ImageExportArtifact, ModelDocument, QueryRequest, QueryResult, ResolvedSelection, SandboxDataProvider, SandboxHostServices, Scalar, SelectionRequest, TableConfiguration, VisualizationSpec } from '@rds/sandbox-contracts';
import { availableDimensions, buildChartModel, buildQuery, chartAvailable, compatibleScatterMetrics, createValueFormatter, defaultVisualization, editableKey, exportTableResult, fieldValueLabel, forPie, localize, logicalColumns, makeModel, makeModelV3, tableRows, visualizationDimensions, withCalculationProfile, withRequiredDimensions } from '@rds/sandbox-core';
import type { ChartModel } from '@rds/sandbox-core';
import { FilterEditor } from './filters.js';
import { QuickFilters, useFacetOptions } from './quick-filters.js';
import { Bindings } from './bindings.js';
import { TableColumns } from './table-columns.js';
import { TableSummary } from './table-summary.js';
import { PieOptions } from './pie-options.js';
import { ModelManager } from './model-manager.js';
import { Icon } from './icons.js';
import { translator } from './messages.js';
import type { MessageKey, Translate } from './messages.js';
export { translator } from './messages.js';
export type { MessageKey, Translate } from './messages.js';

export interface ChartRendererProps { model: ChartModel; locale: string; onVisibleModelChange?: (model: ChartModel) => void; legendSelection?: { fieldId: string; options: { value: Exclude<Scalar, null>; label: string }[]; selected: Exclude<Scalar, null>[]; disabled: boolean; onToggle: (value: Exclude<Scalar, null>) => void } }
export interface SandboxProps {
  provider: SandboxDataProvider;
  store?: AnalysisStore;
  host?: SandboxHostServices;
  locale?: string;
  messages?: Partial<Record<MessageKey, string>>;
  ChartRenderer?: ComponentType<ChartRendererProps>;
  chartExporter?: (model: ChartModel, options: { format: ImageExportArtifact['format']; showLegend: boolean; showLabels: boolean }, signal?: AbortSignal) => Promise<ImageExportArtifact>;
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
  if (code === 'EXPORT_CANCELLED') return t('exportCancelled');
  if (code === 'EXPORT_TOO_LARGE') return t('exportTooLarge');
  if (code.startsWith('EXPORT_') || code === 'INVALID_EXPORT') return t('exportFailed');
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
function Modal({ label, onClose, children, alert = false }: { label: string; onClose: () => void; children: ReactNode; alert?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)')?.focus();
    return () => { previous?.focus(); };
  }, []);
  return <div className="rds-sb-modal-backdrop"><div ref={ref} className="rds-sb-confirm" role={alert ? 'alertdialog' : 'dialog'} aria-modal="true" aria-label={label} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    if (event.key === 'Tab') {
      const elements = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')];
      const index = elements.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); elements.at(-1)?.focus(); }
      else if (!event.shiftKey && index === elements.length - 1) { event.preventDefault(); elements[0]?.focus(); }
    }
  }}>{children}</div></div>;
}

/** All I/O is injected. No global state, localStorage, source fetches, or native APIs. */
export function Sandbox({ provider, store, host, locale: requestedLocale = 'en-US', messages, ChartRenderer, chartExporter, selection = DEFAULT_SELECTION }: SandboxProps) {
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
  const [saveDialog, setSaveDialog] = useState(false);
  const [modelsDialog, setModelsDialog] = useState(false);
  const [exportDialog, setExportDialog] = useState(false);
  const visibleChart = useRef<{ source: ChartModel; visible: ChartModel } | null>(null);
  const [saveAsNew, setSaveAsNew] = useState(true);
  const [saveName, setSaveName] = useState('');
  const [saveFilters, setSaveFilters] = useState(true);
  const [saveDataSelection, setSaveDataSelection] = useState(true);
  const confirmationRef = useRef(confirmation); confirmationRef.current = confirmation;
  const [storeRevision, setStoreRevision] = useState(0);
  const [working, setWorking] = useState(false);
  const [editing, setEditing] = useState(true);
  const [imageFormat, setImageFormat] = useState<ImageExportArtifact['format']>('svg');
  const [imageLegend, setImageLegend] = useState(true);
  const [imageLabels, setImageLabels] = useState(true);
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
      const ok = await new Promise<boolean>(resolve => setConfirmation({ kind, title, resolve }));
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
    const prior = sessionRef.current;
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
        ...(model ? model.saveDataSelection === false && prior?.descriptor.id === descriptor.id ? { policy: 'latest' as const, partitionIds: prior.partitionIds } : model.binding : document ? { policy: 'pinned', partitionIds: document.selection.revisions.map(r => r.partitionId), revisions: document.selection.revisions } as const : selection) }, controller.signal);
      assertSelection(resolved);
      if (resolved.datasetId !== descriptor.id || (document && !sameRevisions(document.selection, resolved))) throw new Error('Pinned revision/transform unavailable');
      if (model?.saveDataSelection !== false && model?.binding.partitionIds.length && (resolved.revisions.length !== model.binding.partitionIds.length || !model.binding.partitionIds.every(id => resolved.revisions.some(r => r.partitionId === id)))) throw new Error('Latest partition scope mismatch');
      let visualization = model?.visualization ?? document?.visualization ?? descriptor.presentation?.defaultVisualization ?? defaultVisualization(descriptor);
      if (!model && !document && visualization && descriptor.capabilities.eventUnification && visualization.unifyEvents === undefined) visualization = { ...visualization, unifyEvents: true };
      if (!document && !model && visualization) visualization = withRequiredDimensions(descriptor, visualization);
      if (!document && !model && !descriptor.presentation?.defaultVisualization && visualization && ChartRenderer && chartAvailable('line', descriptor, visualization)) visualization = { ...visualization, kind: 'line' };
      if (!document && !model && visualization && !ChartRenderer) visualization = { ...visualization, kind: 'table' };
      if (!controller.signal.aborted) {
        if (!visualization) { setError(tRef.current('noFields')); return; }
        let filters = model?.filters ?? document?.filters ?? descriptor.presentation?.defaultFilters ?? [];
        if (model) {
          const selectionField = descriptor.capabilities.multiSelection?.fieldId ?? descriptor.presentation?.primaryFilterFieldId;
          const currentFilters = prior?.descriptor.id === descriptor.id ? prior.filters : descriptor.presentation?.defaultFilters ?? [];
          filters = [...filters.filter(f => f.fieldId === selectionField ? model.saveDataSelection !== false : model.saveFilters !== false),
            ...currentFilters.filter(f => f.fieldId === selectionField ? model.saveDataSelection === false : model.saveFilters === false)];
        }
        const nextTitle = model?.title ?? document?.title ?? localize(descriptor.presentation?.views?.[0]?.label ?? descriptor.label, locale);
        setSession({ descriptor, selection: resolved, visualization, filters, saved: document, model, partitionIds: model?.saveDataSelection === false && prior?.descriptor.id === descriptor.id ? prior.partitionIds : model?.binding.partitionIds ?? (document ? document.selection.revisions.map(r => r.partitionId) : selection.partitionIds) });
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
  const legacySave = v && !session?.model && ['line', 'bar', 'table'].includes(v.kind) && !v.secondaryMetric && !v.table && !v.cumulativeScope && !v.pie && !requiresV3;
  const primaryField = d?.fields.find(f => f.id === d.presentation?.primaryFilterFieldId);
  const scopes = useFacetOptions(provider, d, session?.selection, primaryField, [], Boolean(primaryField));
  const primaryFilter = session?.filters.find(f => f.fieldId === primaryField?.id);
  const primaryValues = primaryFilter?.op === 'in' ? primaryFilter.values : [];
  const scopeOptions = scopes.page?.values ?? [];
  const comparisonEnabled = primaryValues.length > 1;
  const legendField = d?.presentation?.filters?.map(item => d.fields.find(field => field.id === item.fieldId)).find(field => field && v && visualizationDimensions(v).includes(field.id) && (v.kind === 'pie' || field.id !== v.x) && field.filters.includes('in'));
  const legendFacets = useFacetOptions(provider, d, session?.selection, legendField, session?.filters ?? [], Boolean(legendField));
  useEffect(() => {
    if (legendFacets.page?.nextCursor && legendFacets.page.values.length < 1000 && !legendFacets.loading && !legendFacets.error) legendFacets.more();
  }, [legendFacets.page?.nextCursor, legendFacets.loading, legendFacets.error]);
  const legendFilter = session?.filters.find(f => f.fieldId === legendField?.id);
  const legendValues = legendFilter?.op === 'in' ? legendFilter.values : [];
  const chart = useMemo(() => {
    if (!current || !session || session.visualization.kind === 'table' || !current.result.complete || !current.result.rows.length) return null;
    try { return { model: buildChartModel(session.descriptor, current.query, current.result, session.visualization.kind, locale, title, session.visualization.kind === 'pie' ? session.visualization.pie : undefined) }; }
    catch (e) { const code = e && typeof e === 'object' && 'code' in e ? e.code : ''; return { error: t(code === 'NEGATIVE_PIE' ? 'negativePie' : code === 'EMPTY_PIE' ? 'emptyPie' : code === 'LIMIT_EXCEEDED' ? session.visualization.kind === 'pie' ? 'tooManySlices' : 'chartLimit' : 'invalid') }; }
  }, [current, session, locale, title, t]);

  function update(patch: Partial<VisualizationSpec>, successNotice?: MessageKey) {
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
      next.table = next.table.version === 1 ? { version: 1, columns: columns.length ? columns : ids, ...(next.table.sort && ids.includes(next.table.sort.columnId) ? { sort: next.table.sort } : {}) } : { version: 2, columns: columns.length ? columns : ids, sorts: next.table.sorts.filter(s => ids.includes(s.columnId)), ...(next.table.groupBy && columns.includes(next.table.groupBy) ? { groupBy: next.table.groupBy } : {}) };
    }
    const adjustedChart = !chartAvailable(next.kind, session.descriptor, next);
    if (adjustedChart) next.kind = 'table';
    if (!m.supportsRunningSum || next.metric.aggregation !== 'sum' || !dimensions.find(f => f.id === next.x)?.ordered) next.runningSum = false;
    try { assertVisualization(next, session.descriptor); } catch { setError(t('invalid')); return; }
    const nextView = matchingView(session.descriptor, next, session.filters);
    setActiveView(nextView?.id ?? '');
    if (editableKey(session.descriptor.id, title, next, session.filters) === signature) return;
    setSession({ ...session, visualization: next }); setNotice(successNotice ?? (patch.kind === 'pie' && next.x !== session.visualization.x ? 'pieGrouped' : adjustedChart ? 'chartAdjusted' : ''));
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
  async function restore(model = false, selectedModelId?: string, edit = false) {
    const target = model ? modelStore : store;
    const id = selectedModelId ?? (model ? modelId : savedId);
    if (!target || !id || (dirty && !await confirmAction('discardChanges', title))) return;
    const controller = new AbortController(); operation.current?.abort(); operation.current = controller;
    setWorking(true); setError('');
    try {
      const raw = await target.load(id, controller.signal);
      let value: unknown = raw;
      if (typeof raw === 'string') { if (raw.length > 256_000) throw new Error('Document too large'); value = JSON.parse(raw); }
      if (!value || typeof value !== 'object' || !('id' in value) || value.id !== id || !('datasetId' in value) || typeof value.datasetId !== 'string' || !catalog?.some(item => item.id === value.datasetId)) throw new Error('Unknown analysis/dataset');
      if (!controller.signal.aborted) { setEditing(edit); setLoad({ datasetId: value.datasetId, document: value, model }); }
    } catch (e) { if (!controller.signal.aborted) setError(errorMessage(t, e)); }
    finally { if (operation.current === controller) { setWorking(false); operation.current = null; } }
  }
  async function saveModel(asNew = false, name = title) {
    if (!modelSaveAvailable || !store || !modelStore || !session || !complete || !name.trim()) return;
    if (name.trim().length > 30 && (asNew || name !== session.model?.title)) { setError(t('titleLimit')); return; }
    const controller = new AbortController(); operation.current?.abort(); operation.current = controller;
    const original = session; setWorking(true); setError('');
    try {
      const previous = asNew ? undefined : session.model;
      const saveTitle = previous && name === previous.title ? name : name.trim();
      const selectionField = session.descriptor.capabilities.multiSelection?.fieldId ?? session.descriptor.presentation?.primaryFilterFieldId;
      const storedFilters = session.filters.filter(filter => filter.fieldId === selectionField ? saveDataSelection : saveFilters);
      const partitions = saveDataSelection ? session.partitionIds : [];
      const document = parseSavedModelDocument({ ...(requiresV3 ? makeModelV3(session.descriptor, partitions, session.visualization, storedFilters, saveTitle, previous) : makeModel(session.descriptor, partitions, session.visualization, storedFilters, saveTitle, previous?.documentVersion === 2 ? previous : undefined)), saveFilters, saveDataSelection }, session.descriptor);
      const response = canStoreV3 ? await store.modelsV3!.save(document, document.revision, controller.signal) : document.documentVersion === 2 ? await store.models!.save(document, document.revision, controller.signal) : undefined;
      const saved = parseSavedModelDocument(response, session.descriptor);
      if (saved.revision === null || saved.revision === document.revision || JSON.stringify({ ...saved, revision: document.revision }) !== JSON.stringify(document)) throw new Error('Store changed model content');
      if (!controller.signal.aborted && sessionRef.current === original) { setSession({ ...original, model: saved, saved: undefined }); setBaseline(editableKey(original.descriptor.id, saved.title, original.visualization, original.filters)); setTitle(saved.title); setNotice('modelSaved'); setStoreRevision(n => n + 1); }
    } catch (e) { if (!controller.signal.aborted) setError(errorMessage(t, e)); }
    finally { if (operation.current === controller) { setWorking(false); operation.current = null; } }
  }
  async function deleteModel(id = modelId) {
    const item = modelList.find(m => m.id === id);
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
    try { await host.exportFiles(exportTableResult(session.descriptor, current.query, current.result, title, session.visualization.table, locale).filter(file => file.mediaType.startsWith('text/csv')), controller.signal); }
    catch (e) { if (!controller.signal.aborted) setError(errorMessage(t, e)); }
    finally { if (operation.current === controller) { setWorking(false); operation.current = null; } }
  }
  async function exportImage() {
    if (!host?.exportImage || !chartExporter || !complete || !chart || !('model' in chart) || !chart.model || working) return;
    const controller = new AbortController(); operation.current?.abort(); operation.current = controller; setWorking(true); setError('');
    try { const visible = visibleChart.current; const file = await chartExporter(visible?.source === chart.model ? visible.visible : chart.model, { format: imageFormat, showLegend: imageLegend, showLabels: imageLabels }, controller.signal); if (!controller.signal.aborted) await host.exportImage(file, controller.signal); }
    catch (e) { if (!controller.signal.aborted) setError(e && typeof e === 'object' && 'code' in e ? errorMessage(t, e) : t('imageExportFailed')); }
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
    {confirmation && <Modal alert label={t(confirmation.kind)} onClose={() => { confirmation.resolve(false); setConfirmation(null); }}><h3>{t(confirmation.kind)}</h3><p>{confirmation.title}</p><button type="button" onClick={() => { confirmation.resolve(false); setConfirmation(null); }}>{t('cancel')}</button><button type="button" onClick={() => { confirmation.resolve(true); setConfirmation(null); }}>{t('confirm')}</button></Modal>}
    {saveDialog && <Modal label={t('saveChoice')} onClose={() => setSaveDialog(false)}><h3 id={`${uid}-save`}>{t('saveChoice')}</h3>{session?.model && <label><input type="radio" name={`${uid}-save-mode`} checked={!saveAsNew} onChange={() => setSaveAsNew(false)} />{t('updateSelected')}: {session.model.title}</label>}<label><input type="radio" name={`${uid}-save-mode`} checked={saveAsNew} onChange={() => setSaveAsNew(true)} />{t('newModel')}</label>{saveAsNew && <label>{t('newName')}<input maxLength={30} value={saveName} onChange={e => setSaveName(e.target.value)} /></label>}<label><input type="checkbox" checked={saveFilters} onChange={e => setSaveFilters(e.target.checked)} />{t('saveFiltersOption')}</label><label><input type="checkbox" checked={saveDataSelection} onChange={e => setSaveDataSelection(e.target.checked)} />{t('saveDataSelectionOption')}</label><button type="button" onClick={() => setSaveDialog(false)}>{t('cancel')}</button><button type="button" disabled={saveAsNew && !saveName.trim()} onClick={() => { setSaveDialog(false); void saveModel(saveAsNew, saveAsNew ? saveName : title); }}>{t('confirm')}</button></Modal>}
    {modelsDialog && <Modal label={t('models')} onClose={() => setModelsDialog(false)}><ModelManager t={t} items={[...modelList, ...savedList.map(item => ({ ...item, id: `legacy:${item.id}` }))]} onOpen={id => { setModelsDialog(false); void restore(!id.startsWith('legacy:'), id.startsWith('legacy:') ? id.slice(7) : id, true); }} onEdit={id => { setModelsDialog(false); void restore(!id.startsWith('legacy:'), id.startsWith('legacy:') ? id.slice(7) : id, true); }} onDelete={id => { setModelsDialog(false); void deleteModel(id); }} onRefresh={() => setStoreRevision(n => n + 1)} onRestoreDefaults={host?.restoreDefaultModels ? () => void restoreDefaults() : undefined} onNew={() => { setModelsDialog(false); setEditing(true); if (d) void requestLoad({ datasetId: d.id }); }} onRename={() => { setModelsDialog(false); setEditing(true); setTimeout(() => { titleInput.current?.focus(); titleInput.current?.select(); }, 0); }} disabled={working || loading} loading={modelsLoading} error={modelListError} activeTitle={session?.model?.title} /><button type="button" onClick={() => setModelsDialog(false)}>{t('close')}</button></Modal>}
    {exportDialog && <Modal label={t('export')} onClose={() => setExportDialog(false)}><h3>{t('export')}</h3><label>{t('imageFormat')}<select value={imageFormat} disabled={working} onChange={e => setImageFormat(e.target.value as ImageExportArtifact['format'])}><option value="svg">SVG</option><option value="png">PNG</option></select></label><label><input type="checkbox" checked={imageLegend} onChange={e => setImageLegend(e.target.checked)} />{t('imageLegend')}</label>{v?.kind === 'pie' && <label><input type="checkbox" checked={imageLabels} onChange={e => setImageLabels(e.target.checked)} />{t('imageLabels')}</label>}<button type="button" onClick={() => setExportDialog(false)}>{t('cancel')}</button><button type="button" onClick={() => { setExportDialog(false); void exportImage(); }}>{t('export')}</button></Modal>}
    <div className={`rds-sb-layout${editing ? '' : ' rds-sb-view-layout'}`} inert={Boolean(confirmation || saveDialog || modelsDialog || exportDialog)}>
      <aside className="rds-sb-panel rds-sb-data" aria-label={t('filters')}>
        {catalog === null ? <p role="status">{t('loading')}</p> : catalog.length === 0 ? <p>{t('empty')}</p> : catalog.length > 1 ? <label>{t('dataset')}<select disabled={working || loading} value={load?.datasetId ?? ''} onChange={e => void requestLoad({ datasetId: e.target.value })}>{catalog.map(item => <option key={item.id} value={item.id}>{localize(item.label, locale)}</option>)}</select></label> : null}
        {primaryField && provider.facet && !d?.capabilities.multiSelection && <div className="rds-sb-scope" inert={!editing}><label>{localize(primaryField.label, locale)}<select disabled={working || !editing || scopes.loading || !scopeOptions.length} value={primaryValues.length ? JSON.stringify(primaryValues[0]) : ''} onChange={e => changeScope(e.target.value)}>{!primaryValues.length && <option value="">{t(primaryFilter ? 'advancedFilters' : 'all')}</option>}{primaryValues.length > 0 && !scopeOptions.some(item => item.value === primaryValues[0]) && <option value={JSON.stringify(primaryValues[0])}>{fieldValueLabel(primaryField, primaryValues[0]!, locale)}</option>}{scopeOptions.map(item => <option key={JSON.stringify(item.value)} value={JSON.stringify(item.value)}>{fieldValueLabel(primaryField, item.value, locale, item.label)}</option>)}</select></label>{scopes.page?.nextCursor && <button type="button" disabled={scopes.loading || scopeOptions.length >= 1000} onClick={scopes.more}>{t('more')}</button>}{scopes.error && <p role="alert">{t('error')}</p>}</div>}
        {store && <button type="button" onClick={() => setModelsDialog(true)}>{t('models')}</button>}
        {session && <section id={`${uid}-filters`} className="rds-sb-filter-section" aria-labelledby={`${uid}-filters-heading`} inert={!editing}>
          <div className="rds-sb-section-heading"><h3 id={`${uid}-filters-heading`}>{t('filters')}</h3>{session.filters.length > 0 && <button className="rds-sb-text-button" type="button" disabled={working} onClick={clearUserFilters}>{t('clear')}</button>}</div>
          <QuickFilters descriptor={session.descriptor} selection={session.selection} provider={provider} filters={session.filters} onChange={applyFilters} locale={locale} t={t} expanded={expandedFilter} onExpand={setExpandedFilter} disabled={working} />
          {profile && <div className="rds-sb-filter-routing" role="note"><p>{t('displayFilters')}: {profile.displayFilterFields.map(id => localize(d!.fields.find(f => f.id === id)!.label, locale)).join(', ')}</p><p>{t('populationFilters')}: {session.filters.filter(f => !profile.displayFilterFields.includes(f.fieldId)).map(filter => localize(d!.fields.find(f => f.id === filter.fieldId)!.label, locale)).join(', ') || t('none')}</p></div>}
          <details className="rds-sb-advanced" open={advancedOpen} onToggle={e => setAdvancedOpen(e.currentTarget.open)}><summary>{t('advancedFilters')}</summary>{advancedOpen && <FilterEditor key={session.descriptor.id} descriptor={session.descriptor} selection={session.selection} provider={provider} filters={session.filters} onChange={applyFilters} locale={locale} t={t} />}</details>
        </section>}
      </aside>

      <section className="rds-sb-panel rds-sb-result" aria-labelledby={`${uid}-result`}>
        <h2 id={`${uid}-result`}>{t('builder')}</h2>
        <div className="rds-sb-mode" role="group" aria-label={t('configuration')}><button type="button" aria-pressed={!editing} onClick={() => setEditing(false)}>{t('viewMode')}</button><button type="button" aria-pressed={editing} onClick={() => setEditing(true)}>{t('editMode')}</button></div>
        <div className="rds-sb-toolbar">
          <div className="rds-sb-chart-types" role="group" aria-label={t('visualizationType')}>{session && d && v && (['line', 'bar', 'table', 'pie', 'scatter'] as const).filter(kind => d.capabilities.charts.includes(kind) && (kind === 'table' || ChartRenderer)).map(kind => <button key={kind} type="button" disabled={!editing || working || (kind === 'line' ? !dimensions.some(f => f.ordered && d.metrics.find(m => m.id === v.metric.metricId)!.groupableBy.includes(f.id)) : !chartAvailable(kind, d, v))} aria-pressed={v.kind === kind} onClick={() => update({ kind })}><Icon name={kind} />{t(kind)}</button>)}</div>
          <div className="rds-sb-actions">{modelsAvailable && <button type="button" disabled={!editing || !modelSaveAvailable || !complete || !title.trim() || working} onClick={() => { setSaveAsNew(!session?.model); setSaveName(title); setSaveFilters(session?.model?.saveFilters ?? true); setSaveDataSelection(session?.model?.saveDataSelection ?? true); setSaveDialog(true); }}><Icon name="save" />{t('saveModel')}</button>}
          {v?.kind === 'table' ? host?.exportFiles && <button type="button" disabled={!complete || working} onClick={() => void exportCsv()}><Icon name="export" />{t('export')}</button> : host?.exportImage && chartExporter && <button type="button" disabled={!complete || working || !chart || !('model' in chart) || !chart.model} onClick={() => setExportDialog(true)}><Icon name="export" />{t('export')}</button>}</div>
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
          <label className="rds-sb-title"><span className="rds-sb-sr">{t('title')}</span><input ref={titleInput} maxLength={Math.max(30, title.length)} value={title} readOnly={!editing} disabled={!session || working} onChange={e => { const next = e.target.value; if (next.length <= 30 || next.length < title.length) { setTitle(next); setNotice(''); } }} /></label>
          {current?.result.rows.length === 0 && v?.kind !== 'table' && <p role="status">{t('noRows')}</p>}
          {chart && 'model' in chart && chart.model && chart.model.series.length > 12 && <p className="rds-sb-muted" role="note">{t('manySeries')}</p>}
          {chart && 'model' in chart && Boolean(chart.model?.omitted) && <p role="status">{t('omitted')}: {chart.model!.omitted}</p>}
          {chart && ('error' in chart ? <p role="alert">{chart.error} {t('refineChart')}</p> : ChartRenderer && chart.model ? <figure className="rds-sb-chart"><ChartBoundary key={`${current?.query.requestId}-${locale}`} fallback={t('error')}><ChartRenderer model={chart.model} locale={locale} onVisibleModelChange={visible => { visibleChart.current = { source: chart.model!, visible }; }} legendSelection={legendField && session && legendFacets.page ? { fieldId: legendField.id, options: legendFacets.page.values.map(item => ({ value: item.value, label: fieldValueLabel(legendField, item.value, locale, item.label) })), selected: legendValues, disabled: !editing || working || querying || loading, onToggle: value => {
            if (!editing || working || querying || loading || !legendFacets.page?.values.some(item => item.value === value)) return;
            const selected = legendFilter?.op === 'in' ? legendFilter.values : [];
            const values = selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value];
            const maximum = session.descriptor.capabilities.multiSelection?.fieldId === legendField.id ? session.descriptor.capabilities.multiSelection.maxValues : 200;
            if (values.length > maximum) { setError(t('selectionLimit')); return; }
            applyFilters([...session.filters.filter(f => f.fieldId !== legendField.id), ...(values.length ? [{ fieldId: legendField.id, op: 'in' as const, values }] : [])]);
          } } : undefined} /></ChartBoundary><figcaption>{t('chartHelp')}</figcaption></figure> : null)}
          {v?.kind === 'table' && current && d && <ResultTable descriptor={d} visualization={v} unifiedEvents={Boolean(current.query.unifyEvents)} result={current.result} configuration={v.table} onConfiguration={table => update({ table })} editable={editing} page={page} setPage={setPage} locale={locale} t={t} uid={`${uid}-main`} />}
          {!current && !error && <div className="rds-sb-chart-placeholder">{loading || querying ? t('loading') : t('chooseDataset')}</div>}
        </div>
        {d && session && <details className="rds-sb-provenance"><summary>{t('provenance')}</summary><p>{t('pinned')}</p><ul>{d.sources.map((source, i) => <li key={i}>{source.name} — {source.attribution} — {source.license}</li>)}</ul><h3>{t('revisions')}</h3><ul>{session.selection.revisions.map(r => <li key={r.partitionId}>{r.partitionId}: {r.revisionId} · {r.sourceDataAt ?? '—'}</li>)}</ul><p>{session.selection.transformationVersion}</p>{d.limitations.length > 0 && <><h3>{t('limitations')}</h3><ul>{d.limitations.map((limitation, i) => <li key={i}>{localize(limitation, locale)}</li>)}</ul></>}</details>}
      </section>

      {editing && <aside className="rds-sb-panel rds-sb-config" aria-labelledby={`${uid}-config`}>
        <h2 id={`${uid}-config`}>{t('configuration')}</h2>
        {session && d && v && metric && <>
          <details className="rds-sb-config-section" open><summary>{t('fields')}</summary><Bindings descriptor={d} value={v} onChange={update} onProfileChange={chooseCalculation} locale={locale} t={t} disabled={working} />{profile && <p className="rds-sb-muted">{localize(profile.description, locale)}</p>}</details>
          {v.kind === 'table' && <TableSummary descriptor={d} value={v} onApply={next => update(next, 'summaryApplied')} locale={locale} t={t} disabled={working} />}
          {v.kind === 'pie' && <PieOptions value={v.pie} onChange={pie => update({ pie })} disabled={working} t={t} />}
          {v.kind === 'table' && <TableColumns descriptor={d} value={v} onChange={table => update({ table })} locale={locale} t={t} disabled={working} />}
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
          {d.capabilities.eventUnification && <details className="rds-sb-config-section"><summary>{t('chartBehavior')}</summary><label className="rds-sb-check"><input type="checkbox" disabled={working || !eventUnificationAvailable(d, session.filters)} checked={Boolean(v.unifyEvents)} onChange={e => update({ unifyEvents: e.target.checked })} />{t('unifyEvents')}</label></details>}
        </>}
      </aside>}
    </div>
  </section>;
}

function ResultTable({ descriptor, visualization, unifiedEvents, result, configuration, onConfiguration, editable, page, setPage, locale, t, uid }: { descriptor: DatasetDescriptor; visualization?: VisualizationSpec; unifiedEvents: boolean; result: QueryResult; configuration?: TableConfiguration; onConfiguration: (table: TableConfiguration) => void; editable: boolean; page: number; setPage: (page: number) => void; locale: string; t: Translate; uid: string }) {
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
  const sorts = configuration?.version === 2 ? configuration.sorts : configuration?.sort ? [configuration.sort] : [];
  const groupBy = configuration?.version === 2 ? configuration.groupBy : undefined;
  const visibleRows = rows.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const groupColumn = columns.find(c => c.id === groupBy);
  const cellValue = (row: QueryResult['rows'][number], column: QueryResult['columns'][number]) => {
    if (unifiedEvents && column.id === descriptor.capabilities.eventUnification?.fieldId) return t('unifiedEvents');
    const field = descriptor.fields.find(f => f.id === column.id);
    const label = field?.labelField ? row.values[field.labelField] : undefined;
    return typeof label === 'string' && label.trim() ? label : field ? fieldValueLabel(field, row.values[column.id]!, locale) : format(row.values[column.id]!, column.type);
  };
  const groupLabels = new Map<string, Set<string>>();
  if (groupColumn) for (const row of rows) {
    const key = JSON.stringify(row.values[groupColumn.id]);
    const labels = groupLabels.get(key) ?? new Set<string>();
    labels.add(cellValue(row, groupColumn)); groupLabels.set(key, labels);
  }
  const toggleSort = (columnId: string) => {
    const index = sorts.findIndex(s => s.columnId === columnId);
    const next = [...sorts];
    if (index < 0) next.push({ columnId, direction: 'asc' });
    else if (next[index]!.direction === 'asc') next[index] = { columnId, direction: 'desc' };
    else next.splice(index, 1);
    const ids = columns.map(c => c.id);
    onConfiguration(configuration?.version === 2 || next.length > 1 ? { version: 2, columns: ids, sorts: next, ...(groupBy ? { groupBy } : {}) } : { version: 1, columns: ids, ...(next[0] ? { sort: next[0] } : {}) });
  };
  return <section className="rds-sb-table-section" aria-labelledby={`${uid}-table`}>
    <h3 id={`${uid}-table`} className="rds-sb-sr">{t('table')} · {result.rows.length} {t('rows')}</h3>
    {!result.complete && <p role="note">{t('incomplete')}</p>}
    {result.rows.length === 0 ? <p>{t('noRows')}</p> : <><div className="rds-sb-table-scroll" role="region" aria-label={t('table')} tabIndex={0}><table><caption className="rds-sb-sr">{t('preview')} {safePage + 1}/{pages}</caption><thead><tr>{columns.map(column => {
      const priority = sorts.findIndex(s => s.columnId === column.id);
      const effectiveSort = groupBy ?? sorts[0]?.columnId;
      const effectiveDirection = groupBy ? sorts.find(s => s.columnId === groupBy)?.direction ?? 'asc' : sorts[0]?.direction;
      return <th key={column.id} scope="col" aria-sort={effectiveSort === column.id ? effectiveDirection === 'asc' ? 'ascending' : 'descending' : undefined}><button type="button" disabled={!editable} onClick={() => toggleSort(column.id)}>{columnLabel(column)}{column.unit ? ` (${column.unit})` : ''}{priority >= 0 && <span> · {t('sortPriority')} {priority + 1} ({t(sorts[priority]!.direction)})</span>}</button></th>;
    })}</tr></thead><tbody>{visibleRows.map((row, index) => <Fragment key={row.id}>
      {groupColumn && (index === 0 || row.values[groupColumn.id] !== visibleRows[index - 1]!.values[groupColumn.id]) && <tr className="rds-sb-group-row"><th scope="row" colSpan={columns.length}>{columnLabel(groupColumn)}: {groupLabels.get(JSON.stringify(row.values[groupColumn.id]))!.size === 1 ? cellValue(row, groupColumn) : format(row.values[groupColumn.id]!, groupColumn.type)}</th></tr>}
      <tr>{columns.map(column => <td key={column.id}>{cellValue(row, column)}</td>)}</tr>
    </Fragment>)}</tbody></table></div>
      {pages > 1 && <nav className="rds-sb-pagination" aria-label={t('preview')}><button type="button" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>{t('previous')}</button><span aria-live="polite">{safePage + 1}/{pages}</span><button type="button" disabled={safePage + 1 >= pages} onClick={() => setPage(safePage + 1)}>{t('next')}</button></nav>}</>}
  </section>;
}
