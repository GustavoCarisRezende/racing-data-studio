import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDataset, assertQuery, assertResult, parseAnalysisDocument, parseModelDocument, parseModelDocumentV3, parseSavedModelDocument } from '@rds/sandbox-contracts';
import { buildChartModel, buildQuery, defaultVisualization, makeAnalysis, makeModel, makeModelV3, withCalculationProfile } from '@rds/sandbox-core';
import { resolve } from './helpers.mjs';
import { v3Fixture } from './v3-fixture.mjs';

const crops = [{ fieldId: 'week', op: 'range', min: 2, max: 2 }, { fieldId: 'phase', op: 'in', values: ['a-final'] }];

test('v3 accumulates all earlier visits across display crops, separately per entity/campaign, after exact aggregation', async () => {
  const { descriptor: d, provider } = v3Fixture(); assertDataset(d);
  const v = withCalculationProfile(d, defaultVisualization(d), 'all-visits-v1');
  assert.deepEqual(v.extraDimensions, ['phase']);
  const selection = await resolve(provider), q = buildQuery(d, selection, v, crops, 'v3');
  assert.equal(q.protocolVersion, 3); assert.equal(q.window.scope, 'profile');
  assert.deepEqual(q.dimensions, ['week', 'plot', 'campaign', 'phase']);
  assert.deepEqual(q.window.partitionBy, ['plot', 'campaign']);
  assert.deepEqual(q.filters, []); assert.deepEqual(q.displayFilters, crops);
  const r = await provider.query(q); assertResult(r, q, d);
  const value = (campaign, plot) => r.rows.find(row => row.values.campaign === campaign && row.values.plot === plot).values.harvest;
  assert.equal(value('2024', 'north'), '22.00');
  assert.equal(value('2023', 'north'), '10.00');
  assert.equal(value('2024', 'south'), '11.00');
  assert.equal(r.rows.length, 3);
  const prior = buildQuery(d, selection, v, [crops[0], { ...crops[1], values: ['z-prior'] }], 'prior');
  assert.equal((await provider.query(prior)).rows.find(row => row.values.plot === 'north' && row.values.campaign === '2024').values.harvest, '15.00', 'earlier final visits participate even when only prior visits are displayed');
  const descending = { ...q, orderBy: [{ fieldId: 'harvest', direction: 'desc' }] };
  const reversed = await provider.query(descending);
  assert.equal(reversed.rows[0].values.harvest, '22.00');
  const noCrop = await provider.query(buildQuery(d, selection, v, [], 'all'));
  const chart = buildChartModel(d, buildQuery(d, selection, v, [], 'all'), noCrop, 'line', 'en-US', 'Visits');
  assert.equal(chart.series.length, 6, 'visit types stay distinct in the chart without resetting calculation partitions');
  assert.throws(() => assertResult({ ...r, protocolVersion: 2 }, q, d));
});

test('v1/v2 keep population session filters and old partition rules; no implicit profile upgrade', async () => {
  const { descriptor: d, provider } = v3Fixture(), selection = await resolve(provider);
  const base = { ...defaultVisualization(d), series: 'plot', runningSum: true };
  const v1 = buildQuery(d, selection, base, crops, 'v1');
  const v2 = buildQuery(d, selection, { ...base, cumulativeScope: 'beforeDisplayFilter' }, crops, 'v2');
  assert.equal(v1.protocolVersion, 1); assert.equal(v2.protocolVersion, 2);
  assert.deepEqual(v2.displayFilters, [crops[0]]); assert.deepEqual(v2.filters, [crops[1]]);
  const get = r => r.rows.find(row => row.values.plot === 'north' && row.values.campaign === '2024').values.harvest;
  assert.equal(get(await provider.query(v1)), '7.00');
  assert.equal(get(await provider.query(v2)), '17.00');
  const old = makeAnalysis(d, selection, base, crops, 'Pinned');
  assert.equal(parseAnalysisDocument(old, d).visualization.calculation, undefined);
  const model = makeModel(d, [], { ...base, cumulativeScope: 'beforeDisplayFilter' }, crops, 'Old model');
  assert.equal(parseModelDocument(model, d).visualization.calculation, undefined);
  assert.deepEqual(buildQuery(d, selection, parseSavedModelDocument(model, d).visualization, crops, 'reopen').filters, [crops[1]]);
});

test('v3 validates declared crop fields, exact grain, partition, version and availability; missing/ambiguous chronology fails closed', async () => {
  const f = v3Fixture(), { descriptor: d, provider, chronology } = f;
  const q = buildQuery(d, await resolve(provider), withCalculationProfile(d, defaultVisualization(d), 'all-visits-v1'), crops, 'q');
  for (const bad of [
    { ...q, protocolVersion: 2 }, { ...q, filters: [crops[1]] },
    { ...q, displayFilters: [{ fieldId: 'plot', op: 'in', values: ['north'] }] },
    { ...q, dimensions: q.dimensions.filter(id => id !== 'phase') },
    { ...q, window: { ...q.window, partitionBy: [...q.window.partitionBy, 'phase'] } },
    { ...q, window: { ...q.window, profileId: 'unknown' } },
  ]) assert.throws(() => assertQuery(bad, d));
  const without = structuredClone(d); delete without.capabilities.runningSumProfiles;
  assert.throws(() => assertQuery(q, without));
  const bad = structuredClone(d); bad.capabilities.runningSumProfiles[0].chronology.missing = 'guess';
  assert.throws(() => assertDataset(bad));
  const notEnoughDimensions = structuredClone(d); notEnoughDimensions.capabilities.maxDimensions = 3;
  assert.throws(() => assertDataset(notEnoughDimensions));
  // Even a hidden earlier event must have known chronology.
  chronology.delete(JSON.stringify(['2024', 1, 'z-prior']));
  await assert.rejects(provider.query(q), e => e.code === 'ORDER_UNAVAILABLE');
  chronology.set(JSON.stringify(['2024', 1, 'z-prior']), 101); // same as final visit
  await assert.rejects(provider.query(q), e => e.code === 'ORDER_UNAVAILABLE');
  const missing = v3Fixture(); missing.rows.find(row => row.campaign === '2024' && row.plot === 'north' && row.week === 1 && row.phase === 'a-final').harvest_kg = null;
  const nullQuery = buildQuery(missing.descriptor, await resolve(missing.provider), withCalculationProfile(missing.descriptor, defaultVisualization(missing.descriptor), 'all-visits-v1'), crops, 'null');
  assert.equal((await missing.provider.query(nullQuery)).rows.find(row => row.values.campaign === '2024' && row.values.plot === 'north').values.harvest, null, 'unknown earlier data is never zero');
});

test('model v3 persists profile and fourth dimension; old stores/parsers reject it rather than silently stripping semantics', async () => {
  const { descriptor: d, provider, store, storeV3 } = v3Fixture(), selection = await resolve(provider);
  const visualization = withCalculationProfile(d, defaultVisualization(d), 'all-visits-v1');
  const document = makeModelV3(d, [], visualization, crops, 'Visits');
  assert.equal(document.documentVersion, 3);
  assert.deepEqual(parseModelDocumentV3(JSON.stringify(document), d), document);
  assert.throws(() => parseModelDocument(document, d), e => e.code === 'UNSUPPORTED_VERSION');
  assert.throws(() => parseModelDocument({ ...document, documentVersion: 2 }, d), /v3/);
  await assert.rejects(store.models.save(document, null), e => e.code === 'UNSUPPORTED_VERSION');
  const saved = await storeV3.modelsV3.save(document, null);
  const loaded = parseSavedModelDocument(await storeV3.modelsV3.load(saved.id), d);
  assert.deepEqual(loaded.visualization, visualization);
  assert.equal(buildQuery(d, selection, loaded.visualization, loaded.filters, 'loaded').protocolVersion, 3);
  const legacy = makeModel(d, [], defaultVisualization(d), [], 'v2');
  assert.equal((await storeV3.modelsV3.save(legacy, null)).documentVersion, 2);
  await assert.rejects(storeV3.modelsV3.save(saved, null), e => e.code === 'CONFLICT');
});
