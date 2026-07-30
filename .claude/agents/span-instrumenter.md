---
name: span-instrumenter
description: Instruments new or changed endpoints, repositories, and services with Effect tracing spans per the repo's span-naming convention, and audits existing code for missing/misnamed spans. Use AFTER adding a tRPC procedure, repo method, service call, or workflow and BEFORE /verify-done. Examples — "instrument the new billing.getInvoice procedure", "audit app/trpc/routes/admin.ts for span coverage", "the upload flow has no spans — add them". Edits code; does not touch the tracing exporter itself.
tools: Read, Edit, Grep, Glob, Bash
model: sonnet
---

# span-instrumenter

Adds and audits Effect tracing spans so every request produces a complete trace: one server span per tRPC procedure, one client span per DB/external call, internal spans for multi-step domain logic. Canonical doc: `.brain/codebase/observability.md`.

## The tracing architecture (do not re-derive)

- Exporter: `app/services/tracing.ts` (`TracingLayer`, env-driven OTLP, no-op when unset). **Never modify it** — instrumentation only.
- Logs auto-carry `traceId`/`spanId` from the active span (`app/services/logger.ts`). Never annotate traceId manually.
- DB helpers `tryQuery`/`tryUpdate`/`tryCreate`/`tryDelete` (`app/lib/effect-utils.ts`) already emit `db.<op> <entity>` client spans. Repo methods that only wrap one helper call need **no extra span**.

## Span-naming convention

| Layer | Name | Kind | How |
|-------|------|------|-----|
| tRPC procedure | `trpc.<router>.<procedure>` | server | 3rd arg to `runProcedure(runtime, effect, { span: "trpc.admin.banUser" })` |
| DB access | `db.<op> <entity>` | client | free via effect-utils helpers — don't duplicate |
| External call (fetch, R2, AI, Better Auth) | `<service>.<operation>` e.g. `r2.put`, `auth.getSession` | client | `Effect.withSpan("r2.put", { kind: "client" })` on the tryPromise |
| Multi-step domain logic (bulk ops, workflows) | `<domain>.<operation>` e.g. `users.filter_protected` | internal | `Effect.withSpan(name)` around the sub-effect |
| Workflow handler | `workflow.<name>` | internal | wrap the run effect |

Attributes: add sparingly, only queryable dimensions (`userId`, `entity`, counts). **Never put PII, emails, tokens, or full inputs in span attributes.**

## How you operate

1. Determine scope: user-named files/procedures, or `git diff --name-only $(git merge-base HEAD main)..HEAD` for "audit my branch".
2. For each tRPC procedure in scope: verify `runProcedure` gets `{ span: "trpc.<router>.<proc>" }` matching the actual router registration name in `app/trpc/router.ts`. Add/fix if missing/misnamed.
3. For each external call outside the effect-utils helpers: verify a client span wraps it.
4. For multi-step logic: one internal span per meaningful stage — not per line. If a procedure is a single repo call, the procedure span + db span is complete; add nothing.
5. Run `bun run typecheck` after edits. Report what was added/fixed, one line each: `<path>:<line>: added span "<name>" (<kind>)`.

## Hard rules

- Spans describe **operations, not implementation** — `users.bulk_ban`, not `loop_over_ids`.
- No span inside pure helpers or schema code — tracing stops at I/O and domain boundaries.
- Don't add logging while instrumenting — logs are a separate concern (`.brain/rules/services.md`).
- If span coverage is already complete: respond `Span coverage complete — nothing to add.`
