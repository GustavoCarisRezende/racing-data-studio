import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  afterSyncExplanation, afterSyncResult, afterYearSelection,
  initialTutorialState, readTutorialStatus, tutorialCornerRadii, tutorialShields, tutorialReducer, tutorialStorage,
  writeTutorialStatus, TUTORIAL_STORAGE_KEY,
} from '../src/onboarding.ts';

test('tutorial starts only for an eligible visit and records completion separately from app data', () => {
  const storage = new Map();
  const adapter = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  assert.equal(readTutorialStatus(adapter), 'eligible');
  writeTutorialStatus(adapter, 'completed');
  assert.deepEqual(JSON.parse(storage.get(TUTORIAL_STORAGE_KEY)), { version: 1, status: 'completed' });
  assert.equal(readTutorialStatus(adapter), 'completed');
  writeTutorialStatus(adapter, 'skipped');
  assert.equal(readTutorialStatus(adapter), 'skipped');
  assert.equal(readTutorialStatus({ getItem: () => '{"version":0,"status":"completed"}' }), 'eligible');
});

test('unavailable storage does not prevent onboarding or reducer transitions', () => {
  assert.doesNotThrow(() => tutorialStorage());
  assert.equal(readTutorialStatus({ getItem: () => { throw new Error('blocked'); } }), 'eligible');
  assert.doesNotThrow(() => writeTutorialStatus({ setItem: () => { throw new Error('blocked'); } }, 'skipped'));
  assert.deepEqual(initialTutorialState, { step: null, status: 'idle' });
  let state = tutorialReducer(initialTutorialState, { type: 'start' });
  assert.deepEqual(state, { step: 'welcome', status: 'active' });
  state = tutorialReducer(state, { type: 'advance', step: 'sync-tab' });
  assert.equal(state.step, 'sync-tab');
  state = tutorialReducer(state, { type: 'skip' });
  assert.deepEqual(state, { step: null, status: 'skipped' });
});

test('onboarding transitions keep existing snapshots optional and sync errors from advancing', () => {
  assert.equal(afterSyncExplanation(true), 'snapshot-content');
  assert.equal(afterSyncExplanation(false), 'sync-year');
  assert.equal(afterYearSelection(2025, 2025, true), 'sync-run');
  assert.equal(afterYearSelection(2024, 2025, true), null);
  assert.equal(afterYearSelection(2024, 2025, false), 'sync-run');
  assert.equal(afterSyncResult(true), 'snapshot-content');
  assert.equal(afterSyncResult(false), null);
});

test('spotlight geometry follows asymmetric elliptical computed corners and keeps the opening rounded', () => {
  const computed = {
    borderTopLeftRadius: '12px 6px',
    borderTopRightRadius: '20% 25%',
    borderBottomRightRadius: '3px',
    borderBottomLeftRadius: '0px',
  };
  const radii = tutorialCornerRadii(computed, 100, 40, 4);
  assert.deepEqual(radii, {
    topLeft: [16, 10],
    topRight: [24, 14],
    bottomRight: [7, 7],
    bottomLeft: [0, 0],
  });
  const shields = tutorialShields({ top: 30, left: 40, width: 100, height: 50 }, 320, 200, radii);
  assert.equal(shields[0].borderBottomRightRadius, '16px 10px');
  assert.equal(shields[2].borderBottomLeftRadius, '24px 14px');
  assert.equal(shields[5].borderTopLeftRadius, '7px 7px');
  assert.equal(shields[6].left, 0);
  assert.equal(shields[6].width, 40);
  assert.equal(shields[7].left, 140);
});

test('app wiring requires explicit tab/year/sync actions and gives every explanatory step a locale copy', async () => {
  const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
  const f1 = await readFile(new URL('../src/categories/f1/index.tsx', import.meta.url), 'utf8');
  const analysis = await readFile(new URL('../src/categories/f1/analysis-screen.tsx', import.meta.url), 'utf8');
  const picker = await readFile(new URL('../src/categories/f1/sync-year-picker.tsx', import.meta.url), 'utf8');
  const tour = await readFile(new URL('../src/onboarding-tour.tsx', import.meta.url), 'utf8');
  assert.match(main, /readTutorialStatus\(tutorialStorage\(\)\)/);
  assert.match(main, /data-tutorial-target=\{`category-\$\{category\.id\}`\}/);
  assert.match(f1, /await invoke\('f1_sync', \{ year \}\).*afterSyncResult\(true\)/);
  assert.match(f1, /tutorial\?\.step === 'sync-year'[\s\S]*afterYearSelection/);
  assert.match(f1, /item === 'sync' && tutorial\?\.step === 'sync-tab'[\s\S]*tutorial\.onStep\('sync-content'\)/);
  assert.match(f1, /item === 'source' && tutorial\?\.step === 'source-tab'[\s\S]*tutorial\.onStep\('source-content'\)/);
  assert.match(picker, /data-tutorial-target="f1-sync-run"/);
  assert.match(picker, /suggestedYearLabel/);
  assert.match(analysis, /tutorialTargets=\{onTutorialTarget\}/);
  assert.match(analysis, /onDirtyChange: tutorial\?\.onDirtyChange/);
  assert.match(main, /'Como usar o sistema'/);
  assert.match(main, /setQuery\(''\).*dispatchTutorial\(\{ type: 'start' \}\)/);
  assert.ok(tour.indexOf("'snapshots-content'") < tour.indexOf("'source-tab'"));
  assert.ok(tour.indexOf("'source-content'") < tour.indexOf("'explore-tab'"));
  assert.match(tour, /tutorial-skip-fixed/);
  assert.match(tour, /tutorial-shield/);
  assert.match(tour, /scrollIntoView/);
});
