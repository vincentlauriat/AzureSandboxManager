'use strict';

/**
 * Configuration is read from the environment only. No real subscription,
 * tenant or resource identifier is ever committed to this repository.
 */

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optionalInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  // A non-numeric value is a configuration mistake, not a reason to guess.
  if (!Number.isFinite(value)) throw new Error(`${name} must be an integer, got: ${raw}`);
  return value;
}

function load(env = process.env) {
  const previous = process.env;
  process.env = env;
  try {
    return {
      token: required('SANDBOX_TOKEN'),
      subscriptionId: required('AZURE_SUBSCRIPTION_ID'),
      resourceGroup: required('AZURE_RESOURCE_GROUP'),
      collectIntervalMinutes: optionalInt('COLLECT_INTERVAL_MINUTES', 10),
      snapshotDir: env.SNAPSHOT_DIR || '/home/azure-sandbox-manager',
      port: optionalInt('PORT', 8080),
      // Set by App Service; absent when running locally.
      selfSiteName: env.WEBSITE_SITE_NAME || null,
    };
  } finally {
    process.env = previous;
  }
}

module.exports = { load, optionalInt };
