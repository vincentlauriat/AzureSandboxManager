'use strict';

const API_VERSION = '2023-12-01';

function planName(serverFarmId) {
  return typeof serverFarmId === 'string' ? serverFarmId.split('/').pop() : null;
}

async function collectPlans(arm, { subscriptionId, resourceGroup }) {
  const items = await arm.getAll(
    `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Web/serverfarms`,
    API_VERSION
  );
  return items
    .map((p) => ({
      name: p.name,
      tier: p.sku?.tier ?? null,
      size: p.sku?.name ?? null,
      sites: p.properties?.numberOfSites ?? null,
      status: p.properties?.status ?? null,
      location: p.location ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function collectApps(arm, { subscriptionId, resourceGroup }) {
  const items = await arm.getAll(
    `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Web/sites`,
    API_VERSION
  );
  return items
    .map((a) => ({
      name: a.name,
      state: a.properties?.state ?? null,
      plan: planName(a.properties?.serverFarmId),
      runtime: a.properties?.siteConfig?.linuxFxVersion || null,
      httpsOnly: a.properties?.httpsOnly ?? null,
      // Verified against api-version 2023-12-01: the ARM list response DOES
      // populate siteConfig, unlike `az webapp list`, which returns it empty.
      // Still optional-chained: a future version may drop it, and null must
      // read as "not reported", never as "disabled".
      alwaysOn: a.properties?.siteConfig?.alwaysOn ?? null,
      url: a.properties?.defaultHostName ? `https://${a.properties.defaultHostName}` : null,
      location: a.location ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { collectPlans, collectApps, planName, API_VERSION };
