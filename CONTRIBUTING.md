# Contributing

## Ground rules

**No dependencies.** The project runs on Node's standard library alone. That is a deliberate
constraint: no install step, no lockfile to audit, nothing that can break a deployment months later.
A pull request that adds a dependency needs to argue why the standard library is genuinely not enough.

**Tests must fail against the bug they describe.** Before submitting a test, break the code it covers
and confirm the test goes red. A test that passes either way documents nothing. The diff rule in
`src/diff.js` has exactly such a test, and it is checked this way.

**Collectors fail independently.** Any new collector returns the standard envelope
(`{ status, data, message, durationMs }`) and must never be able to take another section down with it.

## Running the suite

```bash
npm test          # node --test, no network, no Azure
node --check server.js
```

## Adding a collector

1. Write `src/collect/<name>.js` exporting a function `(arm, { subscriptionId, resourceGroup })`.
2. Register it in `src/collector.js`, wrapped in `runCollector`.
3. Add it to `COLLECTORS` in `src/diff.js` with a data-diff function.
4. Add a section in `src/html.js`.
5. Test the diff function, including both status transitions.

## Pinning API versions

Every ARM call pins an explicit `api-version`. When adding one, verify it against Microsoft's
documentation rather than copying a neighbouring file — versions differ per provider, and a wrong one
fails at runtime, not at review time.
