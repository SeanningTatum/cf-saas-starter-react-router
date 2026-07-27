# Progress — Rolling session log

> Single rolling log of "where am I right now". Append-only. Newest entry on top. **Per-task deep state lives in `<YYYY-MM-DD>-<task-slug>.md`** — this file is the index/state cursor.

## How to use

- **Start of session**: read the top entry to recover state.
- **During session**: append one bullet per meaningful checkpoint (decision, blocker, branch switch, test failure, scope change).
- **End of session**: add a `## Session end` block with: branch, last commit SHA, what's running/incomplete, what to do next.
- **Multi-day task**: link to the run note (`runs/<date>-<slug>.md`) for full detail. Keep entries here under ~5 lines each.

## Format per entry

```
## YYYY-MM-DD HH:MM (UTC) — <one-line summary>
- branch: <branch-name>
- in-progress feature: <feat-id> | none
- run note: <path or none>
- next: <one sentence>
```

---

## 2026-07-27 — v1.3.0 deployed to production by hand: version d8c10b0b at cf-saas-starter-react-router.royal-snowflake-2464.workers.dev. Root-caused why CD is red: NOT a token scope issue — wrangler.jsonc commits placeholder D1 ids by design, so CI's deploy.yml always hits database_id 00000000-... (code 10181). deploy.yml only works in apps generated FROM the template. Patched real ids locally, migrated (no-op), deployed, restored placeholders; tree clean.
- branch: `main`
- in-progress feature: none
- run note: none
- next: Two follow-ups: (1) gate deploy.yml + preview.yml behind a 'real IDs present' check so they skip instead of failing red in the template repo, or document the red as expected; (2) unauthenticated tRPC errors leak data.stack — tRPC only strips stacks when process.env.NODE_ENV==='production', which never holds on Workers. Set an explicit errorFormatter.

---

## 2026-07-27 — Shipped v1.3.0 'Nothing Left To Remember' (squash de06009, tag v1.3.0) covering PRs #12-#16 unreleased since v1.2.0. PR #16 (layer-rule auto-surfacing PreToolUse hook) merged after 3 pre-PR Greptile rounds + 1 post-PR round: 6 findings, 6 fixed, 0 escalated. Unit tests 228->251 plus 58 offline hook checks; harness-check at 10 invariants.
- branch: `main`
- in-progress feature: none
- run note: none
- next: Cloudflare API token is misscoped — deploy.yml + preview.yml have failed since 2026-07-24 (Info error from wrangler, D1 unreachable). Fix the token permissions (Workers + D1:Edit) or CD/preview stay dead.

---

## 2026-07-27 — Layer rules auto-surface via new .claude/hooks/rule-router.sh (PreToolUse Edit|Write|NotebookEdit → .brain/rules layer doc, once per layer per session, pointers only). Decided AGAINST moving .brain/rules into Claude-specific rules: tool-agnostic AGENTS.md contract + no glob-scoped rules format in Claude Code; the gap was the trigger, not the storage. Fixed 2 pre-existing brain-reminder.sh bugs (declare -A dies on macOS bash 3.2; PreToolUse stdout never reaches the model). 48 new hook tests + harness-check invariants G/H enforce glob-table sync in CI.
- branch: `harness/adopt-brain-axi-cli`
- in-progress feature: none
- run note: none
- next: create-pr-with-review

---

## 2026-07-23 — Harness adopts brain-axi CLI as primary interface (hybrid): slash commands + harness-check.sh wrap brain check/ship/progress; docs (AGENTS/HARNESS/README/recipes) rewritten; CI installs brain-axi
- branch: `docs/readme-harness-loop-in-the-wild`
- in-progress feature: none
- run note: none
- next: create-pr-with-review

---

## 2026-07-15 — audit-remediation shipped
- branch: `refactor/audit-remediation` (PR opening; from main @ 8547acb)
- in-progress feature: none (cross-cutting quality task, closed)
- run note: `.brain/runs/2026-07-15-audit-remediation.md` (closed)
- shipped: 4-agent audit → 5-agent remediation (security, Effect core, DRY, i18n, +71 tests → 228), Greptile pre-PR review resolved (SVG dropped from upload allowlist, magic-byte sniffing added)
- next: merge PR; optional follow-ups — route FileUpload somewhere, feature-verifier walk of admin flow

---

## 2026-07-13 — feat-005 merged + released v1.1.0 — session end
- branch: `main` @ 4f83efc (PR #7 merged)
- in-progress feature: none
- run note: `.brain/runs/2026-07-10-preview-deployments.md` (closed)
- shipped: v1.1.0 "Every PR Gets Its Own SaaS" — per-PR preview deploys w/ isolated seeded D1, full lifecycle verified on PR #7 (open→deploy→login→close→cleanup→reopen)
- outstanding: roll CF API token (leaked to session transcript); decide keep-vs-teardown of session CF resources; run-note final edit uncommitted on main

---

## 2026-07-11 — feat-005 preview-deployments shipped
- branch: `main`
- in-progress feature: none
- run note: `.brain/runs/2026-07-10-preview-deployments.md`
- verification: per-PR D1 binding confirmed (pr-999 version upload), alias URL signup 200 with preview-D1 user row written (pr-test), prod signup 200.
- next: teardown session-provisioned resources (`bun run teardown`).

---

## 2026-07-10 — feat-005 preview-deployments added to feature_list.json (in-progress)
- branch: `main`
- in-progress feature: feat-005 (preview-deployments)
- run note: `.brain/runs/2026-07-10-preview-deployments.md`
- next: registered in `feature_list.json` + `.brain/features/preview-deployments.md` created; continue implementation per run note.

---

## 2026-07-10 — Preview deployments + DX (research → implement) — in progress
- branch: `main`
- in-progress feature: feat-005 (preview-deployments, to be added to feature_list)
- run note: `.brain/runs/2026-07-10-preview-deployments.md`
- baseline: typecheck FAIL + harness-check FAIL — both pre-existing, caused by intentionally-absent `wrangler.jsonc` (generated by `bun run setup`); tests 123/123 PASS
- blocker: wrangler OAuth expired — user must `wrangler login` before provisioning
- next: consume research-agent reports, provision CF env non-interactively, design preview-deploy pipeline

---

## 2026-05-07 — Effect-TS API audit: rules + boundary refactor + bulk ops + logging — closed
- branch: `main`
- in-progress feature: none
- run note: none (rule + targeted code edits)
- scope: surveyed API surface for Effect-TS idiom gaps, codified rules, applied where it mattered, left simple CRUD untouched.

### Rule additions
- **HTTP boundary (non-tRPC) pattern** in `rules/routes.md` — `runPromiseExit` + `Exit.match` + `Effect.catchTag(s)`, no `try`/`catch`. Recoverable in catches, defects in `onFailure`. Anti-patterns: try/catch around runPromise, duck-typing `TRPCError.code`.
- **`Effect.promise` vs `Effect.tryPromise`** table in `rules/services.md` — `tryPromise` for any fallible promise (Better Auth, fetch, drizzle, third-party); `promise` only for known-infallible.
- **Procedure-level error transformation** section in `rules/routes.md` with operator table (`catchTag(s)` / `retry` / `partition` / `tap` / `tapErrorTag` / `timeout`) + worked `deleteUser` example. Default = fall-through; only transform for complex procedures.
- **Logging — Effect logger vs imperative `loggers.X`** in `rules/services.md` — same sink (`emitLog` via `LoggerLive`); pick by context. Effect inside `Effect.gen`, imperative outside. Canonical shape `Effect.logInfo("event").pipe(Effect.annotateLogs({...}))`; never `logInfo({...}, "event")` (fields would JSON-stringify into message string).
- Cross-refs added in `codebase/effect-ts.md` "What Not To Do" + `rules/errors.md` "Using errors in tRPC procedures".
- New anti-patterns: `?.` on `ctx.auth.user` after protected/adminProcedure, `Effect.promise` for fallible work.

### Code changes
- `app/routes/api/upload-file.ts` — rewritten to `runPromiseExit` + `Exit.match` + `Effect.catchTag("ValidationError")`. Removed try/catch + duck-typed `TRPCError.code`. `app/components/file-upload.tsx` narrows `fetcher.data` with `"success" in` / `"key" in` guards.
- `app/trpc/routes/admin.ts` — `bulkBanUsers` / `bulkDeleteUsers` / `bulkUpdateUserRoles` now (1) return idempotent `{ success: true, affectedCount: 0, skippedCount }` on no-valid (was: 400 ValidationError — wrong semantics, input was valid), (2) emit structured audit log via `Effect.tap` + `Effect.logInfo("users.bulk_*").pipe(Effect.annotateLogs({ actor, targets, affectedCount, skippedCount, ... }))`.
- `app/lib/effect-trpc.ts` `runProcedure` — wraps every procedure in `Effect.annotateLogs({ layer: "trpc" })` for auto layer-tag parity with imperative `loggers.trpc`.

### Skipped (intentionally)
- Procedure refactors for simple CRUD — default `tagToTRPC` fall-through is correct.
- Helper extraction for bulk ops — defer until 4th lands.
- `Effect.partition` per-user in bulk — single bulk UPDATE keeps atomicity; partial-success UX not needed for ban.

### Still open (separate task)
- `app/trpc/index.ts:14-18` — `Effect.promise` → `Effect.tryPromise` for Better Auth `getSession`.
- `app/trpc/router.ts:43` — redundant `?.` on `ctx.auth.user`.

### Verify
- typecheck PASS, unit 123/123 PASS at every checkpoint.

---

## 2026-05-07 — Boilerplate UI polish v3 (Mandarin + live toggle + e2e cleanup) — closed
- branch: `main`
- in-progress feature: none
- run note: `.brain/runs/2026-05-07-boilerplate-ui-polish.md`
- verify: typecheck + unit (123/123) + e2e (auth.spec 2/2) PASS
- changes: added zh locale (6 ns files), `LanguageSwitcher` wired into home / auth / dashboard, new `/api/set-locale` action, replaced docs+i18n e2e specs with focused `auth.spec.ts`, fixed live-toggle race via `useFetcher` + root revalidation
- next: none — to add a locale, drop `app/locales/<lng>/*.json` + add to `supportedLngs` + add label to LanguageSwitcher.

---

## 2026-05-07 — Boilerplate UI polish v2 (harness section + v2 label) — closed
- branch: `main`
- in-progress feature: none (cross-cutting polish over feat-001, feat-002)
- run note: `.brain/runs/2026-05-07-boilerplate-ui-polish.md`
- verify: typecheck + unit PASS (123/123), e2e i18n 6/8 (same 2 pre-existing fails — no regression)
- changes: hero eyebrow → v2; new "An agent harness, not just a stack" section on `/` with 3 pillars + commands block; `meta.description` updated; new `home.harness.*` i18n keys.
- next: replace placeholder GitHub URLs with real repo on publish; pre-existing 404 i18n namespace + dead docs.spec follow-up.

---

## 2026-05-07 — Boilerplate UI polish (home / login / dashboard) — closed
- branch: `main`
- in-progress feature: none (cross-cutting polish over feat-001, feat-002)
- run note: `.brain/runs/2026-05-07-boilerplate-ui-polish.md`
- baseline: PASS; verify: typecheck + unit PASS, e2e i18n 6/8 (2 pre-existing fails unrelated), docs.spec dead (pre-existing)
- shipped: refero-synthesized `design-system.md`; redesigned home / login / sign-up / dashboard with split-pane auth + educational cards; new `StackBadge` + `AuthShell` components.
- next: replace placeholder GitHub URLs with real repo on publish; fix pre-existing 404 i18n namespace bug + dead docs.spec in a follow-up.

---

## 2026-05-07 — Harness hardening pass
- branch: `feat/effect-ts`
- in-progress feature: harness itself (no feat-id; meta)
- run note: none
- changes: type-locked `tagToTRPC` (AppError + assertNever), `harness-check.sh` brain dead-link check + wired into `init.sh --baseline`, added `.github/workflows/ci.yml` (baseline + build + e2e + non-negotiables grep), `99-verify-done.md` flipped e2e default-on, `HARNESS.md` Verification table updated, `add-tagged-error.md` recipe updated for AppError union requirement
- next: commit + push to exercise CI on first PR

---

## 2026-05-07 — Harness upgrade (5-subsystem alignment)
- branch: `feat/effect-ts`
- in-progress feature: harness itself (no feat-id; meta)
- run note: none
- changes: added `feature_list.json`, `init.sh`, this `progress.md`, `HARNESS.md`, sub-agents in `.claude/agents/`, SessionStart hook
- next: verify init.sh runs clean → commit harness upgrade
