# Recipe: Add a Cloudflare binding

(KV, R2, Durable Object, Queue, Service binding, Vectorize, AI)

## Steps

### 1. Declare in [`wrangler.jsonc`](../../wrangler.jsonc)

Example — KV namespace:

```jsonc
"kv_namespaces": [
  { "binding": "CACHE", "id": "<id-from-wrangler-kv-create>" }
]
```

Example — Queue producer:

```jsonc
"queues": {
  "producers": [{ "binding": "EMAIL_QUEUE", "queue": "email-jobs" }]
}
```

Run `wrangler kv namespace create` / `wrangler queues create` first to get the id.

### 2. Regenerate types

```bash
bun run cf-typegen
```

Verify the new binding appears in `worker-configuration.d.ts` (gitignored — generated each install).

### 3. Wrap as Effect service → `app/services/<name>.ts`

Use `Context.Tag` + `Layer.effect` (lifecycle-bearing) — same pattern as `Database`, `Bucket`, `AuthApi`. Read [`.brain/rules/services.md`](../rules/services.md).

```ts
export class Cache extends Context.Tag("app/Cache")<Cache, KVNamespace>() {}

export const CacheLive = Layer.effect(
  Cache,
  Effect.gen(function* () {
    const env = yield* CloudflareEnv;
    return env.CACHE;
  })
);
```

### 4. Add tagged errors → `app/models/errors/<name>.ts`

Follow [add-tagged-error.md](add-tagged-error.md). Map every error in `tagToTRPC`.

### 5. Provide layer → [`app/runtime.ts`](../../app/runtime.ts)

```ts
const baseLayer = Layer.mergeAll(
  DatabaseLive,
  BucketLive,
  authLayer,
  WorkflowsLive,
  CacheLive,   // ← new
);
```

Add to `AppServices` union.

### 6. (Durable Objects / Workflows only) Export class → [`workers/app.ts`](../../workers/app.ts)

```ts
export { CacheCounter } from "../app/durable-objects/cache-counter";
```

### 7. Repository (if you'll have multiple call sites) → `app/repositories/<name>.ts`

Wrap raw client in domain methods (e.g. `getUser`, `setUser`). One repository per binding usage pattern. Test with stub layer.

### 8. Update brain

- [`.brain/rules/cloudflare.md`](../rules/cloudflare.md) — bindings table
- [`.brain/high-level-architecture/architecture.md`](../high-level-architecture/architecture.md) — diagram + responsibilities
- [`.brain/high-level-architecture/integrations.md`](../high-level-architecture/integrations.md) — purpose, scope, gotchas
- [`.brain/CHANGELOG.md`](../CHANGELOG.md) — entry

## Definition of done

- [ ] Binding in `wrangler.jsonc`
- [ ] Types regenerated (`cf-typegen`)
- [ ] Service Tag + Layer in `app/services/`
- [ ] Errors tagged + mapped in `tagToTRPC`
- [ ] Service merged in `runtime.ts`
- [ ] DO/Workflow class exported (if applicable)
- [ ] Repository (if applicable) + tests
- [ ] Brain docs updated

## Anti-patterns

- ❌ Reading `env.CACHE` directly inside a route — go through the Tag
- ❌ `Effect.promise(() => env.CACHE.put(...))` — use `Effect.tryPromise` with tagged error
- ❌ Skipping `cf-typegen` — TypeScript won't know about the binding
- ❌ Forgetting to provide the new layer in `runtime.ts` — runtime crash with "Service not found"
