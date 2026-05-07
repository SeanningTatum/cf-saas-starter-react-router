# Feature: <Name>

_Last updated: YYYY-MM-DD_

## Purpose
One paragraph. What this feature does and why it exists.

## When It's Used
- User trigger / entry point
- Lifecycle event (load, mount, relaunch)
- Cross-feature interaction

## How It Works
Narrative description of the runtime flow: which service / repo / route owns state, what calls what, where persistence happens, where errors map.

### Persistence details
- Storage location (D1 table, R2 prefix, KV namespace, file path)
- Schema / envelope shape
- Write semantics (debounce, sync, batch)
- Migration / corruption behavior

### Testability
What is unit-tested vs e2e-tested. Stub layers used. Edge cases covered.

## Key Files

| File | Role |
|------|------|
| `app/repositories/<x>.ts` | Repository — Effect.Service wrapping DB access |
| `app/trpc/routes/<x>.ts` | tRPC router — schema validation + runProcedure |
| `app/lib/schemas/<x>.ts` | Effect Schema definitions for inputs/outputs |
| `app/models/errors/<x>.ts` | Tagged errors specific to this feature |
| `app/services/<x>.ts` | Effect Tag + Layer for external service |
| `app/routes/<x>/...` | UI routes (loader, components) |
| `app/components/<x>.tsx` | UI components |
| `app/repositories/<x>.test.ts` | Unit tests |

## Dependencies
- Effect services consumed (`Database`, `Bucket`, `AuthApi`, `Workflows`, `Session`, `CloudflareEnv`)
- Other repositories called
- External SDKs / CF bindings
- UI primitives (shadcn components, hooks)

## Tagged Errors
List `Data.TaggedError` types raised by this feature and their tRPC mapping.

| Error | Where raised | tRPC code |
|-------|--------------|-----------|
| `NotFoundError` | repo getX | NOT_FOUND |
| `ValidationError` | schema decode | BAD_REQUEST |

## Changelog

| Date | Type | Description |
|------|------|-------------|
| YYYY-MM-DD | feature \| bugfix \| refactor | Short summary |
