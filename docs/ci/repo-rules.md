# Repo rules as code

The rules GitHub enforces on this repo live in [`.github/repo-rules.json`](../../.github/repo-rules.json). [`scripts/repo-rules.ts`](../../scripts/repo-rules.ts) checks the live repo against that file and, when the owner asks, applies it.

## What the file declares

**A ruleset on the default branch** (`default-branch`):

- Changes land through a pull request. No direct push.
- Three CI jobs must be green: `Baseline (typecheck + test + harness-check)`, `Build (Cloudflare Workers)` and `E2E smoke (Playwright)`.
- Linear history: squash or rebase, no merge commits.
- No force push, no branch deletion.
- No bypass list. The rules bind admins too.

**The `production` environment:**

- A required reviewer: `@owner`, the account that owns the repo. The deploy job in [`deploy.yml`](../../.github/workflows/deploy.yml) waits for that person's approval, and cannot read the environment's secrets until it is given.
- Deploys only from the default branch.

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
| `error:` | The file is broken, or a required check is not a job name in `ci.yml` | red |

Three choices worth knowing:

- **Never applied is a notice, not a failure.** A fresh fork has no rules, and its gates must still be green. Once any part is applied, a missing part is drift: deleting the ruleset while the environment keeps its reviewer fails the gate, and so does the reverse. Two gaps remain: an admin who removes every rule at once puts the repo back to "never applied", and a token without admin rights that sees no protection on the environment gets a notice, because GitHub may hide it from that token.
- **The required-check names are tested offline.** Renaming a CI job without updating the file would leave a required check that never reports, and every pull request would hang. `--check` fails on that before it asks GitHub anything.
- **The gate warns; GitHub enforces.** A pull request can edit the file and the script it is checked by. The ruleset itself is the control, and only an admin can change it.

## Turn on required human review

Off by default: merges need green checks, not a second person. To require an approval, set `required_approving_review_count` to `1` in `.github/repo-rules.json` and run `--apply`. [`CODEOWNERS`](../../.github/CODEOWNERS) already names who GitHub asks; set `require_code_owner_review` to `true` as well if the approval must come from that person.

## Change a rule

Edit `.github/repo-rules.json`, open a pull request, and after it merges run `--apply`. A rule changed in GitHub's settings page instead shows up as `drift:` on the next gate run.

The `ruleset` object uses GitHub's own ruleset shape, so it can also be pasted into Settings → Rules → Rulesets → Import.

## Limits

- Rulesets and required reviewers on a **private** repo need a paid GitHub plan. `--apply` says so when GitHub refuses.
- `@owner` only works when a person owns the repo. For an organisation, list a login or `org/team-slug` under `reviewers`.
- `--check` needs admin rights to read the bypass list. Without them it says so and checks the rest.
- `--apply` replaces the environment's protection, so a wait timer set by hand in GitHub's settings is cleared.
- Linear history means a branch reaches the default branch by squash or rebase. A long-lived branch built with merge commits must be squashed when it lands.
