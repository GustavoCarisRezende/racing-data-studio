import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { afterSyncResult, tutorialReducer } from '../src/onboarding.ts';

const requireFromPackages = createRequire(new URL('../../packages/package.json', import.meta.url));
const { JSDOM } = requireFromPackages('jsdom');
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let vite, React, act, createRoot, OnboardingTour, RestartConfirmation, F1, dom;

before(async () => {
  globalThis.isTauri = true;
  vite = await createServer({ configFile: path.join(appRoot, 'vite.config.ts'), server: { middlewareMode: true }, appType: 'custom' });
  ({ OnboardingTour } = await vite.ssrLoadModule('/src/onboarding-tour.tsx'));
  ({ RestartConfirmation } = await vite.ssrLoadModule('/src/restart-confirmation.tsx'));
  ({ f1: F1 } = await vite.ssrLoadModule('/src/categories/f1/index.tsx'));
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  dom.window.isTauri = true;
  for (const name of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'HTMLDialogElement', 'MutationObserver', 'Event', 'MouseEvent', 'KeyboardEvent', 'navigator']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : name === 'document' ? dom.window.document : name === 'navigator' ? dom.window.navigator : dom.window[name] });
  }
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  dom.window.HTMLElement.prototype.scrollIntoView = function () { this.dataset.scrolledIntoView = 'true'; };
  dom.window.HTMLElement.prototype.getClientRects = function () { return this.isConnected ? [{ top: 40, left: 50, right: 210, bottom: 80, width: 160, height: 40 }] : []; };
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { top: 40, left: 50, right: 210, bottom: 80, width: 160, height: 40, x: 50, y: 40, toJSON() {} };
  };
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.isTauri = true;
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = React);
});

after(async () => { dom?.window.close(); await vite?.close(); });

const labels = {
  f1Heading: 'Formula 1', sandbox: 'Sandbox', explore: 'Explore events', manageSync: 'Manage synchronizations',
  manageSnapshots: 'Manage snapshots', dataSource: 'Data source', f1Tabs: 'Formula 1 sections',
  season: 'Season', searchYear: 'Search years', selectYear: 'Select a matching year',
  importSeason: 'Import', updateSeason: 'Update', imported: 'Imported', notImported: 'Not imported',
  importing: 'Importing', updating: 'Updating', lastImport: 'Last stored snapshot',
  loading: 'Loading', futureNotice: 'Future seasons may be incomplete.', catalog: 'Loading catalog',
  fallbackNotice: 'Fallback catalog', phaseStarting: 'Starting', phaseRaces: 'Races',
  phaseResults: 'Results', phaseSprint: 'Sprint', phaseSaving: 'Saving', offset: 'records',
  syncError: 'Synchronization failed', noSnapshots: 'No snapshots', snapshotHelpTitle: 'Snapshot help',
  noLocal: 'No local snapshot', sourceNotice: 'Jolpica F1 source and license notice',
  sourceTerms: 'Source terms', noYears: 'No years', onlyMissingSeasons: 'Only missing',
  missingSeasonsUnavailable: 'Unavailable', restore: 'Restore', cancel: 'Cancel',
  copyError: 'Copy failed', activateError: 'Activation failed', restoreError: 'Restore failed',
  retryDetails: 'Details', snapshotName: 'Name', renameSnapshot: 'Rename', deleteSnapshot: 'Delete',
  activeSnapshot: 'Active', sourceDataAt: 'Source date', copySuccess: 'Copies',
  deleteSnapshotConfirm: 'Delete?', restoreConfirm: 'Restore?', dismiss: 'Dismiss',
};

function makeActualF1({ existing = false, syncOutcomes = ['success'] } = {}) {
  const mount = document.querySelector('#root');
  mount.replaceChildren();
  const root = createRoot(mount);
  const calls = [];
  const current = new Date().getFullYear();
  const local = existing ? [{ year: current - 2, importedAt: `${current - 2}-12-01T00:00:00Z`, dataAt: `${current - 2}-12-01T00:00:00Z` }] : [];
  let syncCount = 0;
  const internals = {
    invoke: async (command, args = {}) => {
      calls.push([command, args]);
      if (command === 'f1_local_seasons') return local.map((entry) => ({ ...entry }));
      if (command === 'f1_remote_seasons') return [current, current - 1, current - 2];
      if (command === 'f1_sync_status') return null;
      if (command === 'f1_snapshots') return [];
      if (command === 'f1_season_details') return new Promise(() => {});
      if (command === 'f1_sync') {
        const outcome = syncOutcomes[syncCount++];
        if (outcome !== 'success') throw new Error('network unavailable');
        local.splice(0, local.length, { year: args.year, importedAt: `${args.year}-12-01T00:00:00Z`, dataAt: `${args.year}-12-01T00:00:00Z` });
        return undefined;
      }
      throw new Error(`Unexpected command ${command}`);
    },
  };
  dom.window.__TAURI_INTERNALS__ = internals;
  globalThis.__TAURI_INTERNALS__ = internals;
  function Harness() {
    const [state, setState] = React.useState({ step: 'welcome', status: 'active' });
    const [active, setActive] = React.useState(false);
    const [hasSnapshots, setHasSnapshots] = React.useState(false);
    const onStep = React.useCallback((step) => setState((previous) => tutorialReducer(previous, { type: 'advance', step })), []);
    const onLocalSnapshotsChange = React.useCallback(setHasSnapshots, []);
    const tutorial = { step: state.step, onStep, onTarget: () => {}, onLocalSnapshotsChange, hasLocalSnapshots: hasSnapshots };
    const card = !active && React.createElement('button', {
      type: 'button', 'data-tutorial-target': 'category-f1',
      onClick: () => { setActive(true); onStep('sync-intro'); },
    }, 'Formula 1');
    return React.createElement(React.Fragment, null,
      card || React.createElement(F1.Screen, { t: (key) => labels[key] ?? key, locale: 'en-US', tutorial }),
      React.createElement(OnboardingTour, {
        state, locale: 'en-US', dispatch: (action) => setState((previous) => tutorialReducer(previous, action)),
        hasLocalSnapshots: hasSnapshots,
        targetElement: (target) => document.querySelector(`[data-tutorial-target="${target}"]`),
      }));
  }
  act(() => root.render(React.createElement(Harness)));
  return {
    mount, calls,
    cleanup: () => act(() => root.unmount()),
    async flush() { await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); }); },
    async click(selector) {
      const element = mount.querySelector(selector);
      assert.ok(element, `missing ${selector}`);
      await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
    },
    async next() {
      const element = [...mount.querySelectorAll('.tutorial-actions button:not(:disabled)')].at(-1);
      assert.ok(element, `no enabled tour action at ${mount.querySelector('#tutorial-title')?.textContent}`);
      await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
    },
    title: () => mount.querySelector('#tutorial-title')?.textContent,
  };
}

function makeTour({ hasLocalSnapshots = false, outcomes = ['success'] } = {}) {
  const mount = document.querySelector('#root');
  mount.replaceChildren();
  const root = createRoot(mount);
  const calls = { sync: 0, years: [] };
  function Harness() {
    const [state, setState] = React.useState({ step: 'welcome', status: 'active' });
    const [view, setView] = React.useState('home');
    const [year, setYear] = React.useState(2025);
    const [error, setError] = React.useState('');
    const dispatch = (action) => setState((previous) => tutorialReducer(previous, action));
    const step = (next) => dispatch({ type: 'advance', step: next });
    const tab = (name, nextStep) => React.createElement('button', {
      type: 'button', 'data-tutorial-target': `f1-${name}-tab`,
      onClick: () => { setView(name); if (state.step === `${name}-tab`) step(nextStep); },
    }, `${name} tab`);
    const category = React.createElement('button', {
      type: 'button', 'data-tutorial-target': 'category-f1',
      onClick: () => { setView('sync'); if (state.step === 'category') step('sync-intro'); },
    }, 'Formula 1');
    const controls = view === 'home' ? category : React.createElement(React.Fragment, null,
      tab('sync', 'sync-content'), tab('snapshots', 'snapshots-content'), tab('source', 'source-content'),
      tab('explore', 'explore-content'), tab('sandbox', 'models'),
      view === 'sync' && React.createElement(React.Fragment, null,
        React.createElement('button', { type: 'button', 'data-tutorial-target': 'f1-sync-year', onClick: () => { calls.years.push(2025); setYear(2025); step('sync-run'); } }, `Select suggested year ${year}`),
        React.createElement('button', { type: 'button', 'data-tutorial-target': 'f1-sync-run', onClick: () => {
          calls.sync += 1;
          if (outcomes[calls.sync - 1] === 'success') { setError(''); step(afterSyncResult(true)); }
          else setError('Synchronization failed');
        } }, 'Import'),
        error && React.createElement('p', { role: 'alert' }, error)),
      view === 'source' && React.createElement('p', null, 'Jolpica F1 is Ergast’s successor; imported data stays local and is not sent to Racing Data Studio.'),
      view === 'explore' && React.createElement('p', null, 'Browse the calendar, search events, and inspect reported results.'));
    return React.createElement(React.Fragment, null,
      React.createElement('main', null, controls),
      React.createElement(OnboardingTour, {
        state, locale: 'en-US', dispatch, hasLocalSnapshots,
        targetElement: (target) => document.querySelector(`[data-tutorial-target="${target}"]`),
        onMissingTarget: (missing) => step(missing === 'category' ? 'sync-intro' : 'snapshot-content'),
      }));
  }
  act(() => root.render(React.createElement(Harness)));
  return {
    mount, calls,
    cleanup: () => act(() => root.unmount()),
    click(selector) {
      const element = mount.querySelector(selector);
      assert.ok(element, `missing ${selector}`);
      act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    },
    next() {
      const element = [...mount.querySelectorAll('.tutorial-actions button:not(:disabled)')].at(-1);
      assert.ok(element, `no enabled tour action at ${mount.querySelector('#tutorial-title')?.textContent}`);
      act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    },
    title: () => mount.querySelector('#tutorial-title')?.textContent,
  };
}

test('real DOM tour gates category and tab explanations on clicks and presents snapshots → source → explore → sandbox', () => {
  const ui = makeTour({ hasLocalSnapshots: true });
  try {
    assert.match(ui.title(), /Welcome/);
    ui.next();
    assert.match(ui.title(), /Choose a category/);
    assert.equal(ui.mount.querySelector('[data-tutorial-target="category-f1"]').getAttribute('aria-describedby'), 'tutorial-copy');
    assert.equal(ui.mount.querySelector('[data-tutorial-target="category-f1"]').dataset.scrolledIntoView, 'true');
    ui.click('[data-tutorial-target="category-f1"]');
    assert.match(ui.title(), /How season data gets here/);
    ui.next();
    assert.match(ui.title(), /Open synchronization/);
    ui.click('[data-tutorial-target="f1-sync-tab"]');
    assert.match(ui.title(), /Import only when you choose/);
    ui.next();
    assert.match(ui.title(), /Snapshots stay on this device/);
    ui.next();
    assert.match(ui.title(), /Open snapshots/);
    ui.click('[data-tutorial-target="f1-snapshots-tab"]');
    assert.match(ui.title(), /Review local snapshots/);
    ui.next();
    assert.match(ui.title(), /Open the data source/);
    ui.click('[data-tutorial-target="f1-source-tab"]');
    assert.match(ui.mount.textContent, /not sent to Racing Data Studio/);
    ui.next();
    assert.match(ui.title(), /Open event exploration/);
    ui.click('[data-tutorial-target="f1-explore-tab"]');
    assert.match(ui.mount.textContent, /search events/);
    ui.next();
    assert.match(ui.title(), /Open the Sandbox/);
    ui.click('[data-tutorial-target="f1-sandbox-tab"]');
    assert.match(ui.title(), /Models/);
    assert.equal(ui.calls.sync, 0);
  } finally { ui.cleanup(); }
});

test('actual F1 screen explains synchronization and existing local snapshots without launching another import', async () => {
  const ui = makeActualF1({ existing: true });
  try {
    await ui.flush();
    await ui.next();
    await ui.click('[data-tutorial-target="category-f1"]');
    assert.match(ui.title(), /How season data gets here/);
    await ui.next();
    await ui.click('[data-tutorial-target="f1-sync-tab"]');
    assert.match(ui.title(), /Import only when you choose/);
    await ui.next();
    assert.match(ui.title(), /Snapshots stay on this device/);
    assert.equal(ui.calls.filter(([command]) => command === 'f1_sync').length, 0);
    await ui.next();
    await ui.click('[data-tutorial-target="f1-snapshots-tab"]');
    assert.match(ui.title(), /Review local snapshots/);
    await ui.next();
    await ui.click('[data-tutorial-target="f1-source-tab"]');
    assert.match(ui.mount.textContent, /not sent to Racing Data Studio servers/);
  } finally { ui.cleanup(); }
});

test('actual F1 sync waits for the selected year, keeps errors on the sync gate, and advances only on resolve', async () => {
  const ui = makeActualF1({ syncOutcomes: ['failure', 'success'] });
  try {
    await ui.flush();
    await ui.next();
    await ui.click('[data-tutorial-target="category-f1"]');
    await ui.next();
    await ui.click('[data-tutorial-target="f1-sync-tab"]');
    await ui.next();
    assert.match(ui.title(), /Choose a season/);
    assert.equal(ui.calls.filter(([command]) => command === 'f1_sync').length, 0);
    const yearChoice = ui.mount.querySelector('[data-tutorial-target="f1-sync-year"]');
    assert.ok(yearChoice);
    await ui.click('[data-tutorial-target="f1-sync-year"]');
    assert.match(ui.title(), /Start synchronization/);
    const importButton = ui.mount.querySelector('[data-tutorial-target="f1-sync-run"]');
    await ui.click('[data-tutorial-target="f1-sync-run"]');
    assert.equal(ui.title(), 'Start synchronization');
    assert.match(ui.mount.textContent, /Synchronization failed/);
    await ui.click('[data-tutorial-target="f1-sync-run"]');
    assert.equal(ui.title(), 'Snapshots stay on this device');
    const syncCalls = ui.calls.filter(([command]) => command === 'f1_sync');
    assert.equal(syncCalls.length, 2);
    assert.equal(syncCalls[0][1].year, new Date().getFullYear() - 1);
    assert.equal(syncCalls[1][1].year, new Date().getFullYear() - 1);
    assert.ok(importButton);
  } finally { ui.cleanup(); }
});

test('empty local data requires choosing the suggested year, then success advances while failure offers retry', () => {
  const ui = makeTour({ hasLocalSnapshots: false, outcomes: ['failure', 'success'] });
  try {
    ui.next();
    ui.click('[data-tutorial-target="category-f1"]');
    ui.next();
    ui.click('[data-tutorial-target="f1-sync-tab"]');
    ui.next();
    assert.match(ui.title(), /Choose a season/);
    ui.click('[data-tutorial-target="f1-sync-year"]');
    assert.deepEqual(ui.calls.years, [2025]);
    assert.match(ui.title(), /Start synchronization/);
    ui.click('[data-tutorial-target="f1-sync-run"]');
    assert.equal(ui.title(), 'Start synchronization');
    assert.match(ui.mount.textContent, /Synchronization failed/);
    ui.click('[data-tutorial-target="f1-sync-run"]');
    assert.equal(ui.title(), 'Snapshots are local');
    assert.equal(ui.calls.sync, 2);
  } finally { ui.cleanup(); }
});

test('container tutorial targets can receive keyboard focus and recover their original attributes', () => {
  const mount = document.querySelector('#root');
  mount.replaceChildren();
  const target = document.createElement('section');
  document.body.append(target);
  const root = createRoot(mount);
  const getTarget = () => target;
  act(() => root.render(React.createElement(OnboardingTour, {
    state: { step: 'filters', status: 'active' }, locale: 'en-US',
    dispatch() {}, targetElement: getTarget,
  })));
  try {
    assert.equal(target.getAttribute('tabindex'), '-1');
    const focus = [...mount.querySelectorAll('button')].find(button => button.textContent === 'Focus control');
    act(() => focus.click());
    assert.ok(document.activeElement === target);
  } finally {
    act(() => root.unmount());
    assert.equal(target.hasAttribute('tabindex'), false);
    assert.equal(target.hasAttribute('aria-describedby'), false);
    target.remove();
  }
});

test('a missing tutorial target centers an explanatory continue action instead of deadlocking', () => {
  const mount = document.querySelector('#root');
  mount.replaceChildren();
  const root = createRoot(mount);
  function Harness() {
    const [state, setState] = React.useState({ step: 'source-tab', status: 'active' });
    return React.createElement(OnboardingTour, {
      state, locale: 'en-US', dispatch: (action) => setState((previous) => tutorialReducer(previous, action)),
      targetElement: () => null,
      onMissingTarget: (step) => setState({ step: step === 'source-tab' ? 'source-content' : 'finish', status: 'active' }),
    });
  }
  act(() => root.render(React.createElement(Harness)));
  try {
    assert.match(mount.textContent, /not available on this screen/);
    const next = [...mount.querySelectorAll('.tutorial-actions button:not(:disabled)')].at(-1);
    act(() => next.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.match(mount.querySelector('#tutorial-title').textContent, /Jolpica F1 and local storage/);
  } finally { act(() => root.unmount()); }
});

test('restart confirmation exposes Restart before Cancel in DOM and invokes the selected action', () => {
  const mount = document.querySelector('#root');
  mount.replaceChildren();
  const root = createRoot(mount);
  const calls = [];
  function Harness() {
    const [open, setOpen] = React.useState(true);
    return React.createElement(React.Fragment, null,
      React.createElement('button', { type: 'button', id: 'reopen', onClick: () => setOpen(true) }, 'Reopen'),
      React.createElement(RestartConfirmation, {
        open, locale: 'pt-BR',
        onCancel: () => { calls.push('cancel'); setOpen(false); },
        onConfirm: () => { calls.push('restart'); setOpen(false); },
      }));
  }
  act(() => root.render(React.createElement(Harness)));
  try {
    const buttons = [...mount.querySelectorAll('.restart-dialog button')];
    assert.deepEqual(buttons.map((button) => button.textContent), ['Reiniciar tour', 'Cancelar']);
    act(() => buttons[1].dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.deepEqual(calls, ['cancel']);
    assert.equal(mount.querySelector('.restart-dialog').open, false);
    act(() => mount.querySelector('#reopen').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const restart = [...mount.querySelectorAll('.restart-dialog button')][0];
    act(() => restart.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.deepEqual(calls, ['cancel', 'restart']);
  } finally { act(() => root.unmount()); }
});
