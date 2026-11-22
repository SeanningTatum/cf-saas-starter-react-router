# Repo rules as code

The rules GitHub enforces on this repo live in [`.github/repo-rules.json`](../../.github/repo-rules.json). [`scripts/repo-rules.ts`](../../scripts/repo-rules.ts) checks the live repo against that file and, when the owner asks, applies it.

## What the file declares

The repo ships a two-branch flow. `staging` is the default branch and takes feature pull requests. `production` takes only `staging`, and each push to it is tagged and released. Two rulesets guard the two branches.

**A ruleset on the default branch** (`default-branch`):

- Changes land through a pull request. No direct push.
- Three CI jobs must be green: `Baseline (typecheck + test + harness-check)`, `Build (Cloudflare Workers)` and `E2E smoke (Playwright)`.
- Linear history: squash or rebase, no merge commits.
- No force push, no branch deletion.
- No bypass list. The rules bind admins too.

**A ruleset on `production`** (`production`):

- Changes land through a pull request, and the only merge method is a merge commit.
- Four checks must be green: `Source branch is staging` and the three CI jobs above. Each is bound to GitHub Actions (`integration_id` 15368), so no other app can post a status of that name.
- No force push, no branch deletion, no bypass list.
- No linear-history rule. A release merges `staging` as a merge commit, which linear history would refuse. The default branch is linear because feature work squashes into it.
- The checks do not run on branch creation (`do_not_enforce_on_create`), so a fork can create `production` from `staging` without a pull request.

**The guard check.** A ruleset cannot limit which branch a pull request comes from. The job `Source branch is staging` in [`production-guard.yml`](../../.github/workflows/production-guard.yml) does it: it fails any pull request into `production` whose head is not `staging` in this repo, and the ruleset requires it. `--check` proves offline that every required check, this one included, is a job name in some file under `.github/workflows/`.

**The `production` environment:**

- A required reviewer: `@owner`, the account that owns the repo. The deploy job in [`deploy.yml`](../../.github/workflows/deploy.yml) waits for that person's approval, and cannot read the environment's secrets until it is given.
- Deploys only from the default branch, even though the deploy ships `production`. The reason is in [Why the environment says "default branch"](pipelines.md#why-the-environment-says-default-branch).

## What the guard does not stop

The `Source branch is staging` check runs from the pull request's own copy of the workflow (a `pull_request` run), like the three CI checks. A pull request that edits `production-guard.yml` can make the check pass. The check guards against a mistake, such as a feature branch merged straight into `production`. It is not a wall against someone who can already merge: with no required review, that person can reach `production` through `staging` anyway.

What stands behind it: only people with write access can merge, and the `production` environment needs the owner's approval before anything deploys.

Hardening is the owner's choice, and each option has a cost:

- **Run the guard on `pull_request_target`.** The workflow then comes from `production` itself, and it runs no pull-request code because it has no checkout. Cost: the first pull request that carries the change gets no guard run from either trigger, unless both triggers ship for one release. While both are there, the `pull_request` run still reads the pull request's copy, so the guard is only harder to pass once a second release drops `pull_request`.
- **Require a code-owner review on `production`.** Cost: a solo owner cannot review their own pull request.

Two more limits:

- The `default-branch` checks carry no `integration_id`, so any app with write access could post a check of that name. The `production` checks pin GitHub Actions.
- There is no tag ruleset for `v*`. Anyone with write access can push a version tag, and that sets the next version.

## Commands

```bash
bun run scripts/repo-rules.ts --check            # read only: is the repo in step with the file?
bun run scripts/repo-rules.ts --apply --dry-run  # read only: print the writes --apply would make
bun run scripts/repo-rules.ts --apply            # make the repo match the file (needs admin rights)
```

`--apply` is safe to run twice: when the repo already matches, it writes nothing. `bun run setup` offers to run it.

## Who runs what

| Step | Who | Needs |
|------|-----|-------|
| `--check` | The harness gate (`./scripts/harness-check.sh`), on every machine and in CI | Read access |
| `--apply` | The repo owner, once, and again after any edit to the file | Admin rights (`gh auth login` as an admin) |

## What `--check` reports

| Line | Meaning | Gate |
|------|---------|------|
| `ok:` | That part matches the file | green |
| `notice:` | GitHub could not be read (no `gh`, not logged in, no access), or no rule was ever applied | green |
| `drift:` | The live rule differs from the file. One line per field, with both values | red |
| `error:` | The file is broken (the old single `ruleset` key is an error: rename it to `rulesets`), or a required check is not a job name in any workflow | red |

`--check` prints one `ok:` or `drift:` line per ruleset, by name, and one for the environment.

How declared and live values compare: only fields the file declares are compared, so fields GitHub adds on its own never read as drift. A required check is compared by name, and by `integration_id` only when the file pins one. The `production` checks pin `15368`, and that matches live today. The `default-branch` checks pin none, and live carries none.

Choices worth knowing:

- **Never applied is a notice, not a failure.** A fresh fork has no rules, and its gates must still be green. Once any part is applied, a missing part is drift: deleting a ruleset while the environment keeps its reviewer fails the gate, and so does the reverse. Two gaps remain: an admin who removes every rule at once puts the repo back to "never applied", and a token without admin rights that sees no protection on the environment gets a notice, because GitHub may hide it from that token.
- **A fork that applied the rules before the `production` ruleset existed sees drift once.** It has `default-branch` and no `production`, so `--check` prints `drift: ruleset "production" is not applied but other rules are; run: bun run scripts/repo-rules.ts --apply`. Running `--apply` creates `production`, leaves `default-branch` alone, and clears it.
- **The required-check names are tested offline.** Renaming a CI job, or deleting `production-guard.yml`, without updating the file would leave a required check that never reports, and every pull request would hang. `--check` fails on that before it asks GitHub anything. It reads job names from every workflow file under `.github/workflows/`.
- **The gate warns; GitHub enforces.** A pull request can edit the file and the script it is checked by. The ruleset itself is the control, and only an admin can change it.

## Owner steps

- **This repo.** After the release-flow change merges, run `bun run scripts/repo-rules.ts --check`. Expect `ok:` for both rulesets and the environment. You need not run `--apply`: the live rules already match the file.
- **A fork.** A fork starts with one branch and no rulesets, and every gate passes that way (`--check` gives notices). The steps to adopt the two-branch flow are in [A fresh fork](pipelines.md#a-fresh-fork); `--apply` also protects the environment when the file lists reviewers.

## Turn on required human review

Off by default: merges need green checks, not a second person. To require an approval, set `required_approving_review_count` to `1` in `.github/repo-rules.json` and run `--apply`. [`CODEOWNERS`](../../.github/CODEOWNERS) already names who GitHub asks; set `require_code_owner_review` to `true` as well if the approval must come from that person.

## Change a rule

Edit `.github/repo-rules.json`, open a pull request, and after it merges run `--apply`. A rule changed in GitHub's settings page instead shows up as `drift:` on the next gate run.

Each entry in `rulesets` uses GitHub's own ruleset shape, so it can also be pasted into Settings → Rules → Rulesets → Import.

## Limits

- Rulesets and required reviewers on a **private** repo need a paid GitHub plan. `--apply` says so when GitHub refuses.
- `@owner` only works when a person owns the repo. For an organisation, list a login or `org/team-slug` under `reviewers`.
- `--check` needs admin rights to read the bypass list. Without them it says so and checks the rest.
- `--apply` replaces the environment's protection, so a wait timer set by hand in GitHub's settings is cleared.
- Linear history means a branch reaches the default branch by squash or rebase. A long-lived branch built with merge commits must be squashed when it lands. `production` is the exception: it takes merge commits only.
