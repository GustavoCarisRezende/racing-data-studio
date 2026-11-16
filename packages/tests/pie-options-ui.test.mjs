import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { Sandbox } from '@rds/sandbox-react';
import { v2Fixture } from './v2-fixture.mjs';

test('pie controls save and reopen explicit settings with a synthetic store', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://synthetic.invalid' });
  const old = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) { old.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value }); }
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  const { provider, store } = v2Fixture();
  let chart;
  let exportedOptions, savedImage;
  const Renderer = ({ model }) => { chart = model; return createElement('div'); };
  const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await delay(140); }); };
  const click = async text => { const button = [...document.querySelectorAll('button')].find(b => b.textContent === text); assert.ok(button, text); await act(async () => button.click()); await settle(); };
  try {
    await act(async () => root.render(createElement(Sandbox, { provider, store, ChartRenderer: Renderer, chartExporter: async (_model, options) => { exportedOptions = options; return { format: options.format, bytes: new Uint8Array([1]) }; }, host: { exportImage: async file => { savedImage = file; } } }))); await settle();
    await click('Pie');
    const label = text => [...document.querySelectorAll('label')].find(l => l.firstChild?.textContent === text || l.textContent === text);
    const order = label('Sort slices by value').querySelector('select');
    await act(async () => { order.value = 'desc'; order.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); await settle();
    const input = label('Group values below').querySelector('input');
    await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, '1000000'); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    await act(async () => input.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }))); await settle();
    const legend = label('Show pie legend').querySelector('input');
    await act(async () => legend.click()); await settle();
    assert.equal(chart.piePresentation.showLegend, false);
    assert.equal(chart.slices.at(-1).label, 'Other');
    await click('Export');
    const dialog = document.querySelector('[role=dialog]');
    assert.deepEqual([...dialog.querySelectorAll('.rds-sb-dialog-actions button')].map(b => b.textContent), ['Cancel', 'Export']);
    assert.ok(dialog.querySelector('.rds-sb-export-format select'));
    for (const text of ['Include legend', 'Include pie labels']) {
      const option = label(text);
      assert.ok(option.classList.contains('rds-sb-check'));
      assert.equal(option.querySelector('input[type=checkbox]').parentElement, option);
    }
    const caption = document.querySelector('.rds-sb-chart figcaption');
    assert.ok(caption.classList.contains('rds-sb-sr'), 'chart warning is not visually rendered');
    const imageFormat = label('Image format').querySelector('select');
    await act(async () => { imageFormat.value = 'png'; imageFormat.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); await settle();
    await act(async () => label('Include pie labels').querySelector('input').click()); await settle();
    assert.equal(label('Show slice labels').querySelector('input').checked, true, 'export options do not mutate the model');
    await act(async () => [...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent === 'Export').click()); await settle();
    assert.deepEqual(exportedOptions, { format: 'png', showLegend: true, showLabels: false, locale: 'en-US' });
    assert.equal(savedImage.format, 'png');
    await click('Export');
    await act(async () => { const format = label('Image format').querySelector('select'); format.value = 'svg'; format.dispatchEvent(new dom.window.Event('change', { bubbles: true })); label('Include legend').querySelector('input').click(); });
    await act(async () => [...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent === 'Export').click()); await settle();
    assert.deepEqual(exportedOptions, { format: 'svg', showLegend: false, showLabels: false, locale: 'en-US' });
    assert.equal(savedImage.format, 'svg');
    await click('Save model'); await click('Confirm');
    const saved = await store.models.load((await store.models.list())[0].id);
    assert.deepEqual(saved.visualization.pie, { version: 1, order: 'desc', showLegend: false, showLabels: true, otherBelow: '1000000' });
    await click('Saved models');
    await act(async () => document.querySelector('.rds-sb-model-card button[aria-label^="Edit model:"]').click()); await settle();
    assert.equal(label('Group values below').querySelector('input').value, '1000000');
    assert.equal(chart.slices.at(-1).label, 'Other');
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, value] of old) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; }
  }
});
