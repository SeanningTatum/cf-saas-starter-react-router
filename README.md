# cf-saas-starter-react-router

> **An agent-first SaaS starter.** Cloudflare Workers + React Router v7 + tRPC + D1 + Drizzle + Better Auth + Effect TS + ShadCN. Built so AI coding agents (Claude Code, Cursor, Codex) can one-shot real features by following retrieval-based docs, paste-able recipes, and pre-commit guardrails.

If you're a human, scroll to [Quick Start](#quick-start). If you're an agent, scroll to [How To Work In This Repo](#how-to-work-in-this-repo) — it tells you which docs to open before writing code.

---

## What's in the box

**Stack**
- **Runtime:** Cloudflare Workers (no Node), React Router v7 SSR
- **Server logic:** tRPC v11 procedures wrapped in Effect TS
- **Persistence:** D1 (SQLite) via Drizzle ORM 0.45, R2 for files
- **Auth:** Better Auth 1.4 with Drizzle adapter + admin plugin (RBAC)
- **Validation:** Effect Schema everywhere — no Zod
- **Errors:** `Data.TaggedError` mapped to tRPC codes via `tagToTRPC`
- **UI:** ShadCN/Radix + Tailwind v4 (oklch), next-themes, react-hook-form + Effect resolver
- **i18n:** remix-i18next + i18next, route-level namespaces, fully typed
- **Testing:** Vitest 3 (unit) + Playwright 1.58 (e2e) + `@effect/vitest`
- **Background:** Cloudflare Workflows (`ExampleWorkflow`)

**Agent harness**
- `.brain/` — retrieval-first docs (rules, architecture, features, recipes, runs)
- `.brain/recipes/` — paste-able runbooks bookended by `00-before-task.md` (init) and `99-verify-done.md` (termination check)
- `.brain/runs/` — per-task continuity log so multi-session work survives compaction
- `.githooks/pre-commit` — typecheck + tests block broken commits (no-dep, auto-installs)
- `.claude/hooks/brain-reminder.sh` — staged-path → relevant-doc reminder before commit
- `.claude/commands/verify-done.md` — `/verify-done` slash command runs the full termination checklist
- `CLAUDE.md` / `AGENTS.md` — kept byte-identical, both are the agent entry point

---

## Quick Start

### Prerequisites

```bash
# Bun (package manager + runtime)
curl -fsSL https://bun.sh/install | bash

# Cloudflare CLI
bun add -g wrangler
wrangler login
```

### Option A — Automated setup (recommended)

```bash
bun run scripts/first-time-setup.ts
```

The wizard creates your D1 database, R2 bucket, optional KV namespace, generates a `BETTER_AUTH_SECRET`, writes `wrangler.jsonc` + `.env`, runs migrations, and deploys. ~3 min end-to-end.

### Option B — Manual

```bash
bun install                 # also runs cf-typegen + git hooks install
bun run db:migrate:local    # apply migrations to local D1
bun run dev                 # http://localhost:5173
```

### First-time agent setup

If you want AI agents to work effectively in this repo, install the recommended Claude Code plugins:

```bash
/plugin marketplace add SeanningTatum/claude-plugins
/plugin install cf-saas-stack
/plugin install dev-workflows

# Cloudflare official skills (Workers, Durable Objects, Agents SDK, Wrangler, perf)
/plugin marketplace add cloudflare/skills
/plugin install cloudflare
```

The repo works without these — they add reusable agents/commands that complement the project-local harness.

---

## How To Work In This Repo

### For humans

Read [`CLAUDE.md`](CLAUDE.md) once. It points to everything else.

### For agents

You're working in a codebase with strict conventions. Skipping the brain will cost rework. Every non-trivial task has three phases:

**1. Init — [`.brain/recipes/00-before-task.md`](.brain/recipes/00-before-task.md)**
- Read [`CLAUDE.md`](CLAUDE.md) — entry point, five non-negotiables
- Open the relevant `.brain/<folder>/index.md` and read every file its triggers match
- For multi-session or >30min work: copy [`.brain/runs/_TEMPLATE.md`](.brain/runs/_TEMPLATE.md) → `.brain/runs/<date>-<slug>.md`
- Capture a `bun run typecheck` + `bun run test` baseline so you can tell "pre-existing" from "I broke it"

**2. Work — pick the runbook**
- Adding code → matching recipe in [`.brain/recipes/index.md`](.brain/recipes/index.md)
- Refactor / bugfix → the layer's rule file in [`.brain/rules/index.md`](.brain/rules/index.md)
- Feature work → existing memo in [`.brain/features/<slug>.md`](.brain/features/index.md), plus past attempts in [`.brain/runs/`](.brain/runs/)

**3. Verify — [`.brain/recipes/99-verify-done.md`](.brain/recipes/99-verify-done.md) (or `/verify-done`)**
- typecheck + test + e2e (if cross-component) + build (if CF-touching) + manual UI smoke (if UI)
- Brain coherence: every diffed path → owning brain doc updated
- Five non-negotiables grep-clean
- Close the run note if you opened one

The `/verify-done` slash command (in [`.claude/commands/verify-done.md`](.claude/commands/verify-done.md)) runs this automatically — invoke it before telling the user a task is done.

**The five non-negotiables** (also in [`.brain/codebase/effect-ts.md`](.brain/codebase/effect-ts.md)):

1. **Effect TS by default.** No `throw`. No `try/catch` outside `Effect.tryPromise`.
2. **Effect Schema for validation.** No Zod.
3. **Tagged errors only.** All in `app/models/errors/`. Map every one in `app/lib/effect-trpc.ts`.
4. **Unit test every helper, repository, and service.** See [`.brain/codebase/testing.md`](.brain/codebase/testing.md).
5. **Cloudflare Workers, not Node.** Bindings via the `CloudflareEnv` Tag. Never `process.env`.

---

## The `.brain/` directory

Retrieval-over-recall. Each subdirectory has an `index.md` that signals "read me when X". Don't open files at random — start at the index.

```
.brain/
├── high-level-architecture/   System layers, data flow, security, integrations
├── codebase/                  Effect TS programming model, helpers, tests, i18n, tRPC API
├── rules/                     7 layer-aligned rules (frontend / cloudflare / repository /
│                               services / routes / library / errors)
├── recipes/                   Paste-able runbooks (00-before-task / 99-verify-done bookends + add-*)
├── runs/                      Per-task continuity log (multi-session / post-compaction recovery)
├── features/                  Per-feature memory — purpose, persistence, dependencies
├── transcripts/               Meeting notes / decision logs (the "why")
├── emails/                    Stakeholder correspondence
└── CHANGELOG.md               Architectural + brain shifts (not a code changelog)
```

### When to read what

| Task | Open |
|------|------|
| Adding any code | [`recipes/index.md`](.brain/recipes/index.md) → pick a recipe |
| Editing UI / forms / Tailwind | [`rules/frontend.md`](.brain/rules/frontend.md) |
| Editing a repository | [`rules/repository.md`](.brain/rules/repository.md) |
| Editing a service | [`rules/services.md`](.brain/rules/services.md) |
| Editing a tRPC route or page loader | [`rules/routes.md`](.brain/rules/routes.md) |
| Editing wrangler / bindings / Workflows | [`rules/cloudflare.md`](.brain/rules/cloudflare.md) |
| Adding a tagged error | [`rules/errors.md`](.brain/rules/errors.md) + [`recipes/add-tagged-error.md`](.brain/recipes/add-tagged-error.md) |
| Helpers / Effect Schema / tests | [`rules/library.md`](.brain/rules/library.md) |
| Designing a feature | [`features/index.md`](.brain/features/index.md) → `_TEMPLATE.md` → existing examples |
| Tracing a constraint with no obvious "why" | [`transcripts/`](.brain/transcripts/) and [`emails/`](.brain/emails/) |

---

## Recipes — paste-able runbooks

Each recipe is a deterministic checklist with code snippets, brain-doc updates, and a "definition of done". Designed for one-shot agent execution.

| Recipe | When |
|--------|------|
| [`00-before-task.md`](.brain/recipes/00-before-task.md) | **Bookend.** Run at the start of every non-trivial task |
| [`99-verify-done.md`](.brain/recipes/99-verify-done.md) | **Bookend.** Run before declaring a task done. Also `/verify-done` |
| [`add-trpc-endpoint.md`](.brain/recipes/add-trpc-endpoint.md) | New tRPC procedure (query/mutation) |
| [`add-db-table.md`](.brain/recipes/add-db-table.md) | New D1 table + Drizzle schema + repository |
| [`add-tagged-error.md`](.brain/recipes/add-tagged-error.md) | New domain error + `tagToTRPC` mapping |
| [`add-cf-binding.md`](.brain/recipes/add-cf-binding.md) | New Cloudflare binding (KV, DO, Queue, Vectorize, etc.) |
| [`add-service.md`](.brain/recipes/add-service.md) | New Effect service (external client, lifecycle-bearing) |
| [`add-route.md`](.brain/recipes/add-route.md) | New React Router page (loader / action / UI / i18n) |
| [`add-feature.md`](.brain/recipes/add-feature.md) | End-to-end feature combining the above |

[`recipes/index.md`](.brain/recipes/index.md) also has decision trees (e.g. "tRPC vs Workflow vs Queue?", "D1 vs R2 vs KV?") to disambiguate before you start.

---

## Guardrails

These run automatically — you do not need to remember them.

### Pre-commit gate ([`.githooks/pre-commit`](.githooks/pre-commit))

Triggered on `git commit`. Skips entirely if no `.ts/.tsx/.js/.jsx` files are staged. Otherwise:

```bash
bun run typecheck     # cf-typegen + react-router typegen + tsc -b
bun run test          # vitest run (123+ unit tests)
```

Auto-installed via `postinstall` (sets `core.hooksPath = .githooks`). Re-install manually with `bun run hooks:install`. Bypass for an emergency commit:

```bash
SKIP_HOOKS=1 git commit -m "..."
```

### Brain reminder ([`.claude/hooks/brain-reminder.sh`](.claude/hooks/brain-reminder.sh))

Fires from Claude Code's `PreToolUse` hook on `git commit*`. Looks at staged paths and prints which `.brain/` docs likely need updating. Cheap shell script — no LLM call, never blocks.

Example output:

```
🧠 Brain-update reminder (commit not blocked):
  • app/db/schema.ts → .brain/high-level-architecture/data-models.md + .brain/codebase/api.md
  • app/repositories/ → .brain/rules/repository.md
```

### CLAUDE.md ↔ AGENTS.md sync

Both files are byte-identical by design — `CLAUDE.md` for Claude Code, `AGENTS.md` for AGENTS-spec tools (Codex, Aider). When you edit one, mirror to the other:

```bash
cp CLAUDE.md AGENTS.md
```

(There's no CI check yet — that's tracked.)

---

## Project layout

```
app/
├── auth/             Better Auth server config + client
├── components/       UI — shadcn primitives in ui/, feature components alongside
├── db/               Drizzle schema + connection
├── hooks/            React hooks
├── i18n/             SSR + client i18next setup, types
├── lib/              Helpers — schemas/, logger, effect-trpc, effect-utils
├── locales/en/       Translation JSON files (one per namespace)
├── models/errors/    Tagged error classes
├── repositories/     Drizzle-backed Effect.Service repositories
├── routes/           React Router v7 file-based routes
├── services/         Effect Tag/Layer services (Database, Bucket, AuthApi, etc.)
├── trpc/             tRPC router + procedures + middleware
├── routes.ts         Route config
├── runtime.ts        ManagedRuntime composition (services + repos)
├── root.tsx          Root layout
└── entry.{client,server}.tsx
.brain/               Agent-readable docs (see above)
.githooks/            Git hooks (pre-commit gate)
.claude/              Claude Code config — settings + hooks
drizzle/              SQL migrations
e2e/                  Playwright tests
public/               Static assets
scripts/              Setup / teardown / seed scripts
workers/app.ts        Cloudflare Workers entrypoint
workflows/            Cloudflare Workflow definitions
```

---

## Commands

```bash
bun run dev                   # Dev server (auto-runs local DB migrations) → :5173
bun run build                 # Production build
bun run deploy                # Build + deploy to Cloudflare Workers
bun run preview               # Build + serve via wrangler

bun run typecheck             # cf-typegen + react-router typegen + tsc -b
bun run test                  # Vitest (one-shot)
bun run test:watch            # Vitest watch
bun run test:e2e              # Playwright
bun run test:e2e:ui           # Playwright UI mode
bun run test:e2e:report       # Open last Playwright report

bun run db:generate           # Generate Drizzle migration from schema
bun run db:migrate:local      # Apply migrations to local D1
bun run db:migrate:remote     # Apply migrations to remote D1
bun run db:studio             # Drizzle Studio (visual DB editor)

bun run cf-typegen            # Regenerate worker-configuration.d.ts
bun run hooks:install         # Re-install pre-commit gate
bun run setup                 # First-time wizard
bun run teardown              # Tear down Cloudflare resources
```

---

## Authentication

[Better Auth](https://better-auth.com/) 1.4 with the Drizzle adapter and `admin()` plugin for RBAC.

- Auth handler: `/api/auth/*` ([`app/routes/api/auth.$.ts`](app/routes/api/auth.$.ts))
- Server config: [`app/auth/server.ts`](app/auth/server.ts)
- Client: [`app/auth/client.ts`](app/auth/client.ts) (uses `adminClient()` plugin)
- Session reading in loaders: `context.auth.api.getSession({ headers: request.headers })`
- Session reading in Effects: yield the `Session` Tag from [`app/services/session.ts`](app/services/session.ts)

**RBAC — admin role enforcement is two-layered:**

- **Page-level** — admin route loaders redirect non-admins (see [`app/routes/admin/_layout.tsx`](app/routes/admin/_layout.tsx))
- **Procedure-level** — `adminProcedure` middleware in [`app/trpc/index.ts`](app/trpc/index.ts) rejects non-admins server-side

Never trust the page guard alone — UI hiding doesn't equal authorization.

**Set the production secret:**

```bash
openssl rand -base64 32
wrangler secret put BETTER_AUTH_SECRET
```

**Promote a user to admin** — Drizzle Studio:

```bash
bun run db:studio
# Open user table → edit `role` cell → change "user" → "admin" → save
```

Or remote:

```bash
bunx wrangler d1 execute YOUR_DB_NAME --remote \
  --command "UPDATE user SET role = 'admin' WHERE email = 'user@example.com'"
```

Or seed a test admin locally:

```bash
bun run scripts/seed-test-admin.ts
```

---

## Database

D1 (SQLite) accessed through Drizzle. Schema lives in [`app/db/schema.ts`](app/db/schema.ts) — single file at current scale.

**Workflow for schema changes:**

```bash
# 1. Edit app/db/schema.ts
# 2. Generate migration
bun run db:generate
# 3. Review SQL in drizzle/<NNNN>_<name>.sql
# 4. Apply locally
bun run db:migrate:local
# 5. After PR merge, apply to prod
bun run db:migrate:remote
```

> Use SQL defaults for timestamps (`unixepoch('subsecond') * 1000`), not JS-side `new Date()`. See [`recipes/add-db-table.md`](.brain/recipes/add-db-table.md).

---

## UI / Design system

ShadCN primitives in [`app/components/ui/`](app/components/ui/). Compose into feature components elsewhere. Tailwind v4 with oklch CSS variables in [`app/app.css`](app/app.css).

Add a shadcn component:

```bash
bunx shadcn@latest add <component-name>
```

**Forms — always Effect Schema + `effectResolver`** (no Zod resolver):

```ts
import { effectResolver } from "@hookform/resolvers/effect-ts";
import { LoginSchema, type LoginInput } from "@/lib/schemas/auth";

const form = useForm<LoginInput>({
  resolver: effectResolver(LoginSchema),
});
```

**Dark mode** is wired via `next-themes` (`attribute="class"`, `defaultTheme="system"`).

**i18n** — every route declares its namespaces and uses the matching `useTranslation()`:

```ts
export const handle = { i18n: ["dashboard", "common"] };
// Inside the component:
const { t } = useTranslation("dashboard");
```

Strings live in [`app/locales/en/<namespace>.json`](app/locales/en/). Types in [`app/i18n/i18n.d.ts`](app/i18n/i18n.d.ts).

---

## Deployment

```bash
bun run deploy                    # Build + deploy to production
bunx wrangler versions upload     # Deploy a preview URL
bunx wrangler versions deploy     # Promote a preview to production
```

Observability is enabled in [`wrangler.jsonc`](wrangler.jsonc) (logs, 100% head sampling). Smart placement is on.

---

## Editor integrations

- **VS Code / Cursor** — uses the local TypeScript server. The `typescript-lsp` Claude plugin (auto-enabled in `.claude/settings.json`) gives agents diagnostics inline.
- **MCP servers** — optional. If you want richer tool access (Tavily search, Playwright control, etc.), set them up via Claude Code's `/plugin` system instead of repo-local config.

---

## Contributing

1. Branch off `main`
2. Read the relevant `.brain/recipes/` runbook before starting
3. Pre-commit gate runs typecheck + tests automatically
4. Update the `.brain/` doc that owns your change (the brain-reminder hook will tell you which)
5. Append a one-line entry to [`.brain/CHANGELOG.md`](.brain/CHANGELOG.md)
6. Open the PR

When in doubt: read first, code second.
