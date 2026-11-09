import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { createElement, act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sandbox } from '@rds/sandbox-react';
import { fixture } from './helpers.mjs';

test('SSR shell is accessible, localized and hides unavailable services', () => {
  const { provider } = fixture();
  const markup = renderToStaticMarkup(createElement(Sandbox, { provider, locale: 'pt-BR' }));
  assert.ok(markup.includes('Sandbox de dados'));
  assert.ok(markup.includes('lang="pt-BR"'));
  assert.ok(!markup.includes('Salvar análise'));
  assert.ok(!markup.includes('Exportar CSV'));
  assert.ok(!markup.includes('Pizza'));
  assert.ok(!markup.includes('Dispersão'));
});

test('React lifecycle: provider query, config change, typed filter, save/open, export, unmount', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://local.invalid/' });
  const old = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true })) {
    old.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root'));
  const { provider, store } = fixture();
  const exported = [];
  let capturedModel;
  function Renderer({ model }) { capturedModel = model; return createElement('div', { role: 'img', 'aria-label': model.description }, 'Chart'); }
  const props = { provider, store, host: { exportFiles: async files => { exported.push(files); } }, ChartRenderer: Renderer, locale: 'en-US' };
  const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await delay(170); }); };
  const buttons = () => [...dom.window.document.querySelectorAll('button')];
  const button = label => { const b = buttons().find(b => b.textContent === label); assert.ok(b, `button ${label}`); return b; };
  const click = async label => { await act(async () => button(label).click()); await settle(); };
  const select = async (label, value) => {
    const node = [...dom.window.document.querySelectorAll('label')].find(node => node.firstChild?.textContent === label)?.querySelector('select');
    assert.ok(node, `select ${label}`);
    await act(async () => { node.value = value; node.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); await settle();
  };
  try {
    await act(async () => root.render(createElement(Sandbox, props))); await settle();
    assert.equal(dom.window.document.querySelectorAll('tbody tr').length, 3);
    assert.ok(dom.window.document.body.textContent.includes('39.60'));
    assert.ok(!dom.window.document.querySelector('[role=alert]'));
    await select('Group by', 'plot');
    await select('Compare by', 'campaign');
    await click('Line');
    assert.equal(capturedModel.series.length, 4);
    await click('Save analysis');
    assert.ok(dom.window.document.body.textContent.includes('Analysis saved.'));
    assert.equal((await store.list()).length, 1);
    await click('Export complete CSV + manifest');
    assert.equal(exported.length, 1);
    assert.equal(JSON.parse(exported[0][1].text).rowCount, 11);
    await select('Group by', '');
    await click('Open');
    assert.equal(capturedModel.series.length, 4);
    assert.ok(dom.window.document.body.textContent.includes('Saved analysis opened.'));
    // Choose an integer membership filter via faceted values, not string parsing.
    await act(async () => document.querySelector('.rds-sb-advanced summary').click()); await settle();
    await act(async () => [...document.querySelectorAll('.rds-sb-advanced summary')].find(node => node.textContent === 'Add filter').click()); await settle();
    await select('Field', 'week');
    await select('Operator', 'in');
    const checkbox = [...dom.window.document.querySelectorAll('fieldset input')][0];
    assert.ok(checkbox);
    await act(async () => checkbox.click());
    await click('Apply filter');
    assert.equal(dom.window.document.querySelectorAll('tbody tr').length, 4);
    await click('Clear filters');
    assert.equal(dom.window.document.querySelectorAll('tbody tr').length, 11);
    await act(async () => root.render(createElement(Sandbox, { ...props, locale: 'pt-BR' })));
    await settle();
    assert.ok(dom.window.document.body.textContent.includes('Comparar por'));
    assert.equal(dom.window.document.querySelectorAll('tbody tr').length, 11);
    assert.equal(capturedModel.series.length, 4);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of old) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});

test('ignores provider query responses after unmount even if provider ignores AbortSignal', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root'));
  const { provider } = fixture();
  const original = provider.query;
  let finish, started = false;
  provider.query = async q => { started = true; await new Promise(resolve => { finish = resolve; }); return original(q); };
  try {
    await act(async () => root.render(createElement(Sandbox, { provider })));
    for (let i = 0; i < 3; i++) await act(async () => { await delay(150); });
    assert.ok(started);
    await act(async () => root.unmount());
    finish(); await delay(20);
    assert.equal(dom.window.document.getElementById('root').textContent, '');
  } finally { globalThis.window = oldWindow; globalThis.document = oldDocument; delete globalThis.IS_REACT_ACT_ENVIRONMENT; dom.window.close(); }
});

test('stale results never replace a newer query; partial results block save and export', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root'));
  const { provider, store } = fixture();
  const original = provider.query;
  let first = true, finish, partial = false;
  provider.query = async q => {
    if (first) { first = false; await new Promise(resolve => { finish = resolve; }); }
    const r = await original(q); return partial ? { ...r, complete: false } : r;
  };
  const host = { exportFiles: async () => { throw new Error('must not export partial data'); } };
  const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await delay(150); }); };
  const chooseAggregation = async value => {
    const select = [...dom.window.document.querySelectorAll('label')].find(node => node.firstChild?.textContent === 'Aggregation function').querySelector('select');
    await act(async () => { select.value = value; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); await settle();
  };
  try {
    await act(async () => root.render(createElement(Sandbox, { provider, store, host })));
    await settle(); assert.ok(finish);
    await chooseAggregation('max');
    assert.ok(dom.window.document.body.textContent.includes('11.75'));
    await act(async () => { finish(); await delay(30); });
    assert.ok(!dom.window.document.body.textContent.includes('39.60'));
    partial = true; await chooseAggregation('sum');
    assert.ok(dom.window.document.body.textContent.includes('Incomplete result'));
    for (const label of ['Save analysis', 'Export complete CSV + manifest']) assert.equal([...dom.window.document.querySelectorAll('button')].find(button => button.textContent === label).disabled, true);
  } finally { await act(async () => root.unmount()); globalThis.window = oldWindow; globalThis.document = oldDocument; delete globalThis.IS_REACT_ACT_ENVIRONMENT; dom.window.close(); }
});
