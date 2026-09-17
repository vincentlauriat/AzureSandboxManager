'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runCollector } = require('../src/collect');
const { ArmAccessError } = require('../src/arm');

test('a successful collector reports ok with its data', async () => {
  const result = await runCollector(async () => [1, 2, 3]);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.data, [1, 2, 3]);
  assert.equal(result.message, null);
});

test('an authorisation failure reports denied, not error', async () => {
  const result = await runCollector(async () => {
    throw new ArmAccessError('AuthorizationFailed', { status: 403, code: 'AuthorizationFailed' });
  });
  assert.equal(result.status, 'denied');
  assert.equal(result.data, null);
  assert.match(result.message, /AuthorizationFailed/);
});

test('a not-found is treated as denied', async () => {
  // ARM answers 404 for an identity with no assignment at all, not 403.
  const result = await runCollector(async () => {
    throw new ArmAccessError('Subscription not found', { status: 404 });
  });
  assert.equal(result.status, 'denied');
});

test('an unexpected failure reports error', async () => {
  const result = await runCollector(async () => {
    throw new Error('socket hang up');
  });
  assert.equal(result.status, 'error');
  assert.match(result.message, /socket hang up/);
});

test('one collector failing does not affect another', async () => {
  const [bad, good] = await Promise.all([
    runCollector(async () => {
      throw new ArmAccessError('denied', { status: 403 });
    }),
    runCollector(async () => 'still here'),
  ]);
  assert.equal(bad.status, 'denied');
  assert.equal(good.status, 'ok');
  assert.equal(good.data, 'still here');
});

// --- The snapshot must name the scope it describes ---------------------------------

const { collect } = require('../src/collector');

test('the snapshot names the subscription and resource group it describes', async () => {
  // A client guarding a write action needs to prove the snapshot it is acting on
  // describes the subscription `az` is pointed at. The server knows both from its
  // own configuration, so it publishes them rather than letting clients guess.
  const arm = { available: true };
  const config = { subscriptionId: 'sub-42', resourceGroup: 'rg-sandbox', selfSiteName: 'mgr' };

  const snapshot = await collect(arm, config);

  assert.deepEqual(snapshot.identity, {
    available: true,
    subscriptionId: 'sub-42',
    resourceGroup: 'rg-sandbox',
  });
});

test('identity is published even when every collector fails', async () => {
  // Knowing which subscription a snapshot describes must not depend on ARM
  // being reachable — it is configuration, not a collection.
  const arm = { available: false };
  const config = { subscriptionId: 'sub-42', resourceGroup: 'rg-sandbox', selfSiteName: 'mgr' };

  const snapshot = await collect(arm, config);

  assert.equal(snapshot.identity.subscriptionId, 'sub-42');
  assert.equal(snapshot.identity.available, false);
  assert.notEqual(snapshot.resources.status, 'ok');
});
