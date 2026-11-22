# Supply chain

What guards the code you depend on and the pipeline that ships it, where each control runs, and what to do when one fires.

| Control | What it does | Runs in | Config |
|---------|--------------|---------|--------|
| Dependabot | Opens grouped weekly pull requests for packages and for actions | GitHub | `.github/dependabot.yml` |
| Pinned actions | Every `uses:` names a commit, not a tag | every workflow | `.github/workflows/*.yml` |
| Least-privilege tokens | Each workflow starts at `contents: read`; a job asks for more by name | every workflow | `permissions:` blocks |
| Secret scan | Fails on a credential-shaped string in the working tree | `./scripts/verify.sh` (baseline, so CI too) | `scripts/secret-scan.ts` |
| Package audit | Fails on a high or critical advisory that is not allowed | `./scripts/verify.sh` (baseline, so CI too) | `scripts/package-audit.ts`, `.github/audit-allow.json` |
| CodeQL | Reads the source for injection, unsafe input and workflow flaws | GitHub Actions | `.github/workflows/codeql.yml` |

Not covered: a software bill of materials and build provenance.

## Act on a hit

### A Dependabot pull request

Packages arrive as at most two pull requests a week: `production` and `development` (minor and patch updates). A major update is its own pull request. Actions arrive as one `actions` pull request. Dependabot rewrites the commit SHA and the `# vX.Y.Z` comment together. Before you merge, read what changed in the release, not only its notes: for a package, the diff between versions; for an action, the commit range between the old and new SHA. Then let CI run.

### A secret-scan hit

The gate prints `path:line  rule`, never the matched text.

1. Open the line. If it is a real credential, rotate it at the provider first, then remove it from the tree. Removing it from the file does not undo the leak: it stays in git history.
2. If it is a false alarm, add `secret-scan: allow <rule>` in a comment on that line, naming the rule from the hit. It skips that rule on that line only: a different rule on the same line still fires, and a private key can never be allowed. The marker shows in the diff, so a reviewer sees every exception. Prefer changing the value (a fixture can be built at run time) over the marker.
3. A `tracked-env-file` hit means `.env` or `.dev.vars` is committed. Delete it, ignore it, and keep a `.example` copy.

The scan skips binary files, files over 1 MB and `bun.lock` (a lockfile is full of hashes). It prints `notice: skipped <n> binary or large files (not scanned)` for the first two; `bun.lock` is not counted in that number.

### A package-audit hit

The gate prints `blocking: <package> <severity> <GHSA> <title>`.

1. Run `bun update <package>`. If the package is a dependency of another, update that one.
2. If no fixed version exists or the package cannot move yet, add an entry to `.github/audit-allow.json` with an `id` (the GHSA), the `package`, a `reason` and an `expires` date (`YYYY-MM-DD`, the last day it allows). The entry names one pair: the same advisory in another package still blocks. Pick a date you will keep.
3. When a package is fixed, the gate prints a `notice:` for its entry. Delete the entry. A stale entry never fails the gate.
4. After the `expires` date the entry no longer allows: the finding blocks and the line says `(allowance expired <date>)`. Upgrade the package, or renew the entry with a new date and a reason.

If the gate prints `error: the audit could not run`, the registry or `bun audit` failed. That is a failure, not a pass: rerun it.

### A CodeQL alert

Open the repository's Security tab, then Code scanning. Fix the finding, or dismiss it there with a reason. CodeQL runs on every pull request, on `main` and on Mondays.

## Limits

- A pull request can edit the scanner, the audit script and the allow file that check it. These gates catch mistakes, not a hostile committer; GitHub's own scanning and code review are the control there.
- The in-repo secret scanner knows a short list of patterns and reads the working tree, not history. GitHub secret scanning with push protection covers history and partner patterns; turn it on (below).
- The scanner misses a secret split across lines, a key body without its `BEGIN` header, anything in a skipped file (binary, over 1 MB, `bun.lock`) and anything already in git history.
- `.github/audit-allow.json` starts with a baseline of 54 findings that were there before the gate existed: 24 in runtime dependencies (better-auth, defu, drizzle-orm, effect, kysely, lodash, react-router, zod), which expire on 2026-12-06, and 30 in dev or build tooling (browserslist, nanoid, picomatch, postcss, rollup, sharp, source-map-js, tinypool, undici, vite, vitest, ws), which expire on 2027-01-22. On its date the gate turns red until the package is upgraded or the entry is renewed with a reason.
- The audit sees only what `bun audit` sees: advisories in the lockfile, not code you vendored.
- CodeQL results show in the Security tab and as pull-request annotations; they do not run locally. On a pull request from a fork the upload runs with a read-only token, so the CodeQL job can show red.
- Dependabot and CodeQL only run on GitHub. The tests check the files, not the behavior.

## Owner steps

These are repository settings that no file can turn on. In Settings -> Code security:

1. Turn on Dependabot alerts and Dependabot security updates.
2. Turn on secret scanning and push protection.
3. Turn on private vulnerability reporting, so the link in `SECURITY.md` works.
4. Leave code scanning's "default setup" off: `codeql.yml` already runs CodeQL, and two setups upload clashing results.
