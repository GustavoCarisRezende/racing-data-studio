import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { Sandbox } from '@rds/sandbox-react';
import { v2Fixture } from './v2-fixture.mjs';

async function mount() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://fixture.invalid' });
  const old = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) { old.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value }); }
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  const { provider, store } = v2Fixture();
  const queries = []; const query = provider.query;
  provider.query = async (...args) => { queries.push(args[0]); return query(...args); };
  const settle = async () => { for (let i = 0; i < 2; i++) await act(async () => { await delay(120); }); };
  const click = async text => { const b = [...document.querySelectorAll('button')].find(x => x.textContent === text); assert.ok(b, text); await act(async () => b.click()); await settle(); };
  const filter = async (name, value) => {
    const box = [...document.querySelectorAll('.rds-sb-quick-filter')].find(e => e.querySelector('summary').textContent.startsWith(name));
    assert.ok(box, name);
    if (!box.open) { await act(async () => box.querySelector('summary').click()); await settle(); }
    const label = [...box.querySelectorAll('.rds-sb-facet label')].find(e => e.querySelector('span')?.textContent === value);
    assert.ok(label, `${name}: ${value}`); await act(async () => label.querySelector('input').click()); await settle();
  };
  await act(async () => root.render(createElement(Sandbox, { provider, store, ChartRenderer: () => createElement('div') }))); await settle();
  return { dom, root, store, queries, settle, click, filter, async close() { await act(async () => root.unmount()); dom.window.close(); for (const [key, value] of old) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; } } };
}

test('save modal traps keyboard focus, Escape cancels without mutation, and restores focus', async () => {
  const app = await mount();
  try {
    const { click, settle, dom, store } = app;
    const trigger = [...document.querySelectorAll('button')].find(b => b.textContent === 'Save model');
    trigger.focus(); await click('Save model');
    const dialog = document.querySelector('[role=dialog]');
    assert.ok(dialog); assert.equal(dialog.getAttribute('aria-modal'), 'true');
    assert.ok(document.querySelector('.rds-sb-layout').hasAttribute('inert'));
    assert.ok(dialog.contains(document.activeElement));
    const last = [...dialog.querySelectorAll('button')].at(-1); last.focus();
    await act(async () => last.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    assert.equal(document.activeElement, dialog.querySelector('input'));
    await act(async () => document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); await settle();
    assert.equal(document.querySelector('[role=dialog]'), null); assert.equal(document.activeElement, trigger);
    assert.deepEqual(await store.models.list(), []);
    await click('Save model'); await click('Confirm');
    await click('Bar'); await click('Saved models');
    await act(async () => document.querySelector('.rds-sb-model-open').click()); await settle();
    assert.ok(document.querySelector('[role=alertdialog]'));
    assert.ok(document.querySelector('.rds-sb-layout').hasAttribute('inert'));
    await click('Cancel');
    assert.equal([...document.querySelectorAll('.rds-sb-chart-types button')].find(b => b.textContent === 'Bar').getAttribute('aria-pressed'), 'true');
    await click('Saved models');
    await act(async () => document.querySelector('button[aria-label^="Delete model:"]').click()); await settle();
    assert.ok(document.querySelector('[role=alertdialog]')); await click('Cancel');
    assert.equal((await store.models.list()).length, 1);
  } finally { await app.close(); }
});

for (const [saveFilters, saveDataSelection] of [[true, true], [false, false], [true, false], [false, true]]) {
  test(`model restores partitioned filters: filters=${saveFilters} selection=${saveDataSelection}`, async () => {
    const app = await mount();
    try {
      const { click, filter, store, queries, settle } = app;
      await filter('Campaign', '2023'); await filter('Plot', 'North');
      await click('Save model');
      const dialog = document.querySelector('[role=dialog]');
      const checks = [...dialog.querySelectorAll('input[type=checkbox]')];
      if (!saveFilters) await act(async () => checks[0].click());
      if (!saveDataSelection) await act(async () => checks[1].click());
      await click('Confirm');
      const summary = (await store.models.list())[0]; assert.ok(summary);
      const saved = await store.models.load(summary.id);
      assert.equal(saved.saveFilters, saveFilters); assert.equal(saved.saveDataSelection, saveDataSelection);
      assert.equal(saved.filters.some(f => f.fieldId === 'campaign'), saveDataSelection);
      assert.equal(saved.filters.some(f => f.fieldId === 'plot'), saveFilters);
      if (!saveDataSelection) assert.deepEqual(saved.binding.partitionIds, []);
      await filter('Campaign', '2023'); await filter('Campaign', '2024');
      await filter('Plot', 'North'); await filter('Plot', 'South');
      await click('Saved models');
      await act(async () => document.querySelector('.rds-sb-model-open').click()); await settle();
      if (document.querySelector('[role=alertdialog]')) await click('Confirm');
      const filters = queries.at(-1).filters;
      assert.deepEqual(filters.find(f => f.fieldId === 'campaign')?.values, [saveDataSelection ? '2023' : '2024']);
      assert.deepEqual(filters.find(f => f.fieldId === 'plot')?.values, [saveFilters ? 'north' : 'south']);
    } finally { await app.close(); }
  });
}

test('legacy pinned analyses remain accessible from the unified models panel', async () => {
  const { descriptor: originalDescriptor, rows } = await import('./helpers.mjs');
  const { createMemoryProvider, createMemoryStore } = await import('../examples/memory-provider.mjs');
  const { defaultVisualization, makeAnalysis } = await import('@rds/sandbox-core');
  const descriptor = structuredClone(originalDescriptor); descriptor.capabilities.latestSelection = true;
  const provider = createMemoryProvider(descriptor, rows), store = createMemoryStore(descriptor);
  const selection = await provider.resolveSelection({ protocolVersion: 1, datasetId: descriptor.id, policy: 'latest', partitionIds: [] });
  await store.save(makeAnalysis(descriptor, selection, defaultVisualization(descriptor), [], 'Historical'), null);
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://fixture.invalid' }); const old = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) { old.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value }); }
  const { createRoot } = await import('react-dom/client'); const root = createRoot(document.getElementById('root'));
  const resolved = []; const original = provider.resolveSelection;
  provider.resolveSelection = async (...args) => { resolved.push(args[0]); return original(...args); };
  const settle = async () => { for (let i = 0; i < 2; i++) await act(async () => { await delay(120); }); };
  try {
    await act(async () => root.render(createElement(Sandbox, { provider, store }))); await settle();
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Saved models').click()); await settle();
    assert.equal(document.querySelector('.rds-sb-model-open').textContent, 'Historical');
    assert.ok(document.querySelector('button[aria-label^="Delete model:"]').disabled, 'v1 store has no delete capability');
    assert.ok(document.querySelector('.rds-sb-legacy-note').textContent.includes('Deletion is unavailable'));
    await act(async () => document.querySelector('.rds-sb-model-open').click()); await settle();
    assert.equal(resolved.at(-1).policy, 'pinned');
    assert.equal(document.querySelector('.rds-sb-title input').value, 'Historical');
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Save model').click()); await settle();
    await act(async () => [...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent === 'Confirm').click()); await settle();
    assert.equal((await store.models.list()).length, 1);
    assert.equal((await store.list()).length, 1, 'saving as a model preserves the pinned analysis');
  } finally { await act(async () => root.unmount()); dom.window.close(); for (const [key, value] of old) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; } }
});

for (const saveDataSelection of [true, false]) test(`partition binding restoration obeys selection flag ${saveDataSelection}`, async () => {
  const { defaultVisualization, makeModel, withRequiredDimensions } = await import('@rds/sandbox-core');
  const { provider, store, descriptor } = v2Fixture();
  const visualization = withRequiredDimensions(descriptor, defaultVisualization(descriptor));
  const documentModel = makeModel(descriptor, saveDataSelection ? ['2023'] : [], visualization, [], 'Partitions');
  await store.models.save({ ...documentModel, saveFilters: true, saveDataSelection }, null);
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://fixture.invalid' }); const old = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) { old.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value }); }
  const { createRoot } = await import('react-dom/client'); const root = createRoot(document.getElementById('root'));
  const resolved = []; const original = provider.resolveSelection;
  provider.resolveSelection = async (...args) => { resolved.push(args[0]); return original(...args); };
  const settle = async () => { for (let i = 0; i < 2; i++) await act(async () => { await delay(120); }); };
  try {
    await act(async () => root.render(createElement(Sandbox, { provider, store, selection: { policy: 'latest', partitionIds: ['2024'] } }))); await settle();
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Saved models').click()); await settle();
    await act(async () => document.querySelector('.rds-sb-model-open').click()); await settle();
    assert.deepEqual(resolved.at(-1).partitionIds, [saveDataSelection ? '2023' : '2024']);
  } finally { await act(async () => root.unmount()); dom.window.close(); for (const [key, value] of old) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; } }
});
