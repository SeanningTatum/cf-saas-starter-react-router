---
status: accepted
date: 2026-11-22
---

# The shared harness reaches a project as a committed copy of the latest source, not as a plugin

The harness (24 agents, 4 workflows, about 20 scripts, a hook and a command) is moving to one shared repo (#65). Each project takes it as plain files committed in the project: a sync command copies the head of the shared repo's default branch into fixed paths and writes a lock file that records which commit it copied, and a check fails the harness gate when a copied file was changed by hand. There are no release tags to pin and no version to install. We do not ship it as a Claude Code plugin, alone or beside the copy. A cloud session does not install the plugins a repo turns on, CI's gate is a shell step that no plugin serves, and a plugin gives every agent a second name that the workflows would then have to handle.

**Status: accepted on 2026-11-22** by the owner, on #75. Their words:

> "For #75, I want to be just a .claude rather than a new plugin marketplace so that all that we need to do is always pull from latest rather than have the issue of constantly installing a new version. I prefer it that way"

How that maps to the design below is the main thread's reading, not the owner's text: "just a .claude" is the committed copy this ADR proposed; "always pull from latest" drops the pin to a tagged release that the proposal had, and turns the lock file from a pin into a record.

**Settled by the owner on 2026-11-23.** Three points that the reading above left open are now decided, and one fact is recorded:

- A harness update arrives as a pull request, not as a plain pull onto the working branch.
- A project that is behind the shared source gets a notice, not a failing check.
- Third-party skills are pinned by commit. They do not follow latest the way the harness itself does.
- The shared harness repo will be public. Its name is not chosen yet.

Evidence ids (`D9`, `T6`, `L1`, `C4`, `U3`) point into the [spike notes](0001-harness-delivery-spike-notes.md). `D` is a line in the Claude Code docs, `T` and `L` are tests, `C` is a count over this repo, `U` is an unknown.

## What decided it

1. **Cloud sessions and CI read only what is in the clone.**
   - A cloud session loads the repo's `.claude/agents/`, `.claude/skills/`, `.claude/commands/` and, with one repo, its hooks (D9, docs).
   - It does not install plugins the repo turns on, and it never shows the trust prompt a repo's marketplace needs (D9, D10, docs). The one exception is a plugin an organization Owner sets in server-managed settings (D11). That is an account setting, not something a repo or a fork of this starter can carry.
   - CI's gate is a shell step: `ci.yml` runs `./scripts/verify.sh` three times (C4). A Claude step in CI could install a plugin (D26), but the gate is not a Claude step.
2. **A plugin renames every agent.**
   - A plugin's agent is `harness:runner`. The same file copied into `.claude/agents/` is `runner` (D4).
   - Both are listed, and neither hides the other (T6).
   - A bare name does not reach a plugin's agent: the Agent tool refused `code-explorer` and ran `feature-dev:code-explorer` (L1, L2).
   - A workflow's `agentType` is looked up in the same list, according to the skill that ships in the CLI (D8). No workflow run was watched doing it.
   - So with a plugin on laptops and a copy in the cloud, the workflows, which mention `agentType` on 64 lines (C2), would need one agent name in one place and another in the other.
3. **Most script callers are outside a plugin's reach.** A plugin's `bin/` is on the path of the Bash tool only (D2, docs), and its path variables are not set in that shell (D19, docs). CI, `package.json`, `init.sh` and `.mcp.json` all call scripts, and none is the Bash tool (C4). They need the files in the repo whatever else we do.
4. **Once the copy exists, a plugin adds nothing.** The copy must be committed: a repo's `SessionStart` hook runs after the session has started, and the setup script that runs before it is typed into each cloud environment, not kept in the repo (D12). A committed copy is on every laptop too, so it already serves every place the plugin would, under one set of names. The plugin would add a pin to keep in step with the copy (D16), an install each contributor runs in each clone (D14), and a manifest version to bump, or users stay on a stale cache (D17).

## The decision

- **One way in.** A project holds a committed copy of the shared repo's default branch, as it stood at the last pull. The shared repo cuts no releases and no tags for this.
- **The lock file is a record, not a pin.** It names the shared repo, the branch and the commit the copy came from, and holds a hash for each copied file. No command reads it to choose what to fetch: `sync` always takes the head.
- **Three commands:**
  - `sync` fetches the head of the default branch and writes the files and the lock. It needs the network.
  - `sync --check` compares the files on disk with the hashes in the lock. It needs no network. It runs in the `harness` gate, so CI fails when a copied file was changed by hand. With the network it also asks the source for its head and prints how many commits the copy is behind. Behind is a notice, not a failure (**decided by the owner, 2026-11-23**): if it failed, every push to the shared repo would turn every project's CI red.
  - `update` runs `sync` on a branch and opens a pull request that lists the source commits since the one in the lock. **Decided by the owner, 2026-11-23:** an update always arrives as a pull request, never as a plain pull onto the working branch.
- **The two drifts stay apart without a pin.** A hash that does not match is a hand edit here. A recorded commit that is not the head is a copy behind the source. Neither needs a tag. To undo a hand edit, restore the file from git; to roll back an update, revert its pull request.
- **Paths and names stay as they are.** Agents land in `.claude/agents/`, workflows in `.claude/workflows/`, commands in `.claude/commands/`, the hook script in `.claude/hooks/`. Agent names stay bare. Scripts land in a folder the harness owns.
- **A project changes harness behaviour in this order:** first a setting in `harness.config.json` (#86); then an agent or skill of its own under a new name; last, a copied file marked in the lock as kept, which `sync` leaves alone and `sync --check` reports on every run.
- **The shared repo keeps the folder names a plugin would use** (`agents/`, `workflows/`, `skills/`, `commands/`, `hooks/`). It costs nothing and leaves a later move to a plugin cheap. It ships no plugin manifest.

This ADR fixes the shape: a committed copy of the latest source, a lock file that records the commit, a check in the gate, an update by pull request. The lock's format, the script folder's name and how a kept file is marked belong to #103 and #96, which may refine them.

### What stays in every project

| Stays | Why |
|---|---|
| `AGENTS.md` and the `CLAUDE.md` symlink | The project's own rules. A plugin could not carry them either (D3). |
| `PRODUCT.md`, `DESIGN.md`, `GLOSSARY.md`, `docs/adr/`, `docs/features/` | Product facts and decisions. |
| `harness.config.json` | The project's answers to what the harness asks (#86). |
| The lock file | Which source commit the copy came from, and a hash for each file. |
| `.claude/settings.json` | Permissions, which hooks are wired, which third-party plugins are on. `sync` does not write it. |
| `.mcp.json`, `.github/workflows/` | They name project services and secrets. They call the harness; they are not part of it. |
| App scripts: seeding, first-time setup, teardown, preview database | They know this app's tables and bindings. |
| Agents and skills the project writes for itself | Under names the harness does not use. |
| The copy itself | Committed, owned by `sync`, not edited by hand. |

Whether `init.sh` and `evals/` are harness or project is #96's call, file by file.

## Considered options

"Docs" marks a cell that rests on the docs alone. "Not tested" marks one that rests on reasoning.

| | Cloud sessions | Version and update | Local override | Offline | Today's `./scripts/*` calls | Work to migrate |
|---|---|---|---|---|---|---|
| **1. Copy of the latest source by a sync command (chosen)** | Agents, skills, commands and hooks load from the clone (D9, docs). Workflows: implied, not stated (U3). | No pin. The lock records the commit and hashes. An update is one PR that takes the head; a rollback is a revert. | A setting, then a new name, then a kept file the check reports. | Full. Only `sync`, `update` and the behind notice need the network. | None break while scripts keep their folder. If #96 moves them, the callers change once, and so do the seven scripts that find the repo root from their own location (C5). | Middle. Write three commands, move the files, change the callers once. |
| **1b. The same copy, pinned to a tagged release** (the proposal before sign-off; rejected) | As option 1. | Lock file with tag, commit and hashes. Each upgrade needs a release cut in the shared repo first, then a pin bump in each project. | As option 1. | As option 1. | As option 1. | Option 1, plus a release step and a tag to choose on each update. |
| **2. Plugin pinned by tag, plus the same copy for cloud and CI** (the earlier guess) | Only the copy loads (D9, D10, docs), unless an organization Owner installs the plugin through server-managed settings (D11). | Two pins to keep equal. Each contributor installs per clone (D14). The plugin's own `sha` pin works on CLI 2.1.316; a SHA on the marketplace needs 2.1.324 (D16). | By name, none: a project's `runner` does not replace `harness:runner` (T6). The docs list no way to turn off one hook of a plugin (D25). | Yes, after the first install (D18). | None break, because the copy is there. Without the copy, all would: plugin files live in `~/.claude/plugins/cache/` (D18), `bin/` serves only the Bash tool (D2), and `plan-judge` reads `.claude/agents/<name>.md` (C6). | Highest. All of option 1, plus a manifest, a marketplace, two names for each agent, and tests for both. |
| **3. Git subtree** | Works: files are in the clone. | The pin is a merge commit; no file states the version. Whether a squash-merged PR keeps it is not tested (U7). | Edit in place; nothing reports it. | Full. | Paths move under one prefix. The harness writes to several folders, so `.claude/agents` and `.claude/workflows` become symlinks into the prefix; saving a workflow refuses a symlinked folder (D29). | Middle. No tool to write, but symlinks and merge habits to keep. |
| **4. Git submodule** | Unknown whether the cloud clone fetches it (U6). If not, the symlinks point at nothing and the agents are gone with no error (not tested). | An exact commit by design. An upgrade is a pointer bump. | None without forking the shared repo. | Yes, after the first fetch. | Paths move into the submodule; same symlinks as option 3. | Low to set up. Costly to live with: a new worktree starts with the submodule empty until someone fetches it (how git behaves as far as we know; not tested here), and this repo works in worktrees daily. |
| **5. Package on a registry, copied in by `postinstall`** | Files exist only after an install. Agents load at session start, before a `SessionStart` hook can install (D12). Bun has proxy trouble in cloud sessions (D13). Committing the copied files fixes this, and is then option 1 with a registry in the middle. | `package.json` and the lockfile; a bot can bump it. | The copy overwrites on each install unless guarded (not tested). | Needs the registry on a fresh install. | Could become package commands (`bunx …`), which would also suit CI. | Needs a registry account, a publish step, and a public-or-private choice. Bun runs a dependency's `postinstall` only if the project lists it as trusted (Bun docs, in the notes). |
| **6. Template-sync bot** (the shared repo opens PRs in each project) | Works: files are in the clone. | The project sits at the last sync PR it merged. | An ignore list per project. | Full. | Same as option 1. | Option 1's work, plus a token that can write to every project and a list of projects kept in the shared repo (not tested; this is how such bots are set up). |

Options 1, 3 and 6 all end with files in the clone. Option 1 is the one where the project records its source commit in a file, a check proves the files match it, and no token outside the project is needed. Option 6 can be added later as a schedule that runs `update` in each project.

**Option 1b was rejected by the owner.** It works, but every change to the harness would mean a new version to cut and install in each project, which is the chore the owner wants gone. Option 1 keeps what 1b's pin was for, telling a hand edit from a stale copy, through the record in the lock.

## Consequences

- **"Only that repo needs updating" holds for the edit.** A fix is written once, in the shared repo. Each project still merges one update PR; #103 already rules out updates without a PR.
- **A breaking change reaches every project on its next pull.** With no pin, a project cannot stay on an older commit while the shared repo moves on; its next update takes everything on the default branch, good and bad. What limits the harm is that the pull lands as an ordinary PR that must pass the project's own gates, so a break shows up red there instead of in a working session. A project that cannot take a change leaves the PR open or marks the file kept. The shared repo's default branch must therefore stay green: its own CI is the last check before every project sees a change.
- **Each project carries the copy in its history**: more than 6,000 lines of agents and workflows today, plus the scripts (C1). An update PR shows what changed in them.
- **#101 and #102 speak of "a second plugin" and "a third plugin".** Under this ADR they are packs: folders in the shared repo that the lock file names and `sync` copies.
- **#96 and #103 block each other as written.** #96 takes the core "by the road the ADR chose", which is `sync`; #103 builds `sync` and waits on #96.
- **#65, #96, #101 and #103 speak of pins, tags and releases.** Under this decision a project takes the head and the lock records it; nothing is tagged.
- **Third-party skills are pinned by commit (decided by the owner, 2026-11-23).** The harness follows the head of its default branch; a third-party skill does not. Wherever one is copied in or fetched, its source is fixed to one commit, and moving to a newer commit is a deliberate change. #102 still decides whether any is copied in.
- **The shared repo will be public (recorded 2026-11-23).** Its name is not chosen yet. Nothing in it may hold a secret, an email or a private detail.
- **Third-party plugins stay plugins.** They do not load in cloud sessions (D9), so `brand-init`, which calls `impeccable:impeccable-documenter` and searches `~/.claude/plugins` (C6), cannot run there today. This ADR does not fix that; #102 decides whether any third-party skill is copied in too.
- **The second CLI keeps working.** `.kimi-code/agents` points at `.claude/agents` (C7), which still holds real files.
- **Headless runs must not use `--bare`.** It drops sub-agents and the Workflow tool (D22, T9). The docs say it will become the default for `-p`; when it does, harness runs in CI must turn it off.

## What is not known

- **Whether a cloud session loads `.claude/workflows/`** (U3). The docs imply it and do not state it. Every option depends on it alike. One cloud session on this repo settles it; run it before #96 moves files, not at #103.
- **The first box on #75 is only partly met.** The throwaway plugin was built and seen to load. These were not run, because the CLI on this machine is logged out and a cloud session needs a person: a workflow calling the plugin's agent by either name, which agent answers when a project agent shares the name, the plugin's script on the path in a shell step, and anything in a cloud session. The spike notes (§3) give the five-minute steps to finish the local ones. They cannot change this choice: points 1 and 3 hold whatever they show.
- **Five more unknowns** (U4 to U8 in the notes) matter only if a plugin, a submodule or a subtree is taken up again.

## When to look again

Reopen this if any of these becomes true:

- Cloud sessions start installing the plugins a repo turns on.
- A workflow can name an agent in a way that resolves the same whether it came from a plugin or a file.
- The copy's update PRs cost more review time than the harness changes they carry.
- Breaking changes from the shared repo cost projects more than cutting and installing releases would. That is the case for option 1b.
