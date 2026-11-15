import test from 'node:test';
import assert from 'node:assert/strict';
import { GITHUB_URL, isFullscreenShortcut, openProject, runFullscreenToggle } from '../src/desktop-bridge.ts';

test('F11 shortcut accepts only a fresh, unmodified keydown', () => {
  assert.equal(isFullscreenShortcut({ key: 'F11', repeat: false, altKey: false, ctrlKey: false, metaKey: false }), true);
  assert.equal(isFullscreenShortcut({ key: 'F11', repeat: true, altKey: false, ctrlKey: false, metaKey: false }), false);
  assert.equal(isFullscreenShortcut({ key: 'F11', repeat: false, altKey: true, ctrlKey: false, metaKey: false }), false);
  assert.equal(isFullscreenShortcut({ key: 'f11', repeat: false, altKey: false, ctrlKey: false, metaKey: false }), false);
});

test('fullscreen bridge ignores overlapping keydowns and always releases its busy guard', async () => {
  const busy = { current: false };
  let release;
  let calls = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const first = runFullscreenToggle(busy, () => { calls += 1; return pending; }, () => assert.fail('unexpected error'));
  assert.equal(busy.current, true);
  assert.equal(await runFullscreenToggle(busy, async () => { calls += 1; }, () => {}), false);
  assert.equal(calls, 1);
  release();
  assert.equal(await first, true);
  assert.equal(busy.current, false);

  let reported = 0;
  assert.equal(await runFullscreenToggle(busy, async () => { throw new Error('native failure'); }, () => { reported += 1; }), false);
  assert.equal(reported, 1);
  assert.equal(busy.current, false);
});

test('desktop GitHub launch delegates only to the fixed native command', async () => {
  const calls = [];
  await openProject(true, async (...args) => calls.push(args), () => assert.fail('browser fallback must not run on desktop'));
  assert.deepEqual(calls, [['open_github']]);
});

test('browser fallback opens the fixed project URL without arbitrary input', async () => {
  let opened;
  await openProject(false, () => assert.fail('native bridge must not run in browser preview'), (...args) => { opened = args; });
  assert.deepEqual(opened, [GITHUB_URL, '_blank', 'noopener,noreferrer']);
  assert.match(GITHUB_URL, /^https:\/\/github\.com\//);
});
