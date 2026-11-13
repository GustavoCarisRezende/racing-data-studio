import { descriptor as legacy } from './helpers.mjs';
import { createMemoryProvider, createMemoryStore, createMemoryModelStore } from '../examples/memory-provider.mjs';

/** Invented orchard visits; the library never knows visit ordering or category rules. */
export function v3Fixture() {
  const descriptor = structuredClone(legacy);
  descriptor.fields.push({ id: 'phase', label: { fallback: 'Visit' }, type: 'string', role: 'dimension', analyticalType: 'nominal', nullable: false, ordered: false, filters: ['in'], availability: 'available' });
  descriptor.metrics[0].groupableBy.push('phase');
  Object.assign(descriptor.capabilities, { maxDimensions: 4, queryVersions: [1, 2, 3], multiSelection: { fieldId: 'campaign', maxValues: 20 }, latestSelection: true,
    runningSumScopes: ['filteredSelection', 'beforeDisplayFilter'], runningSumProfiles: [{ version: 1, id: 'all-visits-v1', label: { fallback: 'All earlier visits' }, description: { fallback: 'Accumulate every earlier visit per plot/campaign, then crop weeks and visit types.' }, metricId: 'harvest', axisFieldId: 'week', dimensions: ['week', 'plot', 'campaign', 'phase'], partitionBy: ['plot', 'campaign'], orderDimensions: ['week', 'phase'], chronology: { id: 'orchard-schedule-v1', missing: 'reject' }, displayFilterFields: ['week', 'phase'] }] });
  const rows = [], chronology = new Map();
  for (const [campaign, plot, amounts] of [['2024', 'north', ['3.00', '10.00', '2.00', '7.00']], ['2023', 'north', ['1.00', '4.00', '1.00', '4.00']], ['2024', 'south', ['5.00', '1.00', '3.00', '2.00']]]) {
    for (let index = 0; index < 4; index++) {
      const week = 1 + Math.floor(index / 2), phase = index % 2 ? 'a-final' : 'z-prior';
      rows.unshift({ campaign, plot, plot_name: plot === 'north' ? 'North' : 'South', week, phase, harvest_kg: amounts[index] });
      chronology.set(JSON.stringify([campaign, week, phase]), 100 + index);
    }
  }
  // Distinct source occurrences must aggregate before the cumulative window.
  const original = rows.find(row => row.campaign === '2024' && row.plot === 'north' && row.week === 1 && row.phase === 'z-prior');
  original.harvest_kg = '1.00'; rows.push({ ...original, harvest_kg: '2.00' });
  const rank = values => chronology.get(JSON.stringify([values.campaign, values.week, values.phase]));
  const provider = createMemoryProvider(descriptor, rows, () => rows, { 'orchard-schedule-v1': rank });
  const store = createMemoryStore(descriptor);
  const storeV3 = { ...createMemoryStore(descriptor), modelsV3: createMemoryModelStore(descriptor, 3) };
  return { descriptor, rows, chronology, provider, store, storeV3 };
}
