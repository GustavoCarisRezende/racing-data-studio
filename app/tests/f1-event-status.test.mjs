import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFutureEvent, isPendingEvent } from '../src/categories/f1/event-status.ts';

const now = new Date('2026-11-14T12:00:00Z');

test('future calendar dates are pending regardless of local result rows', () => {
  assert.equal(isFutureEvent({ date: '2026-11-15' }, now), true);
  assert.equal(isPendingEvent({ date: '2026-11-15' }, [{ round: '3', type: 'results' }], '3', now), true);
});

test('same-day events use an explicit schedule timezone, while date-only events are not assumed future', () => {
  assert.equal(isFutureEvent({ date: '2026-11-14' }, now), false);
  assert.equal(isFutureEvent({ date: '2026-11-14', time: '13:00:00Z' }, now), true);
  assert.equal(isFutureEvent({ date: '2026-11-14', time: '11:00:00Z' }, now), false);
  assert.equal(isFutureEvent({ date: '2026-11-14', time: '13:00:00' }, now), false);
});

test('an event is pending without any local race or sprint results', () => {
  assert.equal(isPendingEvent({ date: '2026-11-13' }, [], '3', now), true);
  assert.equal(isPendingEvent({ date: '2026-11-13' }, [{ round: '3', type: 'sprint' }], '3', now), false);
  assert.equal(isPendingEvent({ date: '2026-11-13' }, [{ round: '3', type: 'results' }], '3', now), false);
  assert.equal(isPendingEvent({ date: '2026-11-13' }, [{ round: '4', type: 'results' }], '3', now), true);
  assert.equal(isPendingEvent({ date: 'not-a-date' }, [{ round: '3', type: 'qualifying' }], '3', now), true);
});

test('civil dates are compared as calendar dates, independent of UTC conversion', () => {
  const localMidnight = new Date(2026, 10, 14, 0, 5);
  assert.equal(isFutureEvent({ date: '2026-11-14' }, localMidnight), false);
  assert.equal(isFutureEvent({ date: '2026-11-15' }, localMidnight), true);
  assert.equal(isFutureEvent({ date: '2026-02-30' }, now), false);
});

test('explicit schedule instants take precedence over the machine civil date in both directions', () => {
  const previousTimezone = process.env.TZ;
  try {
    process.env.TZ = 'America/Sao_Paulo';
    // Local date is Nov 14, but the Nov 15 UTC schedule already passed.
    assert.equal(isFutureEvent(
      { date: '2026-11-15', time: '00:00:00Z' },
      new Date('2026-11-15T01:00:00Z'),
    ), false);

    process.env.TZ = 'Pacific/Kiritimati';
    // Local date is Nov 15, but the Nov 14 UTC schedule is still upcoming.
    assert.equal(isFutureEvent(
      { date: '2026-11-14', time: '23:00:00Z' },
      new Date('2026-11-14T12:00:00Z'),
    ), true);
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});
