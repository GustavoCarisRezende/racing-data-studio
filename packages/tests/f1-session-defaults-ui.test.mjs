import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { Sandbox } from '@rds/sandbox-react';
import { createMemoryModelStore } from '../examples/memory-provider.mjs';
import { syntheticF1 } from './f1-fixture.mjs';

test('F1 session defaults are explicit for new visualizations and saved race-only models remain unchanged', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://fixture.invalid' });
  const old = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    old.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  const provider = syntheticF1(), query = provider.query;
  const descriptor = await provider.describeDataset({ datasetId: 'f1.session_results', locale: 'en-US' });
  const queries = [];
  provider.query = async (...args) => { queries.push(args[0]); return query(...args); };
  const store = { modelsV3: createMemoryModelStore(descriptor, 3), list: async () => [], load: async () => null, save: async () => { throw Error('unused'); } };
  const Renderer = () => createElement('div', { role: 'img' });
  const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await delay(120); }); };
  const click = async text => { const b = [...document.querySelectorAll('button')].find(node => node.textContent === text); assert.ok(b, text); await act(async () => b.click()); await settle(); };
  const facet = () => [...document.querySelectorAll('.rds-sb-quick-filter')].find(node => node.querySelector('summary').textContent.startsWith('Session'));
  const openFacet = async () => { if (!facet().open) { await act(async () => facet().querySelector('summary').click()); await settle(); } };
  const option = text => { const label = [...facet().querySelectorAll('.rds-sb-facet label')].find(node => node.querySelector('span').textContent === text); assert.ok(label, text); return label.querySelector('input'); };
  try {
    await act(async () => root.render(createElement(Sandbox, { provider, store, ChartRenderer: Renderer }))); await settle();
    await openFacet();
    assert.equal(option('Race').checked, true);
    assert.equal(option('Sprint').checked, true);
    assert.deepEqual(queries.at(-1).filters.find(f => f.fieldId === 'session').values, ['results', 'sprint']);
    assert.equal(queries.at(-1).unifyEvents, true);
    await act(async () => option('Sprint').click()); await settle();
    assert.equal(option('Sprint').checked, false);
    assert.deepEqual(queries.at(-1).filters.find(f => f.fieldId === 'session').values, ['results']);
    assert.equal(queries.at(-1).unifyEvents, undefined);
    await click('Save model'); await click('Confirm');
    const saved = await store.modelsV3.load((await store.modelsV3.list())[0].id);
    assert.deepEqual(saved.filters.find(f => f.fieldId === 'session').values, ['results']);
    await click('Saved models'); await click('New visualization');
    await openFacet();
    assert.equal(option('Race').checked, true);
    assert.equal(option('Sprint').checked, true);
    assert.equal(queries.at(-1).unifyEvents, true);
    await click('Saved models');
    await act(async () => document.querySelector('.rds-sb-model-card .rds-sb-model-open').click()); await settle();
    if (document.querySelector('[role="alertdialog"]')) await click('Confirm');
    await openFacet();
    assert.equal(option('Race').checked, true);
    assert.equal(option('Sprint').checked, false);
    assert.deepEqual(queries.at(-1).filters.find(f => f.fieldId === 'session').values, ['results']);
    assert.equal(queries.at(-1).unifyEvents, undefined);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, value] of old) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; }
  }
});
