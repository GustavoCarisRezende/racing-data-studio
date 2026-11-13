/** Executable non-production reference adapter. Data is supplied, never fetched. */
import { assertDataset, assertQuery, assertSelection, compareDecimal, parseAnalysisDocument, parseModelDocument, parseSavedModelDocument, SandboxError } from '@rds/sandbox-contracts';

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
export function createMemoryProvider(descriptor, inputRows, readLatest = () => inputRows, chronologies = {}) {
  assertDataset(descriptor);
  const d = clone(descriptor);
  let rows = clone(inputRows), version = 1;
  const history = new Map([['fixture-1', rows]]);
  const revision = (partitionId, revisionId = `fixture-${version}`) => ({ partitionId, revisionId, sourceDataAt: '2026-01-01T00:00:00Z', storedAt: '2026-01-02T00:00:00Z' });
  const token = revisions => JSON.stringify(revisions.map(r => r.revisionId === 'fixture-1' ? r.partitionId : [r.partitionId, r.revisionId]));
  function selected(selection) {
    assertSelection(selection);
    if (selection.datasetId !== d.id || selection.transformationVersion !== 'orchard-fixture-1' || selection.token !== token(selection.revisions)) throw new SandboxError('REVISION_MISSING', 'Unknown selection');
    for (const r of selection.revisions) if (!history.get(r.revisionId)?.some(row => row.campaign === r.partitionId) || JSON.stringify(r) !== JSON.stringify(revision(r.partitionId, r.revisionId))) throw new SandboxError('REVISION_MISSING', 'Unknown revision');
    return selection.revisions.flatMap(r => history.get(r.revisionId).filter(row => row.campaign === r.partitionId));
  }
  return {
    async listDatasets(signal) { abort(signal); return [clone({ id: d.id, label: d.label, description: d.description })]; },
    async describeDataset({ datasetId }, signal) { abort(signal); if (datasetId !== d.id) throw new Error('Unknown dataset'); return clone(d); },
    async resolveSelection(request, signal) {
      abort(signal);
      if (request.datasetId !== d.id || request.protocolVersion !== 1) throw new Error('Unknown dataset/protocol');
      if (request.policy === 'latest') { const next = clone(await readLatest()); abort(signal); if (JSON.stringify(next) !== JSON.stringify(rows)) { rows = next; version++; history.set(`fixture-${version}`, rows); } }
      const partitions = [...new Set(rows.map(row => row.campaign))];
      const keys = request.partitionIds.length ? request.partitionIds : partitions;
      const revisions = request.policy === 'pinned' ? clone(request.revisions ?? []) : keys.map(key => revision(key));
      const selection = { protocolVersion: 1, datasetId: d.id, token: token(revisions), revisions, transformationVersion: 'orchard-fixture-1' };
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
      let output = [...groups.entries()].map(([key, group]) => {
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
      if (q.window?.scope === 'profile') {
        const profile = d.capabilities.runningSumProfiles.find(p => p.id === q.window.profileId);
        const order = Object.hasOwn(chronologies, profile.chronology.id) ? chronologies[profile.chronology.id] : undefined;
        if (typeof order !== 'function') throw new SandboxError('ORDER_UNAVAILABLE', 'Fixture chronology not implemented');
        const ranked = output.map(row => ({ row, rank: order(row.values, q.selection) }));
        if (ranked.some(item => !Number.isSafeInteger(item.rank))) throw new SandboxError('ORDER_UNAVAILABLE', 'Incomplete chronology, including outside display crop');
        ranked.sort((a, b) => a.rank - b.rank);
        const totals = new Map(), seen = new Set();
        for (const { row, rank } of ranked) {
          const key = JSON.stringify(profile.partitionBy.map(field => row.values[field]));
          const observation = JSON.stringify([key, rank]);
          if (seen.has(observation)) throw new SandboxError('ORDER_UNAVAILABLE', 'Ambiguous chronology within partition');
          seen.add(observation);
          const raw = row.values[q.window.metricId];
          const next = raw === null || (totals.has(key) && totals.get(key) === null) ? null : (totals.get(key) ?? 0n) + cents(raw);
          totals.set(key, next); row.values[q.window.metricId] = next === null ? null : decimal(next);
        }
      } else if (q.window) {
        output.sort((a, b) => compare(a.values[q.window.orderBy], b.values[q.window.orderBy]));
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
      output = output.filter(row => matches(row.values, q.displayFilters ?? [], d));
      output.sort((a, b) => {
        for (const order of q.orderBy) {
          const x = a.values[order.fieldId], y = b.values[order.fieldId];
          const numeric = d.metrics.some(m => m.id === order.fieldId);
          const diff = numeric && x !== null && y !== null ? compareDecimal(x, y) : compare(x, y);
          if (diff) return order.direction === 'asc' ? diff : -diff;
        }
        return 0;
      });
      if (output.length > q.limit) throw new SandboxError('LIMIT_EXCEEDED', 'Refine filters');
      const columnIds = [...new Set([...q.dimensions.flatMap(key => [key, d.fields.find(f => f.id === key)?.labelField].filter(Boolean)), ...q.metrics.map(m => m.metricId)])];
      const columns = columnIds.map(id => {
        const f = d.fields.find(x => x.id === id);
        const m = d.metrics.find(x => x.id === id);
        return { id, label: clone(f?.label ?? m.label), type: f?.type ?? 'decimal', ...(m?.unit ? { unit: m.unit } : {}) };
      });
      return { protocolVersion: q.protocolVersion, requestId: q.requestId, selectionToken: q.selection.token, columns, rows: output, complete: true, totalRows: output.length, warnings: [] };
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
    models: createMemoryModelStore(descriptor),
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

/** Volatile reference implementation. A real host supplies durable atomic CAS. */
export function createMemoryModelStore(descriptor, documentVersion = 2) {
  const documents = new Map();
  let revision = 0;
  return {
    documentVersion,
    async list(signal) { abort(signal); return [...documents.values()].map(({ id, revision, title, updatedAt }) => ({ id, revision, title, updatedAt })); },
    async load(id, signal) { abort(signal); if (!documents.has(id)) throw new SandboxError('REVISION_MISSING', 'Model not found'); return clone(documents.get(id)); },
    async save(document, expectedRevision, signal) {
      abort(signal); const parsed = documentVersion === 3 ? parseSavedModelDocument(document, descriptor) : parseModelDocument(document, descriptor); const previous = documents.get(parsed.id);
      if ((previous?.revision ?? null) !== expectedRevision || parsed.revision !== expectedRevision) throw new SandboxError('CONFLICT', 'Model changed');
      const saved = { ...parsed, revision: String(++revision) }; documents.set(saved.id, clone(saved)); return saved;
    },
    async delete({ id, expectedRevision }, signal) {
      abort(signal); const previous = documents.get(id);
      if (!previous) throw new SandboxError('REVISION_MISSING', 'Model not found');
      if (previous.revision !== expectedRevision) throw new SandboxError('CONFLICT', 'Model changed');
      documents.delete(id);
    },
  };
}
