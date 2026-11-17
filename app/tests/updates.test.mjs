import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canInstallUpdate, isUpdateStatus, readAutoDownload, updateBusy, updateProgress } from '../src/updates.ts';

const ready = { enabled: true, phase: 'ready', currentVersion: '0.0.1-beta.1', version: '0.0.1-beta.2', total: 100, downloaded: 100 };

test('updates require a verified download and no dirty edits or competing operation', () => {
  assert.equal(canInstallUpdate(ready, false, false), true);
  for (const state of [null, { ...ready, enabled: false }, { ...ready, phase: 'available' }, { ...ready, phase: 'downloading' }, { ...ready, phase: 'error' }]) {
    assert.equal(canInstallUpdate(state, false, false), false);
  }
  assert.equal(canInstallUpdate(ready, true, false), false);
  assert.equal(canInstallUpdate(ready, false, true), false);
});

test('progress supports unknown sizes and clamps percentages', () => {
  assert.equal(updateProgress({ total: null, downloaded: 20 }), null);
  assert.equal(updateProgress({ total: 0, downloaded: 20 }), null);
  assert.equal(updateProgress({ total: 100, downloaded: 200 }), 100);
  assert.equal(updateProgress({ total: 100, downloaded: 25 }), 25);
  assert.equal(updateBusy({ phase: 'downloading' }), true);
  assert.equal(updateBusy(ready), false);
});

test('automatic download defaults off and tolerates inaccessible local storage', () => {
  assert.equal(readAutoDownload(null), false);
  assert.equal(readAutoDownload({ getItem: () => { throw Error('blocked'); } }), false);
  assert.equal(readAutoDownload({ getItem: () => 'true' }), true);
  assert.equal(readAutoDownload({ getItem: () => 'false' }), false);
});

test('only guarded app updater commands are granted, never unrestricted plugin IPC', () => {
  const capability = JSON.parse(readFileSync(new URL('../src-tauri/capabilities/f1-main.json', import.meta.url)));
  for (const command of ['status', 'check', 'download', 'install']) assert.ok(capability.permissions.includes(`allow-update-${command}`));
  assert.ok(capability.permissions.every(permission => !String(permission).startsWith('updater:')));
  const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url)));
  assert.equal(config.plugins.updater.requireSignedVersion, true);
  assert.equal(config.plugins.updater.pubkey, '');
  assert.equal(config.app.security.csp.includes('github'), false);
});

test('malformed native update state never reaches rendering', () => {
  for (const value of [undefined, null, {}, { ...ready, downloaded: NaN }, { ...ready, phase: '<script>' }]) {
    assert.equal(isUpdateStatus(value), false);
  }
  assert.equal(isUpdateStatus({ ...ready, notes: null, error: null }), true);
});
