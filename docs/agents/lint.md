# Lint, format, dead code and types

One command checks all of it and prints one finding per line:

```bash
bun run lint                 # the whole repo: Biome, the house linter, import cycles, dead code
bun run lint app/lib/x.ts    # some files: Biome and the house linter (its per-file mode) only
bun run lint --fix <files>   # the same, after Biome formats them and applies its safe fixes
bun run lint:staged          # the staged files (for a commit hook)
bun run format               # format every file Biome covers
```

A finding reads `path[:line[:column]] rule: message`, where the rule is `lint/<group>/<rule>` (Biome), `house/<id>` (the house linter) or `knip/<kind>` (dead code). Exit 0 is clean, 1 means findings, 2 means a tool could not run. A tool that could not run is a failure, never a pass.

`./scripts/verify.sh` runs `bun run lint` as the `lint` gate, in the lean tier, so every CI job that runs gates has it. `./scripts/verify.sh --changed` runs it on the changed files.

## Where a rule lives

1. **Biome** ([`biome.jsonc`](../../biome.jsonc)) when one of its built-in rules states the rule exactly.
2. **The house linter** (`scripts/lint/`, `bun run lint:house`; [`lint-rules.md`](lint-rules.md)) when it needs the TypeScript compiler or the repo's own layout: tagged-error mapping, the test map, `throw` and `try/catch`, comments, constants, file size.
3. **Never both**, and never as prose in `AGENTS.md` or an agent brief once a tool checks it.

Two rules were in both and now have one home, chosen by running the house rule's own cases through Biome:

| Rule | Home | Why |
|------|------|-----|
| No Zod | Biome, `style/noRestrictedImports` (a path for `zod` and a pattern for `zod/**`) | With the pattern, Biome flags all six of the house rule's "finding" cases (static, dynamic and `require` loads, subpaths included) and neither "clean" case. The house rule `no-zod` is deleted. |
| No `process.env` | The house linter, `no-process-env` | Biome's `noProcessEnv` misses `const { env } = process` and `const { env: e } = process`, two of the house rule's cases. Biome's rule is off. |

No ESLint and no Oxlint: a second general linter would mean a second parser and config for rules the two above already cover.

## What Biome enforces

On top of its recommended set (which includes the accessibility rules for JSX):

| Rule | Where | Built-in |
|------|-------|----------|
| No `any` | everywhere | `suspicious/noExplicitAny` |
| No non-null `!` | everywhere | `style/noNonNullAssertion` |
| No default export | everywhere except where the framework loads one: route modules, `app/root.tsx`, `app/routes.ts`, `app/entry.server.tsx`, `workers/app.ts`, `*.config.ts` | `style/noDefaultExport` |
| No barrel file, no `export *` | everywhere | `performance/noBarrelFile`, `performance/noReExportAll` |
| No import cycle | whole-repo runs only (see below) | `suspicious/noImportCycles` |
| Kebab-case file names | everywhere except React Router's `*.$.ts` splat routes | `style/useFilenamingConvention` |
| No unused import or variable | everywhere | `correctness/noUnusedImports`, `correctness/noUnusedVariables` |
| No `dangerouslySetInnerHTML` | everywhere | `security/noDangerouslySetInnerHtml` |
| No Zod, subpaths included | everywhere | `style/noRestrictedImports` |
| One icon set (`lucide-react`) | everywhere; ten older files are listed in `biome.jsonc` and that list only shrinks | `style/noRestrictedImports` |
| Cognitive complexity of a function at most 15 | everywhere but the ShadCN primitives; 29 files listed in `biome.jsonc` held a function over 15 when the rule came in, and that list only shrinks | `complexity/noExcessiveCognitiveComplexity` |
| No bare number inline | `app/`, `workers/`; not in tests, `e2e/`, `app/lib/constants/` (where numbers are named) or the ShadCN primitives; 21 files listed in `biome.jsonc` held one when the rule came in, and that list only shrinks | `style/noMagicNumbers` |
| A provider SDK stays in its adapter | `posthog-js` and `posthog-node` outside `app/lib/analytics/adapters/` | `style/noRestrictedImports` |
| A primitive never reads the data layer | `app/components/ui/` may not import `@/db`, `@/repositories`, `@/services`, `@/trpc`, `@/auth` or `drizzle-orm` | `style/noRestrictedImports` |
| No `console` | `app/`, `workers/`, `workflows/`; the two lines of the logger's sink in `app/lib/log-format.ts` carry a `biome-ignore` with the reason | `suspicious/noConsole` |
| Hooks rules | `app/`, `workers/`, `workflows/` | `correctness/useExhaustiveDependencies`, `correctness/useHookAtTopLevel`, the `react` domain |
| No skipped or focused test | test files and `e2e/` | `suspicious/noSkippedTests`, `suspicious/noFocusedTests`, the `test` domain |
| Playwright rules (no `waitForTimeout`, no `networkidle`, no `page.pause`, no forced clicks, awaited calls) | `e2e/` | the `playwright` domain |

To add a provider SDK, add its package to `noRestrictedImports` in `biome.jsonc` and allow it in the override for its adapter folder. To move a file to the one icon set, change its imports and delete its line from the list.

### Left out, and why

| Path | Why |
|------|-----|
| `app/components/ui/**` | ShadCN primitives: `shadcn add` writes them. Only the import boundary above is checked. They are still formatted. |
| `.claude/workflows/`, `.claude/workflow-src/` | Built files, and sources that are script bodies (top-level `return`), which Biome cannot parse. |
| `worker-configuration.d.ts`, `drizzle/`, `skills-lock.json`, `plans/` | Written by a tool. |
| `*.md`, `*.yml` | Prose and pipelines. Reflowing an agent brief changes a prompt, and tests read the workflow files as text. |

### Import cycles

`noImportCycles` needs the whole module graph. Biome builds that graph on every call when the rule is on in the config, which costs one to three seconds even for one file. So the rule is not listed in `biome.jsonc`; `bun run lint` runs it by name over the whole repo. The gate has it; the edit hook and a scoped run do not.

### Suppressing one line

```ts
// biome-ignore lint/a11y/useSemanticElements: <the specific reason>
```

A reason is required, on the same line: the house linter's `no-comments` rule allows this one form, at most 160 characters. Prefer fixing the code. Scripts are the exception for one rule: `noTemplateCurlyInString` is off in `scripts/`, which holds GitHub Actions `${{ }}` and shell `${VAR}` text on purpose.

## Format

Biome formats TypeScript, JavaScript, JSON and CSS: two spaces, double quotes, semicolons, trailing commas, 100 columns, 160 in `scripts/`. The `lint` gate fails on a file that is not formatted. The whole repo was formatted in one commit by one command, `bunx biome format --write .`; that commit is listed in `.git-blame-ignore-revs` (`git config blame.ignoreRevsFile .git-blame-ignore-revs` makes `git blame` skip it; GitHub reads the file on its own).

Two choices keep the formatter and the house linter's 400-line cap (`file-size`, whose baseline only shrinks) from fighting:

- `scripts/` is formatted at 160 columns. The scripts are dense (long test titles, command lines, tables of cases); at 100 columns the formatter grew 19 of them past the cap.
- Six files that would still grow past their recorded length are left out of the formatter by name (`formatter.includes` in `biome.jsonc`). Split one, then delete its line.

## The edit hook

[`.claude/hooks/lint-edit.sh`](../../.claude/hooks/lint-edit.sh) runs after every `Edit` and `Write` (a `PostToolUse` hook in `.claude/settings.json`). It runs `bun run lint --fix` on the one file, which is Biome and the house linter in its per-file mode: the file is formatted, safe fixes are applied, and what is left goes back to the agent on stderr with exit 2. A clean file is silent. With no `jq`, no `bun` or no installed tools it does nothing. It finds the checkout from the edited file, so it works in a git worktree.

## Dead code

[knip](https://knip.dev) ([`knip.json`](../../knip.json)) fails the gate on a file nothing imports, an export nothing imports, and a package nothing uses or that is used but not listed. Scripts in `scripts/` and `scripts/ci/` and the e2e specs are entry points. `app/components/ui/**` is ignored: a primitive exports parts the app may not use yet.

## Types

`bun run typecheck` builds three projects:

| Project | Covers |
|---------|--------|
| `tsconfig.cloudflare.json` | `app/`, `workers/` |
| `tsconfig.node.json` | the root `*.config.ts` files |
| `scripts/tsconfig.json` | `scripts/` (its own project, not a reference, because two scripts import app files; listing those files in a referenced project breaks the Effect language service below) |
| `e2e/tsconfig.json` | `e2e/` (its own project because the specs import app and worker code) |

All three have `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride` and `noFallthroughCasesInSwitch`.

## Effect diagnostics

`bun run lint:effect` runs the Effect language service over `app/` and `workers/` (floating effects, untyped failures and more). It takes about 20 seconds, so it is not a local gate. CI runs it as its own job, `Effect diagnostics`, on a pull request into the default branch or `production`, beside the other jobs, so it costs no wall time; it fails on an error, not on a warning or a message. Run it yourself when you touch Effect code. The same plugin is set in `tsconfig.cloudflare.json`, so an editor that loads TypeScript plugins shows the diagnostics live.
