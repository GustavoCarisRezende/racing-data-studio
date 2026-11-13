import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { Sandbox } from '@rds/sandbox-react';
import { createMemoryStore } from '../examples/memory-provider.mjs';
import { syntheticF1 } from './f1-fixture.mjs';

test('real F1 adapter + studio: named selections, seasons, presets, comparison, single right-side bindings, preview and save', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://synthetic.invalid/' });
  const old = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    old.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  const provider = syntheticF1();
  const d = await provider.describeDataset({ datasetId: 'f1.session_results', locale: 'en-US' });
  const store = createMemoryStore(d);
  let model;
  function Renderer(props) { model = props.model; return createElement('div', { role: 'img', 'aria-label': model.description }); }
  const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await delay(140); }); };
  const labels = text => [...document.querySelectorAll('label')].filter(label => label.firstChild?.textContent === text);
  const button = text => { const node = [...document.querySelectorAll('button')].find(b => b.textContent === text); assert.ok(node, text); return node; };
  const click = async text => { await act(async () => button(text).click()); await settle(); };
  const choose = async (node, value) => { assert.ok(node); await act(async () => { node.value = value; node.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); await settle(); };
  const openFilter = async name => { const summary = [...document.querySelectorAll('.rds-sb-quick-filter summary')].find(node => node.textContent.startsWith(name)); assert.ok(summary); await act(async () => { summary.parentElement.open = true; summary.dispatchEvent(new dom.window.Event('toggle', { bubbles: true })); summary.parentElement.dispatchEvent(new dom.window.Event('toggle')); }); await settle(); };
  const checkName = async name => { const label = [...document.querySelectorAll('.rds-sb-facet label')].find(label => label.querySelector('span')?.textContent === name); assert.ok(label, `named choice ${name}`); await act(async () => label.querySelector('input').click()); await settle(); };
  try {
    await act(async () => root.render(createElement(Sandbox, { provider, store, host: { confirm: async () => true }, locale: 'en-US', ChartRenderer: Renderer })));
    await settle();
    await openFilter('Season');
    const selectedSeasons = () => [...document.querySelectorAll('.rds-sb-quick-filter')].find(node => node.querySelector('summary').textContent.startsWith('Season')).querySelectorAll('input:checked');
    assert.equal(selectedSeasons().length, 1);
    assert.equal(selectedSeasons()[0].closest('label').querySelector('span').textContent, '2025');
    assert.equal(button('Line').getAttribute('aria-pressed'), 'true');
    assert.equal(labels('Visualization type').length, 0);
    assert.equal(document.querySelectorAll('.rds-sb-result .rds-sb-bindings').length, 0);
    assert.equal(document.querySelectorAll('tbody tr').length, 42);
    assert.equal(model.series.length, 3);
    assert.ok(model.series.some(s => s.label === 'Ana Lima · 2025'));
    assert.ok(!document.querySelector('tbody').textContent.includes('ana_test'));
    assert.equal(document.querySelectorAll('.rds-sb-dataset-list button').length, 3);
    assert.ok(!document.body.textContent.includes('Moving average'));

    await openFilter('Drivers'); await checkName('Ana Lima');
    assert.equal(document.querySelectorAll('tbody tr').length, 14);
    await checkName('Bruno Reis');
    assert.equal(document.querySelectorAll('tbody tr').length, 28);
    const selected = [...document.querySelectorAll('.rds-sb-quick-filter[open] .rds-sb-facet input:checked')];
    assert.equal(selected.length, 2);
    assert.ok(document.querySelector('.rds-sb-quick-filter[open] .rds-sb-selection-summary').textContent.includes('Ana Lima'));

    await openFilter('Teams'); await checkName('Boreal Racing');
    assert.equal(model.series.length, 1);
    assert.ok(model.series[0].label.includes('Bruno Reis'));
    const allTeams = document.querySelector('.rds-sb-quick-filter[open] .rds-sb-all');
    await act(async () => allTeams.click()); await settle();
    assert.equal(model.series.length, 2);

    await click('Sprint results');
    assert.equal(document.querySelectorAll('tbody tr').length, 6);
    assert.equal(button('Sprint results').getAttribute('aria-pressed'), 'true');
    await openFilter('Rounds'); await checkName('4');
    assert.equal(document.querySelectorAll('tbody tr').length, 2);
    await act(async () => document.querySelector('.rds-sb-quick-filter[open] .rds-sb-all').click()); await settle();
    assert.equal(document.querySelectorAll('tbody tr').length, 6);
    await openFilter('Sessions'); await checkName('Race');
    assert.equal(document.querySelectorAll('tbody tr').length, 28); // Race + Sprint aggregate once per round/driver.
    assert.equal(model.series.find(series => series.label.includes('Ana Lima')).values[3], 26);
    assert.equal(button('Sprint results').getAttribute('aria-pressed'), 'false');
    await checkName('Race');
    assert.equal(document.querySelectorAll('tbody tr').length, 6);
    assert.equal(button('Sprint results').getAttribute('aria-pressed'), 'true');
    await click('Race results');
    await openFilter('Season'); await checkName('2024');
    assert.equal(selectedSeasons().length, 2);
    assert.equal(labels('Comparison selection').length, 0);
    assert.equal(model.series.length, 4);
    assert.ok(model.series.some(s => s.label.includes('2024')));
    assert.equal(document.querySelectorAll('tbody tr').length, 50); // local pagination, not query truncation

    const seriesControls = labels('Group by').map(label => label.querySelector('select'));
    assert.equal(seriesControls.length, 1);
    await choose(seriesControls[0], 'team');
    assert.equal(labels('Group by')[0].querySelector('select').value, 'team');
    assert.ok(model.series.some(s => s.label.includes('Aurora Motors')));
    await choose(labels('Group by')[0].querySelector('select'), 'driver');
    await click('Bar'); assert.equal(model.kind, 'bar');
    await click('Line'); assert.equal(model.kind, 'line');
    const preview = document.querySelector('.rds-sb-preview');
    assert.ok(preview.open);
    await act(async () => { preview.open = false; }); assert.equal(preview.open, false);
    await click('Save model');
    assert.equal((await store.models.list()).length, 1);
    await click('Open');
    assert.equal(model.series.length, 4);
    await openFilter('Season');
    assert.equal(selectedSeasons().length, 2);
    await click('Clear filters');
    assert.equal(selectedSeasons().length, 2);
    assert.equal(button('Race results').getAttribute('aria-pressed'), 'true');
    assert.equal(model.series.length, 6);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, value] of old) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; }
  }
});
