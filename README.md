# cf-saas-starter-react-router

[![Release](https://img.shields.io/github/v/release/SeanningTatum/cf-saas-starter-react-router?label=release&color=blue)](https://github.com/SeanningTatum/cf-saas-starter-react-router/releases/latest)
[![Cloudflare Workers](https://img.shields.io/badge/runtime-Cloudflare%20Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![React Router](https://img.shields.io/badge/framework-React%20Router%20v7-CA4245?logo=reactrouter&logoColor=white)](https://reactrouter.com/)
[![Effect TS](https://img.shields.io/badge/typed-Effect%20TS-1E1E2C)](https://effect.website/)
[![TypeScript](https://img.shields.io/badge/typescript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

> **The harness-first, AI-first SaaS starter.** Cloudflare Workers + React Router v7 + tRPC + D1 + Drizzle + Better Auth + Effect TS + ShadCN. Same runtime on your laptop and at the edge. Drop in any agent (Claude Code, Cursor, Codex) and ship real features with a queryable brain, chained skills, and deterministic verification gates.

**Three pillars:**
1. **Harness-first** — agents stay coherent across sessions via the [5-subsystem framework](#harness--the-system-around-the-agent): instructions, state, verification, scope, lifecycle.
2. **AI-first** — six project-local sub-agents, the brain-axi skills, seven declared gates, five AST-checked non-negotiables.
3. **DX that just works** — `bun install` + `bun run dev` and you're live. `bun run scripts/first-time-setup.ts` gets you from zero to deployed Worker in ~3 minutes. Local dev runs the same Workers runtime that ships to production.

📦 **Latest release:** [`v1.2.0` — The Boilerplate Audited Itself](https://github.com/SeanningTatum/cf-saas-starter-react-router/releases/tag/v1.2.0)

If you're a human, scroll to [Quick Start](#quick-start). If you're an agent, scroll to [How To Work In This Repo](#how-to-work-in-this-repo) — it tells you how to read the brain before writing code.

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
- `.brain/brain.db` — the [brain-axi](https://github.com/SeanningTatum/brain-axi) brain: features, checkpoints, run notes, verifications (local, gitignored)
- `scripts/brain-setup.sh` — creates the brain and declares the gates `brain verify` and CI run
- `.githooks/pre-commit` — typecheck + tests block broken commits (no-dep, auto-installs)
- `CLAUDE.md` → `AGENTS.md` — one file (symlink), the agent entry point
- `.mcp.json` — the [CodeGraph](https://github.com/colbymchenry/codegraph) MCP server: a local symbol graph of the code (`.codegraph/`, gitignored) that agents query before grepping

---

## In the wild

Real apps built on this starter — same runtime, same harness, same conventions:

| Project | What it is |
|---------|------------|
| [**home-karaoke**](https://github.com/SeanningTatum/home-karaoke) 🎤 | Open-source group karaoke — host a room on the big screen, guests scan a QR to search YouTube and add songs to a live shared queue. Extends the base with Cloudflare Durable Objects for the real-time queue. |
| [**portfolio-v3**](https://github.com/SeanningTatum/portfolio-v3) | Sean's personal portfolio — the starter stripped down to a content-first site on the edge. |

Shipped something on it? Open a PR adding it here.

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
bun run db:seed             # seed local D1 with admin/user/banned fixtures
bun run dev                 # http://localhost:5173
```

---

## How To Work In This Repo

### For humans

Read [`CLAUDE.md`](CLAUDE.md) once. It points to everything else.

### For agents

You're working in a codebase with strict conventions. Skipping the brain will cost rework. The [brain-axi](https://github.com/SeanningTatum/brain-axi) plugin skills carry the method, and each hands off to the next:

1. **Start — `brain-axi:brain-start`.** Reads brain state (`brain`, `brain progress`, `brain features`), frames the task, checks scope (one feature in progress), runs `brain verify --stage baseline`, claims the feature.
2. **Plan — `brain-axi:brain-grill` → `brain-axi:brain-plan`** when the task carries a decision. Plans are HTML, reviewed in the browser with `brain review open`.
3. **Work — `brain-axi:brain-execute`.** Logs each step verbatim with `brain runs append`. Frontend work loads the design skill for its lane (see [Design skills](#design-skills) below).
4. **Verify — `brain-axi:brain-verify`.** An independent walk of every acceptance criterion; the `feature-verifier` sub-agent drives the browser and records the verdict with `brain verifications add`.
5. **Done — `brain-axi:brain-done`.** `brain verify` (every gate) + `brain check` green, a checkpoint, then `brain features ship <slug> --evidence "..."` — which refuses without a PASS verification.

**The five non-negotiables** (enforced by the `non-negotiables` gate, [`scripts/check-non-negotiables.ts`](scripts/check-non-negotiables.ts)):

1. **Effect TS by default.** No `throw`. No `try/catch` outside `Effect.tryPromise`.
2. **Effect Schema for validation.** No Zod.
3. **Tagged errors only.** All in `app/models/errors/`. Map every one in `app/lib/effect-trpc.ts`.
4. **Unit test every helper, repository, and service.**
5. **Cloudflare Workers, not Node.** Bindings via the `CloudflareEnv` Tag. Never `process.env`.

---

## Harness — the system around the agent

This repo follows the [walkinglabs 5-subsystem harness framework](https://github.com/walkinglabs/learn-harness-engineering/tree/main/skills/harness-creator). The harness is everything that keeps coding agents reliable across sessions: instructions, state, verification, scope, and lifecycle.

State lives in the brain: one SQLite file, `.brain/brain.db`, read and written by the **[brain-axi](https://github.com/SeanningTatum/brain-axi) CLI** (`brain`) with token-efficient TOON output. The file is **gitignored** — each checkout has its own, and a clone starts empty. Setup needs Node ≥ 24:

```bash
npm i -g github:SeanningTatum/brain-axi#v0.3.0
claude plugin marketplace add SeanningTatum/brain-axi
claude plugin install brain-axi@SeanningTatum
./scripts/brain-setup.sh     # create .brain/brain.db + declare the gates (init.sh runs it too)
```

| Subsystem | Artifacts |
|-----------|-----------|
| **Instructions** | [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md), the brain-axi plugin skills, `brain docs` / `brain search` |
| **State** | `.brain/brain.db` — features (`brain features`), checkpoints (`brain progress`), run notes (`brain runs`), verifications (`brain verifications`) |
| **Verification** | Gates declared in [`scripts/brain-setup.sh`](scripts/brain-setup.sh) and run by `brain verify`; `brain check` + [`scripts/harness-check.sh`](scripts/harness-check.sh); `feature-verifier` browser walks |
| **Scope** | One in-progress feature at a time; ≤2 features per diff |
| **Lifecycle** | [`init.sh`](init.sh), the plugin's SessionStart `brain context`, [`.claude/hooks/session-start.sh`](.claude/hooks/session-start.sh) (skill restore + pointers) |

### Gates

| Gate | Command | Stages |
|------|---------|--------|
| typecheck | `bun run typecheck` | bootstrap, baseline, verify |
| test | `bun run test` | bootstrap, baseline, verify |
| non-negotiables-selftest | `bun run scripts/check-non-negotiables.ts --selftest` | baseline, verify |
| non-negotiables | `bun run scripts/check-non-negotiables.ts` | baseline, verify |
| harness | `./scripts/harness-check.sh` | baseline, verify |
| build | `bun run build` | verify |
| e2e | `bun run test:e2e` | verify |

`brain verify --stage baseline` runs the quick set; bare `brain verify` runs them all. CI runs the same declared gates, so adding one is a one-line change in `scripts/brain-setup.sh`.

### Slash commands

| Command | What it does |
|---------|--------------|
| [`/build-feature`](.claude/commands/build-feature.md) | Multi-layer feature build with the sub-agents fanned out in parallel on disjoint paths, then parallel verification. |
| [`/harness-check`](.claude/commands/harness-check.md) | `brain check` + repo supplement (CLAUDE↔AGENTS symlink, sub-agent frontmatter, hook wiring) via [`scripts/harness-check.sh`](scripts/harness-check.sh) — no LLM, exits non-zero on drift. |

### Project-local sub-agents ([`.claude/agents/`](.claude/agents/))

| Agent | Use when |
|-------|----------|
| [`effect-ts-enforcer`](.claude/agents/effect-ts-enforcer.md) | After writing — review the diff against the 5 non-negotiables |
| [`test-author`](.claude/agents/test-author.md) | After a change — write the tests that pin it |
| [`span-instrumenter`](.claude/agents/span-instrumenter.md) | After adding a procedure, repo method or service — add tracing spans |
| [`ui-builder`](.claude/agents/ui-builder.md) | Any user-visible work |
| [`feature-verifier`](.claude/agents/feature-verifier.md) | Walk a user-visible flow in the browser and record the verdict |

See [`.claude/agents/README.md`](.claude/agents/README.md) for invocation flow + complementary plugin agents.

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

### CLAUDE.md ↔ AGENTS.md

`CLAUDE.md` is a symlink to `AGENTS.md`, so both names resolve to one file. Edit `AGENTS.md`; `scripts/harness-check.sh` fails if the two ever differ.

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
.brain/               brain.db — local brain-axi state (gitignored)
.githooks/            Git hooks (pre-commit gate)
.claude/              Claude Code config — settings, hooks, agents/, commands/
drizzle/              SQL migrations
e2e/                  Playwright tests
public/               Static assets
scripts/              Setup / teardown / seed + brain-setup.sh + harness-check.sh
workers/app.ts        Cloudflare Workers entrypoint
workflows/            Cloudflare Workflow definitions
init.sh               Harness bootstrap — install + brain + migrate + typecheck + test
```

---

## Commands

```bash
./init.sh                     # Harness bootstrap — install + brain + migrate + typecheck + test
./init.sh --baseline          # Baseline only (typecheck + test + harness-check)
./init.sh --quick             # Skip install + migrate (assume already done)
./scripts/harness-check.sh    # brain check + repo invariants (also: /harness-check)

bun run dev                   # Dev server (auto-runs local DB migrations) → :5173
bun run build                 # Production build
bun run deploy                # Build + deploy to Cloudflare Workers
bun run preview               # Build + serve locally via the Cloudflare Vite plugin (vite preview)

bun run typecheck             # cf-typegen + react-router typegen + tsc -b
bun run test                  # Vitest (one-shot)
bun run test:watch            # Vitest watch
bun run test:e2e              # Playwright
bun run test:e2e:ui           # Playwright UI mode
bun run test:e2e:report       # Open last Playwright report

bun run db:generate           # Generate Drizzle migration from schema
bun run db:migrate:local      # Apply migrations to local D1
bun run db:migrate:remote     # Apply migrations to remote D1
bun run db:seed               # Seed local D1 with admin/user/banned fixtures
bun run db:seed:preview       # Seed the preview-env D1 with the same fixtures
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

Or seed the fixture accounts locally:

```bash
bun run db:seed
```

Gives you `admin@preview.local` / `Password123!` (plus `user@preview.local`
and `banned@preview.local`). See [Database](#database) below. Every feature
that adds a table or user-visible data extends these fixtures in the same diff.

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

> Use SQL defaults for timestamps (`unixepoch('subsecond') * 1000`), not JS-side `new Date()`.

---

## UI / Design system

ShadCN primitives in [`app/components/ui/`](app/components/ui/). Compose into feature components elsewhere. Tailwind v4 with oklch CSS variables in [`app/app.css`](app/app.css).

Add a shadcn component:

```bash
bunx shadcn@latest add <component-name>
```

### Design skills

Agents load one of these on every frontend task. None is committed; each comes from its upstream repo:

- **Plugins**, enabled in [`.claude/settings.json`](.claude/settings.json): `impeccable` and `taste-skill`. Claude Code asks to install them when you trust the repo.
- **Plain skills**, listed in [`skills-lock.json`](skills-lock.json) because their repo ships no plugin: the three motion skills. [`scripts/restore-skills.sh`](scripts/restore-skills.sh) installs any that are missing into `.agents/skills/` and links them into `.claude/skills/` — run by `./init.sh`, and in the background by the Claude Code SessionStart hook. Both directories are gitignored.

| Skill | Source | Job here |
|-------|--------|----------|
| `impeccable` (plugin) | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | Leads app screens — dashboard, admin, settings, forms. Critiques app screens from screenshots (`critique`, P0/P1 block) and runs the finish pass (`audit`, `harden`, `polish`) on every surface. |
| `design-taste-frontend` (plugin `taste-skill`) | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) | Leads public pages — landing, marketing, pricing. Art direction plus a screenshot look-and-fix loop that scores the render and gates public pages. |
| `emil-design-eng` · `animate` · `review-animations` (lock) | [emilkowalski/skills](https://github.com/emilkowalski/skills) | Own all motion — easing, duration, enter/exit, gestures. `review-animations` runs only when you call `/review-animations`. |

One skill leads each surface, so they never fight over the same choice. The tokens in [`app/app.css`](app/app.css) beat all of them. Lane rules: [`AGENTS.md`](AGENTS.md).

The restore pulls each skill's latest upstream version, unpinned.

To add a design skill: if its repo ships `.claude-plugin/marketplace.json`, add the marketplace to `extraKnownMarketplaces` and the plugin to `enabledPlugins` in `.claude/settings.json`. Otherwise:

```bash
npx skills add <owner/repo> --skill <name> -y   # adds it to skills-lock.json
./scripts/restore-skills.sh                     # installs and links it; commit the lock only
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
bunx wrangler versions deploy     # Promote an uploaded version to production
```

Observability is enabled in [`wrangler.jsonc`](wrangler.jsonc) (logs, 100% head sampling). Smart placement is on.

### Preview deployments (per-PR)

Every pull request can get its own live preview, isolated from production.

**How it works** — [`wrangler.jsonc`](wrangler.jsonc) declares a `preview` wrangler environment: its own Worker (`<name>-preview`), a shared preview R2 bucket, and a D1 binding that CI repoints at a per-PR database. [`.github/workflows/preview.yml`](.github/workflows/preview.yml) builds against that environment and uploads a Worker *version* tagged with a stable alias, `pr-<N>`, so the preview URL for a given PR doesn't change across pushes:

```
https://pr-<N>-<worker>-preview.<subdomain>.workers.dev
```

The Action also comments the URL (and a per-commit version URL) on the PR.

**Data isolation** — each PR gets its **own D1 database** (`<name>-db-pr-<N>`). On PR open (and every push), [`scripts/ci/setup-preview-db.ts`](scripts/ci/setup-preview-db.ts) creates the database if needed and patches the CI checkout's `wrangler.jsonc` to point the preview `DATABASE` binding at it (the patch is never committed); CI then applies migrations **and seeds fixtures** ([`scripts/seed-preview.ts`](scripts/seed-preview.ts) `--preview`) before uploading the version, so every preview URL has representative, logged-in-ready data from the first push. On PR close, [`.github/workflows/preview-cleanup.yml`](.github/workflows/preview-cleanup.yml) deletes that database. The preview **R2 bucket is shared** across all PR previews — not per-PR, because wrangler can't delete non-empty buckets, so per-PR buckets would accumulate as orphans. `bun run teardown` also sweeps up any leftover `-db-pr-*` databases.

**Test accounts** — every preview and local D1 gets the same three fixtures (`bun run db:seed` / `bun run db:seed:preview`, password `Password123!` for all):

| Email | Role | Notes |
|-------|------|-------|
| `admin@preview.local` | admin | admin dashboard access |
| `user@preview.local` | user | regular account |
| `banned@preview.local` | user | `banned = true`, for testing the ban UI |

Seeding is idempotent (`INSERT OR IGNORE` on fixed `seed-*` ids) — safe to rerun on every PR synchronize. New tables/features must extend these fixtures.

> **Free plan note:** Cloudflare's D1 free plan caps you at 10 databases, so per-PR databases assume a paid plan. On the free plan, revert the "Provision per-PR D1" step in `preview.yml` back to migrating the shared `<name>-db-preview` database (a one-line change).

**One-time enablement for your repo** — previews ship disabled. To turn them on:

1. Set the repo **variable** `CLOUDFLARE_ACCOUNT_ID` (Settings → Secrets and variables → Actions → Variables tab).
2. Set the repo **secret** `CLOUDFLARE_API_TOKEN` (same page → Secrets tab), created from the "Edit Cloudflare Workers" API token template plus `D1:Edit` added (migrations need it).
3. `bun run setup` already provisions the `preview` Worker/R2 resources (plus the shared `-db-preview` D1 used for manual preview work) alongside production; per-PR D1 databases are created automatically by CI — there's nothing else to create.

**Manual commands** — useful for a one-off preview without opening a PR:

```bash
bun run deploy:preview                                    # Build + deploy the preview Worker directly
bun run db:migrate:preview                                # Apply migrations to the preview D1
CLOUDFLARE_ENV=preview bun run build \
  && bunx wrangler versions upload --preview-alias my-branch  # Build + upload a one-off preview URL
```

> **Gotcha:** `wrangler deploy --env preview` does **not** work with the Cloudflare Vite plugin. The plugin selects the environment at *build* time via the `CLOUDFLARE_ENV` env var and writes a redirected config to `build/server/wrangler.json` that has no `env` block — so any `--env` flag passed to a post-build `wrangler` command has nothing to select. Always set `CLOUDFLARE_ENV` before building instead (as `deploy:preview` and the commands above do).

---

## Editor integrations

- **VS Code / Cursor** — uses the local TypeScript server. The `typescript-lsp` Claude plugin (auto-enabled in `.claude/settings.json`) gives agents diagnostics inline.
- **CodeGraph** — the one repo-local MCP server, in [`.mcp.json`](.mcp.json). Install the CLI (`npm i -g @colbymchenry/codegraph`), run `codegraph init -y` (or `./init.sh`), and approve the server when Claude Code asks. Usage lives in [`AGENTS.md`](AGENTS.md#code-search--codegraph).
- **Other MCP servers** — optional. If you want richer tool access (Tavily search, Playwright control, etc.), set them up via Claude Code's `/plugin` system instead of repo-local config.

---

## Contributing

1. Branch off `main`
2. Read [`AGENTS.md`](AGENTS.md) before starting
3. Pre-commit gate runs typecheck + tests automatically
4. Run `brain verify` — every declared gate green
5. Open the PR

When in doubt: read first, code second.
