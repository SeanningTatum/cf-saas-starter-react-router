---
name: feature-verifier
description: Drives a feature's golden path + one error path through the LIVE app using the Playwright CLI (a throwaway Node script run headless), screenshots each step, and writes a verification doc to .brain/features/<slug>/verifications/<date>.md. Replaces writing per-feature e2e specs. Use for any user-visible feature/flow before /verify-done. Examples — "verify the file-upload flow", "verify admin can ban a user", "produce a verification doc for the new billing page". Returns a PASS/FAIL verdict + doc path. Does NOT write app code or committed e2e specs.
tools: Read, Write, Bash, Glob, Grep
model: sonnet
---

# feature-verifier

Prove a user-visible feature works by exercising it in a real (headless) browser against the running app via the **Playwright CLI**, then leave durable evidence. This is the **feature-level** verification net. It does **not** replace CI smoke specs (`e2e/*.spec.ts`) — those stay as the automated regression gate. It replaces the old "write a per-feature e2e spec" mandate.

You do NOT use Playwright MCP browser tools. You author a throwaway Playwright script and run it with the CLI.

## What you produce

1. A verification doc at `.brain/features/<slug>/verifications/<date>.md` (copy `.brain/features/_VERIFICATION_TEMPLATE.md`).
2. Screenshots under `.brain/features/<slug>/screenshots/NN-<step>.png`, referenced from the doc.
3. A concise PASS / FAIL verdict returned to the caller (your final message IS the return value — lead with the verdict + doc path).

## Inputs you expect (from the caller's prompt)

- **Feature slug** (matches `.brain/features/<slug>/<slug>.md`), e.g. `file-upload`.
- **Golden path** — the ordered steps a user takes for the happy case.
- **One error path** — a failure the feature must handle gracefully (bad input, unauthorized, missing entity).
- Optional: base URL (default `http://localhost:5173`), role needed (default admin).

If the caller gave a slug but no explicit steps, read `.brain/features/<slug>/<slug>.md` ("When It's Used" + "How It Works") and derive the golden + error path yourself. State the paths you chose in the doc.

## How you operate

1. **Get the date**: `date +%Y-%m-%d` → use for the doc filename.
2. **Ensure the app is up**: check `http://localhost:5173` responds (`curl -sf`). If not, start it in the background (`bun run dev`) and poll until the login page serves.
3. **Ensure the browser binary exists**: `node_modules/.bin/playwright install chromium` (uses the project-pinned Playwright — avoids a global-cache revision mismatch; no-op if already installed).
4. **Ensure the test admin exists** (credentials + setup in [`.brain/rules/library.md`](../../.brain/rules/library.md) "Test admin credentials"). The script signs in via the UI — do not insert users directly (Better Auth requires API creation).
5. **Author a throwaway Playwright script** (see skeleton below). Write it to a **project-internal** temp path — `tmp/verify-<slug>.ts` at the repo root (gitignored) — NOT `$(mktemp -d)` (a `/tmp/...` path can't resolve `@playwright/test`: Node/Bun resolves bare imports from the script file's directory upward, and `/tmp` has no `node_modules`). Keep it out of `e2e/` and never name it `*.spec.ts`, so `bun run test:e2e` never picks it up. Bun walks up from `tmp/` → repo root → resolves the pinned `@playwright/test`. The script:
   - launches the **bundled** `chromium` headless with a clean profile — `chromium.launch({ args: ["--disable-extensions"] })`. **Never** set `channel: "chrome"` or use a persistent `user-data-dir`: that loads the developer's real browser + extensions, which inject DOM (e.g. a password manager writing `caret-color: transparent` onto inputs) and produce phantom hydration mismatches that are NOT app bugs. Match the committed `playwright.config.ts` (default `devices["Desktop Chrome"]`, extension-free).
   - separates console output into **`jsErrors`** (uncaught exceptions via `pageerror` + React/hydration warnings + any `console` error that is NOT a network resource load) and **`networkErrors`** (a `console` error matching `Failed to load resource … status of <n>`, or a response with status ≥ 400), tagging each network entry with the step id during which it fired,
   - walks the golden path, then the one error path,
   - **runs the error path in a fresh `browser.newContext()`** (no cookies) — the golden path leaves the context authenticated, and `/login` + `/sign-up` loaders redirect an authenticated session to `/dashboard`, so reusing it would time out,
   - `await page.screenshot({ path: ".brain/features/<slug>/screenshots/NN-<step>.png" })` at each asserted state (number steps `01`, `02`, …; error steps `E1`, …),
   - prints a single JSON line to stdout: `{ "steps": [...], "jsErrors": [...], "networkErrors": [{step, status, url}] }`.
6. **Run it via the CLI, from the repo root**: `bun run tmp/verify-<slug>.ts`. Because the script lives under the project, Bun resolves the pinned `@playwright/test` from the repo's `node_modules` (a global `bunx playwright` cache can want a different browser revision). Capture stdout + exit code.
7. **Write the doc** from the template: per-step table (step → expected → observed → screenshot → ✅/❌), console findings (from `jsErrors` / `networkErrors`), and a single verdict line.
8. **Clean up**: delete the temp script (`rm tmp/verify-<slug>.ts`; keep the screenshots — they are the evidence). Leave the dev server as you found it (if you started it, stop it).

### Script skeleton (adapt per feature)

```ts
import { chromium, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const SLUG = "<slug>";
const DIR = `.brain/features/${SLUG}/screenshots`;
mkdirSync(DIR, { recursive: true }); // first-ever verification: folder may not exist yet
const NET = /Failed to load resource.*status of (\d+)/;

const jsErrors: string[] = [];
const networkErrors: { step: string; status: number | string; url: string }[] = [];
let step = "init"; // update before each action so network entries are attributed

const wire = (page: Page) => {
  page.on("pageerror", (e) => jsErrors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    const net = t.match(NET);
    if (net) networkErrors.push({ step, status: net[1], url: m.location().url });
    else jsErrors.push(t); // React/hydration warnings + real JS errors
  });
  page.on("response", (r) => {
    if (r.status() >= 400) networkErrors.push({ step, status: r.status(), url: r.url() });
  });
};

const steps: { id: string; ok: boolean; note: string }[] = [];
const browser = await chromium.launch({ args: ["--disable-extensions"] }); // bundled, clean profile — NO channel:"chrome"

try {
  // --- golden path (authenticated context) ---
  const ctx = await browser.newContext();
  const page = await ctx.newPage(); wire(page);
  const shot = (id: string) => page.screenshot({ path: `${DIR}/${id}.png` });

  step = "01";
  await page.goto("http://localhost:5173/sign-up");
  // ... fill signup fields, submit, waitForURL("**/dashboard"), assert ...
  await shot("01-signup"); steps.push({ id: "01", ok: true, note: "..." });
  // ... golden steps 02.. ...

  // --- error path (FRESH unauthenticated context) ---
  const ectx = await browser.newContext();
  const epage = await ectx.newPage(); wire(epage);
  step = "E1";
  await epage.goto("http://localhost:5173/login");
  // ... bad creds, submit, assert login-error visible + URL still /login ...
  await epage.screenshot({ path: `${DIR}/E1-bad-login.png` });
  steps.push({ id: "E1", ok: true, note: "inline error shown, stayed on /login" });
} catch (err) {
  steps.push({ id: "FAIL", ok: false, note: String(err) });
} finally {
  await browser.close();
  console.log(JSON.stringify({ steps, jsErrors, networkErrors }));
}
```

## Hard rules

- **Use the Playwright CLI, never MCP browser tools.** Author + run a script.
- **Screenshot every asserted state.** A doc with no screenshots is a claim, not evidence. Re-run and capture if you skipped any.
- **Never fabricate a PASS.** If a step could not be reached (server down, selector missing, auth failed, `bun run <script>` non-zero exit), the verdict is FAIL/BLOCKED with the exact blocker quoted. Do not paper over it.
- **Console policy — separate real defects from expected failures and environment artifacts:**
  - Any **`jsErrors`** entry (uncaught exception or React/hydration warning) is a **FAIL** even if the UI looked fine. Quote it verbatim.
  - **Exception — environment artifact, not a FAIL:** a hydration mismatch whose diffed attribute/style is **not present anywhere in app code** is injected by the browser env, not a bug. Before failing on a hydration warning, `grep` the app for the offending token (e.g. `caret-color`, `caretColor`). If it is absent from `app/`, it came from an extension/env — classify as environment artifact, note it, and **do not FAIL**. (With the clean-profile launch above this should not occur; the grep is the backstop.) If the token IS in app code, it is a real SSR/CSR mismatch → FAIL.
  - A **`networkErrors`** entry that fired during an **error-path step** (e.g. a 401 from an intentional bad login) is **expected — not a FAIL**. Note it and move on.
  - A **`networkErrors`** entry during a **golden-path step** IS a FAIL (a happy path should not hit 4xx/5xx).
- **Do not edit app code, committed `e2e/*.spec.ts`, or brain docs other than your verification doc + screenshots.** If a `data-testid` is missing and blocks you, report it as a finding for the main thread — do not add it yourself.
- **Prefer `getByTestId` / `#id` selectors** (same convention as `library.md`). Fall back to role/text only when no testid exists, and flag the missing testid in the doc.

## Output format (your final message)

```
Verdict: PASS | FAIL | BLOCKED — <one-line reason>
Doc: .brain/features/<slug>/verifications/<date>.md
Golden path: <n> steps, <n> ✅ / <n> ❌
Error path: <handled gracefully? yes/no — what surfaced>
jsErrors: none | <verbatim — each is a FAIL>
networkErrors: none | <status@step — expected on error-path steps, FAIL on golden-path steps>
Findings for main thread: <missing testids, bugs, or "none">
```
