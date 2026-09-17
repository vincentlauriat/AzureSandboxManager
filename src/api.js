'use strict';

const crypto = require('node:crypto');
const { renderPage, renderRoleHint } = require('./html');
const { withSeverity } = require('./vocabulary');

const REFRESH_COOLDOWN_MS = 30_000;

/**
 * Constant-time token comparison. A plain === leaks the shared secret's
 * prefix through response timing.
 */
function tokenMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // timingSafeEqual throws on length mismatch, so compare digests of equal size.
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function ageSeconds(snapshot, now) {
  if (!snapshot?.collectedAt) return null;
  return (now - Date.parse(snapshot.collectedAt)) / 1000;
}

function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(payload);
}

function fail(res, status, error, message) {
  json(res, status, { error, message });
}

/**
 * @param {object} deps
 * @param {object} deps.config
 * @param {import('./snapshot').SnapshotStore} deps.store
 * @param {import('./events').EventLog} deps.log
 * @param {() => Promise<object>} deps.runCollection forces a collection
 */
function createHandler({ config, store, log, runCollection, now = () => Date.now() }) {
  let lastRefreshAt = 0;

  return async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;

    // Liveness probe: no token, so Azure and uptime checks can reach it.
    if (path === '/healthz') {
      return json(res, 200, { status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
    }

    const authorised = tokenMatches(req.headers['x-sandbox-token'], config.token);

    if (path === '/' && req.method === 'GET') {
      if (!authorised) {
        // The page bootstraps its own token, so serve a minimal prompt shell.
        res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(
          '<!doctype html><meta charset="utf-8"><title>Azure Sandbox Manager</title>' +
            '<body style="font:15px system-ui;background:#0f172a;color:#e2e8f0;padding:40px">' +
            '<h1>Azure Sandbox Manager</h1><p>A token is required.</p>' +
            '<script>(function(){var t=null;try{t=localStorage.getItem("sandbox-token")}catch(e){}' +
            'if(!t){t=prompt("Access token");try{if(t)localStorage.setItem("sandbox-token",t)}catch(e){}}' +
            'if(t){fetch("/",{headers:{"X-Sandbox-Token":t}}).then(function(r){return r.text()})' +
            '.then(function(h){document.open();document.write(h);document.close()})}})()</script></body>'
        );
      }
      const snapshot = await store.latest();
      const events = withSeverity(await log.read(20));
      const html = renderPage({
        snapshot,
        events,
        ageSeconds: ageSeconds(snapshot, now()) ?? 0,
        roleHint: renderRoleHint(snapshot),
      });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }

    if (!path.startsWith('/api/v1/')) return fail(res, 404, 'NotFound', `No route for ${path}`);
    if (!authorised) return fail(res, 401, 'Unauthorized', 'Missing or invalid X-Sandbox-Token header');

    if (path === '/api/v1/snapshot' && req.method === 'GET') {
      const snapshot = await store.latest();
      if (!snapshot) return fail(res, 503, 'NoSnapshot', 'No collection has completed yet');
      return json(res, 200, { collectedAt: snapshot.collectedAt, ageSeconds: ageSeconds(snapshot, now()), snapshot });
    }

    if (path === '/api/v1/apps' && req.method === 'GET') {
      const snapshot = await store.latest();
      if (!snapshot) return fail(res, 503, 'NoSnapshot', 'No collection has completed yet');
      return json(res, 200, {
        collectedAt: snapshot.collectedAt,
        ageSeconds: ageSeconds(snapshot, now()),
        apps: snapshot.apps,
        probes: snapshot.probes,
      });
    }

    if (path === '/api/v1/changes' && req.method === 'GET') {
      const requested = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);
      const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 500) : 50;
      return json(res, 200, { limit, events: withSeverity(await log.read(limit)) });
    }

    if (path === '/api/v1/refresh' && req.method === 'POST') {
      const snapshot = await store.latest();
      if (now() - lastRefreshAt < REFRESH_COOLDOWN_MS) {
        // Insisting must not trigger a burst of ARM calls.
        res.setHeader('X-Refresh-Skipped', 'true');
        if (!snapshot) return fail(res, 503, 'NoSnapshot', 'No collection has completed yet');
        return json(res, 200, { collectedAt: snapshot.collectedAt, ageSeconds: ageSeconds(snapshot, now()), snapshot });
      }
      lastRefreshAt = now();
      const fresh = await runCollection();
      return json(res, 200, { collectedAt: fresh.collectedAt, ageSeconds: 0, snapshot: fresh });
    }

    return fail(res, 404, 'NotFound', `No route for ${req.method} ${path}`);
  };
}

module.exports = { createHandler, tokenMatches, REFRESH_COOLDOWN_MS };
