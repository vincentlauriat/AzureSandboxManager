'use strict';

const http = require('node:http');
const { load } = require('./src/config');
const { ArmClient } = require('./src/arm');
const { SnapshotStore } = require('./src/snapshot');
const { EventLog } = require('./src/events');
const { collect } = require('./src/collector');
const { diffSnapshots } = require('./src/diff');
const { createHandler } = require('./src/api');

async function main() {
  const config = load();
  const arm = new ArmClient();
  const store = new SnapshotStore(config.snapshotDir);
  const log = new EventLog(config.snapshotDir);

  await store.init();

  async function runCollection() {
    const previous = await store.latest();
    const snapshot = await collect(arm, config);
    await store.write(snapshot);

    const events = diffSnapshots(previous, snapshot);
    if (events.length) {
      await log.append(events, snapshot.collectedAt);
      console.log(`[collect] ${events.length} change(s): ${events.map((e) => e.type).join(', ')}`);
    } else {
      console.log(`[collect] done in ${snapshot.durationMs} ms, no change`);
    }
    return snapshot;
  }

  const handler = createHandler({ config, store, log, runCollection });

  const server = http.createServer((req, res) => {
    handler(req, res).catch((error) => {
      console.error('[http] unhandled error', error);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'InternalError', message: error.message }));
    });
  });

  server.listen(config.port, () => {
    console.log(`[server] listening on ${config.port}, watching ${config.resourceGroup}`);
  });

  // First collection immediately, then on the configured interval.
  runCollection().catch((error) => console.error('[collect] initial collection failed', error));
  setInterval(
    () => runCollection().catch((error) => console.error('[collect] failed', error)),
    config.collectIntervalMinutes * 60 * 1000
  ).unref();
}

main().catch((error) => {
  console.error('[fatal]', error.message);
  process.exit(1);
});
