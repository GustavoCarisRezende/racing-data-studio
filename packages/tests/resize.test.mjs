import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

test('ECharts follows measured container width after resizing and disposes its observer/chart', async () => {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  let width = 480, onResize, disconnected = false;
  Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 250 });
  // Text metrics are synthetic; this test checks lifecycle/sizing, not typography.
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ measureText: text => ({ width: String(text).length * 7 }) });
  class ResizeObserver {
    constructor(callback) { onResize = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  }
  const old = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, SVGElement: dom.window.SVGElement, ResizeObserver, IS_REACT_ACT_ENVIRONMENT: true })) {
    old.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { createElement, act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { EChartsRenderer } = await import('@rds/sandbox-echarts');
  const echarts = await import('echarts/core.js');
  const root = createRoot(document.getElementById('root'));
  const model = { kind: 'line', title: 'Synthetic', description: 'Synthetic', xLabel: 'Week', yLabel: 'kg', categories: [{ key: '1', label: '1' }], series: [{ id: 'one', label: 'One', values: [1] }] };
  let surface;
  try {
    await act(async () => root.render(createElement(EChartsRenderer, { model, locale: 'en-US' })));
    surface = document.querySelector('.rds-sb-chart-surface');
    assert.equal(echarts.getInstanceByDom(surface).getWidth(), 480);
    width = 960;
    await act(async () => onResize());
    assert.equal(echarts.getInstanceByDom(surface).getWidth(), 960);
    assert.equal(surface.querySelector('svg').getAttribute('width'), '960');
    assert.equal(echarts.getInstanceByDom(surface).getHeight(), 250);
  } finally {
    await act(async () => root.unmount());
    assert.ok(disconnected); assert.equal(echarts.getInstanceByDom(surface), undefined);
    dom.window.close();
    for (const [key, value] of old) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; }
  }
});
