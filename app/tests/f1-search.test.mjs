import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterEvents } from '../src/categories/f1/search.ts';

const events = [
  { round: '1', raceName: 'São Paulo Grand Prix', Circuit: { circuitName: 'Autódromo José Carlos Pace' } },
  { round: '2', raceName: 'Monaco Grand Prix', Circuit: { circuitName: 'Circuit de Monaco' } },
  { round: '10', raceName: 'British Grand Prix' },
];

test('filters by event name, circuit or round without case or accent sensitivity', () => {
  assert.deepEqual(filterEvents(events, ' SAO PAULO ').map((e) => e.round), ['1']);
  assert.deepEqual(filterEvents(events, 'autodromo jose').map((e) => e.round), ['1']);
  assert.deepEqual(filterEvents(events, 'monaco').map((e) => e.round), ['2']);
  assert.deepEqual(filterEvents(events, 'R2').map((e) => e.round), ['2']);
  assert.deepEqual(filterEvents(events, 'rodada 10').map((e) => e.round), ['10']);
  assert.deepEqual(filterEvents(events, 'round 2').map((e) => e.round), ['2']);
});

test('empty query keeps calendar order; missing circuits and no matches are safe', () => {
  assert.deepEqual(filterEvents(events, '  '), events);
  assert.deepEqual(filterEvents(events, 'unknown'), []);
  assert.deepEqual(filterEvents(events, 'british').map((e) => e.round), ['10']);
  assert.deepEqual(filterEvents([], 'r1'), []);
});
