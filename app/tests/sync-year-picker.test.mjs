import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const requireFromPackages = createRequire(new URL('../../packages/package.json', import.meta.url));
const { JSDOM } = requireFromPackages('jsdom');
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const translations = {
  season: 'Season',
  searchYear: 'Search years',
  selectYear: 'Select a matching year',
  imported: 'Imported',
  onlyMissingSeasons: 'Only seasons not synchronized',
  missingSeasonsUnavailable: 'Cannot identify unsynchronized seasons until local data is available.',
  noYears: 'No years match your search.',
  importSeason: 'Import',
  updateSeason: 'Update',
};
let vite;
let React;
let act;
let createRoot;
let SyncYearPicker;
let dom;

before(async () => {
  vite = await createServer({
    configFile: path.join(appRoot, 'vite.config.ts'),
    server: { middlewareMode: true },
    appType: 'custom',
  });
  ({ SyncYearPicker } = await vite.ssrLoadModule('/src/categories/f1/sync-year-picker.tsx'));
  dom = new JSDOM('<!doctype html><html><body><main id="root"></main><button id="outside">Outside</button></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  for (const name of ['window', 'document', 'Node', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent', 'navigator']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : name === 'document' ? dom.window.document : name === 'navigator' ? dom.window.navigator : dom.window[name] });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLElement.prototype.scrollIntoView = function (options) {
    this.dataset.scrolled = options?.block ?? 'true';
  };
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  ({ act } = React);
});

after(async () => {
  dom?.window.close();
  await vite?.close();
});

function makeFixture({ initialYear = 2025, years = [2026, 2025, 2024, 1950], importedYears = [2025], localLoaded = true } = {}) {
  const mount = document.querySelector('#root');
  mount.replaceChildren();
  const root = createRoot(mount);
  const calls = { selected: [], imported: 0 };
  let setProps;
  function Harness() {
    const [year, setYear] = React.useState(initialYear);
    const [props, updateProps] = React.useState({ years, importedYears, localLoaded, disabled: false });
    setProps = updateProps;
    return React.createElement(SyncYearPicker, {
      ...props,
      year,
      imported: Boolean(props.importedYears?.includes(year)),
      t: (key) => translations[key] ?? key,
      onSelect: (selected) => { calls.selected.push(selected); setYear(selected); },
      onImport: () => { calls.imported += 1; },
    });
  }
  act(() => root.render(React.createElement(Harness)));
  return { mount, root, calls, update: (next) => act(() => setProps(next)), cleanup: () => act(() => root.unmount()) };
}

const click = (element) => act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const key = (element, keyName) => act(() => element.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true })));
const pointerDown = (element) => act(() => element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));

function type(input, value) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new input.ownerDocument.defaultView.Event('input', { bubbles: true }));
  });
}

test('season controls share a parent and follow the visual and keyboard order', () => {
  const fixture = makeFixture();
  try {
    const picker = fixture.mount.querySelector('.sync-year-picker');
    const season = picker.querySelector('.sync-year-selection');
    const label = season.querySelector('label');
    const trigger = season.querySelector('.sync-year-trigger');
    const action = picker.querySelector('button:not(.sync-year-trigger)');
    const checkbox = picker.querySelector('.sync-only-missing');
    assert.equal(label.textContent, 'Season');
    // Compare booleans, not jsdom trees: assertion diagnostics for DOM objects
    // can traverse a large cyclic graph when an assertion fails.
    assert.ok(trigger.closest('.sync-year-selection') === season);
    assert.ok(action.parentElement === picker);
    assert.ok(checkbox.parentElement === picker);
    const controls = [...picker.querySelectorAll('.sync-year-trigger, button:not(.sync-year-trigger), .sync-only-missing input')];
    assert.equal(controls.length, 3);
    assert.ok(controls[0] === trigger);
    assert.ok(controls[1] === action);
    assert.ok(controls[2] === checkbox.querySelector('input'));
  } finally {
    fixture.cleanup();
  }
});

test('React selector keeps committed year separate from search and commits through click or Enter only', async () => {
  const fixture = makeFixture();
  try {
    click(fixture.mount.querySelector('.sync-year-trigger'));
    click(fixture.mount.querySelector('.sync-year-trigger'));
    assert.equal(fixture.mount.querySelector('[role="combobox"]'), null);
    click(fixture.mount.querySelector('.sync-year-trigger'));
    let search = fixture.mount.querySelector('[role="combobox"]');
    assert.ok(search);
    const trigger = fixture.mount.querySelector('.sync-year-trigger');
    const accessibleName = trigger.getAttribute('aria-labelledby').split(' ').map((id) => document.getElementById(id).textContent).join(' ');
    assert.match(accessibleName, /Season/);
    assert.match(accessibleName, /2025/);
    type(search, '2024');
    assert.equal(fixture.mount.querySelector('.sync-year-trigger span').textContent, '2025 · Select a matching year');
    assert.equal(fixture.mount.querySelector('button:not(.sync-year-trigger)').disabled, true);
    assert.deepEqual([...fixture.mount.querySelectorAll('[role="option"]')].map((option) => option.textContent), ['2024']);

    key(search, 'Enter');
    assert.deepEqual(fixture.calls.selected, [2024]);
    assert.equal(fixture.mount.querySelector('.sync-year-trigger').textContent, '2024');
    assert.equal(document.activeElement, fixture.mount.querySelector('.sync-year-trigger'));
    assert.equal(fixture.mount.querySelector('button:not(.sync-year-trigger)').disabled, false);
    assert.equal(fixture.calls.imported, 0);

    click(fixture.mount.querySelector('.sync-year-trigger'));
    search = fixture.mount.querySelector('[role="combobox"]');
    type(search, '2026');
    click(fixture.mount.querySelector('[role="option"]'));
    assert.deepEqual(fixture.calls.selected, [2024, 2026]);
    assert.equal(document.activeElement, fixture.mount.querySelector('.sync-year-trigger'));
  } finally {
    fixture.cleanup();
  }
});

test('ArrowUp activates and scrolls the last option; live option changes keep active descendant valid', () => {
  const fixture = makeFixture();
  try {
    click(fixture.mount.querySelector('.sync-year-trigger'));
    const search = fixture.mount.querySelector('[role="combobox"]');
    key(search, 'ArrowUp');
    assert.equal(fixture.mount.querySelector('[aria-activedescendant]')?.getAttribute('aria-activedescendant'), fixture.mount.querySelector('[role="option"]:last-child').id);
    assert.equal(fixture.mount.querySelector('[role="option"]:last-child').dataset.scrolled, 'nearest');
    fixture.update({ years: [2026, 2025], importedYears: [2025], localLoaded: true, disabled: false });
    const descendant = fixture.mount.querySelector('[role="combobox"]').getAttribute('aria-activedescendant');
    assert.ok(!descendant || document.getElementById(descendant));
  } finally {
    fixture.cleanup();
  }
});

test('Escape and outside click cancel without changing committed year or enabling import for a filtered-out selection', () => {
  const fixture = makeFixture();
  try {
    click(fixture.mount.querySelector('.sync-year-trigger'));
    let search = fixture.mount.querySelector('[role="combobox"]');
    type(search, '2024');
    key(search, 'Escape');
    assert.equal(fixture.mount.querySelector('.sync-year-trigger span').textContent, '2025 · Select a matching year');
    assert.equal(fixture.mount.querySelector('.sync-year-trigger').getAttribute('aria-invalid'), 'true');
    assert.equal(fixture.mount.querySelector('button:not(.sync-year-trigger)').disabled, true);
    assert.equal(fixture.calls.selected.length, 0);

    click(fixture.mount.querySelector('.sync-year-trigger'));
    search = fixture.mount.querySelector('[role="combobox"]');
    assert.equal(search.value, '2024');
    pointerDown(document.querySelector('#outside'));
    assert.equal(fixture.mount.querySelector('[role="combobox"]'), null);
    assert.equal(fixture.mount.querySelector('.sync-year-trigger span').textContent, '2025 · Select a matching year');
    assert.equal(fixture.mount.querySelector('button:not(.sync-year-trigger)').disabled, true);
    fixture.mount.querySelector('button:not(.sync-year-trigger)').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    assert.equal(fixture.calls.imported, 0);
    assert.equal(fixture.calls.selected.length, 0);
  } finally {
    fixture.cleanup();
  }
});

test('checkbox combines with query, excludes imported seasons, and only an explicit valid choice enables import', () => {
  const fixture = makeFixture({ initialYear: 2025, years: [2026, 2025, 2024], importedYears: [2024, 2025] });
  try {
    click(fixture.mount.querySelector('.sync-year-trigger'));
    const checkbox = fixture.mount.querySelector('.sync-only-missing input');
    click(checkbox);
    assert.deepEqual([...fixture.mount.querySelectorAll('[role="option"]')].map((option) => option.textContent), ['2026']);
    assert.equal(fixture.mount.querySelector('button:not(.sync-year-trigger)').disabled, true);
    const search = fixture.mount.querySelector('[role="combobox"]');
    type(search, '202');
    assert.deepEqual([...fixture.mount.querySelectorAll('[role="option"]')].map((option) => option.textContent), ['2026']);
    click(fixture.mount.querySelector('[role="option"]'));
    assert.equal(fixture.mount.querySelector('.sync-year-trigger').textContent, '2026');
    assert.equal(fixture.mount.querySelector('button:not(.sync-year-trigger)').disabled, false);
  } finally {
    fixture.cleanup();
  }
});

test('unknown local data fails closed for an already-enabled missing-only filter', () => {
  const fixture = makeFixture({ initialYear: 2025, years: [2026, 2025], importedYears: [2025] });
  try {
    click(fixture.mount.querySelector('.sync-year-trigger'));
    click(fixture.mount.querySelector('.sync-only-missing input'));
    fixture.update({ years: [2026, 2025], importedYears: null, localLoaded: false, disabled: false });
    const checkbox = fixture.mount.querySelector('.sync-only-missing input');
    assert.equal(checkbox.checked, true);
    assert.equal(checkbox.disabled, true);
    assert.deepEqual([...fixture.mount.querySelectorAll('[role="option"]')], []);
    assert.match(fixture.mount.querySelector('.sync-year-empty').textContent, /Cannot identify unsynchronized/);
    assert.equal(fixture.mount.querySelector('button:not(.sync-year-trigger)').disabled, true);
  } finally {
    fixture.cleanup();
  }
});

test('Tab closes without selecting; disabling while open prevents stale option selection', () => {
  const fixture = makeFixture();
  try {
    click(fixture.mount.querySelector('.sync-year-trigger'));
    const search = fixture.mount.querySelector('[role="combobox"]');
    type(search, '2024');
    key(search, 'Tab');
    assert.equal(fixture.mount.querySelector('[role="combobox"]'), null);
    assert.deepEqual(fixture.calls.selected, []);

    click(fixture.mount.querySelector('.sync-year-trigger'));
    const staleOption = fixture.mount.querySelector('[role="option"]');
    fixture.update({ years: [2026, 2025, 2024, 1950], importedYears: [2025], localLoaded: true, disabled: true });
    assert.equal(fixture.mount.querySelector('[role="combobox"]'), null);
    act(() => staleOption.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.deepEqual(fixture.calls.selected, []);
    assert.equal(fixture.mount.querySelector('button:not(.sync-year-trigger)').disabled, true);
  } finally {
    fixture.cleanup();
  }
});

test('synchronization metadata stays collapsed while progress and errors remain outside the details element', async () => {
  const { readFile } = await import('node:fs/promises');
  const screen = await readFile(new URL('../src/categories/f1/index.tsx', import.meta.url), 'utf8');
  const syncInfo = screen.indexOf('<details className="sync-info"');
  const progress = screen.indexOf('{(progress || working) &&');
  const error = screen.indexOf('{error && <div className="sync-error"');
  assert.ok(syncInfo > progress && error > syncInfo);
  assert.doesNotMatch(screen.slice(syncInfo, screen.indexOf('</details>', syncInfo)), /<details[^>]*\bopen\b/);
  assert.match(screen.slice(progress, syncInfo), /aria-live="polite"/);
  assert.match(screen.slice(error, screen.indexOf('</div>', error)), /role="alert"/);
});
