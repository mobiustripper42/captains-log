import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Y_PATTERN, formatConfirmation } from '../lib/purser.js';

// --- Y_PATTERN ---

test('Y_PATTERN matches bare Y', () => {
  assert.ok(Y_PATTERN.test('Y'));
  assert.ok(Y_PATTERN.test('y'));
});

test('Y_PATTERN matches yes / yep / yo', () => {
  assert.ok(Y_PATTERN.test('yes'));
  assert.ok(Y_PATTERN.test('YES'));
  assert.ok(Y_PATTERN.test('yep'));
  assert.ok(Y_PATTERN.test('yo'));
});

test('Y_PATTERN matches with surrounding whitespace', () => {
  assert.ok(Y_PATTERN.test('  Y  '));
  assert.ok(Y_PATTERN.test('\tyes\n'));
});

test('Y_PATTERN rejects corrections and other text', () => {
  assert.ok(!Y_PATTERN.test('actually 3 trips not 4'));
  assert.ok(!Y_PATTERN.test('yeah but the boat was blue'));
  assert.ok(!Y_PATTERN.test(''));
  assert.ok(!Y_PATTERN.test('nope'));
});

// --- formatConfirmation ---

const full = {
  boat: 'Brewboat',
  route: 'Cuyahoga River',
  trip_count: 3,
  trip_start: '1:00pm',
  trip_end: '8:00pm',
  total_passengers: 45,
  passengers_by_trip: null,
  first_mate: 'Mike',
  emergency_drills: null,
  issues: [],
  notes: null,
};

test('formatConfirmation happy path includes all key fields', () => {
  const msg = formatConfirmation('Eric', full);
  assert.ok(msg.includes('Brewboat'));
  assert.ok(msg.includes('Cuyahoga River'));
  assert.ok(msg.includes('3 trips'));
  assert.ok(msg.includes('1:00pm'));
  assert.ok(msg.includes('8:00pm'));
  assert.ok(msg.includes('45 passengers'));
  assert.ok(msg.includes('First mate: Mike'));
  assert.ok(msg.includes('Reply Y to file'));
});

test('formatConfirmation warns on missing first mate', () => {
  const msg = formatConfirmation('Eric', { ...full, first_mate: null });
  assert.ok(msg.includes('⚠ First mate: not provided'));
});

test('formatConfirmation shows per-trip breakdown when available', () => {
  const msg = formatConfirmation('Eric', {
    ...full,
    passengers_by_trip: [12, 12, 13],
    total_passengers: 37,
  });
  assert.ok(msg.includes('12 + 12 + 13 = 37'));
  assert.ok(!msg.includes('45 passengers'));
});

test('formatConfirmation shows emergency drills when completed', () => {
  const msg = formatConfirmation('Eric', { ...full, emergency_drills: true });
  assert.ok(msg.includes('Emergency drills: completed'));
});

test('formatConfirmation omits emergency drills when null', () => {
  const msg = formatConfirmation('Eric', { ...full, emergency_drills: null });
  assert.ok(!msg.includes('Emergency drills'));
});

test('formatConfirmation lists issues', () => {
  const msg = formatConfirmation('Eric', {
    ...full,
    issues: ['VHF cutting out on ch 16'],
  });
  assert.ok(msg.includes('Issue: VHF cutting out on ch 16'));
});

test('formatConfirmation singular trip', () => {
  const msg = formatConfirmation('Eric', { ...full, trip_count: 1 });
  assert.ok(msg.includes('1 trip,'));
  assert.ok(!msg.includes('1 trips'));
});

test('formatConfirmation uses captain name in header', () => {
  const msg = formatConfirmation('Drew', full);
  assert.ok(msg.startsWith('Confirming your log, Drew:'));
});
