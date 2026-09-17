'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventLog } = require('../src/events');

test('the log stores facts, not judgments', async () => {
  // Severity is derived on read. Writing it here would freeze a judgment into
  // an append-only file that still holds events from weeks ago.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'asm-events-'));
  const log = new EventLog(dir);

  await log.append(
    [{ type: 'role_removed', subject: 'principal-1', detail: {}, collector: 'governance' }],
    '2026-09-17T08:00:00.000Z'
  );

  const raw = await fs.readFile(path.join(dir, 'events.jsonl'), 'utf8');
  const stored = JSON.parse(raw.trim());
  assert.deepEqual(Object.keys(stored).sort(), ['at', 'collector', 'detail', 'subject', 'type']);
  assert.equal('severity' in stored, false);
});
