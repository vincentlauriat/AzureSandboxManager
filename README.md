# Azure Sandbox Manager

A small, self-hosted dashboard and JSON API that report the full state of an Azure resource group —
and, above all, **tell you when something changed without anyone telling you**.

It runs as an Azure App Service web app inside the very resource group it watches, authenticates with
a managed identity, and holds no secrets of its own beyond one shared access token.

```
┌────────────┐  managed identity   ┌─────────────┐
│ collector  │ ──────────────────► │ Azure ARM   │
│ every 10 m │                     └─────────────┘
│            │  HTTP probes ─────► web apps in the group
└─────┬──────┘
      │ snapshot + change log to /home (persistent)
      ▼
┌────────────────────────────┐
│ web page  │  /api/v1/...   │ ◄── X-Sandbox-Token
└────────────────────────────┘
```

## Why it exists

The tool was written after a real incident. The Contributor role on a sandbox resource group was moved
from one account to another over a weekend, with no notification. The symptom — every `az` command
failing at once — took half an hour to trace back to its cause, and the obvious readings (*the
subscription was deleted*, *the tenant moved*) were all wrong.

A dashboard that merely shows current state would not have helped. What was missing was the
**difference** between yesterday and today. That is the feature this project is built around; the
inventory is the easy part.

## What it reports

| Section | Contents |
|---|---|
| Applications | State, plan, runtime, `httpsOnly`, URL |
| HTTP probes | Live status code and latency for each app |
| Plans | Tier, size, number of apps, status |
| Resources | Name, type, location |
| Budget | Amount, spend, percentage, alert thresholds |
| Access | Role assignments, locks, deny assignments, the identity's own effective permissions |
| **Changes** | Everything above, diffed against the previous snapshot |

Change types: `resource_added`, `resource_removed`, `app_state_changed`, `plan_tier_changed`,
`role_added`, `role_removed`, `lock_added`, `lock_removed`, `budget_threshold_crossed`,
`probe_status_changed`, `collector_access_lost`, `collector_access_restored`.

## The rule that makes change detection trustworthy

Data is compared **only when both snapshots successfully collected that section**. A change of
collection status is its own event, never a data change.

This is not a detail. If the identity loses its Reader role, the governance section returns empty. A
naive diff would announce that every role assignment vanished at once — a false alarm at the worst
possible moment. Guarding by simply skipping failed sections produces the opposite bug: the
revocation becomes invisible. Both defeat the point of the tool, so there is a test that fails if the
rule is removed.

## Requirements

- Node.js 20 or later. **No dependencies** — nothing to install, no build step, no lockfile to audit.
- An Azure App Service web app (Linux) with a system-assigned managed identity.
- The **Reader** role granted to that identity on the resource group you want to watch.

## Configuration

All configuration comes from the environment. Copy `.env.example` to `.env` for local runs; on Azure
these are App Settings.

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `SANDBOX_TOKEN` | yes | — | Shared secret required in the `X-Sandbox-Token` header |
| `AZURE_SUBSCRIPTION_ID` | yes | — | Subscription containing the resource group |
| `AZURE_RESOURCE_GROUP` | yes | — | The resource group to report on |
| `COLLECT_INTERVAL_MINUTES` | no | `10` | How often to collect |
| `SNAPSHOT_DIR` | no | `/home/azure-sandbox-manager` | Where snapshots and the change log live |
| `PORT` | no | `8080` | Listen port |

Generate a token with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Running locally

```bash
cp .env.example .env    # then edit it
node --env-file=.env server.js
```

Without a managed identity, every Azure collector reports `denied` and the page explains what is
missing. That is the intended behaviour, not a failure — see below.

## Deploying

See [`docs/deployment.md`](docs/deployment.md) for the full sequence. The short version:

```bash
az webapp create -g <rg> -p <plan> -n <app> --runtime "NODE:24-lts"
az webapp identity assign -g <rg> -n <app>          # prints the principalId
az webapp config appsettings set -g <rg> -n <app> --settings \
    SANDBOX_TOKEN=<token> AZURE_SUBSCRIPTION_ID=<sub> AZURE_RESOURCE_GROUP=<rg>
az webapp update -g <rg> -n <app> --https-only true
./scripts/deploy.sh <rg> <app>
```

Then grant the role — this is the one step that needs a permission `Contributor` does not have:

```bash
az role assignment create \
  --assignee-object-id <principalId from above> \
  --assignee-principal-type ServicePrincipal \
  --role Reader \
  --scope /subscriptions/<sub>/resourceGroups/<rg>
```

> **Allow up to 24 hours after granting the role.** The managed identity token service caches role
> membership per resource URI, and Microsoft documents that the change is not immediate. If the
> dashboard still shows `denied` right after the assignment, that is expected — do not assume the
> assignment failed.

The app degrades gracefully in the meantime: HTTP probes and diagnostics work, the Azure sections
explain what is missing, and **no redeployment is needed** once the role lands. The next collection
fills itself in.

## API

Every route except `/healthz` requires the `X-Sandbox-Token` header.

| Route | Method | Returns |
|---|---|---|
| `/api/v1/snapshot` | GET | The full snapshot |
| `/api/v1/apps` | GET | Applications and probe results only |
| `/api/v1/changes` | GET | Recent change events; `?limit=` (1–500, default 50) |
| `/api/v1/refresh` | POST | Forces a collection (rate-limited to once per 30 s) |
| `/healthz` | GET | Liveness, no token required |

Every response carries `collectedAt` and `ageSeconds`, so a client always knows how old the data it is
showing really is. See [`docs/api.md`](docs/api.md) for payload shapes and a Swift example.

```bash
curl -H "X-Sandbox-Token: $SANDBOX_TOKEN" https://<app>.azurewebsites.net/api/v1/snapshot
```

## Security model

The shared token is deliberately simple, and its risk is bounded by the Reader role: someone holding
the token can **read an inventory, and change nothing**. That trade is what makes a single header
acceptable here.

It is not enterprise authentication. It does not distinguish callers, and it travels in clear to
anyone you hand it to. If that stops being good enough, App Service Easy Auth can be put in front
without touching the collectors — only `src/api.js` changes.

Deploy with `--https-only true`. The dashboard exposes infrastructure details; it should not be
reachable over plain HTTP.

## Tests

```bash
npm test
```

47 tests, no dependencies, no network. The suite covers the diff engine (including every
collector-status transition), token comparison, ARM error classification, the `expires_on`
string-parsing trap, probe timeouts and self-exclusion, independent settling of the governance
sub-reads, and configuration validation.

## Limitations

- **One resource group per instance.** Run several instances for several groups.
- **Regional quotas are not reported.** They are read at subscription scope, out of reach of a Reader
  role on a resource group.
- **Read-only by design.** No start, stop or restart. Adding them would mean asking for Contributor,
  which would turn an internet-facing page into something that can break things.
- **Budget figures lag.** Billing data is not real time, and on reduced-rate subscriptions small spend
  can read as zero for a long while. Do not read `0` as proof of no cost.
- **No notifications.** Changes are visible, not pushed. The append-only change log is the right base
  to build alerting on.

## Licence

MIT — see [LICENSE](LICENSE).
