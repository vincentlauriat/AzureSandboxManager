'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderPage } = require('../src/html');

const snapshot = {
  collectedAt: '2026-09-17T08:00:00.000Z',
  apps: { status: 'ok', data: [] },
  probes: { status: 'ok', data: [] },
  resources: { status: 'ok', data: [] },
  plans: { status: 'ok', data: [] },
  budget: { status: 'ok', data: [] },
  governance: { status: 'denied', message: 'Authorization failed' },
};

function page(events) {
  return renderPage({ snapshot, events, ageSeconds: 12, roleHint: '' });
}

test('a critical event is marked and coloured', () => {
  const html = page([
    { at: '2026-09-17T08:00:00.000Z', type: 'collector_access_lost', subject: 'governance', detail: {}, severity: 'critical' },
  ]);
  assert.match(html, /<tr class="sev-critical">/);
  assert.match(html, /!! Access lost/);
});

test('an informational event carries no marker', () => {
  const html = page([
    { at: '2026-09-17T08:00:00.000Z', type: 'probe_status_changed', subject: 'api', detail: {}, severity: 'informational' },
  ]);
  assert.doesNotMatch(html, /<tr class="sev-/);
});

test('a denied section still renders as refused, never as an empty table', () => {
  // The rule the whole project exists to protect. Reading a revoked Reader
  // role as "no role assignments" is the false alarm being prevented.
  const html = page([]);
  assert.match(html, /Access denied/);
  assert.match(html, /Authorization failed/);
  // The governance table is not rendered at all — not rendered empty.
  assert.doesNotMatch(html, /Principal/);
});
