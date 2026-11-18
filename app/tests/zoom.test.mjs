import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIT_LEVELS, ZoomController, ZOOM_STORAGE_KEY, fitScore, nextZoom, readZoom, validZoom, zoomShortcut } from '../src/zoom.ts';

const key = { key: '=', ctrlKey: true, metaKey: false, altKey: false, isComposing: false, defaultPrevented: false };
test('browser-like shortcuts accept Ctrl/Cmd plus/minus/zero and ignore typing/AltGr/composition', () => {
  for (const plus of ['+', '=']) assert.equal(zoomShortcut({ ...key, key: plus }), 'in');
  assert.equal(zoomShortcut({ ...key, key: '-' }), 'out');
  assert.equal(zoomShortcut({ ...key, key: '0', ctrlKey: false, metaKey: true }), 'reset');
  for (const overrides of [{ ctrlKey: false }, { altKey: true }, { isComposing: true }, { defaultPrevented: true }, { key: 'k' }, { key: ')' }]) {
    assert.equal(zoomShortcut({ ...key, ...overrides }), null);
  }
});

test('stored zoom is bounded, invalid values/storage fail safely, and steps handle fit levels', () => {
  for (const raw of [null, '', 'NaN', 'Infinity', '0', '100', '0.69', '2.01', '{}']) assert.equal(readZoom({ getItem: () => raw }), 1);
  assert.equal(readZoom({ getItem: () => '0.95' }), 0.95);
  assert.equal(readZoom({ getItem: () => { throw Error('blocked'); } }), 1);
  assert.equal(readZoom(null), 1);
  assert.equal(nextZoom(0.85, 'in'), 0.9);
  assert.equal(nextZoom(0.85, 'out'), 0.8);
  assert.equal(nextZoom(2, 'in'), 2);
  assert.equal(nextZoom(0.7, 'out'), 0.7);
  assert.equal(nextZoom(1.75, 'reset'), 1);
  assert.equal(validZoom(NaN), false);
  assert.equal(validZoom(Infinity), false);
});

function harness(overrides = {}) {
  const calls = [], saves = [], changes = [], errors = [], busy = [];
  let native = 1;
  const controller = new ZoomController({
    apply: async factor => { calls.push(factor); native = factor; return factor; },
    persist: factor => saves.push([ZOOM_STORAGE_KEY, factor]),
    measure: () => ({ width: 1000, height: 700, right: 900, bottom: 600 }),
    settle: async () => {},
    onChange: factor => changes.push(factor), onError: error => errors.push(error), onBusy: value => busy.push(value),
    ...overrides,
  });
  return { controller, calls, saves, changes, errors, busy, get native() { return native; } };
}

test('rapid shortcuts are serialized and persistence follows confirmed native zoom only', async () => {
  const h = harness();
  await Promise.all([h.controller.request('in'), h.controller.request('in'), h.controller.request('out')]);
  assert.deepEqual(h.calls, [1.1, 1.25, 1.1]);
  assert.equal(h.controller.current, 1.1);
  assert.deepEqual(h.saves.map(([, value]) => value), h.calls);
  assert.equal(h.busy.at(-1), false);
});

test('native failures keep the previous level; preference failure does not undo applied zoom', async () => {
  const h = harness({ apply: async () => { throw Error('native failure'); } });
  assert.equal(await h.controller.request('out'), false);
  assert.equal(h.controller.current, 1);
  assert.equal(h.saves.length, 0);
  assert.deepEqual(h.errors, ['apply']);
  const storage = harness({ persist: () => { throw Error('storage blocked'); } });
  assert.equal(await storage.controller.request('out'), true);
  assert.equal(storage.controller.current, 0.9);
  assert.deepEqual(storage.errors, ['storage']);
});

test('fit probes real layout at a bounded set of scales and saves only the final choice', async () => {
  let native = 1;
  const h = harness({
    apply: async factor => { native = factor; return factor; },
    measure: () => ({ width: 1000, height: 700, right: 900, bottom: native === 0.9 ? 680 : native === 0.95 ? 900 : 800 }),
  });
  await h.controller.request('fit');
  assert.equal(h.controller.current, 0.9);
  assert.equal(h.saves.length, 1);
  assert.deepEqual(FIT_LEVELS, [1, 0.95, 0.9, 0.85]);
  assert.equal(h.errors.length, 0);
});

test('fit keeps a better original 100% layout rather than always shrinking to the minimum', async () => {
  let native = 1;
  const h = harness({
    apply: async factor => { native = factor; return factor; },
    measure: () => ({ width: 1000, height: 700, right: 900, bottom: native === 1 ? 720 : 900 }),
  });
  await h.controller.request('fit');
  assert.equal(h.controller.current, 1);
  assert.equal(h.saves.length, 1);
  assert.equal(fitScore({ width: 0, height: 0, right: 0, bottom: 0 }), 0);
});

test('failed fit restores the earlier level and disposal cancels queued work', async () => {
  const h = harness({ measure: () => { throw Error('layout unavailable'); } });
  await h.controller.restore(1.25);
  assert.equal(await h.controller.request('fit'), false);
  assert.equal(h.controller.current, 1.25);
  assert.equal(h.saves.length, 0);
  const disposed = harness();
  const work = disposed.controller.request('out');
  disposed.controller.dispose();
  assert.equal(await work, false);
  assert.equal(disposed.calls.length, 0);
});

test('zoom uses only the bounded main-window command, not unrestricted WebView hotkeys', () => {
  const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url)));
  const capability = JSON.parse(readFileSync(new URL('../src-tauri/capabilities/f1-main.json', import.meta.url)));
  assert.equal(config.app.windows[0].zoomHotkeysEnabled, false);
  assert.deepEqual(capability.windows, ['main']);
  assert.ok(capability.permissions.includes('allow-set-application-zoom'));
  assert.ok(!capability.permissions.includes('core:webview:allow-set-webview-zoom'));
});
