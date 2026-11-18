import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compactCategoryViewport } from '../src/viewport-layout.ts';

test('compact category layout stays active while zoom increases CSS viewport height', () => {
  for (const zoom of [1, 0.95, 0.9, 0.85, 0.8, 0.7]) {
    assert.equal(compactCategoryViewport(Math.ceil(1536 / zoom), Math.ceil(800 / zoom), zoom), true);
    assert.equal(compactCategoryViewport(Math.ceil(1536 / zoom), Math.ceil(850 / zoom), zoom), true);
    assert.equal(compactCategoryViewport(Math.ceil(1920 / zoom), Math.ceil(1080 / zoom), zoom), false);
  }
});

test('actual resizing and narrow effective viewports still switch layout appropriately', () => {
  assert.equal(compactCategoryViewport(1920, 1000, 1), false);
  assert.equal(compactCategoryViewport(1920, 800, 1), true);
  assert.equal(compactCategoryViewport(2400, 1000, 0.8), true);
  assert.equal(compactCategoryViewport(2400, 1250, 0.8), false);
  assert.equal(compactCategoryViewport(768, 400, 2), false);
  assert.equal(compactCategoryViewport(1500, NaN, 1), false);
  assert.equal(compactCategoryViewport(1500, 800, 0), false);
});

test('native window and AppImage use branded high-resolution PNGs, not the old 32px placeholder', () => {
  const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url)));
  for (const relative of ['icons/icon.png', 'icons/128x128.png', 'icons/128x128@2x.png']) {
    assert.ok(config.bundle.icon.includes(relative));
    const data = readFileSync(new URL(`../src-tauri/${relative}`, import.meta.url));
    assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(data.readUInt32BE(16), data.readUInt32BE(20));
    assert.ok(data.readUInt32BE(16) >= 128);
  }
  const native = readFileSync(new URL('../src-tauri/src/main.rs', import.meta.url), 'utf8');
  assert.match(native, /builder = builder\.icon\(icon\.clone\(\)\)/);
});
