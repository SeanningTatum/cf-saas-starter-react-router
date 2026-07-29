# Third-Party Integrations

The integrations actually wired into this repo. **Stripe / PostHog / Resend / external AI SDKs are not present** — if a feature needs one, add it explicitly (binding + service Tag + secret) and update this file.

## Cloudflare Services

Bindings declared in [`wrangler.jsonc`](../../wrangler.jsonc) and typed in `worker-configuration.d.ts`. The config is committed with dummy IDs (so `cf-typegen`/CI work on fresh clones); `bun run setup` fills real IDs and provisions both production resources and the `env.preview` environment (`<name>-preview` worker + `-preview` D1/R2 for per-PR preview deployments — see [`../rules/cloudflare.md`](../rules/cloudflare.md) "Environments & preview deployments"):

| Binding | Type | Purpose |
|---------|------|---------|
| `DATABASE` | D1 | SQLite DB via Drizzle |
| `BUCKET` | R2 | Object storage |
| `AI` | Workers AI | Native model inference — `WorkersAi` service + admin-insights prompt module (`@cf/moonshotai/kimi-k2.5`, JSON Mode structured output) |
| `EXAMPLE_WORKFLOW` | Workflow | Sample CF Workflow class `ExampleWorkflow` |
| `ASSETS` | Assets | Static assets directory |

Compatibility flags: `nodejs_compat`. Placement: smart.

### D1 (`DATABASE`)

```typescript
// app/services/database.ts
export const DatabaseLive = Layer.effect(
  Database,
  Effect.gen(function* () {
    const env = yield* CloudflareEnv;
    if (!env.DATABASE) return yield* Effect.fail(new ConfigurationError({ service: "Database", field: "DATABASE" }));
    return { db: drizzleD1(env.DATABASE, { schema, logger: false }) };
  })
);
```

Repos consume via `const { db } = yield* Database;`. Never instantiate `drizzle()` inside a repo.

### R2 (`BUCKET`)

The `Bucket` Tag exposes the raw `R2Bucket` binding. `BucketRepository` wraps R2 calls in `Effect.tryPromise`:

```typescript
const repo = yield* BucketRepository;
const key = yield* repo.upload(file);    // Effect<string, BucketUploadError>
const obj = yield* repo.get(key);        // Effect<R2ObjectBody | null, BucketGetError>
yield* repo.remove(key);                 // Effect<void, BucketDeleteError>
const list = yield* repo.list({ prefix: "uploads/", limit: 100 }); // Effect<R2Objects, BucketListError>
```

Default key generator: `uploads/<timestamp>-<uuid>`. Tagged errors: `BucketBindingError`, `BucketUploadError`, `BucketGetError`, `BucketNotFoundError`, `BucketDeleteError`, `BucketListError`, `BucketValidationError`. `BucketNotFoundError` is wired in `tagToTRPC` but not raised by any built-in repo method — wrap `get` with `requireFound` to use it. See [`../rules/errors.md`](../rules/errors.md) and [`../rules/services.md`](../rules/services.md).

### Workers AI (`AI`)

Consumed by the `WorkersAi` service (`app/services/ai.ts`) — never call `env.AI.run` directly. First user: admin AI insights (see [`../features/ai-admin-insights/ai-admin-insights.md`](../features/ai-admin-insights/ai-admin-insights.md)) on pinned `@cf/moonshotai/kimi-k2.5` with JSON Mode (`response_format: json_schema`). Gotchas (verified live 2026-07-29): the binding's return shape is **model-dependent** — kimi returns an OpenAI `chat.completion` object (`choices[0].message.content`), not `{ response }`; `WorkersAi.runJson` normalizes both. kimi-k2.5 is a reasoning model and **reasoning is unbounded by default** with `reasoning_content` counting against `max_tokens` — it can burn the entire budget and return EMPTY content (`finish_reason: "length"`), or hit Cloudflare's upstream ~60s timeout (`InferenceUpstreamError`, an HTML 500 from the binding). Always set `reasoning_effort` (the prompt module carries `effort: "low"`) and budget `max_tokens` generously (4000). For evals, `scripts/ai-eval-proxy/` exposes the binding as an OpenAI-compatible endpoint and normalizes promptfoo's injected defaults (`max_tokens: 1024`, `temperature: 0`). JSON Mode does not support streaming; an unsatisfiable schema fails the request with "JSON Mode couldn't be met" (surfaces as `ExternalServiceError`). Prompt modules live under `app/lib/ai/prompts/<name>/` (see the `prompt-scaffold` skill).

### Workflows (`EXAMPLE_WORKFLOW`)

Class exported from [`workflows/example.ts`](../../workflows/example.ts) and re-exported from [`workers/app.ts`](../../workers/app.ts). The `Workflows` service Tag exposes a typed `triggerExample(params)` that returns `Effect<WorkflowInstance, WorkflowTriggerError>`. See [`../rules/cloudflare.md`](../rules/cloudflare.md) and [`../rules/services.md`](../rules/services.md).

---

## Better Auth

Email/password authentication with the `admin` plugin. Constructed per request through the Effect runtime in `workers/app.ts` — the raw `createAuth(...)` call was replaced by reading the `AuthApi` tag off the runtime (built by `AuthApiLive(baseURL)`, which wraps construction in `Effect.try` → `ExternalServiceError`):

```typescript
const runtime = makeAppRuntime(env, new URL(request.url).origin);
const authExit = await runtime.runPromiseExit(AuthApi);
// Exit.match → controlled 500 on failure; auth reused as context.auth
```

Underneath, `createAuth` (`app/auth/server.ts`) wires the drizzle adapter against D1:

```typescript
betterAuth({
  database: drizzleAdapter(getDb(database), { provider: "sqlite", schema }),
  secret,
  baseURL,
  emailAndPassword: { enabled: true },
  plugins: [admin()],
});
```

Inside Effect, the `AuthApi` Tag exposes the running instance:

```typescript
const { api } = yield* AuthApi;
const session = yield* Effect.promise(() => api.getSession({ headers }));
```

Client SDK:

```typescript
// app/auth/client.ts
import { createAuthClient } from "better-auth/react";
export const authClient = createAuthClient();

await authClient.signUp.email({ email, password, name });
await authClient.signIn.email({ email, password });
await authClient.signOut();
const { data: session } = authClient.useSession();
```

Required secret: `BETTER_AUTH_SECRET` (set via `bunx wrangler secret put BETTER_AUTH_SECRET`).

---

## i18n stack

remix-i18next + i18next + react-i18next with `/:lng/` URL prefix. Locales live in `app/locales/{lng}/*.json`. See [`../codebase/i18n.md`](../codebase/i18n.md).

---

## Integration checklist

When adding a new integration:

1. Declare any CF binding in `wrangler.jsonc`, run `bun run typecheck` to regen `worker-configuration.d.ts`
2. Add secrets via `bunx wrangler secret put VAR_NAME` (production) and `.dev.vars` (local)
3. Create an `Effect.Service` Tag + `Layer` in `app/services/{name}.ts`. Yield `CloudflareEnv` and construct the client.
4. Add the service to `AppServices` union and the layer composition in `app/runtime.ts`
5. Add a test layer in `app/services/{name}.test-layer.ts` for repository unit tests
6. Repos consume via `yield* MyService` — never instantiate the client inside a repo
7. Add tagged errors in `app/models/errors/{domain}.ts` and a `case` in `tagToTRPC` (`app/lib/effect-trpc.ts`)
8. Document the integration in this file and update [`architecture.md`](architecture.md) bindings table
