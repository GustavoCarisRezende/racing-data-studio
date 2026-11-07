import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, formatTimestamp } from '../src/categories/f1/dates.ts';

test('pure calendar dates do not depend on system timezone', () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ['America/Sao_Paulo', 'Pacific/Kiritimati', 'America/Los_Angeles']) {
      process.env.TZ = zone;
      assert.equal(formatDate('2024-03-01', 'pt-BR'), '01/03/2024');
      assert.equal(formatDate('2024-03-01', 'en-US'), '2024/03/01');
      assert.equal(formatDate('2024-02-29', 'pt-BR'), '29/02/2024');
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('timestamps display UTC with requested date order and preserve precision', () => {
  assert.equal(formatTimestamp('2024-03-01T00:30:22.123Z', 'pt-BR'), '01/03/2024 00:30:22.123');
  assert.equal(formatTimestamp('2024-03-01T00:30:22.123Z', 'en-US'), '2024/03/01 00:30:22.123');
  assert.equal(formatTimestamp('2024-03-01T00:30:00+02:00', 'pt-BR'), '29/02/2024 22:30:00');
});

test('invalid or missing inputs are handled without guessing', () => {
  for (const input of ['2023-02-29', '2024-13-01', 'garbage']) assert.equal(formatDate(input, 'pt-BR'), input);
  for (const input of ['2024-02-30T00:00:00Z', '2024-01-01T25:00:00Z', '2024-01-01T00:00:00', 'bad']) assert.equal(formatTimestamp(input, 'en-US'), input);
  assert.equal(formatDate(null, 'en-US'), '—');
  assert.equal(formatTimestamp(undefined, 'pt-BR'), '—');
});
