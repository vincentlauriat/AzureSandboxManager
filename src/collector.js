'use strict';

const { runCollector } = require('./collect');
const { collectResources } = require('./collect/resources');
const { collectPlans, collectApps } = require('./collect/appservice');
const { collectBudget } = require('./collect/budget');
const { collectGovernance } = require('./collect/governance');
const { probeApps } = require('./probe');

/**
 * Runs every collector, tolerating individual failures, and returns one
 * snapshot. ARM collectors run in parallel; probes depend on the app list and
 * therefore run afterwards.
 */
async function collect(arm, config, { now = () => Date.now(), clock = () => new Date() } = {}) {
  const startedAt = now();
  const scope = { subscriptionId: config.subscriptionId, resourceGroup: config.resourceGroup };

  const [resources, plans, apps, budget, governance] = await Promise.all([
    runCollector(() => collectResources(arm, scope), now),
    runCollector(() => collectPlans(arm, scope), now),
    runCollector(() => collectApps(arm, scope), now),
    runCollector(() => collectBudget(arm, scope), now),
    runCollector(() => collectGovernance(arm, scope), now),
  ]);

  // Probes need the app list. When it is unavailable the probes are not an
  // error — there is simply nothing to probe.
  const probes =
    apps.status === 'ok'
      ? await runCollector(() => probeApps(apps.data, { selfSiteName: config.selfSiteName }), now)
      : { status: 'error', data: null, message: 'App list unavailable, nothing to probe', durationMs: 0 };

  return {
    collectedAt: clock().toISOString(),
    durationMs: now() - startedAt,
    // Not a collector section: this is configuration, and it can never be denied.
    // A client guarding a write action compares `subscriptionId` against the one
    // `az` is pointed at, so the snapshot has to name the scope it describes.
    identity: {
      available: arm.available,
      subscriptionId: config.subscriptionId,
      resourceGroup: config.resourceGroup,
    },
    resources,
    plans,
    apps,
    budget,
    governance,
    probes,
  };
}

module.exports = { collect };
