A git commit is about to run. Update the brain docs in this repo so they reflect the staged changes before the commit fires.

Steps:

1. Run `git diff --cached --stat` and `git diff --cached` to see what is being committed.
2. Read `CLAUDE.md` (specifically the "When you change something — update the brain" table) to determine which brain files apply.
3. Read the relevant existing files before editing. Brain folders that exist today: `.brain/high-level-architecture/`, `.brain/codebase/`, `.brain/rules/`, `.brain/features/`, `.brain/transcripts/`, `.brain/emails/`, plus `.brain/CHANGELOG.md`. Do NOT invent `.brain/agents/`, `.brain/skills/`, or `.brain/plans/` — they do not exist (those live in shared Claude Code plugins).
   - `.brain/high-level-architecture/index.md` and any architecture / integration / data-model / security / user-journey doc the diff touches (system-level shifts: bindings, DB schema, auth/RBAC, third-party integrations, request lifecycle, role gates)
   - `.brain/codebase/index.md` and the relevant doc when the diff touches `app/lib/**`, `app/trpc/**`, `app/db/schema.ts`, `app/i18n/**`, schemas, helpers, or tests:
     - `codebase/api.md` — new/changed tRPC procedures, route table, request/response shapes
     - `codebase/effect-ts.md` — programming-model changes, new tagged-error mappings
     - `codebase/i18n.md` — namespaces, supported locales, key-file changes
     - `codebase/testing.md` — test-pattern shifts, new stub layers
     - `codebase/features.md` — high-level overview map (also update the per-feature file)
   - `.brain/features/index.md` AND the per-feature file(s) under `.brain/features/<slug>.md` for any feature being modified. For a new feature: copy `.brain/features/_TEMPLATE.md` to `<slug>.md`, fill it out, and **register a row in `.brain/features/index.md`**.
   - `.brain/CHANGELOG.md` for architectural shifts, brain restructures, decisions reversed, or external-constraint changes (NOT for routine code commits — `git log` is the code changelog).
   - Any `.brain/rules/*.md` doc whose layer was touched. The 7 layers (verify before editing): `frontend.md`, `cloudflare.md`, `repository.md`, `services.md`, `routes.md`, `library.md`, `errors.md`. Each layer's "Source-of-truth files" list at the top tells you which `app/**` paths map to it.
4. When updating `rules/*.md` examples or `codebase/*.md` references that name a specific symbol, file, or method: verify the name against the staged diff or the current source. Do not paste invented function names. The brain's value is that every cited identifier is real.
   - For each new symbol you cite (function, class, method, file path, error tag, env var, table name): run `grep -nE "<symbol>" app/ workers/ wrangler.jsonc` (or read the file) to confirm it exists. If it doesn't, either remove the citation or mark it as illustrative ("example shape" / "generic pattern").
   - When you cite a real method's signature or return shape, paste it from source — don't paraphrase. If you do paraphrase for brevity, prefix the snippet with `// shape (paraphrased)` so future readers know it's not source-of-truth.
5. Edit only the files that genuinely need updates based on the staged diff. Do not invent changes. Do not touch unrelated docs. Match the existing tone/format of each file.
6. If the diff introduces a known limitation (missing auth gate, missing validation, etc.) document it under the relevant feature's "Known gaps" section AND under `high-level-architecture/security.md` "Known gaps" if security-relevant — do not silently let it ship undocumented.
7. If nothing in the diff warrants a brain update (e.g. pure formatting, lockfile bump, dependency-only change, comment tweak, test-only refactor), do not edit anything — just report "no brain update needed".
8. Do NOT run `git add`, do NOT amend the commit, do NOT block the commit. Your edits will be left in the working tree for the user to stage and include in a follow-up commit if they want.

Return a one-paragraph summary of which brain files you updated (or "no brain update needed") and why.
