import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../packages/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
let vite, dom, React, act, createRoot, UpdateDialog;
before(async () => {
  vite = await createServer({ configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)), server: { middlewareMode: true }, appType: 'custom' });
  ({ UpdateDialog } = await vite.ssrLoadModule('/src/update-dialog.tsx'));
  dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost/' });
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLDialogElement', 'Event', 'MouseEvent']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : name === 'document' ? dom.window.document : dom.window[name] });
  }
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.isTauri = true;
  React = await import('react'); ({ act } = React);
  ({ createRoot } = await import('react-dom/client'));
});
after(async () => { dom?.window.close(); await vite?.close(); });

test('real update dialog requires two clicks to install, blocks dirty edits, and treats notes as text', async () => {
  let status = { enabled: true, phase: 'ready', currentVersion: '0.0.1-beta.1', version: '0.0.1-beta.2', notes: '<img src=x onerror=alert(1)>', downloaded: 10, total: 10, error: null };
  const calls = [];
  dom.window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
    calls.push([command, args]);
    if (command === 'update_status') return { ...status };
    if (command === 'update_install') return undefined;
    throw Error(`Unexpected command ${command}`);
  } };
  const root = createRoot(document.querySelector('#root'));
  const props = { locale: 'en-US', open: true, onClose() {}, onOpen() {}, blocked: false };
  await act(async () => { root.render(React.createElement(UpdateDialog, { ...props, dirty: true })); });
  assert.equal(document.querySelector('pre img'), null);
  assert.equal(document.querySelector('pre').textContent, status.notes);
  let install = [...document.querySelectorAll('button')].find(button => button.textContent === 'Install and restart');
  assert.equal(install.disabled, true);
  await act(async () => { root.render(React.createElement(UpdateDialog, { ...props, dirty: false })); });
  install = [...document.querySelectorAll('button')].find(button => button.textContent === 'Install and restart');
  await act(async () => install.click());
  assert.equal(calls.some(([command]) => command === 'update_install'), false);
  assert.ok(document.body.textContent.includes('application will close'));
  await act(async () => install.click());
  assert.deepEqual(calls.find(([command]) => command === 'update_install'), ['update_install', { confirmed: true }]);
  await act(async () => root.unmount());
});

test('opt-in startup download never installs or restarts automatically', async () => {
  let startup;
  const originalTimer = dom.window.setTimeout.bind(dom.window);
  dom.window.setTimeout = (callback, delay, ...args) => {
    if (delay === 5000) { startup = callback; return 0; }
    return originalTimer(callback, delay, ...args);
  };
  dom.window.localStorage.setItem('rds.updates.autoDownload', 'true');
  const status = { enabled: true, phase: 'idle', currentVersion: '0.0.1-beta.1', version: null, notes: null, downloaded: 0, total: null, error: null };
  const calls = [];
  dom.window.__TAURI_INTERNALS__ = { invoke: async command => {
    calls.push(command);
    if (command === 'update_status') return { ...status };
    if (command === 'update_check') return { ...status, phase: 'available', version: '0.0.1-beta.2' };
    if (command === 'update_download') return { ...status, phase: 'ready', version: '0.0.1-beta.2' };
    throw Error(`Unexpected command ${command}`);
  } };
  const root = createRoot(document.querySelector('#root'));
  try {
    await act(async () => root.render(React.createElement(UpdateDialog, { locale: 'pt-BR', open: false, dirty: false, blocked: false, onOpen() {}, onClose() {} })));
    assert.equal(calls.includes('update_check'), false);
    await act(async () => { startup(); await Promise.resolve(); await Promise.resolve(); });
    assert.equal(calls.filter(command => command === 'update_download').length, 1);
    assert.equal(calls.includes('update_install'), false);
    assert.match(document.querySelector('.update-notice').textContent, /atualização disponível/);
  } finally {
    await act(async () => root.unmount());
    dom.window.localStorage.removeItem('rds.updates.autoDownload');
    dom.window.setTimeout = originalTimer;
  }
});
