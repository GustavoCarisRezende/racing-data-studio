import test from 'node:test';
import assert from 'node:assert/strict';
import { toEChartsOption } from '@rds/sandbox-echarts';

const model = {
  kind: 'line', title: 'Chart', description: 'Chart', xLabel: 'Round', yLabel: 'Points',
  categories: [{ key: 'r1', label: 'Round' }, { key: 'r2', label: 'Round' }],
  series: [
    { id: 'b', label: 'Driver B · 2025', values: [5, 5], valueLabels: ['First race', 'Second race'] },
    { id: 'a', label: 'Driver A · 2024', values: [5, 7], valueLabels: ['First race', 'Second race'] },
    { id: 'c', label: 'Driver C · 2025', values: [6, 5] },
    { id: 'd', label: 'Missing', values: [null, 0] },
  ],
};
const hover = (chart, seriesIndex, dataIndex) => toEChartsOption(chart).tooltip.formatter({ seriesIndex, dataIndex });

test('line tooltip combines only the exact category index and projected numeric value, deterministically', () => {
  assert.equal(hover(model, 0, 0), 'First race\nDriver A · 2024: 5\nDriver B · 2025: 5');
  assert.equal(hover(model, 0, 1), 'Second race\nDriver B · 2025: 5\nDriver C · 2025: 5');
  assert.equal(hover(model, 2, 0), 'Round\nDriver C · 2025: 6');
  assert.equal(hover(model, 3, 0), '');
});

test('zero is included, null excluded, and only visible model series participate', () => {
  const zero = { ...model, series: [
    { id: 'a', label: 'Zero', values: [0, null] },
    { id: 'b', label: 'Also zero', values: [-0, null] },
    { id: 'c', label: 'Null', values: [null, 0] },
  ] };
  assert.equal(hover(zero, 0, 0), 'Round\nAlso zero: 0\nZero: 0');
  assert.equal(hover({ ...zero, series: [zero.series[0], zero.series[2]] }, 0, 0), 'Round\nZero: 0');
  assert.equal(hover({ ...model, series: [model.series[0]] }, 0, 0), 'First race\nDriver B · 2025: 5');
});

test('tooltip source text cannot create rich text tokens or extra lines', () => {
  const unsafe = { ...model, series: [{ id: 'x', label: '{bad|name}\n<img>', values: [1, null], valueLabels: ['{style|race}\u0000', ''] }] };
  assert.equal(hover(unsafe, 0, 0), '｛style|race｝ \n｛bad|name｝ <img>: 1');
  assert.equal(toEChartsOption({ ...model, kind: 'bar' }).tooltip.formatter, undefined);
});
