/** Preview/test fixture ONLY. Never used by Sandbox as a fallback or by the native host. */
import { defaultVisualization, localize, makeModel, makeModelV3, withCalculationProfile } from '@rds/sandbox-core';

export async function restoreSyntheticModels(descriptor, store, locale = 'pt-BR', signal) {
  const existing = new Set((await store.modelsV3.list(signal)).map(item => item.id));
  const pt = locale.startsWith('pt');
  const metric = { metricId: 'points', aggregation: 'sum' };
  const filters = [{ fieldId: 'season', op: 'in', values: ['2025'] }];
  const profile = descriptor.capabilities.runningSumProfiles[0];
  const definitions = [
    { ...makeModelV3(descriptor, [], { ...withCalculationProfile(descriptor, defaultVisualization(descriptor), profile.id), kind: 'bar' }, filters, localize(profile.measureLabel ?? profile.label, locale)), id: 'synthetic-cumulative' },
    { ...makeModel(descriptor, [], { kind: 'pie', x: 'team', metric, series: null, comparison: 'season', runningSum: false }, filters, pt ? 'Pontos por equipe' : 'Points by team'), id: 'synthetic-teams' },
    { ...makeModel(descriptor, [], { kind: 'table', x: 'driver', metric, series: 'team', comparison: 'season', runningSum: false, table: { version: 1, columns: ['driver', 'team', 'season', 'points'] } }, filters, pt ? 'Pontos por piloto e equipe' : 'Points by driver and team'), id: 'synthetic-table' },
  ];
  for (const document of definitions) if (!existing.has(document.id)) await store.modelsV3.save(document, null, signal);
}
