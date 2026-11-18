import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { ZOOM_STORAGE_KEY } from '../src/zoom.ts';

const require = createRequire(new URL('../../packages/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
let vite, dom, React, act, createRoot, ZoomControls;
before(async () => {
  vite = await createServer({ configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' });
  ({ ZoomControls } = await vite.ssrLoadModule('/src/zoom-controls.tsx'));
  dom = new JSDOM('<html><body><div id="fixture"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'KeyboardEvent']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : name === 'document' ? dom.window.document : dom.window[name] });
  }
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  React = await import('react'); ({ act } = React);
  ({ createRoot } = await import('react-dom/client'));
});
after(async () => { dom?.window.close(); await vite?.close(); });

test('native zoom restores, responds to Ctrl/Cmd shortcuts, persists, and survives a remount', async () => {
  globalThis.isTauri = true;
  dom.window.localStorage.setItem(ZOOM_STORAGE_KEY, '0.9');
  const calls = [];
  dom.window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
    assert.equal(command, 'set_application_zoom'); calls.push(args.factor); return args.factor;
  } };
  let root = createRoot(document.querySelector('#fixture'));
  const render = () => React.createElement(ZoomControls, { locale: 'en-US' });
  try {
    await act(async () => root.render(render()));
    assert.equal(document.querySelector('output').textContent, '90%');
    for (const [key, modifier] of [['=', 'ctrlKey'], ['-', 'ctrlKey'], ['0', 'metaKey'], ['+', 'ctrlKey']]) {
      await act(async () => {
        const event = new dom.window.KeyboardEvent('keydown', { key, [modifier]: true, bubbles: true, cancelable: true });
        document.dispatchEvent(event);
        assert.equal(event.defaultPrevented, true);
      });
    }
    assert.deepEqual(calls, [0.9, 1, 0.9, 1, 1.1]);
    assert.equal(dom.window.localStorage.getItem(ZOOM_STORAGE_KEY), '1.1');
    await act(async () => root.unmount());
    root = createRoot(document.querySelector('#fixture'));
    await act(async () => root.render(render()));
    assert.equal(calls.at(-1), 1.1);
    assert.equal(document.querySelector('output').textContent, '110%');
  } finally {
    await act(async () => root.unmount());
    dom.window.localStorage.removeItem(ZOOM_STORAGE_KEY);
  }
});

test('native rejection shows localized error and browser preview never invokes zoom IPC', async () => {
  globalThis.isTauri = true;
  let calls = 0;
  dom.window.__TAURI_INTERNALS__ = { invoke: async () => { calls++; throw Error('unavailable'); } };
  let root = createRoot(document.querySelector('#fixture'));
  await act(async () => root.render(React.createElement(ZoomControls, { locale: 'pt-BR' })));
  await act(async () => document.querySelector('button').click());
  assert.match(document.querySelector('[role=alert]').textContent, /Não foi possível alterar/);
  assert.equal(document.querySelector('output').textContent, '100%');
  assert.equal(dom.window.localStorage.getItem(ZOOM_STORAGE_KEY), null);
  await act(async () => root.unmount());
  globalThis.isTauri = false;
  root = createRoot(document.querySelector('#fixture'));
  await act(async () => root.render(React.createElement(ZoomControls, { locale: 'en-US' })));
  assert.ok([...document.querySelectorAll('button')].every(button => button.disabled));
  await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: '+', ctrlKey: true })));
  assert.equal(calls, 1);
  await act(async () => root.unmount());
});
