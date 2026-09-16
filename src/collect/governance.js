'use strict';

const ROLE_API_VERSION = '2022-04-01';
const LOCK_API_VERSION = '2016-09-01';

/**
 * Role assignments carry the object IDs of real people. Names are never
 * resolved — the object ID alone is enough to detect that an assignment
 * changed, and resolving it would need directory access this identity does
 * not have.
 *
 * The four reads settle INDEPENDENTLY. Coupling them would mean that a single
 * denied sub-read (locks, say) takes down role-assignment visibility — the one
 * signal this whole tool exists to provide.
 */

const PARTS = [
  { key: 'roleAssignments', path: 'roleAssignments', apiVersion: ROLE_API_VERSION, map: mapRoleAssignment },
  { key: 'locks', path: 'locks', apiVersion: LOCK_API_VERSION, map: mapLock },
  { key: 'denyAssignments', path: 'denyAssignments', apiVersion: ROLE_API_VERSION, map: mapDenyAssignment },
  { key: 'effectivePermissions', path: 'permissions', apiVersion: ROLE_API_VERSION, map: mapPermission },
];

function mapRoleAssignment(a) {
  return {
    id: a.name,
    principalId: a.properties?.principalId ?? null,
    principalType: a.properties?.principalType ?? null,
    roleDefinitionId: a.properties?.roleDefinitionId?.split('/').pop() ?? null,
    scope: a.properties?.scope ?? null,
  };
}

function mapLock(l) {
  return { name: l.name, level: l.properties?.level ?? null };
}

function mapDenyAssignment(d) {
  return { id: d.name, description: d.properties?.description ?? null };
}

function mapPermission(p) {
  return { actions: p.actions ?? [], notActions: p.notActions ?? [], dataActions: p.dataActions ?? [] };
}

async function collectGovernance(arm, { subscriptionId, resourceGroup }) {
  const scope = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}`;

  const settled = await Promise.allSettled(
    PARTS.map((part) => arm.getAll(`${scope}/providers/Microsoft.Authorization/${part.path}`, part.apiVersion))
  );

  const result = { unavailable: {} };
  let succeeded = 0;

  settled.forEach((outcome, index) => {
    const part = PARTS[index];
    if (outcome.status === 'fulfilled') {
      result[part.key] = outcome.value.map(part.map);
      if (part.key === 'roleAssignments') {
        result[part.key].sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''));
      }
      succeeded += 1;
    } else {
      // An empty list would be indistinguishable from "nothing there", so the
      // failure is recorded explicitly instead.
      result[part.key] = [];
      result.unavailable[part.key] = outcome.reason?.message ?? 'unknown error';
    }
  });

  // Only a total failure makes the collector itself denied; a partial one is
  // still worth reporting.
  if (succeeded === 0) throw settled[0].reason;

  return result;
}

module.exports = { collectGovernance, ROLE_API_VERSION, LOCK_API_VERSION, PARTS };
