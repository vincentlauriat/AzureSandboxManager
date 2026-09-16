'use strict';

const escape = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const EVENT_LABELS = {
  resource_added: 'Resource added',
  resource_removed: 'Resource removed',
  app_state_changed: 'App state changed',
  plan_tier_changed: 'Plan tier changed',
  role_added: 'Role assigned',
  role_removed: 'Role removed',
  lock_added: 'Lock added',
  lock_removed: 'Lock removed',
  budget_threshold_crossed: 'Budget threshold crossed',
  probe_status_changed: 'HTTP status changed',
  collector_access_lost: 'Access lost',
  collector_access_restored: 'Access restored',
};

function section(collector, title, renderOk) {
  if (!collector) return '';
  if (collector.status !== 'ok') {
    return `<section><h2>${escape(title)}</h2>
      <div class="denied"><strong>${collector.status === 'denied' ? 'Access denied' : 'Collection failed'}</strong>
      <p>${escape(collector.message ?? 'No detail')}</p></div></section>`;
  }
  return `<section><h2>${escape(title)}</h2>${renderOk(collector.data)}</section>`;
}

function table(headers, rows) {
  if (!rows.length) return '<p class="empty">Nothing to show.</p>';
  return `<div class="scroll"><table>
    <thead><tr>${headers.map((h) => `<th>${escape(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

function renderPage({ snapshot, events, ageSeconds, roleHint }) {
  const banner = snapshot
    ? `Collected ${escape(snapshot.collectedAt)} — ${Math.round(ageSeconds)} s ago`
    : 'No snapshot collected yet.';

  const eventRows = (events ?? []).map((e) => [
    escape(e.at),
    escape(EVENT_LABELS[e.type] ?? e.type),
    escape(e.subject),
    escape(JSON.stringify(e.detail)),
  ]);

  const body = snapshot
    ? [
        eventRows.length
          ? `<section class="changes"><h2>Recent changes</h2>${table(['When', 'What', 'Subject', 'Detail'], eventRows)}</section>`
          : '',
        section(snapshot.apps, 'Applications', (apps) =>
          table(
            ['Name', 'State', 'Plan', 'Runtime', 'HTTPS only', 'URL'],
            apps.map((a) => [
              escape(a.name),
              escape(a.state),
              escape(a.plan),
              escape(a.runtime ?? '—'),
              a.httpsOnly ? 'yes' : '<span class="warn">no</span>',
              a.url ? `<a href="${escape(a.url)}" rel="noreferrer noopener">open</a>` : '—',
            ])
          )
        ),
        section(snapshot.probes, 'HTTP probes', (probes) =>
          table(
            ['App', 'Status', 'Latency', 'Error'],
            probes.map((p) => [
              escape(p.app),
              p.httpStatus ? escape(p.httpStatus) : '—',
              `${escape(p.latencyMs)} ms`,
              escape(p.error ?? '—'),
            ])
          )
        ),
        section(snapshot.plans, 'App Service plans', (plans) =>
          table(
            ['Name', 'Tier', 'Size', 'Apps', 'Status', 'Location'],
            plans.map((p) => [escape(p.name), escape(p.tier), escape(p.size), escape(p.sites), escape(p.status), escape(p.location)])
          )
        ),
        section(snapshot.resources, 'Resources', (resources) =>
          table(['Name', 'Type', 'Location'], resources.map((r) => [escape(r.name), escape(r.type), escape(r.location)]))
        ),
        section(snapshot.budget, 'Budget', (budgets) =>
          table(
            ['Name', 'Amount', 'Spent', 'Percent', 'Grain'],
            budgets.map((b) => [
              escape(b.name),
              `${escape(b.amount)} ${escape(b.currency)}`,
              escape(b.spent),
              b.percent === null ? '—' : `${escape(b.percent)} %`,
              escape(b.timeGrain),
            ])
          )
        ),
        section(snapshot.governance, 'Access and governance', (g) =>
          table(
            ['Principal', 'Type', 'Role definition', 'Scope'],
            g.roleAssignments.map((a) => [escape(a.principalId), escape(a.principalType), escape(a.roleDefinitionId), escape(a.scope)])
          ) +
          `<p class="note">${g.locks.length} lock(s), ${g.denyAssignments.length} deny assignment(s).</p>`
        ),
      ].join('')
    : '<p class="empty">Waiting for the first collection.</p>';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Azure Sandbox Manager</title>
<style>
  :root { color-scheme: dark; --bg:#0f172a; --panel:#1e293b; --line:#334155; --dim:#94a3b8; --fg:#e2e8f0; --warn:#fbbf24; --bad:#f87171; }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px 16px; font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:var(--bg); color:var(--fg); }
  main { max-width:1100px; margin:0 auto; }
  h1 { font-size:22px; margin:0 0 4px; }
  .age { color:var(--dim); font-size:13px; margin-bottom:20px; }
  section { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:20px; margin-bottom:16px; }
  section.changes { border-color:var(--warn); }
  h2 { font-size:15px; margin:0 0 12px; color:var(--dim); text-transform:uppercase; letter-spacing:.05em; }
  .scroll { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  th { text-align:left; color:var(--dim); font-weight:600; padding:6px 10px 6px 0; border-bottom:1px solid var(--line); }
  td { padding:8px 10px 8px 0; border-bottom:1px solid var(--line); font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13px; }
  a { color:#7dd3fc; }
  .denied { border-left:3px solid var(--bad); padding-left:12px; }
  .denied strong { color:var(--bad); }
  .warn { color:var(--warn); }
  .empty, .note { color:var(--dim); font-size:13px; }
  pre { background:#0b1220; padding:12px; border-radius:8px; overflow-x:auto; font-size:12px; }
  button { background:var(--line); color:var(--fg); border:0; border-radius:8px; padding:8px 14px; font-size:14px; cursor:pointer; }
</style></head>
<body><main>
  <h1>Azure Sandbox Manager</h1>
  <p class="age">${banner} &nbsp; <button onclick="refresh()">Refresh now</button></p>
  ${roleHint}
  ${body}
</main>
<script>
  function token() {
    let t = null;
    try { t = localStorage.getItem('sandbox-token'); } catch (e) { /* storage may be blocked */ }
    if (!t) {
      t = prompt('Access token');
      try { if (t) localStorage.setItem('sandbox-token', t); } catch (e) { /* not fatal */ }
    }
    return t;
  }
  async function refresh() {
    const t = token();
    if (!t) return;
    await fetch('/api/v1/refresh', { method: 'POST', headers: { 'X-Sandbox-Token': t } });
    location.reload();
  }
</script>
</body></html>`;
}

function renderRoleHint(snapshot) {
  const denied = ['resources', 'plans', 'apps', 'budget', 'governance'].filter((c) => snapshot?.[c]?.status === 'denied');
  if (!denied.length) return '';
  return `<section class="changes"><h2>Setup incomplete</h2>
    <p>${denied.length} collector(s) denied: <code>${escape(denied.join(', '))}</code>.
    The managed identity needs the <strong>Reader</strong> role on the resource group:</p>
    <pre>az role assignment create \\
  --assignee-object-id &lt;managed identity principalId&gt; \\
  --assignee-principal-type ServicePrincipal \\
  --role Reader \\
  --scope /subscriptions/&lt;subscription-id&gt;/resourceGroups/&lt;resource-group&gt;</pre>
    <p class="note">After granting it, allow up to 24 hours: the managed identity token service caches
    role membership per resource URI and the change is not immediate.</p></section>`;
}

module.exports = { renderPage, renderRoleHint, escape };
