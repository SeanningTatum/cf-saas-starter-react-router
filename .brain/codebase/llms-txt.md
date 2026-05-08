# Library `llms.txt` — When and How to Use

Several libraries in this stack publish an [`llms.txt`](https://llmstxt.org/) — an LLM-optimized index of their docs. Use these when training-data recall is unreliable (new APIs, recent migrations, version-specific behavior) or when you need authoritative syntax for a non-trivial change.

> **Rule of thumb:** prefer these `llms.txt` indexes for *library-specific* questions. Don't use them for general programming concepts, refactors, or business-logic debugging. They are docs, not problem-solvers.

## Catalog

| Library | URL | Read when |
|---------|-----|-----------|
| **Better Auth** | https://better-auth.com/llms.txt | Editing `app/auth/server.ts`, adding plugins/providers, session config, RBAC, hooks, organization/team APIs. See also [`../rules/services.md`](../rules/services.md). |
| **Effect TS** | https://effect.website/llms.txt | Effect API surface — `Effect.gen`, `Layer`, `Schema`, `Data.TaggedError`, `@effect/vitest`, `Match`, `Stream`, runtime composition. See also [`effect-ts.md`](effect-ts.md). |
| **Cloudflare** | https://developers.cloudflare.com/llms.txt | Workers runtime, bindings, Wrangler config, D1, R2, Workflows, Workers AI, KV, Durable Objects, secrets. See also [`../rules/cloudflare.md`](../rules/cloudflare.md). |

## How to fetch

Two paths, in order of preference:

### 1. Context7 MCP (preferred)

`context7` MCP plugin already wired. Use `mcp__plugin_context7_context7__resolve-library-id` then `mcp__plugin_context7_context7__query-docs` — returns scoped, query-relevant excerpts (cheaper than pulling whole `llms.txt`).

```
resolve-library-id → "better-auth"
query-docs        → "how to add a plugin to Better Auth server config"
```

### 2. WebFetch (fallback)

For full-index scan or when context7 lacks the library:

```
WebFetch url=https://effect.website/llms.txt prompt="Find pattern for composing Layer.merge with Layer.provide"
```

`llms.txt` is itself an index — it lists the doc URLs. Fetch a sub-URL with a focused prompt rather than slurping the entire site.

## When NOT to fetch

- Question is about **this codebase's** patterns → read [`effect-ts.md`](effect-ts.md), [`api.md`](api.md), or the matching layer rule first.
- Question is about general TypeScript / React / SQL → no library doc needed.
- You already have working example in repo → copy that, don't re-derive from docs.
- Trivial edits (rename, comment, formatting) → skip.

## Recipe pointers

The fetch step is implicit in these recipes — read the catalog above before invoking:

- [`../recipes/add-trpc-endpoint.md`](../recipes/add-trpc-endpoint.md) — Effect TS doc may help with `Effect.gen` chaining
- [`../recipes/add-cf-binding.md`](../recipes/add-cf-binding.md) — Cloudflare doc for Wrangler binding syntax
- [`../recipes/add-service.md`](../recipes/add-service.md) — Effect (Layer/Tag) + sometimes Better Auth docs
- [`../recipes/add-tagged-error.md`](../recipes/add-tagged-error.md) — Effect `Data.TaggedError` reference

## Update triggers

- New library added with own `llms.txt` → append row to catalog
- Library deprecates `llms.txt` (404) → mark `> DEPRECATED` and link replacement
- Recipe added that depends on one of these → add pointer in "Recipe pointers" above
