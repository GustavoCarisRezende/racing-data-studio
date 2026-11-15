import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { Sandbox } from '@rds/sandbox-react';
import { createMemoryModelStore } from '../examples/memory-provider.mjs';
import { v3Fixture } from './v3-fixture.mjs';

test('event unification control follows explicit selections, queries and persisted models', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://fixture.invalid' });
  const old = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    old.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  const { descriptor, provider } = v3Fixture();
  descriptor.capabilities.eventUnification = { fieldId: 'phase', requiredValues: ['a-final', 'z-prior'] };
  descriptor.fields.find(f => f.id === 'phase').valueLabels = [
    { value: 'a-final', label: { fallback: 'Race' } },
    { value: 'z-prior', label: { fallback: 'Sprint' } },
  ];
  const describe = provider.describeDataset;
  provider.describeDataset = async (...args) => {
    const d = await describe(...args);
    d.capabilities.eventUnification = descriptor.capabilities.eventUnification;
    d.fields.find(f => f.id === 'phase').valueLabels = descriptor.fields.find(f => f.id === 'phase').valueLabels;
    return d;
  };
  const queries = [], query = provider.query;
  provider.query = async (request, signal) => {
    queries.push(request);
    const { unifyEvents, ...legacy } = request;
    const result = await query(legacy, signal);
    if (!unifyEvents) return result;
    // The provider owns consolidation: emulate selecting the final chronological value.
    const rows = result.rows.filter(row => row.values.phase === 'a-final');
    return { ...result, rows, totalRows: rows.length };
  };
  const store = { modelsV3: createMemoryModelStore(descriptor, 3), list: async () => [], load: async () => null, save: async () => { throw Error('unused'); } };
  let chart;
  const Renderer = ({ model }) => { chart = model; return createElement('div', { role: 'img' }); };
  const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await delay(120); }); };
  const click = async text => { const button = [...document.querySelectorAll('button')].find(b => b.textContent === text); assert.ok(button, text); await act(async () => button.click()); await settle(); };
  const checkbox = () => [...document.querySelectorAll('.rds-sb-config label')].find(l => l.textContent === 'Unify events')?.querySelector('input');
  const legendCheckbox = () => [...document.querySelectorAll('.rds-sb-config label')].find(l => l.textContent === 'Unify legends')?.querySelector('input');
  const facet = () => [...document.querySelectorAll('.rds-sb-quick-filter')].find(d => d.querySelector('summary').textContent.startsWith('Visit'));
  const selectVisit = async name => {
    const label = [...facet().querySelectorAll('.rds-sb-facet label')].find(l => l.querySelector('span').textContent === name);
    assert.ok(label, name); await act(async () => label.querySelector('input').click()); await settle();
  };
  try {
    await act(async () => root.render(createElement(Sandbox, { provider, store, ChartRenderer: Renderer }))); await settle();
    const select = [...document.querySelectorAll('label')].find(l => l.firstChild?.textContent === 'Metric').querySelector('select');
    await act(async () => { select.value = '@calc:all-visits-v1'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); await settle();
    assert.ok(checkbox().closest('details').closest('aside.rds-sb-config'));
    assert.equal(checkbox().closest('details').querySelector('summary').textContent, 'Chart behavior');
    assert.equal(checkbox().disabled, true, 'no explicit visit selection');
    assert.equal(checkbox().checked, true, 'new preference remains checked while ineligible');
    assert.equal(legendCheckbox().checked, true);
    await act(async () => legendCheckbox().click()); await settle();
    await act(async () => facet().querySelector('summary').click()); await settle();
    await selectVisit('Race');
    assert.equal(checkbox().disabled, true, 'one visit selected');
    assert.equal(checkbox().checked, true, 'ineligible selection does not erase preference');
    await selectVisit('Sprint');
    assert.equal(checkbox().disabled, false);
    assert.equal(queries.at(-1).unifyEvents, true);
    assert.ok(chart.series.every(s => !s.label.includes('Race') && !s.label.includes('Sprint')));
    await act(async () => checkbox().click()); await settle();
    assert.equal(queries.at(-1).unifyEvents, undefined);
    await act(async () => checkbox().click()); await settle();
    await click('Table');
    assert.ok(document.querySelector('tbody').textContent.includes('Unified events'));
    assert.ok(!document.querySelector('tbody').textContent.includes('Race'));
    await click('Save model'); await click('Confirm');
    const saved = await store.modelsV3.load((await store.modelsV3.list())[0].id);
    assert.equal(saved.visualization.unifyEvents, true);
    assert.equal(saved.visualization.unifyLegends, false);
    assert.equal(queries.at(-1).unifyLegends, undefined);
    await selectVisit('Sprint');
    assert.equal(checkbox().disabled, true);
    assert.equal(checkbox().checked, true, 'ineligible query retains the saved preference');
    assert.equal(queries.at(-1).unifyEvents, undefined, 'no silent unification when selection becomes ineligible');
    await click('Saved models');
    await act(async () => document.querySelector('.rds-sb-model-card button[aria-label^="Edit model:"]').click()); await settle();
    if (document.querySelector('[role="alertdialog"]')) await click('Confirm');
    assert.equal(checkbox().checked, true);
    assert.equal(legendCheckbox().checked, false);
    assert.equal(queries.at(-1).unifyEvents, true);
    if (!facet().open) { await act(async () => facet().querySelector('summary').click()); await settle(); }
    await selectVisit('Sprint');
    await selectVisit('Race');
    assert.equal(checkbox().disabled, true, 'no explicit sessions selected');
    assert.equal(checkbox().checked, true);
    assert.equal(queries.at(-1).unifyEvents, undefined);
    const legacy = structuredClone(saved);
    legacy.id = 'legacy-no-unification';
    legacy.revision = null;
    legacy.title = 'Legacy unification';
    delete legacy.visualization.unifyEvents;
    await store.modelsV3.save(legacy, null);
    await click('Saved models');
    await click('Refresh model list');
    const card = [...document.querySelectorAll('.rds-sb-model-card')].find(node => node.textContent.includes('Legacy unification'));
    assert.ok(card);
    await act(async () => card.querySelector('button[aria-label^="Edit model:"]').click()); await settle();
    if (document.querySelector('[role="alertdialog"]')) await click('Confirm');
    assert.equal(checkbox().checked, false, 'legacy missing preference remains false');
    assert.equal(queries.at(-1).unifyEvents, undefined);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, value] of old) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; }
  }
});
