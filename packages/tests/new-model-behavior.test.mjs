import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSavedModelDocument } from '@rds/sandbox-contracts';
import { defaultVisualization, makeModel } from '@rds/sandbox-core';
import { toEChartsOption } from '@rds/sandbox-echarts';
import { v2Fixture } from './v2-fixture.mjs';

test('model restore flags roundtrip and old documents remain compatible', () => {
  const { descriptor } = v2Fixture();
  const model = makeModel(descriptor, [], defaultVisualization(descriptor), [], 'Example');
  assert.equal(parseSavedModelDocument(model, descriptor).saveFilters, undefined);
  const restored = parseSavedModelDocument({ ...model, saveFilters: false, saveDataSelection: true }, descriptor);
  assert.equal(restored.saveFilters, false);
  assert.equal(restored.saveDataSelection, true);
  assert.throws(() => parseSavedModelDocument({ ...model, saveFilters: 'false' }, descriptor));
});

test('line and bar use item tooltips with individual point descriptions', () => {
  for (const kind of ['line', 'bar']) {
    const option = toEChartsOption({ kind, title: 'Test', description: 'Test', xLabel: 'Round', yLabel: 'Points', categories: [{ key: '1', label: '1' }], series: [{ id: 'a', label: 'A', values: [5], valueLabels: ['1 · North GP'] }] });
    assert.equal(option.tooltip.trigger, 'item');
    assert.equal(option.series[0].data[0].name, '1 · North GP');
  }
});

test('pie and scatter tooltips are item-scoped', () => {
  const base = { title: 'Chart', description: 'Chart', xLabel: 'x', yLabel: 'y', categories: [] };
  const pie = toEChartsOption({ ...base, kind: 'pie', series: [{ id: 'a', label: 'A', values: [1] }], slices: [{ id: 'a', label: 'A', value: 1 }] });
  const scatter = toEChartsOption({ ...base, kind: 'scatter', series: [{ id: 'a', label: 'A', values: [], points: [{ id: 'p', label: 'Round 1', value: [1, 2] }] }] });
  assert.equal(pie.tooltip.trigger, 'item');
  assert.equal(scatter.tooltip.trigger, 'item');
});
