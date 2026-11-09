/** Executable non-production reference adapter. Data is supplied, never fetched. */
import { assertDataset, assertQuery, assertSelection, parseAnalysisDocument, SandboxError } from '@rds/sandbox-contracts';

const clone = value => structuredClone(value);
const abort = signal => { if (signal?.aborted) throw new SandboxError('ABORTED', 'Aborted'); };
// Exact decimal arithmetic for THIS fixture's two-decimal kilogram measurements.
// A production provider must implement its own declared precision/domain rules.
function cents(value) {
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(value)) throw new Error('Fixture expects at most 2 decimal places');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  return (negative ? -1n : 1n) * (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')));
}
function decimal(value) {
  const abs = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}
function compare(a, b) { return a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1; }
function matches(row, filters, descriptor) {
  return filters.every(f => {
    const value = row[f.fieldId];
    if (f.op === 'isNull') return value === null;
    if (f.op === 'isNotNull') return value !== null;
    if (value === null) return false;
    if (f.op === 'in') return f.values.includes(value);
    if (f.op === 'contains') return String(value).toLowerCase().includes(f.value.toLowerCase());
    const field = descriptor.fields.find(x => x.id === f.fieldId);
    const v = field.type === 'decimal' ? cents(value) : value;
    return (f.min === undefined || v >= (field.type === 'decimal' ? cents(f.min) : f.min)) && (f.max === undefined || v <= (field.type === 'decimal' ? cents(f.max) : f.max));
  });
}
export function createMemoryProvider(descriptor, inputRows) {
  assertDataset(descriptor);
  const d = clone(descriptor), rows = clone(inputRows);
  const partitions = [...new Set(rows.map(row => row.campaign))];
  const revision = partitionId => ({ partitionId, revisionId: 'fixture-1', sourceDataAt: '2026-01-01T00:00:00Z', storedAt: '2026-01-02T00:00:00Z' });
  function selected(selection) {
    assertSelection(selection);
    if (selection.datasetId !== d.id || selection.transformationVersion !== 'orchard-fixture-1' || selection.token !== JSON.stringify(selection.revisions.map(r => r.partitionId))) throw new SandboxError('REVISION_MISSING', 'Unknown selection');
    for (const r of selection.revisions) if (!partitions.includes(r.partitionId) || JSON.stringify(r) !== JSON.stringify(revision(r.partitionId))) throw new SandboxError('REVISION_MISSING', 'Unknown revision');
    return rows.filter(row => selection.revisions.some(r => r.partitionId === row.campaign));
  }
  return {
    async listDatasets(signal) { abort(signal); return [clone({ id: d.id, label: d.label, description: d.description })]; },
    async describeDataset({ datasetId }, signal) { abort(signal); if (datasetId !== d.id) throw new Error('Unknown dataset'); return clone(d); },
    async resolveSelection(request, signal) {
      abort(signal);
      if (request.datasetId !== d.id || request.protocolVersion !== 1) throw new Error('Unknown dataset/protocol');
      const keys = request.partitionIds.length ? request.partitionIds : partitions;
      const revisions = request.policy === 'pinned' ? clone(request.revisions ?? []) : keys.map(revision);
      const selection = { protocolVersion: 1, datasetId: d.id, token: JSON.stringify(revisions.map(r => r.partitionId)), revisions, transformationVersion: 'orchard-fixture-1' };
      selected(selection); return selection;
    },
    async query(q, signal) {
      abort(signal); assertQuery(q, d);
      const groups = new Map();
      for (const row of selected(q.selection).filter(row => matches(row, q.filters, d))) {
        const key = JSON.stringify(q.dimensions.map(field => row[field]));
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
      }
      const output = [...groups.entries()].map(([key, group]) => {
        const values = Object.fromEntries(q.dimensions.map(field => [field, group[0][field]]));
        for (const field of q.dimensions) {
          const labelField = d.fields.find(f => f.id === field)?.labelField;
          if (labelField && !Object.hasOwn(values, labelField)) values[labelField] = group[0][labelField];
        }
        for (const metric of q.metrics) {
          const definition = d.metrics.find(m => m.id === metric.metricId);
          const raw = group.map(row => row[definition.fieldId]);
          if (definition.nullPolicy === 'propagate' && raw.includes(null)) values[metric.metricId] = null;
          else {
            const valid = raw.filter(v => v !== null).map(cents);
            values[metric.metricId] = valid.length === 0 ? null : decimal(metric.aggregation === 'sum' ? valid.reduce((a, b) => a + b, 0n) : valid.reduce((a, b) => a > b ? a : b));
          }
        }
        return { id: key, values };
      });
      output.sort((a, b) => {
        for (const order of q.orderBy) { const diff = compare(a.values[order.fieldId], b.values[order.fieldId]); if (diff) return order.direction === 'asc' ? diff : -diff; }
        return 0;
      });
      if (q.window) {
        const totals = new Map();
        const lastIndex = new Map();
        const axis = [...new Set(output.map(row => row.values[q.window.orderBy]))].sort(compare);
        for (const row of output) {
          const key = JSON.stringify(q.window.partitionBy.map(field => row.values[field]));
          const previous = totals.get(key) ?? 0n;
          const raw = row.values[q.window.metricId];
          const index = axis.indexOf(row.values[q.window.orderBy]);
          const missingObservation = index > (lastIndex.get(key) ?? -1) + 1;
          const next = (totals.has(key) && totals.get(key) === null) || raw === null || missingObservation ? null : previous + cents(raw);
          lastIndex.set(key, index);
          totals.set(key, next); row.values[q.window.metricId] = next === null ? null : decimal(next);
        }
      }
      if (output.length > q.limit) throw new SandboxError('LIMIT_EXCEEDED', 'Refine filters');
      const columnIds = [...new Set([...q.dimensions.flatMap(key => [key, d.fields.find(f => f.id === key)?.labelField].filter(Boolean)), ...q.metrics.map(m => m.metricId)])];
      const columns = columnIds.map(id => {
        const f = d.fields.find(x => x.id === id);
        const m = d.metrics.find(x => x.id === id);
        return { id, label: clone(f?.label ?? m.label), type: f?.type ?? 'decimal', ...(m?.unit ? { unit: m.unit } : {}) };
      });
      return { protocolVersion: 1, requestId: q.requestId, selectionToken: q.selection.token, columns, rows: output, complete: true, totalRows: output.length, warnings: [] };
    },
    async facet(request, signal) {
      abort(signal);
      const field = d.fields.find(f => f.id === request.fieldId);
      if (!field?.filters.includes('in') || request.filters.some(f => f.fieldId === request.fieldId)) throw new Error('Invalid facet');
      const counts = new Map();
      for (const row of selected(request.selection).filter(row => matches(row, request.filters, d))) {
        const value = row[field.id], label = String(row[field.labelField ?? field.id]);
        if (value === null || !label.toLowerCase().includes(request.search.toLowerCase())) continue;
        const previous = counts.get(value); counts.set(value, { value, label, count: (previous?.count ?? 0) + 1 });
      }
      const all = [...counts.values()].sort((a, b) => compare(a.value, b.value));
      const start = Number(request.cursor ?? 0), end = start + request.limit;
      return { values: all.slice(start, end), ...(end < all.length ? { nextCursor: String(end) } : {}) };
    },
  };
}
export function createMemoryStore(descriptor) {
  const documents = new Map();
  return {
    async list(signal) { abort(signal); return [...documents.values()].map(({ id, revision, title, updatedAt }) => ({ id, revision, title, updatedAt })); },
    async load(id, signal) { abort(signal); if (!documents.has(id)) throw new SandboxError('REVISION_MISSING', 'Analysis not found'); return clone(documents.get(id)); },
    async save(document, expectedRevision, signal) {
      abort(signal); const parsed = parseAnalysisDocument(document, descriptor);
      const previous = documents.get(parsed.id);
      if ((previous?.revision ?? null) !== expectedRevision || document.revision !== expectedRevision) throw new SandboxError('CONFLICT', 'Analysis changed');
      const saved = { ...parsed, revision: String(Number(previous?.revision ?? 0) + 1) };
      documents.set(saved.id, clone(saved)); return saved;
    },
  };
}
