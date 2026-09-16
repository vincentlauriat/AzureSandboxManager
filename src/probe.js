'use strict';

/**
 * HTTP probes of the web apps in the resource group.
 *
 * Two rules, both learned the hard way:
 *  - The manager excludes itself. Probing yourself measures nothing but your
 *    own ability to answer.
 *  - Every probe is bounded and they run in parallel. A cold start on a Free
 *    tier plan was measured at 41 s; four sequential unbounded probes would
 *    overrun a 10-minute collection interval.
 */

const PROBE_TIMEOUT_MS = 15_000;

async function probeOne(app, { fetchImpl = globalThis.fetch, timeoutMs = PROBE_TIMEOUT_MS, now = () => Date.now() } = {}) {
  const startedAt = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(app.url, { signal: controller.signal, redirect: 'manual' });
    return { app: app.name, url: app.url, httpStatus: response.status, latencyMs: now() - startedAt, error: null };
  } catch (error) {
    const timedOut = error.name === 'AbortError';
    return {
      app: app.name,
      url: app.url,
      httpStatus: null,
      latencyMs: now() - startedAt,
      // A timeout is information, not a collection failure: a cold start can
      // legitimately exceed the bound.
      error: timedOut ? 'timeout' : error.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeApps(apps, { selfSiteName = null, ...options } = {}) {
  const targets = (apps ?? []).filter((a) => a.url && a.name !== selfSiteName);
  return Promise.all(targets.map((app) => probeOne(app, options)));
}

module.exports = { probeApps, probeOne, PROBE_TIMEOUT_MS };
