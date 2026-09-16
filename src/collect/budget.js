'use strict';

const API_VERSION = '2023-05-01';

async function collectBudget(arm, { subscriptionId, resourceGroup }) {
  const items = await arm.getAll(
    `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Consumption/budgets`,
    API_VERSION
  );

  return items.map((b) => {
    const amount = b.properties?.amount ?? null;
    const spent = b.properties?.currentSpend?.amount ?? null;
    return {
      name: b.name,
      amount,
      currency: b.properties?.currentSpend?.unit ?? null,
      spent,
      percent: amount && spent !== null ? Math.round((spent / amount) * 1000) / 10 : null,
      timeGrain: b.properties?.timeGrain ?? null,
      thresholds: Object.values(b.properties?.notifications ?? {}).map((n) => n.threshold),
    };
  });
}

module.exports = { collectBudget, API_VERSION };
