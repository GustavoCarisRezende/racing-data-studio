import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('snapshot action DOM order ends with an accessible icon-only delete button', async () => {
  const vite = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { SnapshotActions } = await vite.ssrLoadModule('/src/categories/f1/snapshot-actions.tsx');
    const t = (key) => key;
    const props = {
      snapshot: { id: 42, displayName: 'Race weekend', isActive: false, importedAt: '2026-01-01', dataAt: '2026-01-01' },
      active: false, renaming: false, snapshotName: '', snapshotError: null, t,
      deleteReasonText: t, onRename() {}, onNameChange() {}, onCancelRename() {}, onSaveRename() {},
      onCopyEvents() {}, onRestore() {}, onActivate() {}, onDelete() {},
    };
    const html = renderToStaticMarkup(React.createElement(SnapshotActions, props));
    const buttons = [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/g)].map(([, attributes, content]) => ({ attributes, content }));
    assert.deepEqual(buttons.map(({ content }) => content), ['activateSnapshot', 'renameSnapshot', 'copyEvents', 'restore', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m3 4v5m4-5v5"></path></svg>']);
    assert.match(buttons[4].attributes, /aria-label="deleteSnapshot: Race weekend"/);
    assert.equal(buttons[4].content.includes('deleteSnapshot'), false);

    const editing = renderToStaticMarkup(React.createElement(SnapshotActions, { ...props, renaming: true, snapshotName: 'Race weekend' }));
    const editButtons = [...editing.matchAll(/<button\b[^>]*>(.*?)<\/button>/g)].map(([, content]) => content);
    assert.deepEqual(editButtons, ['activateSnapshot', 'save', 'cancel', 'copyEvents', 'restore', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m3 4v5m4-5v5"></path></svg>']);

    const active = renderToStaticMarkup(React.createElement(SnapshotActions, {
      ...props, snapshot: { ...props.snapshot, isActive: true },
    }));
    const activeButtons = [...active.matchAll(/<button\b([^>]*)>(.*?)<\/button>/g)].map(([, attributes, content]) => ({ attributes, content }));
    assert.equal(activeButtons.some(({ content }) => content === 'activateSnapshot'), false);
    assert.match(activeButtons.find(({ content }) => content === 'restore').attributes, /disabled/);
    assert.match(activeButtons.at(-1).attributes, /disabled/);

    const snapshotsInDifferentOrder = renderToStaticMarkup(React.createElement(React.Fragment, null,
      React.createElement(SnapshotActions, props),
      React.createElement(SnapshotActions, { ...props, snapshot: { ...props.snapshot, id: 43, isActive: true } }),
    ));
    const orderedButtons = [...snapshotsInDifferentOrder.matchAll(/<button\b([^>]*)>(.*?)<\/button>/g)].map(([, attributes, content]) => ({ attributes, content }));
    assert.equal(orderedButtons.filter(({ content }) => content === 'activateSnapshot').length, 1);
    assert.doesNotMatch(orderedButtons[2].attributes, /disabled/);
    assert.match(orderedButtons[7].attributes, /disabled/);
    assert.match(orderedButtons[8].attributes, /disabled/);
  } finally {
    await vite.close();
  }
});
