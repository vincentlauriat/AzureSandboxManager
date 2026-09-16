'use strict';

const ROLE_API_VERSION = '2022-04-01';
const LOCK_API_VERSION = '2016-09-01';

/**
 * Role assignments carry the object IDs of real people. Names are resolved
 * only if the identity has directory read access, which it normally does not;
 * the object ID alone is enough to detect that an assignment changed.
 */
async function collectGovernance(arm, { subscriptionId, resourceGroup }) {
  const scope = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}`;

  const [assignments, locks, denyAssignments, permissions] = await Promise.all([
    arm.getAll(`${scope}/providers/Microsoft.Authorization/roleAssignments`, ROLE_API_VERSION),
    arm.getAll(`${scope}/providers/Microsoft.Authorization/locks`, LOCK_API_VERSION),
    arm.getAll(`${scope}/providers/Microsoft.Authorization/denyAssignments`, ROLE_API_VERSION),
    arm.getAll(`${scope}/providers/Microsoft.Authorization/permissions`, ROLE_API_VERSION),
  ]);

  return {
    roleAssignments: assignments
      .map((a) => ({
        id: a.name,
        principalId: a.properties?.principalId ?? null,
        principalType: a.properties?.principalType ?? null,
        roleDefinitionId: a.properties?.roleDefinitionId?.split('/').pop() ?? null,
        scope: a.properties?.scope ?? null,
      }))
      .sort((a, b) => (a.id ?? '').localeCompare(b.id ?? '')),
    locks: locks.map((l) => ({ name: l.name, level: l.properties?.level ?? null })),
    denyAssignments: denyAssignments.map((d) => ({ id: d.name, description: d.properties?.description ?? null })),
    effectivePermissions: permissions.map((p) => ({
      actions: p.actions ?? [],
      notActions: p.notActions ?? [],
      dataActions: p.dataActions ?? [],
    })),
  };
}

module.exports = { collectGovernance, ROLE_API_VERSION, LOCK_API_VERSION };
