'use strict';

/**
 * The event vocabulary: every type this server emits, and how serious it is.
 *
 * Severity is derived on read and NEVER written to the change log. The log is
 * append-only and still holds the trace of a role transfer noticed weeks
 * later; storing a judgment in it would freeze that judgment, so promoting a
 * type later would leave history classified under the old rule and
 * inconsistent with the present. Deriving it reclassifies the whole history
 * retroactively, with no data migration.
 */

const SEVERITY = Object.freeze({
  resource_added: 'informational',
  resource_removed: 'informational',
  app_state_changed: 'informational',
  plan_tier_changed: 'informational',
  probe_status_changed: 'informational',

  role_added: 'notable',
  role_removed: 'notable',
  lock_added: 'notable',
  lock_removed: 'notable',
  budget_threshold_crossed: 'notable',

  // The incident this project was written after: a role moved over a weekend
  // with nobody told. It gets its own level so it is never queued behind a
  // probe that flapped.
  collector_access_lost: 'critical',
  collector_access_restored: 'critical',
});

const EVENT_TYPES = Object.freeze(Object.keys(SEVERITY));

/**
 * Reading a type this table does not carry must not be quieter than reading a
 * known one — the same direction-of-error rule the clients apply. 'notable' is
 * visible without being able to raise an alarm.
 */
function severityOf(type) {
  return SEVERITY[type] ?? 'notable';
}

/** Emission-time guard: a new type cannot reach the log without a severity. */
function assertKnownType(type) {
  if (!Object.hasOwn(SEVERITY, type)) {
    throw new Error(`unknown event type '${type}' — add it to src/vocabulary.js with a severity`);
  }
  return type;
}

/** Decorates events on the way out. The stored line is never modified. */
function withSeverity(events) {
  return (events ?? []).map((event) => ({ ...event, severity: severityOf(event.type) }));
}

module.exports = { SEVERITY, EVENT_TYPES, severityOf, assertKnownType, withSeverity };
