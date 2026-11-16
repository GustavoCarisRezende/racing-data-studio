import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { Sandbox } from '@rds/sandbox-react';
import { v2Fixture } from './v2-fixture.mjs';

test('optional tutorial targets follow DOM lifecycle and callback changes', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://fixture.invalid' });
  const old = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    old.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  const { provider, store } = v2Fixture();
  const host = { exportFiles: async () => {} };
  const first = new Map(), second = new Map(), calls = [];
  const collect = map => (name, element) => { calls.push([map, name, element]); if (element) map.set(name, element); else map.delete(name); };
  const a = collect(first), b = collect(second);
  const render = callback => root.render(createElement(Sandbox, { provider, store, host, tutorialTargets: callback }));
  const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await delay(150); }); };
  try {
    await act(async () => render(a)); await settle();
    for (const name of ['models', 'filters', 'seasons', 'chart-types', 'mode-switch', 'fields', 'behavior', 'visualization-title', 'save', 'export']) {
      assert.ok(first.get(name) instanceof dom.window.HTMLElement, name);
    }
    assert.ok(first.get('seasons').classList.contains('rds-sb-quick-filter'));
    const count = calls.length;
    await act(async () => render(a));
    assert.equal(calls.length, count, 'ordinary rerender keeps refs stable');
    await act(async () => render(b));
    assert.equal(first.size, 0);
    assert.equal(second.size, 10);
    await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === 'View mode').click());
    assert.ok(!second.has('fields') && !second.has('behavior'));
    await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Edit mode').click());
    assert.ok(second.has('fields') && second.has('behavior'));
    await act(async () => render(undefined));
    assert.equal(second.size, 0);
    assert.ok(document.querySelector('.rds-sandbox'));
    await act(async () => render(b));
    assert.equal(second.size, 10);
    await act(async () => root.unmount());
    assert.equal(second.size, 0);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of old) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key];
  }
});
