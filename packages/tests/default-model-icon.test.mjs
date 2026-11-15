import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { translator } from '@rds/sandbox-react';
import { ModelManager } from '../sandbox-react/dist/model-manager.js';

test('model list has direct open and edit/delete actions without default stars', () => {
  const items = [
    { id: 'f1-default-teams', title: 'User-renamed default', revision: '1', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'user-1', title: 'Points by team', revision: '1', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'f1-default-teams-extra', title: 'Another model', revision: '1', updatedAt: '2026-01-01T00:00:00Z' },
  ];
  const noop = () => {};
  const html = renderToStaticMarkup(createElement(ModelManager, { t: translator('en-US'), items, defaultModelIds: ['f1-default-teams'], onOpen: noop, onEdit: noop, onDelete: noop, onRefresh: noop, onNew: noop, onRename: noop, disabled: false, loading: false, error: '' }));
  assert.ok(!html.includes("Default model"));
  assert.equal((html.match(/class="rds-sb-model-open"/g) ?? []).length, 3);
  assert.ok(!html.includes("<details" ) || html.includes("Manage models"));
  assert.equal((html.match(/aria-label="Delete model:/g) ?? []).length, 3);
  assert.equal((html.match(/aria-label="Edit model:/g) ?? []).length, 3);
  assert.ok(!html.includes('disabled=""'));
});
