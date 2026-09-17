'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { diffSnapshots } = require('../src/diff');

const ok = (data) => ({ status: 'ok', data, message: null, durationMs: 1 });
const denied = (message = 'AuthorizationFailed') => ({ status: 'denied', data: null, message, durationMs: 1 });

function snapshot(overrides = {}) {
  return {
    collectedAt: '2026-09-16T10:00:00.000Z',
    resources: ok([]),
    plans: ok([]),
    apps: ok([]),
    budget: ok([]),
    governance: ok({ roleAssignments: [], locks: [], denyAssignments: [], effectivePermissions: [] }),
    probes: ok([]),
    ...overrides,
  };
}

const typesOf = (events) => events.map((e) => e.type);

test('no snapshot to compare yields no events', () => {
  assert.deepEqual(diffSnapshots(null, snapshot()), []);
  assert.deepEqual(diffSnapshots(snapshot(), null), []);
});

test('identical snapshots yield no events', () => {
  assert.deepEqual(diffSnapshots(snapshot(), snapshot()), []);
});

test('a role assignment disappearing is reported once', () => {
  const assignment = { id: 'a1', principalId: 'p-nominative', principalType: 'User', roleDefinitionId: 'b24988ac', scope: '/rg' };
  const before = snapshot({ governance: ok({ roleAssignments: [assignment], locks: [], denyAssignments: [], effectivePermissions: [] }) });
  const after = snapshot();

  const events = diffSnapshots(before, after);
  assert.deepEqual(typesOf(events), ['role_removed']);
  assert.equal(events[0].subject, 'p-nominative');
});

test('a role assignment appearing is reported once', () => {
  const assignment = { id: 'a2', principalId: 'p-adm', principalType: 'User', roleDefinitionId: 'b24988ac', scope: '/rg' };
  const after = snapshot({ governance: ok({ roleAssignments: [assignment], locks: [], denyAssignments: [], effectivePermissions: [] }) });

  assert.deepEqual(typesOf(diffSnapshots(snapshot(), after)), ['role_added']);
});

// The regression this whole design exists to prevent.
test('losing governance access emits exactly one access_lost and zero role_removed', () => {
  const assignments = Array.from({ length: 11 }, (_, i) => ({
    id: `a${i}`,
    principalId: `p${i}`,
    principalType: 'User',
    roleDefinitionId: 'b24988ac',
    scope: '/rg',
  }));
  const before = snapshot({ governance: ok({ roleAssignments: assignments, locks: [], denyAssignments: [], effectivePermissions: [] }) });
  const after = snapshot({ governance: denied() });

  const events = diffSnapshots(before, after);

  assert.deepEqual(typesOf(events), ['collector_access_lost']);
  assert.equal(events.filter((e) => e.type === 'role_removed').length, 0);
  assert.equal(events[0].subject, 'governance');
  assert.equal(events[0].detail.status, 'denied');
});

test('regaining access emits access_restored and no data events', () => {
  const assignments = [{ id: 'a1', principalId: 'p1', principalType: 'User', roleDefinitionId: 'b24988ac', scope: '/rg' }];
  const before = snapshot({ governance: denied() });
  const after = snapshot({ governance: ok({ roleAssignments: assignments, locks: [], denyAssignments: [], effectivePermissions: [] }) });

  const events = diffSnapshots(before, after);
  assert.deepEqual(typesOf(events), ['collector_access_restored']);
  assert.equal(events.filter((e) => e.type === 'role_added').length, 0);
});

test('two consecutive denied snapshots are silent', () => {
  const before = snapshot({ governance: denied() });
  const after = snapshot({ governance: denied() });
  assert.deepEqual(diffSnapshots(before, after), []);
});

test('resources added and removed are both reported', () => {
  const before = snapshot({ resources: ok([{ name: 'kept', type: 'T' }, { name: 'gone', type: 'T' }]) });
  const after = snapshot({ resources: ok([{ name: 'kept', type: 'T' }, { name: 'new', type: 'T' }]) });

  const events = diffSnapshots(before, after);
  assert.deepEqual(typesOf(events).sort(), ['resource_added', 'resource_removed']);
});

test('an app changing state is reported with both values', () => {
  const before = snapshot({ apps: ok([{ name: 'web', state: 'Running' }]) });
  const after = snapshot({ apps: ok([{ name: 'web', state: 'Stopped' }]) });

  const [event] = diffSnapshots(before, after);
  assert.equal(event.type, 'app_state_changed');
  assert.deepEqual(event.detail, { from: 'Running', to: 'Stopped' });
});

test('a plan tier change is reported', () => {
  const before = snapshot({ plans: ok([{ name: 'plan', tier: 'Basic', size: 'B1' }]) });
  const after = snapshot({ plans: ok([{ name: 'plan', tier: 'Standard', size: 'S1' }]) });

  const [event] = diffSnapshots(before, after);
  assert.equal(event.type, 'plan_tier_changed');
  assert.deepEqual(event.detail, { from: 'Basic/B1', to: 'Standard/S1' });
});

test('a budget threshold is reported only when it is crossed', () => {
  const before = snapshot({ budget: ok([{ name: 'b', percent: 80, thresholds: [90] }]) });
  const stillUnder = snapshot({ budget: ok([{ name: 'b', percent: 85, thresholds: [90] }]) });
  const crossed = snapshot({ budget: ok([{ name: 'b', percent: 91, thresholds: [90] }]) });

  assert.deepEqual(diffSnapshots(before, stillUnder), []);
  assert.deepEqual(typesOf(diffSnapshots(before, crossed)), ['budget_threshold_crossed']);
});

test('a probe status change is reported', () => {
  const before = snapshot({ probes: ok([{ app: 'web', httpStatus: 200 }]) });
  const after = snapshot({ probes: ok([{ app: 'web', httpStatus: 503 }]) });

  const [event] = diffSnapshots(before, after);
  assert.equal(event.type, 'probe_status_changed');
  assert.deepEqual(event.detail, { from: 200, to: 503 });
});

// --- Batch 0: the vocabulary guard -------------------------------------------------

const { EVENT_TYPES } = require('../src/vocabulary');

test('every type the diff engine emits is in the vocabulary', () => {
  // diffSnapshots routes every emission through the vocabulary guard, so this
  // asserts the wiring rather than re-listing the table.
  const denied = { status: 'denied', message: 'Authorization failed' };
  const lock = { name: 'keep-it', level: 'CanNotDelete' };
  const locked = ok({ roleAssignments: [], locks: [lock], denyAssignments: [], effectivePermissions: [] });

  const pairs = [
    [snapshot(), snapshot({ governance: denied })],
    [snapshot({ governance: denied }), snapshot()],
    [snapshot(), snapshot({ governance: locked })],
    [snapshot({ governance: locked }), snapshot()],
  ];

  const emitted = new Set();
  for (const [before, after] of pairs) {
    for (const e of diffSnapshots(before, after)) emitted.add(e.type);
  }

  assert.deepEqual(
    [...emitted].sort(),
    ['collector_access_lost', 'collector_access_restored', 'lock_added', 'lock_removed']
  );
  for (const type of emitted) assert.ok(EVENT_TYPES.includes(type), type);
});

test('a collector transition keeps its exact shape', () => {
  // The clients decode these four keys; the guard must not reshape them.
  const denied = { status: 'denied', message: 'Authorization failed' };
  const [event] = diffSnapshots(snapshot(), snapshot({ governance: denied }));
  assert.deepEqual(Object.keys(event).sort(), ['collector', 'detail', 'subject', 'type']);
  assert.equal(event.type, 'collector_access_lost');
  assert.equal(event.subject, 'governance');
  assert.equal(event.collector, 'governance');
  assert.deepEqual(event.detail, { status: 'denied', message: 'Authorization failed' });
});
