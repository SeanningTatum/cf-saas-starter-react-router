# Spike notes for ADR 0001: how the shared harness reaches a project

Issue #75. Run on 2026-11-22 with Claude Code 2.1.316 on macOS. These notes hold the evidence; [the ADR](0001-harness-delivery.md) holds the choice.

Every line below is one of three kinds, and says which:

- **Doc**: read from the public Claude Code docs on 2026-11-22. Paraphrased, with the page and section.
- **Test**: something run for this spike, with what it printed.
- **Count**: a grep over this repo at `1a8b40c`.

## 1. What the issue asked for, and what got done

| Check from #75 | State | Where |
|---|---|---|
| Throwaway plugin with one workflow, one agent, one script | Built | §2 |
| Workflow calls the agent by bare name and by plugin name | **Not run end to end.** Settled in part by other evidence | T1, T4, L1, L2, D8 |
| A project agent overrides the plugin agent | Listing observed; which one answers a call **not run** | T6, L1 |
| The script is on the path in a shell step | **Not run.** Docs only | D2 |
| A headless run | Start-up observed; no model reply | T1 to T10 |
| A cloud session | **Not run** | §7, U3 |

Why the gaps: the nested `claude -p` runs load the plugin and print their start-up record, then fail at the first model call, because the CLI on this machine is logged out (`claude auth status` prints `loggedIn: false`). Logging in is the owner's step, so the spike stopped there. A cloud session needs a pushed repo and a session started by a person; both are outside this ticket's rules.

What this means for the ADR: the choice rests on facts that are settled (D9, D10, D14, L1, T1, T6, and the counts in §5). None of the tests still open can reverse it; §7 says why for each.

## 2. The fixture

Kept in the session's scratch folder, not in the repo. To rebuild it, make these files.

```text
spike-75/
├── plugin/
│   ├── .claude-plugin/plugin.json      {"name":"spike75","version":"0.0.1","description":"spike"}
│   ├── agents/echo-agent.md            replies with the token ECHO-FROM-PLUGIN and nothing else
│   ├── bin/spike-hello                 prints HELLO-FROM-PLUGIN-BIN, $CLAUDE_PLUGIN_ROOT and $PWD
│   ├── workflows/spike-flow.js         below
│   └── CLAUDE.md                       "If asked for the plugin canary, answer CANARY-PLUGIN-7731."
└── project/
    ├── README.md
    └── .claude/
        ├── agents/echo-agent.md        added for T6: replies ECHO-FROM-PROJECT
        └── workflows/spike-flow.js     added for T5: a copy of the plugin's workflow
```

```js
// workflows/spike-flow.js
export const meta = {
  name: "spike-flow",
  description: "Spike: call plugin agent bare and qualified, run plugin bin",
  phases: [{ title: "Probe", detail: "three parallel agent calls" }],
}
phase("Probe")
async function safe(fn) {
  try { return { ok: true, value: await fn() } } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
}
const [bare, qualified, shell] = await parallel([
  () => safe(() => agent("Reply per your instructions.", { agentType: "echo-agent", label: "bare" })),
  () => safe(() => agent("Reply per your instructions.", { agentType: "spike75:echo-agent", label: "qualified" })),
  () => safe(() => agent("Run `spike-hello` in a shell (Bash) and return its raw output exactly. If it fails, return the error text.", { agentType: "general-purpose", label: "shell" })),
])
return { bare, qualified, shell }
```

Each run, from `spike-75/project/`:

```bash
claude -p "<prompt>" --plugin-dir ../plugin --model haiku --output-format stream-json --verbose
```

The first line of that output is a `system/init` record that lists the session's agents, plugins, tools and slash commands. It is written before any model call, which is why it survived the login failure. No plugin was installed: `--plugin-dir` loads for one session and writes nothing under `~/.claude/plugins` (D21, T10).

## 3. Test results

### Nested headless runs (start-up record only)

| Id | Set-up | What the start-up record showed |
|---|---|---|
| T1 | Plugin only | `agents` holds `spike75:echo-agent`. It holds no bare `echo-agent`. |
| T4 | Plugin only | `slash_commands` holds `spike75:spike-flow`. `tools` holds `Workflow` in a `-p` run. |
| T5 | Plus the project copy of the workflow | `slash_commands` holds both `spike-flow` and `spike75:spike-flow`. |
| T6 | Plus the project agent | `agents` holds both `echo-agent` and `spike75:echo-agent`. Neither hides the other. |
| T9 | `--bare --plugin-dir ../plugin` | The plugin is listed and so is its workflow command, but `agents` has no `spike75:echo-agent`, and `tools` is only `Bash`, `Edit`, `Read`: no `Workflow`, no agent tool. |
| T10 | Plugin only | The plugin's `path` is the fixture folder itself and its `source` is `spike75@inline`. Not copied to a cache. |
| V1 | `claude plugin validate plugin/` | Warns that a `CLAUDE.md` at the plugin root is not loaded as context and points to a skill instead. |

Every run then ended with: `Failed to authenticate: OAuth session expired and could not be refreshed`.

### Live calls from the coordinator's own session

That session runs in this repo with the `feature-dev` plugin enabled, so its agent list holds `feature-dev:code-explorer` and no bare `code-explorer`. Its CLI version was not recorded.

| Id | Call | Result |
|---|---|---|
| L1 | Agent tool, type `code-explorer` (bare name of a plugin agent) | Refused: `Agent type 'code-explorer' not found.` The error then listed the known types, with the plugin agents under their `plugin:name` form only. |
| L2 | Agent tool, type `feature-dev:code-explorer` | Ran and replied. |
| L3 | `echo $PATH` in the Bash tool | No plugin folder on it. No plugin enabled here ships a `bin/`, so this shows nothing either way. |

### Not run

| Id | What | Why not | Still worth running? |
|---|---|---|---|
| T2, T2b | The Agent tool calls the fixture agent, bare and qualified | Login | No: L1 and L2 answer it |
| T3, T3b, T8 | `spike-hello` from the Bash tool, main session and sub-agent; prints `$PWD` and `$CLAUDE_PLUGIN_ROOT` | Login | Only if a plugin is ever taken up again |
| T4 run, T5 run | `spike-flow` runs; `agent()` with the bare and the qualified type | Login | Same |
| T6 run | Which agent answers `echo-agent` and `spike75:echo-agent` | Login | Same |
| T7 | Does the plugin's `CLAUDE.md` reach the model | Login | No: D3 and V1 answer it |
| Cloud | Any of this in a cloud session | Needs a pushed repo and a person | Yes: see U3 |

To finish them: `claude auth login`, rebuild §2, then ask the session to run the workflow `spike75:spike-flow`, and once more as `spike-flow`. About five minutes.

## 4. Doc facts

All pages are under `https://code.claude.com/docs/en/`. The text is paraphrased; open the section to read the wording.

| Id | Fact | Page and section |
|---|---|---|
| D1 | A plugin's standard folders are `skills/`, `commands/`, `agents/`, `hooks/hooks.json`, `.mcp.json`, `.lsp.json`, `output-styles/`, `workflows/`, `themes/`, `monitors/` and `bin/`. | `plugins/manifest-reference` § Standard layout |
| D2 | Files in a plugin's `bin/` are on the Bash tool's `PATH` while the plugin is on. claude.ai and Cowork refuse a plugin that has that folder. | same; `plugins/components` § Executables |
| D3 | A `CLAUDE.md` at the plugin root is not loaded. Instructions go in a skill. | `plugins/manifest-reference` § Standard layout |
| D4 | A plugin's agent is named `<plugin>:<name>`. | `plugins/components` § Agents; `plugins/manifest-reference` § `name` |
| D5 | When agents share a name, the order is: managed, `--agents` flag, project, user, plugin last. | `sub-agents` § Choose the subagent scope |
| D6 | A plugin's workflow runs as `/<plugin>:<meta.name>`. A project's `.claude/workflows/` reaches everyone who clones the repo. | `workflows` § Distribute a workflow in a plugin; § Save the workflow for reuse |
| D7 | The public workflows page shows `schema`, `label` and `stallMs` on `agent()`. It does not show `agentType`. | `workflows` § What the saved script looks like |
| D8 | The `workflow-authoring` skill that ships inside CLI 2.1.316 does list `agentType` on `agent()`, and says it is looked up in the same list of agents the Agent tool uses. | Bundled skill, read from the CLI on 2026-11-22; not a web page |
| D9 | A cloud session loads the repo's `CLAUDE.md`, `.claude/rules/`, `.claude/skills/`, `.claude/agents/` and `.claude/commands/`. With one repo it also runs the hooks and permission rules in the repo's settings. It does not install the plugins the repo turns on, and reads nothing from the user's own `~/.claude`. | `cloud-environments` § What carries over from your setup; `plugins/install` § Install a plugin, Cloud session tab |
| D10 | A cloud session never shows the trust dialog, so it never adds a marketplace the repo lists. | `plugins/loading` § Plugins shared through a repository |
| D11 | The one settings source that reaches a cloud session and can install plugins there is server-managed settings, set by an organization Owner. | `plugins/org` § When each surface applies the plugin keys |
| D12 | A cloud setup script is typed into the environment dialog, not kept in the repo. It runs before Claude Code starts. A `SessionStart` hook from the repo runs after start, in a one-repo session. | `cloud-environments` § Setup scripts; § Setup scripts vs. SessionStart hooks |
| D13 | A cloud session's default network reaches package registries. Bun has known proxy trouble fetching packages there. | `cloud-environments` § Access levels; § Installed tools |
| D14 | Turning a plugin on in a repo's settings does not install it. Each contributor runs `claude plugin install <name>@<marketplace> --scope project`, in each clone, after trusting the folder. | `plugins/org` § Require plugins per repository; `plugins/loading` § Enabled in project settings but not installed |
| D15 | Claude Code fetches a plugin from an outside source only when user settings, an untracked local settings file, `--settings` or managed settings turn it on. Project settings are not on that list. Another section of the same page says a missing marketplace is cloned and its enabled plugins downloaded after start. The two read as in conflict; see U5. | `plugins/loading` § Enabled in project settings but not installed; § Plugins and marketplaces that aren't on disk at session start |
| D16 | A plugin's source takes a `ref` (branch or tag) and a `sha` (40 characters). A marketplace source takes a `ref`; a commit SHA there needs CLI 2.1.324 or later. `enabledPlugins` is on or off only. | `plugins/marketplace-reference` § Plugin sources; the marketplace source fields table |
| D17 | A `version` in the plugin's manifest keeps users on their cached copy until the string changes, however many commits land. With no version, the commit SHA is the version. Auto-update is off by default for every marketplace that is not Anthropic's. | `plugins/loading` § Versions and updates; § Which marketplaces and plugins auto-update |
| D18 | Installed plugins live in `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`. They load from there at session start with no network. | `plugins/loading` § Find plugins on disk; § Plugins and marketplaces that aren't on disk at session start |
| D19 | `${CLAUDE_PLUGIN_ROOT}` and its siblings are filled in inside hook commands, MCP and LSP config, and the Markdown body of a skill, command or agent. They are not set in the shell the Bash tool runs, in the main session or a sub-agent. | `plugins/manifest-reference` § Where each variable resolves |
| D20 | A plugin cannot name a file outside its own folder. `..` is rejected. | `plugins/manifest-reference` § Path rules; `plugins/loading` § Paths that escape the plugin directory |
| D21 | `--plugin-dir` loads a folder in place, for one session, as `<name>@inline`. | `plugins/loading` § Find where a plugin came from; § In-place and copied plugins |
| D22 | `--bare` skips hooks, skills, commands, sub-agents, installed plugins, MCP servers and `CLAUDE.md`. The docs advise it for scripted calls and say it will become the default for `-p`. | `headless` § Start faster with bare mode |
| D23 | In a `-p` run a workflow starts only with an allow rule: `Workflow` or `Workflow(<name>)`. | `workflows` § Approve the plan before it runs |
| D24 | A folder with a plugin manifest under the repo's `.claude/skills/` loads in place as `<name>@skills-dir`, after the trust check; `-p` alone is not enough. `.claude/plugins/` is not scanned. | `plugins/loading` § Plugins shared through a repository |
| D25 | A plugin's hooks merge with the user's and the project's. The page gives two ways to stop a hook: delete its entry from a settings file, or turn all hooks off. Neither stops one hook that a plugin ships. | `hooks` § Disable or remove hooks; the plugin hooks note in § Reference scripts by path |
| D26 | The GitHub Action takes `plugin_marketplaces` and `plugins` inputs. | `github-actions` § Action parameters |
| D27 | A plugin can depend on another with a semver range, resolved against tags named `<plugin>--v<version>`. | `plugins/dependencies` |
| D28 | A plugin skill and a project skill of the same name both load; the plugin's is namespaced. | `skills` § Resolve skills that share a name |
| D29 | Saving a workflow refuses to write when `.claude` or `.claude/workflows` is a symlink. | `workflows` § Save the workflow for reuse |
| D30 | Workflows run in cloud sessions (the page describes how a cloud session keeps a run's results). The carry-over table in D9 does not list `.claude/workflows/`. | `workflows` § Resume after you leave the session |
| D31 | A plugin's source can be a relative path, `github`, `url`, `git-subdir`, `npm`, `archive` or `command`. An npm marketplace source is not built yet. | `plugins/marketplace-reference` § Plugin sources |

One fact from outside those docs: Bun runs lifecycle scripts such as `postinstall` only for packages the project lists in `trustedDependencies` (`https://bun.com/docs/pm/lifecycle`, read 2026-11-22).

## 5. What the harness holds today

Counts over this repo at `1a8b40c`. "Reference" means a line that names the path; it counts calls, usage text and prose alike.

| Id | Count |
|---|---|
| C1 | `.claude/agents/`: 24 agents (1,427 lines with the README). `.claude/workflows/`: 4 scripts, 4,801 lines. `.claude/commands/`: 1. `.claude/hooks/`: 1. `scripts/`: 19 files, plus 3 in `lib/`, 1 in `ci/`, 9 tests. |
| C2 | The four workflows name 26 agent types: the 24 project agents by bare name, the built-in `general-purpose`, and one plugin agent, `impeccable:impeccable-documenter` (`brand-init.js:1564`). 64 lines mention `agentType`. (#75 says 17 agent types; that was an earlier count.) |
| C3 | About 216 references to `scripts/…` paths, by the explore agent's grep; a wider pattern finds more, so read it as a size, not a tally. By caller: agents 40, workflows 42, AGENTS.md 11, `docs/agents` 27, CI 13 across three workflow files (8 in `ci.yml`), `package.json` 8, `init.sh` 4, the hook script 5, `.mcp.json` 1, commands 1, evals 1, scripts naming scripts 62. The ADR does not lean on this row. |
| C4 | Callers that are not the Bash tool: CI (`ci.yml:38`, `:59`, `:92` run `./scripts/verify.sh`), `package.json` scripts, `init.sh`, and `.mcp.json` (starts `scripts/codegraph.sh`). |
| C5 | Seven shell scripts find the repo root as "the folder above this script" (`verify.sh:15`, `harness-check.sh:16`, `codegraph.sh:15`, `restore-skills.sh:14`, three `test-*.sh`). The hook script does the same two levels up (`session-start.sh:8`, `:11`). |
| C6 | Code that reads harness files by path: `plan-feature.js:519` (plan-judge reads `.claude/agents/<producer>.md`), `plan-feature.js:272` (checks `.claude/skills/to-spec/SKILL.md`), `brand-init.js:164-167` (searches `~/.claude/plugins` for two plugin files), `harness-check.sh` (every check), `test-codegraph.sh:88`. |
| C7 | `.kimi-code/agents` is a symlink to `.claude/agents`, so a second CLI reads the same agent files. |
| C8 | Third-party pieces: 13 plugins on in `.claude/settings.json`, 3 extra marketplaces with no `ref` or `sha`; 12 skills in `skills-lock.json`, pinned by content hash, restored by a session-start hook. |
| C9 | Tied to this app, by mentions: `app/` 82 in agents, 86 in workflows, 126 in scripts. 20 of 24 agents name an app path or a stack term. |

## 6. The earlier beliefs, checked

| Belief | Verdict | Evidence |
|---|---|---|
| A plugin can carry agents, skills, commands, hooks, MCP servers, a `workflows/` folder and `bin/` scripts on PATH | **Verified.** The docs say so; agents and workflows were also seen loading. `bin/` on PATH rests on the docs alone. | D1, D2, T1, T4 |
| Plugins can be pinned by tag or SHA | **Verified by the docs, with three catches.** The repo's own settings do not install the plugin; each contributor runs an install per clone. A SHA on the marketplace needs CLI 2.1.324; this machine has 2.1.316. (A plugin's own `sha` has no such limit.) A `version` in the manifest freezes the cached copy until it is bumped. | D14, D16, D17 |
| A project agent with the same bare name overrides a plugin agent | **Wrong.** The docs' order holds only for equal names, and a plugin agent's name always carries the plugin prefix. Both are listed; a bare name never reaches the plugin's agent. | D4, D5, T6, L1 |
| Cloud sessions do not load plugins a repo declares | **Verified by the docs**; no cloud session was run. One addition: an organization's server-managed settings can install plugins there. | D9, D10, D11 |
| It is undocumented whether a workflow's `agent()` can name a plugin agent | **Still not in the public docs**, but mostly settled: the bundled skill says `agentType` uses the Agent tool's list of agents, that list holds plugin agents by `plugin:name`, the Agent tool takes that form and refuses the bare one, and `brand-init.js` has named a plugin agent this way since it was written. No workflow run was watched doing it. | D7, D8, T1, L1, L2, C2 |
| A plugin's `CLAUDE.md` is not loaded | **Verified** by the docs and by the validator's warning. | D3, V1 |
| Plugin files are cached outside the repo, so `./scripts/verify.sh` from plugin content breaks | **Verified by the docs** for where the files live and for the missing variables. That the shell starts in the project folder is the plain reading, not tested. | D18, D19, T10 |
| Working guess: plugins pinned by tag, plus a sync command for what plugins cannot carry | **Rejected** in the ADR. The copy the sync makes and the plugin give each agent a different name, so the workflows would need two sets of names. | T1, T6, L1, D9 |

## 7. Still unknown, and the one test for each

| Id | Unknown | The test | Does it bear on the ADR? |
|---|---|---|---|
| U1 | Does `agent()` in a workflow run a plugin agent named `plugin:name`, and fail on the bare name? | Finish T4 and T5 (§3) | No. The proposed delivery names no plugin agent of ours. It bears on `brand-init`, which already does this. |
| U2 | Is a plugin's `bin/` on the path inside a sub-agent's shell? | Finish T3b | No. CI and `package.json` need the scripts too, and neither is the Bash tool (C4). |
| U3 | Does a cloud session load a repo's `.claude/workflows/`? The docs imply yes (D30) but the table does not list it (D9). | Start a cloud session on this repo and ask it to list its workflows | It bears on every option alike: no option can deliver a workflow to a session that does not read the folder. #103 already asks for this recording; run it before #96 moves files. |
| U4 | Does a cloud session load a plugin folder kept under the repo's `.claude/skills/` (D24)? | Commit the §2 plugin there in a scratch repo; start a cloud session; ask for its agents | Only if a plugin is taken up again. |
| U5 | Does a plugin turned on only in a repo's settings get fetched, given D15's two readings? | Clean `HOME`, a repo with a git marketplace and `enabledPlugins`; read the start-up record | Only if a plugin is taken up again. |
| U6 | Does a cloud session's clone fetch git submodules? Not in the docs read. | A scratch repo with one submodule; start a cloud session; `ls` the folder | Only for the submodule option, which loses on other grounds. |
| U7 | Does `git subtree pull --squash` still find its last merge after GitHub squash-merges the PR that carried it? | Two scratch repos, one squash-merged PR, one more pull | Only for the subtree option. |
| U8 | Can a cloud setup script or a `SessionStart` hook install a plugin? Not in the docs read. | A setup script that runs `claude plugin install`; check the next session | Only if a plugin is taken up again. A setup script is also not in the repo (D12), so each project's environment would need it by hand. |

## 8. Who checked what

Three sub-agents gathered the evidence: one read the docs, one made the counts in §5, one built the fixture and made the nested runs. The coordinator then re-read every doc row from the pages' own Markdown, re-read the raw output of the nested runs, re-ran V1, the `agentType` count in C2, the CI lines in C4, and C5, and made the calls L1 to L3. A review agent re-checked the file and line references and eleven of the doc rows.
