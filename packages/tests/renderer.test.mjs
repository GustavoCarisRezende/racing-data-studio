import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import * as echarts from 'echarts/core.js';
import { EChartsRenderer, toEChartsOption } from '@rds/sandbox-echarts';
const model = { kind: 'line', title: '<img src=x onerror=bad()>', description: 'Exact values in table', xLabel: 'Week', yLabel: 'kg', categories: [{ key: '1', label: '<script>bad()</script>' }, { key: '2', label: 'Two' }], series: [{ id: 'a', label: '<iframe src=bad>', values: [1.1, null] }] };

test('modular renderer disables animation and HTML tooltips, keeps gaps and exposes accessible description', () => {
  const option = toEChartsOption(model);
  assert.equal(option.tooltip.renderMode, 'richText');
  assert.equal(option.animation, false);
  assert.equal(option.series[0].connectNulls, false);
  assert.equal(option.legend.selectedMode, false);
  assert.equal(option.aria.enabled, true);
  assert.equal(option.series[0].data[1], null);
  const markup = renderToStaticMarkup(createElement(EChartsRenderer, { model, locale: 'en-US' }));
  assert.ok(markup.includes('role="img"'));
  assert.ok(!markup.includes('<script>'));
});

test('actual ECharts SVG SSR render escapes source strings without a browser, CDN, WASM or HTML', () => {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 640, height: 340 });
  try {
    chart.setOption(toEChartsOption(model));
    const svg = chart.renderToSVGString();
    assert.ok(svg.includes('<svg'));
    assert.ok(!svg.includes('<iframe'));
    assert.ok(!svg.includes('<script>'));
    assert.ok(svg.includes('&lt;'));
  } finally { chart.dispose(); }
});
