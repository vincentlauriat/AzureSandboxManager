'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { collectGovernance } = require('../src/collect/governance');
const { ArmAccessError } = require('../src/arm');

const SCOPE = { subscriptionId: 'sub', resourceGroup: 'rg' };

/** Fake ARM client whose getAll succeeds or fails per path fragment. */
function fakeArm(responses) {
  return {
    async getAll(path) {
      for (const [fragment, value] of Object.entries(responses)) {
        if (path.endsWith(`/${fragment}`)) {
          if (value instanceof Error) throw value;
          return value;
        }
      }
      throw new Error(`unexpected path: ${path}`);
    },
  };
}

const ROLE = { name: 'a1', properties: { principalId: 'p1', principalType: 'User', roleDefinitionId: '/x/b24988ac', scope: '/rg' } };

test('all four parts succeeding are all reported', async () => {
  const arm = fakeArm({
    roleAssignments: [ROLE],
    locks: [{ name: 'lock', properties: { level: 'CanNotDelete' } }],
    denyAssignments: [],
    permissions: [{ actions: ['*'], notActions: [] }],
  });

  const result = await collectGovernance(arm, SCOPE);
  assert.equal(result.roleAssignments.length, 1);
  assert.equal(result.locks.length, 1);
  assert.deepEqual(result.unavailable, {});
});

// The rule the whole project depends on, applied one level deeper.
test('a denied sub-read does not take role assignments down with it', async () => {
  const arm = fakeArm({
    roleAssignments: [ROLE],
    locks: new ArmAccessError('AuthorizationFailed', { status: 403 }),
    denyAssignments: [],
    permissions: [],
  });

  const result = await collectGovernance(arm, SCOPE);

  assert.equal(result.roleAssignments.length, 1, 'role assignments must survive');
  assert.equal(result.roleAssignments[0].principalId, 'p1');
  assert.deepEqual(result.locks, []);
  assert.match(result.unavailable.locks, /AuthorizationFailed/);
});

test('an unavailable part is flagged, never passed off as empty', async () => {
  const arm = fakeArm({
    roleAssignments: [],
    locks: new ArmAccessError('denied', { status: 403 }),
    denyAssignments: [],
    permissions: [],
  });

  const result = await collectGovernance(arm, SCOPE);
  // Both read as [], so only `unavailable` distinguishes "none" from "unknown".
  assert.deepEqual(result.denyAssignments, []);
  assert.equal(result.unavailable.denyAssignments, undefined);
  assert.ok(result.unavailable.locks);
});

test('a total failure makes the collector itself fail', async () => {
  const denied = new ArmAccessError('AuthorizationFailed', { status: 403 });
  const arm = fakeArm({ roleAssignments: denied, locks: denied, denyAssignments: denied, permissions: denied });

  await assert.rejects(() => collectGovernance(arm, SCOPE), (error) => {
    assert.equal(error.denied, true);
    return true;
  });
});

test('role assignments are sorted so the diff is stable', async () => {
  const arm = fakeArm({
    roleAssignments: [{ name: 'c' }, { name: 'a' }, { name: 'b' }],
    locks: [],
    denyAssignments: [],
    permissions: [],
  });

  const result = await collectGovernance(arm, SCOPE);
  assert.deepEqual(result.roleAssignments.map((r) => r.id), ['a', 'b', 'c']);
});
