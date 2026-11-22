# Add a Cloudflare Workflow

The starter ships no Workflow. Add one when a job needs steps that retry, sleep or outlive a request. For a quick fire-and-forget job, use `ctx.waitUntil` instead.

The steps below add a `DigestWorkflow`, bound as `DIGEST_WORKFLOW`, that an admin starts through tRPC.

## 1. The input

`app/lib/schemas/digest.ts`. Effect Schema, not Zod. Cap every string with `maxLength` and every array with `maxItems`: [`input-bounds.test.ts`](../app/trpc/__tests__/input-bounds.test.ts) walks every procedure input and fails on one with no cap.

```ts
export const DigestInput = Schema.Struct({
  topic: Schema.String.pipe(Schema.maxLength(100)),
});
export type DigestInput = typeof DigestInput.Type;
```

Cloudflare stores the params of every run: keep them small, and put no secret or personal data in them. Pass an id and read the rest inside a step.

## 2. The class

`workers/workflows/digest.ts`. Keep it under `workers/`: `tsconfig.cloudflare.json` already includes that folder, and `tsc -b` rejects a file outside its `include` list.

```ts
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { Effect } from "effect";
import type { DigestInput } from "@/lib/schemas/digest";

export class DigestWorkflow extends WorkflowEntrypoint<Env, DigestInput> {
  async run(event: WorkflowEvent<DigestInput>, step: WorkflowStep) {
    await step.do("build digest", () => Effect.runPromise(buildDigest(event.payload)));
    await step.sleep("wait a day", "1 day");
  }
}
```

`buildDigest` stands for your own Effect. Do the work inside `step.do`. A failed Effect rejects the promise, and that is how Workflows knows to retry the step. No `throw`, no `try/catch`.

Export the class from [`workers/app.ts`](../workers/app.ts); Wrangler finds it by its export name:

```ts
export { DigestWorkflow } from "./workflows/digest";
```

## 3. The binding

Add a `workflows` entry to [`wrangler.jsonc`](../wrangler.jsonc) twice: at the top level and in `env.preview`. An env block does not inherit bindings, and the preview entry needs its own `name`.

```jsonc
"workflows": [
  { "binding": "DIGEST_WORKFLOW", "name": "<project>-digest-workflow", "class_name": "DigestWorkflow" }
]
```

Make the same two additions in [`scripts/lib/wrangler-config.ts`](../scripts/lib/wrangler-config.ts). `bun run setup` and `bun run teardown` rewrite `wrangler.jsonc` from that file, so a binding added only to `wrangler.jsonc` is lost on the next run.

Then run `bun run cf-typegen` (`bun run typecheck` runs it too). It puts `DIGEST_WORKFLOW: Workflow<DigestInput>` on `Env`.

## 4. A tagged error

`app/models/errors/workflow.ts`: a `WorkflowTriggerError` with a `name` and a `cause`, shaped like `BucketUploadError` in [`app/models/errors/bucket.ts`](../app/models/errors/bucket.ts). Export the file from `app/models/errors/index.ts` and add the class to `AppError`.

Then add the tag to `APP_ERROR_TAGS` and a `case` to the switch in [`app/lib/effect-trpc.ts`](../app/lib/effect-trpc.ts), as `BucketUploadError` has. The `non-negotiables` gate fails without the mapping. The client reads the `message`, so write a fixed one and keep the `cause` text out of it.

## 5. A service

`app/services/workflows.ts` reads the binding through the `CloudflareEnv` tag, never `process.env`.

```ts
export class Workflows extends Context.Tag("app/Workflows")<
  Workflows,
  { readonly startDigest: (params: DigestInput) => Effect.Effect<string, WorkflowTriggerError> }
>() {}

export const WorkflowsLive = Layer.effect(
  Workflows,
  Effect.gen(function* () {
    const env = yield* CloudflareEnv;
    // `Env` types the binding as always there; a deploy can still lack it.
    const binding = (env as Env & { DIGEST_WORKFLOW?: Workflow<DigestInput> }).DIGEST_WORKFLOW;
    if (!binding) {
      return yield* Effect.fail(
        new ConfigurationError({ service: "Workflows", field: "DIGEST_WORKFLOW" })
      );
    }
    return {
      startDigest: (params: DigestInput) =>
        Effect.tryPromise({
          try: () => binding.create({ params }),
          catch: (cause) => new WorkflowTriggerError({ name: "DIGEST_WORKFLOW", cause }),
        }).pipe(Effect.map((instance) => instance.id)),
    };
  })
);
```

In [`app/runtime.ts`](../app/runtime.ts), add `WorkflowsLive` to `baseLayer` in `makeAppRuntime` and `Workflows` to `AppServices`. The runtime builds every service for every request, so from here on a missing binding fails all of them, not only the call that starts a run.

## 6. A procedure

`app/trpc/routes/digest.ts`, wired into [`app/trpc/router.ts`](../app/trpc/router.ts) as `digest: digestRouter`.

```ts
export const digestRouter = createTRPCRouter({
  start: adminProcedure
    .input(Schema.standardSchemaV1(DigestInput))
    .mutation(({ ctx, input }) =>
      runProcedure(
        ctx.runtime,
        Effect.gen(function* () {
          const workflows = yield* Workflows;
          return yield* workflows.startDigest(input);
        }),
        { span: "trpc.digest.start" }
      )
    ),
});
```

Pick the auth level on purpose. Use `adminProcedure` by default. Use `protectedProcedure` only if any signed-in user may start the job. Then take who it is for from `ctx.auth.user`, never from an id or email in the input. One call starts one run and the repo ships no rate limit, so add one first: a `ratelimits` binding in `wrangler.jsonc`, keyed by user id and checked in the procedure.

## 7. Tests

- **The schema.** `app/lib/schemas/__tests__/digest.test.ts`: a value at each cap decodes, one over fails. The `non-negotiables` gate fails a schema file with no test.
- **The service.** `app/services/__tests__/workflows.test.ts`: stub the binding with `Layer.succeed(CloudflareEnv, { DIGEST_WORKFLOW: stub } as unknown as Env)`. Cover a started run, a rejected `create` and a missing binding.
- **The router.** Add `"digest.start": "admin"` to `LEVELS` in [`router.test.ts`](../app/trpc/__tests__/router.test.ts), and a row to `OWNERSHIP` if the procedure is `protected`.
- **The real-D1 harness.** Add `DIGEST_WORKFLOW: { create: async () => ({ id: "wf-test" }) }` to `env` in [`real-d1.ts`](../app/trpc/__tests__/real-d1.ts). The platform proxy has no Workflow binding, and without the stub every real-D1 test fails.

Then run `./scripts/verify.sh`.

## Remove one

Delete the class, its export, the binding (in both files), the service, the error and the procedure, then deploy. A deploy does not delete a Workflow that left the config: run `bunx wrangler workflows delete <name>` for each deployed name, preview included.
