import { assertQuery, assertResult, assertVisualization, compareDecimal, configurationQuery, parseAnalysisDocument, parseModelDocument, parseModelDocumentV3, visualizationDimensions, SandboxError } from '@rds/sandbox-contracts';
import type { AnalysisDocument, ChartKind, DatasetDescriptor, ExportArtifact, FieldDescriptor, Filter, LocalizedText, ModelDocument, QueryRequest, QueryResult, ResolvedSelection, SavedModelDocument, SavedModelDocumentV3, Scalar, TableConfiguration, VisualizationSpec } from '@rds/sandbox-contracts';
export { visualizationDimensions } from '@rds/sandbox-contracts';

export function localize(text: LocalizedText, locale: string): string {
  const translations = text.translations;
  const language = locale.split('-')[0] ?? locale;
  const exact = translations && Object.hasOwn(translations, locale) ? translations[locale] : undefined;
  const generic = translations && Object.hasOwn(translations, language) ? translations[language] : undefined;
  return exact?.trim() ? exact : generic?.trim() ? generic : text.fallback;
}
/** Reuse within a result/page; no unbounded global formatter cache. */
export function createValueFormatter(locale: string): (value: Scalar, type: string) => string {
  const numbers = new Intl.NumberFormat(locale);
  const separator = numbers.formatToParts(1.1).find(p => p.type === 'decimal')?.value ?? '.';
  let dates: Intl.DateTimeFormat | undefined;
  let instants: Intl.DateTimeFormat | undefined;
  return (value, type) => {
  if (value === null) return '—';
  if (type === 'integer') return numbers.format(value as number);
  // Decimal strings are kept exact, including beyond JS's safe numeric range.
  if (type === 'decimal') {
    const [whole, fraction] = String(value).split('.');
    return numbers.format(whole === '-0' ? -0 : BigInt(whole!)) + (fraction ? separator + fraction : '');
  }
  if (type === 'date') { dates ??= new Intl.DateTimeFormat(locale, { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }); return dates.format(new Date(`${value}T00:00:00Z`)); }
  if (type === 'datetime') { instants ??= new Intl.DateTimeFormat(locale, { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' }); return instants.format(new Date(String(value))) + ' UTC'; }
  return String(value);
  };
}
export function formatScalar(value: Scalar, type: string, locale: string): string {
  return createValueFormatter(locale)(value, type);
}
export function fieldValueLabel(field: FieldDescriptor, value: Scalar, locale: string, fallback?: string): string {
  const fixed = field.valueLabels?.find(item => item.value === value);
  return fixed ? localize(fixed.label, locale) : fallback?.trim() ? fallback : formatScalar(value, field.type, locale);
}
export function availableDimensions(d: DatasetDescriptor) {
  return d.fields.filter(f => f.role === 'dimension' && f.availability !== 'unavailable');
}
export function defaultVisualization(d: DatasetDescriptor): VisualizationSpec | null {
  const dimensions = availableDimensions(d);
  for (const metric of d.metrics) {
    if (d.fields.find(f => f.id === metric.fieldId)?.availability === 'unavailable') continue;
    if ((metric.requiredDimensions ?? []).some(key => !dimensions.some(f => f.id === key))) continue;
    const candidates = [...dimensions.filter(f => f.ordered), ...dimensions.filter(f => !f.ordered)].filter(f => metric.groupableBy.includes(f.id));
    for (const x of candidates) {
      const candidate = withRequiredDimensions(d, { kind: 'table', x: x.id, metric: { metricId: metric.id, aggregation: metric.defaultAggregation }, series: null, comparison: null, runningSum: false });
      if (candidate) { try { assertVisualization(candidate, d); return candidate; } catch { /* Try another compatible grain/metric. */ } }
    }
  }
  return null;
}
export function withRequiredDimensions(d: DatasetDescriptor, input: VisualizationSpec): VisualizationSpec | null {
  const v = { ...input };
  const required = [...new Set([...(d.metrics.find(m => m.id === v.metric.metricId)?.requiredDimensions ?? []), ...(v.kind === 'scatter' ? d.metrics.find(m => m.id === v.secondaryMetric?.metricId)?.requiredDimensions ?? [] : []), ...(d.capabilities.multiSelection ? [d.capabilities.multiSelection.fieldId] : [])])];
  for (const key of required) {
    if (visualizationDimensions(v).includes(key)) continue;
    if ((d.capabilities.comparisonDimensions.includes(key) || d.capabilities.multiSelection?.fieldId === key) && (v.comparison === null || !required.includes(v.comparison))) v.comparison = key;
    else if (v.series === null || !required.includes(v.series)) v.series = key;
    else if (d.capabilities.queryVersions?.includes(3) && visualizationDimensions(v).length < d.capabilities.maxDimensions) v.extraDimensions = [...v.extraDimensions ?? [], key];
    else return null;
  }
  while (visualizationDimensions(v).length > d.capabilities.maxDimensions) {
    if (v.extraDimensions?.some(key => !required.includes(key))) v.extraDimensions = v.extraDimensions.filter(key => required.includes(key));
    else if (v.series && !required.includes(v.series)) v.series = null;
    else if (v.comparison && !required.includes(v.comparison)) v.comparison = null;
    else return null;
  }
  return v;
}
export function chartAvailable(kind: ChartKind, d: DatasetDescriptor, v: VisualizationSpec): boolean {
  if (!d.capabilities.charts.includes(kind) || (kind !== 'table' && !d.capabilities.completeGroupedQueries)) return false;
  if (kind === 'scatter') return compatibleScatterMetrics(d, v).length > 0;
  return kind !== 'line' || Boolean(d.fields.find(f => f.id === v.x)?.ordered);
}
/** Only used for an explicit chart-type change, never while opening a saved document. */
export function forPie(d: DatasetDescriptor, input: VisualizationSpec): VisualizationSpec {
  const v = { ...input, kind: 'pie' as const, runningSum: false };
  delete v.calculation; delete v.cumulativeScope; delete v.secondaryMetric;
  if (input.calculation) delete v.extraDimensions;
  const metric = d.metrics.find(m => m.id === v.metric.metricId)!;
  const axis = d.fields.find(f => f.id === v.x);
  if (axis?.ordered) {
    const category = availableDimensions(d).find(f => f.id === v.series && !f.ordered && metric.groupableBy.includes(f.id))
      ?? availableDimensions(d).find(f => !f.ordered && f.id !== v.comparison && f.id !== d.capabilities.multiSelection?.fieldId && metric.groupableBy.includes(f.id));
    if (category && !(metric.requiredDimensions ?? []).includes(v.x)) { v.x = category.id; if (v.series === category.id) v.series = null; }
  }
  if (v.series === v.x) v.series = null;
  if (v.comparison === v.x) v.comparison = null;
  const next = withRequiredDimensions(d, v);
  if (!next) throw new SandboxError('INVALID_QUERY', 'No compatible pie grouping');
  return next;
}
/** Canonical editable content; ignores object insertion order and AND/OR filter order, not table column order. */
export function editableKey(datasetId: string, title: string, visualization: VisualizationSpec, filters: Filter[]): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().filter(key => typeof (value as Record<string, unknown>)[key] !== 'function' && (value as Record<string, unknown>)[key] !== undefined).map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value;
  const compare = (a: string, b: string) => a === b ? 0 : a < b ? -1 : 1;
  const normalized = filters.map(f => f.op === 'in' ? { ...f, values: [...new Map(f.values.map(value => [JSON.stringify(value), value])).values()].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))) } : f).sort((a, b) => compare(a.fieldId, b.fieldId));
  return JSON.stringify(canonical([datasetId, title, visualization, normalized]));
}
export function compatibleScatterMetrics(d: DatasetDescriptor, v: VisualizationSpec) {
  const dimensions = visualizationDimensions(v);
  return d.metrics.filter(m => m.id !== v.metric.metricId && d.fields.find(f => f.id === m.fieldId)?.availability !== 'unavailable' && dimensions.every(key => m.groupableBy.includes(key)) && (m.requiredDimensions ?? []).every(key => dimensions.includes(key)));
}
export function buildQuery(d: DatasetDescriptor, selection: ResolvedSelection, v: VisualizationSpec, filters: Filter[], requestId: string, options: { legacyPinned?: boolean } = {}): QueryRequest {
  assertVisualization(v, d);
  if (!chartAvailable(v.kind, d, v)) throw new SandboxError('INVALID_QUERY', 'Unsupported chart/axis');
  const dimensions = visualizationDimensions(v);
  if (!options.legacyPinned && d.capabilities.multiSelection && !dimensions.includes(d.capabilities.multiSelection.fieldId)) throw new SandboxError('INVALID_QUERY', 'Selection dimension must be preserved');
  const query = configurationQuery(d, selection, v, filters, requestId);
  assertQuery(query, d);
  return query;
}
/** Explicit opt-in, never called while opening an old document. Provider fixes the grain. */
export function withCalculationProfile(d: DatasetDescriptor, v: VisualizationSpec, profileId: string): VisualizationSpec {
  const p = d.capabilities.runningSumProfiles?.find(p => p.id === profileId);
  if (!p) throw new SandboxError('INVALID_QUERY', 'Unavailable calculation profile');
  const comparison = d.capabilities.multiSelection?.fieldId ?? p.partitionBy[0]!;
  const series = p.groupingField ?? p.partitionBy.find(key => key !== comparison) ?? null;
  const next: VisualizationSpec = { ...v, kind: ['pie', 'scatter'].includes(v.kind) ? 'table' : v.kind, x: p.axisFieldId, metric: { metricId: p.metricId, aggregation: 'sum' }, series, comparison: d.capabilities.comparisonDimensions.includes(comparison) || d.capabilities.multiSelection?.fieldId === comparison ? comparison : null,
    runningSum: true, calculation: { version: 3, profileId }, extraDimensions: [] };
  next.extraDimensions = p.dimensions.filter(key => ![next.x, next.series, next.comparison].includes(key));
  delete next.cumulativeScope; delete next.secondaryMetric; delete next.table;
  assertVisualization(next, d); return next;
}
export function makeModelV3(d: DatasetDescriptor, partitionIds: string[], visualization: VisualizationSpec, filters: Filter[], title: string, previous?: ModelDocument): SavedModelDocumentV3 {
  const now = new Date().toISOString();
  return parseModelDocumentV3({ documentVersion: 3, kind: 'model', id: previous?.id ?? `model-${crypto.randomUUID()}`, revision: previous?.revision ?? null, title,
    datasetId: d.id, datasetSchemaVersion: d.schemaVersion, datasetSemanticVersion: d.semanticVersion, binding: { policy: 'latest', partitionIds }, visualization, filters, createdAt: previous?.createdAt ?? now, updatedAt: now }, d);
}
export function makeModel(d: DatasetDescriptor, partitionIds: string[], visualization: VisualizationSpec, filters: Filter[], title: string, previous?: SavedModelDocument): SavedModelDocument {
  const now = new Date().toISOString();
  return parseModelDocument({ documentVersion: 2, kind: 'model', id: previous?.id ?? `model-${crypto.randomUUID()}`, revision: previous?.revision ?? null, title,
    datasetId: d.id, datasetSchemaVersion: d.schemaVersion, datasetSemanticVersion: d.semanticVersion, binding: { policy: 'latest', partitionIds }, visualization, filters, createdAt: previous?.createdAt ?? now, updatedAt: now }, d);
}
export function logicalColumns(d: DatasetDescriptor, r: QueryResult) {
  const auxiliary = new Set(r.columns.flatMap(c => d.fields.find(f => f.id === c.id)?.labelField ?? []));
  return r.columns.filter(c => !auxiliary.has(c.id));
}
/** Stable, exact sorting of the entire returned result BEFORE UI pagination; nulls last. */
export function tableRows(r: QueryResult, table?: TableConfiguration) {
  const sort = table?.sort;
  const column = r.columns.find(c => c.id === sort?.columnId);
  if (!sort || !column) return r.rows;
  return [...r.rows].sort((a, b) => {
    const x = a.values[column.id]!, y = b.values[column.id]!;
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    const cmp = column.type === 'decimal' ? compareDecimal(String(x), String(y)) : column.type === 'datetime' ? Math.sign(Date.parse(String(x)) - Date.parse(String(y))) : x === y ? 0 : x < y ? -1 : 1;
    return sort.direction === 'asc' ? cmp : -cmp;
  });
}
export function makeAnalysis(d: DatasetDescriptor, selection: ResolvedSelection, visualization: VisualizationSpec, filters: Filter[], title: string, previous?: AnalysisDocument): AnalysisDocument {
  const now = new Date().toISOString();
  return parseAnalysisDocument({ documentVersion: 1, id: previous?.id ?? `analysis-${crypto.randomUUID()}`, revision: previous?.revision ?? null,
    title, datasetId: d.id, datasetSchemaVersion: d.schemaVersion, datasetSemanticVersion: d.semanticVersion,
    selection, visualization, filters, createdAt: previous?.createdAt ?? now, updatedAt: now }, d);
}
export interface ChartModel {
  kind: 'line' | 'bar' | 'pie' | 'scatter';
  title: string;
  description: string;
  xLabel: string;
  yLabel: string;
  categories: { key: string; label: string }[];
  series: { id: string; label: string; values: (number | null)[]; points?: { id: string; label: string; value: [number, number] }[] }[];
  slices?: { id: string; label: string; value: number }[];
  omitted?: number;
}
function chartNumber(raw: Scalar): number | null {
  if (typeof raw === 'string' && compareDecimal(raw.startsWith('-') ? raw.slice(1) : raw, String(Number.MAX_SAFE_INTEGER)) > 0) throw new SandboxError('LIMIT_EXCEEDED', 'Metric outside chart numeric range');
  const n = raw === null ? null : Number(raw);
  if (n !== null && (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER || (n === 0 && /[1-9]/.test(String(raw))))) throw new SandboxError('LIMIT_EXCEEDED', 'Metric outside chart numeric range');
  return n;
}
export function buildChartModel(d: DatasetDescriptor, q: QueryRequest, r: QueryResult, kind: Exclude<ChartKind, 'table'>, locale: string, title: string): ChartModel {
  assertQuery(q, d); assertResult(r, q, d);
  if (!r.complete) throw new SandboxError('INCOMPLETE_RESULT', 'Incomplete results cannot be plotted');
  const xId = q.orderBy[0]?.fieldId;
  const x = d.fields.find(f => f.id === xId);
  const metric = d.metrics.find(m => m.id === q.metrics[0]?.metricId);
  if (!x || !metric) throw new SandboxError('INVALID_QUERY', 'Missing chart fields');
  if (!d.capabilities.charts.includes(kind) || (kind === 'line' && !x.ordered)) throw new SandboxError('INVALID_QUERY', 'Unsupported chart axis');
  const groups = q.dimensions.filter(key => key !== xId);
  const categories: ChartModel['categories'] = [];
  const format = createValueFormatter(locale);
  const aggregateLabels = locale.startsWith('pt') ? { sum: 'soma', mean: 'média', min: 'mínimo', max: 'máximo', count: 'contagem', countDistinct: 'contagem distinta' } : { sum: 'sum', mean: 'mean', min: 'minimum', max: 'maximum', count: 'count', countDistinct: 'distinct count' };
  const calculationProfile = q.window?.scope === 'profile' ? d.capabilities.runningSumProfiles?.find(p => p.id === q.window!.profileId) : undefined;
  const categoryIndices = new Map<string, number>();
  const series = new Map<string, { id: string; label: string; cells: Map<string, number | null> }>();
  const displayDimension = (key: string, row: Record<string, Scalar>): string => {
    const field = d.fields.find(f => f.id === key)!;
    const label = field.labelField ? row[field.labelField] : undefined;
    const fixed = field.valueLabels?.find(item => item.value === row[key]);
    return fixed ? localize(fixed.label, locale) : typeof label === 'string' && label.trim() ? label : format(row[key]!, field.type);
  };
  if (kind === 'pie' || kind === 'scatter') {
    if (q.window || (kind === 'scatter' && q.metrics.length !== 2)) throw new SandboxError('INVALID_QUERY', 'Incompatible chart query');
    const measureLabel = (index: number) => { const selection = q.metrics[index]!; const m = d.metrics.find(m => m.id === selection.metricId)!; return `${localize(m.label, locale)}${m.unit ? ` (${m.unit})` : ''} · ${aggregateLabels[selection.aggregation]}`; };
    const model: ChartModel = { kind, title, description: title, xLabel: kind === 'scatter' ? measureLabel(1) : localize(x.label, locale), yLabel: measureLabel(0), categories: [], series: [], omitted: 0 };
    const slices: NonNullable<ChartModel['slices']> = [];
    const scatter = new Map<string, ChartModel['series'][number]>();
    for (const row of r.rows) {
      const y = chartNumber(row.values[metric.id]!);
      const label = q.dimensions.map(key => displayDimension(key, row.values)).join(' · ');
      if (kind === 'pie') {
        if (y !== null && y < 0) throw new SandboxError('NEGATIVE_PIE', 'Pie requires non-negative values; use a table or bar chart');
        if (y === null) { model.omitted!++; continue; }
        slices.push({ id: row.id, label, value: y });
      } else {
        const numericX = chartNumber(row.values[q.metrics[1]!.metricId]!);
        if (numericX === null || y === null) { model.omitted!++; continue; }
        const id = JSON.stringify(groups.map(key => row.values[key]));
        let group = scatter.get(id);
        if (!group) { group = { id, label: groups.length ? groups.map(key => displayDimension(key, row.values)).join(' · ') : localize(metric.label, locale), values: [], points: [] }; scatter.set(id, group); }
        group.points!.push({ id: row.id, label, value: [numericX, y] });
      }
    }
    if (kind === 'pie') {
      if (!slices.some(s => s.value > 0)) throw new SandboxError('EMPTY_PIE', 'Pie requires a positive total');
      if (slices.length > d.capabilities.maxSeries || slices.length > 100) throw new SandboxError('LIMIT_EXCEEDED', 'Too many slices; refine filters');
      model.slices = slices; model.series = slices.map(s => ({ id: s.id, label: s.label, values: [s.value] }));
    } else model.series = [...scatter.values()];
    for (const s of model.series) if (model.series.some(other => other.id !== s.id && other.label === s.label)) {
      const original = s.label;
      for (const duplicate of model.series.filter(other => other.label === original)) duplicate.label = `${duplicate.label} (${duplicate.id})`;
      for (const slice of model.slices?.filter(slice => slice.label === original) ?? []) slice.label = `${slice.label} (${slice.id})`;
    }
    if (model.series.length > d.capabilities.maxSeries || r.rows.length > 20_000) throw new SandboxError('LIMIT_EXCEEDED', 'Too many points/series');
    model.description = `${title}. ${model.xLabel}; ${model.yLabel}. ${locale.startsWith('pt') ? 'Valores ausentes omitidos' : 'Missing values omitted'}: ${model.omitted}.`;
    return model;
  }
  for (const row of r.rows) {
    if (row.values[x.id] === null) throw new SandboxError('INVALID_QUERY', 'Missing X values require table view');
    const categoryKey = JSON.stringify(row.values[x.id]);
    if (!categoryIndices.has(categoryKey)) {
      categoryIndices.set(categoryKey, categories.length);
      categories.push({ key: categoryKey, label: displayDimension(x.id, row.values) });
    }
    const seriesKey = JSON.stringify(groups.map(key => row.values[key]));
    let group = series.get(seriesKey);
    if (!group) {
      group = { id: seriesKey, label: groups.length ? groups.map(key => displayDimension(key, row.values)).join(' · ') : localize(metric.label, locale), cells: new Map() };
      series.set(seriesKey, group);
    }
    if (group.cells.has(categoryKey)) throw new SandboxError('INVALID_CONTRACT', 'Duplicate grouped chart cell');
    const raw = row.values[metric.id];
    const numeric = chartNumber(raw!);
    group.cells.set(categoryKey, numeric);
  }
  if (series.size > d.capabilities.maxSeries || categories.length * series.size > 20_000) throw new SandboxError('LIMIT_EXCEEDED', 'Too many chart cells; refine filters');
  const xLabel = localize(x.label, locale);
  const yLabel = localize(metric.label, locale) + (metric.unit ? ` (${metric.unit})` : '') + ` · ${aggregateLabels[q.metrics[0]!.aggregation]}` + (q.window ? calculationProfile ? ` · ${localize(calculationProfile.measureLabel ?? calculationProfile.label, locale)}` : q.window.scope === 'beforeDisplayFilter' ? locale.startsWith('pt') ? ' · acumulado antes do recorte' : ' · running sum before display crop' : locale.startsWith('pt') ? ' · acumulado filtrado' : ' · filtered running sum' : '');
  return { kind, title, description: `${title}. ${xLabel}; ${yLabel}. ${r.rows.length} ${locale.startsWith('pt') ? 'linhas; valores exatos na tabela' : 'rows; exact values in the table'}.`, xLabel, yLabel, categories,
    series: [...series.values()].map(s => ({ id: s.id, label: [...series.values()].some(other => other.id !== s.id && other.label === s.label) ? `${s.label} (${s.id})` : s.label, values: categories.map(c => s.cells.get(c.key) ?? null) })) };
}

export function exportResult(d: DatasetDescriptor, q: QueryRequest, r: QueryResult, title: string): ExportArtifact[] {
  assertQuery(q, d); assertResult(r, q, d);
  if (!r.complete) throw new SandboxError('INCOMPLETE_RESULT', 'Cannot export a partial preview as complete data');
  const quote = (text: string) => '"' + text.replaceAll('"', '""') + '"';
  const safeText = (value: string) => /^[\s\u0000-\u001f\u007f\uFEFF]*[=+\-@]|^[\t\r\n]/.test(value) ? `'${value}` : value;
  const csv = [r.columns.map(c => quote(safeText(c.label.fallback))).join(','), ...r.rows.map(row => r.columns.map(column => {
    const v = row.values[column.id];
    return quote(v === null ? '' : column.type === 'string' ? safeText(String(v)) : String(v));
  }).join(','))].join('\r\n') + '\r\n';
  const manifest = { format: 'rds-query-export', version: 1, title, exportedAt: new Date().toISOString(), dataset: { id: d.id, schemaVersion: d.schemaVersion, semanticVersion: d.semanticVersion, grain: d.grain },
    sources: d.sources, limitations: d.limitations, metrics: q.metrics.map(m => ({ ...m, definition: d.metrics.find(x => x.id === m.metricId) })), query: q, warnings: r.warnings,
    csv: { encoding: 'UTF-8', delimiter: ',', nullValue: '', formulaProtection: 'Apostrophe prefixed to potentially executable string cells', exactNullsDistinguishable: false }, rowCount: r.rows.length };
  return [{ name: `${d.id}.csv`, mediaType: 'text/csv;charset=utf-8', text: csv }, { name: `${d.id}.manifest.json`, mediaType: 'application/json', text: JSON.stringify(manifest, null, 2) }];
}
