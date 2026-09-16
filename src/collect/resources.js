'use strict';

const API_VERSION = '2021-04-01';

async function collectResources(arm, { subscriptionId, resourceGroup }) {
  const items = await arm.getAll(
    `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/resources`,
    API_VERSION
  );
  return items
    .map((r) => ({ name: r.name, type: r.type, location: r.location, tags: r.tags ?? {} }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { collectResources, API_VERSION };
