import { assertQuery, assertResult, assertVisualization, parseAnalysisDocument, SandboxError } from '@rds/sandbox-contracts';
import type { AnalysisDocument, ChartKind, DatasetDescriptor, ExportArtifact, FieldDescriptor, Filter, LocalizedText, QueryRequest, QueryResult, ResolvedSelection, Scalar, VisualizationSpec } from '@rds/sandbox-contracts';

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
      if (candidate) return candidate;
    }
  }
  return null;
}
export function withRequiredDimensions(d: DatasetDescriptor, input: VisualizationSpec): VisualizationSpec | null {
  const v = { ...input };
  const required = d.metrics.find(m => m.id === v.metric.metricId)?.requiredDimensions ?? [];
  for (const key of required) {
    if ([v.x, v.series, v.comparison].includes(key)) continue;
    if (d.capabilities.comparisonDimensions.includes(key) && (v.comparison === null || !required.includes(v.comparison))) v.comparison = key;
    else if (v.series === null || !required.includes(v.series)) v.series = key;
    else return null;
  }
  while (1 + Number(v.series !== null) + Number(v.comparison !== null) > d.capabilities.maxDimensions) {
    if (v.series && !required.includes(v.series)) v.series = null;
    else if (v.comparison && !required.includes(v.comparison)) v.comparison = null;
    else return null;
  }
  return v;
}
export function chartAvailable(kind: ChartKind, d: DatasetDescriptor, v: VisualizationSpec): boolean {
  return d.capabilities.charts.includes(kind) && (kind === 'table' || (d.capabilities.completeGroupedQueries && (kind !== 'line' || Boolean(d.fields.find(f => f.id === v.x)?.ordered))));
}
export function buildQuery(d: DatasetDescriptor, selection: ResolvedSelection, v: VisualizationSpec, filters: Filter[], requestId: string): QueryRequest {
  assertVisualization(v, d);
  if (!chartAvailable(v.kind, d, v)) throw new SandboxError('INVALID_QUERY', 'Unsupported chart/axis');
  const dimensions = [v.x, v.series, v.comparison].filter((key): key is string => key !== null);
  const query: QueryRequest = {
    protocolVersion: 1, requestId, datasetId: d.id, schemaVersion: d.schemaVersion, semanticVersion: d.semanticVersion,
    selection, dimensions, metrics: [v.metric], filters,
    orderBy: [{ fieldId: v.x, direction: 'asc' }, ...dimensions.filter(key => key !== v.x).map(fieldId => ({ fieldId, direction: 'asc' as const }))],
    limit: d.capabilities.maxRows,
    ...(v.runningSum ? { window: { kind: 'runningSum', metricId: v.metric.metricId, orderBy: v.x, partitionBy: dimensions.filter(key => key !== v.x), scope: 'filteredSelection' } } : {}),
  };
  assertQuery(query, d);
  return query;
}
export function makeAnalysis(d: DatasetDescriptor, selection: ResolvedSelection, visualization: VisualizationSpec, filters: Filter[], title: string, previous?: AnalysisDocument): AnalysisDocument {
  const now = new Date().toISOString();
  return parseAnalysisDocument({ documentVersion: 1, id: previous?.id ?? `analysis-${crypto.randomUUID()}`, revision: previous?.revision ?? null,
    title, datasetId: d.id, datasetSchemaVersion: d.schemaVersion, datasetSemanticVersion: d.semanticVersion,
    selection, visualization, filters, createdAt: previous?.createdAt ?? now, updatedAt: now }, d);
}
export interface ChartModel {
  kind: 'line' | 'bar';
  title: string;
  description: string;
  xLabel: string;
  yLabel: string;
  categories: { key: string; label: string }[];
  series: { id: string; label: string; values: (number | null)[] }[];
}
export function buildChartModel(d: DatasetDescriptor, q: QueryRequest, r: QueryResult, kind: 'line' | 'bar', locale: string, title: string): ChartModel {
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
  const categoryIndices = new Map<string, number>();
  const series = new Map<string, { id: string; label: string; cells: Map<string, number | null> }>();
  const displayDimension = (key: string, row: Record<string, Scalar>): string => {
    const field = d.fields.find(f => f.id === key)!;
    const label = field.labelField ? row[field.labelField] : undefined;
    const fixed = field.valueLabels?.find(item => item.value === row[key]);
    return fixed ? localize(fixed.label, locale) : typeof label === 'string' && label.trim() ? label : format(row[key]!, field.type);
  };
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
    const numeric = raw === null ? null : Number(raw);
    if (numeric !== null && (!Number.isFinite(numeric) || Math.abs(numeric) > Number.MAX_SAFE_INTEGER || (numeric === 0 && /[1-9]/.test(String(raw))))) throw new SandboxError('LIMIT_EXCEEDED', 'Metric outside chart numeric range');
    group.cells.set(categoryKey, numeric);
  }
  if (series.size > d.capabilities.maxSeries || categories.length * series.size > 20_000) throw new SandboxError('LIMIT_EXCEEDED', 'Too many chart cells; refine filters');
  const xLabel = localize(x.label, locale);
  const aggregateLabels = locale.startsWith('pt') ? { sum: 'soma', mean: 'média', min: 'mínimo', max: 'máximo', count: 'contagem', countDistinct: 'contagem distinta' } : { sum: 'sum', mean: 'mean', min: 'minimum', max: 'maximum', count: 'count', countDistinct: 'distinct count' };
  const yLabel = localize(metric.label, locale) + (metric.unit ? ` (${metric.unit})` : '') + ` · ${aggregateLabels[q.metrics[0]!.aggregation]}` + (q.window ? locale.startsWith('pt') ? ' · acumulado filtrado' : ' · filtered running sum' : '');
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
