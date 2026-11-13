import { descriptor as legacy, rows as legacyRows } from './helpers.mjs';
import { createMemoryProvider, createMemoryStore } from '../examples/memory-provider.mjs';

/** Invented second measurement, isolated from the v1 golden dataset. */
export function v2Fixture() {
  const descriptor = structuredClone(legacy);
  descriptor.fields.push({ ...structuredClone(descriptor.fields.find(f => f.id === 'harvest_kg')), id: 'cost_raw', label: { fallback: 'Cost raw' }, unit: 'credits' });
  descriptor.metrics.push({ ...structuredClone(descriptor.metrics[0]), id: 'cost', fieldId: 'cost_raw', label: { fallback: 'Cost' }, description: { fallback: 'Invented fixture credits, not real money.' }, unit: 'credits', requiredDimensions: ['campaign'] });
  Object.assign(descriptor.capabilities, { charts: ['table', 'line', 'bar', 'pie', 'scatter'], queryVersions: [1, 2], runningSumScopes: ['filteredSelection', 'beforeDisplayFilter'], latestSelection: true, multiSelection: { fieldId: 'campaign', maxValues: 3 }, maxSeries: 100 });
  let rows = legacyRows.map((row, index) => ({ ...row, cost_raw: index === 0 ? null : `${index + 1}.00` }));
  rows.push({ ...rows[0], campaign: '2025', cost_raw: '-2.00' });
  const provider = createMemoryProvider(descriptor, rows, () => rows);
  const store = createMemoryStore(descriptor);
  return { descriptor, provider, store, getRows: () => structuredClone(rows), updateRows: next => { rows = structuredClone(next); } };
}
