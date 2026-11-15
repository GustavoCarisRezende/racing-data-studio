import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { EChartsRenderer } from '@rds/sandbox-echarts';

for (const kind of ['line', 'pie']) test(`${kind} legend isolates and restores without inventing zero values; model changes clear isolation`, async () => {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  const old = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, SVGElement: dom.window.SVGElement, IS_REACT_ACT_ENVIRONMENT: true })) { old.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value }); }
  Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { get: () => 640 });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', { get: () => 340 });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ measureText: text => ({ width: String(text).length * 7 }) });
  const { createRoot } = await import('react-dom/client'); const root = createRoot(document.getElementById('root'));
  const base = { kind, title: 'Example', description: 'Example', xLabel: 'Round', yLabel: 'Value', categories: [{ key: '1', label: '1' }], series: [{ id: 'a', label: 'A', values: [2] }, { id: 'b', label: 'B', values: [3] }], ...(kind === 'pie' ? { slices: [{ id: 'a', label: 'A', value: 2 }, { id: 'b', label: 'B', value: 3 }] } : {}) };
  let visible; const changed = model => { visible = model; };
  const settle = async () => { await act(async () => { await delay(30); }); };
  try {
    await act(async () => root.render(createElement(EChartsRenderer, { model: base, locale: 'en-US', onVisibleModelChange: changed }))); await settle();
    const legend = () => [...document.querySelectorAll('.rds-sb-legend button')];
    assert.equal(legend().length, 2); assert.ok(document.querySelector('.rds-sb-chart-surface svg'));
    await act(async () => legend()[0].click()); await settle();
    assert.equal(legend()[0].getAttribute('aria-pressed'), 'true');
    assert.deepEqual(visible.series.map(s => s.id), ['a']);
    if (kind === 'pie') assert.deepEqual(visible.slices.map(s => [s.id, s.value]), [['a', 2]]);
    await act(async () => legend()[0].click()); await settle(); assert.equal(visible.series.length, 2);
    await act(async () => legend()[1].click()); await settle(); assert.deepEqual(visible.series.map(s => s.id), ['b']);
    const next = { ...base, series: [{ id: 'c', label: 'C', values: [5] }], ...(kind === 'pie' ? { slices: [{ id: 'c', label: 'C', value: 5 }] } : {}) };
    await act(async () => root.render(createElement(EChartsRenderer, { model: next, locale: 'en-US', onVisibleModelChange: changed }))); await settle();
    assert.deepEqual(visible.series.map(s => s.id), ['c']); assert.equal(legend()[0].getAttribute('aria-pressed'), 'false');
  } finally { await act(async () => root.unmount()); dom.window.close(); for (const [key, value] of old) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; } }
});

test('sandbox exports the isolated chart, not hidden series', async () => {
  const { Sandbox } = await import('@rds/sandbox-react');
  const { v2Fixture } = await import('./v2-fixture.mjs');
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://fixture.invalid', pretendToBeVisual: true });
  const old = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, SVGElement: dom.window.SVGElement, IS_REACT_ACT_ENVIRONMENT: true })) { old.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value }); }
  Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { get: () => 640 });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', { get: () => 340 });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ measureText: text => ({ width: String(text).length * 7 }) });
  const { createRoot } = await import('react-dom/client'); const root = createRoot(document.getElementById('root'));
  const { provider, store } = v2Fixture(); let exported;
  const settle = async () => { for (let i = 0; i < 2; i++) await act(async () => { await delay(120); }); };
  const click = async text => { const b = [...document.querySelectorAll('button')].find(node => node.textContent === text); assert.ok(b, text); await act(async () => b.click()); await settle(); };
  try {
    await act(async () => root.render(createElement(Sandbox, { provider, store, ChartRenderer: EChartsRenderer, host: { exportImage: async () => {} }, chartExporter: async (model, options) => { exported = { model, options }; return { format: options.format, bytes: new Uint8Array([1]) }; } }))); await settle();
    const group = [...document.querySelectorAll('label')].find(l => l.firstChild?.textContent === 'Group by').querySelector('select');
    await act(async () => { group.value = 'plot'; group.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); await settle();
    const legend = [...document.querySelectorAll('.rds-sb-legend button')]; assert.ok(legend.length > 1);
    const chosen = legend[0].lastChild.textContent;
    await act(async () => legend[0].click()); await settle();
    await click('Export');
    await act(async () => [...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent === 'Export').click()); await settle();
    assert.equal(exported.model.series.length, 1); assert.equal(exported.model.series[0].label, chosen);
    assert.equal(exported.options.format, 'svg');
  } finally { await act(async () => root.unmount()); dom.window.close(); for (const [key, value] of old) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; } }
});

test('separate series remain sorted and select driver IDs; unified swatches describe each season', async () => {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
  const old = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, SVGElement: dom.window.SVGElement, IS_REACT_ACT_ENVIRONMENT: true })) { old.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value }); }
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ measureText: text => ({ width: String(text).length * 7 }) });
  const { createRoot } = await import('react-dom/client'); const root = createRoot(document.getElementById('root'));
  const series = [{ id: 'b', label: 'Émile · 2025', dimensions: { driver: 'e' }, values: [2] }, { id: 'a', label: 'Ana · 2025', dimensions: { driver: 'a' }, values: [3] }, { id: 'c', label: 'Émile · 2024', dimensions: { driver: 'e' }, values: [4] }];
  const model = { kind: 'line', title: 'T', description: 'T', xLabel: 'X', yLabel: 'Y', categories: [{ key: '1', label: '1' }], series };
  let toggled; const selection = { fieldId: 'driver', referenceModel: model, options: [{ value: 'e', label: 'Émile' }, { value: 'a', label: 'Ana' }], selected: ['e'], disabled: false, onToggle: value => { toggled = value; } };
  try {
    await act(async () => root.render(createElement(EChartsRenderer, { model, locale: 'pt-BR', legendSelection: selection })));
    let buttons = [...document.querySelectorAll('.rds-sb-legend button')];
    assert.deepEqual(buttons.map(b => b.lastChild.textContent), ['Ana', 'Émile']);
    assert.deepEqual([...buttons[1].querySelectorAll('g title')].map(t => t.textContent), ['Émile · 2025', 'Émile · 2024']);
    assert.equal(buttons[1].querySelectorAll('g rect').length, 2);
    await act(async () => root.render(createElement(EChartsRenderer, { model, locale: 'pt-BR', legendSelection: selection, unifyLegends: false })));
    buttons = [...document.querySelectorAll('.rds-sb-legend button')];
    assert.deepEqual(buttons.map(b => b.lastChild.textContent), ['Ana · 2025', 'Émile · 2024', 'Émile · 2025']);
    assert.deepEqual(buttons.map(b => b.getAttribute('aria-pressed')), ['false', 'true', 'true']);
    assert.match(buttons[1].getAttribute('aria-label'), /filtra todas/);
    await act(async () => buttons[1].click()); assert.equal(toggled, 'e');
    const { toEChartsOption, renderExportSvg } = await import('@rds/sandbox-echarts');
    assert.deepEqual(toEChartsOption(model).series.map(s => s.name), series.map(s => s.label));
    const svg = renderExportSvg(model, { showLegend: true, showLabels: true, locale: 'pt-BR' }).svg;
    assert.ok(svg.lastIndexOf('Ana · 2025') < svg.lastIndexOf('Émile · 2024'));
  } finally { await act(async () => root.unmount()); dom.window.close(); for (const [key, value] of old) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; } }
});
