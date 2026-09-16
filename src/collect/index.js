'use strict';

/**
 * Every collector returns the same envelope so that one failure never hides
 * the other sections:
 *
 *   { status: 'ok' | 'denied' | 'error', data, message, durationMs }
 *
 * A denied collector is a normal, expected state — the app is designed to be
 * useful before the Reader role has been granted.
 */

const { ArmAccessError } = require('../arm');

async function runCollector(fn, now = () => Date.now()) {
  const startedAt = now();
  try {
    const data = await fn();
    return { status: 'ok', data, message: null, durationMs: now() - startedAt };
  } catch (error) {
    const denied = error instanceof ArmAccessError && error.denied;
    return {
      status: denied ? 'denied' : 'error',
      data: null,
      message: error.message,
      durationMs: now() - startedAt,
    };
  }
}

module.exports = { runCollector };
