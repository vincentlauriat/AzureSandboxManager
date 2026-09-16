'use strict';

/**
 * Compares two snapshots and emits typed change events.
 *
 * THE RULE THAT MATTERS: a collector's data is compared only when BOTH
 * snapshots carry status 'ok' for it. A status transition is an event in its
 * own right, never a data change.
 *
 * Without this, losing the Reader role would make every role assignment appear
 * to vanish at once — a massive false alarm. Guarding by simply skipping
 * non-ok collectors would make the revocation invisible instead. Both betray
 * the reason this tool exists.
 */

const COLLECTORS = ['resources', 'plans', 'apps', 'budget', 'governance', 'probes'];

function statusOf(snapshot, collector) {
  return snapshot?.[collector]?.status ?? 'error';
}

function dataOf(snapshot, collector) {
  return snapshot?.[collector]?.data ?? null;
}

function byName(list) {
  return new Map((list ?? []).map((item) => [item.name, item]));
}

function event(type, subject, detail) {
  return { type, subject, detail };
}

function diffResources(before, after) {
  const events = [];
  const previous = byName(before);
  const current = byName(after);
  for (const [name, resource] of current) {
    if (!previous.has(name)) events.push(event('resource_added', name, { type: resource.type }));
  }
  for (const [name, resource] of previous) {
    if (!current.has(name)) events.push(event('resource_removed', name, { type: resource.type }));
  }
  return events;
}

function diffPlans(before, after) {
  const events = [];
  const previous = byName(before);
  for (const [name, plan] of byName(after)) {
    const was = previous.get(name);
    if (was && (was.tier !== plan.tier || was.size !== plan.size)) {
      events.push(event('plan_tier_changed', name, { from: `${was.tier}/${was.size}`, to: `${plan.tier}/${plan.size}` }));
    }
  }
  return events;
}

function diffApps(before, after) {
  const events = [];
  const previous = byName(before);
  for (const [name, app] of byName(after)) {
    const was = previous.get(name);
    if (was && was.state !== app.state) {
      events.push(event('app_state_changed', name, { from: was.state, to: app.state }));
    }
  }
  return events;
}

function diffProbes(before, after) {
  const events = [];
  const previous = new Map((before ?? []).map((p) => [p.app, p]));
  for (const probe of after ?? []) {
    const was = previous.get(probe.app);
    if (was && was.httpStatus !== probe.httpStatus) {
      events.push(event('probe_status_changed', probe.app, { from: was.httpStatus, to: probe.httpStatus }));
    }
  }
  return events;
}

function diffGovernance(before, after) {
  const events = [];
  const previous = new Map((before?.roleAssignments ?? []).map((a) => [a.id, a]));
  const current = new Map((after?.roleAssignments ?? []).map((a) => [a.id, a]));

  for (const [id, assignment] of current) {
    if (!previous.has(id)) {
      events.push(event('role_added', assignment.principalId, { role: assignment.roleDefinitionId, scope: assignment.scope }));
    }
  }
  for (const [id, assignment] of previous) {
    if (!current.has(id)) {
      events.push(event('role_removed', assignment.principalId, { role: assignment.roleDefinitionId, scope: assignment.scope }));
    }
  }

  const previousLocks = new Map((before?.locks ?? []).map((l) => [l.name, l]));
  const currentLocks = new Map((after?.locks ?? []).map((l) => [l.name, l]));
  for (const [name, lock] of currentLocks) {
    if (!previousLocks.has(name)) events.push(event('lock_added', name, { level: lock.level }));
  }
  for (const [name, lock] of previousLocks) {
    if (!currentLocks.has(name)) events.push(event('lock_removed', name, { level: lock.level }));
  }

  return events;
}

function diffBudget(before, after) {
  const events = [];
  const previous = new Map((before ?? []).map((b) => [b.name, b]));
  for (const budget of after ?? []) {
    const was = previous.get(budget.name);
    if (!was || was.percent === null || budget.percent === null) continue;
    for (const threshold of budget.thresholds ?? []) {
      if (was.percent < threshold && budget.percent >= threshold) {
        events.push(event('budget_threshold_crossed', budget.name, { threshold, percent: budget.percent }));
      }
    }
  }
  return events;
}

const DATA_DIFFERS = {
  resources: diffResources,
  plans: diffPlans,
  apps: diffApps,
  probes: diffProbes,
  governance: diffGovernance,
  budget: diffBudget,
};

/**
 * @returns {Array<{type: string, subject: string|null, detail: object, collector: string}>}
 */
function diffSnapshots(before, after) {
  if (!before || !after) return [];
  const events = [];

  for (const collector of COLLECTORS) {
    const was = statusOf(before, collector);
    const is = statusOf(after, collector);
    const wasOk = was === 'ok';
    const isOk = is === 'ok';

    if (wasOk && isOk) {
      const differ = DATA_DIFFERS[collector];
      for (const e of differ(dataOf(before, collector), dataOf(after, collector))) {
        events.push({ ...e, collector });
      }
      continue;
    }

    if (wasOk && !isOk) {
      events.push({
        type: 'collector_access_lost',
        subject: collector,
        detail: { status: is, message: after?.[collector]?.message ?? null },
        collector,
      });
      continue;
    }

    if (!wasOk && isOk) {
      // No data events: the gap against the pre-loss state is not attributable
      // to a real change.
      events.push({ type: 'collector_access_restored', subject: collector, detail: { from: was }, collector });
    }
  }

  return events;
}

module.exports = { diffSnapshots, COLLECTORS };
