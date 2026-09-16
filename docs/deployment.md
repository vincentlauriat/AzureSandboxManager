# Deployment

Target: Azure App Service on Linux. The app has no dependencies and no build step, so deployment is a
zip upload — nothing is compiled on the server.

Placeholders below: `<rg>` resource group, `<plan>` App Service plan, `<app>` globally unique app name,
`<sub>` subscription id.

## 1. Choose a plan

An existing plan can host several apps at no extra cost. Check what you already have:

```bash
az appservice plan list -g <rg> -o table
```

The app is light: it wakes every ten minutes, makes a handful of ARM calls and a few HTTP probes. It
does not need a plan of its own.

## 2. Pick a runtime that still exists

Runtime names are retired over time — do not copy one from an old script.

```bash
az webapp list-runtimes --os-type linux | grep NODE
```

## 3. Create the app

```bash
az webapp create -g <rg> -p <plan> -n <app> --runtime "NODE:24-lts"
az webapp update -g <rg> -n <app> --https-only true
```

`--https-only` is not optional here: the dashboard exposes infrastructure details.

## 4. Enable the managed identity

```bash
az webapp identity assign -g <rg> -n <app>
```

Note the `principalId` it prints — that is the identity you grant the role to.

## 5. Configure

```bash
TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
az webapp config appsettings set -g <rg> -n <app> --settings \
  SANDBOX_TOKEN="$TOKEN" \
  AZURE_SUBSCRIPTION_ID="<sub>" \
  AZURE_RESOURCE_GROUP="<rg>" \
  SCM_DO_BUILD_DURING_DEPLOYMENT=false
```

`SCM_DO_BUILD_DURING_DEPLOYMENT=false` skips the remote build. There is nothing to build, and remote
builds time out on small plans.

## 6. Deploy

```bash
./scripts/deploy.sh <rg> <app>
```

`az webapp deploy` sometimes hangs after a deployment that actually succeeded. If it does, check the
real outcome instead of retrying:

```bash
az webapp log deployment list -g <rg> -n <app> --query "[0].{status:status,message:message}"
```

## 7. Grant the Reader role

This is the only step that may be outside your own permissions:
`Microsoft.Authorization/roleAssignments/write` is **excluded from the built-in Contributor role**. If
you are Contributor on the group, you cannot grant this yourself — you need an Owner, a User Access
Administrator, or an RBAC Administrator.

```bash
az role assignment create \
  --assignee-object-id <principalId> \
  --assignee-principal-type ServicePrincipal \
  --role Reader \
  --scope /subscriptions/<sub>/resourceGroups/<rg>
```

**Then wait.** Microsoft documents that the managed identity token service caches role membership per
resource URI for up to about 24 hours. A dashboard still showing `denied` minutes after the
assignment is normal and is not evidence that the assignment failed. Verify the assignment itself
rather than re-issuing it:

```bash
az role assignment list --assignee <principalId> --all -o table
```

## 8. Verify

Check the values, not just the status codes. A correct HTTP 200 proves the process is running, not
that it is reporting the truth.

```bash
curl -s https://<app>.azurewebsites.net/healthz

curl -s -H "X-Sandbox-Token: $TOKEN" \
  https://<app>.azurewebsites.net/api/v1/snapshot | python3 -m json.tool | head -40

# Compare against the real thing
az resource list -g <rg> -o table
```

The dashboard's resource list and `az resource list` must agree. If they do not, the app is wrong —
investigate before trusting anything else it says.

## Removing it

```bash
az webapp delete -g <rg> -n <app>
```

The system-assigned identity is deleted with the app. The role assignment is not: remove it
separately with `az role assignment delete`, or it lingers as an orphan pointing at a principal that
no longer exists.
