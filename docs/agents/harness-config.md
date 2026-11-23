# harness.config.json

The one file of values that belong to a project, not to the harness. Scripts and workflows read it where they once held a literal.

## Why it sits at the repo root

[ADR 0001](../adr/0001-harness-delivery.md): the shared harness reaches a project as committed files that `sync` copies. `harness.config.json` is on the list of what stays in every project, so `sync` never writes it. Nothing the harness copies may hold a value that is one project's: it reads this file.

- A project with no file gets the defaults below. They name no path under `app/` and nothing about this starter's product.
- An unknown key anywhere in the file is an error, so a typo cannot pass in silence.
- A workflow script cannot read a file. Its first agent call, labelled `config`, runs `bun scripts/harness-config.ts show` from the checkout and returns the one line it prints as `config_json`, a string. That call is a step of its own: no ticket text or file name from the tree shares it, and the Preflight step that follows names the configured files (the product and design docs, the base branch). All three workflows make the call through `loadConfig` in `.claude/workflow-src/lib.js`. It calls `readConfig`: it parses the line, recomputes the checksum over the stable JSON of `config` and compares it with `check`. A line the runner garbled stops the run at Preflight with "the config copy did not verify; run the workflow again". The script then reads every project value as `cfg.<key>`; a key the workflow needs and the file lacks (undefined, null or an empty string) stops it with `harness-config: set <key> in harness.config.json`. An empty list is a value, not a missing key; a workflow that cannot run on one says so itself. `show` leaves `seedLogins` out, because no workflow reads it and the line lands in a run's journal; its checksum covers what it prints. The build never pastes config values into `.claude/workflows/*.js`.
- Folders are held in one form. The loader strips a leading `./`, repeated slashes and any trailing slash from every setting that names a folder, so `src/pages/` and `src/pages` load alike. A reader that compares a path adds the `/` itself and compares whole path segments, so `appRoot: "src"` does not take `src-tools/x.ts`. The folder settings are `paths.sourceRoots` (each entry), `components`, `primitives`, `routes`, `locales`, `schemas`, `hooks`, `trpc`, `repositories`, `appRoot`, and `docs.adr` and `docs.features`. A folder setting that is empty or `.` is an error. Every other path (`tokens`, `rootLayout`, `home`, `analytics`, `analyticsEvents`, `routeTable`, `docs.product`, `docs.design`, `docs.glossary`) names a file and is kept as typed. `scratchDirs`, `ship.sharedFiles[].path` and `brandInit` fences keep the spelling you give them, because `scripts/stack.ts` and the fence tests read a trailing `/` as "this is a folder".
- A grep gate keeps the harness code free of project paths: check N in `scripts/harness-check.sh` fails when a harness code file holds a literal path that starts with `app/`. It does not cover this file, tests and fixtures, the agent briefs in `.claude/agents/`, or the app's own scripts (seeding, first-time setup, teardown, CI helpers, the linters).
- The file is JSON and has no comments.

## Keys

A key with no default is empty. A consumer that needs it fails with a line that names the key: `harness-config: set gates in harness.config.json`.

| Key | Type | Default | Read by |
|---|---|---|---|
| `version` | `1` | `1` | the loader |
| `baseBranch` | string or null | `null` (the repo's default branch) | the workflows: `input.base`, then this, then the branch's own fallback |
| `coauthor` | string | `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>` | the workflows, on each commit trailer |
| `scratchDirs` | list of strings (a trailing `/` marks a folder) | `[".verify/", "tmp/"]` | `scripts/stack.ts`: the `exclude` of a plan that has none |
| `gates` | list of gate objects | none | `scripts/verify.sh` |
| `tracker` | object | see below | `scripts/tracker.ts` |
| `reviewBot` | object | see below | `scripts/pr-review-wait.ts` |
| `docs` | object | see below | the workflows |
| `loginForm` | object | see below | `scripts/design-audit.ts` |
| `seedLogins` | map of name to `{ email, password }` | none | `scripts/design-audit.ts` |
| `paths` | object | none | the workflows, `scripts/harness-check.sh` |
| `ship` | object | none | `ship-feature` |
| `brandInit` | object | none | `brand-init` |
| `wave` | object | see below | `run-wave` and `scripts/wave.ts` |

### `gates`

One object per gate, in run order. `scripts/verify.sh` runs them; `bun scripts/harness-config.ts gates` prints one `name|run|tier|limitSeconds` line each. `name` and `run` must not hold a `|` or a line break, because that line is how bash reads them.

| Key | Type | Meaning |
|---|---|---|
| `name` | string | What `--only` takes |
| `run` | string | The shell command |
| `tier` | `lean`, `baseline` or `full` | The smallest run the gate is in. `--lean` runs the `lean` gates, `--baseline` the `lean` and `baseline` ones, the bare run all three. `--changed` builds its own list and reads only the limit from here |
| `limitSeconds` | positive integer | Time limit; the gate is killed past it |

### `tracker`

| Key | Type | Default | Meaning |
|---|---|---|---|
| `readyLabel` | string | `ready-for-agent` | The label on issues an agent may pick up; `bun scripts/tracker.ts ready` lists them |

### `reviewBot`

| Key | Type | Default | Meaning |
|---|---|---|---|
| `login` | string | `greptile-apps` | A review counts when its author's login starts with this; case does not matter |
| `summaryMarker` | string | `<!-- greptile_summary -->` | Marks the bot's summary comment |
| `trigger` | string | `@greptileai review` | The comment that asks for a review |

### `docs`

| Key | Type | Default |
|---|---|---|
| `product` | string | `PRODUCT.md` |
| `design` | string | `DESIGN.md` |
| `glossary` | string | `GLOSSARY.md` |
| `adr` | string | `docs/adr` |
| `features` | string | `docs/features` |

### `loginForm`

| Key | Type | Default |
|---|---|---|
| `path` | string | `/login` |
| `emailTestId` | string | `login-email` |
| `passwordTestId` | string | `login-password` |
| `submitTestId` | string | `login-submit` |

`bun run design:audit -- --login <name>` signs in as `seedLogins.<name>`; `--login <email:password>` still works. An unknown name fails with a line that lists the names.

### `paths`

All optional. Each is a path from the repo root. Folder settings load without a trailing slash (see above).

| Key | Type | Meaning |
|---|---|---|
| `sourceRoots` | list of strings | Folders that hold the project's source |
| `tokens` | string | The design tokens file |
| `rootLayout` | string | The root layout |
| `components` | string | Shared components |
| `primitives` | string | The primitive components folder |
| `routes` | string | Route files |
| `home` | string | The home route |
| `locales` | string | Translation files |
| `schemas` | string | Effect Schema files |
| `analytics` | string | The analytics service |
| `analyticsEvents` | string | The analytics event list |
| `appRoot` | string | The folder of app code: `brand-init` edits only under it, and `ship-feature` names it in its prompts |
| `hooks` | string | React hooks (a UI path to `ship-feature`) |
| `routeTable` | string | The route table file (a UI path to `ship-feature`) |
| `trpc` | string | tRPC procedures |
| `repositories` | string | Repositories |

### `ship`

| Key | Type | Meaning |
|---|---|---|
| `sharedFiles` | list of `{ path, owner }` | A file or folder every feature may touch, and the lane that owns it when no PR's fence names it |

`path` is a repo path. `owner` is a regular expression source: the shared file goes to the first PR whose fence holds a path that matches it.

### `brandInit`

| Key | Type | Meaning |
|---|---|---|
| `contractFence` | list of strings | The files the contract lane writes (tokens file, root layout) |
| `primitiveLanes` | list of `{ name, motion, files }` | The primitive lanes. `files` are names under `paths.primitives` without `.tsx`; `motion` is true when the lane owns something that moves. Every primitive file is in exactly one lane (`harness-check.sh`, check I2) |
| `sharedLanes` | list of `{ name, motion, owns, sequential? }` | Lanes that own named files or `folder/**` globs, in run order. A lane with `sequential` set to true runs alone after the parallel lanes, because it imports what they write (the wordmark); with none, that step is skipped. The first lane without the flag also writes the typeset wordmark. A lane's name is only a label: nothing looks a lane up by name |
| `homeLane` | `{ name, motion, owns }` | The lane that runs only when the home page is rebuilt |

`owns` is a list of repo paths; a path ending in `/**` owns the folder.

### `wave`

Settings for the `run-wave` workflow ([how to run a wave](harness.md#running-a-wave)). A wave freezes `tracksAtOnce` and `reviewRounds` into its state file when it is planned, so a change here applies to the next wave.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `tracksAtOnce` | integer, 1 to 8 | `2` | How many tickets a batch builds at once (this repo sets 3). `args.tracks` may lower it for one wave, never raise it |
| `reviewRounds` | integer, 0 to 3 | `1` | Review rounds per ticket PR. A P0 or P1 in the last round earns one more round, never more |
| `models` | object | see below | The model for each kind of work. A model name is lower-case letters, digits, dots and dashes |

| `models` key | Default | The work |
|---|---|---|
| `plan` | `opus` | Reading the tickets into the plan |
| `design` | `opus` | A ticket the planner marks design-heavy, and its fixes |
| `build` | `sonnet` | Any other ticket, and its fixes |
| `review` | `sonnet` | The review round on each ticket PR |
| `mechanical` | `haiku` | Merging the wave branch into a ticket branch, answering review threads, a ticket the planner marks mechanical (a format or clean-up pass) |

Checking and merging a PR and running the gates use no model of their own: the `runner` runs `scripts/wave.ts`, and the script decides.

## Commands

| Command | Does |
|---|---|
| `bun scripts/harness-config.ts show` | Prints `{"config": ..., "check": "<8 hex>"}` on one line, without `seedLogins` (`get` and the loader keep it). `check` is the FNV-1a checksum of the config as stable JSON (keys sorted at every depth, no spaces) |
| `bun scripts/harness-config.ts get <dotted.key>` | A string or number as is, a list of strings one per line, anything else as compact JSON; an unknown key exits 1 |
| `bun scripts/harness-config.ts gates` | The gate lines `verify.sh` loops over; exits 1 when there are none |
| `bun scripts/harness-config.ts check` | Validates the file; the `harness` gate runs it (check M) |

Exit codes: 0 ok, 1 bad config or a missing required key, 2 usage.
