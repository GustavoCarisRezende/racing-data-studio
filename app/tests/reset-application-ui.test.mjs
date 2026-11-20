import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
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
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ measureText: text => ({ width: String(text).length * 7 }) });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  vite = await createServer({
    configFile: path.join(appRoot, 'vite.config.ts'),
    server: { middlewareMode: true, watch: null, ws: false },
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

async function mountApp({ desktop = true, invoke = async () => undefined, resetStatus = 'unchanged' } = {}) {
  const mount = document.querySelector('#fixture');
  mount.replaceChildren();
  localStorage.setItem(TUTORIAL_STORAGE_KEY, tutorialStatus);

  const calls = [];
  const readOnlyCalls = [];
  const ipc = {
    invoke: async (...args) => {
      if (args[0] === 'reset_status') return resetStatus;
      if (args[0] === 'update_status') {
        readOnlyCalls.push(args);
        return { enabled: false, phase: 'disabled', currentVersion: '0.0.1-beta.1', version: null, notes: null, downloaded: 0, total: null, error: null };
      }
      calls.push(args);
      return invoke(...args);
    },
  };
  globalThis.isTauri = desktop;
  dom.window.isTauri = desktop;
  globalThis.__TAURI_INTERNALS__ = ipc;
  dom.window.__TAURI_INTERNALS__ = ipc;

  const root = createRoot(mount);
  await act(async () => { root.render(React.createElement(App)); });

  return {
    mount,
    calls,
    readOnlyCalls,
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

async function waitFor(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = check();
    if (result) return result;
    await act(async () => { await delay(50); });
  }
  assert.fail('Expected UI state did not appear');
}

async function openResetDialog(ui) {
  await ui.click('.tutorial-menu summary');
  assert.equal(ui.mount.querySelector('.tutorial-menu').open, true);
  await ui.click('.reset-menu-option');
  assert.equal(ui.mount.querySelector('.tutorial-menu').open, false);
  assert.equal(ui.mount.querySelector('.reset-dialog').open, true);
}

test('hamburger menu stays open for inside interaction and closes on outside pointerdown', async () => {
  const ui = await mountApp();
  try {
    await ui.click('.tutorial-menu summary');
    const menu = ui.mount.querySelector('.tutorial-menu');
    assert.equal(menu.open, true);
    await act(async () => {
      ui.mount.querySelector('.zoom-controls-row').dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
    });
    assert.equal(menu.open, true);
    await act(async () => {
      ui.mount.querySelector('.masthead .brand').dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
    });
    assert.equal(menu.open, false);
    assert.equal(ui.calls.length, 0);
    assert.doesNotMatch(ui.mount.textContent, /Fit uses 85%|Ajuste entre 85%/);
    await ui.click('.tutorial-menu summary');
    await act(async () => menu.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(menu.open, false);
  } finally { ui.cleanup(); }
});

test('menu renders reset option; opening/canceling never invokes a mutating IPC (startup updater status is read-only)', async () => {
  const ui = await mountApp();
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
    assert.deepEqual(ui.readOnlyCalls, [['update_status', {}, undefined]]);
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
  const ui = await mountApp({ invoke: () => pendingReset });
  try {
    await openResetDialog(ui);
    const confirm = ui.mount.querySelector('.reset-dialog-actions button:first-child');
    await ui.click('.reset-dialog-actions button:first-child');
    assert.deepEqual(ui.calls, [['reset_application', {}, undefined]]);
    assert.equal(confirm.disabled, true);
    assert.equal(ui.mount.querySelector('.reset-dialog-actions button:last-child').disabled, true);
    assert.match(ui.mount.querySelector('.reset-dialog [role="status"]').textContent, /Resetting and restarting/);

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
  const ui = await mountApp({
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
  const ui = await mountApp({ desktop: false });
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

const importedAt = '2026-01-01T00:00:00Z';
const activeSeason = [{ year: 2024, importedAt, dataAt: importedAt }];
const catalog = [{ partitionId: '2024', revisionId: '10', storedAt: importedAt, sourceDataAt: importedAt, counts: { results: 1, sprint: 0 } }];

function f1Reader(command) {
  switch (command) {
    case 'f1_local_seasons': return activeSeason;
    case 'f1_sync_status': return null;
    case 'f1_season_details': return { calendar: [], results: [] };
    case 'f1_analysis_catalog': return catalog;
    case 'f1_analysis_pinned': return [{ year: 2024, id: '10', sourceDataAt: importedAt, storedAt: importedAt,
      results: [{ round: '1', session: 'results', result: { Driver: { driverId: 'synthetic-driver' }, points: '1' } }] }];
    case 'f1_analyses_list':
    case 'f1_models_v3_list': return [];
    case 'f1_export_text': return true;
    default: throw new Error(`Unexpected command ${command}`);
  }
}

test('dirty F1 analysis requires confirmation for a keyboard tab change and Categories', async () => {
  const ui = await mountApp({ invoke: async command => f1Reader(command) });
  const button = (selector, title) => [...ui.mount.querySelectorAll(selector)].find(item => item.textContent === title);
  try {
    await ui.click('[data-tutorial-target=category-f1]');
    await ui.click('#f1-tab-sandbox');
    const table = await waitFor(() => button('.rds-sb-chart-types button', 'Table'));
    await act(async () => table.click());
    await waitFor(() => ui.mount.textContent.includes('Changes not yet saved'));
    const sandboxTab = ui.mount.querySelector('#f1-tab-sandbox');
    await act(async () => {
      sandboxTab.focus();
      sandboxTab.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    assert.equal(sandboxTab.getAttribute('aria-selected'), 'true');
    assert.equal(ui.mount.querySelector('.restart-dialog').open, true);
    await ui.click('.restart-dialog button:last-child');
    assert.equal(ui.mount.querySelector('.rds-sb-chart-types button[aria-pressed=true]').textContent, 'Table');

    const exportButton = await waitFor(() => {
      const candidate = button('.rds-sb-actions button', 'Export');
      return candidate && !candidate.disabled && candidate;
    });
    await act(async () => exportButton.click());
    const include = ui.mount.querySelector('[role=dialog] input[type=checkbox]');
    assert.equal(include.checked, false);
    await act(async () => include.click());
    await ui.click('[role=dialog] button:last-child');
    const exported = ui.calls.find(([command]) => command === 'f1_export_text');
    assert.equal(JSON.parse(exported[1].manifest).query.selection.revisions[0].revisionId, '10');

    await ui.click('button.back');
    assert.equal(ui.mount.querySelector('.restart-dialog').open, true);
    await ui.click('.restart-dialog button:first-child');
    assert.equal(ui.mount.querySelector('#f1-tab-sandbox'), null);
  } finally {
    ui.cleanup();
  }
});

test('snapshot deletion waits for confirmation of the current dependent analyses', async () => {
  let dependents = [{ id: 'legacy', revision: '1', title: 'Legacy championship' }];
  const ui = await mountApp({ invoke: async (command, args) => {
    if (command === 'f1_snapshots') return [{ id: 4, displayName: 'Older snapshot', importedAt, dataAt: importedAt, isActive: false, canDelete: true }];
    if (command === 'f1_snapshot_dependents') return dependents;
    if (command === 'f1_snapshot_delete') {
      if (args.confirmed[0].revision !== '2') {
        dependents = [{ ...dependents[0], revision: '2', title: 'Updated championship' }];
        throw 'SNAPSHOT_DEPENDENTS_CHANGED';
      }
      return undefined;
    }
    return f1Reader(command);
  } });
  try {
    await ui.click('[data-tutorial-target=category-f1]');
    await ui.click('#f1-tab-snapshots');
    const remove = await waitFor(() => ui.mount.querySelector('.snapshot-list .snapshot-delete-icon'));
    await act(async () => remove.click());
    await waitFor(() => ui.mount.querySelector('#snapshot-confirm-title')?.parentElement.querySelector('li')?.textContent === 'Legacy championship');
    assert.equal(ui.calls.some(([command]) => command === 'f1_snapshot_delete'), false);
    await ui.click('#snapshot-confirm-title ~ div button:first-child');
    await waitFor(() => ui.mount.querySelector('#snapshot-confirm-title')?.parentElement.querySelector('li')?.textContent === 'Updated championship');
    assert.match(ui.mount.querySelector('#snapshot-confirm-title').parentElement.textContent, /Review the updated list/);
    await ui.click('#snapshot-confirm-title ~ div button:first-child');
    const deletions = ui.calls.filter(([command]) => command === 'f1_snapshot_delete');
    assert.deepEqual(deletions.map(([, args]) => args.confirmed[0].revision), ['1', '2']);
    assert.equal(ui.mount.querySelector('#snapshot-confirm-title').parentElement.open, false);
  } finally {
    ui.cleanup();
  }
});
