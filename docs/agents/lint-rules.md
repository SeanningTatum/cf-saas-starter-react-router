# House lint rules

The house linter holds every rule a built-in linter cannot state. It reads the TypeScript syntax tree, so a rule sees `throw`, an import or a comment however it is spelled. A rule that needs judgment stays in [`AGENTS.md`](../../AGENTS.md); a rule a tool can check lives here, and its finding says what to write instead.

## Commands

```bash
bun run lint:house                 # the whole repo, with the baseline and the shrink-only check
bun run lint:house app/lib/foo.ts  # only these files; under a second, for an edit hook or a commit hook
bun run lint:house --rules         # print the rule table below
bun run lint:house --selftest      # run every rule's cases
bun run lint:house --write-docs    # rewrite the table in this page
bun run lint:house --check-docs    # fail when the table is stale (the harness gate runs this)
```

The `non-negotiables` and `non-negotiables-selftest` gates in `scripts/verify.sh` run the first and the fourth through `scripts/check-non-negotiables.ts`, a four-line entry kept so older briefs still work.

Every finding is one line:

```
path:line rule-id: what is wrong. Do this instead: what to write. See a/file/with/the/right/shape.ts.
```

Exit codes: 0 clean, 1 findings, 2 a bad option or a named file that does not exist. A named file that is not `.ts` or `.tsx` is skipped, so a hook can pass every changed path.

Naming files does not hide a finding that lands elsewhere: a rule that compares files says which other files each finding depends on, and the finding is kept when any of them is named. Edit `app/lib/effect-trpc.ts` so an error loses its mapping, and `bun run lint:house app/lib/effect-trpc.ts` reports the error class.

## The rules

This table is generated from `scripts/lint/rules/`. Do not edit it by hand; run `bun run lint:house --write-docs`.

<!-- lint-rules:start -->
| Rule | Non-negotiable | What it matches | Files it reads | Do this instead | Example |
|------|----------------|-----------------|----------------|-----------------|---------|
| `external-call-span` |  | An `Effect.tryPromise` (an awaited call to D1, R2, Better Auth or another service) that is not piped into `Effect.withSpan`, directly, through `Effect.gen(...).pipe(...)`, or through a local helper that makes the span. | `app/repositories/`, `app/services/` and `app/lib/effect-utils.ts`, except tests. The span exporter is a boundary. | pipe the call into a client span, `.pipe(Effect.withSpan("<service>.<operation>", { kind: "client" }))`, with the name in `app/lib/constants/spans.ts`, so a slow or failed outside call shows in the trace | `app/repositories/bucket.ts` |
| `no-effect-promise` | 1 | A call to `Effect.promise`, under any name the Effect module is imported as. A rejection there skips the error channel. | `app/` and `workers/`, except tests. | use `Effect.tryPromise({ try, catch })` so a rejection becomes a tagged error. Only when the promise cannot reject, keep the call and write `// effect-promise-ok: <why it cannot reject>` on the line above it | `app/repositories/bucket.ts` |
| `no-process-env` | 5 | A read of `process.env` in any spelling: `process.env`, `process["env"]`, `globalThis.process.env`, or `const { env } = process`. | `app/` and `workers/`, except tests. | a Worker has no `process`. In an Effect, read the binding with `const env = yield* CloudflareEnv` from `app/services/cloudflare.ts`; in a loader or action, read `context.cloudflare.env` | `app/services/database.ts` |
| `no-throw` | 1 | A `throw` statement outside an `Effect.try` or `Effect.tryPromise` callback. | `app/` and `workers/`, except tests and the ShadCN primitives in `app/components/ui/`. | return `Effect.fail(new SomeError({ … }))` with a tagged error class from `app/models/errors/`, or wrap the call that can fail in `Effect.tryPromise({ try, catch })`. In a loader or action, `throw redirect(…)` and `throw data(…)` imported from `react-router` are allowed | `app/repositories/bucket.ts` |
| `no-try-catch` | 1 | A `try` statement outside an `Effect.try` or `Effect.tryPromise` callback. | `app/` and `workers/`, except tests and the ShadCN primitives in `app/components/ui/`. | wrap the call that can fail in `Effect.tryPromise({ try: () => call(), catch: (cause) => new SomeError({ cause }) })` and handle the failure with `Effect.catchTag` | `app/repositories/bucket.ts` |
| `no-zod` | 2 | Any load of `zod` or a `zod/…` subpath: an `import`, a `require()` or a dynamic `import()`. | `app/` and `workers/`, except tests. | write the schema with Effect Schema: `import { Schema } from "effect"`, then `Schema.Struct({ … })` and `Schema.decodeUnknown(…)` | `app/lib/schemas/user.ts` |
| `procedure-span` |  | A tRPC `.query`, `.mutation` or `.subscription` whose handler never reaches `runProcedure` or is passed by reference, a `runProcedure` call with no `span` option, or a literal span name that does not start with "trpc.". | `app/trpc/routes/`, subfolders included, except tests. | write the handler inline and run it through `runProcedure(ctx.runtime, effect, { span: "trpc.<router>.<procedure>" })`, which adds the server span every log line and query of the procedure hangs from | `app/trpc/routes/health.ts` |
| `tagged-error-mapped` | 3 | A `Data.TaggedError` class in `app/models/errors/` whose runtime tag has no `case` or `_tag ===` branch inside the mapper in `app/lib/effect-trpc.ts`. | `app/models/errors/` against `app/lib/effect-trpc.ts`. | add the tag to `APP_ERROR_TAGS` and a `case "<Tag>":` that returns a `TRPCError` to the switch in `appErrorToTRPC` in app/lib/effect-trpc.ts | `app/lib/effect-trpc.ts` |
| `test-map` | 4 | A source file that matches no entry in `scripts/lint/test-map.json`, or whose kind's proof is missing: `unit` a `__tests__/<name>.test.ts` that imports it and asserts; `machine` that and an `e2e/<name>.paths.spec.ts`; `procedure` a `LEVELS` entry and a test that calls it through the router; `route` an e2e spec that holds a `@golden` and an `@error` test and visits its path; `component` and `primitive` a sandbox entry; `declaration` no code that runs; `spec-helper` an e2e spec that imports it; `covered-by` a named test that exists and asserts. Also a source file that imports test support. | Every `.ts` and `.tsx` file under `app/`, `workers/`, `scripts/`, `e2e/`, except tests, e2e specs and unit-test helpers. | give the file the proof its kind names; `scripts/lint/test-map.json` says which kind each folder is |  |

Checks on the baseline file itself:

| Check | What it matches | Do this instead |
|-------|-----------------|-----------------|
| `baseline-grew` | An entry, a count or the suppression total in the baseline is higher than on the branch this one merges into. | fix the code the entry excuses and take the entry back out; a baseline only shrinks |
| `baseline-stale` | A baseline entry excuses more than the code now holds: the file is clean, gone, or has fewer findings than the count. | lower the count to what the linter finds, or delete the entry when it finds nothing |
| `baseline-shape` | The baseline cannot be read, names a rule that does not exist, or has no `debt` key for a rule that does. | keep `suppressions`, `boundaries` and `debt` in the file, with one `"<rule-id>": {}` key under `debt` for every rule |
| `baseline-base` | The baseline to compare with cannot be read: in CI the base branch is missing, or the base holds the linter with no baseline, or its baseline does not parse. | set `fetch-depth: 0` on the checkout step of the job that runs this gate, so git has the base branch |
<!-- lint-rules:end -->

## Add a rule

One new file, `scripts/lint/rules/<id>.ts`, and nothing else to register: the runner loads every file in that folder. The file exports `rule`, and the file name is the rule's id.

```ts
import { inApp } from "../cases";
import { isShippedSource, lineOf, walkNodes } from "../source";
import type { FileHit, FileRule } from "../types";

export const rule: FileRule = {
  id: "no-example",
  scope: "file",
  matches: "What the rule matches, in one sentence.",
  covers: "Which files it reads.",
  fix: "what to write instead, for a reader who has not read AGENTS.md",
  example: "app/a/file/that/shows/the/right/shape.ts",
  applies: isShippedSource,
  check({ ast }) {
    const hits: FileHit[] = [];
    walkNodes(ast, (node) => {
      if (isWrong(node)) hits.push({ line: lineOf(ast, node), message: "what is wrong here" });
    });
    return hits;
  },
  cases: [
    { name: "the wrong shape is caught", files: inApp("…"), expect: "finding" },
    { name: "the right shape is clean", files: inApp("…"), expect: "clean" },
  ],
};
```

- **`scope: "file"`** rules get one parsed file at a time; `applies(path)` says which files. **`scope: "repo"`** rules get the whole tree through `repo.files(dir)` and `repo.source(path)`, for a rule that relates one file to another (`tagged-error-mapped`, `test-map`). In file mode a repo rule is also handed the named files, so it can stop at them.
- **Cases are the rule's test.** Each case is a small tree of files held in memory and what the rule should say about it. The self-test fails a rule with no `fix`, no "finding" case, no "clean" case, an `example` path that does not exist, or a finding that does not print in the house shape. Write a case for each way round the rule that you can think of; a bypass found later becomes a new case.
- A hit can carry its own `fix` and `example` when the rule's general ones would not help.
- Then: add `"<id>": {}` under `debt` in `scripts/lint/baseline.json`, run `bun run lint:house --write-docs`, and run `bun run lint:house`. If the repo already breaks the new rule, list today's findings under that key in the same pull request; that is the only time a baseline may gain entries.
- To let a rule take a comment that excuses one line, set `suppressionMarker: "some-marker:"`. See below.

## The test map

`scripts/lint/test-map.json` gives every `.ts` and `.tsx` file under `app/`, `workers/`, `scripts/` and `e2e/` a kind, and the `test-map` rule checks the proof that kind names. Entries are ordered globs; the first match wins, so a narrow entry goes above a broad one. Tests and their helpers (`__tests__/`, `*.test.ts`, `*.test-layer.ts`) and e2e specs (`*.spec.ts`) need no entry.

| Kind | The proof the rule looks for |
|------|------------------------------|
| `unit` | `__tests__/<name>.test.ts` (or `.test.tsx`) beside the file, which imports the file with a real import and asserts. A file with no logic of its own (types, re-exports, constants that hold only literals) needs none. |
| `machine` | The unit test, and `e2e/<name>.paths.spec.ts` that imports the machine or its `.model` and asserts. |
| `procedure` | Each procedure has its `<router>.<name>` entry in `LEVELS` in `app/trpc/__tests__/router.test.ts`, and `__tests__/<name>.test.ts` beside the router imports the app router, calls one of the procedures as `<caller>.<router>.<name>()` and asserts. |
| `route` | The file is in `app/routes.ts`, and one e2e spec holds a `@golden` and an `@error` test, asserts, and calls `page.goto` on its path. A path with a parameter is matched by a concrete URL (`/users/7` for `/users/:id`), unless that URL is another registered page. The rule does not check which test in the spec makes the visit. A layout takes the path it wraps. |
| `component`, `primitive` | A file under `app/routes/sandbox/` imports it. The sandbox arrives with #135; until then today's files are in the baseline, and a new one needs an e2e spec that exercises it, named by a `covered-by` entry. |
| `declaration` | The file holds no code that runs. |
| `spec-helper` | An e2e spec imports it. For shared helpers under `e2e/lib/`, which vitest does not run. |
| `covered-by` | The entry names a `test` (a unit test or an e2e spec in this repo) that exists and asserts, and gives a `reason`. For entry points and config. The rule cannot check that the test exercises the file: the reason is what a reviewer reads. |

A file that matches no entry fails as unclassified, and the finding says where to add it: a new folder is a choice, not a gap. An entry that matches no file fails too, so the map holds no dead rows. A source file that imports from a test path fails as well, since no rule reads code that lives there.

A finding is cleared by writing the proof. A new map entry, a `covered-by` or a wider glob is a change to the rule for that file: make it only when the kind was wrong, and say why in the pull request. A weak test is reported on the test file's own path, and every finding names the proof files it depends on, so naming only a test, a spec, the map or the route table in `bun run lint:house <files>` still finds what that edit broke.

## The baseline

`scripts/lint/baseline.json` is the one list of what the linter excuses. It has three parts:

| Key | Holds | Meaning |
|-----|-------|---------|
| `debt` | `rule → file → count` | Findings that predate the rule. The count is exact. |
| `boundaries` | `rule → file → reason` | Files where the rule is off by design, each with its reason. Today: the two files where tRPC needs a thrown error. |
| `suppressions` | a number | How many suppression comments the code holds. |

A baseline only shrinks. The gate fails when:

- a file has more findings than its count (`path:line` findings, each noting the count allowed);
- an entry excuses more than the code holds (`baseline-stale`): fix one finding and you must lower the count, so the room cannot be used again;
- an entry, a count or the suppression total is higher than on the branch the work merges into (`baseline-grew`), even when every entry applies. Editing the file by hand to make room does not pass.

The comparison is with the merge base. The base branch comes from `GITHUB_BASE_REF` in CI; else from the pull request's target (`git config branch.<name>.gh-merge-base`, then `gh pr view`); else from the default branch (`origin/HEAD`). It works offline: `gh` is the only step that uses the network, and when it fails the next source is tried. With no base to be found, the gate says so and still checks that every entry applies. In CI the base is required: a job that cannot read it fails with `baseline-base`, and the fix is `fetch-depth: 0` on its checkout step. A base that holds the linter but no baseline, or a baseline that does not parse, fails the same way.

A rule that is new on a branch may bring its own entries, since the base has no key for it. A new boundary under an existing rule is the owner's call: the gate stays red on that pull request, and the owner merges it knowingly.

## Suppression comments

One exists today: `// effect-promise-ok: <why the promise cannot reject>`, on the line of an `Effect.promise` call or the line above it. The rules for every such marker:

- It is read only from a comment, and the comment must start with it. The same text in a string is ordinary code.

- It needs a reason. A marker with nothing after the colon excuses nothing and is itself a finding.
- It excuses the lines its comment is on and the one after, no further.
- A marker that excuses nothing is a finding, so none is left behind.
- Each one counts toward `suppressions` in the baseline, and that total cannot rise.
