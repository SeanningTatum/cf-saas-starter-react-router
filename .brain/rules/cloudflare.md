# Cloudflare Layer

Cloudflare Workers runtime, bindings, environment variables. **Source-of-truth files**: `wrangler.jsonc`, `worker-configuration.d.ts`, `workers/app.ts`, `app/services/cloudflare.ts`.

> Programming model basics: see [`../codebase/effect-ts.md`](../codebase/effect-ts.md).

> Cloudflare API reference (Workers runtime, bindings, Wrangler, D1, R2, Workflows, Workers AI, KV, DO): https://developers.cloudflare.com/llms.txt. Prefer `context7` MCP. Catalog + fetch guidance: [`../codebase/llms-txt.md`](../codebase/llms-txt.md).

## Runtime

This project runs on **Cloudflare Workers, not Node.js**. No `process`, no `fs`, no native modules. Edge runtime only.

## Bindings

Available bindings (declared in `wrangler.jsonc`, typed in `worker-configuration.d.ts`):

| Binding | Type | Purpose |
|---------|------|---------|
| `DATABASE` | D1 | SQLite via Drizzle |
| `BUCKET` | R2 | Object storage |
| `AI` | Workers AI | Native model inference (binding present, no consumers yet) |
| `EXAMPLE_WORKFLOW` | Workflow | Sample workflow class `ExampleWorkflow` |
| `ASSETS` | Assets | Static assets directory (`build/client`) |
| `BETTER_AUTH_SECRET` | secret | Auth signing (set via `wrangler secret put`) |

Add a binding:
1. Edit `wrangler.jsonc`
2. Run `bun run typecheck` (auto-runs `cf-typegen`) to regenerate `worker-configuration.d.ts`
3. For secrets: `bunx wrangler secret put VAR_NAME`
4. Local secrets: `.dev.vars`

## Accessing env

**Never `process.env`.** Three valid paths:

### A. `Env` type (auto-generated)

```typescript
import type { Env } from "../worker-configuration";
// Env has every binding typed
```

### B. `CloudflareEnv` Effect Tag (inside Effect)

```typescript
import { Effect } from "effect";
import { CloudflareEnv } from "@/services/cloudflare";

const program = Effect.gen(function* () {
  const env = yield* CloudflareEnv;
  // env.DATABASE, env.BUCKET, ...
});
```

### C. `context.cloudflare.env` (loaders/actions)

```typescript
export async function loader({ request, context }: Route.LoaderArgs) {
  const db = context.cloudflare.env.DATABASE;
  // ...
}
```

## Workflows (binding side)

Cloudflare Workflows for background / long-running tasks (AI calls, > 1-2s ops, retry-required work). User request returns immediately; workflow runs async.

### Define

Reference: real example in [`workflows/example.ts`](../../workflows/example.ts):

```typescript
// workflows/example.ts (real shape)
import { WorkflowEntrypoint, WorkflowStep, type WorkflowEvent } from "cloudflare:workers";

export interface ExampleWorkflowRequestPayload {
  email: string;
  metadata: Record<string, string>;
}

export class ExampleWorkflow extends WorkflowEntrypoint<Env, ExampleWorkflowRequestPayload> {
  async run(event: WorkflowEvent<ExampleWorkflowRequestPayload>, step: WorkflowStep) {
    await step.sleep("sleep for a bit", "1 minute");
    // ⚠ source bug: missing `await` and ignored result — fire-and-forget. New code should `await` and wrap in `step.do(...)` for retry safety.
    this.env.AI.run("@cf/meta/llama-4-scout-17b-16e-instruct", {
      prompt: "What is the meaning of life?",
    });
    return { success: true, email: event.payload.email };
  }
}
```

`this.env` exposes every CF binding (`DATABASE`, `BUCKET`, `AI`, `EXAMPLE_WORKFLOW`).

> Workflows only execute under real wrangler — `bun run dev` does not. Use `bun run preview` to actually invoke a workflow locally.

### Register

1. `wrangler.jsonc`:
```jsonc
"workflows": [
  {
    "binding": "EXAMPLE_WORKFLOW",
    "name": "testing-example-workflow",
    "class_name": "ExampleWorkflow"
  }
]
```
2. `workers/app.ts`:
```typescript
export { ExampleWorkflow } from "../workflows/example";
```
3. `bun run typecheck` to regen `worker-configuration.d.ts`
4. Wire into the `Workflows` Effect service — see [`services.md`](services.md).

### Trigger semantics

- Each `step.do(...)` may retry on failure → **must be idempotent**
- Workflow `create()` itself can fail. The `Workflows` service wraps it as `WorkflowTriggerError` (mapped to `INTERNAL_SERVER_ERROR` by `tagToTRPC`):

```typescript
// inside an Effect program
const wf = yield* Workflows;
return yield* wf.triggerExample(input);   // Effect<WorkflowInstance, WorkflowTriggerError>
```

If you want the user request to succeed even when the workflow trigger fails, swallow the error after logging:

```typescript
yield* wf.triggerExample(input).pipe(
  Effect.catchTag("WorkflowTriggerError", (e) => Effect.logError("triggerExample failed", e))
);
```

## Wrangler commands

```bash
bun run db:migrate:local       # Apply migrations to local D1
bun run db:migrate:remote      # Apply migrations to remote D1
bun run db:studio              # Drizzle Studio
bunx wrangler secret put VAR   # Set production secret
bunx wrangler types            # Regen worker-configuration.d.ts (also via bun run typecheck)
bun run deploy                 # Build + push to CF
```

## Anti-patterns

- `process.env.ANYTHING` — use bindings
- Importing `node:fs`, `node:path`, etc. — Workers has no Node std lib
- Caching auth/DB clients globally across requests — must be per-request (each invocation gets a fresh isolate or pooled isolate; bindings only valid for the request)
- Long sync work in request handler — push to a Workflow
- `step.do()` body that mutates external state without idempotency — retries WILL run it twice
