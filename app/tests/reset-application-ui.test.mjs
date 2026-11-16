import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { TUTORIAL_STORAGE_KEY } from '../src/onboarding.ts';

const requireFromPackages = createRequire(new URL('../../packages/package.json', import.meta.url));
const { JSDOM } = requireFromPackages('jsdom');
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let vite;
let React;
let act;
let createRoot;
let App;
let dom;

before(async () => {
  // Deliberately omit #root while importing main.tsx: tests mount the exported App
  // themselves and must never exercise the normal application entrypoint.
  dom = new JSDOM('<!doctype html><html><body><main id="fixture"></main></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  for (const name of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'HTMLDialogElement', 'MutationObserver', 'Event', 'MouseEvent', 'KeyboardEvent', 'navigator', 'localStorage']) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: name === 'window' ? dom.window
        : name === 'document' ? dom.window.document
          : name === 'navigator' ? dom.window.navigator
            : name === 'localStorage' ? dom.window.localStorage
            : dom.window[name],
    });
  }
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  vite = await createServer({
    configFile: path.join(appRoot, 'vite.config.ts'),
    server: { middlewareMode: true },
    appType: 'custom',
  });
  ({ App } = await vite.ssrLoadModule('/src/main.tsx'));
  React = await import('react');
  ({ act } = React);
  ({ createRoot } = await import('react-dom/client'));
});

after(async () => {
  dom?.window.close();
  await vite?.close();
});

const tutorialStatus = JSON.stringify({ version: 1, status: 'completed' });

function mountApp({ desktop = true, invoke = async () => undefined } = {}) {
  const mount = document.querySelector('#fixture');
  mount.replaceChildren();
  localStorage.setItem(TUTORIAL_STORAGE_KEY, tutorialStatus);

  const calls = [];
  const ipc = {
    invoke: async (...args) => {
      calls.push(args);
      return invoke(...args);
    },
  };
  globalThis.isTauri = desktop;
  dom.window.isTauri = desktop;
  globalThis.__TAURI_INTERNALS__ = ipc;
  dom.window.__TAURI_INTERNALS__ = ipc;

  const root = createRoot(mount);
  act(() => root.render(React.createElement(App)));

  return {
    mount,
    calls,
    root,
    async click(selector) {
      const element = mount.querySelector(selector);
      assert.ok(element, `missing ${selector}`);
      await act(async () => {
        element.click();
        await Promise.resolve();
        await Promise.resolve();
      });
    },
    cleanup() {
      act(() => root.unmount());
      mount.replaceChildren();
    },
  };
}

async function openResetDialog(ui) {
  await ui.click('.tutorial-menu summary');
  assert.equal(ui.mount.querySelector('.tutorial-menu').open, true);
  await ui.click('.reset-menu-option');
  assert.equal(ui.mount.querySelector('.tutorial-menu').open, false);
  assert.equal(ui.mount.querySelector('.reset-dialog').open, true);
}

test('menu renders separator and red reset option; opening and cancelling invokes no IPC', async () => {
  const ui = mountApp();
  try {
    const menu = ui.mount.querySelector('.tutorial-menu-options');
    assert.ok(menu.querySelector('button'));
    assert.ok(menu.querySelector('hr'));
    const resetOption = menu.querySelector('.reset-menu-option');
    assert.equal(resetOption.textContent, 'Restore Default Settings');
    const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
    assert.match(css, /\.tutorial-menu-options \.reset-menu-option\s*\{\s*color:#ff8295;/);

    await openResetDialog(ui);
    assert.equal(ui.calls.length, 0);
    assert.equal(document.activeElement, ui.mount.querySelector('.reset-dialog-actions button:last-child'));
    const buttons = [...ui.mount.querySelectorAll('.reset-dialog-actions button')];
    assert.deepEqual(buttons.map((button) => button.textContent), ['Confirm reset', 'Cancel']);
    assert.equal(localStorage.getItem(TUTORIAL_STORAGE_KEY), tutorialStatus);

    await ui.click('.reset-dialog-actions button:last-child');
    assert.equal(ui.mount.querySelector('.reset-dialog').open, false);
    assert.equal(ui.calls.length, 0);
    assert.equal(localStorage.getItem(TUTORIAL_STORAGE_KEY), tutorialStatus);
  } finally {
    ui.cleanup();
  }
});

test('explicit confirmation invokes the reset command exactly once and keeps both actions disabled while pending', async () => {
  let resolveReset;
  const pendingReset = new Promise((resolve) => { resolveReset = resolve; });
  const ui = mountApp({ invoke: () => pendingReset });
  try {
    await openResetDialog(ui);
    const confirm = ui.mount.querySelector('.reset-dialog-actions button:first-child');
    await ui.click('.reset-dialog-actions button:first-child');
    assert.deepEqual(ui.calls, [['reset_application', {}, undefined]]);
    assert.equal(confirm.disabled, true);
    assert.equal(ui.mount.querySelector('.reset-dialog-actions button:last-child').disabled, true);
    assert.match(ui.mount.querySelector('[role="status"]').textContent, /Resetting and restarting/);

    // Even a direct duplicate click cannot start a second IPC request.
    await ui.click('.reset-dialog-actions button:first-child');
    assert.equal(ui.calls.length, 1);
    resolveReset();
    await act(async () => { await pendingReset; await Promise.resolve(); });
    assert.equal(ui.mount.querySelector('.reset-dialog').open, true);
    assert.equal(localStorage.getItem(TUTORIAL_STORAGE_KEY), tutorialStatus);
  } finally {
    ui.cleanup();
  }
});

test('IPC rejection leaves the tutorial marker intact, displays a recoverable error and allows retry', async () => {
  let attempts = 0;
  const ui = mountApp({
    invoke: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('mocked IPC rejection');
      return undefined;
    },
  });
  try {
    await openResetDialog(ui);
    await ui.click('.reset-dialog-actions button:first-child');
    assert.deepEqual(ui.calls, [['reset_application', {}, undefined]]);
    assert.equal(ui.mount.querySelector('.reset-dialog').open, true);
    assert.match(ui.mount.querySelector('[role="alert"]').textContent, /No data was changed/);
    assert.equal(ui.mount.querySelector('.reset-dialog-actions button:first-child').disabled, false);
    assert.equal(ui.mount.querySelector('.reset-dialog-actions button:last-child').disabled, false);
    assert.equal(localStorage.getItem(TUTORIAL_STORAGE_KEY), tutorialStatus);

    await ui.click('.reset-dialog-actions button:first-child');
    assert.deepEqual(ui.calls, [['reset_application', {}, undefined], ['reset_application', {}, undefined]]);
    assert.equal(ui.mount.querySelector('.reset-dialog-actions button:first-child').disabled, true);
    assert.equal(localStorage.getItem(TUTORIAL_STORAGE_KEY), tutorialStatus);
  } finally {
    ui.cleanup();
  }
});

test('browser build disables reset with an explanation and cannot invoke native IPC', async () => {
  const ui = mountApp({ desktop: false });
  try {
    const option = ui.mount.querySelector('.reset-menu-option');
    assert.equal(option.disabled, true);
    assert.equal(option.title, 'Available only in the desktop application.');
    await ui.click('.tutorial-menu summary');
    option.click();
    assert.equal(ui.mount.querySelector('.reset-dialog').open, false);
    assert.deepEqual(ui.calls, []);
    assert.equal(localStorage.getItem(TUTORIAL_STORAGE_KEY), tutorialStatus);
  } finally {
    ui.cleanup();
  }
});
