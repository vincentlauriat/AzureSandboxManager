'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EVENT_TYPES, severityOf, assertKnownType, withSeverity } = require('../src/vocabulary');

test('the vocabulary holds exactly the twelve types the diff engine emits', () => {
  assert.equal(EVENT_TYPES.length, 12);
});

test('losing or regaining collector access is critical', () => {
  assert.equal(severityOf('collector_access_lost'), 'critical');
  assert.equal(severityOf('collector_access_restored'), 'critical');
});

test('governance and budget changes are notable', () => {
  for (const type of ['role_added', 'role_removed', 'lock_added', 'lock_removed', 'budget_threshold_crossed']) {
    assert.equal(severityOf(type), 'notable', type);
  }
});

test('inventory and probe changes are informational', () => {
  for (const type of ['resource_added', 'resource_removed', 'app_state_changed', 'plan_tier_changed', 'probe_status_changed']) {
    assert.equal(severityOf(type), 'informational', type);
  }
});

test('an unknown type reads as notable, never informational', () => {
  // Never quieter than what is known. An old log line whose type this table no
  // longer carries must stay visible; demoting it to informational would hide
  // it behind a blank marker.
  assert.equal(severityOf('something_new'), 'notable');
});

test('assertKnownType names the file to edit', () => {
  assert.equal(assertKnownType('role_added'), 'role_added');
  assert.throws(() => assertKnownType('something_new'), /src\/vocabulary\.js/);
});

test('withSeverity decorates without mutating the input', () => {
  const stored = [{ at: '2026-09-17T08:00:00.000Z', type: 'role_removed', subject: 'x', detail: {}, collector: 'governance' }];
  const out = withSeverity(stored);
  assert.equal(out[0].severity, 'notable');
  assert.equal('severity' in stored[0], false);
});

test('withSeverity tolerates an absent list', () => {
  assert.deepEqual(withSeverity(undefined), []);
});
