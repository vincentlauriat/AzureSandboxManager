'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ArmClient, ArmAccessError } = require('../src/arm');

const IDENTITY_ENV = { IDENTITY_ENDPOINT: 'http://127.0.0.1:1234/msi/token', IDENTITY_HEADER: 'header-value' };

function tokenResponse(expiresOnSeconds) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      access_token: 'token-abc',
      // App Service returns expires_on as a STRING of epoch seconds.
      expires_on: String(expiresOnSeconds),
      resource: 'https://management.azure.com',
      token_type: 'Bearer',
    }),
  };
}

test('no managed identity is reported clearly rather than crashing', async () => {
  const arm = new ArmClient({ env: {}, fetchImpl: async () => { throw new Error('should not be called'); } });
  assert.equal(arm.available, false);
  await assert.rejects(() => arm.getToken(), (error) => {
    assert.ok(error instanceof ArmAccessError);
    assert.match(error.message, /No managed identity available/);
    return true;
  });
});

test('the token request uses the documented App Service contract', async () => {
  let seenUrl = null;
  let seenHeaders = null;
  const arm = new ArmClient({
    env: IDENTITY_ENV,
    now: () => 0,
    fetchImpl: async (url, options) => {
      seenUrl = url;
      seenHeaders = options.headers;
      return tokenResponse(3600);
    },
  });

  assert.equal(await arm.getToken(), 'token-abc');
  assert.match(seenUrl, /api-version=2019-08-01/);
  assert.match(seenUrl, /resource=https%3A%2F%2Fmanagement\.azure\.com/);
  assert.equal(seenHeaders['X-IDENTITY-HEADER'], 'header-value');
});

test('expires_on arriving as a string is parsed, not compared as text', async () => {
  let calls = 0;
  const arm = new ArmClient({
    env: IDENTITY_ENV,
    now: () => 0,
    fetchImpl: async () => {
      calls += 1;
      return tokenResponse(3600);
    },
  });

  await arm.getToken();
  await arm.getToken();
  // A string compared against a number would look permanently expired and
  // refetch on every call.
  assert.equal(calls, 1, 'the token should be cached, not refetched');
});

test('an expiring token is refreshed before it dies', async () => {
  let calls = 0;
  let clock = 0;
  const arm = new ArmClient({
    env: IDENTITY_ENV,
    now: () => clock,
    fetchImpl: async () => {
      calls += 1;
      return tokenResponse(600); // expires 600 s after epoch
    },
  });

  await arm.getToken();
  clock = 400_000; // 400 s in: inside the 5-minute safety margin
  await arm.getToken();
  assert.equal(calls, 2);
});

test('an unparsable expires_on is rejected loudly', async () => {
  const arm = new ArmClient({
    env: IDENTITY_ENV,
    now: () => 0,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ access_token: 't', expires_on: 'not-a-number' }) }),
  });
  await assert.rejects(() => arm.getToken(), /unparsable expires_on/);
});

test('a 403 from ARM is marked as denied', async () => {
  const arm = new ArmClient({
    env: IDENTITY_ENV,
    now: () => 0,
    fetchImpl: async (url) => {
      if (url.includes('msi/token')) return tokenResponse(3600);
      return {
        ok: false,
        status: 403,
        json: async () => ({ error: { code: 'AuthorizationFailed', message: 'does not have authorization' } }),
      };
    },
  });

  await assert.rejects(() => arm.get('/subscriptions/x/resourceGroups/y/resources', '2021-04-01'), (error) => {
    assert.equal(error.denied, true);
    assert.equal(error.code, 'AuthorizationFailed');
    return true;
  });
});

test('a 404 from ARM is also denied, since that is what it returns without any assignment', async () => {
  const arm = new ArmClient({
    env: IDENTITY_ENV,
    now: () => 0,
    fetchImpl: async (url) => {
      if (url.includes('msi/token')) return tokenResponse(3600);
      return { ok: false, status: 404, json: async () => ({ error: { code: 'SubscriptionNotFound', message: 'not found' } }) };
    },
  });

  await assert.rejects(() => arm.get('/subscriptions/x', '2022-12-01'), (error) => {
    assert.equal(error.denied, true);
    return true;
  });
});

test('paged lists are followed to the end', async () => {
  const arm = new ArmClient({
    env: IDENTITY_ENV,
    now: () => 0,
    fetchImpl: async (url) => {
      if (url.includes('msi/token')) return tokenResponse(3600);
      if (url.includes('page2')) return { ok: true, status: 200, json: async () => ({ value: [{ name: 'c' }] }) };
      return {
        ok: true,
        status: 200,
        json: async () => ({ value: [{ name: 'a' }, { name: 'b' }], nextLink: 'https://management.azure.com/page2' }),
      };
    },
  });

  const items = await arm.getAll('/subscriptions/x/resourceGroups/y/resources', '2021-04-01');
  assert.deepEqual(items.map((i) => i.name), ['a', 'b', 'c']);
});

test('a missing managed identity is denied, not an error', async () => {
  // Otherwise the dashboard shows a crash instead of the setup instructions
  // on the very first deployment.
  const arm = new ArmClient({ env: {}, fetchImpl: async () => { throw new Error('unreachable'); } });
  await assert.rejects(() => arm.getToken(), (error) => {
    assert.equal(error.denied, true, 'NoManagedIdentity must be classified as denied');
    assert.equal(error.code, 'NoManagedIdentity');
    return true;
  });
});
