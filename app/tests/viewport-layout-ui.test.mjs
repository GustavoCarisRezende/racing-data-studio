import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const require = createRequire(new URL('../../packages/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
let dom, vite, React, act, createRoot, App;
before(async () => {
  dom = new JSDOM('<html><body><div id="fixture"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLDialogElement', 'Event', 'KeyboardEvent', 'MutationObserver']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : name === 'document' ? dom.window.document : dom.window[name] });
  }
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.isTauri = true;
  vite = await createServer({ configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' });
  ({ App } = await vite.ssrLoadModule('/src/main.tsx'));
  React = await import('react'); ({ act } = React);
  ({ createRoot } = await import('react-dom/client'));
});
after(async () => { dom?.window.close(); await vite?.close(); });

test('the actual shell keeps the title compact at 80% and updates after a real height change', async () => {
  let baseHeight = 800, factor = 1;
  const resize = () => {
    Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: Math.ceil(1536 / factor) });
    Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: Math.ceil(baseHeight / factor) });
    dom.window.dispatchEvent(new dom.window.Event('resize'));
  };
  resize();
  dom.window.localStorage.setItem('racing-data-studio.tutorial.v1', '{"version":1,"status":"completed"}');
  dom.window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
    if (command === 'set_application_zoom') { factor = args.factor; resize(); return factor; }
    if (command === 'update_status') return { enabled: false, phase: 'disabled', currentVersion: '0.0.1-beta.1', version: null, notes: null, downloaded: 0, total: null, error: null };
    if (command === 'f1_local_seasons' || command === 'f1_remote_seasons') return [];
    if (command === 'f1_sync_status') return null;
    throw Error(`Unexpected synthetic command ${command}`);
  } };
  const settle = () => new Promise(resolve => dom.window.requestAnimationFrame(() => dom.window.requestAnimationFrame(resolve)));
  const root = createRoot(document.querySelector('#fixture'));
  try {
    await act(async () => { root.render(React.createElement(App)); await settle(); });
    await act(async () => { document.querySelector('[data-tutorial-target=category-f1]').click(); await settle(); });
    assert.equal(document.querySelector('.app-shell').classList.contains('app-shell--compact'), true);
    for (let i = 0; i < 2; i++) {
      await act(async () => { document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: '-', ctrlKey: true, cancelable: true })); await settle(); });
    }
    assert.equal(factor, 0.8);
    assert.equal(dom.window.innerHeight, 1000);
    assert.equal(document.querySelector('.app-shell').classList.contains('app-shell--compact'), true);
    baseHeight = 1000;
    await act(async () => { resize(); await settle(); });
    assert.equal(document.querySelector('.app-shell').classList.contains('app-shell--compact'), false);
  } finally {
    await act(async () => root.unmount());
    dom.window.localStorage.clear();
  }
});
