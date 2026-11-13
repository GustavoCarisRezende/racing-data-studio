import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { Sandbox } from '@rds/sandbox-react';
import { defaultVisualization } from '@rds/sandbox-core';
import { v3Fixture } from './v3-fixture.mjs';

test('profile UI routes round/visit crops after calculation, retains fourth dimension, and only persists via opt-in model store v3', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://fixture.invalid' });
  const old = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) { old.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value }); }
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  const { provider, store, storeV3, chronology } = v3Fixture();
  const describe = provider.describeDataset;
  provider.describeDataset = async (...args) => {
    const d = await describe(...args);
    d.presentation = { views: [{ id: 'final-visits', label: { fallback: 'Final visits' }, visualization: { ...defaultVisualization(d), kind: 'line', series: 'plot' }, filters: [{ fieldId: 'phase', op: 'in', values: ['a-final'] }] }] };
    return d;
  };
  const queries = [], resolutions = [];
  const query = provider.query, resolve = provider.resolveSelection;
  provider.query = async (...args) => { queries.push(args[0]); return query(...args); };
  provider.resolveSelection = async (...args) => { resolutions.push(args[0]); return resolve(...args); };
  const Renderer = ({ model }) => createElement('div', { role: 'img', 'aria-label': model.description });
  const props = { provider, ChartRenderer: Renderer };
  const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await delay(150); }); };
  const choose = async (label, value) => { const s = [...document.querySelectorAll('label')].find(l => l.firstChild?.textContent === label)?.querySelector('select'); assert.ok(s, label); await act(async () => { s.value = value; s.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); await settle(); };
  const click = async text => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === text); assert.ok(b, text); await act(async () => b.click()); await settle(); };
  const filter = async (field, value) => {
    const details = [...document.querySelectorAll('.rds-sb-quick-filter')].find(node => node.querySelector('summary').textContent.startsWith(field));
    assert.ok(details, field); await act(async () => details.querySelector('summary').click()); await settle();
    const label = [...details.querySelectorAll('.rds-sb-facet label')].find(label => label.querySelector('span').textContent === value);
    assert.ok(label, `${field}=${value}`); await act(async () => label.querySelector('input').click()); await settle();
  };
  try {
    await act(async () => root.render(createElement(Sandbox, { ...props, store }))); await settle();
    assert.equal(queries.at(-1).protocolVersion, 1);
    assert.ok(!document.body.textContent.includes('Calculation profile'));
    await choose('Metric', '@calc:all-visits-v1');
    assert.equal(queries.at(-1).protocolVersion, 3);
    assert.deepEqual(queries.at(-1).window.partitionBy, ['plot', 'campaign']);
    assert.equal(document.querySelectorAll('th').length, 5);
    const extra = [...document.querySelectorAll('.rds-sb-bindings fieldset label')].find(label => label.textContent === 'Visit').querySelector('input');
    assert.ok(extra.checked && extra.closest('fieldset').disabled);
    await filter('Week', '2'); await filter('Visit', 'a-final');
    assert.deepEqual(queries.at(-1).filters, []);
    assert.deepEqual(queries.at(-1).displayFilters.map(f => f.fieldId), ['week', 'phase']);
    assert.equal(document.querySelectorAll('tbody tr').length, 3);
    assert.ok(document.querySelector('tbody').textContent.includes('22.00'));
    assert.ok(document.querySelector('.rds-sb-filter-routing').textContent.includes('Display-only filters'));
    assert.equal([...document.querySelectorAll('.rds-sb-dataset-list button')].find(b => b.textContent === 'Final visits').getAttribute('aria-pressed'), 'false', 'a legacy population preset must not be marked active for a v3 cumulative crop');
    const save = [...document.querySelectorAll('button')].find(b => b.textContent === 'Save model');
    assert.ok(save.disabled);
    assert.ok(document.body.textContent.includes('requires AnalysisStore.modelsV3'));
    assert.deepEqual(await store.models.list(), []);
    await act(async () => root.render(createElement(Sandbox, { ...props, store: storeV3 }))); await settle();
    await click('Save model');
    const saved = await storeV3.modelsV3.load((await storeV3.modelsV3.list())[0].id);
    assert.equal(saved.documentVersion, 3);
    assert.deepEqual(saved.visualization.extraDimensions, ['phase']);
    await click('Open');
    assert.equal(resolutions.at(-1).policy, 'latest');
    assert.equal(queries.at(-1).window.profileId, 'all-visits-v1');
    assert.equal(document.querySelectorAll('th').length, 5);
    chronology.delete(JSON.stringify(['2024', 1, 'z-prior']));
    await click('Open');
    assert.ok(document.querySelector('[role=alert]').textContent.includes('complete, unambiguous chronology'));
    assert.equal(document.querySelector('tbody'), null);
    assert.ok([...document.querySelectorAll('button')].find(b => b.textContent === 'Save model').disabled);
    await choose('Metric', 'harvest');
    assert.equal(queries.at(-1).protocolVersion, 1);
    assert.equal(queries.at(-1).window, undefined);
    assert.ok(queries.at(-1).filters.some(f => f.fieldId === 'phase'));
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, value] of old) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; }
  }
});
