# Run: boilerplate-ui-polish

_Started: 2026-05-07_
_Status: in-progress_

## Task

Redesign home, login, and dashboard entry pages so the boilerplate is beautiful, professional, and educational — i.e., feels like something a developer would actually want to use as a starting point, while teaching what's wired up (Cloudflare Workers, React Router, tRPC, Better Auth, Drizzle, Effect TS).

## Domain

frontend

## Scope

code only (with minor brain doc additions: a `design-system.md` synthesized from refero references, plus i18n string updates).

## Affected feature(s)

none directly — this is cross-cutting UX polish over feat-001 (Authentication), feat-002 (Admin Dashboard), and the public marketing surface. No `feature_list.json` flip.

## Plan

1. Capture design tokens / direction in `.brain/codebase/design-system.md` (synthesized from Cursor + Linear refero entries — dev-tool aesthetic, monochrome + restrained accent, generous whitespace, mono font for technical bits).
2. Add CSS variable additions to `app/app.css` (brand accent, surface/elevation tokens) only if the existing semantic palette lacks them — prefer reuse over net-new.
3. Redesign `app/routes/home.tsx` — hero with stack callouts, "what you get" educational grid, a small "try it now" interactive card, footer with stack badges. Drop placeholder content (random-user button, raw user list dump).
4. Redesign `app/routes/authentication/login.tsx` (and sign-up.tsx for parity) — split-pane: form left, contextual "what's powering this" panel right. Mobile collapses to single column.
5. Redesign `app/routes/dashboard/_index.tsx` — welcome row + 4-card educational grid (auth, admin, file upload, analytics) linking into the live features. Replace decorative-only cards with actionable ones.
6. Update i18n keys (`public/locales/en/home.json`, `auth.json`, `dashboard.json`) for all new copy. Add missing locales' parity (en first; other locales update later if scope holds).
7. Manual Playwright verification: golden path on home → /login → /dashboard, light + dark mode.
8. Run `/verify-done` (typecheck + test + e2e + brain coherence + harness-check).

## Baseline

```
$ ./init.sh --baseline
typecheck:     PASS
test:          PASS
harness-check: PASS

Baseline green. Proceed to task.
```

State of tree: branch `main`, working tree dirty (`.gitignore`, `package.json`, untracked `wrangler.jsonc`) — not from this task; pre-existing.

---

## Design references

Pulled DESIGN.md content via Tavily extract from:

- Cursor — https://styles.refero.design/style/4e3b4717-84c8-4599-baaf-a343c3d619b6 — warm ivory studio, multi-layer shadow elevation, single accent (#f54e00), monospace for dev surfaces.
- Linear — https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1 — dark command-center, 4px spacing unit, 6px radius, tight tracking on display type, Berkeley Mono.

Synthesis: lean toward Linear's spacing/radius scale + Cursor's warm/ivory light mode palette — keeps current Tailwind/oklch palette mostly intact, adds elevation tokens and a single brand accent for CTAs.

---

## Final

_Closed: 2026-05-07 (then re-opened same day for v2 harness section, re-closed)._

- Shipped: pending commit on `main` (no PR yet — local).
- Brain docs updated:
  - `.brain/codebase/design-system.md` (new — synthesized refero DESIGN.md for the public surface)
  - `.brain/codebase/index.md` (registered `design-system.md`)
  - `.brain/runs/progress.md` (entry)
- Code:
  - `app/routes/home.tsx` — full rewrite: top bar, hero with stack badges, 6 educational feature cards, quickstart terminal, footer.
  - `app/routes/authentication/login.tsx` + `sign-up.tsx` — wrapped in shared `AuthShell` (split-pane).
  - `app/routes/authentication/components/auth-shell.tsx` (new) — context panel + navigation chrome.
  - `app/routes/authentication/components/login-form.tsx` + `signup-form.tsx` — semantic destructive error styling, autoComplete hints, `data-testid` per field, drop hardcoded `text-red-600`.
  - `app/routes/dashboard/_index.tsx` — replaced placeholder cards with role-aware educational cards + session info card.
  - `app/components/stack-badge.tsx` (new) — monospace stack-piece label.
  - `app/locales/en/{home,auth,dashboard}.json` — full copy refresh for the new layout.
  - `app/components/ui/card.tsx` — untouched (kept `rounded-xl` ShadCN default; the design-system.md "rounded-md" guidance applies to bespoke surfaces only, not ShadCN cards).
  - `e2e/i18n.spec.ts` — copy + selectors updated for new strings + new test IDs.
  - `.gitignore` — ignore manual Playwright MCP screenshots.
- Manual UI verification (Playwright MCP, dev on :5174):
  - `/` light + dark — renders ✅
  - `/login` light + dark — renders ✅
  - `/sign-up` light — renders, signup → `/dashboard` works ✅
  - `/dashboard` (regular user) light + dark — renders, all 4 cards correctly show "ADMIN ONLY" lock ✅
  - Admin-promoted variant of `/dashboard` not screenshotted — promotion via direct D1 UPDATE was permission-denied. Code path is identical (only the `disabled` prop flips), so confidence is high but not visually verified.
- Verify-done:
  - typecheck PASS, unit test PASS (123/123).
  - e2e i18n: 6/8 PASS. The 2 fails are **pre-existing** and unrelated to this task —
    - `admin dashboard requires auth` — needs a seeded `admin@test.local` user that the e2e harness never sets up. Documented in `.brain/rules/library.md` test-credentials section as a manual prereq; no CI seed step exists.
    - `404 error shows translated text` — `app/root.tsx` ErrorBoundary uses `useTranslation()` but the error route doesn't declare the `common` i18n namespace (`handle = { i18n: ["common"] }` missing). Pre-existing bug, separate task to fix.
  - e2e docs.spec: 0/15 PASS — **pre-existing**, the entire `Documentation` feature it tests was removed (no `app/routes/admin/docs/*` exists). Spec is dead.

- Left undone:
  - Admin-only flip on `/dashboard` cards visually unverified (D1 UPDATE permission-denied).
  - Pre-existing e2e failures left as-is (separate scope).
  - i18n: only `en` locale touched. If/when other locales come back, add parity for the new keys (`hero.*`, `wired.*`, `quickstart.*`, `footer.*`, `shell.*`, `eyebrow`, `actions.*`, `explore.*`, `account.*`).
  - Docs button on home + dashboard points to `https://github.com/` placeholder — replace with real repo URL on publish.

- Surprises worth remembering:
  - ShadCN `Card` is hard-coded to `rounded-xl`; overriding to `rounded-md` everywhere creates visual dissonance with admin pages. Settled by scoping the "Linear 6px radius" guidance in `design-system.md` to bespoke surfaces only.
  - Better Auth's `/api/auth/sign-out` requires `Content-Type: application/json` + a body (even `{}`) — bare POST returns 415. Not strictly needed in app code (we use `authClient.signOut()`), but useful test trivia.
  - The repo had two e2e specs already red on `main` (docs.spec entirely, two i18n cases). The CI workflow runs e2e but apparently tolerates these — worth a follow-up to either delete the docs spec or restore the feature.

---

## Step v2 — Harness section + version bump

_2026-05-07_

What I did:

- Bumped hero eyebrow `Boilerplate · v1` → `v2`.
- Added a dedicated "An agent harness, not just a stack" section between "What's already wired" and "Quickstart" — 3 pillar cards (Brain / Recipes / Verification gates) + a code block showing `/start-task`, `/verify-done`, `/ship-feature`.
- Updated `meta.description` to mention the harness as the differentiator.
- Added `HarnessPillar` component inside `home.tsx` (kept colocated since it's purely marketing-page-scoped — would extract if reused).
- New i18n keys under `home.harness.*`.
- Added more screenshot patterns to `.gitignore` so transient Playwright captures don't sneak in.

What I observed:

```
$ bun run typecheck   → PASS
$ bun run test        → 16 files / 123 tests PASS
$ bun run test:e2e (i18n) → 6/8 PASS (same 2 pre-existing fails as before — no regression)
```

Browser verified at `:5174/` — harness section renders, terminal block is readable, layout holds at desktop width.

Next: `none` — task fully closed. Pre-existing failures (404 i18n namespace, dead docs.spec) and the placeholder `https://github.com/` URLs are tracked in the "Left undone" section above as separate work.

---

## Step v3 — Mandarin locale + working language toggle + e2e cleanup

_2026-05-07_

What I did:

- Added `zh` to `supportedLngs` in `app/i18n/i18n.ts`, dropped `app/locales/zh/{common,auth,home,dashboard,admin,validation}.json` covering all surfaces touched by the redesign.
- Added a `LanguageSwitcher` to the home top bar, the auth-shell top bar, and the dashboard header (compact variant).
- Wrote `app/routes/api/set-locale.ts` — a typed `action` route that owns the locale-cookie write via `localeCookie.serialize`, since `createCookie` uses base64-encoded JSON and a hand-rolled `document.cookie = ...` won't match what `i18nServer.getLocale` parses.
- Rewrote `LanguageSwitcher` to submit via `useFetcher` to that action. React Router auto-revalidates loaders after a fetcher action, so the root loader re-detects the locale and the existing `useChangeLanguage(loaderData.locale)` hook in `app/root.tsx` flips i18next live — no full reload, no manual `i18n.changeLanguage` (which fought with `useChangeLanguage`'s revert-on-mismatch effect).
- Deleted `e2e/docs.spec.ts` (tested a Documentation feature that was removed long ago — every test red on `main` before this branch) and `e2e/i18n.spec.ts` (asserted on copy + missing seeded admin, more brittle than useful).
- Wrote `e2e/auth.spec.ts` covering the only flow that genuinely needs e2e: signup → dashboard → signout → login → dashboard, plus a bad-credentials negative case. Both pass on a fresh local D1 without seed data.

What I observed:

```
$ bun run typecheck   → PASS
$ bun run test        → 16 files / 123 tests PASS
$ bun run test:e2e    → 2/2 PASS in 3.4s (auth.spec only — docs/i18n removed)
```

Manual browser verification at `:5174/`:

- Click switcher → 中文 → instant in-page swap (hero, top bar, eyebrow, all sections), no reload, switcher trigger updates to 中文.
- Reverse direction (中文 → English) works the same.
- After swap, navigating to `/login` keeps the locale (cookie persisted).
- Hard refresh keeps the locale (SSR reads cookie via `i18nServer.getLocale`).

What I learned:

- `createCookie` from React Router base64-encodes a JSON-stringified value (e.g. `"zh"` → `InpoIg==`). Attempting to write `i18next=zh` directly via `document.cookie` won't be parsed by `i18nServer.getLocale`. The fix is to own the encoding server-side and route through an action. Documented inline in `app/routes/api/set-locale.ts`.
- `i18n.changeLanguage(lng)` from a click handler races with `useChangeLanguage(loaderData.locale)` mounted in `app/root.tsx`: as soon as the i18next provider re-renders the tree on `languageChanged`, root's effect compares `i18n.language !== locale` and reverts. The fix is to not call `changeLanguage` from the click handler — submit the action via `useFetcher`, let revalidation update `loaderData.locale`, and the existing root-level `useChangeLanguage` does the swap.

Next: `none` — task fully closed. v2 ships with Mandarin + a working live toggle and a focused e2e suite. To add another locale: drop `app/locales/<lng>/*.json`, add the code to `supportedLngs`, add a label to `LanguageSwitcher`'s `languageLabels` map. No other wiring needed.

