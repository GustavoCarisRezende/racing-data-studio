import { SandboxError } from './index.js';
import type { AnalysisDocument, AnalysisSummary, DatasetDescriptor, DatasetSummary, FacetPage, Filter, PhysicalType, QueryRequest, QueryResult, ResolvedSelection, Scalar, VisualizationSpec } from './index.js';

const types = ['string', 'boolean', 'integer', 'decimal', 'date', 'datetime'];
const aggregations = ['sum', 'mean', 'min', 'max', 'count', 'countDistinct'];
const operators = ['in', 'range', 'contains', 'isNull', 'isNotNull'];
const charts = ['table', 'line', 'bar'];
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
function fail(message: string): never { throw new SandboxError('INVALID_CONTRACT', message); }
function check(condition: unknown, message: string): asserts condition { if (!condition) fail(message); }
function object(value: unknown): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected object');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 1000): asserts value is string {
  check(typeof value === 'string' && value.length <= max, 'Invalid text');
}
function id(value: unknown): asserts value is string {
  text(value, 128);
  check(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value) && !forbidden.has(value), 'Invalid identifier');
}
function array(value: unknown, max: number): asserts value is unknown[] {
  check(Array.isArray(value) && value.length <= max, 'Invalid or excessive array');
}
function integer(value: unknown, min: number, max: number): asserts value is number {
  check(typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max, 'Invalid integer');
}
function bool(value: unknown): void { check(typeof value === 'boolean', 'Expected boolean'); }
function oneOf(value: unknown, values: readonly string[]): void { check(typeof value === 'string' && values.includes(value), 'Unsupported value'); }
function localized(value: unknown): void {
  const v = object(value); text(v.fallback, 4000);
  check(v.fallback.trim().length > 0, 'Missing text fallback');
  if (v.translations !== undefined) {
    const translations = object(v.translations);
    check(Object.keys(translations).length <= 30, 'Too many translations');
    for (const [locale, label] of Object.entries(translations)) { text(locale, 40); text(label, 4000); }
  }
}
function ids(value: unknown, max = 100): asserts value is string[] {
  array(value, max); value.forEach(id);
  check(new Set(value).size === value.length, 'Repeated identifier');
}
function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function instant(value: unknown): void {
  text(value, 40);
  check(validInstant(value), 'Invalid timestamp');
}
function validInstant(value: string): boolean {
  return value.length <= 40 && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) && validDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}
export function isScalarOfType(value: unknown, type: PhysicalType): value is Scalar {
  if (value === null) return true;
  switch (type) {
    case 'string': return typeof value === 'string' && value.length <= 4000;
    case 'boolean': return typeof value === 'boolean';
    case 'integer': return typeof value === 'number' && Number.isSafeInteger(value);
    case 'decimal': return typeof value === 'string' && value.length <= 100 && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
    case 'date': return typeof value === 'string' && validDate(value);
    case 'datetime': return typeof value === 'string' && validInstant(value);
  }
}

/** Exact comparison of canonical decimal strings; does not round through Number. */
export function compareDecimal(a: string, b: string): number {
  check(isScalarOfType(a, 'decimal') && isScalarOfType(b, 'decimal'), 'Invalid decimal');
  const scale = Math.max(a.split('.')[1]?.length ?? 0, b.split('.')[1]?.length ?? 0);
  const scaled = (v: string) => {
    const [whole, fraction = ''] = v.replace(/^-/, '').split('.');
    return (v.startsWith('-') ? -1n : 1n) * BigInt(whole! + fraction.padEnd(scale, '0'));
  };
  const x = scaled(a), y = scaled(b);
  return x === y ? 0 : x < y ? -1 : 1;
}

export function assertDataset(value: unknown): asserts value is DatasetDescriptor {
  const d = object(value);
  check(d.protocolVersion === 1, 'Unsupported dataset protocol');
  id(d.id); text(d.schemaVersion, 80); text(d.semanticVersion, 80);
  check(d.schemaVersion.length > 0 && d.semanticVersion.length > 0, 'Missing dataset version');
  localized(d.label); localized(d.description); localized(d.grain);
  array(d.fields, 200); array(d.metrics, 100); array(d.sources, 30); array(d.limitations, 100);
  d.limitations.forEach(localized);
  const fieldIds = new Set<string>();
  for (const raw of d.fields) {
    const f = object(raw); id(f.id); check(!fieldIds.has(f.id), 'Duplicate field'); fieldIds.add(f.id);
    localized(f.label); if (f.description !== undefined) localized(f.description);
    oneOf(f.type, types); oneOf(f.role, ['dimension', 'measure']);
    oneOf(f.analyticalType, ['nominal', 'ordinal', 'quantitative', 'temporal']);
    oneOf(f.availability, ['available', 'partial', 'unavailable']); bool(f.nullable); bool(f.ordered);
    array(f.filters, 5); f.filters.forEach(op => oneOf(op, operators));
    check(new Set(f.filters).size === f.filters.length, 'Duplicate filter operator');
    if (f.unit !== undefined) text(f.unit, 100);
    if (f.labelField !== undefined) id(f.labelField);
    if (f.valueLabels !== undefined) {
      array(f.valueLabels, 200);
      const seen = new Set();
      for (const rawLabel of f.valueLabels) {
        const label = object(rawLabel);
        check(label.value !== null && isScalarOfType(label.value, f.type as PhysicalType), 'Invalid value label');
        const key = JSON.stringify(label.value); check(!seen.has(key), 'Duplicate value label'); seen.add(key);
        localized(label.label);
      }
    }
    if ((f.filters as string[]).includes('contains')) check(f.type === 'string', 'Contains requires string field');
    if ((f.filters as string[]).includes('range')) check(['integer', 'decimal', 'date', 'datetime'].includes(f.type as string), 'Range requires ordered scalar');
  }
  const descriptor = value as DatasetDescriptor;
  for (const f of descriptor.fields) if (f.labelField) check(descriptor.fields.some(x => x.id === f.labelField && x.type === 'string'), 'Unknown label field');
  const metricIds = new Set<string>();
  for (const raw of d.metrics) {
    const m = object(raw); id(m.id); check(!metricIds.has(m.id), 'Duplicate metric'); metricIds.add(m.id);
    check(!fieldIds.has(m.id), 'Metric output ID collides with field ID');
    localized(m.label); localized(m.description); id(m.fieldId); check(fieldIds.has(m.fieldId), 'Unknown metric field');
    const metricField = descriptor.fields.find(f => f.id === m.fieldId)!;
    check(metricField.role === 'measure', 'Metric must reference a measure');
    array(m.aggregations, 6); check(m.aggregations.length > 0, 'Metric needs aggregation');
    m.aggregations.forEach(a => oneOf(a, aggregations));
    check(new Set(m.aggregations).size === m.aggregations.length, 'Duplicate aggregation');
    oneOf(m.defaultAggregation, m.aggregations as string[]);
    if ((m.aggregations as string[]).some(a => !['count', 'countDistinct'].includes(a))) check(['integer', 'decimal'].includes(metricField.type), 'Numeric aggregation requires numeric field');
    ids(m.groupableBy); oneOf(m.nullPolicy, ['ignore', 'propagate']); bool(m.additive); bool(m.supportsRunningSum);
    if (m.requiredDimensions !== undefined) { ids(m.requiredDimensions, 3); check(m.requiredDimensions.every(key => (m.groupableBy as string[]).includes(key)), 'Required dimension must be groupable'); }
    check(!m.supportsRunningSum || (m.additive && (m.aggregations as string[]).includes('sum')), 'Invalid cumulative metric');
    if (m.unit !== undefined) text(m.unit, 100);
    for (const key of m.groupableBy as string[]) check(descriptor.fields.some(f => f.id === key && f.role === 'dimension'), 'Invalid metric dimension');
  }
  const c = object(d.capabilities);
  array(c.charts, 3); c.charts.forEach(x => oneOf(x, charts));
  check(new Set(c.charts).size === c.charts.length, 'Duplicate chart capability');
  check((c.charts as string[]).includes('table'), 'Accessible table is required');
  integer(c.maxDimensions, 1, 10); integer(c.maxRows, 1, 100_000); integer(c.maxSeries, 1, 100);
  ids(c.comparisonDimensions); bool(c.runningSum); bool(c.completeGroupedQueries);
  for (const key of c.comparisonDimensions as string[]) check(descriptor.fields.some(f => f.id === key && f.role === 'dimension'), 'Invalid comparison dimension');
  for (const raw of d.sources) {
    const source = object(raw); text(source.name); text(source.attribution, 4000); text(source.license);
    if (source.url !== undefined) text(source.url, 2000);
  }
  if (d.presentation !== undefined) {
    const p = object(d.presentation);
    if (p.primaryFilterFieldId !== undefined) {
      id(p.primaryFilterFieldId);
      check(descriptor.fields.some(f => f.id === p.primaryFilterFieldId && f.filters.includes('in') && f.role === 'dimension'), 'Invalid primary filter');
    }
    if (p.filters !== undefined) {
      array(p.filters, 20); const seen = new Set();
      for (const raw of p.filters) {
        const f = object(raw); id(f.fieldId); check(!seen.has(f.fieldId) && descriptor.fields.some(field => field.id === f.fieldId && field.filters.includes('in')), 'Invalid quick filter'); seen.add(f.fieldId);
        if (f.label !== undefined) localized(f.label);
      }
    }
    if (p.defaultVisualization !== undefined) assertVisualization(p.defaultVisualization, descriptor);
    if (p.defaultFilters !== undefined) assertFilters(p.defaultFilters, descriptor);
    if (p.views !== undefined) {
      array(p.views, 20); const seen = new Set();
      for (const raw of p.views) {
        const view = object(raw); id(view.id); check(!seen.has(view.id), 'Duplicate view'); seen.add(view.id);
        localized(view.label); assertFilters(view.filters, descriptor); assertVisualization(view.visualization, descriptor);
      }
    }
  }
}

export function assertCatalog(value: unknown): asserts value is DatasetSummary[] {
  array(value, 200); const seen = new Set();
  for (const raw of value) {
    const d = object(raw); id(d.id); check(!seen.has(d.id), 'Repeated dataset'); seen.add(d.id);
    localized(d.label); localized(d.description);
  }
}
export function assertAnalysisList(value: unknown): asserts value is AnalysisSummary[] {
  array(value, 1000); const seen = new Set();
  for (const raw of value) {
    const a = object(raw); id(a.id); check(!seen.has(a.id), 'Repeated analysis'); seen.add(a.id);
    text(a.title, 200); text(a.revision, 200); check(a.title.trim().length > 0 && a.revision.length > 0, 'Invalid analysis summary'); instant(a.updatedAt);
  }
}

export function assertSelection(value: unknown): asserts value is ResolvedSelection {
  const s = object(value); check(s.protocolVersion === 1, 'Unsupported selection protocol'); id(s.datasetId);
  text(s.token, 2000); check(s.token.length > 0, 'Missing selection token'); text(s.transformationVersion, 80);
  check(s.transformationVersion.length > 0, 'Missing transformation version');
  array(s.revisions, 2000);
  const partitions = new Set<string>();
  for (const raw of s.revisions) {
    const r = object(raw); id(r.partitionId); text(r.revisionId, 200);
    check(r.revisionId.length > 0 && !partitions.has(r.partitionId), 'Invalid/duplicate revision'); partitions.add(r.partitionId);
    instant(r.storedAt); if (r.sourceDataAt !== null) instant(r.sourceDataAt);
  }
}

function assertFilters(value: unknown, d: DatasetDescriptor): asserts value is Filter[] {
  array(value, 30);
  const fields = new Set<string>();
  for (const raw of value) {
    const f = object(raw); id(f.fieldId); oneOf(f.op, operators);
    check(!fields.has(f.fieldId), 'One filter per field'); fields.add(f.fieldId);
    const field = d.fields.find(x => x.id === f.fieldId);
    check(field && field.availability !== 'unavailable' && field.filters.includes(f.op as Filter['op']), 'Unsupported filter field/operator');
    if (f.op === 'in') {
      array(f.values, 200); check(f.values.length > 0, 'Empty membership filter');
      for (const v of f.values) check(v !== null && isScalarOfType(v, field.type), 'Invalid membership value');
    } else if (f.op === 'range') {
      check(f.min !== undefined || f.max !== undefined, 'Empty range');
      for (const v of [f.min, f.max]) if (v !== undefined) check(v !== null && isScalarOfType(v, field.type), 'Invalid range bound');
      if (f.min !== undefined && f.max !== undefined) {
        const numeric = field.type === 'integer' || field.type === 'decimal';
        check(field.type === 'decimal' ? compareDecimal(String(f.min), String(f.max)) <= 0 : numeric ? Number(f.min) <= Number(f.max) : field.type === 'datetime' ? Date.parse(String(f.min)) <= Date.parse(String(f.max)) : String(f.min) <= String(f.max), 'Reversed range');
      }
    } else if (f.op === 'contains') { text(f.value, 300); check(f.value.length > 0, 'Empty search'); }
  }
}

export function assertQuery(value: unknown, d: DatasetDescriptor): asserts value is QueryRequest {
  const q = object(value);
  check(q.protocolVersion === 1, 'Unsupported query protocol'); id(q.requestId);
  check(q.datasetId === d.id && q.schemaVersion === d.schemaVersion && q.semanticVersion === d.semanticVersion, 'Dataset version mismatch');
  assertSelection(q.selection); check(q.selection.datasetId === d.id, 'Selection dataset mismatch');
  ids(q.dimensions, d.capabilities.maxDimensions); array(q.metrics, 10); check(q.metrics.length > 0, 'Missing metrics');
  const dimensions = q.dimensions as string[];
  for (const key of dimensions) check(d.fields.some(f => f.id === key && f.role === 'dimension' && f.availability !== 'unavailable'), 'Invalid dimension');
  const metricIds = new Set<string>();
  for (const raw of q.metrics) {
    const m = object(raw); id(m.metricId); check(!metricIds.has(m.metricId), 'Repeated metric'); metricIds.add(m.metricId);
    const metric = d.metrics.find(x => x.id === m.metricId);
    check(metric && metric.aggregations.includes(m.aggregation as never), 'Unsupported metric aggregation');
    check(d.fields.find(f => f.id === metric.fieldId)?.availability !== 'unavailable', 'Unavailable metric');
    check(dimensions.every(key => metric.groupableBy.includes(key)), 'Non-additive/unsupported grouping');
    check((metric.requiredDimensions ?? []).every(key => dimensions.includes(key)), 'Required grouping dimension missing');
  }
  assertFilters(q.filters, d); array(q.orderBy, 10);
  const sortFields = new Set();
  for (const raw of q.orderBy) {
    const order = object(raw); check(dimensions.includes(order.fieldId as string) || metricIds.has(order.fieldId as string), 'Invalid sort field');
    check(!sortFields.has(order.fieldId), 'Duplicate sort field'); sortFields.add(order.fieldId);
    oneOf(order.direction, ['asc', 'desc']);
  }
  integer(q.limit, 1, d.capabilities.maxRows);
  if (q.window !== undefined) {
    const w = object(q.window); check(w.kind === 'runningSum' && w.scope === 'filteredSelection', 'Unsupported window');
    const metric = d.metrics.find(m => m.id === w.metricId);
    check(d.capabilities.runningSum && metric?.additive && metric.supportsRunningSum && metricIds.has(metric.id), 'Unsupported cumulative metric');
    check((q.metrics as QueryRequest['metrics']).find(m => m.metricId === metric.id)?.aggregation === 'sum', 'Cumulative requires sum');
    check(dimensions.includes(w.orderBy as string) && d.fields.some(f => f.id === w.orderBy && f.ordered), 'Cumulative requires ordered axis');
    ids(w.partitionBy, 10);
    const partition = dimensions.filter(key => key !== w.orderBy);
    check(partition.length === w.partitionBy.length && partition.every(key => (w.partitionBy as string[]).includes(key)), 'Cumulative must partition by all series dimensions');
  }
}

export function assertVisualization(value: unknown, d: DatasetDescriptor): asserts value is VisualizationSpec {
  const v = object(value); oneOf(v.kind, d.capabilities.charts); id(v.x);
  check(d.fields.some(f => f.id === v.x && f.role === 'dimension' && f.availability !== 'unavailable'), 'Invalid X field');
  if (v.kind === 'line') check(d.fields.some(f => f.id === v.x && f.ordered), 'Line requires ordered axis');
  const metric = object(v.metric); id(metric.metricId); oneOf(metric.aggregation, aggregations); bool(v.runningSum);
  for (const key of ['series', 'comparison']) if (v[key] !== null) {
    id(v[key]); check(v[key] !== v.x && d.fields.some(f => f.id === v[key] && f.role === 'dimension' && f.availability !== 'unavailable'), 'Invalid grouping');
  }
  check(v.series === null || v.series !== v.comparison, 'Repeated grouping');
  check(v.comparison === null || d.capabilities.comparisonDimensions.includes(v.comparison as string), 'Unsupported comparison');
  if (v.kind !== 'table') check(d.capabilities.completeGroupedQueries, 'Charts require complete queries');
}

/** Accepts JSON text or an unknown transport value; strips unknown properties by projection. */
export function parseAnalysisDocument(input: unknown, d: DatasetDescriptor): AnalysisDocument {
  let value = input;
  if (typeof input === 'string') {
    check(input.length <= 256_000, 'Document exceeds 256000 UTF-16 code units');
    try { value = JSON.parse(input); } catch { fail('Invalid JSON'); }
  }
  const a = object(value);
  if (a.documentVersion !== 1) throw new SandboxError('UNSUPPORTED_VERSION', 'Unsupported analysis document version');
  id(a.id); if (a.revision !== null) { text(a.revision, 200); check(a.revision.length > 0, 'Missing revision'); }
  text(a.title, 200); check(a.title.trim().length > 0, 'Missing analysis title');
  check(a.datasetId === d.id && a.datasetSchemaVersion === d.schemaVersion && a.datasetSemanticVersion === d.semanticVersion, 'Analysis dataset version mismatch');
  assertSelection(a.selection); check(a.selection.datasetId === d.id, 'Analysis selection mismatch');
  assertVisualization(a.visualization, d); assertFilters(a.filters, d); instant(a.createdAt); instant(a.updatedAt);
  const v = a.visualization;
  const dimensions = [v.x, v.series, v.comparison].filter((x): x is string => x !== null);
  assertQuery({ protocolVersion: 1, requestId: 'validate', datasetId: d.id, schemaVersion: d.schemaVersion, semanticVersion: d.semanticVersion,
    selection: a.selection, dimensions, metrics: [v.metric], filters: a.filters, orderBy: [{ fieldId: v.x, direction: 'asc' }],
    ...(v.runningSum ? { window: { kind: 'runningSum', metricId: v.metric.metricId, orderBy: v.x, partitionBy: dimensions.filter(x => x !== v.x), scope: 'filteredSelection' } } : {}),
    limit: d.capabilities.maxRows }, d);
  // Project every nested wire object; never call an untrusted toJSON or persist extras.
  const selection = a.selection;
  const filters = a.filters.map(f => f.op === 'in' ? { fieldId: f.fieldId, op: f.op, values: [...f.values] } : f.op === 'range' ? { fieldId: f.fieldId, op: f.op, ...(f.min !== undefined ? { min: f.min } : {}), ...(f.max !== undefined ? { max: f.max } : {}) } : f.op === 'contains' ? { fieldId: f.fieldId, op: f.op, value: f.value } : { fieldId: f.fieldId, op: f.op });
  const result = { documentVersion: 1, id: a.id, revision: a.revision, title: a.title, datasetId: a.datasetId,
    datasetSchemaVersion: a.datasetSchemaVersion, datasetSemanticVersion: a.datasetSemanticVersion,
    selection: { protocolVersion: 1, datasetId: selection.datasetId, token: selection.token, transformationVersion: selection.transformationVersion, revisions: selection.revisions.map(r => ({ partitionId: r.partitionId, revisionId: r.revisionId, sourceDataAt: r.sourceDataAt, storedAt: r.storedAt })) },
    visualization: { kind: v.kind, x: v.x, metric: { metricId: v.metric.metricId, aggregation: v.metric.aggregation }, series: v.series, comparison: v.comparison, runningSum: v.runningSum },
    filters, createdAt: a.createdAt, updatedAt: a.updatedAt };
  let serialized: string;
  try { serialized = JSON.stringify(result); } catch { fail('Document is not JSON'); }
  check(serialized.length <= 256_000, 'Document exceeds 256000 UTF-16 code units');
  return JSON.parse(serialized) as AnalysisDocument;
}

export function assertResult(value: unknown, q: QueryRequest, d: DatasetDescriptor): asserts value is QueryResult {
  const r = object(value); check(r.protocolVersion === 1 && r.requestId === q.requestId && r.selectionToken === q.selection.token, 'Stale or mismatched result');
  array(r.columns, 210); array(r.rows, q.limit); bool(r.complete); array(r.warnings, 100);
  check(r.rows.length * r.columns.length <= 500_000, 'Result exceeds cell budget; refine query');
  if (r.totalRows !== null) integer(r.totalRows, 0, Number.MAX_SAFE_INTEGER);
  check(r.totalRows === null || (r.complete ? r.totalRows === r.rows.length : r.totalRows >= r.rows.length), 'Inconsistent row total');
  const columns = new Map<string, PhysicalType>();
  const allowed = new Set([...q.dimensions, ...q.dimensions.flatMap(key => d.fields.find(f => f.id === key)?.labelField ?? []), ...q.metrics.map(m => m.metricId)]);
  for (const raw of r.columns) {
    const c = object(raw); id(c.id); check(!columns.has(c.id), 'Duplicate result column');
    check(allowed.has(c.id), 'Unexpected result column');
    oneOf(c.type, types); localized(c.label); if (c.unit !== undefined) text(c.unit, 100);
    columns.set(c.id, c.type as PhysicalType);
  }
  for (const key of q.dimensions) check(columns.get(key) === d.fields.find(f => f.id === key)?.type, 'Missing or mistyped dimension');
  for (const metric of q.metrics) {
    const type = columns.get(metric.metricId);
    const definition = d.metrics.find(m => m.id === metric.metricId)!;
    const physical = d.fields.find(f => f.id === definition.fieldId)!.type;
    const expected = metric.aggregation === 'count' || metric.aggregation === 'countDistinct' ? 'integer' : metric.aggregation === 'mean' ? 'decimal' : physical;
    check(type === expected, 'Incorrect metric result type');
  }
  const rowIds = new Set<string>();
  const groupedKeys = new Set<string>();
  const fieldsById = new Map(d.fields.map(f => [f.id, f]));
  for (const raw of r.rows) {
    const row = object(raw); text(row.id, 500); check(!rowIds.has(row.id), 'Duplicate row identity'); rowIds.add(row.id);
    const values = object(row.values); check(Object.keys(values).length === columns.size, 'Unexpected result fields');
    for (const [key, type] of columns) {
      check(Object.hasOwn(values, key) && isScalarOfType(values[key], type), 'Invalid result value');
      const field = fieldsById.get(key);
      if (field) check(field.type === type && (field.nullable || values[key] !== null), 'Incorrect dimension nullability/type');
    }
    const group = JSON.stringify(q.dimensions.map(key => values[key]));
    check(!groupedKeys.has(group), 'Duplicate grouped result'); groupedKeys.add(group);
  }
  for (const raw of r.warnings) { const w = object(raw); id(w.code); localized(w.message); }
}

export function assertFacetPage(value: unknown, fieldType: PhysicalType, maxValues = 200): asserts value is FacetPage {
  const p = object(value); array(p.values, Math.min(200, maxValues));
  const seen = new Set<string>();
  for (const raw of p.values) {
    const v = object(raw); check(v.value !== null && isScalarOfType(v.value, fieldType), 'Invalid facet value'); text(v.label, 4000);
    const key = JSON.stringify(v.value); check(!seen.has(key), 'Repeated facet value'); seen.add(key);
    if (v.count !== undefined) integer(v.count, 0, Number.MAX_SAFE_INTEGER);
  }
  if (p.nextCursor !== undefined) text(p.nextCursor, 2000);
}
