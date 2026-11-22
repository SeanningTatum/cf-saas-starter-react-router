# cf-saas-starter-react-router

[![Release](https://img.shields.io/github/v/release/SeanningTatum/cf-saas-starter-react-router?label=release&color=blue)](https://github.com/SeanningTatum/cf-saas-starter-react-router/releases/latest)
[![Cloudflare Workers](https://img.shields.io/badge/runtime-Cloudflare%20Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![React Router](https://img.shields.io/badge/framework-React%20Router%20v7-CA4245?logo=reactrouter&logoColor=white)](https://reactrouter.com/)
[![Effect TS](https://img.shields.io/badge/typed-Effect%20TS-1E1E2C)](https://effect.website/)
[![TypeScript](https://img.shields.io/badge/typescript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

> **The harness-first, AI-first SaaS starter.** Cloudflare Workers + React Router v7 + tRPC + D1 + Drizzle + Better Auth + Effect TS + ShadCN. Same runtime on your laptop and at the edge. Drop in any agent (Claude Code, Cursor, Codex) and ship real features with specs and tickets in GitHub issues, planning skills, and deterministic verification gates.

**Three pillars:**
1. **Harness-first** — agents stay coherent across sessions via the [5-subsystem framework](#harness--the-system-around-the-agent): instructions, state, verification, scope, lifecycle.
2. **AI-first** — six project-local sub-agents, Matt Pocock's planning skills, nine gates, five AST-checked non-negotiables.
3. **DX that just works** — `bun install` + `bun run dev` and you're live. `bun run scripts/first-time-setup.ts` gets you from zero to deployed Worker in ~3 minutes. Local dev runs the same Workers runtime that ships to production.

📦 **Latest release:** [`v2.4.0` — One Review Where It Counts](https://github.com/SeanningTatum/cf-saas-starter-react-router/releases/tag/v2.4.0)

If you're a human, scroll to [Quick Start](#quick-start). If you're an agent, scroll to [How To Work In This Repo](#how-to-work-in-this-repo) — it tells you how to read the project state before writing code.

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
- **Background:** no Workflow ships; [add a Cloudflare Workflow](docs/add-a-cloudflare-workflow.md) when you need one

**Agent harness**
- GitHub issues and PRs — specs, tickets and verdicts; the project state
- `scripts/verify.sh` — runs the gates; CI runs the same ones
- `.husky/commit-msg`, `.husky/pre-commit` — commitlint checks the message; lint and typecheck block broken code (installed by `prepare`)
- `CLAUDE.md` → `AGENTS.md` — one file (symlink), the agent entry point

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

The wizard creates your D1 database, R2 bucket, optional KV namespace, generates a `BETTER_AUTH_SECRET`, writes `wrangler.jsonc` + `.env`, runs migrations, and deploys. ~3 min end-to-end. It sets no `BETTER_AUTH_URL`, so the deployed Worker answers 500 until you add it ([`docs/auth.md`](docs/auth.md)). Its last step offers to apply the [repo rules](#repo-rules-githubrepo-rulesjson).

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

You're working in a codebase with strict conventions. Skipping the plan will cost rework. Project state lives in GitHub issues and PRs, plus `AGENTS.md`, `GLOSSARY.md` and `docs/adr/`. The steps:

1. **Start.** Read the issue (`gh issue view`), the docs above, and the open PRs. Run `./scripts/verify.sh --baseline` so you know the tree is green before you touch it.
2. **Plan** when the task carries a decision. `/grill-me` interviews you until the design is clear; `/grill-with-docs` does the same and also writes `GLOSSARY.md` and ADRs. `/to-spec` writes the spec as a GitHub issue. `/to-tickets` cuts it into vertical-slice issues with blocking links.
3. **Work.** One ticket at a time. Frontend work loads the design skill for its lane (see [Design skills](#design-skills) below).
4. **Verify.** The `feature-verifier` sub-agent walks the flow in a browser, saves screenshots to `.verify/<slug>/`, and writes a PASS / FAIL / BLOCKED verdict you paste into the PR.
5. **Done.** `./scripts/verify.sh` is green and the verdict is PASS. Merge the PR that closes the issue.

**The five non-negotiables** (enforced by the `non-negotiables` gate, [`scripts/check-non-negotiables.ts`](scripts/check-non-negotiables.ts)):

1. **Effect TS by default.** No `throw`. No `try/catch` outside `Effect.tryPromise`.
2. **Effect Schema for validation.** No Zod.
3. **Tagged errors only.** All in `app/models/errors/`. Map every one in `app/lib/effect-trpc.ts`.
4. **Unit test every helper, repository, and service.**
5. **Cloudflare Workers, not Node.** Bindings via the `CloudflareEnv` Tag. Never `process.env`.

---

## Harness — the system around the agent

This repo follows the [walkinglabs 5-subsystem harness framework](https://github.com/walkinglabs/learn-harness-engineering/tree/main/skills/harness-creator). The harness is everything that keeps coding agents reliable across sessions: instructions, state, verification, scope, and lifecycle.

State lives in GitHub: the spec is an issue, each ticket is an issue, and a merged PR ships it. Nothing sits in a local database, so a fresh clone sees the same plan. Lasting rules go in `AGENTS.md`, `GLOSSARY.md` or an ADR in `docs/adr/`. Planning uses [Matt Pocock's skills](https://github.com/mattpocock/skills) (installed from [`skills-lock.json`](skills-lock.json)); no extra setup beyond `gh` signed in.

| Subsystem | Artifacts |
|-----------|-----------|
| **Instructions** | [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md), Matt Pocock's skills, `GLOSSARY.md`, `docs/adr/` |
| **State** | GitHub issues (spec and tickets) and PRs (verdicts); `gh issue list`, `gh pr list` |
| **Verification** | Gates run by [`scripts/verify.sh`](scripts/verify.sh); [`scripts/harness-check.sh`](scripts/harness-check.sh); `feature-verifier` browser walks |
| **Scope** | One ticket at a time; ≤2 features per diff |
| **Lifecycle** | [`init.sh`](init.sh), [`.claude/hooks/session-start.sh`](.claude/hooks/session-start.sh) (skill restore + pointers) |

### Gates

| Gate | Command | Runs in |
|------|---------|--------|
| typecheck | `bun run typecheck` | baseline, full |
| test | `bun run test` | baseline, full |
| non-negotiables-selftest | `bun run scripts/check-non-negotiables.ts --selftest` | baseline, full |
| non-negotiables | `bun run scripts/check-non-negotiables.ts` | baseline, full |
| migrations | `bun run scripts/migration-check.ts` | baseline, full |
| harness | `./scripts/harness-check.sh` | baseline, full |
| secrets | `bun run scripts/secret-scan.ts` | baseline, full |
| audit | `bun run scripts/package-audit.ts` | baseline, full |
| build | `bun run build` | full |
| e2e | `bun run test:e2e` | full |

`./scripts/verify.sh --baseline` runs the quick set; bare `./scripts/verify.sh` runs them all. CI runs the same script, so adding a gate is a one-line change there.

### Slash commands

| Command | What it does |
|---------|--------------|
| [`/harness-check`](.claude/commands/harness-check.md) | Repo invariants (CLAUDE↔AGENTS symlink, sub-agent frontmatter, hook wiring) via [`scripts/harness-check.sh`](scripts/harness-check.sh) — no LLM, exits non-zero on drift. |

### Project-local sub-agents ([`.claude/agents/`](.claude/agents/))

| Agent | Use when |
|-------|----------|
| [`effect-ts-enforcer`](.claude/agents/effect-ts-enforcer.md) | After writing — review the diff against the 5 non-negotiables |
| [`test-author`](.claude/agents/test-author.md) | After a change — write the tests that pin it |
| [`instrumenter`](.claude/agents/instrumenter.md) | After adding a procedure, repo method or service — add tracing spans, and analytics events for a metric |
| [`ui-builder`](.claude/agents/ui-builder.md) | Any user-visible work |
| [`context-memory`](.claude/agents/context-memory.md) | Keep per-feature working memory — context, decisions, links, todos — shared by every worktree |
| [`feature-verifier`](.claude/agents/feature-verifier.md) | Walk a user-visible flow in the browser and record the verdict |

See [`.claude/agents/README.md`](.claude/agents/README.md) for invocation flow + complementary plugin agents.

---

## Guardrails

These run automatically — you do not need to remember them.

### Commit hooks ([`.husky/`](.husky))

`commit-msg` runs commitlint on the message (types and scopes in [`.commitlintrc.json`](.commitlintrc.json)). `pre-commit` skips entirely if no `.ts/.tsx/.js/.jsx` files are staged. Otherwise:

```bash
./scripts/verify.sh --only non-negotiables   # or `bun run lint:staged` when the package has it
./scripts/verify.sh --only typecheck         # cf-typegen + react-router typegen + tsc -b
```

The full test run stays in `./scripts/verify.sh` and in CI.

`bun install` runs `prepare`, which runs `scripts/install-hooks.ts`. It sets `core.hooksPath = .husky/_` for the current worktree only when `extensions.worktreeConfig` is on, so one worktree's install never changes another's hooks. With the extension off it writes `.git/config`, which every linked worktree shares, so the hooks turn on in all of them (the printed line says so). It skips when the folder is not the top of its own git work tree, and it ignores any `GIT_*` variable it inherits. It does nothing in CI, with `HUSKY=0`, outside a git work tree, or without husky installed. Re-run it with `bun scripts/install-hooks.ts`. Bypass for an emergency commit:

```bash
HUSKY=0 git commit -m "..."
```

### Repo rules ([`.github/repo-rules.json`](.github/repo-rules.json))

The rules GitHub enforces are a file: pull requests only on the default branch, the three CI jobs required, linear history, no force push, `production` taking merge commits from `staging` only ([details](docs/ci/repo-rules.md)), and a required reviewer on the `production` environment. The repo owner applies them with one command (it needs admin rights, and is safe to run twice):

```bash
bun run scripts/repo-rules.ts --apply            # add --dry-run to see the writes first
```

`./scripts/harness-check.sh` fails when the live rules drift from the file. How it checks, and how to turn on required human review: [`docs/ci/repo-rules.md`](docs/ci/repo-rules.md).

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
.husky/               Git hooks (commit-msg, pre-commit)
.claude/              Claude Code config — settings, hooks, agents/, commands/
drizzle/              SQL migrations
e2e/                  Playwright tests
public/               Static assets
scripts/              Setup / teardown / seed + verify.sh + harness-check.sh
workers/app.ts        Cloudflare Workers entrypoint
init.sh               Harness bootstrap — install + skills + migrate + typecheck + test
```

---

## Commands

```bash
./init.sh                     # Harness bootstrap — install + skills + migrate + typecheck + test
./init.sh --baseline          # Baseline only (typecheck + test + harness-check)
./init.sh --quick             # Skip install + migrate (assume already done)
./scripts/harness-check.sh    # repo invariants (also: /harness-check)

bun run dev                   # Dev server (auto-runs local DB migrations) → :5173
bun run build                 # Production build
bun run deploy                # Build + deploy to Cloudflare Workers
bun run preview               # Build + serve locally via the Cloudflare Vite plugin (vite preview)

bun run typecheck             # cf-typegen + react-router typegen + tsc -b
bun run test                  # Vitest (one-shot)
bun run test:watch            # Vitest watch
bun run test:e2e              # Playwright
bun run test:e2e:ui           # Playwright UI mode
bun run test:e2e:videos --out <dir>  # Record the @golden/@error specs as PR videos
bun run test:e2e:report       # Open last Playwright report

bun run db:generate           # Generate Drizzle migration from schema
bun run db:migrate:local      # Apply migrations to local D1
bun run db:migrate:remote     # Apply migrations to remote D1
bun run db:seed               # Seed local D1 with admin/user/banned fixtures
bun run db:seed:preview       # Seed the preview-env D1 with the same fixtures
bun run db:studio             # Drizzle Studio (visual DB editor)

bun run cf-typegen            # Regenerate worker-configuration.d.ts
bun scripts/install-hooks.ts  # Re-install the commit hooks (`prepare` runs it)
bun run setup                 # First-time wizard
bun run teardown              # Tear down Cloudflare resources
```

---

## Authentication

[Better Auth](https://better-auth.com/) 1.7 (config, sessions, bans and admin rules: [`docs/auth.md`](docs/auth.md)) with the Drizzle adapter and `admin()` plugin for RBAC.

- Auth handler: `/api/auth/*` ([`app/routes/api/auth.$.ts`](app/routes/api/auth.$.ts))
- Server config: [`app/auth/server.ts`](app/auth/server.ts)
- Client: [`app/auth/client.ts`](app/auth/client.ts) (uses `adminClient()` plugin)
- Session reading in loaders: `context.auth.api.getSession({ headers: request.headers })`
- Session reading in Effects: yield the `Session` Tag from [`app/services/session.ts`](app/services/session.ts)

**RBAC — admin role enforcement is two-layered:**

- **Page-level** — admin route loaders redirect non-admins (see [`app/routes/admin/_layout.tsx`](app/routes/admin/_layout.tsx))
- **Procedure-level** — `adminProcedure` middleware in [`app/trpc/index.ts`](app/trpc/index.ts) rejects non-admins server-side

Never trust the page guard alone — UI hiding doesn't equal authorization.

**Set the production secret and base URL.** A build other than `bun run dev` refuses to start auth without them: every request gets a 500 until you set both. The secret needs 32 or more characters. The URL is a var in `wrangler.jsonc` (and under `env.preview`):

```bash
openssl rand -base64 32
wrangler secret put BETTER_AUTH_SECRET
# wrangler.jsonc: "vars": { "BETTER_AUTH_URL": "https://app.example.com" }
```

`AUTH_TRUSTED_ORIGINS` (optional, extra origins) and the accepted forms are in [`docs/auth.md`](docs/auth.md). Setup rewrites `wrangler.jsonc`, so re-add the `vars` after a re-run.

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

**Test accounts** — every preview and local D1 gets the same three fixtures:

| Email | Role | Notes |
|-------|------|-------|
| `admin@preview.local` | admin | admin dashboard access |
| `user@preview.local` | user | regular account |
| `banned@preview.local` | user | `banned = true`, for testing the ban UI |

Local D1 (`bun run db:seed`) uses the password `Password123!`, for local use only. A preview never uses it: see [Preview passwords](docs/ci/pipelines.md#preview-passwords).

Seeding is idempotent (`INSERT OR IGNORE` on fixed `seed-*` ids) — safe to rerun on every PR synchronize. New tables/features must extend these fixtures.

> **Free plan note:** Cloudflare's D1 free plan caps you at 10 databases, so per-PR databases assume a paid plan. On the free plan, revert the "Provision per-PR D1" step in `preview.yml` back to migrating the shared `<name>-db-preview` database (a one-line change).

**Turning previews and deploys on** — both ship disabled and end as skipped (not failed) until you set up your Cloudflare account. Every variable and secret, the steps to set each one, and how to create the two API tokens are in [`docs/ci/pipelines.md`](docs/ci/pipelines.md). `bun run setup` already provisions the `preview` Worker/R2 resources (plus the shared `-db-preview` D1 used for manual preview work) alongside production; per-PR D1 databases are created automatically by CI.

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
- **MCP servers** — optional. If you want richer tool access (Tavily search, Playwright control, etc.), set them up via Claude Code's `/plugin` system instead of repo-local config.

---

## Contributing

1. Branch off the repo's default branch (`bun scripts/default-branch.ts`)
2. Read [`AGENTS.md`](AGENTS.md) before starting
3. Pre-commit gate runs typecheck + tests automatically
4. Run `./scripts/verify.sh` — every gate green
5. Open the PR

### Security

Report a vulnerability in private: see [`SECURITY.md`](SECURITY.md). How dependency updates, the secret scan, the package audit and CodeQL work: [`docs/ci/supply-chain.md`](docs/ci/supply-chain.md).

When in doubt: read first, code second.
