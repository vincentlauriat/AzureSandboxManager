# API reference

Base path `/api/v1`. Every route except `/healthz` requires the header `X-Sandbox-Token`.

All responses are `application/json; charset=utf-8` with `Cache-Control: no-store`.

## Common envelope

Data-bearing responses carry the age of the data at the top level:

```json
{
  "collectedAt": "2026-09-16T08:00:00.000Z",
  "ageSeconds": 142.7,
  "snapshot": { }
}
```

A client should surface `ageSeconds` rather than implying the data is live.

## Collector envelope

Inside a snapshot, every section carries its own status. A section can fail while others succeed.

```json
{
  "status": "ok",
  "data": [],
  "message": null,
  "durationMs": 312
}
```

| `status` | Meaning |
|---|---|
| `ok` | Collected successfully; `data` is populated |
| `denied` | Azure refused the read (HTTP 401, 403 or 404). Usually a missing role assignment |
| `error` | Anything else: network failure, unexpected payload |

`404` counts as denied on purpose: ARM answers *not found* rather than *forbidden* when an identity
has no assignment at all on a subscription.

## Routes

### `GET /api/v1/snapshot`

The complete snapshot: `identity`, `resources`, `plans`, `apps`, `budget`, `governance`, `probes`.

- `200` — snapshot returned
- `401` — missing or invalid token
- `503` — no collection has completed yet

### `GET /api/v1/apps`

Applications and probe results only. Useful for a client that polls often and does not need the rest.

### `GET /api/v1/changes`

```json
{
  "limit": 50,
  "events": [
    {
      "at": "2026-09-16T08:00:00.000Z",
      "type": "collector_access_lost",
      "subject": "governance",
      "detail": { "status": "denied", "message": "AuthorizationFailed" },
      "collector": "governance"
    }
  ]
}
```

Newest first. `?limit=` accepts 1–500 and defaults to 50; out-of-range values are clamped, not
rejected.

### `POST /api/v1/refresh`

Forces a collection. Rate-limited to once per 30 seconds: beyond that, the current snapshot is
returned with `X-Refresh-Skipped: true` rather than an error, so an impatient client cannot trigger a
burst of ARM calls.

### `GET /healthz`

No token. Returns `{ "status": "ok", "uptimeSeconds": 1234 }`.

## Errors

```json
{ "error": "Unauthorized", "message": "Missing or invalid X-Sandbox-Token header" }
```

| Code | Status | Meaning |
|---|---|---|
| `Unauthorized` | 401 | Token missing or wrong |
| `NoSnapshot` | 503 | Nothing collected yet |
| `NotFound` | 404 | No such route |
| `InternalError` | 500 | Unhandled failure |

## Swift client sketch

```swift
struct SnapshotResponse: Decodable {
    let collectedAt: String
    let ageSeconds: Double
    let snapshot: Snapshot
}

func fetchSnapshot(host: URL, token: String) async throws -> SnapshotResponse {
    var request = URLRequest(url: host.appending(path: "api/v1/snapshot"))
    request.setValue(token, forHTTPHeaderField: "X-Sandbox-Token")

    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }

    switch http.statusCode {
    case 200: return try JSONDecoder().decode(SnapshotResponse.self, from: data)
    case 401: throw ClientError.unauthorised
    case 503: throw ClientError.notCollectedYet   // retry, do not treat as fatal
    default:  throw URLError(.badServerResponse)
    }
}
```

Store the token in the Keychain, not in `UserDefaults`.
