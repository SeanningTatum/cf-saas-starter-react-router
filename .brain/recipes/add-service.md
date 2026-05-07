# Recipe: Add an Effect service

For external clients, lifecycle-bearing utilities, or anything injectable.

## When to use this vs Effect.Service

| Pattern | Use when |
|---------|----------|
| `Context.Tag` + `Layer.effect` (this recipe) | External client wrapper (DB, R2, Auth, third-party API). Service has lifecycle / construction logic. |
| `Effect.Service` (`.Default` layer) | Repositories — domain logic that depends on a Tag-style service. See [`.brain/rules/repository.md`](../rules/repository.md). |
| Plain function in `app/lib/` | No lifecycle, no DI needs, pure helper. |

## Steps

### 1. Define the Tag → `app/services/<name>.ts`

```ts
import { Context, Effect, Layer } from "effect";
import { CloudflareEnv } from "./cloudflare";
import { ExternalServiceError } from "@/models/errors/repository";

export interface MailerShape {
  readonly send: (input: SendInput) => Effect.Effect<void, ExternalServiceError>;
}

export class Mailer extends Context.Tag("app/Mailer")<
  Mailer,
  MailerShape
>() {}

export const MailerLive = Layer.effect(
  Mailer,
  Effect.gen(function* () {
    const env = yield* CloudflareEnv;
    const apiKey = env.RESEND_API_KEY;

    return Mailer.of({
      send: (input) =>
        Effect.tryPromise({
          try: () => fetch("https://api.resend.com/emails", { ... }),
          catch: (cause) =>
            new ExternalServiceError({ service: "Resend", cause }),
        }).pipe(Effect.asVoid),
    });
  })
);
```

### 2. Provide layer → [`app/runtime.ts`](../../app/runtime.ts)

Add `MailerLive` to `Layer.mergeAll(...)` in `baseLayer`. Add `Mailer` Tag to `AppServices` union.

### 3. Add tagged errors → `app/models/errors/<name>.ts`

Reuse `ExternalServiceError` if generic; otherwise create domain-specific error. Map every domain-specific error in `tagToTRPC` (see [add-tagged-error.md](add-tagged-error.md)).

### 4. Unit test → `app/services/__tests__/<name>.test.ts`

Stub the underlying client. Test happy path + each failure path. Pattern from [`.brain/rules/library.md`](../rules/library.md).

### 5. Update brain

- [`.brain/rules/services.md`](../rules/services.md) — add row to services table
- [`.brain/high-level-architecture/integrations.md`](../high-level-architecture/integrations.md) — purpose, scope, gotchas
- [`.brain/CHANGELOG.md`](../CHANGELOG.md) — entry

## Definition of done

- [ ] Tag + Live layer in `app/services/`
- [ ] Errors tagged + mapped
- [ ] Layer merged in `runtime.ts` + added to `AppServices` union
- [ ] Unit test green (happy + failure)
- [ ] `services.md` + `integrations.md` updated

## Anti-patterns

- ❌ Storing module-level singleton client (e.g. `const client = new SDK(...)` at top) — creates per-Worker leak, breaks isolation
- ❌ `Effect.promise` — must be `Effect.tryPromise` with tagged error
- ❌ Reading `process.env.X` — go through `CloudflareEnv` Tag
- ❌ Building business logic inside `MailerLive` — keep service thin, put logic in repository or use-case Effect
